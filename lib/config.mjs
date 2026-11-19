// neurodanza · configuración del proyecto.
// Busca `neurodanza.config.json` subiendo desde una carpeta, aplica los valores por defecto y
// valida lo mínimo. Si un proyecto no tiene el archivo, el plugin no hace nada en él.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const CONFIG_FILE = "neurodanza.config.json";

/** Valores por defecto: todo lo que un proyecto no defina. */
export const DEFAULTS = {
  repos: [],
  // Al iniciar la sesión: .gitignore de la raíz (si es un repo) y aviso de permisos de los worktrees.
  autoconfigurar: true,
  barreras: {
    secretos: true,
    secretosPermitidos: [".env.example", ".env.test", ".env.sample"],
    firmasIA: true,
    borradosRaiz: true,
    rutasProtegidas: [],
    migracionesInmutables: null,
    comandosProhibidos: [],
    exentos: [],
    // Comandos que pueden no terminar: sin un timeout acotado (o en segundo plano) se rechazan con la forma
    // correcta de correrlos. `tipo`: servidor | watch | suite. Ver docs/15-velocidad.md.
    timeoutComandos: {
      activo: true,
      maxSeg: 120,
      largos: [
        { tipo: "servidor", patron: "\\b(npm|pnpm|yarn|bun)\\s+(run\\s+)?(dev|start|serve|preview)\\b" },
        { tipo: "servidor", patron: "\\bnext\\s+(dev|start)\\b" },
        { tipo: "servidor", patron: "\\bnest\\s+start\\b" },
        { tipo: "servidor", patron: "\\bvite\\b(?![\\w-])(?!\\s+(build|optimize)\\b)" },
        { tipo: "servidor", patron: "\\b(nodemon|webpack-dev-server)\\b|\\bwebpack\\s+serve\\b" },
        { tipo: "watch", patron: "(^|\\s)--watch(All)?\\b" },
        { tipo: "watch", patron: "\\b(tsc|vitest|jest|node|webpack|rollup|esbuild|tsup)\\b[^|;&]*\\s-w(\\s|$)" },
        { tipo: "suite", patron: "\\b(npm|pnpm|yarn|bun)\\s+(run\\s+)?test(\\s+--)?\\s*($|[;&|)])" },
        { tipo: "suite", patron: "\\bvitest\\b(?![^|;&]*\\b(run|related|--run)\\b)" },
        { tipo: "suite", patron: "\\bjest\\b(?![^|;&]*(--ci\\b|--findRelatedTests|--testPathPattern|\\.(test|spec)\\.[cm]?[jt]sx?|\\s--\\s))" },
        { tipo: "suite", patron: "\\bplaywright\\s+test\\b(?![^|;&]*--(global-)?timeout\\b)" },
      ],
    },
  },
  retroalimentacion: {
    lintAlEditar: true,
    maxBloqueos: 3,
    cache: true, // el hook Stop no repite lint, tipos y pruebas de un repo cuyo cambio no se movió
    topeStopSeg: 90, // tope de la parte que bloquea del hook Stop; lo que no alcanza pasa al fondo
    topeFondoSeg: 1800, // tope de cada tarea en segundo plano (suite completa y lo que no alcanzó)
    version: null,
    bitacora: null,
    migraciones: null,
    pantallas: [],
    guias: null,
    regenerar: [],
    docs: null,
  },
  reglas: { coherencia: [], permisos: [], ui: [], docs: [] },
  app: {
    urls: ["http://localhost:3000"],
    levantar: null,
    idioma: "es-EC",
    ignorarConsola: ["status of 401"],
    login: { ruta: "/login", usuario: "Correo", clave: "Contraseña", boton: "ingresar|entrar|iniciar|login|sign in", espera: "/" },
  },
  roles: { adaptador: "json", fuente: null },
  panel: {
    min: 3,
    max: 5,
    umbral: 8.99,
    maxRondas: 3,
    ignorarRutas: [],
    ventana: "windows", // "windows": ventana en vivo en primer plano (solo Windows); "ninguna": solo el chat
    elenco: ".claude/personas/personas.json",
    fotos: ".claude/personas/fotos",
    evaluaciones: "docs/evaluaciones",
    usuarios: null,
  },
  evals: { casos: ".claude/evals/casos.json", informes: "docs/evaluaciones/evals", vigilar: [] },
  // Fusible: con `maxFallos` fallos de una capa externa (app, chromium, bd…) en el ciclo, la capa se funde
  // y no se reintenta más. `comprobaciones`: { capa: comando } que dice si la capa responde.
  fusible: { maxFallos: 2, comprobaciones: {} },
  // Pilas: lo que hizo cada subagente (lo guardan los hooks) y su línea de avance cada `avanceCada` pasos.
  pilas: { activo: true, avanceCada: 10 },
  // Figuras: qué puede hacer cada tipo de agente (◯ leer △ editar □ verificar ◇ externo ✕ destructivo).
  // Apagadas en configuraciones existentes (no cambian flujos); /neurodanza-init las prende en proyectos nuevos.
  figuras: { activo: false, manos: {} },
  // Catálogo de errores conocidos (lib/errores.mjs): se versiona para que todo el equipo lo aproveche.
  errores: { activo: true, archivo: ".neurodanza/errores.json", alIniciar: 5 },
  // Modo director: worktrees de las tareas ("auto" o una ruta con {proyecto}) y qué se enlaza en ellos.
  director: { worktrees: "auto", enlazar: ["node_modules"], rebobinar: { activo: true, umbralCorreccion: 0.5, maxMuertes: 2 } },
  // Constructos: lecciones por agente que nacen de la reflexión al cerrar y se aprueban solo si mejoran.
  constructos: { carpeta: ".neurodanza/constructos", compartido: "auto", minEvidencias: 2, ciclosPrueba: 3, maxLecciones: 30, automatico: true },
  // Planificador + ejecutor: plan del ciclo en archivo y presupuesto de pasos por subagente.
  ciclo: {
    plan: ".neurodanza/plan.md",
    maxPasos: { revisor: 25, persona: 40, implementador: 60, otro: 40 },
    // Corte por tiempo: aviso al 80 % y rechazo de toda herramienta al 100 % (solo subagentes).
    maxSegundos: { revisor: 300, persona: 420, implementador: 900, otro: 420 },
    // Sin un paso en este tiempo, el subagente queda marcado «sin latido» (para que el director decida).
    latidoSeg: 90,
    revisores: "segun-cambio", // "segun-cambio": solo los que aplican al diff; "todos": siempre los 4
  },
};

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Mezcla profunda de objetos (los arreglos se reemplazan). */
export function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

/** Busca el archivo de configuración subiendo desde `from` (máx. 8 niveles). */
export function findConfig(from = process.cwd()) {
  let dir = resolve(from);
  for (let i = 0; i < 8; i++) {
    const f = join(dir, CONFIG_FILE);
    if (existsSync(f)) return f;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** Errores de forma de la configuración (lista vacía = válida). */
export function validate(cfg) {
  const errors = [];
  if (!Array.isArray(cfg.repos)) errors.push("repos debe ser una lista");
  for (const [i, r] of (cfg.repos ?? []).entries()) {
    if (!r?.nombre) errors.push(`repos[${i}].nombre es obligatorio`);
    if (!r?.ruta) errors.push(`repos[${i}].ruta es obligatorio`);
  }
  const p = cfg.panel ?? {};
  if (!(p.min >= 1 && p.max >= p.min)) errors.push("panel.min y panel.max: 1 ≤ min ≤ max");
  if (!["windows", "ninguna"].includes(p.ventana)) errors.push('panel.ventana: "windows" o "ninguna"');
  if (!(p.umbral > 0 && p.umbral <= 10)) errors.push("panel.umbral: entre 0 y 10");
  if (!(Number.isInteger(p.maxRondas) && p.maxRondas >= 1)) errors.push("panel.maxRondas: entero ≥ 1");
  if (!["json", "markdown"].includes(cfg.roles?.adaptador)) errors.push('roles.adaptador: "json" o "markdown"');
  if (!["segun-cambio", "todos"].includes(cfg.ciclo?.revisores)) errors.push('ciclo.revisores: "segun-cambio" o "todos"');
  const rf = cfg.retroalimentacion ?? {};
  // El hook Stop tiene 120 s en hooks.json: la parte que bloquea debe caber con margen.
  if (!(Number.isInteger(rf.topeStopSeg) && rf.topeStopSeg >= 10 && rf.topeStopSeg <= 110)) errors.push("retroalimentacion.topeStopSeg: entero entre 10 y 110");
  if (!(Number.isInteger(rf.topeFondoSeg) && rf.topeFondoSeg >= 60)) errors.push("retroalimentacion.topeFondoSeg: entero ≥ 60");
  const tc = cfg.barreras?.timeoutComandos ?? {};
  // Claude Code acepta hasta 600 s de timeout por comando.
  if (!(Number.isInteger(tc.maxSeg) && tc.maxSeg >= 1 && tc.maxSeg <= 600)) errors.push("barreras.timeoutComandos.maxSeg: entero entre 1 y 600");
  for (const [k, v] of Object.entries(cfg.ciclo?.maxSegundos ?? {})) if (!(Number.isFinite(v) && v > 0)) errors.push(`ciclo.maxSegundos.${k}: número > 0`);
  if (!(Number.isFinite(cfg.ciclo?.latidoSeg) && cfg.ciclo.latidoSeg > 0)) errors.push("ciclo.latidoSeg: número > 0");
  if (!(Number.isInteger(cfg.fusible?.maxFallos) && cfg.fusible.maxFallos >= 1)) errors.push("fusible.maxFallos: entero ≥ 1");
  if (!(Number.isInteger(cfg.pilas?.avanceCada) && cfg.pilas.avanceCada >= 0)) errors.push("pilas.avanceCada: entero ≥ 0 (0 = sin recordatorio)");
  const rb = cfg.director?.rebobinar ?? {};
  if (!(Number.isFinite(rb.umbralCorreccion) && rb.umbralCorreccion > 0)) errors.push("director.rebobinar.umbralCorreccion: número > 0");
  if (!(Number.isInteger(rb.maxMuertes) && rb.maxMuertes >= 0)) errors.push("director.rebobinar.maxMuertes: entero ≥ 0");
  const FIG = ["leer", "editar", "verificar", "externo", "destructivo", "red-app"];
  for (const [tipo, mano] of Object.entries(cfg.figuras?.manos ?? {}))
    if (!Array.isArray(mano) || mano.some((x) => !FIG.includes(x))) errors.push(`figuras.manos.${tipo}: lista de ${FIG.join(", ")}`);
  for (const [i, l] of (tc.largos ?? []).entries()) {
    try {
      new RegExp(l?.patron ?? l, "i");
    } catch {
      errors.push(`barreras.timeoutComandos.largos[${i}]: patrón inválido`);
    }
  }
  return errors;
}

/**
 * Carga la configuración del proyecto (o null si no tiene). `root` = carpeta del archivo; las rutas
 * relativas de la configuración se resuelven contra ella con `abs()`.
 */
export function loadConfig(from = process.cwd()) {
  const file = findConfig(from);
  if (!file) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: JSON inválido (${e.message})`);
  }
  const cfg = merge(DEFAULTS, raw);
  const errors = validate(cfg);
  if (errors.length) throw new Error(`${file}:\n- ${errors.join("\n- ")}`);
  const root = dirname(file);
  return { ...cfg, root, file, abs: (p) => (p == null ? null : isAbsolute(p) ? p : join(root, p)) };
}

/** Repo (de `repos`) que contiene un archivo, con la ruta relativa dentro de él. */
export function repoOf(cfg, file) {
  const f = String(file).replace(/\\/g, "/").toLowerCase();
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta).replace(/\\/g, "/").replace(/\/$/, "");
    if (f.startsWith(dir.toLowerCase() + "/")) return { repo: r, dir, rel: String(file).replace(/\\/g, "/").slice(dir.length + 1) };
  }
  return null;
}

const escapeRe = (s) => s.replace(/[.+^$()|[\]\\{}]/g, (ch) => `\\${ch}`);

/** Glob simple (`*`, `**`, `?`, `{a,b}`) → RegExp. */
export function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      re += ".*";
      i++;
      if (g[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{" && g.indexOf("}", i) > i) {
      const end = g.indexOf("}", i);
      re += `(${g.slice(i + 1, end).split(",").map(escapeRe).join("|")})`;
      i = end;
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`, "i");
}

export const matchesAny = (path, globs = []) => globs.some((g) => globToRegExp(g).test(String(path).replace(/\\/g, "/")));
