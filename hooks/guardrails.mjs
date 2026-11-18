#!/usr/bin/env node
// neurodanza · barreras (hook PreToolUse). Lee el evento por stdin; si la acción está prohibida
// sale con código 2 y el motivo en stderr (Claude Code la bloquea y le muestra el motivo al agente).
// Sin `neurodanza.config.json` en el proyecto no hace nada. Ver docs/04-barreras.md.
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny, repoOf } from "../lib/config.mjs";
import { enWorktree, fueraDeContrato, leerModo, leerTareas } from "../lib/director.mjs";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const AI_ATTRIBUTION = /co-authored-by:|generated with \[?claude|🤖 generated/i;

const norm = (p) => String(p ?? "").replace(/\\/g, "/");

/** Texto que escribe una herramienta de edición. */
function written(input) {
  if (typeof input.content === "string") return input.content;
  if (typeof input.new_string === "string") return input.new_string;
  if (Array.isArray(input.edits)) return input.edits.map((e) => e?.new_string ?? "").join("\n");
  if (typeof input.new_source === "string") return input.new_source;
  return "";
}

/** Quita cuerpos de heredoc (texto que se escribe, no se ejecuta). */
export const withoutHeredocs = (cmd) => cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, "<<heredoc");
/** Quita lo que va entre comillas (mensajes, echo). */
export const withoutQuotes = (cmd) => cmd.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");

/** Reglas de comandos que vienen con el plugin (se pueden apagar en la configuración). */
function baseShellRules(b) {
  const rules = [];
  if (b.borradosRaiz) {
    rules.push([/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|~|\/[a-z]\/?|[a-z]:[\\/]?)(\s|$)/i, "`rm -rf` sobre una ruta raíz está prohibido.", "bare"]);
    rules.push([/remove-item\b.*-recurse.*\s([a-z]:\\?|~|\/)(\s|$)/i, "Borrado recursivo de una ruta raíz está prohibido.", "bare"]);
  }
  if (b.secretos) {
    // Cualquier .env* que se lea por la terminal, salvo los permitidos (.env.example…).
    const allowed = new Set(b.secretosPermitidos.map((x) => x.toLowerCase()));
    const readsSecret = {
      test: (cmd) =>
        [...cmd.matchAll(/(?:cat|type|get-content|less|more|head|tail)\s+[^|;&]*?(\.env[\w.-]*)/gi)].some((m) => !allowed.has(m[1].toLowerCase())),
    };
    rules.push([readsSecret, "Los archivos .env tienen secretos: no se leen. Usa el .env de ejemplo.", "raw"]);
  }
  return rules;
}

/** Comandos que modifican archivos o el repo (el director no los usa: delega). */
const MUTA = [
  /\bsed\s+(-[a-z]*\s+)*-[a-z]*i/i,
  /\bperl\s+-[a-z]*i/i,
  /\btee\b/i,
  /(^|[^\d&>])>{1,2}\s*(?!\/dev\/null\b|&|\$null\b|nul\b)[^\s|;&]/i,
  /\b(rm|mv|cp|del|rmdir|mkdir|touch|Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File|New-Item)\b/i,
  /\bgit\s+(apply|am|checkout|switch|restore|reset|merge|rebase|cherry-pick|stash|clean|revert)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(add|install|i|remove|rm|uninstall|up|update|upgrade)\b/i,
  /\b(prettier|biome)\b.*--write\b|\beslint\b.*--fix\b/i,
];

/** ¿El comando modifica archivos? (sobre el comando sin comillas ni heredocs) */
export const modifica = (cmd) => MUTA.some((re) => re.test(withoutQuotes(withoutHeredocs(cmd))));

/**
 * Reglas del modo director (`lib/director.mjs`). El agente principal no edita ni corre comandos que
 * modifiquen archivos: delega. Un subagente edita solo en el worktree de su tarea y dentro de los
 * archivos de su contrato.
 */
function directorCheck(event, cfg, ctx, file, wt) {
  const tool = event?.tool_name ?? "";
  const principal = !event?.agent_id;
  // El plan y el estado (.neurodanza/) sí; los worktrees de las tareas (aunque vivan en .neurodanza/wt) no.
  const plan = (p) => {
    const r = norm(isAbsolute(p) ? relative(cfg.root, p) : p);
    return !wt && r.startsWith(".neurodanza/") && !r.startsWith(".neurodanza/wt/");
  };
  if (ctx.modo?.activo && principal) {
    if (EDIT_TOOLS.has(tool) && file && !plan(file))
      return "Modo director: el agente principal no edita código. Delega: `director.mjs preparar --tarea …` y lanza un `implementador` con el contrato (solo el plan en .neurodanza/ se edita aquí). Si el usuario pide editar a mano: `director.mjs desactivar`.";
    if (SHELL_TOOLS.has(tool)) {
      const cmd = String(event?.tool_input?.command ?? "");
      if (!/director\.mjs|ciclo\.mjs|errores\.mjs|panel\.mjs/.test(cmd) && modifica(cmd))
        return "Modo director: ese comando modifica archivos y el agente principal solo dirige. Delega la tarea en un `implementador` (o corre `director.mjs integrar` para traer su trabajo). Lint, tipos, pruebas, git status/diff/log/add/commit sí se permiten.";
    }
  }
  if (!EDIT_TOOLS.has(tool) || !file) return null;
  if (wt) {
    const fuera = fueraDeContrato(wt.repo.nombre, [wt.rel], wt.tarea.archivos ?? {});
    if (fuera.length) {
      const suyos = Object.entries(wt.tarea.archivos ?? {}).map(([r, g]) => `${r}: ${g.join(", ")}`).join(" · ");
      return `Fuera del contrato de la tarea ${wt.tarea.id}: ${wt.repo.nombre}/${wt.rel}. Tus archivos: ${suyos}. Si de verdad hace falta tocarlo, no lo hagas: dilo en «pendiente» de tu respuesta y el director decide.`;
    }
    return null;
  }
  if (ctx.modo?.activo && !principal && repoOf(cfg, file) && ctx.tareas.length)
    return "Modo director: los subagentes no editan el repo real. Trabaja en el worktree de tu tarea (la ruta está en tu contrato).";
  return null;
}

/**
 * Decide si una llamada de herramienta se permite.
 * @param {object} event evento de Claude Code ({ tool_name, tool_input, agent_id? })
 * @param {object} cfg configuración cargada (loadConfig)
 * @param {(p: string) => boolean} [exists]
 * @param {{ modo: { activo: boolean }, tareas: object[] }} [ctx] estado del modo director (por defecto, se lee del proyecto)
 * @returns {string | null} motivo del bloqueo, o null si se permite
 */
export function check(event, cfg, exists = existsSync, ctx = null) {
  const b = cfg.barreras;
  const tool = event?.tool_name ?? "";
  const input = event?.tool_input ?? {};
  ctx ??= { modo: leerModo(cfg), tareas: leerTareas(cfg) };
  const file = input.file_path ?? input.notebook_path ?? input.path;
  // Un archivo en el worktree de una tarea se juzga como su par en el repo real.
  const wt = file && ctx.tareas.length ? enWorktree(ctx.tareas, file) : null;
  const realRepo = wt ? cfg.repos.find((r) => r.nombre === wt.repo.nombre) : null;
  const real = wt && realRepo ? join(cfg.abs(realRepo.ruta), wt.rel) : file;
  const rel = real ? norm(isAbsolute(real) ? relative(cfg.root, real) : real) : "";

  const director = directorCheck(event, cfg, ctx, file, wt);
  if (director) return director;
  const isSecret = (p) => /^\.env(\..+)?$/.test(basename(norm(p))) && !b.secretosPermitidos.includes(basename(norm(p)));
  const exempt = (p) => matchesAny(norm(p), b.exentos ?? []);

  if (b.secretos && tool === "Read" && file && isSecret(file)) return `${basename(norm(file))} tiene secretos: no se lee.`;

  if (EDIT_TOOLS.has(tool) && file) {
    if (b.secretos && isSecret(file)) return `${basename(norm(file))} tiene secretos: no se edita desde Claude. Pídele el cambio al usuario.`;
    for (const r of b.rutasProtegidas) {
      if (matchesAny(rel, [r.glob ?? r])) return r.motivo ?? `${rel} está protegido en neurodanza.config.json (barreras.rutasProtegidas).`;
    }
    if (b.migracionesInmutables && matchesAny(rel, [b.migracionesInmutables]) && exists(file)) {
      return "Esa migración ya existe (puede estar aplicada): no se edita. Crea una migración nueva.";
    }
    if (b.firmasIA && !exempt(rel) && AI_ATTRIBUTION.test(written(input))) return "Atribución de IA (Co-Authored-By / «Generated with Claude»): no va en el código.";
  }

  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(input.command ?? "");
    if (b.firmasIA && /\bgit\b.*\bcommit\b/.test(cmd) && AI_ATTRIBUTION.test(cmd)) return "El commit lleva atribución de IA (Co-Authored-By): quítala.";
    const raw = withoutHeredocs(cmd);
    const bare = withoutQuotes(raw);
    const project = b.comandosProhibidos.map((c) => [new RegExp(c.patron, "i"), c.motivo, c.alcance ?? "bare"]);
    for (const [re, why, scope] of [...baseShellRules(b), ...project]) if (re.test(scope === "raw" ? raw : bare)) return why;
  }
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let event = {};
  try {
    event = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0);
  }
  let cfg = null;
  try {
    cfg = loadConfig(event.cwd ?? process.cwd());
  } catch (e) {
    process.stderr.write(`neurodanza: ${e.message}\n`);
    process.exit(0);
  }
  if (!cfg) process.exit(0);
  const why = check(event, cfg);
  if (why) {
    process.stderr.write(`Barrera (neurodanza): ${why}\n`);
    process.exit(2);
  }
}
