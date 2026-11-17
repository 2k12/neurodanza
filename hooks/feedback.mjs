#!/usr/bin/env node
// neurodanza · ciclo de retroalimentación.
//   node feedback.mjs post  → PostToolUse: lint del archivo recién editado (error = se lo muestra al agente)
//   node feedback.mjs stop  → Stop: no deja terminar si lo cambiado no pasa lint, tipos, pruebas
//                             relacionadas o la definición de terminado del proyecto.
// Todo sale de `neurodanza.config.json`; sin ese archivo no hace nada. Ver docs/05-retroalimentacion.md.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny, repoOf } from "../lib/config.mjs";

const norm = (p) => String(p ?? "").replace(/\\/g, "/");
const tail = (s, n = 25) => String(s).split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");

function sh(cmd, cwd, timeout = 240_000) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || String(e.message) };
  }
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
  if (rf.docs && Object.entries(changes).some(([n, f]) => n !== rf.docs && f.length > 0) && (changes[rf.docs] ?? []).length === 0) {
    soft.push(`docs: hay cambios de código y ninguno en ${rf.docs}. Revisa la definición de terminado.`);
  }
  return { hard, soft };
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

function codeChecks(cfg, repo, files) {
  const dir = cfg.abs(repo.ruta);
  const code = files.filter((f) => matchesAny(f, repo.codigo ?? []) && !matchesAny(f, repo.ignorar ?? []));
  const out = [];
  if (code.length === 0) return out;
  const lintable = repo.lintGlobs ? code.filter((f) => matchesAny(f, repo.lintGlobs)) : code;
  if (repo.lint && lintable.length > 0) {
    const r = sh(repo.lint.replace("{archivos}", quote(lintable)), dir);
    if (!r.ok) out.push(`${repo.nombre} · lint:\n${tail(r.out)}`);
  }
  if (repo.tipos) {
    const r = sh(repo.tipos, dir);
    if (!r.ok) out.push(`${repo.nombre} · tipos:\n${tail(r.out)}`);
  }
  if (repo.relacionadas) {
    const t = sh(repo.relacionadas.replace("{archivos}", quote(code)), dir, 300_000);
    const none = new RegExp(repo.sinPruebas ?? "No tests found|No test files found", "i");
    if (!t.ok && !none.test(t.out)) out.push(`${repo.nombre} · pruebas relacionadas:\n${tail(t.out, 30)}`);
  }
  return out;
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
  let n = 0;
  try {
    n = JSON.parse(readFileSync(file, "utf8")).n ?? 0;
  } catch {
    n = 0;
  }
  return { n, set: (v) => writeFileSync(file, JSON.stringify({ n: v })) };
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

function stop(cfg, event) {
  const changes = changesOf(cfg);
  const c = counter(event.session_id);
  if (Object.values(changes).every((f) => f.length === 0)) return c.set(0);

  const hard = [...regenerate(cfg, changes)];
  for (const repo of cfg.repos) if ((changes[repo.nombre] ?? []).length > 0) hard.push(...codeChecks(cfg, repo, changes[repo.nombre]));

  const { version, baseVersion } = versionContext(cfg);
  const umbral = cfg.panel.umbral;
  const done = doneProblems(cfg, changes, {
    version,
    baseVersion,
    bitacoraExists: (name) => existsSync(join(cfg.abs(cfg.retroalimentacion.bitacora.ruta), name)),
    panelApproved: (ver) => approvedFor(cfg.abs(cfg.panel.evaluaciones), ver, (e) => e.aprobado === true && Number(e.promedio) > umbral),
    evalsApproved: (ver) => approvedFor(cfg.abs(cfg.evals.informes), ver, (e) => e.informe?.aprobado === true),
  });
  hard.push(...done.hard);

  const max = cfg.retroalimentacion.maxBloqueos;
  const soft = event.stop_hook_active ? [] : done.soft;
  if (hard.length === 0 && soft.length === 0) return c.set(0);
  if (hard.length > 0 && c.n >= max) {
    c.set(0);
    process.stdout.write(JSON.stringify({ systemMessage: `neurodanza: siguen ${hard.length} problema(s) tras ${max} intentos; revisa a mano.` }));
    return;
  }
  c.set(hard.length > 0 ? c.n + 1 : c.n);
  const reason = ["Antes de terminar, corrige esto (neurodanza):", ...hard.map((h) => `✖ ${h}`), ...soft.map((s) => `• ${s}`)].join("\n\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function post(cfg, event) {
  if (!cfg.retroalimentacion.lintAlEditar) return;
  const file = norm(event?.tool_input?.file_path ?? event?.tool_input?.notebook_path ?? "");
  const at = file ? repoOf(cfg, file) : null;
  if (!at || !at.repo.lint) return;
  const { repo, rel } = at;
  if (!matchesAny(rel, repo.codigo ?? []) || matchesAny(rel, repo.ignorar ?? [])) return;
  if (repo.lintGlobs && !matchesAny(rel, repo.lintGlobs)) return;
  const r = sh(repo.lint.replace("{archivos}", `"${rel}"`), at.dir, 90_000);
  if (!r.ok) {
    process.stderr.write(`Lint de ${repo.nombre}/${rel}:\n${tail(r.out)}\n`);
    process.exit(2);
  }
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
  else if (process.argv[2] === "stop") stop(cfg, event);
}
