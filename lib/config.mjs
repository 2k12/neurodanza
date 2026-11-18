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
  },
  retroalimentacion: {
    lintAlEditar: true,
    maxBloqueos: 3,
    cache: true, // el hook Stop no repite lint, tipos y pruebas de un repo cuyo cambio no se movió
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
  // Catálogo de errores conocidos (lib/errores.mjs): se versiona para que todo el equipo lo aproveche.
  errores: { activo: true, archivo: ".neurodanza/errores.json", alIniciar: 5 },
  // Modo director: worktrees de las tareas ("auto" o una ruta con {proyecto}) y qué se enlaza en ellos.
  director: { worktrees: "auto", enlazar: ["node_modules"] },
  // Constructos: lecciones por agente que nacen de la reflexión al cerrar y se aprueban solo si mejoran.
  constructos: { carpeta: ".neurodanza/constructos", compartido: "auto", minEvidencias: 2, ciclosPrueba: 3, maxLecciones: 30, automatico: true },
  // Planificador + ejecutor: plan del ciclo en archivo y presupuesto de pasos por subagente.
  ciclo: {
    plan: ".neurodanza/plan.md",
    maxPasos: { revisor: 25, persona: 40, implementador: 60, otro: 40 },
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
