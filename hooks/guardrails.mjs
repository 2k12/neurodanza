#!/usr/bin/env node
// neurodanza · barreras (hook PreToolUse). Lee el evento por stdin; si la acción está prohibida
// sale con código 2 y el motivo en stderr (Claude Code la bloquea y le muestra el motivo al agente).
// Sin `neurodanza.config.json` en el proyecto no hace nada. Ver docs/04-barreras.md.
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny, repoOf } from "../lib/config.mjs";
import { enWorktree, fueraDeContrato, leerModo, leerTareas } from "../lib/director.mjs";
import { MENSAJE_CORTE, registrarPaso, revisarLatidos, terminar } from "../lib/agentes.mjs";
import { asociarAgente, decidirFigura, manoDe, tocaProtegido } from "../lib/figuras.mjs";

const PILAS_CLI = fileURLToPath(new URL("../lib/pilas.mjs", import.meta.url)).replace(/\\/g, "/");

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
    const largo = comandoLargo(bare, input, cfg);
    if (largo) return largo;
  }
  return null;
}

/** ¿El comando ya trae un límite? (timeout de la herramienta acotado, segundo plano o envuelto en `timeout`) */
export function acotado(cmd, input, maxSeg) {
  const t = Number(input?.timeout);
  if (Number.isFinite(t) && t > 0 && t <= maxSeg * 1000) return true;
  if (input?.run_in_background === true) return true;
  // `timeout [opciones] <duración> <comando>` (GNU coreutils, también en Git Bash) o `-Timeout N` en PowerShell.
  return /^\s*(timeout|gtimeout)\b[^|;&]*?\s\d+(\.\d+)?[smhd]?\s+\S/.test(cmd) || /-Timeout(Sec)?\s+\d+/i.test(cmd);
}

/**
 * Comando que puede no terminar (servidor, modo watch, suite completa) sin límite: devuelve el motivo
 * del rechazo con la forma exacta de correrlo, o null.
 */
export function comandoLargo(cmd, input, cfg) {
  const tc = cfg.barreras.timeoutComandos;
  if (!tc?.activo) return null;
  const hit = (tc.largos ?? []).find((l) => {
    try {
      return new RegExp(l.patron ?? l, "i").test(cmd);
    } catch {
      return false;
    }
  });
  if (!hit || acotado(cmd, input, tc.maxSeg)) return null;
  const ms = tc.maxSeg * 1000;
  const levantar = cfg.app?.levantar;
  const tipo = hit.tipo ?? "largo";
  if (tipo === "servidor")
    return `neurodanza: «${cmd.trim().slice(0, 80)}» es un servidor y no termina. La app la levanta el ciclo una sola vez${levantar ? ` (app.levantar: \`${levantar}\`)` : " (app.levantar)"}; no la levantes desde un comando suelto. Si de verdad necesitas otro servidor, córrelo con run_in_background: true.`;
  if (tipo === "watch")
    return `neurodanza: «${cmd.trim().slice(0, 80)}» está en modo watch y no termina. Quita --watch/-w (p. ej. \`vitest run\`, \`tsc --noEmit\`) o córrelo con run_in_background: true.`;
  if (tipo === "suite") {
    const rel = cfg.repos.find((r) => r.relacionadas)?.relacionadas;
    return `neurodanza: «${cmd.trim().slice(0, 80)}» corre la suite completa y puede tardar mucho. Corre solo las pruebas relacionadas con filtro de archivos${rel ? ` (\`${rel}\`)` : ""}, o la suite con timeout: ${ms} en la llamada (o run_in_background: true). La suite completa ya corre en segundo plano al terminar el turno (hook Stop).`;
  }
  return `neurodanza: «${cmd.trim().slice(0, 80)}» puede no terminar. Córrelo con timeout: ${ms} en la llamada, o con run_in_background: true.`;
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
  // SubagentStop: el subagente terminó; ya no cuenta para latidos ni cortes.
  if (process.argv[2] === "fin-agente") {
    if (event.agent_id) terminar(cfg, event.agent_id);
    process.exit(0);
  }
  const ahora = Date.now();
  let aviso = "";
  const conFiguras = cfg.figuras?.activo === true;
  /** Rechaza con el motivo y sale con 2. */
  const rechazar = (motivo) => {
    process.stderr.write(`${motivo.startsWith("neurodanza") ? "" : "Barrera (neurodanza): "}${motivo}\n`);
    process.exit(2);
  };
  // Corte por tiempo (solo subagentes: el agente principal nunca queda bloqueado por esto).
  if (event.agent_id) {
    try {
      const r = registrarPaso(cfg, event, ahora);
      if (r.corte) {
        process.stderr.write(`${MENSAJE_CORTE}\n`);
        process.exit(2);
      }
      aviso = r.aviso ?? "";
      // Línea de avance cada `pilas.avanceCada` pasos: se le pide al subagente, sin bloquear.
      const cada = cfg.pilas?.activo === false ? 0 : cfg.pilas?.avanceCada ?? 10;
      if (cada > 0 && r.agente.pasos % cada === 0) aviso = [aviso, `neurodanza: llevas ${r.agente.pasos} pasos. Anota tu avance en una línea (qué hiciste, qué falta): node "${PILAS_CLI}" avance --texto "<qué hice, qué falta>"`].filter(Boolean).join("\n");
    } catch {
      /* el registro es una ayuda: si falla, la barrera sigue */
    }
  }
  try {
    revisarLatidos(cfg, ahora, event.agent_id);
  } catch {
    /* idem */
  }
  // La tabla de figuras y el registro de agentes no los escribe ningún agente.
  if (tocaProtegido(cfg, event)) rechazar("neurodanza: .neurodanza/figuras.json y .neurodanza/agentes/ los escriben solo el director y las barreras; ningún agente puede modificarlos.");
  // Figuras: la acción debe estar en la mano del agente; si no, ◇ y ✕ se preguntan al usuario y lo demás se rechaza.
  let pregunta = "";
  if (conFiguras) {
    if (event.agent_id && event.tool_name === "Agent") rechazar("neurodanza: solo el agente principal lanza subagentes (re-enfundar o reemplazar a un agente lo hace el director).");
    const file = event.tool_input?.file_path ?? event.tool_input?.notebook_path;
    if (event.agent_id && file) {
      const w = enWorktree(leerTareas(cfg), file);
      if (w) asociarAgente(cfg, event.agent_id, w.tarea.id);
    }
    const d = decidirFigura(event, cfg, manoDe(cfg, event));
    if (d?.decision === "deny") rechazar(d.motivo);
    if (d?.decision === "ask") pregunta = d.motivo;
  }
  const why = check(event, cfg);
  if (why) rechazar(why);
  // Segunda llave: el usuario aprueba en la ventana de permisos. El aviso, si hay, va como contexto.
  if (pregunta) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: pregunta, ...(aviso ? { additionalContext: aviso } : {}) } }));
  // Aviso al 80 % del tiempo: contexto junto al resultado de la herramienta, sin decidir permisos
  // (devolver "allow" se saltaría los permisos del usuario).
  else if (aviso) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: aviso } }));
}
