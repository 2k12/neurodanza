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
// Entre dos ◇ gana el que se sabe peligroso: red a la app < sin clasificar < externo conocido (uno no tapa al otro).
const grado = (x) => ORDEN.indexOf(x.figura) * 10 + (x.figura !== "externo" || x.red === "app" ? 0 : x.desconocido ? 1 : 2);
const peor = (a, b) => (grado(a) >= grado(b) ? a : b);
const RAIZ_PLUGIN = dirname(dirname(fileURLToPath(import.meta.url))).replace(/\\/g, "/").toLowerCase();

/** Manos por defecto por tipo de agente. `red-app` = red solo a los hosts de la app. */
export const MANOS = {
  revisor: ["leer", "verificar"],
  persona: ["leer", "verificar"],
  implementador: ["leer", "editar", "verificar"],
  fantasma: ["leer", "verificar", "red-app"],
  especialista: ["leer"],
  principal: ["leer", "editar", "verificar"],
  otro: ["leer", "verificar"],
};

export function tipoDe(event) {
  if (!event?.agent_id) return "principal";
  const t = String(event.agent_type ?? "");
  if (/fantasma/.test(t)) return "fantasma";
  if (/especialista-/.test(t)) return "especialista";
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
  // `$(…)` con paréntesis balanceados (también anidados y dentro de comillas).
  for (let i = cmd.indexOf("$("); i >= 0; i = cmd.indexOf("$(", i + 2)) {
    let n = 0;
    let j = i + 1;
    for (; j < cmd.length; j++) {
      if (cmd[j] === "(") n++;
      else if (cmd[j] === ")" && --n === 0) break;
    }
    out.push(cmd.slice(i + 2, j));
  }
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
  [/^(ls|dir|cat|type|head|tail|less|more|wc|grep|rg|egrep|fgrep|pwd|echo|printf|which|where|whoami|date|tree|stat|file|cmp|sort|uniq|cut|jq|cd|true|false|sleep|basename|dirname|realpath|test|tr|seq|od|nl|column|comm|paste|rev|xxd|md5sum|sha1sum|sha256sum|uname|hostname|id|du|df|ps|printenv|netstat|unset|read|shift|return|exit|wait|break|continue|pushd|popd)(?=\s|$)/i, "solo lectura"],
  [/^(\[\[?\s|:(\s|$)|command\s+-v\s|set\s+[-+]\w)/, "solo lectura"],
  [/^(npm|pnpm|yarn|bun)\s+run\s*$/i, "lista los scripts"],
  [/^env\s*$/i, "lista las variables"],
  [/^(Push-Location|Pop-Location|Set-Location|Get-Date|Get-NetTCPConnection|Get-CimInstance|Get-FileHash|Join-Path|Split-Path|Out-String|Out-Null|Start-Sleep|Compare-Object|Group-Object|ConvertFrom-Json|ConvertTo-Json)(?=\s|$)/i, "solo lectura"],
  [/^(find)\b(?!.*(-delete|-exec\s+rm))/i, "búsqueda de archivos"],
  [/^(awk)\b(?!.*-i\s+inplace)/i, "solo lectura"],
  [/^(sed)\b(?!.*\s-[a-z]*i)/i, "solo lectura"],
  [/^(diff)\b/i, "comparación"],
  [/^(Get-ChildItem|gci|Get-Content|gc|Select-String|sls|Get-Item|gi|Test-Path|Resolve-Path|Get-Location|Measure-Object|Format-\w+|Write-Output|Write-Host|Get-Command|Get-Process|Sort-Object|Select-Object|Where-Object|ForEach-Object)\b/i, "solo lectura"],
  [/^(node|npm|pnpm|yarn|git|python|python3)\s+(--version|-v)\s*$/i, "versión"],
  [/^(npm|pnpm|yarn)\s+(ls|list|view|info|outdated|why|config\s+get)\b/i, "consulta de dependencias"],
];

// Variables que cambian QUÉ programa corre (o le inyectan código): darles valor sí se pregunta.
const VAR_PELIGROSA = /^(PATH|PATHEXT|LD_\w+|DYLD_\w+|NODE_OPTIONS|NODE_PATH|PYTHON(PATH|STARTUP|HOME)|BASH_ENV|IFS|PS4|PROMPT_COMMAND|PERL5\w*|RUBYOPT|JAVA_TOOL_OPTIONS|GIT_\w+|EDITOR|VISUAL|PAGER|SHELL|COMSPEC|NPM_CONFIG_\w+)$/i;
const VALOR_INOFENSIVO = { NODE_OPTIONS: /^["']?--max[-_]old[-_]space[-_]size=\d+["']?$/, GIT_PAGER: /^["']?(cat)?["']?$/, PAGER: /^["']?(cat)?["']?$/ };
const VALOR = String.raw`(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'])*`;
const ASIGNA = new RegExp(`^([A-Za-z_]\\w*)\\+?=(${VALOR})(?:\\s+|$)`);
const variablePeligrosa = (n, v) => VAR_PELIGROSA.test(n) && !VALOR_INOFENSIVO[n.toUpperCase()]?.test(v.trim());

/** Quita lo que va antes del comando (asignaciones, `export`, palabras de control). Devuelve { resto, peligro, quito }. */
function sinPrefijos(original, ps) {
  let o = original.trim();
  let quito = false;
  for (;;) {
    const antes = o;
    o = o.replace(/^(?:\{|\}|!)(?=\s|$)\s*/, "").replace(/\s*\}$/, "");
    if (ps) {
      o = o.replace(/^(?:if|else|elseif|foreach|for|while|try|catch|finally|do)(?=\s|\{|$)\s*/i, "");
      const env = o.match(/^\$env:(\w+)\s*=\s*/i);
      const valor = env && o.slice(env[0].length);
      if (env && variablePeligrosa(env[1], valor)) return { resto: o, peligro: env[1], quito };
      o = env ? valor : o.replace(/^\$[\w:]+\s*(?:[+-]?=(?!=)|\s+in\s)\s*/i, "");
    } else {
      o = o.replace(/^(?:if|then|elif|else|while|until|do)(?=\s|$)\s*/, "").replace(/^(?:done|fi)(?=\s|$)/, "").trim();
      if (/^for\s+\w+(\s+in(\s|$)|\s*$)/.test(o)) return { resto: "", quito: true };
      const nombre = o.match(/^(?:export|declare|local|readonly)\s+(?:-x\s+)?(?=[A-Za-z_]\w*(?:=|\s|$))/) ?? o.match(/^env\s+(?=[A-Za-z_]\w*=)/);
      if (nombre) {
        o = o.slice(nombre[0].length);
        // `export A B`: solo nombres.
        if (!nombre[0].startsWith("env")) o = o.replace(/^(?:[A-Za-z_]\w*(?:\s+|$))+(?!=)/, (m) => (VAR_PELIGROSA.test(m.trim()) ? m : ""));
      }
      for (let m; (m = o.match(ASIGNA)); o = o.slice(m[0].length)) if (variablePeligrosa(m[1], m[2])) return { resto: o, peligro: m[1], quito };
    }
    if (o === antes) return { resto: o, quito };
    quito = true;
  }
}

/** `git -C dir status` → `git status`; `npm -s --prefix web run lint` → `npm run lint`; `npx --no-install tsc` → `npx tsc`. */
function sinBanderas(s) {
  s = s.replace(/^git(?:\s+(?:-C\s+\S+|--no-pager|-P))+(?=\s)/i, "git").replace(/^npx(?:\s+(?:--no-install|--no))+(?=\s)/i, "npx");
  const pm = s.match(/^(npm|pnpm|yarn|bun)(?=\s)/i)?.[1];
  if (!pm) return s;
  const w = /^npm$/i.test(pm) ? String.raw`-w\s+\S+` : "-w";
  const bandera = String.raw`(?:\s+(?:-s|--silent|--if-present|-r|--recursive|--workspaces|${w}|(?:--workspace|--prefix|--dir|--cwd|--filter|-C)(?:=|\s+)\S+)(?=\s|$))+`;
  return s.replace(new RegExp(`^(${pm})${bandera}`, "i"), "$1").replace(new RegExp(`^(${pm}\\s+run)${bandera}`, "i"), "$1");
}

/** Clasifica un segmento simple (sin `;`, `&&`, `|`). `ps` = PowerShell. */
export function clasificarSegmento(seg, hostsApp = [], crudo = seg, ps = false) {
  if (!seg.trim()) return { figura: "leer", motivo: "vacío" };
  const pre = sinPrefijos(crudo, ps);
  if (pre.peligro) return { figura: "externo", motivo: `cambia ${pre.peligro}, que decide qué programa corre` };
  // Prefijos que no cambian lo que hace el comando.
  crudo = pre.resto;
  let s = quitarComillas(crudo).trim();
  // Solo se asignaron variables o es una palabra de control (lo de adentro de `$(…)` se clasifica aparte).
  if (!s || /^(?:\d*[<>]+&?\s*\S+\s*)+$/.test(s) || s === "$") return { figura: "leer", motivo: "variables o control" };
  // Un texto entre comillas en el lugar del comando: en bash lo ejecuta; en PowerShell es solo un valor.
  if (s === "''") return ps ? { figura: "leer", motivo: "texto" } : { figura: "externo", motivo: "comando entre comillas: no se sabe qué corre" };
  if (ps && (/^(?:[\d.,\s]|''|\$[\w:]+|@)+$/.test(s))) return { figura: "leer", motivo: "valor" };
  if (!ps && /^(?:source|\.)\s+(?:\S*\/)?\.env(?:\.[\w-]+)*\s*$/.test(s)) return { figura: "leer", motivo: "carga variables de entorno" };
  if (!ps && pre.quito && /^\$\w*$/.test(s)) return { figura: "externo", motivo: "corre lo que diga una variable" };
  s = sinBanderas(s.replace(/^(sudo|nohup|time|exec)\s+/i, ""));
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
  return { figura: "externo", desconocido: true, motivo: `no se pudo clasificar con seguridad: «${s.split(/\s+/).slice(0, 3).join(" ")}»` };
}

/** Clasifica un comando completo: la figura más peligrosa de sus partes (incluye las internas). */
export function clasificarComando(cmd, hostsApp = [], { ps = false } = {}) {
  const crudo = quitarHeredocs(String(cmd ?? "")).replace(/(^|\n)[ \t]*#[^\n]*/g, "$1");
  let r = { figura: "leer", motivo: "solo lectura" };
  for (const interno of internos(crudo)) r = peor(r, clasificarComando(interno, hostsApp));
  const sinComillas = quitarComillas(crudo);
  // Redirección a un archivo (no /dev/null ni $null): al menos editar.
  if (/(^|[^\d&>])>{1,2}\s*(?!\/dev\/null\b|&|\$null\b|nul\b)[^\s|;&]/i.test(sinComillas)) r = peor(r, { figura: "editar", motivo: "redirige la salida a un archivo" });
  if (/&>>?\s*(?!\/dev\/null\b)\S|>&\s*(?!\/dev\/null\b)[^\s\d-]/.test(sinComillas)) r = peor(r, { figura: "editar", motivo: "redirige la salida a un archivo" });
  // PowerShell: `& "programa.exe"` corre lo que está entre comillas o en la variable.
  if (ps && /(^|[;{|(\n=])\s*&\s*(''|\$)/.test(sinComillas)) r = peor(r, { figura: "externo", motivo: "corre un programa con &" });
  if (ps && /\]::\w+\s*\(/.test(sinComillas)) r = peor(r, { figura: "externo", motivo: "llama a un método de .NET" });
  // Bloques `{ … }` (ForEach-Object { Remove-Item … }): lo peligroso de adentro también cuenta.
  for (const bloque of sinComillas.split(/[{};|&\n]/)) {
    const b = sinBanderas(bloque.trim());
    for (const [re, motivo] of DESTRUCTIVO) if (sinComillas.includes("{") && re.test(b)) r = peor(r, { figura: "destructivo", motivo });
    for (const [re, motivo] of EXTERNO) if (sinComillas.includes("{") && re.test(b)) r = peor(r, { figura: "externo", motivo });
  }
  // Cada parte (separada por ; && || | & paréntesis o saltos, fuera de comillas) se clasifica por separado.
  for (const original of partir(crudo)) {
    const p = quitarComillas(original);
    if (!p.trim()) continue;
    r = peor(r, clasificarSegmento(p, hostsApp, original, ps));
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
    } else if (ch === "&" && (/[<>]/.test(cmd[i - 1] ?? "") || cmd[i + 1] === ">")) {
      actual += ch; // `2>&1` y `&>` son redirecciones, no separan comandos
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
  if (tool === "Bash" || tool === "PowerShell") return clasificarComando(ti.command, hostsApp, { ps: tool === "PowerShell" });
  if (tool === "WebFetch") return red(hostsDe(ti.url ?? ""), hostsApp, "WebFetch");
  if (tool === "WebSearch") return { figura: "externo", red: "fuera", motivo: "búsqueda en internet" };
  // Lanzar subagentes: solo el principal llega hasta aquí (a un subagente se le rechaza antes), y cada uno tiene su mano.
  if (tool === "Agent" || tool === "Task") return { figura: "leer", motivo: "lanza un subagente" };
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
  // Lo que no se sabe qué hace, del agente principal: lo deciden los permisos de Claude Code (si el proyecto lo eligió).
  if (tipo === "principal" && c.desconocido && cfg.figuras?.sinClasificar === "permisos") return null;
  // Modo automático: un `ask` del hook interrumpe y le quita la decisión al clasificador de Claude Code, que revisa
  // cada acción. Ahí la segunda llave es él; los jueces siguen sin poder salir de su mano.
  const peligro = c.figura === "externo" || c.figura === "destructivo";
  if (peligro && event?.permission_mode === "auto" && cfg.figuras?.enAuto !== "preguntar") {
    const juez = ["revisor", "persona", "especialista"].includes(tipo);
    if (!juez || c.desconocido || c.red === "app") return null;
    return { decision: "deny", motivo: `neurodanza: ${quien} no puede ${simbolo} (${c.motivo}); su mano es ${mano.map((f) => FIGURAS[f] ?? f).join(" ")}. En su lugar: pídelo al director.` };
  }
  if (peligro)
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
