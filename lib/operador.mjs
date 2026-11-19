// neurodanza · operador: recuerda una lección justo cuando hace falta. Una lección de un constructo puede traer
// `activadores` (globs de archivos y patrones de texto); cuando un subagente de ese constructo lee o edita un archivo
// que coincide, recibe la lección como aviso una sola vez por lección y por agente: «Recuerda (lección aprendida en
// este proyecto): …». Sin modelo: coincidencia de reglas. Ver docs/19-menos-exploracion.md.
//
// Las lecciones activas (aprobadas o a prueba, con activadores) se compilan en `.neurodanza/operador/activas.json`
// cada vez que se guardan los constructos: la barrera solo lee ese archivo chico (menos de 5 ms por evento).
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { globToRegExp } from "./config.mjs";
import { escribirAtomico } from "./procesos.mjs";

const ACTIVAS = new Set(["aprobada", "a prueba"]);
const carpeta = (cfg) => cfg.abs(join(".neurodanza", "operador"));
const seguro = (s) => String(s).replace(/[^\w.-]/g, "_").slice(0, 80);

/** Activadores válidos (`{ archivos: [globs], texto: [patrones] }`) o null. */
export function normalizarActivadores(a) {
  if (!a || typeof a !== "object") return null;
  const archivos = (Array.isArray(a.archivos) ? a.archivos : []).filter((x) => typeof x === "string" && x.trim());
  const texto = (Array.isArray(a.texto) ? a.texto : []).filter((x) => typeof x === "string" && x.trim());
  return archivos.length || texto.length ? { ...(archivos.length ? { archivos } : {}), ...(texto.length ? { texto } : {}) } : null;
}

/** Sugiere activadores a partir de los archivos que nombra el detalle de un problema (por extensión). */
export function sugerirActivadores(detalle) {
  const exts = new Set();
  for (const m of String(detalle ?? "").matchAll(/[\w./[\]()-]+\.(tsx|jsx|ts|js|mjs|vue|svelte|css|scss|prisma|sql)\b/g)) exts.add(m[1]);
  return exts.size ? { archivos: [...exts].map((e) => `**/*.${e}`) } : null;
}

/** Patrón de texto: `/expresión/flags` es una expresión regular; si no, texto literal. */
function patron(p) {
  const m = String(p).match(/^\/(.+)\/([a-z]*)$/);
  if (m) {
    try {
      return new RegExp(m[1], m[2]);
    } catch {
      return null;
    }
  }
  return { test: (s) => s.includes(p) };
}

/** Lecciones activas con activadores, de todos los constructos (puro). `retiradas`: etiquetas borradas del archivo compartido. */
export function compilar(data, retiradas = {}) {
  const out = [];
  for (const [constructo, c] of Object.entries(data.constructos ?? {}))
    for (const l of c.lecciones ?? []) {
      const a = normalizarActivadores(l.activadores);
      if (!a || !ACTIVAS.has(l.estado)) continue;
      if (l.estado === "aprobada" && retiradas[constructo]?.includes(l.etiqueta)) continue;
      // `leccion` = el texto de la lección; `archivos` y `texto` = sus activadores.
      out.push({ constructo, etiqueta: l.etiqueta, leccion: l.texto, estado: l.estado, ...a });
    }
  return out;
}

export const guardarActivas = (cfg, activas) => {
  mkdirSync(carpeta(cfg), { recursive: true });
  escribirAtomico(join(carpeta(cfg), "activas.json"), JSON.stringify(activas));
};

/** ¿La lección se activa con este archivo y contenido? Con archivos y texto, deben coincidir los dos. */
export function coincide(l, rel, contenido = "") {
  const r = String(rel).replace(/\\/g, "/");
  if (l.archivos?.length && !l.archivos.some((g) => globToRegExp(g).test(r) || globToRegExp(g).test(r.split("/").pop()))) return false;
  if (l.texto?.length && !l.texto.some((p) => patron(p)?.test(contenido))) return false;
  return true;
}

/** Constructo de un subagente: el de su tarea del director (si la tiene) o su tipo sin el prefijo del plugin. */
export function constructoDe(cfg, event) {
  try {
    const fig = JSON.parse(readFileSync(cfg.abs(join(".neurodanza", "figuras.json")), "utf8"));
    const tarea = fig.agentes?.[event.agent_id]?.tarea;
    if (tarea) {
      const t = JSON.parse(readFileSync(cfg.abs(join(".neurodanza", "director", "tareas", `${tarea}.json`)), "utf8"));
      if (t.constructo) return t.constructo;
    }
  } catch {
    /* sin tarea */
  }
  return String(event.agent_type ?? "").replace(/^[\w-]+:/, "") || "otro";
}

/** Archivo y contenido que toca una herramienta (Read lee el archivo; Edit/Write miran el texto nuevo). */
function tocado(cfg, event) {
  const i = event.tool_input ?? {};
  const f = i.file_path ?? i.notebook_path;
  if (!f) return null;
  const abs = isAbsolute(f) ? f : join(event.cwd ?? cfg.root, f);
  const rel = relative(cfg.root, abs).replace(/\\/g, "/");
  let contenido = "";
  if (event.tool_name === "Read") {
    try {
      if (statSync(abs).size <= 200_000) contenido = readFileSync(abs, "utf8");
    } catch {
      /* no existe */
    }
  } else if (event.tool_name === "Edit") contenido = String(i.new_string ?? "");
  else if (event.tool_name === "MultiEdit") contenido = (i.edits ?? []).map((e) => e.new_string ?? "").join("\n");
  else if (event.tool_name === "Write") contenido = String(i.content ?? "");
  else return null;
  return { rel, contenido };
}

/** Marca la lección como recordada a ese agente (creación exclusiva: entre procesos, solo uno gana). */
function marcar(cfg, agente, l) {
  const dir = join(carpeta(cfg), "recuerdos");
  mkdirSync(dir, { recursive: true });
  try {
    closeSync(openSync(join(dir, `${seguro(l.constructo)}__${seguro(l.etiqueta)}__${seguro(agente)}`), "wx"));
    return true;
  } catch {
    return false; // ya se le recordó
  }
}

/**
 * Avisos para el subagente de este evento: las lecciones activas de su constructo cuyos activadores coinciden con
 * el archivo que lee o edita, una sola vez por lección y agente. Devuelve el texto o "".
 */
export function recordar(cfg, event, activas = null) {
  if (!event?.agent_id) return "";
  const lista = activas ?? leerActivas(cfg);
  if (!lista.length) return "";
  const t = tocado(cfg, event);
  if (!t) return "";
  const constructo = constructoDe(cfg, event);
  const avisos = [];
  for (const l of lista) {
    if (l.constructo !== constructo || !coincide(l, t.rel, t.contenido)) continue;
    if (marcar(cfg, event.agent_id, l)) avisos.push(`Recuerda (lección aprendida en este proyecto): ${l.leccion}`);
  }
  return avisos.join("\n");
}

export function leerActivas(cfg) {
  try {
    return JSON.parse(readFileSync(join(carpeta(cfg), "activas.json"), "utf8"));
  } catch {
    return [];
  }
}

/** Clave de una lección en el conteo de recuerdos. */
export const claveRecuerdo = (constructo, etiqueta) => `${seguro(constructo)}__${seguro(etiqueta)}`;

/** Cuántas veces se recordó cada lección: { claveRecuerdo: n }. */
export function vecesRecordadas(cfg) {
  const dir = join(carpeta(cfg), "recuerdos");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const [c, e] = f.split("__");
    if (c && e) out[`${c}__${e}`] = (out[`${c}__${e}`] ?? 0) + 1;
  }
  return out;
}

