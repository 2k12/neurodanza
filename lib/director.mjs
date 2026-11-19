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
//   node director.mjs decidir --tarea <id> --hallazgos <json>   ¿corregir encima o rebobinar?
//   node director.mjs rebobinar --tarea <id> --memoria <json>   guarda la muerte y vuelve a la foto original con memoria
//   node director.mjs tareas                               tareas abiertas
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny } from "./config.mjs";
import { escribirAtomico } from "./procesos.mjs";
import { anotarManoTarea, MANOS } from "./figuras.mjs";
import { aplicarReflexion, cargar as cargarConstructos, guardar as guardarConstructos, playbookDe } from "./constructos.mjs";

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
  escribirAtomico(join(dirTareas(cfg), `${t.id}.json`), JSON.stringify(t, null, 2));
};

/** Agrega campos a una tarea abierta (p. ej. su contrato, para re-enfundar o rebobinar). */
export function anotarTarea(cfg, id, campos) {
  const t = leerTareas(cfg).find((x) => x.id === id);
  if (t) guardarTarea(cfg, { ...t, ...campos });
}

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
  const t = { id: tarea, objetivo, terminado, archivos, creada: new Date().toISOString(), repos: [] };
  for (const r of elegidos) t.repos.push(crearWorktree(cfg, r, tarea, snapshot(cfg.abs(r.ruta))));
  guardarTarea(cfg, t);
  return t;
}

/** Crea el worktree de una tarea en un repo desde un commit (la foto) y enlaza sus dependencias. */
function crearWorktree(cfg, r, tarea, commit) {
  const dir = cfg.abs(r.ruta);
  const ruta = join(baseWorktrees(cfg), tarea, r.nombre);
  mkdirSync(dirname(ruta), { recursive: true });
  git(["worktree", "add", "--detach", ruta, commit], dir);
  // Dependencias del repo real enlazadas (sin instalar): el implementador puede correr lint y pruebas.
  const enlaces = [];
  if ((cfg.director?.enlazar ?? ["node_modules"]).includes("node_modules")) {
    for (const nm of nodeModules(dir)) {
      const dst = join(ruta, nm);
      if (existsSync(dst)) continue;
      mkdirSync(dirname(dst), { recursive: true });
      symlinkSync(join(dir, nm), dst, "junction");
      enlaces.push(nm);
    }
  }
  return { nombre: r.nombre, ruta: norm(ruta), base: commit, enlaces };
}

// ───────────────────────── rebobinar con memoria ─────────────────────────

const OPC_REBOBINAR = { activo: true, umbralCorreccion: 0.5, maxMuertes: 2 };
const archivoMuertes = (cfg) => cfg.abs(".neurodanza/muertes.json");

export function leerMuertes(cfg) {
  try {
    return JSON.parse(readFileSync(archivoMuertes(cfg), "utf8"));
  } catch {
    return [];
  }
}

/**
 * ¿Corregir encima o rebobinar? (puro). Rebobinar si hay hallazgos altos o de diseño, muchos hallazgos o
 * archivos, o si la corrección estimada (`lineas` de cada hallazgo, 10 si no dice) supera
 * `umbralCorreccion` del diff original. Si no, corregir encima.
 */
export function decidir(hallazgos, lineasDiff, opciones = {}) {
  const o = { ...OPC_REBOBINAR, ...opciones };
  const hs = Array.isArray(hallazgos) ? hallazgos : [];
  const altos = hs.filter((h) => h.gravedad === "alta");
  if (altos.length) return { decision: "rebobinar", motivo: `${altos.length} hallazgo(s) alto(s): ${altos[0].problema ?? ""}`.trim() };
  const diseno = hs.filter((h) => h.diseno === true || /diseñ|arquitect|enfoque|estructura/i.test(h.problema ?? ""));
  if (diseno.length) return { decision: "rebobinar", motivo: `problema de diseño: ${diseno[0].problema ?? ""}`.trim() };
  const archivos = new Set(hs.map((h) => h.archivo).filter(Boolean));
  if (hs.length > 5 || archivos.size > 3) return { decision: "rebobinar", motivo: `${hs.length} hallazgos en ${archivos.size} archivos: no es una corrección puntual` };
  const estimado = hs.reduce((n, h) => n + (Number(h.lineas) || 10), 0);
  if (lineasDiff > 0 && estimado > o.umbralCorreccion * lineasDiff) return { decision: "rebobinar", motivo: `la corrección estimada (${estimado} líneas) supera ${Math.round(o.umbralCorreccion * 100)} % del diff original (${lineasDiff} líneas)` };
  return { decision: "corregir", motivo: hs.length ? `${hs.length} hallazgo(s) puntual(es) en ${archivos.size || 1} archivo(s): corregir encima` : "sin hallazgos" };
}

/** Líneas cambiadas (+ y −) de los worktrees de una tarea contra su foto. */
export function lineasTarea(t) {
  let n = 0;
  for (const r of t.repos) {
    git(["add", "-A"], r.ruta);
    if (r.enlaces?.length) gitOk(["reset", "-q", "--", ...r.enlaces], r.ruta);
    for (const l of git(["diff", "--cached", "--numstat", r.base], r.ruta).split(/\r?\n/).filter(Boolean)) n += l.split("\t").slice(0, 2).reduce((a, x) => a + (Number(x) || 0), 0);
  }
  return n;
}

/** Sección del contrato con los intentos anteriores (corta, sin el diff: queda disponible por ruta). */
export function intentosAnteriores(muertes) {
  if (!muertes.length) return "";
  return [
    "## Intentos anteriores y por qué fallaron (no repitas el mismo camino)",
    ...muertes.flatMap((m) => [
      `- Intento ${m.n}: ${m.motivo || "reprobado"}`,
      ...(m.hallazgos ?? []).slice(0, 5).map((h) => `  · ${h.gravedad ? `[${h.gravedad}] ` : ""}${h.problema ?? h}${h.archivo ? ` (${h.archivo})` : ""}`),
      ...(m.notas ?? []).slice(0, 3).map((x) => `  · persona: ${x}`),
      `  · diff de ese intento (por si necesitas ver qué se probó): ${m.patch}`,
    ]),
  ].join("\n");
}

const slug = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sin-detalle";

/** Una muerte como evidencia contra el constructo que la causó (formato de la reflexión de constructos). */
export function reflexionDeMuerte(m) {
  const constructo = m.constructo || "implementador";
  const hs = (m.hallazgos ?? []).length ? m.hallazgos : [{ problema: m.motivo || "intento reprobado" }];
  return {
    ciclo: `muerte-${m.tarea}-${m.n}`,
    agentes: [{ constructo, terminado: false }],
    problemas: hs.map((h) => ({ constructo: h.constructo ?? constructo, etiqueta: h.etiqueta ?? `muerte:${slug(h.problema ?? h)}`, fuente: "rebobinar", detalle: String(h.problema ?? h).slice(0, 300), leccion: h.leccion ?? h.arreglo ?? `Evitar: ${h.problema ?? h}` })),
  };
}

/**
 * Rebobina una tarea: guarda el diff fallido, registra la muerte (y la pasa a los constructos), descarta
 * el worktree y lo vuelve a crear desde la MISMA foto, con un contrato que trae los intentos anteriores.
 * Al llegar a `maxMuertes` no rebobina: hay que informar al usuario.
 */
export function rebobinar(cfg, id, memoria = {}) {
  const o = { ...OPC_REBOBINAR, ...(cfg.director?.rebobinar ?? {}) };
  if (!o.activo) throw new Error("director.rebobinar.activo es false: corrige encima o informa al usuario");
  const t = leerTareas(cfg).find((x) => x.id === id);
  if (!t) throw new Error(`no hay una tarea ${id} abierta`);
  const todas = leerMuertes(cfg);
  const previas = todas.filter((m) => m.tarea === id);
  if (previas.length >= o.maxMuertes) return { ok: false, tope: true, muertes: previas.length, motivo: `la tarea ${id} ya se rebobinó ${previas.length} vez/veces (director.rebobinar.maxMuertes = ${o.maxMuertes}): no se rebobina otra vez; informa al usuario con los intentos y sus hallazgos` };
  const n = previas.length + 1;
  const dirMuertes = cfg.abs(".neurodanza/muertes");
  mkdirSync(dirMuertes, { recursive: true });
  const partes = t.repos.map((r) => ({ r, ...diffDe(r) }));
  const patch = join(dirMuertes, `${id}-${n}.patch`);
  escribirAtomico(patch, partes.map((p) => `# repo: ${p.r.nombre}\n${p.patch}`).join("\n"));
  const muerte = {
    tarea: id,
    n,
    fecha: new Date().toISOString(),
    motivo: String(memoria.motivo ?? ""),
    hallazgos: memoria.hallazgos ?? [],
    notas: memoria.notas ?? [],
    archivos: partes.flatMap((p) => p.files.map((f) => `${p.r.nombre}/${f}`)),
    constructo: memoria.constructo ?? t.constructo ?? "implementador",
    patch: norm(relative(cfg.root, patch)),
  };
  mkdirSync(cfg.abs(".neurodanza"), { recursive: true });
  escribirAtomico(archivoMuertes(cfg), JSON.stringify([...todas, muerte], null, 2));
  try {
    const data = cargarConstructos(cfg);
    aplicarReflexion(data, reflexionDeMuerte(muerte), cfg.constructos ?? {});
    guardarConstructos(cfg, data);
  } catch {
    /* los constructos son una ayuda: el rebobinado sigue */
  }
  // Mismo worktree, misma foto: lo que había antes de la tarea, sin el intento fallido.
  const repos = t.repos.map((r) => {
    borrarWorktree(cfg, r);
    return crearWorktree(cfg, cfg.repos.find((x) => x.nombre === r.nombre), id, r.base);
  });
  const base = t.contratoBase ?? t.contrato ?? "";
  const contratoNuevo = [base, "", intentosAnteriores([...previas, muerte])].join("\n").trim();
  guardarTarea(cfg, { ...t, repos, contratoBase: base, contrato: contratoNuevo, intento: n + 1 });
  return { ok: true, tarea: id, muerte: n, repos: repos.map(({ nombre, ruta }) => ({ nombre, ruta })), contrato: contratoNuevo };
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
      const texto = contrato({ ...t, tarea: t.id, maxPasos: max, constructo: nombre, lecciones });
      // El contrato queda en la tarea: lo usan re-enfundar (pilas) y rebobinar.
      anotarTarea(cfg, t.id, { contrato: texto, constructo: nombre, maxPasos: max });
      // La mano de la tarea va a la tabla de figuras (que ningún agente puede escribir).
      const mano = arg("mano") ? arg("mano").split(",").filter(Boolean) : cfg.figuras?.manos?.implementador ?? MANOS.implementador;
      anotarManoTarea(cfg, t.id, mano);
      out({ tarea: t.id, constructo: nombre, repos: t.repos.map(({ nombre: n, ruta }) => ({ nombre: n, ruta })), contrato: texto });
    } else if (cmd === "integrar") {
      const r = integrar(cfg, arg("tarea"), { forzar: process.argv.includes("--forzar") });
      out(r);
      if (!r.ok) process.exit(1);
    } else if (cmd === "descartar") out(descartar(cfg, arg("tarea")));
    else if (cmd === "decidir") {
      const t = leerTareas(cfg).find((x) => x.id === arg("tarea"));
      if (!t) throw new Error(`no hay una tarea ${arg("tarea")} abierta`);
      const hallazgos = JSON.parse(readFileSync(arg("hallazgos"), "utf8"));
      const lineas = lineasTarea(t);
      out({ tarea: t.id, lineasDiff: lineas, ...decidir(Array.isArray(hallazgos) ? hallazgos : hallazgos.hallazgos ?? [], lineas, cfg.director?.rebobinar) });
    } else if (cmd === "rebobinar") {
      const r = rebobinar(cfg, arg("tarea"), arg("memoria") ? JSON.parse(readFileSync(arg("memoria"), "utf8")) : {});
      out(r);
      if (!r.ok) process.exit(1);
    }
    else {
      console.error("Uso: director.mjs activar | desactivar | estado | tareas | preparar --tarea <id> --repos a,b --archivos \"a:glob,…\" | integrar --tarea <id> [--forzar] | descartar --tarea <id>");
      process.exit(1);
    }
  } catch (e) {
    console.error(`director: ${e.message}`);
    process.exit(1);
  }
}

