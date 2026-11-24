#!/usr/bin/env node
// neurodanza · CLI de la app: tareas repetitivas en un comando corto, en cualquier proyecto con neurodanza.config.json.
// Ahorra los tokens de escribir a mano el login, el token, la petición o la cadena de lint, tipos y pruebas.
//   node app.mjs estado                                            ¿la app responde? (app.urls)
//   node app.mjs login --como <persona|ROL|admin>                  entra y guarda la sesión (no muestra el token)
//   node app.mjs api <METODO> <ruta> [--como <persona|ROL|admin>] [--cuerpo <json>] [--max 2000]
//   node app.mjs abrir <ruta> --como <persona> [--salida <carpeta>]   captura de la pantalla (panel.mjs navegar)
//   node app.mjs verificar --repo <repo> [--archivos a,b]          lint, tipos y pruebas relacionadas en paralelo
//   node app.mjs macros | macro <nombre> [--<variable> <valor>…]   macros del proyecto (cli.macros, en git)
//   node app.mjs sugeridas | aceptar --id <id> --nombre <n> [--descripcion "…"] | descartar --id <id>
//   node app.mjs podar | borrar --nombre <n>                       macros sin uso en cli.podarDias días
// Las macros nacen del uso: la barrera cuenta los comandos largos que se repiten y propone guardarlos. Ver docs/21-cli-de-la-app.md.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { pedirApp } from "./encabezados.mjs";
import { expandir, loginDef } from "./fantasmas.mjs";
import { hostsApp } from "./figuras.mjs";
import { correr as correrConTope, escribirAtomico } from "./procesos.mjs";

const PANEL = fileURLToPath(new URL("../panel/panel.mjs", import.meta.url));
const leerJson = (f, d) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
const guardarJson = (f, data) => {
  mkdirSync(dirname(f), { recursive: true });
  escribirAtomico(f, JSON.stringify(data, null, 2) + "\n");
};

// ───────────────────────── sesiones y peticiones ─────────────────────────

const archivoSesiones = (cfg) => cfg.abs(".neurodanza/app/sesiones.json");

/** Credenciales de quien entra: `admin` (panel.usuarios.login tal cual), una persona por id o el primer rol que coincida. */
export function credenciales(cfg, como) {
  const u = cfg.panel?.usuarios ?? {};
  if (!como || /^admin$/i.test(como)) return { quien: "admin", def: u.login ?? null, vars: {} };
  const elenco = leerJson(cfg.abs(cfg.panel.elenco), { personas: [] });
  const p = elenco.personas.find((x) => x.id === como) ?? elenco.personas.find((x) => String(x.rol).toLowerCase() === String(como).toLowerCase());
  if (!p) throw new Error(`no hay una persona con id o rol «${como}» en ${cfg.panel.elenco}. Personas: ${elenco.personas.map((x) => `${x.id} (${x.rol})`).join(", ") || "ninguna"}.`);
  if (u.propietario && p.rol === u.propietario.rol) return { quien: p.id, def: u.login ?? null, vars: {}, propietario: true };
  return { quien: p.id, def: loginDef(cfg), vars: { id: p.id, rol: p.rol, email: expandir(u.email ?? "", { id: p.id, rol: p.rol }), clave: expandir(u.clave ?? "", {}) } };
}

/** URL de la app (solo hosts de la app: localhost y los de app.urls). */
function urlApp(cfg, ruta) {
  const base = (cfg.app?.urls ?? [])[0];
  if (!base) throw new Error("no hay app.urls en la configuración.");
  const url = new URL(ruta, base);
  if (!hostsApp(cfg).includes(url.hostname.toLowerCase())) throw new Error(`host no permitido: ${url.hostname} (solo ${hostsApp(cfg).join(", ")}).`);
  return url;
}

/** Token de una sesión: de la caché si no venció (`cli.sesionMin`), si no entra y lo guarda. */
export async function token(cfg, como, { forzar = false, ahora = Date.now() } = {}) {
  const c = credenciales(cfg, como);
  if (!c.def) throw new Error("no hay login configurado: panel.usuarios.login (o fantasmas.login) dice cómo entrar por API.");
  const f = archivoSesiones(cfg);
  const sesiones = leerJson(f, {});
  const s = sesiones[c.quien];
  if (!forzar && s?.token && ahora - s.en < (cfg.cli?.sesionMin ?? 10) * 60_000) return { token: s.token, quien: c.quien, cache: true };
  const res = await pedirApp(cfg, urlApp(cfg, expandir(c.def.url, c.vars)), { method: c.def.metodo ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expandir(c.def.cuerpo ?? {}, c.vars)), signal: AbortSignal.timeout(10_000) }, c.vars);
  const j = await res.json().catch(() => ({}));
  const t = j?.[c.def.token ?? "accessToken"];
  if (!t) throw new Error(`no pude entrar como ${c.quien}: HTTP ${res.status} ${JSON.stringify(j).slice(0, 160)}`);
  sesiones[c.quien] = { token: t, en: ahora };
  guardarJson(f, sesiones);
  return { token: t, quien: c.quien, cache: false };
}

/** Petición a la app, con la sesión de `como` si se pide. Reintenta una vez si la sesión en caché venció (401). */
export async function api(cfg, { metodo = "GET", ruta, como, cuerpo }) {
  const vars = como ? credenciales(cfg, como).vars : {};
  const pedir = async (t) =>
    pedirApp(cfg, urlApp(cfg, ruta), {
      method: metodo,
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: cuerpo != null && metodo !== "GET" ? (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)) : undefined,
      signal: AbortSignal.timeout(15_000),
    }, vars);
  let s = como ? await token(cfg, como) : null;
  let res = await pedir(s?.token);
  if (res.status === 401 && s?.cache) {
    s = await token(cfg, como, { forzar: true });
    res = await pedir(s.token);
  }
  const texto = await res.text();
  return { status: res.status, texto, quien: s?.quien ?? null };
}

/** Salida compacta: status y cuerpo (JSON en una línea por elemento, hasta `max` caracteres). */
export function compacto({ status, texto }, max = 2000) {
  let cuerpo = texto;
  try {
    const j = JSON.parse(texto);
    cuerpo = Array.isArray(j) ? `${j.length} elemento${j.length === 1 ? "" : "s"}\n${j.map((x) => JSON.stringify(x)).join("\n")}` : JSON.stringify(j);
  } catch {
    /* no es JSON */
  }
  const corto = cuerpo.length > max ? `${cuerpo.slice(0, max)}\n… (${cuerpo.length - max} caracteres más; --max para ver más)` : cuerpo;
  return `HTTP ${status}${corto ? `\n${corto}` : ""}`;
}

// ───────────────────────── verificar ─────────────────────────

/** Con tope: al cortar mata el árbol completo (lib/procesos.mjs). */
const correr = async (cmd, cwd, topeMs) => {
  const r = await correrConTope(cmd, { cwd, timeoutMs: topeMs });
  return { ok: r.ok, ms: r.ms, salida: r.out, cortado: r.cortado };
};

/** Lint, tipos y pruebas relacionadas de un repo en paralelo; solo muestra el final de lo que falla. */
export async function verificar(cfg, repo, archivos = []) {
  const r = cfg.repos.find((x) => x.nombre === repo);
  if (!r) throw new Error(`no hay un repo «${repo}» en la configuración (${cfg.repos.map((x) => x.nombre).join(", ")}).`);
  const lista = archivos.join(" ");
  const pasos = [
    ["lint", r.lint],
    ["tipos", r.tipos],
    ["pruebas", r.relacionadas],
  ].filter(([, c]) => c && (!c.includes("{archivos}") || lista));
  const tope = (cfg.barreras?.timeoutComandos?.maxSeg ?? 120) * 1000;
  const res = await Promise.all(pasos.map(async ([nombre, c]) => ({ nombre, ...(await correr(c.replace("{archivos}", lista), cfg.abs(r.ruta), tope)) })));
  const lineas = res.map((x) => `${x.ok ? "✔" : "✖"} ${x.nombre} ${(x.ms / 1000).toFixed(1)} s${x.cortado ? " (cortado por tiempo)" : ""}`);
  const fallas = res.filter((x) => !x.ok).map((x) => `── ${x.nombre}\n${x.salida.trim().split(/\r?\n/).slice(-30).join("\n")}`);
  return { ok: res.every((x) => x.ok), texto: [lineas.join(" · "), ...fallas].join("\n") };
}

// ───────────────────────── macros (nacen del uso) ─────────────────────────

const archivoMacros = (cfg) => cfg.abs(cfg.cli?.macros ?? ".claude/neurodanza-macros.json");
const archivoRepetidos = (cfg) => cfg.abs(".neurodanza/app/repetidos.json");
export const leerMacros = (cfg) => leerJson(archivoMacros(cfg), { macros: {} });

/** Variables `{nombre}` de un comando. */
export const variablesDe = (comando) => [...new Set([...String(comando).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

/** Comando de una macro con sus variables; error si falta alguna. */
export function expandirMacro(macro, valores = {}) {
  const faltan = variablesDe(macro.comando).filter((v) => !(v in valores));
  if (faltan.length) throw new Error(`faltan variables: ${faltan.map((v) => `--${v} <valor>`).join(" ")}`);
  return macro.comando.replace(/\{(\w+)\}/g, (_, k) => valores[k]);
}

/**
 * Forma normal de un comando para contar repeticiones: espacios colapsados, números, rutas temporales y
 * textos entre comillas largos reemplazados (el mismo comando con otro id cuenta como repetido).
 */
export function normalizar(cmd) {
  return String(cmd)
    .replace(/\s+/g, " ")
    .replace(/\b\d+\b/g, "N")
    .replace(/[A-Za-z]:[\\/][^\s'"]*?(Temp|tmp)[^\s'"]*/gi, "<tmp>")
    .replace(/\/tmp\/[^\s'"]*/g, "<tmp>")
    .trim();
}
const idDe = (norm) => createHash("sha1").update(norm).digest("hex").slice(0, 10);

/**
 * Cuenta un comando largo (≥ `cli.repetidoMin` caracteres). Devuelve el aviso la vez que llega a
 * `cli.repetidoVeces` (una sola vez por comando), o null. No cuenta las llamadas a esta CLI.
 */
export function contarRepetido(cfg, cmd, ahora = Date.now()) {
  const c = cfg.cli ?? {};
  if (c.activo === false || String(cmd).length < (c.repetidoMin ?? 200) || /\bapp\.mjs\b/.test(cmd)) return null;
  const norm = normalizar(cmd);
  const id = idDe(norm);
  const f = archivoRepetidos(cfg);
  const data = leerJson(f, { comandos: {} });
  const e = (data.comandos[id] ??= { veces: 0, ejemplo: String(cmd).slice(0, 4000), primera: ahora, descartado: false });
  e.veces++;
  e.ultima = ahora;
  guardarJson(f, data);
  if (e.descartado || e.veces !== (c.repetidoVeces ?? 3)) return null;
  const cli = fileURLToPath(import.meta.url).replace(/\\/g, "/");
  return `neurodanza: este comando (${String(cmd).length} caracteres) ya se escribió ${e.veces} veces. Si se va a repetir, propónle al usuario guardarlo como macro (id ${id}): node "${cli}" sugeridas, y con su visto bueno, node "${cli}" aceptar --id ${id} --nombre <nombre-corto>.`;
}

/**
 * Pista, una vez por agente y sesión: un comando que entra a la app a mano (login, token o Bearer contra un host
 * de la app) se puede cambiar por `app.mjs api`.
 */
export function pistaApp(cfg, event) {
  if (cfg.cli?.activo === false) return null;
  const cmd = String(event?.tool_input?.command ?? "");
  if (/\bapp\.mjs\b/.test(cmd) || !/(fetch\(|\bcurl\b|Invoke-(RestMethod|WebRequest)|\bwget\b|\bhttp\.request\b)/i.test(cmd) || !/(login|auth|token|Bearer)/i.test(cmd)) return null;
  const hosts = hostsApp(cfg);
  const usados = [...cmd.matchAll(/https?:\/\/(\[[^\]]+\]|[^/\s:'"`)]+)/gi)].map((m) => m[1].toLowerCase());
  if (!usados.some((h) => hosts.includes(h))) return null;
  const marca = cfg.abs(`.neurodanza/app/pistas/${createHash("sha1").update(`${event.session_id ?? ""}|${event.agent_id ?? "principal"}`).digest("hex").slice(0, 16)}`);
  try {
    mkdirSync(dirname(marca), { recursive: true });
    writeFileSync(marca, "", { flag: "wx" });
  } catch {
    return null;
  }
  const cli = fileURLToPath(import.meta.url).replace(/\\/g, "/");
  return `neurodanza: para pedirle algo a la app como una persona no hace falta escribir el login: node "${cli}" api <METODO> <ruta> --como <persona|ROL|admin> [--cuerpo '<json>'] (entra, guarda la sesión y muestra la respuesta compacta). Lint, tipos y pruebas de un repo: node "${cli}" verificar --repo <repo> --archivos <a,b>.`;
}

/** Comandos repetidos que todavía no son macro ni se descartaron. */
export function sugeridas(cfg) {
  const min = cfg.cli?.repetidoVeces ?? 3;
  const data = leerJson(archivoRepetidos(cfg), { comandos: {} });
  return Object.entries(data.comandos)
    .filter(([, e]) => e.veces >= min && !e.descartado && !e.macro)
    .sort((a, b) => b[1].veces - a[1].veces)
    .map(([id, e]) => ({ id, veces: e.veces, caracteres: e.ejemplo.length, ejemplo: e.ejemplo }));
}

/** Guarda un comando repetido como macro (en git, para todo el equipo). Las partes que cambian se marcan con {variable}. */
export function aceptar(cfg, { id, nombre, descripcion = "", comando = null, ahora = Date.now() }) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(nombre ?? ""))) throw new Error("--nombre: minúsculas, números y guiones (2 a 41 caracteres).");
  const rep = leerJson(archivoRepetidos(cfg), { comandos: {} });
  const e = rep.comandos[id];
  if (!e && !comando) throw new Error(`no hay un comando repetido con id ${id} (node app.mjs sugeridas).`);
  const m = leerMacros(cfg);
  if (m.macros[nombre]) throw new Error(`ya existe la macro ${nombre}.`);
  m.macros[nombre] = { comando: comando ?? e.ejemplo, descripcion, creada: new Date(ahora).toISOString().slice(0, 10), usos: 0, ultimoUso: null, origen: id ?? null };
  guardarJson(archivoMacros(cfg), m);
  if (e) {
    e.macro = nombre;
    guardarJson(archivoRepetidos(cfg), rep);
  }
  return m.macros[nombre];
}

/** No vuelve a proponer ese comando. */
export function descartar(cfg, id) {
  const rep = leerJson(archivoRepetidos(cfg), { comandos: {} });
  if (!rep.comandos[id]) throw new Error(`no hay un comando repetido con id ${id}.`);
  rep.comandos[id].descartado = true;
  guardarJson(archivoRepetidos(cfg), rep);
}

/** Cuenta un uso de la macro. */
export function usarMacro(cfg, nombre, ahora = Date.now()) {
  const m = leerMacros(cfg);
  const x = m.macros[nombre];
  if (!x) throw new Error(`no hay una macro «${nombre}». Macros: ${Object.keys(m.macros).join(", ") || "ninguna"}.`);
  x.usos = (x.usos ?? 0) + 1;
  x.ultimoUso = new Date(ahora).toISOString().slice(0, 10);
  guardarJson(archivoMacros(cfg), m);
  return x;
}

/** Macros sin uso en `cli.podarDias` días (desde su último uso o desde que se crearon). */
export function podar(cfg, ahora = Date.now()) {
  const dias = cfg.cli?.podarDias ?? 30;
  return Object.entries(leerMacros(cfg).macros)
    .filter(([, x]) => (ahora - Date.parse(x.ultimoUso ?? x.creada)) / 86_400_000 > dias)
    .map(([nombre, x]) => ({ nombre, usos: x.usos ?? 0, ultimoUso: x.ultimoUso ?? null, creada: x.creada }));
}

export function borrar(cfg, nombre) {
  const m = leerMacros(cfg);
  if (!m.macros[nombre]) throw new Error(`no hay una macro «${nombre}».`);
  delete m.macros[nombre];
  guardarJson(archivoMacros(cfg), m);
}

/** Si un comando de terminal llama a una macro, el comando que de verdad corre (para que la barrera lo juzgue). */
export function comandoDeMacro(cfg, cmd) {
  const m = String(cmd).match(/\bapp\.mjs["']?\s+macro\s+([a-z0-9-]+)((?:\s+--\w+\s+("[^"]*"|'[^']*'|\S+))*)/);
  if (!m) return null;
  const x = leerMacros(cfg).macros[m[1]];
  if (!x) return null;
  const valores = {};
  for (const v of m[2].matchAll(/--(\w+)\s+("([^"]*)"|'([^']*)'|(\S+))/g)) valores[v[1]] = v[3] ?? v[4] ?? v[5];
  try {
    return expandirMacro(x, valores);
  } catch {
    return x.comando;
  }
}

// ───────────────────────── CLI ─────────────────────────

function args(argv) {
  const pos = [];
  const op = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      op[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else pos.push(argv[i]);
  }
  return { pos, op };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const [cmd, ...resto] = process.argv.slice(2);
  const { pos, op } = args(resto);
  try {
    if (cmd === "estado") {
      const vistas = [];
      for (const u of cfg.app?.urls ?? []) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(4000) });
          vistas.push(`${u} → HTTP ${r.status}`);
        } catch (e) {
          vistas.push(`${u} → ${e?.cause?.code ?? e?.name ?? "sin respuesta"}`);
        }
      }
      console.log(vistas.join("\n") || "no hay app.urls");
      process.exitCode = vistas.some((v) => /HTTP [23]/.test(v)) ? 0 : 1;
    } else if (cmd === "login") {
      const s = await token(cfg, op.como, { forzar: true });
      console.log(`sesión de ${s.quien} lista (vale ${cfg.cli?.sesionMin ?? 10} min; el token no se muestra).`);
    } else if (cmd === "api") {
      const [metodo, ruta] = pos;
      if (!metodo || !ruta) throw new Error("uso: api <METODO> <ruta> [--como <persona|ROL|admin>] [--cuerpo <json>]");
      const r = await api(cfg, { metodo: metodo.toUpperCase(), ruta, como: op.como, cuerpo: op.cuerpo });
      console.log(compacto(r, Number(op.max ?? 2000)));
      process.exitCode = r.status < 400 ? 0 : 1;
    } else if (cmd === "abrir") {
      const [ruta] = pos;
      if (!ruta || !op.como) throw new Error("uso: abrir <ruta> --como <persona> [--salida <carpeta>]");
      const c = credenciales(cfg, op.como);
      const salida = op.salida ?? cfg.abs(".neurodanza/app/capturas");
      const r = spawnSync(process.execPath, [PANEL, "navegar", "--persona", c.quien, "--rutas", ruta, "--salida", salida], { cwd: cfg.root, encoding: "utf8", timeout: 120_000 });
      console.log(`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/).slice(-15).join("\n"));
      process.exit(r.status ?? 1);
    } else if (cmd === "verificar") {
      const r = await verificar(cfg, op.repo, op.archivos ? String(op.archivos).split(",").filter(Boolean) : []);
      console.log(r.texto);
      process.exitCode = r.ok ? 0 : 1;
    } else if (cmd === "macros") {
      const m = leerMacros(cfg).macros;
      const filas = Object.entries(m).map(([n, x]) => `${n}${variablesDe(x.comando).length ? ` ${variablesDe(x.comando).map((v) => `--${v} <…>`).join(" ")}` : ""} · ${x.descripcion || x.comando.slice(0, 80)} · ${x.usos ?? 0} usos`);
      console.log(filas.join("\n") || "no hay macros todavía: nacen de los comandos que se repiten (sugeridas).");
    } else if (cmd === "macro") {
      const [nombre] = pos;
      const x = usarMacro(cfg, nombre);
      const valores = Object.fromEntries(Object.entries(op).filter(([k]) => k !== "cwd"));
      const c = expandirMacro(x, valores);
      const r = spawnSync(c, { cwd: cfg.root, shell: true, encoding: "utf8", timeout: (cfg.barreras?.timeoutComandos?.maxSeg ?? 120) * 1000, maxBuffer: 20 * 1024 * 1024 });
      process.stdout.write(r.stdout ?? "");
      process.stderr.write(r.stderr ?? "");
      process.exit(r.status ?? 1);
    } else if (cmd === "sugeridas") {
      const s = sugeridas(cfg);
      console.log(s.length ? s.map((x) => `${x.id} · ${x.veces} veces · ${x.caracteres} caracteres\n  ${x.ejemplo.slice(0, 300)}`).join("\n") : "no hay comandos repetidos para proponer.");
    } else if (cmd === "aceptar") {
      const x = aceptar(cfg, { id: op.id, nombre: op.nombre, descripcion: op.descripcion ?? "", comando: typeof op.comando === "string" ? op.comando : null });
      console.log(`macro guardada en ${cfg.cli?.macros ?? ".claude/neurodanza-macros.json"}${variablesDe(x.comando).length ? ` (variables: ${variablesDe(x.comando).join(", ")})` : ""}. Úsala con: node app.mjs macro ${op.nombre}`);
    } else if (cmd === "descartar") {
      descartar(cfg, op.id);
      console.log(`no se volverá a proponer ${op.id}.`);
    } else if (cmd === "podar") {
      const p = podar(cfg);
      console.log(p.length ? p.map((x) => `${x.nombre} · ${x.usos} usos · último ${x.ultimoUso ?? "nunca"} (creada ${x.creada})`).join("\n") + "\nPropónle al usuario borrarlas: node app.mjs borrar --nombre <n>" : `ninguna macro lleva más de ${cfg.cli?.podarDias ?? 30} días sin uso.`);
    } else if (cmd === "borrar") {
      borrar(cfg, op.nombre);
      console.log(`macro ${op.nombre} borrada.`);
    } else {
      console.error("comandos: estado | login | api | abrir | verificar | macros | macro | sugeridas | aceptar | descartar | podar | borrar");
      process.exit(1);
    }
  } catch (e) {
    console.error(`app: ${e.message}`);
    process.exitCode = 1;
  }
}
