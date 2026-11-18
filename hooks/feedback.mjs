#!/usr/bin/env node
// neurodanza · ciclo de retroalimentación.
//   node feedback.mjs post  → PostToolUse: lint del archivo recién editado (error = se lo muestra al agente)
//   node feedback.mjs stop  → Stop: no deja terminar si lo cambiado no pasa lint, tipos, pruebas
//                             relacionadas o la definición de terminado del proyecto. Corre las
//                             comprobaciones en paralelo y no repite las de un repo que no cambió
//                             desde la última vez (caché por firma del cambio).
//   node feedback.mjs inicio → SessionStart: carga los errores conocidos del proyecto como contexto.
// Todo sale de `neurodanza.config.json`; sin ese archivo no hace nada. Ver docs/05-retroalimentacion.md.
import { exec, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny, repoOf } from "../lib/config.mjs";
import { autoconfigurar } from "../lib/autoconfig.mjs";
import { enWorktree, leerTareas } from "../lib/director.mjs";
import { cerrarRondaActiva } from "../panel/panel.mjs";
import { archivoDe, load as loadErrores, registrarEnProyecto, top } from "../lib/errores.mjs";

const norm = (p) => String(p ?? "").replace(/\\/g, "/");
const tail = (s, n = 25) => String(s).split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");

function sh(cmd, cwd, timeout = 240_000) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || String(e.message) };
  }
}

/** Igual que `sh`, pero sin bloquear: permite correr lint, tipos y pruebas a la vez. */
function shAsync(cmd, cwd, timeout = 240_000) {
  const t0 = Date.now();
  return new Promise((res) => {
    exec(cmd, { cwd, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const ms = Date.now() - t0;
      if (!err) return res({ ok: true, out: stdout, ms });
      res({ ok: false, out: `${stdout ?? ""}${stderr ?? ""}`.trim() || String(err.message), ms });
    });
  });
}

/** Archivos con cambios sin commit (incluye nuevos; excluye borrados). */
export function parseStatus(porcelain) {
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l.length > 3 && !/^( D|D )/.test(l))
    .map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""))
    .filter((f) => !f.endsWith("/"));
}

/** ¿Algún archivo cambiado coincide con `repo:glob` (o `glob` = cualquier repo)? */
export function changedMatching(changes, specs = []) {
  const out = [];
  for (const spec of specs) {
    const [repo, glob] = spec.includes(":") ? spec.split(/:(.+)/) : [null, spec];
    for (const [name, files] of Object.entries(changes)) {
      if (repo && repo !== name) continue;
      out.push(...files.filter((f) => matchesAny(f, [glob])).map((f) => `${name}/${f}`));
    }
  }
  return [...new Set(out)];
}

const quote = (files) => files.map((f) => `"${f}"`).join(" ");
const minor = (v) => String(v).split(".").slice(0, 2).join(".");
const versionOf = (json) => {
  try {
    return JSON.parse(json).version ?? "";
  } catch {
    return "";
  }
};

/** ¿Hay en `dir` un JSON de esta versión que cumpla `ok`? (evaluaciones del panel o de evals) */
export function approvedFor(dir, version, ok) {
  if (!dir || !existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const e = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (e.version === version && ok(e)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Reglas de la definición de terminado (puras, para poder probarlas).
 * @returns {{hard: string[], soft: string[]}}
 */
export function doneProblems(cfg, changes, ctx) {
  const rf = cfg.retroalimentacion;
  const hard = [];
  const soft = [];
  const v = rf.version;
  if (v && ctx.version && ctx.baseVersion) {
    const src = changedMatching(changes, v.cambios ?? []);
    if (src.length > 0 && ctx.version === ctx.baseVersion) {
      hard.push(`${v.repo}: hay cambios de código y la versión sigue en ${ctx.version} (igual que ${v.ramaBase ?? "main"}). Sube ${v.archivo} (feat → minor, fix → patch).`);
    }
    if (rf.bitacora && ctx.version !== ctx.baseVersion && !ctx.bitacoraExists(rf.bitacora.archivo.replace("{minor}", minor(ctx.version)).replace("{version}", ctx.version))) {
      hard.push(`docs: falta la bitácora de la versión ${minor(ctx.version)} en ${rf.bitacora.ruta}.`);
    }
  }
  const m = rf.migraciones;
  if (m && (changes[m.repo] ?? []).includes(m.schema) && !(changes[m.repo] ?? []).some((f) => matchesAny(f, [m.nuevas]))) {
    hard.push(`${m.repo}: cambió ${m.schema} sin una migración nueva.`);
  }
  const screens = changedMatching(changes, rf.pantallas);
  if (screens.length > 0 && ctx.version && !ctx.panelApproved(ctx.version)) {
    hard.push(`panel de personas: cambiaste pantallas y no hay una evaluación aprobada (promedio > ${cfg.panel.umbral}) de la versión ${ctx.version}. Sigue el paso 4 de /neurodanza-feature.`);
  }
  if (screens.length > 0 && rf.guias && changedMatching(changes, [rf.guias]).length === 0) {
    soft.push(`cambiaste pantallas (${screens.slice(0, 3).join(", ")}${screens.length > 3 ? "…" : ""}) sin tocar su guía de usuario. Si cambió lo que ve o hace el usuario, actualízala; si no, ignora este aviso.`);
  }
  const tooling = changedMatching(changes, cfg.evals.vigilar ?? []);
  if (tooling.length > 0 && ctx.version && !ctx.evalsApproved(ctx.version)) {
    soft.push(`evals: cambiaste agentes, personas o skills (${tooling.slice(0, 2).join(", ")}${tooling.length > 2 ? "…" : ""}) y no hay evals aprobadas de la versión ${ctx.version}. Corre /neurodanza-evals.`);
  }
  // Solo cuenta código (repos[].codigo); un AGENTS.md o un README no exigen docs. Los docs ya
  // commiteados en la rama (ctx.docsInBranch) también cuentan.
  const codeChanged = cfg.repos.some(
    (r) => r.nombre !== rf.docs && (changes[r.nombre] ?? []).some((f) => matchesAny(f, r.codigo ?? []) && !matchesAny(f, r.ignorar ?? [])),
  );
  if (rf.docs && codeChanged && (changes[rf.docs] ?? []).length === 0 && !ctx.docsInBranch) {
    soft.push(`docs: hay cambios de código y ninguno en ${rf.docs}. Revisa la definición de terminado.`);
  }
  return { hard, soft };
}

/** ¿El repo de docs tiene commits en la rama actual que no están en la rama base? */
function docsCommittedInBranch(cfg) {
  const docs = cfg.repos.find((r) => r.nombre === cfg.retroalimentacion.docs);
  if (!docs) return false;
  const dir = cfg.abs(docs.ruta);
  const base = cfg.retroalimentacion.version?.ramaBase ?? "main";
  for (const ref of [`origin/${base}`, base]) {
    const r = sh(`git rev-list --count ${ref}..HEAD`, dir, 10_000);
    if (r.ok) return Number(r.out.trim()) > 0;
  }
  return false;
}

function changesOf(cfg) {
  const out = {};
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta);
    if (!existsSync(join(dir, ".git"))) continue;
    const s = sh("git status --porcelain --untracked-files=all", dir, 20_000);
    out[r.nombre] = s.ok ? parseStatus(s.out) : [];
  }
  return out;
}

/** Lint, tipos y pruebas relacionadas de un repo, a la vez. Devuelve problemas y tiempos. */
async function codeChecks(cfg, repo, files) {
  const dir = cfg.abs(repo.ruta);
  const code = files.filter((f) => matchesAny(f, repo.codigo ?? []) && !matchesAny(f, repo.ignorar ?? []));
  if (code.length === 0) return { problems: [], pasos: [] };
  const lintable = repo.lintGlobs ? code.filter((f) => matchesAny(f, repo.lintGlobs)) : code;
  const none = new RegExp(repo.sinPruebas ?? "No tests found|No test files found", "i");
  const jobs = [];
  if (repo.lint && lintable.length > 0) jobs.push({ paso: "lint", run: shAsync(repo.lint.replace("{archivos}", quote(lintable)), dir), n: 25 });
  if (repo.tipos) jobs.push({ paso: "tipos", run: shAsync(repo.tipos, dir), n: 25 });
  if (repo.relacionadas) jobs.push({ paso: "pruebas", run: shAsync(repo.relacionadas.replace("{archivos}", quote(code)), dir, 300_000), n: 30, none });
  const problems = [];
  const pasos = [];
  for (const j of jobs) {
    const r = await j.run;
    const ok = r.ok || Boolean(j.none?.test(r.out));
    pasos.push({ repo: repo.nombre, paso: j.paso, ok, ms: r.ms });
    if (!ok) problems.push(`${repo.nombre} · ${j.paso === "pruebas" ? "pruebas relacionadas" : j.paso}:\n${tail(r.out, j.n)}`);
  }
  return { problems, pasos };
}

/** Firma de un conjunto de partes (misma firma = mismo resultado de lint, tipos y pruebas). */
export const fingerprint = (parts) => createHash("sha1").update(parts.join("\u0000")).digest("hex");

/** Estado de un repo: commit, diff contra HEAD y tamaño y fecha de cada archivo cambiado o nuevo. */
function repoFingerprint(cfg, repo, files) {
  const dir = cfg.abs(repo.ruta);
  const diff = sh("git diff HEAD --no-ext-diff --no-color", dir, 20_000);
  const head = sh("git rev-parse HEAD", dir, 10_000);
  const stats = files.map((f) => {
    try {
      const st = statSync(join(dir, f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${f}:-`;
    }
  });
  const cmds = JSON.stringify([repo.lint, repo.tipos, repo.relacionadas]);
  return fingerprint([repo.nombre, head.out ?? "", diff.ok ? diff.out : String(Date.now()), ...stats, cmds]);
}

const cacheFile = (cfg) => join(tmpdir(), `neurodanza-cache-${createHash("sha1").update(cfg.root).digest("hex").slice(0, 12)}.json`);

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Estado de la última verificación, para el mapa en vivo (`neurodanza-mapa`). No falla nunca. */
function writeEstado(cfg, estado) {
  try {
    const dir = cfg.abs(".neurodanza");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "estado.json"), JSON.stringify({ ...estado, at: new Date().toISOString() }, null, 2));
  } catch {
    /* el mapa es opcional */
  }
}

/** Corre los generadores cuyas condiciones se cumplen; los marcados `error` bloquean si fallan. */
function regenerate(cfg, changes) {
  const out = [];
  for (const g of cfg.retroalimentacion.regenerar) {
    if (changedMatching(changes, g.cuando ?? []).length === 0) continue;
    const repo = cfg.repos.find((r) => r.nombre === g.en);
    const r = sh(g.comando, repo ? cfg.abs(repo.ruta) : cfg.root);
    if (!r.ok && g.error) out.push(`${g.nombre ?? g.comando}:\n${tail(r.out)}`);
  }
  return out;
}

function counter(session) {
  const file = join(tmpdir(), `neurodanza-feedback-${String(session || "x").replace(/[^\w-]/g, "")}.json`);
  let state = { n: 0, sig: "" };
  try {
    state = { n: 0, sig: "", ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    state = { n: 0, sig: "" };
  }
  return { n: state.n, sig: state.sig, set: (v, sig = "") => writeFileSync(file, JSON.stringify({ n: v, sig })) };
}

function versionContext(cfg) {
  const v = cfg.retroalimentacion.version;
  if (!v) return { version: "", baseVersion: "" };
  const repo = cfg.repos.find((r) => r.nombre === v.repo);
  if (!repo) return { version: "", baseVersion: "" };
  const dir = cfg.abs(repo.ruta);
  const file = join(dir, v.archivo);
  const version = existsSync(file) ? versionOf(readFileSync(file, "utf8")) : "";
  const base = sh(`git show ${v.ramaBase ?? "main"}:${v.archivo}`, dir, 10_000);
  return { version, baseVersion: base.ok ? versionOf(base.out) : "" };
}

async function stop(cfg, event) {
  const t0 = Date.now();
  // Una ronda del panel que quedó abierta al terminar el turno se cierra (la ventana se cierra sola).
  try {
    cerrarRondaActiva(cfg.root, "terminó el turno");
  } catch {
    /* el panel es opcional */
  }
  const changes = changesOf(cfg);
  const c = counter(event.session_id);
  if (Object.values(changes).every((f) => f.length === 0)) {
    writeEstado(cfg, { fase: "sin cambios", pasos: [], problemas: 0, ms: Date.now() - t0 });
    return c.set(0);
  }

  const hard = [...regenerate(cfg, changes)];
  // Repos en paralelo; uno cuyo cambio es idéntico al de la última vez reutiliza su resultado.
  const useCache = cfg.retroalimentacion.cache !== false;
  const cache = useCache ? readJson(cacheFile(cfg), {}) : {};
  const touched = cfg.repos.filter((r) => (changes[r.nombre] ?? []).length > 0);
  const results = await Promise.all(
    touched.map(async (repo) => {
      const sig = useCache ? repoFingerprint(cfg, repo, changes[repo.nombre]) : "";
      const prev = cache[repo.nombre];
      if (useCache && prev?.sig === sig) return { problems: prev.problems, pasos: prev.pasos.map((p) => ({ ...p, cache: true })) };
      const r = await codeChecks(cfg, repo, changes[repo.nombre]);
      if (useCache) cache[repo.nombre] = { sig, ...r };
      return r;
    }),
  );
  const pasos = results.flatMap((r) => r.pasos);
  hard.push(...results.flatMap((r) => r.problems));
  if (useCache) {
    try {
      writeFileSync(cacheFile(cfg), JSON.stringify(cache));
    } catch {
      /* sin caché sigue funcionando */
    }
  }

  const { version, baseVersion } = versionContext(cfg);
  const umbral = cfg.panel.umbral;
  const done = doneProblems(cfg, changes, {
    version,
    baseVersion,
    bitacoraExists: (name) => existsSync(join(cfg.abs(cfg.retroalimentacion.bitacora.ruta), name)),
    panelApproved: (ver) => approvedFor(cfg.abs(cfg.panel.evaluaciones), ver, (e) => e.aprobado === true && Number(e.promedio) > umbral),
    evalsApproved: (ver) => approvedFor(cfg.abs(cfg.evals.informes), ver, (e) => e.informe?.aprobado === true),
    docsInBranch: docsCommittedInBranch(cfg),
  });
  hard.push(...done.hard);
  writeEstado(cfg, { fase: "verificar", pasos, problemas: hard.length, avisos: done.soft.length, ms: Date.now() - t0 });

  const max = cfg.retroalimentacion.maxBloqueos;
  const soft = event.stop_hook_active ? [] : done.soft;
  if (hard.length === 0 && soft.length === 0) return c.set(0);
  // Los mismos problemas seguidos suman intentos; si cambian, se empieza de nuevo.
  const sig = hard.join("\n");
  const n = sig === c.sig ? c.n : 0;
  if (hard.length > 0 && n >= max) {
    // Tras `maxBloqueos` intentos con los mismos problemas, deja terminar (avisa una sola vez)
    // hasta que cambien. Antes volvía a 0 y bloqueaba otra vez sin fin.
    if (n === max) process.stdout.write(JSON.stringify({ systemMessage: `neurodanza: siguen ${hard.length} problema(s) tras ${max} intentos; revisa a mano.` }));
    c.set(max + 1, sig);
    return;
  }
  c.set(hard.length > 0 ? n + 1 : n, sig);
  const reason = ["Antes de terminar, corrige esto (neurodanza):", ...registrarEnProyecto(cfg, hard, event.session_id).map((h) => `✖ ${h}`), ...soft.map((s) => `• ${s}`)].join("\n\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function post(cfg, event) {
  if (!cfg.retroalimentacion.lintAlEditar) return;
  const file = norm(event?.tool_input?.file_path ?? event?.tool_input?.notebook_path ?? "");
  let at = file ? repoOf(cfg, file) : null;
  if (!at && file) {
    // Archivo en el worktree de una tarea del modo director: lint con la configuración de su repo, ahí mismo.
    const w = enWorktree(leerTareas(cfg), file);
    const repo = w && cfg.repos.find((r) => r.nombre === w.repo.nombre);
    if (repo) at = { repo, dir: w.repo.ruta, rel: w.rel };
  }
  if (!at || !at.repo.lint) return;
  const { repo, rel } = at;
  if (!matchesAny(rel, repo.codigo ?? []) || matchesAny(rel, repo.ignorar ?? [])) return;
  if (repo.lintGlobs && !matchesAny(rel, repo.lintGlobs)) return;
  const r = sh(repo.lint.replace("{archivos}", `"${rel}"`), at.dir, 90_000);
  if (!r.ok) {
    const [msg] = registrarEnProyecto(cfg, [`${repo.nombre} · lint:\n${tail(r.out)}`], event.session_id);
    process.stderr.write(`Lint de ${repo.nombre}/${rel}:\n${msg.split("\n").slice(1).join("\n")}\n`);
    process.exit(2);
  }
}

/** Contexto de inicio con los errores conocidos más útiles (vacío si no hay). */
export function contextoErrores(list) {
  if (!list.length) return "";
  const lines = list.map((e) => `- [${e.firma}] ${e.categoria} (${e.veces}×): ${e.patron.slice(0, 140)}${e.solucion ? `\n  Solución: ${e.solucion}` : " (sin solución anotada)"}`);
  return ["neurodanza · errores conocidos de este proyecto (si aparece uno, aplica su solución antes de investigar de cero):", ...lines].join("\n");
}

function inicio(cfg) {
  // Deja el proyecto listo (.gitignore, aviso de permisos) y carga los errores conocidos.
  const auto = autoconfigurar(cfg);
  const errores = cfg.errores?.activo === false ? "" : contextoErrores(top(loadErrores(archivoDe(cfg)), cfg.errores?.alIniciar ?? 5));
  const contexto = [auto.contexto, errores].filter(Boolean).join("\n\n");
  const out = {};
  if (auto.mensaje) out.systemMessage = auto.mensaje;
  if (contexto) out.hookSpecificOutput = { hookEventName: "SessionStart", additionalContext: contexto };
  if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let event = {};
  try {
    event = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    event = {};
  }
  let cfg = null;
  try {
    cfg = loadConfig(event.cwd ?? process.cwd());
  } catch (e) {
    process.stderr.write(`neurodanza: ${e.message}\n`);
    process.exit(0);
  }
  if (!cfg) process.exit(0);
  if (process.argv[2] === "post") post(cfg, event);
  else if (process.argv[2] === "stop") await stop(cfg, event);
  else if (process.argv[2] === "inicio") inicio(cfg);
}
