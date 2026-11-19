#!/usr/bin/env node
// neurodanza · hotel de especialistas: antes de delegar, el director consulta a especialistas de solo lectura
// (datos, accesibilidad, permisos, rendimiento) con preguntas concretas sobre el proyecto. Cada uno recibe su
// contexto pre-cocido (el índice enfocado en su área) y sus respuestas se cachean por la firma de los archivos de
// su área + la pregunta: una pregunta repetida sin cambios no vuelve a lanzar al especialista. Las respuestas entran
// en el contrato («Lo que ya sabemos de este proyecto»). Solo el director consulta. Ver docs/19-menos-exploracion.md.
//
// Uso (desde cualquier carpeta del proyecto; --tarea <id> del director o --archivos "repo:glob,…"):
//   node hotel.mjs elegir --tarea <id>              qué especialistas aplican y por qué
//   node hotel.mjs preguntas --tarea <id>           por especialista: contexto, preguntas pendientes y las ya en caché
//   node hotel.mjs guardar --respuesta <json>       cachea la respuesta de un especialista
//   node hotel.mjs seccion --tarea <id>             «Lo que ya sabemos de este proyecto» (para el contrato)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRegExp, loadConfig } from "./config.mjs";
import { indiceDe, reposDe, resumen } from "./indice.mjs";
import { escribirAtomico } from "./procesos.mjs";

/**
 * Especialistas: cuándo aplican (archivos de la tarea, por ruta o por tipo del índice), qué tipos del índice forman
 * su contexto y las preguntas base («{foco}» = los nombres que toca la tarea).
 */
export const ESPECIALISTAS = {
  datos: {
    rutas: [/(^|\/)prisma\//, /(^|\/)migrations?\//, /\.entity\.[jt]s$/, /schema\.prisma$/, /(^|\/)(models?|entities|repositor(y|ies))\//, /\.repository\.[jt]s$/],
    tipos: ["modelo", "migración"],
    preguntas: ["¿Cómo se crean y nombran las migraciones en este proyecto (comando, carpeta, convención)?", "¿Qué convención de nombres usan tablas, columnas y relaciones?", "¿Cómo se modela {foco} hoy y con qué se relaciona?"],
  },
  a11y: {
    rutas: [/\.(tsx|jsx|vue|svelte)$/, /(^|\/)(app|pages|components|views|screens)\//],
    tipos: ["pantalla", "componente"],
    preguntas: ["¿Qué componentes de formulario, botón y diálogo reutiliza el proyecto y cómo manejan etiquetas y foco?", "¿Cómo se anuncian errores y estados de carga a lectores de pantalla en {foco}?"],
  },
  permisos: {
    rutas: [/guard|polic(y|ies)|permis|roles?\b|auth|casl|acl/i, /\.controller\.[jt]s$/, /(^|\/)middleware/],
    tipos: ["guardia", "controlador", "ruta-api"],
    preguntas: ["¿Cómo se protege un endpoint por rol en este proyecto (decorador, guard, middleware) y dónde se define la matriz de permisos?", "¿Cómo se filtra por empresa o cliente (multiempresa) en las consultas de {foco}?"],
  },
  rendimiento: {
    rutas: [/\.service\.[jt]s$/, /\.repository\.[jt]s$/, /(^|\/)(queries|loaders?|hooks)\//, /page\.(tsx|jsx)$/],
    tipos: ["servicio", "pantalla"],
    preguntas: ["¿Cómo se paginan y filtran los listados (servidor o cliente) y qué límites usan?", "¿Hay consultas N+1 o renders pesados conocidos en {foco}? ¿Cómo se cachean los datos?"],
  },
};

// ───────────────────────── puros ─────────────────────────

/** `{ repo: [globs] }` a partir de "repo:glob,repo:glob". */
export function parseArchivos(txt) {
  const out = {};
  for (const p of String(txt ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const i = p.indexOf(":");
    const [repo, glob] = i > 0 ? [p.slice(0, i), p.slice(i + 1)] : ["*", p];
    (out[repo] ??= []).push(glob);
  }
  return out;
}

/** Archivos del índice que caen en los globs de la tarea (por repo). */
export function archivosDeTarea(indices, archivos) {
  const out = [];
  for (const [repo, ind] of Object.entries(indices)) {
    const globs = [...(archivos[repo] ?? []), ...(archivos["*"] ?? [])];
    if (!globs.length) continue;
    const res = globs.map(globToRegExp);
    for (const rel of Object.keys(ind.archivos)) if (res.some((re) => re.test(rel))) out.push({ repo, rel, tipo: ind.archivos[rel].tipo });
    // Un glob que todavía no existe (archivo nuevo) también cuenta por su ruta.
    for (const g of globs) if (!/[*?{]/.test(g) && !ind.archivos[g]) out.push({ repo, rel: g, tipo: "nuevo" });
  }
  return out;
}

/** Qué especialistas aplican a esos archivos, con el motivo. */
export function elegir(archivos) {
  const out = [];
  for (const [nombre, e] of Object.entries(ESPECIALISTAS)) {
    const hit = archivos.find((a) => e.rutas.some((re) => re.test(a.rel)) || e.tipos.includes(a.tipo));
    if (hit) out.push({ especialista: nombre, motivo: `${hit.repo}:${hit.rel}${hit.tipo && hit.tipo !== "nuevo" ? ` (${hit.tipo})` : ""}` });
  }
  return out;
}

/** Nombres que toca la tarea (para las preguntas): carpetas y archivos sin extensión ni sufijos de Nest. */
export function focoDe(archivos) {
  const nombres = new Set();
  for (const a of archivos) {
    const partes = a.rel.split("/").filter((p) => p && !/^(src|app|pages|components|lib|backend|frontend|web|api|test|tests|dto|\(.*\)|\[.*\])$/.test(p) && !/[*?{]/.test(p));
    const ult = partes.at(-1)?.replace(/\.(controller|service|entity|module|dto|spec|test|repository)?\.?[^.]*$/, "");
    if (partes.length > 1) nombres.add(partes.at(-2));
    if (ult && !/^(page|index|route|layout)$/.test(ult)) nombres.add(ult);
  }
  return [...nombres].slice(0, 3).join(", ") || "esta parte";
}

export const preguntasDe = (especialista, foco) => ESPECIALISTAS[especialista].preguntas.map((p) => p.replace("{foco}", foco));

/** Clave de caché de una pregunta: especialista + pregunta + firma de los archivos de su área. */
export const claveDe = (especialista, pregunta, firmaArea) => createHash("sha1").update(`${especialista}\u0000${pregunta}\u0000${firmaArea}`).digest("hex").slice(0, 20);

/** Respuesta válida de un especialista: `{ especialista, respuestas: [{ pregunta, respuesta, archivos, confianza }] }`. */
export function validarRespuesta(r) {
  const e = [];
  if (!ESPECIALISTAS[r?.especialista]) e.push(`especialista: ${Object.keys(ESPECIALISTAS).join(" | ")}`);
  if (!Array.isArray(r?.respuestas) || !r.respuestas.length) e.push("respuestas: al menos una");
  for (const [i, x] of (r?.respuestas ?? []).entries()) {
    if (!x?.pregunta || !x?.respuesta) e.push(`respuestas[${i + 1}]: pregunta y respuesta`);
    if (x && !Array.isArray(x.archivos)) e.push(`respuestas[${i + 1}]: archivos (lista)`);
    if (x && !["alta", "media", "baja"].includes(x.confianza)) e.push(`respuestas[${i + 1}]: confianza alta | media | baja`);
  }
  return e;
}

// ───────────────────────── con el proyecto ─────────────────────────

const carpeta = (cfg) => cfg.abs(join(".neurodanza", "hotel"));
const leer = (f, d) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};

function indices(cfg) {
  return Object.fromEntries(reposDe(cfg).map((r) => [r.nombre, indiceDe(cfg, r)]));
}

/** Globs de la tarea: de la tarea del director o de --archivos. */
export function archivosDe(cfg, { tarea, archivos } = {}) {
  if (archivos && typeof archivos === "object") return archivos;
  if (archivos) return parseArchivos(archivos);
  // Tareas del modo director: .neurodanza/director/tareas/<id>.json (sin importar director.mjs: él importa este módulo).
  const dir = cfg.abs(join(".neurodanza", "director", "tareas"));
  const t = existsSync(dir) ? readdirSync(dir).map((f) => leer(join(dir, f), null)).find((x) => x?.id === tarea) : null;
  if (!t) throw new Error(`no hay una tarea ${tarea} (usa --archivos "repo:glob,…")`);
  return t.archivos ?? {};
}

/** Archivos del área de un especialista (para su contexto y su firma): tipos del índice o rutas que coinciden. */
function areaDe(ind, especialista) {
  const e = ESPECIALISTAS[especialista];
  return Object.entries(ind.archivos)
    .filter(([rel, i]) => e.tipos.includes(i.tipo) || e.rutas.some((re) => re.test(rel)))
    .map(([rel]) => rel)
    .sort();
}

/** Firma del área: contenido de sus archivos. Un commit que no toca el área no invalida la caché. */
function firmaArea(cfg, inds, especialista) {
  const h = createHash("sha1");
  for (const [repo, ind] of Object.entries(inds)) {
    const r = cfg.repos.find((x) => x.nombre === repo) ?? { ruta: "." };
    for (const rel of areaDe(ind, especialista).slice(0, 400)) {
      h.update(`${repo}:${rel}\u0000`);
      try {
        h.update(readFileSync(join(cfg.abs(r.ruta), rel)));
      } catch {
        /* borrado */
      }
    }
  }
  return h.digest("hex").slice(0, 16);
}

/** Contexto pre-cocido de un especialista: el resumen del índice enfocado en su área y en la tarea. */
function contextoDe(cfg, inds, especialista, archivosTarea, firma) {
  const f = join(carpeta(cfg), "contexto", `${especialista}-${firma}.txt`);
  if (existsSync(f)) return readFileSync(f, "utf8");
  const partes = [];
  for (const [repo, ind] of Object.entries(inds)) {
    const area = areaDe(ind, especialista);
    if (!area.length) continue;
    const deTarea = archivosTarea.filter((a) => a.repo === repo).map((a) => a.rel);
    const foco = [...new Set([...deTarea.filter((r) => area.includes(r)), ...area])].slice(0, 25);
    partes.push(resumen(ind, { foco: foco.join(","), max: 40 }));
  }
  const texto = partes.join("\n\n") || "(el índice no tiene archivos de esta área)";
  mkdirSync(dirname(f), { recursive: true });
  escribirAtomico(f, texto);
  return texto;
}

const archivoRespuesta = (cfg, clave) => join(carpeta(cfg), "respuestas", `${clave}.json`);

/** Consultas del ciclo, para el mapa: `.neurodanza/hotel/consultas.json`. */
function anotarConsultas(cfg, filas) {
  const f = join(carpeta(cfg), "consultas.json");
  const prev = leer(f, { consultas: [] });
  const porClave = new Map(prev.consultas.map((c) => [`${c.tarea}:${c.especialista}`, c]));
  for (const c of filas) porClave.set(`${c.tarea}:${c.especialista}`, { ...porClave.get(`${c.tarea}:${c.especialista}`), ...c, fecha: new Date().toISOString() });
  mkdirSync(dirname(f), { recursive: true });
  escribirAtomico(f, JSON.stringify({ consultas: [...porClave.values()] }, null, 2));
}

/**
 * Plan de consulta de una tarea: por especialista que aplica, su contexto, las preguntas pendientes (a lanzar) y las
 * que ya tienen respuesta en caché. `lanzar: false` si todo está en caché.
 */
export function planConsulta(cfg, opciones, { anotar = true } = {}) {
  const inds = indices(cfg);
  const deTarea = archivosDeTarea(inds, archivosDe(cfg, opciones));
  const foco = focoDe(deTarea);
  const tarea = opciones.tarea ?? "consulta";
  const max = cfg.hotel?.maxPorTarea ?? 4;
  const out = [];
  for (const { especialista, motivo } of elegir(deTarea).slice(0, max)) {
    const firma = firmaArea(cfg, inds, especialista);
    const preguntas = preguntasDe(especialista, foco);
    const enCache = [];
    const pendientes = [];
    for (const p of preguntas) {
      const r = leer(archivoRespuesta(cfg, claveDe(especialista, p, firma)), null);
      if (r) enCache.push(r);
      else pendientes.push(p);
    }
    out.push({ especialista, motivo, firma, lanzar: pendientes.length > 0, pendientes, enCache, contexto: pendientes.length ? contextoDe(cfg, inds, especialista, deTarea, firma) : "" });
  }
  if (anotar) anotarConsultas(cfg, out.map((c) => ({ tarea, especialista: c.especialista, estado: c.lanzar ? "consultando" : "en caché" })));
  return out;
}

/** Cachea la respuesta de un especialista (cada pregunta por separado). Devuelve cuántas guardó. */
export function guardarRespuesta(cfg, r, { tarea = "consulta", firma } = {}) {
  const errores = validarRespuesta(r);
  if (errores.length) return { ok: false, errores };
  const f = firma ?? firmaArea(cfg, indices(cfg), r.especialista);
  for (const x of r.respuestas) {
    const file = archivoRespuesta(cfg, claveDe(r.especialista, x.pregunta, f));
    mkdirSync(dirname(file), { recursive: true });
    escribirAtomico(file, JSON.stringify({ especialista: r.especialista, ...x, fecha: new Date().toISOString() }, null, 2));
  }
  anotarConsultas(cfg, [{ tarea, especialista: r.especialista, estado: "respondido" }]);
  return { ok: true, guardadas: r.respuestas.length };
}

/** «Lo que ya sabemos de este proyecto»: respuestas en caché de los especialistas que aplican a la tarea. */
export function seccion(cfg, opciones) {
  if (cfg.hotel?.activo === false) return "";
  let plan;
  try {
    plan = planConsulta(cfg, opciones, { anotar: false });
  } catch {
    return "";
  }
  const filas = plan.flatMap((c) => c.enCache.map((r) => `- **${c.especialista}** · ${r.pregunta}\n  ${r.respuesta}${r.archivos?.length ? ` (ver ${r.archivos.slice(0, 4).join(", ")})` : ""}${r.confianza !== "alta" ? ` · confianza ${r.confianza}` : ""}`));
  if (!filas.length) return "";
  return ["## Lo que ya sabemos de este proyecto (especialistas)", "Respuestas de especialistas sobre este proyecto; úsalas en vez de explorar. Si necesitas algo que no está aquí, pídelo en `pendiente`: el director decide.", ...filas].join("\n");
}

/** Respuestas en caché (para limpiar o revisar). */
export function respuestasEnCache(cfg) {
  const dir = join(carpeta(cfg), "respuestas");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0;
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
  const op = { tarea: arg("tarea"), archivos: arg("archivos") };
  try {
    if (cmd === "elegir") console.log(JSON.stringify(elegir(archivosDeTarea(indices(cfg), archivosDe(cfg, op))), null, 2));
    else if (cmd === "preguntas") {
      const plan = planConsulta(cfg, op);
      console.log(JSON.stringify(plan.map(({ especialista, motivo, lanzar, pendientes, enCache, contexto }) => ({ especialista, motivo, lanzar, pendientes, enCache: enCache.map((r) => r.pregunta), contexto })), null, 2));
    } else if (cmd === "guardar") {
      const r = guardarRespuesta(cfg, JSON.parse(readFileSync(arg("respuesta"), "utf8")), { tarea: op.tarea });
      console.log(r.ok ? `${r.guardadas} respuesta(s) en caché` : `respuesta inválida:\n- ${r.errores.join("\n- ")}`);
      if (!r.ok) process.exitCode = 1;
    } else if (cmd === "seccion") console.log(seccion(cfg, op) || "(sin respuestas de especialistas para esta tarea)");
    else console.log('Uso: hotel.mjs elegir|preguntas|seccion (--tarea <id> | --archivos "repo:glob,…") | guardar --respuesta <json> [--tarea <id>]');
  } catch (e) {
    console.error(`hotel: ${e.message}`);
    process.exitCode = 2;
  }
}
