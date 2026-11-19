#!/usr/bin/env node
// neurodanza · telemetría: lo que pasó en las sesiones de Claude Code del proyecto, sacado de sus transcripts
// (sin hooks nuevos: no suma latencia). Por sesión: tokens, herramientas, comandos (normalizados), comandos que
// fallan, rechazos de las barreras, cortes de subagentes y subagentes lanzados. Incremental: solo relee los
// archivos que cambiaron. Guarda resúmenes, no contenido. Ver docs/22-autoajuste.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node telemetria.mjs recolectar [--transcripts <carpeta>]   actualiza .neurodanza/telemetria/resumen.json
//   node telemetria.mjs semanas                               tokens y sesiones por semana
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { escribirAtomico } from "./procesos.mjs";

const COMANDOS = new Set(["Bash", "PowerShell"]);
const AGENTES = new Set(["Agent", "Task"]);
// Sube cuando cambia lo que se guarda por sesión: invalida la caché.
const VERSION = 2;

/** Carpeta de transcripts de Claude Code para una ruta: cada carácter que no es letra o número pasa a «-». */
export const slugDe = (ruta) => resolve(ruta).replace(/[^A-Za-z0-9]/g, "-");

/**
 * Carpetas de transcripts del proyecto: la de la carpeta principal y la de cada repo (una sesión abierta dentro
 * de un repo tiene su propia carpeta). `telemetria.transcripts` o ND_TRANSCRIPTS la reemplazan (pruebas, banco).
 */
export function carpetasTranscripts(cfg) {
  const propia = process.env.ND_TRANSCRIPTS || cfg.telemetria?.transcripts;
  if (propia) return [resolve(cfg.root, propia)];
  const base = join(homedir(), ".claude", "projects");
  const rutas = [cfg.root, ...(cfg.repos ?? []).map((r) => cfg.abs(r.ruta))];
  return [...new Set(rutas.map((r) => join(base, slugDe(r))))].filter((d) => existsSync(d));
}

/** Archivos .jsonl de una carpeta de transcripts, con los de subagentes (`<sesión>/subagents/`). */
function archivosDe(dir, out = []) {
  let es;
  try {
    es = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of es) {
    if (e.isDirectory() && e.name !== "tool-results" && e.name !== "memory") archivosDe(join(dir, e.name), out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(join(dir, e.name));
  }
  return out;
}

/** Texto normalizado (sin rutas, números, horas ni hashes) para agrupar lo mismo que pasa en otro archivo o día. */
export function normalizarTexto(t) {
  return String(t ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .replace(/[A-Za-z]:[\\/][^\s:'"`)\]]+/g, "<ruta>")
    .replace(/(?:\.{0,2}\/)?(?:[\w@.$-]+\/)+[\w@.$-]+/g, "<ruta>")
    .replace(/\b[0-9a-f]{7,40}\b/gi, "<hash>")
    .replace(/\d+(?:[.,:]\d+)*/g, "N")
    .replace(/\s+/g, " ")
    .slice(0, 240)
    .trim();
}

/** Forma normal de un comando (la misma que cuenta las macros). */
export function normalizarComando(cmd) {
  return String(cmd)
    .replace(/\s+/g, " ")
    .replace(/\b\d+\b/g, "N")
    .replace(/[A-Za-z]:[\\/][^\s'"]*?(Temp|tmp)[^\s'"]*/gi, "<tmp>")
    .replace(/\/tmp\/[^\s'"]*/g, "<tmp>")
    .trim();
}

const textoDe = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : x?.text ?? "")).join("\n") : String(c ?? ""));

/**
 * Rechazo de una barrera en el resultado de una herramienta, o null. Los hooks PreToolUse llegan como
 * «PreToolUse:<Herramienta> hook error: [comando]: motivo»; los de neurodanza empiezan con «neurodanza:».
 * El «no» del usuario a un permiso no es un rechazo de barrera.
 */
export function rechazoDe(texto) {
  const t = String(texto ?? "");
  if (/doesn't want to proceed|user (rejected|denied)|el usuario (rechazó|no quiso)/i.test(t)) return null;
  const m = t.match(/^PreToolUse:\w+ hook error: \[[^\]]*\]:\s*([\s\S]*)/) ?? t.match(/(?:^|\n)\s*(?:<tool_use_error>)?\s*((?:neurodanza|guardia):[\s\S]*)/);
  if (!m) return null;
  const original = m[1].replace(/<\/?tool_use_error>/g, "").trim();
  return { motivo: normalizarTexto(original), texto: original.split(/\r?\n/)[0].slice(0, 300) };
}

/** ¿Una firma de error dice algo? (no solo rutas, números o salida vacía) */
export const errorConTexto = (firma) => String(firma ?? "").replace(/<ruta>|<hash>|\bN\b|[^A-Za-zÀ-ÿ]/g, "").length >= 15;

/** ¿El resultado es el corte de un subagente (tiempo o cuarentena)? */
export const esCorte = (texto) => /neurodanza: (se acabó tu tiempo|estás en cuarentena)/.test(String(texto ?? ""));

/**
 * Resumen de una sesión (puro) a partir de sus líneas JSON. Los tokens se cuentan una vez por mensaje (las
 * respuestas llegan en varias líneas con el mismo id).
 */
export function resumirSesion(lineas, { archivo = "", agente = "" } = {}) {
  const r = { sesion: "", archivo, subagente: /[\\/]subagents[\\/]/.test(archivo), agente: String(agente).replace(/^neurodanza:/, ""), inicio: null, fin: null, tokens: { entrada: 0, salida: 0, cacheLeida: 0, cacheCreada: 0 }, herramientas: {}, comandos: [], rechazos: [], cortes: 0, subagentes: {} };
  const usos = new Map();
  const vistos = new Set();
  for (const l of lineas) {
    let e;
    try {
      e = typeof l === "string" ? JSON.parse(l) : l;
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    r.sesion ||= e.sessionId ?? e.session_id ?? "";
    r.agente ||= e.agentType ?? e.agent_type ?? "";
    if (e.timestamp) {
      if (!r.inicio || e.timestamp < r.inicio) r.inicio = e.timestamp;
      if (!r.fin || e.timestamp > r.fin) r.fin = e.timestamp;
    }
    const contenido = Array.isArray(e.message?.content) ? e.message.content : [];
    if (e.type === "assistant") {
      const id = e.message?.id ?? e.requestId ?? e.uuid;
      const u = e.message?.usage;
      if (u && !vistos.has(id)) {
        vistos.add(id);
        r.tokens.entrada += u.input_tokens ?? 0;
        r.tokens.salida += u.output_tokens ?? 0;
        r.tokens.cacheLeida += u.cache_read_input_tokens ?? 0;
        r.tokens.cacheCreada += u.cache_creation_input_tokens ?? 0;
      }
      for (const c of contenido) {
        if (c?.type !== "tool_use") continue;
        r.herramientas[c.name] = (r.herramientas[c.name] ?? 0) + 1;
        usos.set(c.id, c);
        if (AGENTES.has(c.name)) {
          const tipo = String(c.input?.subagent_type ?? "general").replace(/^neurodanza:/, "");
          r.subagentes[tipo] = (r.subagentes[tipo] ?? 0) + 1;
        }
      }
    } else if (e.type === "user") {
      for (const c of contenido) {
        if (c?.type !== "tool_result") continue;
        const uso = usos.get(c.tool_use_id);
        const texto = textoDe(c.content);
        const corte = esCorte(texto);
        if (corte) r.cortes++;
        // Un corte por tiempo o cuarentena llega como error del hook, pero no es una regla que el agente rompió.
        const rech = c.is_error && !corte ? rechazoDe(texto) : null;
        if (rech) r.rechazos.push({ herramienta: uso?.name ?? "", ...rech });
        // Un comando rechazado o cortado no corrió: no cuenta como comando.
        if (uso && COMANDOS.has(uso.name) && !rech && !corte) {
          const cmd = String(uso.input?.command ?? "");
          const code = texto.match(/^Exit code (\d+)/);
          const falla = !!c.is_error && !rech && !!code;
          r.comandos.push({ norm: normalizarComando(cmd).slice(0, 4000), largo: cmd.length, ...(falla ? { falla: true, error: normalizarTexto(texto.replace(/^Exit code \d+\s*/, "")) } : {}) });
        }
      }
    }
  }
  return r;
}

const leerJson = (f, d) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
export const carpetaTelemetria = (cfg) => cfg.abs(join(".neurodanza", "telemetria"));

/**
 * Agrega las sesiones (puro): comandos, errores de comandos (por firma, aunque el comando cambie), rechazos y
 * cortes, con en cuántas sesiones aparecen.
 */
export function agregar(sesiones) {
  const comandos = {};
  const errores = {};
  const rechazos = {};
  const cortes = {};
  for (const s of sesiones) {
    const clave = s.sesion || s.archivo;
    const ag = s.subagente ? s.agente || "subagente" : "principal";
    for (const c of s.comandos) {
      const k = c.norm;
      const a = (comandos[k] ??= { veces: 0, sesiones: [], largo: c.largo, fallos: 0, errores: {} });
      a.veces++;
      if (!a.sesiones.includes(clave)) a.sesiones.push(clave);
      if (c.falla) {
        a.fallos++;
        a.errores[c.error] = (a.errores[c.error] ?? 0) + 1;
        if (errorConTexto(c.error)) {
          const e = (errores[c.error] ??= { veces: 0, sesiones: [], comandos: [], agentes: {} });
          e.veces++;
          if (!e.sesiones.includes(clave)) e.sesiones.push(clave);
          if (e.comandos.length < 3 && !e.comandos.includes(k.slice(0, 300))) e.comandos.push(k.slice(0, 300));
          e.agentes[ag] = (e.agentes[ag] ?? 0) + 1;
        }
      }
    }
    for (const x of s.rechazos) {
      const a = (rechazos[x.motivo] ??= { veces: 0, sesiones: [], herramientas: {}, agentes: {}, texto: x.texto ?? x.motivo });
      a.veces++;
      if (!a.sesiones.includes(clave)) a.sesiones.push(clave);
      a.herramientas[x.herramienta] = (a.herramientas[x.herramienta] ?? 0) + 1;
      a.agentes[ag] = (a.agentes[ag] ?? 0) + 1;
    }
    if (s.cortes) {
      const a = (cortes[ag] ??= { veces: 0, sesiones: [], fechas: [] });
      a.veces += s.cortes;
      if (!a.sesiones.includes(clave)) a.sesiones.push(clave);
      a.fechas.push(s.inicio);
    }
  }
  return { comandos, errores, rechazos, cortes };
}

/** Semana ISO-ish (lunes) de una fecha: AAAA-MM-DD del lunes. */
const semanaDe = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "sin fecha";
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** Tokens, sesiones, rechazos y cortes por semana (puro). */
export function porSemana(sesiones) {
  const out = {};
  for (const s of sesiones) {
    const w = (out[semanaDe(s.inicio)] ??= { sesiones: 0, subagentes: 0, salida: 0, entrada: 0, cacheLeida: 0, rechazos: 0, cortes: 0, fallos: 0 });
    if (s.subagente) w.subagentes++;
    else w.sesiones++;
    w.salida += s.tokens.salida;
    w.entrada += s.tokens.entrada + s.tokens.cacheCreada;
    w.cacheLeida += s.tokens.cacheLeida;
    w.rechazos += s.rechazos.length;
    w.cortes += s.cortes;
    w.fallos += s.comandos.filter((c) => c.falla).length;
  }
  return out;
}

/**
 * Recolecta (incremental): relee solo los transcripts que cambiaron desde la última vez y guarda
 * `.neurodanza/telemetria/resumen.json`. Devuelve el resumen.
 */
export function recolectar(cfg, { carpetas = carpetasTranscripts(cfg), ahora = Date.now() } = {}) {
  const dir = carpetaTelemetria(cfg);
  const fCache = join(dir, "cache.json");
  const leida = leerJson(fCache, { archivos: {} });
  const cache = leida.version === VERSION ? leida : { archivos: {} };
  const nuevo = { version: VERSION, archivos: {} };
  let leidos = 0;
  for (const c of carpetas) {
    for (const f of archivosDe(c)) {
      let st;
      try {
        st = statSync(f);
      } catch {
        continue;
      }
      const prev = cache.archivos[f];
      if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) {
        nuevo.archivos[f] = prev;
        continue;
      }
      leidos++;
      const lineas = readFileSync(f, "utf8").split("\n").filter(Boolean);
      // El tipo de un subagente está en su .meta.json (agentType).
      const meta = leerJson(f.replace(/\.jsonl$/, ".meta.json"), {});
      nuevo.archivos[f] = { mtimeMs: st.mtimeMs, size: st.size, sesion: resumirSesion(lineas, { archivo: f, agente: meta.agentType ?? "" }) };
    }
  }
  mkdirSync(dir, { recursive: true });
  const sesiones = Object.values(nuevo.archivos).map((x) => x.sesion);
  const resumen = { fecha: new Date(ahora).toISOString(), carpetas, archivos: sesiones.length, leidos, sesiones: sesiones.filter((s) => !s.subagente).length, subagentes: sesiones.filter((s) => s.subagente).length, semanas: porSemana(sesiones), ...agregar(sesiones), lista: sesiones.map((s) => ({ archivo: s.archivo, sesion: s.sesion, subagente: s.subagente, agente: s.agente, inicio: s.inicio, fin: s.fin, tokens: s.tokens, rechazos: s.rechazos, cortes: s.cortes, fallos: s.comandos.filter((c) => c.falla).map((c) => c.error), comandos: s.comandos.length })) };
  escribirAtomico(fCache, JSON.stringify(nuevo));
  escribirAtomico(join(dir, "resumen.json"), JSON.stringify(resumen, null, 1));
  return resumen;
}

export const leerResumen = (cfg) => leerJson(join(carpetaTelemetria(cfg), "resumen.json"), null);

// ───────────────────────── CLI ─────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig(process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json en esta carpeta ni en las de arriba.");
    process.exit(2);
  }
  const i = process.argv.indexOf("--transcripts");
  const carpetas = i > 0 ? [resolve(process.argv[i + 1])] : undefined;
  const cmd = process.argv[2];
  if (cmd === "recolectar") {
    const t0 = Date.now();
    const r = recolectar(cfg, carpetas ? { carpetas } : {});
    console.log(`${r.sesiones} sesiones y ${r.subagentes} subagentes (${r.leidos} archivos leídos de nuevo) en ${Date.now() - t0} ms · ${Object.keys(r.rechazos).length} motivos de rechazo · ${Object.keys(r.errores).length} errores de comandos`);
  } else if (cmd === "semanas") {
    const r = leerResumen(cfg) ?? recolectar(cfg, carpetas ? { carpetas } : {});
    console.log("| Semana | Sesiones | Subagentes | Tokens de salida | Entrada nueva | Caché leída | Rechazos | Cortes | Fallos |\n|---|---|---|---|---|---|---|---|---|");
    for (const [w, x] of Object.entries(r.semanas).sort()) console.log(`| ${w} | ${x.sesiones} | ${x.subagentes} | ${x.salida} | ${x.entrada} | ${x.cacheLeida} | ${x.rechazos} | ${x.cortes} | ${x.fallos} |`);
  } else console.log("Uso: telemetria.mjs recolectar [--transcripts <carpeta>] | semanas");
}
