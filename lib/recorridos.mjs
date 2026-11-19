#!/usr/bin/env node
// neurodanza · recorridos (Tenet): antes de implementar, cada persona del panel escribe su recorrido futuro,
// una lista de pasos verificables que el usuario aprueba junto con el plan. Lo aprobado se congela con su
// hash, entra en el contrato del implementador como criterio de terminado y es lo primero que la persona
// ejecuta en el panel (`panel.mjs navegar --recorrido`). Los permanentes guardan su memoria por versión
// (Westworld) y `panel.mjs comparar` marca regresiones de experiencia. Ver docs/18-panel-con-recorridos.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node recorridos.mjs guardar --ciclo <c> --archivo <json>          valida y guarda el recorrido de una persona
//   node recorridos.mjs plan --ciclo <c>                               texto para el plan (lo aprueba el usuario)
//   node recorridos.mjs aprobar --ciclo <c> [--permanentes id1,id2]    congela con hash; los permanentes van a git
//   node recorridos.mjs contrato --ciclo <c> [--personas a,b]          sección para el contrato del implementador
//   node recorridos.mjs verificar --archivo <json>                     ¿el congelado coincide con su hash?
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { escribirAtomico as atomico } from "./procesos.mjs";

/** Acciones de un paso (las mismas de `panel.mjs navegar --acciones`). */
export const ACCIONES = ["click", "elegir", "llenar", "tecla", "esperar"];
/** Qué puede verificar la `espera` de un paso. */
export const ESPERAS = ["texto", "elemento", "url", "mensaje"];
/** Resultado de cada paso según la persona. */
export const RESULTADOS = ["cumple", "cumple con fricción", "no cumple"];

const idValido = (s) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(s ?? ""));
const accionDe = (p) => ACCIONES.find((a) => p[a] !== undefined && p[a] !== null && p[a] !== "");

/** Errores de formato de un recorrido (vacío = válido). */
export function validarRecorrido(r) {
  const e = [];
  if (!r || typeof r !== "object") return ["el recorrido debe ser un objeto"];
  if (!idValido(r.id)) e.push("id: minúsculas, números y guiones (estable: identifica el recorrido entre versiones)");
  if (!r.persona) e.push("persona: id del elenco");
  if (!r.tarea) e.push("tarea: qué quiere lograr la persona, en una línea");
  if (!(Number.isInteger(r.maxClics) && r.maxClics >= 1)) e.push("maxClics: entero ≥ 1");
  if (!(Number.isFinite(r.maxSegundos) && r.maxSegundos > 0)) e.push("maxSegundos: número > 0");
  if (!Array.isArray(r.pasos) || r.pasos.length === 0) e.push("pasos: al menos uno");
  (r.pasos ?? []).forEach((p, i) => {
    const n = `pasos[${i + 1}]`;
    const acciones = ACCIONES.filter((a) => p?.[a] !== undefined);
    if (acciones.length > 1) e.push(`${n}: una sola acción por paso (tiene ${acciones.join(", ")})`);
    if (!acciones.length && !p?.ruta) e.push(`${n}: necesita una ruta o una acción (${ACCIONES.join(", ")})`);
    if (p?.elegir !== undefined && !p.opcion) e.push(`${n}: elegir necesita opcion`);
    if (p?.llenar !== undefined && p.valor === undefined) e.push(`${n}: llenar necesita valor`);
    const esp = p?.espera;
    if (!esp || typeof esp !== "object" || !ESPERAS.some((k) => esp[k])) e.push(`${n}: espera con ${ESPERAS.join(", ")} (qué debe ver al final del paso)`);
    if (!p?.porQue) e.push(`${n}: porQue (qué le importa a la persona de este paso)`);
  });
  return e;
}

/** Lo que se congela: el recorrido sin sus metadatos de aprobación. */
const contenido = (r) => ({ id: r.id, persona: r.persona, tarea: r.tarea, maxClics: r.maxClics, maxSegundos: r.maxSegundos, pasos: r.pasos });
/** Hash estable del recorrido (claves ordenadas). */
export function hashRecorrido(r) {
  const ordenar = (v) => (Array.isArray(v) ? v.map(ordenar) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])])) : v);
  return createHash("sha256").update(JSON.stringify(ordenar(contenido(r)))).digest("hex").slice(0, 16);
}
export const congelar = (r, fecha = new Date().toISOString()) => ({ ...r, congelado: { hash: hashRecorrido(r), fecha } });
/** ¿Sigue igual que cuando se aprobó? (sin congelar: false). */
export const verificarCongelado = (r) => !!r?.congelado?.hash && r.congelado.hash === hashRecorrido(r);

/** Clics que pide un paso: click = 1, elegir = 2 (abrir la lista y la opción). */
export const clicsDe = (p) => (p.click !== undefined ? 1 : p.elegir !== undefined ? 2 : 0);
export const clicsTotales = (r) => r.pasos.reduce((n, p) => n + clicsDe(p), 0);
/** ¿El paso es crítico? Marcado con `critico`; si ninguno lo está, el último (lograr la tarea). */
export const esCritico = (r, i) => (r.pasos.some((p) => p.critico !== undefined) ? !!r.pasos[i]?.critico : i === r.pasos.length - 1);

/** Texto corto de un paso («click en Exportar», «ir a /pedidos»…). */
export function textoPaso(p) {
  const partes = [];
  if (p.ruta) partes.push(`ir a ${p.ruta}`);
  if (p.click !== undefined) partes.push(`click en «${p.click}»`);
  if (p.elegir !== undefined) partes.push(`elegir «${p.opcion}» en «${p.elegir}»`);
  if (p.llenar !== undefined) partes.push(`llenar «${p.llenar}» con «${p.valor}»`);
  if (p.tecla !== undefined) partes.push(`tecla ${p.tecla}`);
  if (p.esperar !== undefined) partes.push(`esperar ${p.esperar} ms`);
  return partes.join(" y ");
}
const textoEspera = (e = {}) => (e.url ? `estar en ${e.url}` : e.elemento ? `ver «${e.elemento}»` : `ver «${e.texto ?? e.mensaje}»`);

/** El recorrido en el formato de `--acciones` (compatibilidad con `navegar` sin recorrido). */
export function aAcciones(r) {
  const out = [];
  for (const p of r.pasos) {
    if (p.ruta || !out.length) out.push({ ruta: p.ruta ?? "/", pasos: [] });
    const a = accionDe(p);
    if (a) out.at(-1).pasos.push(Object.fromEntries(Object.entries(p).filter(([k]) => ACCIONES.includes(k) || ["opcion", "valor", "exacto", "captura"].includes(k))));
  }
  return out;
}

/**
 * Ejecuta un recorrido con un navegador (Playwright en `panel.mjs`, HTTP en el banco de pruebas). El navegador
 * cumple: `ir(ruta)`, `click(nombre, {exacto})`, `elegir(lista, opcion, {exacto})`, `llenar(etiqueta, valor)`,
 * `tecla(k)`, `esperar(ms)`, `cumple(espera)` → { ok, encontrado } y `errores()` → lista acumulada (consola,
 * HTTP con error). Registra por paso clics, campos, tiempo, errores nuevos y si se cumplió la espera.
 */
export async function ejecutarRecorrido(nav, r, { reloj = () => Date.now() } = {}) {
  const pasos = [];
  const t0 = reloj();
  for (const [i, p] of r.pasos.entries()) {
    const ti = reloj();
    const antes = nav.errores().length;
    const fila = { n: i + 1, paso: textoPaso(p), clics: clicsDe(p), campos: p.llenar !== undefined ? 1 : 0, critico: esCritico(r, i), esperado: textoEspera(p.espera) };
    try {
      if (p.ruta) await nav.ir(p.ruta);
      if (p.click !== undefined) await nav.click(String(p.click), { exacto: !!p.exacto });
      else if (p.elegir !== undefined) await nav.elegir(String(p.elegir), String(p.opcion), { exacto: !!p.exacto });
      else if (p.llenar !== undefined) await nav.llenar(String(p.llenar), String(p.valor ?? ""));
      else if (p.tecla !== undefined) await nav.tecla(String(p.tecla));
      else if (p.esperar !== undefined) await nav.esperar(Number(p.esperar));
      const c = await nav.cumple(p.espera ?? {});
      fila.cumple = !!c.ok;
      fila.encontrado = c.encontrado ?? "";
    } catch (e) {
      fila.cumple = false;
      fila.error = String(e?.message ?? e).split("\n")[0].slice(0, 200);
      fila.encontrado = fila.error;
    }
    fila.errores = nav.errores().slice(antes);
    fila.ms = reloj() - ti;
    // El navegador puede guardar una captura por paso (el panel lo hace; el banco no).
    try {
      if (nav.despues) await nav.despues(fila);
    } catch {
      /* la captura es una ayuda */
    }
    pasos.push(fila);
  }
  const suma = (k) => pasos.reduce((n, p) => n + (typeof p[k] === "number" ? p[k] : p[k].length), 0);
  const totales = { pasos: pasos.length, clics: suma("clics"), campos: suma("campos"), ms: reloj() - t0, errores: suma("errores"), cumplidos: pasos.filter((p) => p.cumple).length, fallidos: pasos.filter((p) => !p.cumple).length };
  totales.dentroDeLimites = totales.clics <= r.maxClics && totales.ms <= r.maxSegundos * 1000;
  return { id: r.id, persona: r.persona, hash: r.congelado?.hash ?? hashRecorrido(r), pasos, totales };
}

// ───────────────────────── calificación por pasos ─────────────────────────

/**
 * Nota de una persona con detalle por paso (`e.pasos`: [{ n, resultado, motivo, critico? }]). Un paso crítico
 * que no cumple (según la persona o según la ejecución mecánica) limita la nota a `notaMax`. Puro.
 * Devuelve { nota, limitada, motivo }.
 */
export function notaPorPasos(e, notaMax = 6, recorrido = null, ejecucion = null) {
  const nota = Number(e.nota);
  const fallidos = [];
  const n = Math.max(e.pasos?.length ?? 0, ejecucion?.pasos?.length ?? 0, recorrido?.pasos?.length ?? 0);
  for (let i = 0; i < n; i++) {
    const p = e.pasos?.find((x) => Number(x.n) === i + 1) ?? e.pasos?.[i];
    const critico = p?.critico ?? ejecucion?.pasos?.[i]?.critico ?? (recorrido ? esCritico(recorrido, i) : false);
    const noCumple = p?.resultado === "no cumple" || ejecucion?.pasos?.[i]?.cumple === false;
    if (critico && noCumple) fallidos.push(i + 1);
  }
  if (!fallidos.length || !Number.isFinite(nota) || nota <= notaMax) return { nota, limitada: false, motivo: "" };
  return { nota: notaMax, limitada: true, motivo: `paso crítico ${fallidos.join(", ")} no cumple: nota máxima ${notaMax}` };
}

// ───────────────────────── archivos ─────────────────────────

function escribirAtomico(file, texto) {
  mkdirSync(dirname(file), { recursive: true });
  atomico(file, texto);
}
const leerJson = (f) => JSON.parse(readFileSync(f, "utf8"));
export const carpetaCiclo = (cfg, ciclo) => cfg.abs(join(".neurodanza", "recorridos", String(ciclo).replace(/[^\w.-]+/g, "-")));
export const carpetaPermanentes = (cfg) => cfg.abs(cfg.panel?.recorridos ?? ".claude/personas/recorridos");

/** Valida y guarda el recorrido de una persona en `.neurodanza/recorridos/<ciclo>/<persona>.json`. */
export function guardarRecorrido(cfg, ciclo, r) {
  const errores = validarRecorrido(r);
  if (errores.length) return { ok: false, errores };
  const file = join(carpetaCiclo(cfg, ciclo), `${r.persona}.json`);
  if (existsSync(file) && verificarCongelado(leerJson(file))) return { ok: false, errores: ["ya está aprobado (congelado): para cambiarlo, empieza otro ciclo"] };
  escribirAtomico(file, JSON.stringify(r, null, 2) + "\n");
  return { ok: true, archivo: file };
}

export function recorridosDe(cfg, ciclo) {
  const dir = carpetaCiclo(cfg, ciclo);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ archivo: join(dir, f), ...leerJson(join(dir, f)) }));
}

/** Busca un recorrido por id: primero los permanentes, luego un archivo dado. */
export function leerRecorrido(cfg, idOArchivo) {
  if (existsSync(idOArchivo)) return leerJson(idOArchivo);
  const f = join(carpetaPermanentes(cfg), `${idOArchivo}.json`);
  return existsSync(f) ? leerJson(f) : null;
}

/**
 * Aprueba los recorridos del ciclo: los congela con su hash. Los `permanentes` (ids) se copian a
 * `panel.recorridos` (en git) para compararlos entre versiones.
 */
export function aprobarRecorridos(cfg, ciclo, { permanentes = [], fecha = new Date().toISOString() } = {}) {
  const out = [];
  for (const r of recorridosDe(cfg, ciclo)) {
    const { archivo, ...rec } = r;
    const errores = validarRecorrido(rec);
    if (errores.length) {
      out.push({ id: rec.id, persona: rec.persona, ok: false, errores });
      continue;
    }
    const permanente = permanentes.includes(rec.id) || rec.permanente === true;
    const c = congelar({ ...rec, ...(permanente ? { permanente: true } : {}) }, fecha);
    escribirAtomico(archivo, JSON.stringify(c, null, 2) + "\n");
    if (permanente) escribirAtomico(join(carpetaPermanentes(cfg), `${c.id}.json`), JSON.stringify(c, null, 2) + "\n");
    out.push({ id: c.id, persona: c.persona, ok: true, hash: c.congelado.hash, archivo, permanente });
  }
  return out;
}

/** Texto del recorrido para el plan (el usuario lo aprueba o edita). */
export function textoPlan(recs) {
  return recs
    .map((r) => [`### ${r.persona} · ${r.tarea} (\`${r.id}\`, máx. ${r.maxClics} clics y ${r.maxSegundos} s)`, ...r.pasos.map((p, i) => `${i + 1}. ${textoPaso(p)} → debe ${textoEspera(p.espera)}${esCritico(r, i) ? " **(crítico)**" : ""} — ${p.porQue}`)].join("\n"))
    .join("\n\n");
}

/** Sección del contrato del implementador: los recorridos como criterio de terminado. */
export function textoContrato(recs) {
  if (!recs.length) return "";
  return [
    "## Recorridos acordados (criterio de terminado)",
    "Cuando termines, estos pasos deben poder hacerse en la app tal cual (las personas del panel los ejecutan primero):",
    ...recs.map((r) => [`- **${r.persona}** · ${r.tarea} (máx. ${r.maxClics} clics):`, ...r.pasos.map((p, i) => `  ${i + 1}. ${textoPaso(p)} → ${textoEspera(p.espera)}`)].join("\n")),
  ].join("\n");
}

// ───────────────────────── memoria por recorrido (Westworld) ─────────────────────────
// Por cada recorrido permanente, el historial por versión de la app (en git, para que la comparación sea
// compartida): versión, fecha, persona, métricas por paso y totales. Se compara con la última versión aprobada.

export const UMBRALES_REGRESION = { clics: 1, tiempo: 0.3 };
/** Cuánto baja la nota cada regresión (y el tope total). Ver docs/18-panel-con-recorridos.md. */
export const DESCUENTOS = { paso: 2, errores: 1, clics: 1, tiempo: 0.5, tope: 3 };

export const archivoMemoria = (cfg, id) => cfg.abs(join(cfg.panel?.memoria ?? ".claude/personas/memoria", `${id}.json`));
export function leerMemoria(cfg, id) {
  const f = archivoMemoria(cfg, id);
  try {
    return existsSync(f) ? leerJson(f) : { id, historial: [] };
  } catch {
    return { id, historial: [] };
  }
}

/** Entrada de la memoria a partir de una ejecución (solo métricas: sin capturas ni textos de pantalla). */
const entradaDe = (r, ej, { version, persona, aprobado, fecha }) => ({
  version: String(version ?? ""),
  fecha,
  persona: persona ?? r.persona,
  aprobado: !!aprobado,
  hash: ej.hash ?? hashRecorrido(r),
  tarea: r.tarea,
  totales: { pasos: ej.totales.pasos, clics: ej.totales.clics, campos: ej.totales.campos, ms: ej.totales.ms, errores: ej.totales.errores, cumplidos: ej.totales.cumplidos },
  pasos: ej.pasos.map((p) => ({ n: p.n, paso: p.paso, esperado: p.esperado, clics: p.clics, campos: p.campos, ms: p.ms, errores: (p.errores ?? []).length, cumple: !!p.cumple, ...(p.cumple ? {} : { encontrado: String(p.encontrado ?? "").slice(0, 120) }) })),
});

/** Registra una ejecución en la memoria del recorrido (la misma versión y persona se reemplaza). */
export function registrarMemoria(cfg, r, ej, { version, persona, aprobado = false, fecha = new Date().toISOString() } = {}) {
  const m = leerMemoria(cfg, r.id);
  const e = entradaDe(r, ej, { version, persona, aprobado, fecha });
  m.historial = m.historial.filter((x) => !(x.version === e.version && x.persona === e.persona)).concat(e);
  escribirAtomico(archivoMemoria(cfg, r.id), JSON.stringify(m, null, 2) + "\n");
  return e;
}

/** Regresiones de experiencia entre una ejecución base (aprobada) y la actual. Puro. */
export function compararEjecuciones(base, actual, umbrales = UMBRALES_REGRESION) {
  const u = { ...UMBRALES_REGRESION, ...umbrales };
  const regs = [];
  const b = base.totales;
  const a = actual.totales;
  if (a.clics - b.clics >= u.clics) regs.push({ tipo: "clics", antes: b.clics, ahora: a.clics });
  // Tiempo: más de la fracción configurada **y** al menos 1 s más (diferencias de milisegundos son ruido).
  if (b.ms > 0 && a.ms > b.ms * (1 + u.tiempo) && a.ms - b.ms >= 1000) regs.push({ tipo: "tiempo", antes: b.ms, ahora: a.ms });
  for (const pb of base.pasos ?? []) {
    if (!pb.cumple) continue;
    const pa = (actual.pasos ?? []).find((x) => x.esperado === pb.esperado) ?? (actual.pasos ?? []).find((x) => x.n === pb.n);
    if (pa && !pa.cumple) regs.push({ tipo: "paso", paso: pb.esperado, antes: "cumplía", ahora: pa.encontrado ?? "no cumple" });
  }
  if (a.errores > b.errores) regs.push({ tipo: "errores", antes: b.errores, ahora: a.errores });
  return regs;
}

const seg = (ms) => `${Math.round(ms / 100) / 10} s`;
/** Una regresión en la voz de la persona dueña del recorrido. */
export function textoRegresion(reg, tarea, versionAntes) {
  const v = versionAntes ? `En la ${versionAntes}` : "Antes";
  if (reg.tipo === "clics") return `${v} «${tarea}» me tomaba ${reg.antes} clics; ahora ${reg.ahora}.`;
  if (reg.tipo === "tiempo") return `${v} «${tarea}» me tomaba ${seg(reg.antes)}; ahora ${seg(reg.ahora)}.`;
  if (reg.tipo === "paso") return `${v} podía ${reg.paso}; ahora no (${reg.ahora}).`;
  return `${v} «${tarea}» no mostraba errores; ahora aparecen ${reg.ahora}.`;
}

/**
 * Compara una ejecución con la última versión **aprobada** de la memoria del recorrido. Sin historial previo no
 * falla: responde sin regresiones y con el motivo.
 */
export function compararMemoria(cfg, id, ej, { umbrales = cfg.panel?.regresion, excluirVersion } = {}) {
  const m = leerMemoria(cfg, id);
  // La versión que se está calificando no se compara consigo misma (calificar puede correr dos veces).
  const base = [...m.historial].reverse().find((x) => x.aprobado && (excluirVersion === undefined || x.version !== String(excluirVersion)));
  if (!base) return { base: null, regresiones: [], motivo: m.historial.length ? "sin una versión aprobada para comparar" : "sin historial previo" };
  const tarea = base.tarea ?? id;
  const regresiones = compararEjecuciones(base, entradaDe({ id, tarea }, ej, {}), umbrales).map((r) => ({ ...r, texto: textoRegresion(r, tarea, base.version) }));
  return { base: { version: base.version, fecha: base.fecha, persona: base.persona, totales: base.totales }, regresiones };
}

/** Regla documentada: cada regresión baja la nota (paso que dejó de cumplir 2, errores nuevos 1, clics 1, tiempo 0,5; tope 3; mínimo 1). */
export function notaConRegresiones(nota, regs) {
  const descuento = Math.min(DESCUENTOS.tope, regs.reduce((s, r) => s + (DESCUENTOS[r.tipo] ?? 0), 0));
  return { nota: Math.max(1, Math.round((Number(nota) - descuento) * 100) / 100), descuento };
}

// ───────────────────────── CLI ─────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const cfg = loadConfig(process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json en esta carpeta ni en las de arriba.");
    process.exit(2);
  }
  const ciclo = arg("ciclo");
  const lista = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (cmd === "guardar") {
    const r = guardarRecorrido(cfg, ciclo, leerJson(arg("archivo")));
    console.log(r.ok ? `recorrido guardado · ${r.archivo}` : `recorrido inválido:\n- ${r.errores.join("\n- ")}`);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === "plan") console.log(textoPlan(recorridosDe(cfg, ciclo)) || "(sin recorridos en este ciclo)");
  else if (cmd === "aprobar") {
    const r = aprobarRecorridos(cfg, ciclo, { permanentes: lista(arg("permanentes")) });
    console.log(JSON.stringify(r, null, 2));
    if (r.some((x) => !x.ok)) process.exitCode = 1;
  } else if (cmd === "contrato") {
    const personas = lista(arg("personas"));
    console.log(textoContrato(recorridosDe(cfg, ciclo).filter((r) => !personas.length || personas.includes(r.persona))));
  } else if (cmd === "verificar") {
    const ok = verificarCongelado(leerJson(arg("archivo")));
    console.log(ok ? "congelado: coincide con su hash" : "no coincide con el hash aprobado (o no está aprobado)");
    if (!ok) process.exitCode = 1;
  } else console.log("Uso: recorridos.mjs guardar --ciclo <c> --archivo <json> | plan --ciclo <c> | aprobar --ciclo <c> [--permanentes a,b] | contrato --ciclo <c> [--personas a,b] | verificar --archivo <json>");
}
