#!/usr/bin/env node
// neurodanza · modo director. El agente principal dirige (planifica, delega, integra) y no edita;
// cada tarea la hace un implementador en su propio worktree, con un contrato: qué archivos le
// pertenecen, cuándo está terminada y su presupuesto. Ver docs/13-director.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node director.mjs activar | desactivar | estado
//   node director.mjs preparar --tarea <id> --repos backend,frontend --archivos "backend:src/pedidos/**,frontend:app/pedidos/**" [--objetivo "…"] [--constructo implementador-backend]
//   node director.mjs integrar --tarea <id> [--forzar]     aplica el diff del worktree al repo real y lo borra
//   node director.mjs descartar --tarea <id>               borra el worktree sin integrar
//   node director.mjs tareas                               tareas abiertas
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny } from "./config.mjs";
import { cargar as cargarConstructos, playbookDe } from "./constructos.mjs";

const norm = (p) => String(p ?? "").replace(/\\/g, "/");
const dirDirector = (cfg) => cfg.abs(".neurodanza/director");
const archivoModo = (cfg) => join(dirDirector(cfg), "modo.json");
const dirTareas = (cfg) => join(dirDirector(cfg), "tareas");

// ───────────────────────── funciones puras ─────────────────────────

/** Id de tarea válido: letras, números y guiones. */
export const tareaValida = (id) => /^[a-z0-9][a-z0-9-]{0,39}$/i.test(String(id ?? ""));

/** `"backend:src/**,frontend:app/x/**"` → `{ backend: ["src/**"], frontend: ["app/x/**"] }`. */
export function parseArchivos(spec) {
  const out = {};
  for (const part of String(spec ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [repo, glob] = part.includes(":") ? part.split(/:(.+)/) : ["*", part];
    (out[repo] ??= []).push(glob);
  }
  return out;
}

/** Archivos cambiados que el contrato no le da a la tarea (`*` vale para cualquier repo). */
export function fueraDeContrato(repo, files, archivos) {
  const globs = [...(archivos[repo] ?? []), ...(archivos["*"] ?? [])];
  if (globs.length === 0) return [];
  return files.filter((f) => !matchesAny(f, globs));
}

/** ¿La raíz del proyecto es ella misma un repo git? (en un proyecto de varios repos, no suele serlo) */
export const raizEsRepo = (cfg) => existsSync(join(cfg.root, ".git"));

/**
 * Carpeta base de los worktrees (`director.worktrees`, con `{proyecto}`). Con `"auto"` (por defecto):
 * si la raíz no es un repo, dentro del proyecto (`.neurodanza/wt`: ningún repo la ve y no pide
 * permisos); si lo es, al lado del proyecto, para que el lint y las pruebas del repo no la recorran.
 */
export function baseWorktrees(cfg) {
  const tpl = cfg.director?.worktrees ?? "auto";
  if (tpl === "auto") return raizEsRepo(cfg) ? resolve(cfg.root, "..", ".neurodanza-wt", basename(cfg.root)) : join(cfg.root, ".neurodanza", "wt");
  return resolve(cfg.root, tpl.replace("{proyecto}", basename(cfg.root)));
}

/** ¿Los worktrees quedan fuera de la carpeta del proyecto? (entonces Claude Code pide permiso para editarlos) */
export const worktreesFuera = (cfg) => !norm(baseWorktrees(cfg)).toLowerCase().startsWith(norm(cfg.root).toLowerCase() + "/");

/**
 * Ruta absoluta con `/`. Una ruta de Windows (`C:\…`, `C:/…`) se respeta en cualquier sistema (en
 * Linux `resolve` la tomaría por relativa); en Windows no distingue mayúsculas.
 */
export function absoluta(p) {
  const s = norm(p);
  const abs = /^[a-z]:\//i.test(s) || s.startsWith("/") ? s : norm(resolve(p));
  return abs.replace(/\/+$/, "");
}

/** Tarea y repo a los que pertenece una ruta, si está dentro de un worktree de una tarea abierta. */
export function enWorktree(tareas, file) {
  const f = absoluta(file);
  for (const t of tareas) {
    for (const r of t.repos ?? []) {
      const wt = absoluta(r.ruta);
      const igual = (a, b) => (/^[a-z]:\//i.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b);
      if (igual(f, wt) || igual(f.slice(0, wt.length + 1), wt + "/")) return { tarea: t, repo: r, rel: f.slice(wt.length + 1) };
    }
  }
  return null;
}

/** Texto del contrato para el mensaje del implementador. */
export function contrato({ tarea, objetivo, repos, archivos, terminado, maxPasos, constructo = "implementador", lecciones = "" }) {
  const lineas = [
    `## Contrato · tarea ${tarea}`,
    `Constructo: ${constructo} (en la reflexión al cerrar, los problemas de esta tarea se anotan a su nombre)`,
    `Objetivo: ${objetivo || "(ver mensaje)"}`,
    "Trabaja SOLO en estas carpetas (son worktrees; el repo real no se toca):",
    ...repos.map((r) => `- ${r.nombre}: ${r.ruta}`),
    "Archivos que te pertenecen (fuera de ellos, la barrera te bloquea):",
    ...Object.entries(archivos).map(([repo, globs]) => `- ${repo}: ${globs.join(", ")}`),
    `Terminado cuando: ${terminado || "(ver mensaje)"}`,
    `Presupuesto: ${maxPasos} pasos; si llegas, entrega lo que tengas.`,
    "No hagas commit ni cambies de rama: el director integra tu diff.",
    'Responde al final solo este JSON: { "tarea": "…", "terminado": true|false, "archivos": ["…"], "verificado": "qué corriste y resultado", "pendiente": "…", "notas": "…" }',
  ];
  if (lecciones) lineas.push("", lecciones);
  return lineas.join("\n");
}

// ───────────────────────── git ─────────────────────────

function git(args, cwd, env) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env, maxBuffer: 64 * 1024 * 1024 });
}

function gitOk(args, cwd, env) {
  try {
    return { ok: true, out: git(args, cwd, env) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || String(e.message) };
  }
}

/**
 * Foto del estado actual del repo (HEAD + cambios sin commit + archivos nuevos no ignorados) como
 * un commit suelto, sin tocar la rama, el índice ni los archivos.
 */
export function snapshot(dir) {
  const idx = join(tmpdir(), `nd-idx-${randomBytes(6).toString("hex")}`);
  const who = { GIT_AUTHOR_NAME: "neurodanza", GIT_AUTHOR_EMAIL: "neurodanza@localhost", GIT_COMMITTER_NAME: "neurodanza", GIT_COMMITTER_EMAIL: "neurodanza@localhost" };
  const env = { GIT_INDEX_FILE: idx, ...who };
  try {
    git(["read-tree", "HEAD"], dir, env);
    git(["add", "-A"], dir, env);
    const tree = git(["write-tree"], dir, env).trim();
    return git(["commit-tree", tree, "-p", "HEAD", "-m", "neurodanza: base de tarea"], dir, env).trim();
  } finally {
    rmSync(idx, { force: true });
  }
}

/** Carpetas `node_modules` del repo (hasta 4 niveles, sin entrar en ellas ni en .git). */
function nodeModules(dir, rel = "", depth = 0, out = []) {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ".git") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.name === "node_modules") out.push(r);
    else if (!e.name.startsWith(".")) nodeModules(dir, r, depth + 1, out);
  }
  return out;
}

/** Quita un enlace (junction o symlink) sin tocar a dónde apunta. */
function quitarEnlace(p) {
  try {
    if (!lstatSync(p).isSymbolicLink() && process.platform !== "win32") return;
  } catch {
    return;
  }
  try {
    unlinkSync(p);
  } catch {
    try {
      rmdirSync(p);
    } catch {
      /* ya no está */
    }
  }
}

// ───────────────────────── tareas ─────────────────────────

export function leerTareas(cfg) {
  const dir = dirTareas(cfg);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const guardarTarea = (cfg, t) => {
  mkdirSync(dirTareas(cfg), { recursive: true });
  writeFileSync(join(dirTareas(cfg), `${t.id}.json`), JSON.stringify(t, null, 2));
};

export function leerModo(cfg) {
  try {
    return JSON.parse(readFileSync(archivoModo(cfg), "utf8"));
  } catch {
    return { activo: false };
  }
}

export function preparar(cfg, { tarea, repos, archivos, objetivo = "", terminado = "" }) {
  if (!tareaValida(tarea)) throw new Error(`id de tarea inválido: «${tarea}» (letras, números y guiones)`);
  if (existsSync(join(dirTareas(cfg), `${tarea}.json`))) throw new Error(`la tarea ${tarea} ya existe: intégrala o descártala`);
  const elegidos = repos.map((n) => {
    const r = cfg.repos.find((x) => x.nombre === n);
    if (!r) throw new Error(`no hay un repo «${n}» en neurodanza.config.json`);
    return r;
  });
  const base = baseWorktrees(cfg);
  const enlazar = cfg.director?.enlazar ?? ["node_modules"];
  const t = { id: tarea, objetivo, terminado, archivos, creada: new Date().toISOString(), repos: [] };
  for (const r of elegidos) {
    const dir = cfg.abs(r.ruta);
    const commit = snapshot(dir);
    const ruta = join(base, tarea, r.nombre);
    mkdirSync(dirname(ruta), { recursive: true });
    git(["worktree", "add", "--detach", ruta, commit], dir);
    // Dependencias del repo real enlazadas (sin instalar): el implementador puede correr lint y pruebas.
    const enlaces = [];
    if (enlazar.includes("node_modules")) {
      for (const nm of nodeModules(dir)) {
        const dst = join(ruta, nm);
        if (existsSync(dst)) continue;
        mkdirSync(dirname(dst), { recursive: true });
        symlinkSync(join(dir, nm), dst, "junction");
        enlaces.push(nm);
      }
    }
    t.repos.push({ nombre: r.nombre, ruta: norm(ruta), base: commit, enlaces });
  }
  guardarTarea(cfg, t);
  return t;
}

/** Diff de un worktree contra su base (sin los enlaces de dependencias) y archivos tocados. */
function diffDe(r) {
  git(["add", "-A"], r.ruta);
  // Los enlaces de dependencias suelen estar en .gitignore; si alguno no, se saca del índice.
  if (r.enlaces?.length) gitOk(["reset", "-q", "--", ...r.enlaces], r.ruta);
  const files = git(["diff", "--cached", "--name-only", r.base], r.ruta).split(/\r?\n/).filter(Boolean);
  const patch = files.length ? git(["diff", "--cached", "--binary", r.base], r.ruta) : "";
  return { files, patch };
}

function borrarWorktree(cfg, r) {
  const real = cfg.repos.find((x) => x.nombre === r.nombre);
  for (const e of r.enlaces ?? []) quitarEnlace(join(r.ruta, e));
  if (real) gitOk(["worktree", "remove", "--force", r.ruta], cfg.abs(real.ruta));
  if (existsSync(r.ruta)) rmSync(r.ruta, { recursive: true, force: true });
  if (real) gitOk(["worktree", "prune"], cfg.abs(real.ruta));
}

export function integrar(cfg, id, { forzar = false } = {}) {
  const t = leerTareas(cfg).find((x) => x.id === id);
  if (!t) throw new Error(`no hay una tarea ${id} abierta`);
  const diffs = t.repos.map((r) => ({ r, ...diffDe(r) }));
  const fuera = diffs.flatMap(({ r, files }) => fueraDeContrato(r.nombre, files, t.archivos).map((f) => `${r.nombre}/${f}`));
  if (fuera.length && !forzar) return { ok: false, motivo: "fuera del contrato", fuera, archivos: diffs.flatMap((d) => d.files.map((f) => `${d.r.nombre}/${f}`)) };
  const aplicados = [];
  for (const { r, files, patch } of diffs) {
    if (!files.length) continue;
    const real = cfg.repos.find((x) => x.nombre === r.nombre);
    const dir = cfg.abs(real.ruta);
    const tmp = join(tmpdir(), `nd-${createHash("sha1").update(r.ruta).digest("hex").slice(0, 8)}.patch`);
    writeFileSync(tmp, patch);
    let a = gitOk(["apply", "--whitespace=nowarn", tmp], dir);
    if (!a.ok) a = gitOk(["apply", "--3way", "--whitespace=nowarn", tmp], dir);
    rmSync(tmp, { force: true });
    if (!a.ok) return { ok: false, motivo: "conflicto al aplicar", repo: r.nombre, detalle: a.out.split(/\r?\n/).slice(-15).join("\n"), aplicados };
    aplicados.push(...files.map((f) => `${r.nombre}/${f}`));
  }
  for (const r of t.repos) borrarWorktree(cfg, r);
  rmSync(join(dirTareas(cfg), `${id}.json`), { force: true });
  return { ok: true, aplicados, fuera };
}

export function descartar(cfg, id) {
  const t = leerTareas(cfg).find((x) => x.id === id);
  if (!t) throw new Error(`no hay una tarea ${id} abierta`);
  for (const r of t.repos) borrarWorktree(cfg, r);
  rmSync(join(dirTareas(cfg), `${id}.json`), { force: true });
  return { ok: true };
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
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  try {
    const cmd = process.argv[2];
    if (cmd === "activar" || cmd === "desactivar") {
      mkdirSync(dirDirector(cfg), { recursive: true });
      writeFileSync(archivoModo(cfg), JSON.stringify({ activo: cmd === "activar", desde: new Date().toISOString() }));
      out({ modo: cmd === "activar" ? "director" : "normal", worktrees: norm(baseWorktrees(cfg)) });
    } else if (cmd === "estado") out({ ...leerModo(cfg), tareas: leerTareas(cfg).map((t) => t.id), worktrees: norm(baseWorktrees(cfg)) });
    else if (cmd === "tareas") out(leerTareas(cfg));
    else if (cmd === "preparar") {
      const t = preparar(cfg, { tarea: arg("tarea"), repos: String(arg("repos") ?? "").split(",").filter(Boolean), archivos: parseArchivos(arg("archivos")), objetivo: arg("objetivo") ?? "", terminado: arg("terminado") ?? "" });
      const max = cfg.ciclo?.maxPasos?.implementador ?? 60;
      // El playbook del constructo viaja en el contrato: el implementador arranca con lo aprendido.
      const nombre = arg("constructo") ?? "implementador";
      const lecciones = playbookDe(cfg, cargarConstructos(cfg), nombre);
      out({ tarea: t.id, constructo: nombre, repos: t.repos.map(({ nombre: n, ruta }) => ({ nombre: n, ruta })), contrato: contrato({ ...t, tarea: t.id, maxPasos: max, constructo: nombre, lecciones }) });
    } else if (cmd === "integrar") {
      const r = integrar(cfg, arg("tarea"), { forzar: process.argv.includes("--forzar") });
      out(r);
      if (!r.ok) process.exit(1);
    } else if (cmd === "descartar") out(descartar(cfg, arg("tarea")));
    else {
      console.error("Uso: director.mjs activar | desactivar | estado | tareas | preparar --tarea <id> --repos a,b --archivos \"a:glob,…\" | integrar --tarea <id> [--forzar] | descartar --tarea <id>");
      process.exit(1);
    }
  } catch (e) {
    console.error(`director: ${e.message}`);
    process.exit(1);
  }
}

