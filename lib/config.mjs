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
    // Comentarios nuevos en JS/TS (lib/comentarios.mjs): false, "basura" (código comentado y TODO sin ticket) o
    // "estricto" (solo directivas, JSDoc de lo exportado y `// POR QUÉ: …`). Apagado en configuraciones existentes.
    comentarios: false,
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
    // Recorridos (Tenet): los permanentes viven aquí (en git) con un id estable. Un paso crítico que no cumple
    // limita la nota de esa persona a `notaMaxSiFalla`.
    recorridos: ".claude/personas/recorridos",
    notaMaxSiFalla: 6,
    // Memoria por recorrido (Westworld): historial por versión de cada recorrido permanente (en git). Regresión
    // = `clics` o más clics que la última versión aprobada, o `tiempo` (fracción) más de tiempo.
    memoria: ".claude/personas/memoria",
    // Exploración libre de cada persona tras su recorrido: máximo de pasos, solo en pantallas que tocó el diff.
    exploracionPasos: 10,
    regresion: { clics: 1, tiempo: 0.3 },
    // Antes de cada captura: red quieta, sin indicadores de carga visibles y DOM quieto `quietoMs`; tope `maxSeg`.
    // `cargando`: selectores CSS extra de carga del proyecto (se suman a los comunes).
    carga: { maxSeg: 15, quietoMs: 400, cargando: [] },
  },
  evals: { casos: ".claude/evals/casos.json", informes: "docs/evaluaciones/evals", vigilar: [] },
  // Fusible: con `maxFallos` fallos de una capa externa (app, chromium, bd…) en el ciclo, la capa se funde
  // y no se reintenta más. `comprobaciones`: { capa: comando } que dice si la capa responde.
  fusible: { maxFallos: 2, comprobaciones: {} },
  // Pilas: lo que hizo cada subagente (lo guardan los hooks) y su línea de avance cada `avanceCada` pasos.
  pilas: { activo: true, avanceCada: 10 },
  // Figuras: qué puede hacer cada tipo de agente (◯ leer △ editar □ verificar ◇ externo ✕ destructivo).
  // Apagadas en configuraciones existentes (no cambian flujos); /neurodanza-init las prende en proyectos nuevos.
  figuras: { activo: false, manos: {}, cuarentena: 3, sinClasificar: "preguntar" },
  // Fantasmas: ataques acotados contra la app local, en modo propuesta (no editan repos). Los hosts de
  // app.urls se agregan solos a `hosts`.
  fantasmas: { activo: true, hosts: ["localhost", "127.0.0.1"], max: 3, maxPasos: 15, maxSegundos: 180 },
  // Hotel de especialistas (lib/hotel.mjs): el director los consulta antes de delegar; solo lectura, con presupuesto
  // propio y respuestas en caché por firma del área + pregunta.
  hotel: { activo: true, maxPasos: 8, maxSegundos: 120, maxPorTarea: 4 },
  // Índice pre-cocido por commit (lib/indice.mjs): resumen enfocado para contratos y mensajes de subagentes.
  indice: { activo: true, maxLineas: 60 },
  // CLI de la app (lib/app.mjs): sesiones en caché `sesionMin` minutos; macros en git que nacen de los comandos de
  // `repetidoMin` caracteres o más que se repiten `repetidoVeces` veces; `podar` propone las que llevan `podarDias` sin uso.
  cli: { activo: true, macros: ".claude/neurodanza-macros.json", repetidoMin: 200, repetidoVeces: 3, podarDias: 30, sesionMin: 10 },
  // Autoajuste (lib/autoajuste.mjs): una pasada al día por la telemetría de las sesiones (lib/telemetria.mjs, de los
  // transcripts de Claude Code; `transcripts` reemplaza la carpeta). Lecciones, errores conocidos y macros entran
  // solos (con su freno); presupuestos y arreglos son propuestas que aplica el usuario y después se evalúan.
  autoajuste: { activo: true, ajustes: ".claude/neurodanza-ajustes.json", umbrales: {} },
  telemetria: { transcripts: null },
  // Catálogo de errores conocidos (lib/errores.mjs): se versiona para que todo el equipo lo aproveche.
  errores: { activo: true, archivo: ".neurodanza/errores.json", alIniciar: 5 },
  // Modo director: worktrees de las tareas ("auto" o una ruta con {proyecto}) y qué se enlaza en ellos.
  director: { worktrees: "auto", enlazar: ["node_modules"], rebobinar: { activo: true, umbralCorreccion: 0.5, maxMuertes: 2 } },
  // Constructos: lecciones por agente que nacen de la reflexión al cerrar y se aprueban solo si mejoran.
  constructos: { carpeta: ".neurodanza/constructos", compartido: "auto", minEvidencias: 2, ciclosPrueba: 3, maxLecciones: 30, automatico: true },
  // Planificador + ejecutor: plan del ciclo en archivo y presupuesto de pasos por subagente.
  ciclo: {
    plan: ".neurodanza/plan.md",
    // Personas: 20 pasos y 210 s (antes 40 y 420). Con recorrido y exploración acotada, `panel_pasos` midió 14 pasos
    // frente a 40 sin guion (35 %); se aplicó esa proporción con un margen del 40 % para pantallas con más controles.
    maxPasos: { revisor: 25, persona: 20, implementador: 60, otro: 40 },
    // Corte por tiempo: aviso al 80 % y rechazo de toda herramienta al 100 % (solo subagentes).
    maxSegundos: { revisor: 300, persona: 210, implementador: 900, otro: 420 },
    // Sin un paso en este tiempo, el subagente queda marcado «sin latido» (para que el director decida).
    latidoSeg: 90,
    revisores: "segun-cambio", // "segun-cambio": solo los que aplican al diff; "todos": siempre los 4
    // Pruebas primero (lib/pruebas.mjs): si cambió código y una prueba nueva o cambiada no se vio en rojo antes de
    // implementar, el hook Stop "avisar" (no bloquea) o "exigir" (bloquea). false = no mira.
    pruebaPrimero: "avisar",
    // Proporcionalidad (lib/riesgo.mjs): bajo = lint, tipos y pruebas; medio = 1 revisor y 1 persona; alto = todo.
    // Alto: archivos de `altos` o migraciones, código en 2 repos o más de `lineasAlto` líneas.
    riesgo: {
      activo: true,
      lineasBajo: 40,
      lineasAlto: 400,
      altos: ["**/migrations/**", "**/migraciones/**", "**/*.sql", "**/*auth*", "**/*auth*/**", "**/*guard*", "**/*guard*/**", "**/*polic*", "**/*polic*/**", "**/*permis*", "**/*permis*/**", "**/*acl*", "**/*casl*", "**/middleware*"],
      // Líneas cambiadas del código que tocan permisos (expresión regular, sin distinguir mayúsculas): el cambio
      // nunca es bajo y entra el revisor de permisos. `false` = no mirar el contenido.
      permisosEnCodigo: "\\b(permis\\w*|permission\\w*|useCan|hasRole|requireRole|roles?Guard|isAdmin|authoriz\\w*|NoAccess|forbidden|ability|casl|acl)\\b|\\bcan\\(",
    },
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
  if (!(Number.isFinite(p.notaMaxSiFalla) && p.notaMaxSiFalla >= 1 && p.notaMaxSiFalla <= 10)) errors.push("panel.notaMaxSiFalla: entre 1 y 10");
  if (typeof p.recorridos !== "string" || !p.recorridos) errors.push("panel.recorridos: carpeta");
  if (typeof p.memoria !== "string" || !p.memoria) errors.push("panel.memoria: carpeta");
  if (!(Number.isInteger(p.exploracionPasos) && p.exploracionPasos >= 0)) errors.push("panel.exploracionPasos: entero ≥ 0");
  if (!(Number.isInteger(p.regresion?.clics) && p.regresion.clics >= 1)) errors.push("panel.regresion.clics: entero ≥ 1");
  if (!(Number.isFinite(p.regresion?.tiempo) && p.regresion.tiempo > 0)) errors.push("panel.regresion.tiempo: fracción > 0 (0.3 = +30 %)");
  if (!(Number.isFinite(p.carga?.maxSeg) && p.carga.maxSeg > 0)) errors.push("panel.carga.maxSeg: segundos > 0");
  if (!(Number.isInteger(p.carga?.quietoMs) && p.carga.quietoMs >= 0)) errors.push("panel.carga.quietoMs: entero ≥ 0");
  if (!(Array.isArray(p.carga?.cargando) && p.carga.cargando.every((s) => typeof s === "string" && s))) errors.push("panel.carga.cargando: lista de selectores CSS");
  if (!["json", "markdown"].includes(cfg.roles?.adaptador)) errors.push('roles.adaptador: "json" o "markdown"');
  if (!["segun-cambio", "todos"].includes(cfg.ciclo?.revisores)) errors.push('ciclo.revisores: "segun-cambio" o "todos"');
  if (![false, "avisar", "exigir"].includes(cfg.ciclo?.pruebaPrimero)) errors.push('ciclo.pruebaPrimero: false, "avisar" o "exigir"');
  const rz = cfg.ciclo?.riesgo ?? {};
  if (typeof rz.activo !== "boolean") errors.push("ciclo.riesgo.activo: true o false");
  if (!(Number.isInteger(rz.lineasBajo) && rz.lineasBajo >= 0)) errors.push("ciclo.riesgo.lineasBajo: entero ≥ 0");
  if (!(Number.isInteger(rz.lineasAlto) && rz.lineasAlto > rz.lineasBajo)) errors.push("ciclo.riesgo.lineasAlto: entero mayor que lineasBajo");
  if (rz.permisosEnCodigo !== false) {
    try {
      if (typeof rz.permisosEnCodigo !== "string" || !rz.permisosEnCodigo) throw new Error();
      new RegExp(rz.permisosEnCodigo, "i");
    } catch {
      errors.push("ciclo.riesgo.permisosEnCodigo: expresión regular válida o false");
    }
  }
  if (!(Array.isArray(rz.altos) && rz.altos.every((g) => typeof g === "string"))) errors.push("ciclo.riesgo.altos: lista de globs");
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
  const ho = cfg.hotel ?? {};
  if (!(Number.isInteger(ho.maxPasos) && ho.maxPasos >= 1)) errors.push("hotel.maxPasos: entero ≥ 1");
  if (!(Number.isFinite(ho.maxSegundos) && ho.maxSegundos > 0)) errors.push("hotel.maxSegundos: número > 0");
  if (!(Number.isInteger(ho.maxPorTarea) && ho.maxPorTarea >= 0)) errors.push("hotel.maxPorTarea: entero ≥ 0");
  if (!(Number.isInteger(cfg.indice?.maxLineas) && cfg.indice.maxLineas >= 5)) errors.push("indice.maxLineas: entero ≥ 5");
  if (![false, true, "basura", "estricto"].includes(cfg.barreras?.comentarios)) errors.push('barreras.comentarios: false, "basura" o "estricto"');
  const cl = cfg.cli ?? {};
  const aa = cfg.autoajuste ?? {};
  if (typeof aa.activo !== "boolean") errors.push("autoajuste.activo: true o false");
  if (typeof aa.ajustes !== "string" || !aa.ajustes) errors.push("autoajuste.ajustes: archivo");
  if (!aa.umbrales || typeof aa.umbrales !== "object" || Object.values(aa.umbrales).some((v) => !(Number.isFinite(v) && v > 0))) errors.push("autoajuste.umbrales: { nombre: número > 0 }");
  if (cfg.telemetria?.transcripts != null && typeof cfg.telemetria.transcripts !== "string") errors.push("telemetria.transcripts: carpeta o null");
  if (typeof cl.activo !== "boolean") errors.push("cli.activo: true o false");
  if (typeof cl.macros !== "string" || !cl.macros) errors.push("cli.macros: archivo");
  if (!(Number.isInteger(cl.repetidoMin) && cl.repetidoMin >= 20)) errors.push("cli.repetidoMin: entero ≥ 20");
  if (!(Number.isInteger(cl.repetidoVeces) && cl.repetidoVeces >= 2)) errors.push("cli.repetidoVeces: entero ≥ 2");
  if (!(Number.isFinite(cl.podarDias) && cl.podarDias > 0)) errors.push("cli.podarDias: número > 0");
  if (!(Number.isFinite(cl.sesionMin) && cl.sesionMin > 0)) errors.push("cli.sesionMin: número > 0");
  const fa = cfg.fantasmas ?? {};
  if (!(Array.isArray(fa.hosts) && fa.hosts.every((h) => typeof h === "string"))) errors.push("fantasmas.hosts: lista de hosts");
  if (!(Number.isInteger(fa.max) && fa.max >= 0)) errors.push("fantasmas.max: entero ≥ 0");
  if (!(Number.isInteger(fa.maxPasos) && fa.maxPasos >= 1)) errors.push("fantasmas.maxPasos: entero ≥ 1");
  if (!(Number.isFinite(fa.maxSegundos) && fa.maxSegundos > 0)) errors.push("fantasmas.maxSegundos: número > 0");
  const FIG = ["leer", "editar", "verificar", "externo", "destructivo", "red-app"];
  if (!["preguntar", "permisos"].includes(cfg.figuras?.sinClasificar)) errors.push('figuras.sinClasificar: "preguntar" o "permisos"');
  if (!(Number.isInteger(cfg.figuras?.cuarentena) && cfg.figuras.cuarentena >= 1)) errors.push("figuras.cuarentena: entero ≥ 1");
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
