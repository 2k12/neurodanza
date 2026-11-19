// neurodanza · figuras: qué puede hacer cada agente, por categoría de acción.
//   ◯ leer · △ editar · □ verificar · ◇ externo · ✕ destructivo
// Cada llamada se clasifica en una figura; cada tipo de agente tiene una «mano» (las figuras que puede
// usar sin preguntar). Fuera de la mano: ◇ y ✕ se preguntan al usuario (`ask`, la segunda llave), lo demás
// se rechaza. La tabla de manos por tarea vive en `.neurodanza/figuras.json`, que ningún agente puede
// escribir. Las barreras sobre comandos son una red de seguridad, no un aislamiento: un comando puede
// esconder lo que hace. Ver docs/17-seguridad.md.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { escribirAtomico } from "./procesos.mjs";

export const FIGURAS = { leer: "◯", editar: "△", verificar: "□", externo: "◇", destructivo: "✕" };
const ORDEN = ["leer", "verificar", "editar", "externo", "destructivo"];
const peor = (a, b) => (ORDEN.indexOf(a.figura) >= ORDEN.indexOf(b.figura) ? a : b);
const RAIZ_PLUGIN = dirname(dirname(fileURLToPath(import.meta.url))).replace(/\\/g, "/").toLowerCase();

/** Manos por defecto por tipo de agente. `red-app` = red solo a los hosts de la app. */
export const MANOS = {
  revisor: ["leer", "verificar"],
  persona: ["leer", "verificar"],
  implementador: ["leer", "editar", "verificar"],
  fantasma: ["leer", "verificar", "red-app"],
  principal: ["leer", "editar", "verificar"],
  otro: ["leer", "verificar"],
};

export function tipoDe(event) {
  if (!event?.agent_id) return "principal";
  const t = String(event.agent_type ?? "");
  if (/fantasma/.test(t)) return "fantasma";
  if (/revisor-/.test(t)) return "revisor";
  if (/persona/.test(t)) return "persona";
  if (/implementador/.test(t)) return "implementador";
  return "otro";
}

// ── clasificación de comandos ──

const quitarHeredocs = (c) => c.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, "<<heredoc");
const quitarComillas = (c) => c.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");

/** Comandos internos: `bash -c "…"`, `powershell -Command "…"`, `$(…)`, `` `…` `` (se clasifican también). */
export function internos(cmd) {
  const out = [];
  for (const m of cmd.matchAll(/\b(?:bash|sh|zsh|dash|cmd|powershell|pwsh)(?:\.exe)?\b(?:\s+-[\w-]+)*\s+(?:-c|-Command|\/c|\/C)\s+("(?:[^"\\]|\\.)*"|'[^']*')/gi)) out.push(m[1].slice(1, -1).replace(/\\"/g, '"'));
  for (const m of cmd.matchAll(/\beval\s+("(?:[^"\\]|\\.)*"|'[^']*')/g)) out.push(m[1].slice(1, -1));
  for (const m of cmd.matchAll(/\$\(([^()]*)\)/g)) out.push(m[1]);
  for (const m of cmd.matchAll(/`([^`]*)`/g)) out.push(m[1]);
  return out;
}

/** Hosts a los que apunta un texto (URLs http/https). */
export const hostsDe = (texto) => [...String(texto).matchAll(/https?:\/\/(\[[^\]]+\]|[^/\s:'"`)]+)/gi)].map((m) => m[1].replace(/^\[|\]$/g, "").toLowerCase());

/** Código de `node -e`/`python -c`: qué hace (escribe, borra, red, procesos). */
function clasificarCodigo(codigo, hostsApp) {
  if (/\b(unlinkSync|unlink|rmSync|rmdirSync|rm\(|rmdir|os\.remove|shutil\.rmtree)\b/.test(codigo)) return { figura: "destructivo", motivo: "código que borra archivos" };
  if (/\b(child_process|execSync|spawn|exec\(|subprocess|os\.system)\b/.test(codigo)) return { figura: "externo", motivo: "código que lanza procesos (no se puede saber qué hacen)" };
  const hosts = hostsDe(codigo);
  if (/\b(fetch|http\.request|https\.request|axios|requests\.|urllib|net\.connect)\b/.test(codigo) || hosts.length) return red(hosts, hostsApp, "código con red");
  if (/\b(writeFileSync|writeFile|appendFile|renameSync|copyFileSync|mkdirSync|createWriteStream|open\([^)]*['"]w)/.test(codigo)) return { figura: "editar", motivo: "código que escribe archivos" };
  return { figura: "leer", motivo: "código que solo lee o calcula" };
}

function red(hosts, hostsApp, motivo) {
  const app = hosts.length > 0 && hosts.every((h) => hostsApp.includes(h));
  return { figura: "externo", red: app ? "app" : "fuera", hosts, motivo: app ? `${motivo} a la app (${hosts.join(", ")})` : hosts.length ? `${motivo} a ${hosts.join(", ")}` : motivo };
}

const DESTRUCTIVO = [
  [/^(rm|rmdir|del|erase|rd|rimraf|shred|Remove-Item|ri)\b/i, "borra archivos o carpetas"],
  [/^git\s+reset\b.*--hard\b/i, "git reset --hard (pierde cambios)"],
  [/^git\s+clean\b/i, "git clean (borra archivos sin seguimiento)"],
  [/^git\s+push\b.*(\s-f\b|--force)/i, "sobrescribe una rama remota"],
  [/^git\s+branch\b.*\s-D\b/i, "borra una rama sin fusionar"],
  [/^git\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i, "descarta todos los cambios"],
  [/^git\s+stash\s+(drop|clear)\b/i, "borra cambios guardados"],
  [/\b(drop\s+(table|database|schema)|truncate\s+table|truncate\s+\w+)\b/i, "borra datos (drop/truncate)"],
  [/\bprisma\s+migrate\s+reset\b|\bdropdb\b|\bmkfs\b|^format\b/i, "borra la base de datos o un disco"],
  [/^find\b.*(-delete\b|-exec\s+(rm|del)\b)/i, "borra archivos con find"],
];
const EXTERNO = [
  [/^git\s+(push|fetch|pull|clone|submodule)\b/i, "red de git"],
  [/^(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|up|update|upgrade|ci|publish|dlx|create|link)\b/i, "instala o quita dependencias"],
  [/^(yarn|pnpm|bun)$/i, "instala dependencias"],
  [/^(ssh|scp|rsync|sftp|ftp|telnet|nc|ncat)\b/i, "conexión a otra máquina"],
  [/^(docker|docker-compose|podman|kubectl|helm)\b/i, "contenedores"],
  [/^(psql|mysql|mongo|mongosh|redis-cli|sqlite3|sqlcmd)\b/i, "base de datos"],
  [/^(npx\s+|pnpm\s+(exec\s+)?|yarn\s+)?(prisma\s+(migrate|db)|knex\s+(migrate|seed)|sequelize|typeorm|drizzle-kit\s+(push|migrate))\b/i, "base de datos o migraciones"],
  [/^(gh|aws|gcloud|az|vercel|netlify|heroku|fly|supabase|firebase)\b/i, "servicio externo"],
];
const EDITAR = [
  [/^git\s+(add|commit|checkout|switch|stash|restore|mv|rm|apply|am|merge|rebase|cherry-pick|revert|tag|branch)\b/i, "cambia el repo local"],
  [/^(mkdir|md|touch|cp|copy|mv|move|ren|rename|tee|ln|chmod|New-Item|ni|Set-Content|sc|Add-Content|ac|Out-File|Copy-Item|cpi|Move-Item|mi|Rename-Item|rni)\b/i, "crea, copia o mueve archivos"],
  [/^(sed|perl)\b.*\s-[a-z]*i/i, "edita archivos en el lugar"],
  [/^(prettier|biome|eslint)\b.*(--write|--fix)\b/i, "reescribe archivos"],
];
const VERIFICAR = [
  [/^(npx\s+|pnpm\s+(exec\s+)?|yarn\s+|bunx\s+)?(eslint|tsc|vitest|jest|mocha|ava|playwright\s+test|prettier\s+--check|biome\s+(check|lint)|vue-tsc|svelte-check|stylelint)\b/i, "lint, tipos o pruebas"],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|type-check|check|build|verify|format:check|test:\S+|lint:\S+)\b/i, "script de verificación"],
  [/^node\s+--test\b/i, "pruebas de node"],
];
const LEER = [
  [/^git\s+(status|diff|log|show|rev-parse|ls-files|blame|describe|shortlog|reflog|grep|config\s+--get|remote(\s+-v)?$|branch(\s+(-a|-r|--list|-v|--show-current))*\s*$)/i, "lectura de git"],
  [/^(ls|dir|cat|type|head|tail|less|more|wc|grep|rg|egrep|fgrep|pwd|echo|printf|which|where|whoami|date|tree|stat|file|cmp|sort|uniq|cut|jq|cd|true|false|sleep|basename|dirname|realpath|test|\[)\b/i, "solo lectura"],
  [/^(find)\b(?!.*(-delete|-exec\s+rm))/i, "búsqueda de archivos"],
  [/^(awk)\b(?!.*-i\s+inplace)/i, "solo lectura"],
  [/^(sed)\b(?!.*\s-[a-z]*i)/i, "solo lectura"],
  [/^(diff)\b/i, "comparación"],
  [/^(Get-ChildItem|gci|Get-Content|gc|Select-String|sls|Get-Item|gi|Test-Path|Resolve-Path|Get-Location|Measure-Object|Format-\w+|Write-Output|Write-Host|Get-Command|Get-Process|Sort-Object|Select-Object|Where-Object|ForEach-Object)\b/i, "solo lectura"],
  [/^(node|npm|pnpm|yarn|git|python|python3)\s+(--version|-v)\s*$/i, "versión"],
  [/^(npm|pnpm|yarn)\s+(ls|list|view|info|outdated|why|config\s+get)\b/i, "consulta de dependencias"],
];

/** Clasifica un segmento simple (sin `;`, `&&`, `|`). */
export function clasificarSegmento(seg, hostsApp = [], crudo = seg) {
  let s = seg.trim();
  if (!s) return { figura: "leer", motivo: "vacío" };
  // Prefijos que no cambian lo que hace el comando.
  s = s.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, "").replace(/^(sudo|nohup|time|exec)\s+/i, "");
  s = s.replace(/^(timeout|gtimeout)\b(?:\s+-[\w-]+(?:\s+\S+)?)*\s+\d+(?:\.\d+)?[smhd]?\s+/i, "");
  if (/^(curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|http|httpie)\b/i.test(s)) return red(hostsDe(crudo), hostsApp, "petición de red");
  // node/python con código en línea: se mira el código.
  const enLinea = crudo.match(/\b(?:node|python3?|deno|bun)\s+(?:--eval|-e|-p|-c)\s+("(?:[^"\\]|\\.)*"|'[^']*')/);
  if (/^(node|python3?|deno|bun)\s+(--eval|-e|-p|-c)\b/i.test(s)) return enLinea ? clasificarCodigo(enLinea[1].slice(1, -1), hostsApp) : { figura: "externo", motivo: "código en línea que no se pudo leer" };
  // Lo destructivo se busca también dentro de las comillas (p. ej. SQL: psql -c "DROP TABLE …").
  const o = String(crudo).trim().replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, "").replace(/^(sudo|nohup|time|exec)\s+/i, "");
  for (const [re, motivo] of DESTRUCTIVO) if (re.test(s) || re.test(o)) return { figura: "destructivo", motivo };
  for (const [re, motivo] of EXTERNO) if (re.test(s)) return { figura: "externo", motivo };
  // node <script>: herramientas del plugin = verificar; otro script = no se sabe qué hace.
  const script = o.match(/^node\s+("([^"]+)"|'([^']+)'|(\S+))/i);
  if (script) {
    const ruta = (script[2] ?? script[3] ?? script[4] ?? "").replace(/\\/g, "/").toLowerCase();
    if (/(^|\/)(lib|panel|hooks|evals)\/[\w-]+\.mjs$/.test(ruta) && (ruta.startsWith(RAIZ_PLUGIN) || !ruta.includes("/") || /^\.\.?\//.test(ruta) || ruta.includes("neurodanza"))) return { figura: "verificar", motivo: "herramienta del plugin" };
  }
  for (const [re, motivo] of EDITAR) if (re.test(s)) return { figura: "editar", motivo };
  for (const [re, motivo] of VERIFICAR) if (re.test(s)) return { figura: "verificar", motivo };
  for (const [re, motivo] of LEER) if (re.test(s)) return { figura: "leer", motivo };
  return { figura: "externo", motivo: `no se pudo clasificar con seguridad: «${s.split(/\s+/).slice(0, 3).join(" ")}»` };
}

/** Clasifica un comando completo: la figura más peligrosa de sus partes (incluye las internas). */
export function clasificarComando(cmd, hostsApp = []) {
  const crudo = quitarHeredocs(String(cmd ?? ""));
  let r = { figura: "leer", motivo: "solo lectura" };
  for (const interno of internos(crudo)) r = peor(r, clasificarComando(interno, hostsApp));
  const sinComillas = quitarComillas(crudo);
  // Redirección a un archivo (no /dev/null ni $null): al menos editar.
  if (/(^|[^\d&>])>{1,2}\s*(?!\/dev\/null\b|&|\$null\b|nul\b)[^\s|;&]/i.test(sinComillas)) r = peor(r, { figura: "editar", motivo: "redirige la salida a un archivo" });
  // Cada parte (separada por ; && || | & paréntesis o saltos, fuera de comillas) se clasifica por separado.
  for (const original of partir(crudo)) {
    const p = quitarComillas(original);
    if (!p.trim() || p.trim() === "''") continue;
    r = peor(r, clasificarSegmento(p, hostsApp, original));
  }
  return r;
}

/** Parte un comando en sus segmentos, respetando comillas (el texto de cada parte queda intacto). */
export function partir(cmd) {
  const out = [];
  let actual = "";
  let comilla = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (comilla) {
      actual += ch;
      if (ch === "\\" && comilla === '"' && i + 1 < cmd.length) actual += cmd[++i];
      else if (ch === comilla) comilla = null;
    } else if (ch === '"' || ch === "'") {
      comilla = ch;
      actual += ch;
    } else if (";&|\n()".includes(ch)) {
      out.push(actual);
      actual = "";
    } else actual += ch;
  }
  out.push(actual);
  return out.filter((s) => s.trim());
}

/** Figura de una llamada de herramienta. */
export function clasificar(event, hostsApp = []) {
  const tool = event?.tool_name ?? "";
  const ti = event?.tool_input ?? {};
  if (["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "TaskList", "TaskGet"].includes(tool)) return { figura: "leer", motivo: `${tool}` };
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return { figura: "editar", motivo: `${tool} de ${ti.file_path ?? ti.notebook_path ?? "un archivo"}` };
  if (tool === "Bash" || tool === "PowerShell") return clasificarComando(ti.command, hostsApp);
  if (tool === "WebFetch") return red(hostsDe(ti.url ?? ""), hostsApp, "WebFetch");
  if (tool === "WebSearch") return { figura: "externo", red: "fuera", motivo: "búsqueda en internet" };
  if (tool === "Skill") return { figura: "leer", motivo: "skill" };
  return { figura: "externo", motivo: `herramienta ${tool || "desconocida"}: no se sabe qué hace` };
}

// ── manos y decisión ──

export const archivoFiguras = (cfg) => cfg.abs(".neurodanza/figuras.json");

export function leerFiguras(cfg) {
  try {
    return JSON.parse(readFileSync(archivoFiguras(cfg), "utf8"));
  } catch {
    return { tareas: {}, agentes: {} };
  }
}

/** Escribe la tabla (solo lo hacen el director y las barreras; los agentes no pueden tocarla). */
export function guardarFiguras(cfg, data) {
  mkdirSync(cfg.abs(".neurodanza"), { recursive: true });
  escribirAtomico(archivoFiguras(cfg), JSON.stringify(data, null, 2));
}

/** Mano de una tarea del modo director (la escribe `director.mjs preparar`). */
export function anotarManoTarea(cfg, tarea, mano) {
  const d = leerFiguras(cfg);
  d.tareas = { ...(d.tareas ?? {}), [tarea]: { mano } };
  guardarFiguras(cfg, d);
}

/** Asocia un agente a la mano de su tarea en cuanto aparece en su worktree. */
export function asociarAgente(cfg, agentId, tarea) {
  const d = leerFiguras(cfg);
  if (d.agentes?.[agentId]) return;
  const mano = d.tareas?.[tarea]?.mano;
  if (!mano) return;
  d.agentes = { ...(d.agentes ?? {}), [agentId]: { tarea, mano } };
  guardarFiguras(cfg, d);
}

/** Mano de un agente: la de su tarea (si la tiene), o la de su tipo (configurable en `figuras.manos`). */
export function manoDe(cfg, event, tabla = null) {
  const t = tabla ?? leerFiguras(cfg);
  const propia = event?.agent_id ? t.agentes?.[event.agent_id]?.mano : null;
  if (propia) return propia;
  const tipo = tipoDe(event);
  return cfg.figuras?.manos?.[tipo] ?? MANOS[tipo] ?? MANOS.otro;
}

/** Hosts permitidos para la red de la app: los de app.urls más fantasmas.hosts. */
export function hostsApp(cfg) {
  const out = new Set((cfg.fantasmas?.hosts ?? ["localhost", "127.0.0.1"]).map((h) => String(h).toLowerCase()));
  for (const u of cfg.app?.urls ?? []) {
    try {
      out.add(new URL(u).hostname.toLowerCase());
    } catch {
      /* URL inválida */
    }
  }
  return [...out];
}

/**
 * Decisión de figuras para una llamada (pura dada la mano). Devuelve null (en la mano: siguen las reglas
 * de siempre), { decision: "ask", motivo } o { decision: "deny", motivo }.
 */
export function decidirFigura(event, cfg, mano, clasif = null) {
  const c = clasif ?? clasificar(event, hostsApp(cfg));
  const tipo = tipoDe(event);
  const quien = tipo === "principal" ? "el agente principal" : `${tipo} (${event.agent_type ?? "subagente"})`;
  const simbolo = `${FIGURAS[c.figura]} ${c.figura}`;
  // Fantasma: red solo a los hosts de la app, y nada fuera de su mano (ni preguntando).
  if (tipo === "fantasma") {
    if (c.figura === "externo" && c.red === "app" && mano.includes("red-app")) return null;
    if (mano.includes(c.figura) && !(c.figura === "externo")) return null;
    return { decision: "deny", motivo: `neurodanza: un fantasma solo lee, verifica y hace peticiones a la app local (${hostsApp(cfg).join(", ")}). Rechazado: ${c.motivo} (${simbolo}).` };
  }
  if (c.figura === "externo" && c.red === "app" && mano.includes("red-app")) return null;
  if (mano.includes(c.figura)) return null;
  if (c.figura === "externo" || c.figura === "destructivo")
    return { decision: "ask", motivo: `neurodanza · segunda llave: ${quien} pide ${simbolo} — ${c.motivo}. Su mano es ${mano.map((f) => FIGURAS[f] ?? f).join(" ")}. Apruébalo solo si esperas esta acción en esta tarea.` };
  const alternativa = c.figura === "editar" ? "entrega lo que encontraste: editar lo hace el implementador de la tarea" : "pídelo al director";
  return { decision: "deny", motivo: `neurodanza: ${quien} no puede ${simbolo} (${c.motivo}); su mano es ${mano.map((f) => FIGURAS[f] ?? f).join(" ")}. En su lugar: ${alternativa}.` };
}

/** ¿La llamada toca la tabla de figuras o el registro de agentes? (nadie puede escribirlos) */
export function tocaProtegido(cfg, event) {
  const ti = event?.tool_input ?? {};
  const protegido = (p) => /(^|[\\/])\.neurodanza[\\/](figuras\.json|agentes([\\/]|$))/i.test(String(p ?? ""));
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(event?.tool_name)) {
    const f = ti.file_path ?? ti.notebook_path ?? "";
    const r = isAbsolute(f) ? relative(cfg.root, f) : f;
    return protegido(r) || protegido(f);
  }
  if (event?.tool_name === "Bash" || event?.tool_name === "PowerShell") {
    const cmd = String(ti.command ?? "");
    if (!/figuras\.json|\.neurodanza[\\/]agentes/i.test(cmd)) return false;
    // Leerlos se permite; cualquier otra cosa (redirigir, copiar, mover, node -e…) no.
    return clasificarComando(cmd).figura !== "leer";
  }
  return false;
}
