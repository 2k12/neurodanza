#!/usr/bin/env node
// neurodanza · pilas: lo que hizo cada subagente, para no perder trabajo si se corta.
// Los hooks guardan solos lo mecánico (qué leyó y con qué contenido, qué editó, qué comandos corrió y
// cómo salieron); el propio agente agrega líneas de avance. Cada paso es un archivo atómico propio en
// `.neurodanza/pilas/<agent_id>/` (varios pasos o agentes a la vez no se pisan) y la pila se compacta en
// `.neurodanza/pilas/<agent_id>.json` al leerla. Con `reenfundar`, un reemplazo retoma sin releer todo.
// Ver docs/16-no-perder-trabajo.md.
//
//   node pilas.mjs avance --texto "<qué hice, qué falta>"   (lo registra el hook con tu agent_id)
//   node pilas.mjs ver --agente <id>                         la pila completa (JSON)
//   node pilas.mjs resumen --agente <id>                     texto corto para un prompt nuevo
//   node pilas.mjs reenfundar --agente <id>                  mensaje completo para lanzar el reemplazo (una vez por tarea)
//   node pilas.mjs limpiar                                   borra las pilas (al cerrar el ciclo)
//   node pilas.mjs guardar                                   (lo usa el hook PostToolUse; evento por stdin)
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { leerAgentes, maxSegDe, clase } from "./agentes.mjs";
import { loadConfig } from "./config.mjs";
import { enWorktree, leerTareas } from "./director.mjs";
import { escribirAtomico } from "./procesos.mjs";

const carpeta = (cfg) => cfg.abs(".neurodanza/pilas");
const seguro = (id) => String(id).replace(/[^\w.-]/g, "_").slice(0, 80);
const norm = (p) => String(p ?? "").replace(/\\/g, "/");
const lineas = (s) => (s ? String(s).split(/\r?\n/).length : 0);
const cola = (s, n = 20) => String(s ?? "").split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");
export const AVANCE = /pilas\.mjs["']?\s+avance\s+--texto\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;

/** Ruta relativa a la raíz del proyecto (o tal cual, si está fuera). */
function rel(cfg, p) {
  if (!p) return "";
  const r = norm(isAbsolute(p) ? relative(cfg.root, p) : p);
  return r.startsWith("..") ? norm(p) : r;
}

/** Hash del contenido actual de un archivo (o null si no existe). */
export function hashArchivo(file) {
  try {
    return createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Paso de la pila a partir de un evento PostToolUse (puro salvo el hash del archivo leído). Devuelve null
 * si la herramienta no se registra.
 */
export function pasoDe(cfg, event, ahora = Date.now(), tareas = []) {
  const tool = event.tool_name ?? "";
  const ti = event.tool_input ?? {};
  const tr = event.tool_response ?? {};
  const file = ti.file_path ?? ti.notebook_path;
  const w = file && tareas.length ? enWorktree(tareas, file) : null;
  const base = { t: ahora, tool, tipo: event.agent_type ?? "", ...(w ? { tarea: w.tarea.id } : {}) };
  if (tool === "Read" && file) return { ...base, leido: rel(cfg, file), hash: hashArchivo(isAbsolute(file) ? file : join(cfg.root, file)) };
  if (tool === "Edit" && file) return { ...base, editado: rel(cfg, file), mas: lineas(ti.new_string), menos: lineas(ti.old_string) };
  if (tool === "MultiEdit" && file) return { ...base, editado: rel(cfg, file), mas: (ti.edits ?? []).reduce((n, e) => n + lineas(e?.new_string), 0), menos: (ti.edits ?? []).reduce((n, e) => n + lineas(e?.old_string), 0) };
  if (tool === "Write" && file) return { ...base, editado: rel(cfg, file), mas: lineas(ti.content), menos: 0, completo: true };
  if (tool === "Bash" || tool === "PowerShell") {
    const comando = String(ti.command ?? "");
    const av = comando.match(AVANCE);
    if (av) return { ...base, avance: (av[1] ?? av[2] ?? "").replace(/\\"/g, '"').trim() };
    // Claude Code no siempre informa el código de salida: si no viene, se marca como desconocido.
    const codigo = Number.isInteger(tr.exitCode) ? tr.exitCode : Number.isInteger(tr.exit_code) ? tr.exit_code : null;
    const fallo = codigo !== null ? codigo !== 0 : Boolean(tr.interrupted) || Boolean(String(tr.stderr ?? "").trim() && /error|fail|✖|exception/i.test(String(tr.stderr)));
    return { ...base, comando: comando.slice(0, 300), codigo, fallo, ms: Number(tr.durationMs ?? tr.duration_ms ?? 0) || null, ...(fallo ? { salida: cola(`${tr.stdout ?? ""}\n${tr.stderr ?? ""}`) } : {}) };
  }
  return null;
}

/** Guarda un paso como archivo atómico propio (no compite con otros pasos del mismo agente). */
export function guardarPaso(cfg, agentId, paso) {
  const dir = join(carpeta(cfg), seguro(agentId));
  mkdirSync(dir, { recursive: true });
  escribirAtomico(join(dir, `${String(paso.t).padStart(14, "0")}-${randomBytes(3).toString("hex")}.json`), JSON.stringify(paso));
}

/** Pila vacía de un agente. */
const vacia = (id) => ({ id, tipo: "", tarea: null, contrato: null, inicio: null, pasos: 0, leidos: {}, editados: {}, comandos: [], ultimaHerramienta: null, avance: [] });

/** Aplica un paso a una pila (puro). */
export function aplicar(pila, p) {
  const q = { ...pila, pasos: pila.pasos + 1, ultimaHerramienta: p.tool, inicio: pila.inicio ?? p.t, tipo: pila.tipo || p.tipo, tarea: pila.tarea ?? p.tarea ?? null };
  if (p.leido) q.leidos = { ...q.leidos, [p.leido]: { hash: p.hash, t: p.t } };
  if (p.editado) {
    const prev = q.editados[p.editado] ?? { mas: 0, menos: 0, veces: 0 };
    q.editados = { ...q.editados, [p.editado]: { mas: prev.mas + (p.mas ?? 0), menos: prev.menos + (p.menos ?? 0), veces: prev.veces + 1 } };
  }
  if (p.comando) q.comandos = [...q.comandos, { comando: p.comando, codigo: p.codigo, fallo: p.fallo, ms: p.ms, ...(p.salida ? { salida: p.salida } : {}) }].slice(-40);
  if (p.avance) q.avance = [...q.avance, { texto: p.avance, t: p.t }].slice(-20);
  return q;
}

/** Bloqueo simple por carpeta (mkdir es atómico): una sola compactación a la vez. */
function conBloqueo(dir, fn) {
  const lock = `${dir}.lock`;
  for (let i = 0; i < 50; i++) {
    try {
      mkdirSync(lock);
      try {
        return fn();
      } finally {
        rmdirSync(lock);
      }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10_000) rmdirSync(lock); // bloqueo abandonado
      } catch {
        /* ya no está */
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  return fn();
}

/** Pila compactada de un agente: lo guardado + los pasos nuevos (que se integran y se borran). */
export function leerPila(cfg, agentId) {
  const id = seguro(agentId);
  const dir = join(carpeta(cfg), id);
  const file = join(carpeta(cfg), `${id}.json`);
  return conBloqueo(dir, () => {
    let pila;
    try {
      pila = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      pila = vacia(agentId);
    }
    let nombres = [];
    try {
      nombres = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
    } catch {
      return pila;
    }
    if (!nombres.length) return pila;
    for (const n of nombres) {
      try {
        pila = aplicar(pila, JSON.parse(readFileSync(join(dir, n), "utf8")));
      } catch {
        /* paso a medio escribir: se ignora */
      }
    }
    mkdirSync(carpeta(cfg), { recursive: true });
    escribirAtomico(file, JSON.stringify(pila, null, 2));
    for (const n of nombres) rmSync(join(dir, n), { force: true });
    return pila;
  });
}

/** Archivos leídos que siguen iguales y los que cambiaron desde que se leyeron. */
export function estadoLeidos(cfg, pila) {
  const iguales = [];
  const cambiaron = [];
  for (const [f, { hash }] of Object.entries(pila.leidos)) {
    if (pila.editados[f]) continue; // lo editó el propio agente: va en «editados»
    const ahora = hashArchivo(isAbsolute(f) ? f : join(cfg.root, f));
    (ahora && ahora === hash ? iguales : cambiaron).push(f);
  }
  return { iguales, cambiaron };
}

/** Texto corto de una pila (≤ ~60 líneas) para un prompt nuevo. */
export function resumen(cfg, pila, { agente = null } = {}) {
  const { iguales, cambiaron } = estadoLeidos(cfg, pila);
  const fallidos = pila.comandos.filter((c) => c.fallo).slice(-3);
  const editados = Object.entries(pila.editados);
  const mins = agente ? Math.round(((agente.ultimoPaso ?? Date.now()) - agente.inicio) / 60000) : null;
  const out = [
    `Agente ${pila.id}${pila.tipo ? ` (${pila.tipo})` : ""}${pila.tarea ? ` · tarea ${pila.tarea}` : ""} · ${pila.pasos} pasos${mins !== null ? ` · ${mins} min` : ""} · última herramienta: ${pila.ultimaHerramienta ?? "—"}`,
    "Avance (lo que escribió el agente):",
    ...(pila.avance.length ? pila.avance.slice(-5).map((a) => `- ${a.texto}`) : ["- (no escribió avance)"]),
    `Editados (${editados.length}):`,
    ...editados.slice(0, 15).map(([f, e]) => `- ${f} (+${e.mas} −${e.menos}${e.veces > 1 ? `, ${e.veces} veces` : ""})`),
    ...(editados.length > 15 ? [`- … y ${editados.length - 15} más`] : []),
    `Leídos que siguen iguales (${iguales.length}): no los releas salvo que necesites un detalle.`,
    ...iguales.slice(0, 12).map((f) => `- ${f}`),
    ...(iguales.length > 12 ? [`- … y ${iguales.length - 12} más`] : []),
    `Leídos que cambiaron desde entonces (${cambiaron.length}): reléelos.`,
    ...cambiaron.slice(0, 10).map((f) => `- ${f} (cambió desde que se leyó)`),
    `Comandos que fallaron (${fallidos.length}):`,
    ...fallidos.flatMap((c) => [`- \`${c.comando.slice(0, 120)}\`${c.codigo !== null && c.codigo !== undefined ? ` (código ${c.codigo})` : ""}`, ...(c.salida ? c.salida.split("\n").slice(-5).map((l) => `    ${l.slice(0, 160)}`) : [])]),
  ];
  return out.slice(0, 60).join("\n");
}

const archivoReenfundados = (cfg) => join(carpeta(cfg), "reenfundados.json");

/**
 * Mensaje completo para lanzar el reemplazo de un subagente cortado (una vez por tarea, o por agente si
 * no es del modo director). Devuelve { mensaje, clave, intento } o lanza si ya se re-enfundó.
 */
export function reenfundar(cfg, agentId, ahora = Date.now()) {
  const pila = leerPila(cfg, agentId);
  const agente = leerAgentes(cfg)[agentId] ?? null;
  const tareas = leerTareas(cfg);
  const tarea = pila.tarea ? tareas.find((t) => t.id === pila.tarea) : null;
  const clave = pila.tarea ?? agentId;
  let hechos = {};
  try {
    hechos = JSON.parse(readFileSync(archivoReenfundados(cfg), "utf8"));
  } catch {
    hechos = {};
  }
  if ((hechos[clave] ?? 0) >= 1) throw new Error(`«${clave}» ya se re-enfundó una vez: no se repite. Informa al usuario con lo que hay (pilas.mjs resumen --agente ${agentId}).`);
  const tipo = pila.tipo || agente?.tipo || "";
  const maxPasos = clase(tipo) === "fantasma" ? cfg.fantasmas?.maxPasos ?? 15 : clase(tipo) === "especialista" ? cfg.hotel?.maxPasos ?? 8 : cfg.ciclo?.maxPasos?.[clase(tipo)] ?? cfg.ciclo?.maxPasos?.otro ?? 40;
  const maxSeg = agente?.maxSeg ?? maxSegDe(cfg, tipo);
  const usadoSeg = agente ? Math.round(((agente.ultimoPaso ?? ahora) - agente.inicio) / 1000) : 0;
  const pasosRest = Math.max(5, maxPasos - pila.pasos);
  const segRest = Math.max(60, maxSeg - usadoSeg);
  const contrato = tarea?.contrato ?? pila.contrato ?? "(sin contrato guardado: usa el objetivo del mensaje original)";
  const falta = pila.avance.length ? pila.avance[pila.avance.length - 1].texto : "(el agente no dejó escrito qué faltaba: revísalo contra el contrato)";
  const mensaje = [
    "Retomas el trabajo de un agente anterior que se cortó. No empieces de cero: sigue desde donde quedó.",
    "",
    contrato,
    ...(tarea ? ["", `Trabaja en el MISMO worktree de la tarea (lo editado sigue ahí): ${tarea.repos.map((r) => `${r.nombre}: ${r.ruta}`).join(" · ")}`] : []),
    "",
    "## Lo que ya hizo el agente anterior",
    resumen(cfg, pila, { agente }),
    "",
    "## Lo que falta",
    `- ${falta}`,
    "",
    `## Presupuesto restante: ${pasosRest} pasos y ${Math.round(segRest / 60)} min (no el completo). Si llegas, entrega lo que tengas.`,
  ].join("\n");
  hechos[clave] = (hechos[clave] ?? 0) + 1;
  mkdirSync(carpeta(cfg), { recursive: true });
  escribirAtomico(archivoReenfundados(cfg), JSON.stringify(hechos, null, 2));
  return { mensaje, clave, intento: 2, descripcion: `${tarea?.id ?? (tipo.replace(/^neurodanza:/, "") || "agente")} ↻ 2` };
}

export function limpiar(cfg) {
  rmSync(carpeta(cfg), { recursive: true, force: true });
}

// ───────────────────────── CLI ─────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  let event = null;
  if (cmd === "guardar") {
    try {
      event = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      process.exit(0);
    }
  }
  const cfg = loadConfig(event?.cwd ?? process.cwd());
  if (!cfg) {
    if (cmd === "guardar") process.exit(0);
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  try {
    if (cmd === "guardar") {
      if (!event?.agent_id) process.exit(0);
      const p = pasoDe(cfg, event, Date.now(), leerTareas(cfg));
      if (p) guardarPaso(cfg, event.agent_id, p);
    } else if (cmd === "avance") {
      // El hook PostToolUse de esta misma llamada guarda el texto en la pila de quien la hizo.
      console.log(arg("texto") ? "avance anotado" : 'Uso: pilas.mjs avance --texto "<qué hice, qué falta>"');
    } else if (cmd === "ver") console.log(JSON.stringify(leerPila(cfg, arg("agente") ?? ""), null, 2));
    else if (cmd === "resumen") {
      const id = arg("agente") ?? "";
      console.log(resumen(cfg, leerPila(cfg, id), { agente: leerAgentes(cfg)[id] }));
    } else if (cmd === "reenfundar") {
      const r = reenfundar(cfg, arg("agente") ?? "");
      console.log(`${r.mensaje}\n\n<!-- descripción sugerida para el nuevo agente: ${r.descripcion} -->`);
    } else if (cmd === "limpiar") {
      limpiar(cfg);
      console.log("pilas borradas");
    } else {
      console.error("Uso: pilas.mjs avance --texto … | ver --agente <id> | resumen --agente <id> | reenfundar --agente <id> | limpiar");
      process.exit(1);
    }
  } catch (e) {
    console.error(`pilas: ${e.message}`);
    process.exit(1);
  }
}

