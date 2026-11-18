#!/usr/bin/env node
// neurodanza · constructos: agentes que acumulan experiencia en el proyecto, con freno.
// Cada constructo (implementador-frontend, revisor-ui, …) tiene lecciones que nacen de la reflexión al
// cerrar un ciclo (problemas que encontraron los jueces) y pasan por: candidata → a prueba → aprobada o
// descartada. Una lección a prueba solo se aprueba si el problema que ataca aparece menos por ciclo
// (y, para revisores y personas, si las evals posteriores no empeoran). Ver docs/14-constructos.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node constructos.mjs reflexion --archivo <json>          registra un ciclo y evalúa las lecciones a prueba
//   node constructos.mjs playbook --constructo <nombre>      lecciones para el mensaje o el contrato del agente
//   node constructos.mjs estado [--constructo <nombre>]      lecciones por estado
//   node constructos.mjs evaluar                             evalúa las lecciones a prueba
//   node constructos.mjs probar|descartar|archivar --constructo <n> --etiqueta <e> [--motivo "…"]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

export const OPCIONES = { minEvidencias: 2, ciclosPrueba: 3, maxLecciones: 30, automatico: true };
const ACTIVAS = new Set(["a prueba", "aprobada"]);

/** Etiqueta válida: `area:tema` en minúsculas (p. ej. `ui:aria-label-icono`). */
export const etiquetaValida = (e) => /^[a-z0-9-]+:[a-z0-9-]+$/.test(String(e ?? ""));

const vacio = () => ({ constructos: {}, ciclos: [] });
const constructo = (data, nombre) => (data.constructos[nombre] ??= { lecciones: [], cambios: [] });

/** Ciclos en los que participó un constructo (como agente o con problemas), en orden. */
const ciclosDe = (data, nombre) => data.ciclos.filter((c) => (c.constructos ?? []).includes(nombre));
const veces = (ciclo, nombre, etiqueta) => ciclo.problemas?.[nombre]?.[etiqueta] ?? 0;

function cambio(c, l, a, motivo, fecha) {
  l.estado = a;
  l.actualizada = fecha;
  if (motivo) l.motivo = motivo;
  c.cambios.push({ fecha, etiqueta: l.etiqueta, estado: a, motivo: motivo ?? "" });
}

/**
 * Registra la reflexión de un ciclo (puro sobre `data`). `reflexion` =
 * { ciclo, version?, agentes: [{ constructo, pasos?, terminado? }], problemas: [{ constructo, etiqueta, fuente, detalle, leccion }] }.
 * Devuelve los cambios de estado de las lecciones.
 */
export function aplicarReflexion(data, reflexion, opciones = {}, fecha = new Date().toISOString()) {
  const o = { ...OPCIONES, ...opciones };
  const problemas = (reflexion.problemas ?? []).filter((p) => p.constructo && etiquetaValida(p.etiqueta));
  const participantes = new Set([...(reflexion.agentes ?? []).map((a) => a.constructo), ...problemas.map((p) => p.constructo)].filter(Boolean));
  const ciclo = { ciclo: String(reflexion.ciclo ?? fecha), fecha, version: reflexion.version ?? "", constructos: [...participantes], problemas: {}, agentes: reflexion.agentes ?? [] };
  for (const p of problemas) {
    const porC = (ciclo.problemas[p.constructo] ??= {});
    porC[p.etiqueta] = (porC[p.etiqueta] ?? 0) + 1;
  }
  data.ciclos.push(ciclo);
  const cambios = [];
  for (const p of problemas) {
    const c = constructo(data, p.constructo);
    let l = c.lecciones.find((x) => x.etiqueta === p.etiqueta);
    if (!l) {
      l = { etiqueta: p.etiqueta, texto: String(p.leccion ?? "").trim() || p.etiqueta, estado: "candidata", creada: fecha, evidencias: [] };
      c.lecciones.push(l);
    } else if (p.leccion && l.estado === "candidata") l.texto = String(p.leccion).trim();
    l.evidencias.push({ ciclo: ciclo.ciclo, fuente: p.fuente ?? "", detalle: String(p.detalle ?? "").slice(0, 300), fecha });
    if (o.automatico && l.estado === "candidata" && l.evidencias.length >= o.minEvidencias) {
      l.desde = fecha;
      l.cicloDesde = data.ciclos.length; // los ciclos desde este índice cuentan como "después"
      cambio(c, l, "a prueba", `${l.evidencias.length} evidencias`, fecha);
      cambios.push({ constructo: p.constructo, etiqueta: l.etiqueta, estado: "a prueba" });
    }
  }
  return cambios;
}

/**
 * Juicio de una lección a prueba (puro). Compara cuántas veces por ciclo aparece su problema antes
 * (desde la primera evidencia) y después de entrar a prueba. `evals` = { antes, despues } (informes)
 * se exige para revisores y personas: aprobado, detección ≥ y falsos positivos ≤ que antes.
 * @returns {{ decision: "aprobada"|"descartada"|"sigue", motivo: string }}
 */
export function juzgar(data, nombre, l, opciones = {}, evals = null) {
  const o = { ...OPCIONES, ...opciones };
  const suyos = ciclosDe(data, nombre);
  const idx = (c) => data.ciclos.indexOf(c);
  const despues = suyos.filter((c) => idx(c) >= l.cicloDesde);
  if (despues.length < o.ciclosPrueba) return { decision: "sigue", motivo: `${despues.length}/${o.ciclosPrueba} ciclos a prueba` };
  const primera = data.ciclos.findIndex((c) => c.ciclo === l.evidencias[0]?.ciclo);
  const antes = suyos.filter((c) => idx(c) >= Math.max(0, primera) && idx(c) < l.cicloDesde);
  const tasa = (cs) => cs.reduce((n, c) => n + veces(c, nombre, l.etiqueta), 0) / Math.max(1, cs.length);
  const ta = tasa(antes);
  const td = tasa(despues.slice(0, o.ciclosPrueba));
  const resumen = `${ta.toFixed(2)} → ${td.toFixed(2)} por ciclo`;
  if (/^(revisor-|persona)/.test(nombre)) {
    if (!evals?.despues) return { decision: "sigue", motivo: `${resumen}; falta correr /neurodanza-evals con la lección` };
    const d = evals.despues.informe ?? {};
    const a = evals.antes?.informe ?? null;
    const peor = !d.aprobado || (a && (d.deteccion < a.deteccion || d.falsosPositivos > a.falsosPositivos));
    if (peor) return { decision: "descartada", motivo: `${resumen}; las evals empeoraron o no pasaron` };
  }
  if (td < ta) return { decision: "aprobada", motivo: resumen };
  return { decision: "descartada", motivo: `${resumen}: no bajó` };
}

/** Informes de evals (antes y después de una fecha) del proyecto. */
function informesEvals(cfg, desde) {
  const dir = cfg.abs(cfg.evals.informes);
  if (!dir || !existsSync(dir)) return null;
  const todos = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
        return j.informe ? { ...j, fecha: j.fecha ?? "" } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)));
  return { antes: todos.filter((x) => x.fecha < desde).pop() ?? null, despues: todos.filter((x) => x.fecha >= desde).pop() ?? null };
}

/** Evalúa todas las lecciones a prueba y aplica el tope del playbook (sobre `data`). */
export function evaluarTodo(data, opciones = {}, evalsDe = () => null, fecha = new Date().toISOString()) {
  const o = { ...OPCIONES, ...opciones };
  const cambios = [];
  for (const [nombre, c] of Object.entries(data.constructos)) {
    for (const l of c.lecciones.filter((x) => x.estado === "a prueba")) {
      const j = juzgar(data, nombre, l, o, evalsDe(l.desde));
      l.ultimoJuicio = j.motivo;
      if (j.decision === "sigue") continue;
      cambio(c, l, j.decision, j.motivo, fecha);
      cambios.push({ constructo: nombre, etiqueta: l.etiqueta, estado: j.decision, motivo: j.motivo });
    }
    // Tope: si hay demasiadas activas, se archivan las aprobadas con menos evidencias.
    const activas = c.lecciones.filter((x) => ACTIVAS.has(x.estado));
    if (activas.length > o.maxLecciones) {
      const sobran = activas
        .filter((x) => x.estado === "aprobada")
        .sort((a, b) => a.evidencias.length - b.evidencias.length || String(a.actualizada).localeCompare(String(b.actualizada)))
        .slice(0, activas.length - o.maxLecciones);
      for (const l of sobran) {
        cambio(c, l, "archivada", `tope de ${o.maxLecciones} lecciones`, fecha);
        cambios.push({ constructo: nombre, etiqueta: l.etiqueta, estado: "archivada" });
      }
    }
  }
  return cambios;
}

/** Texto del playbook de un constructo: aprobadas y a prueba (para el contrato o el mensaje). */
export function playbookTexto(data, nombre) {
  const c = data.constructos[nombre];
  const activas = (c?.lecciones ?? []).filter((l) => ACTIVAS.has(l.estado));
  if (!activas.length) return "";
  return [
    `Lecciones de este proyecto para ${nombre} (aprendidas de ciclos anteriores; aplícalas):`,
    ...activas.map((l) => `- ${l.texto}${l.estado === "a prueba" ? " (a prueba)" : ""} [${l.etiqueta}]`),
  ].join("\n");
}

// ───────────────────────── archivos ─────────────────────────

export const carpetaDe = (cfg) => cfg.abs(cfg.constructos?.carpeta ?? ".neurodanza/constructos");
const archivoDe = (cfg) => join(carpetaDe(cfg), "constructos.json");

export function cargar(cfg) {
  try {
    const d = JSON.parse(readFileSync(archivoDe(cfg), "utf8"));
    return { ...vacio(), ...d };
  } catch {
    return vacio();
  }
}

/** Guarda el JSON y, por constructo, su `playbook.md` y `CHANGELOG.md` legibles. */
export function guardar(cfg, data) {
  const dir = carpetaDe(cfg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(archivoDe(cfg), JSON.stringify(data, null, 2) + "\n");
  for (const [nombre, c] of Object.entries(data.constructos)) {
    const d = join(dir, nombre);
    mkdirSync(d, { recursive: true });
    const por = (e) => c.lecciones.filter((l) => l.estado === e);
    const seccion = (titulo, ls) => (ls.length ? [`## ${titulo}`, ...ls.map((l) => `- ${l.texto} \`${l.etiqueta}\` · ${l.evidencias.length} evidencias${l.ultimoJuicio ? ` · ${l.ultimoJuicio}` : ""}`), ""] : []);
    const md = [`# ${nombre}`, "", `${ciclosDe(data, nombre).length} ciclos registrados.`, "", ...seccion("Aprobadas", por("aprobada")), ...seccion("A prueba", por("a prueba")), ...seccion("Candidatas", por("candidata")), ...seccion("Descartadas", por("descartada")), ...seccion("Archivadas", por("archivada"))];
    writeFileSync(join(d, "playbook.md"), md.join("\n"));
    const log = ["# Cambios", "", ...[...c.cambios].reverse().map((x) => `- ${x.fecha.slice(0, 10)} · \`${x.etiqueta}\` → **${x.estado}**${x.motivo ? ` (${x.motivo})` : ""}`), ""];
    writeFileSync(join(d, "CHANGELOG.md"), log.join("\n"));
  }
}

// ───────────────────────── CLI ─────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const o = { ...OPCIONES, ...(cfg.constructos ?? {}) };
  const data = cargar(cfg);
  const evalsDe = (desde) => informesEvals(cfg, desde ?? "");
  const cmd = process.argv[2];
  try {
    if (cmd === "reflexion") {
      const f = arg("archivo");
      if (!f) throw new Error("reflexion: falta --archivo <json>");
      const r = JSON.parse(readFileSync(f, "utf8"));
      const malas = (r.problemas ?? []).filter((p) => !etiquetaValida(p.etiqueta)).map((p) => p.etiqueta);
      const cambios = [...aplicarReflexion(data, r, o), ...evaluarTodo(data, o, evalsDe)];
      guardar(cfg, data);
      console.log(JSON.stringify({ ciclo: r.ciclo, problemas: (r.problemas ?? []).length, cambios, ...(malas.length ? { ignoradas: malas, nota: "etiqueta inválida: usa area:tema en minúsculas" } : {}) }, null, 2));
    } else if (cmd === "evaluar") {
      const cambios = evaluarTodo(data, o, evalsDe);
      guardar(cfg, data);
      console.log(JSON.stringify(cambios, null, 2));
    } else if (cmd === "playbook") {
      console.log(playbookTexto(data, arg("constructo") ?? "") || "(sin lecciones todavía)");
    } else if (cmd === "estado") {
      const solo = arg("constructo");
      for (const [nombre, c] of Object.entries(data.constructos)) {
        if (solo && nombre !== solo) continue;
        const n = (e) => c.lecciones.filter((l) => l.estado === e).length;
        console.log(`${nombre}: ${n("aprobada")} aprobadas · ${n("a prueba")} a prueba · ${n("candidata")} candidatas · ${n("descartada")} descartadas · ${ciclosDe(data, nombre).length} ciclos`);
        for (const l of c.lecciones.filter((x) => x.estado !== "archivada")) console.log(`  [${l.estado}] ${l.etiqueta} · ${l.evidencias.length} ev. · ${l.texto}${l.ultimoJuicio ? ` (${l.ultimoJuicio})` : ""}`);
      }
      if (!Object.keys(data.constructos).length) console.log("sin constructos todavía: se crean con la reflexión al cerrar un ciclo");
    } else if (["probar", "descartar", "archivar"].includes(cmd)) {
      const c = data.constructos[arg("constructo") ?? ""];
      const l = c?.lecciones.find((x) => x.etiqueta === arg("etiqueta"));
      if (!l) throw new Error(`no encontré la lección ${arg("etiqueta")} en ${arg("constructo")}`);
      const estado = { probar: "a prueba", descartar: "descartada", archivar: "archivada" }[cmd];
      if (estado === "a prueba") {
        l.desde = new Date().toISOString();
        l.cicloDesde = data.ciclos.length;
      }
      cambio(c, l, estado, arg("motivo") ?? "a mano", new Date().toISOString());
      guardar(cfg, data);
      console.log(`${arg("constructo")} · ${l.etiqueta} → ${estado}`);
    } else {
      console.error("Uso: constructos.mjs reflexion --archivo <json> | playbook --constructo <n> | estado [--constructo <n>] | evaluar | probar|descartar|archivar --constructo <n> --etiqueta <e> [--motivo …]");
      process.exit(1);
    }
  } catch (e) {
    console.error(`constructos: ${e.message}`);
    process.exit(1);
  }
}
