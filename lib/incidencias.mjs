#!/usr/bin/env node
// neurodanza · incidencias: rama de desarrollo por repo, graphify opcional, fichas con su evidencia de antes y
// después, y el registro al día con ellas. Consulta, no obliga: nada se crea ni se trae sin que el usuario lo pida,
// y lo que responde «siempre» o «nunca» queda guardado. Nunca hace commit. Ver docs/24-incidencias.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node incidencias.mjs estado [--sin-red]                  qué hay y qué falta preguntar (una sola vez, al empezar)
//   node incidencias.mjs guardar --rama repo=develop | --traer siempre|nunca|preguntar | --graphify siempre|nunca|preguntar
//   node incidencias.mjs base                                crea lo que falte de incidencias/ (no sobrescribe)
//   node incidencias.mjs inventario --area frontend [--escribir]   vistas o rutas que no están en INVENTARIO.md
//   node incidencias.mjs traer --repo <r>                    fetch y, si es posible sin riesgo, avance rápido
//   node incidencias.mjs alcance --archivos "repo:ruta,…"    pantallas afectadas e incidencias que ya hablan de eso
//   node incidencias.mjs nueva --area frontend --modulo ING --titulo "…" [--rol …] [--vista …] [--archivo …] [--severidad S2 --alcance Vista --esfuerzo Bajo …]
//   node incidencias.mjs evidencia --id <ID> --momento antes|despues --ruta /api/x [--metodo GET] [--usuario <persona>] [--cuerpo <json>]
//   node incidencias.mjs cambiar --id <ID> --estado "En corrección" [--nota "…"] [--reabrir]
//   node incidencias.mjs registro [--area frontend] [--escribir]   diferencias entre fichas y REGISTRO.md
//   node incidencias.mjs revisar --repo <r> --desde <sha>    incidencias abiertas cuyos archivos cambiaron
//   node incidencias.mjs reglas --repo <r>                   cómo son los commits de ese repo
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { escribirAtomico } from "./procesos.mjs";

const PLANTILLAS = fileURLToPath(new URL("../plantillas/incidencias", import.meta.url));
const MOMENTOS = ["antes", "despues"];

/** Estados que solo pone el responsable (la barrera se lo pregunta; un subagente no puede). */
export const RESERVADOS = ["Verificada", "Cerrada", "Descartada"];
export const ESTADOS = ["Abierta", "Priorizada", "En corrección", "En rama", "En PR", "Corregida · por verificar", "Resuelta por otro cambio", ...RESERVADOS];

export const esReservado = (estado) => RESERVADOS.some((r) => new RegExp(`^${r}(?![\\p{L}])`, "iu").test(String(estado ?? "").trim()));
const esAbierta = (estado) => !esReservado(estado) && !/^resuelta/i.test(String(estado ?? "").trim());

// ───────────────────────── git (solo lectura, salvo `traer`) ─────────────────────────

function git(dir, args, timeout = 20_000) {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
  } catch {
    return null;
  }
}

const reposGit = (cfg) => cfg.repos.filter((r) => existsSync(join(cfg.abs(r.ruta), ".git")));

function repoPorNombre(cfg, nombre) {
  const r = reposGit(cfg).find((x) => x.nombre === nombre);
  if (!r) throw new Error(`no hay un repo git «${nombre}» en la configuración (${reposGit(cfg).map((x) => x.nombre).join(", ") || "ninguno"})`);
  return r;
}

/** Ramas candidatas a rama de desarrollo, de la más a la menos probable (puro). */
export function candidatas(ramas, porDefecto = "") {
  const orden = ["develop", "development", "dev", "pre-main", "staging", "main", "master"];
  const hay = new Set(ramas);
  return [...new Set([...orden.filter((r) => hay.has(r) && r !== porDefecto && !["main", "master"].includes(r)), porDefecto, ...orden.filter((r) => hay.has(r))])].filter((r) => r && hay.has(r));
}

function ramasRemotas(dir) {
  return (git(dir, ["for-each-ref", "--format=%(refname)", "refs/remotes/origin"]) ?? "")
    .split(/\r?\n/)
    .map((x) => x.replace("refs/remotes/origin/", ""))
    .filter((x) => x && x !== "HEAD");
}

const existeRama = (dir, rama) => git(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${rama}`]) !== null;
const ramaValida = (r) => /^[\w][\w./-]*$/.test(String(r ?? "")) && !String(r).includes("..");

// ───────────────────────── preferencias (locales) ─────────────────────────

const archivoPref = (cfg) => cfg.abs(join(".neurodanza", "incidencias.json"));

export function preferencias(cfg) {
  const base = { ramas: {}, traer: "preguntar", graphify: "preguntar" };
  try {
    return { ...base, ...JSON.parse(readFileSync(archivoPref(cfg), "utf8")) };
  } catch {
    return base;
  }
}

export function guardarPreferencia(cfg, { rama, traer, graphify }) {
  const p = preferencias(cfg);
  const modos = ["preguntar", "siempre", "nunca"];
  if (rama) {
    const [repo, nombre] = String(rama).split(/=(.+)/);
    const dir = cfg.abs(repoPorNombre(cfg, repo).ruta);
    if (!ramaValida(nombre)) throw new Error(`rama inválida: ${nombre}`);
    if (!existeRama(dir, nombre)) throw new Error(`${repo} no tiene origin/${nombre}`);
    p.ramas = { ...p.ramas, [repo]: nombre };
  }
  for (const [k, v] of Object.entries({ traer, graphify })) {
    if (v === undefined) continue;
    if (!modos.includes(v)) throw new Error(`${k}: ${modos.join(", ")}`);
    p[k] = v;
  }
  mkdirSync(dirname(archivoPref(cfg)), { recursive: true });
  escribirAtomico(archivoPref(cfg), JSON.stringify(p, null, 2));
  return p;
}

// ───────────────────────── graphify (opcional) ─────────────────────────

/** graphify: carpeta aparte con los mapas. Nunca se instala ni se corre desde aquí. */
export function estadoGraphify(cfg, instalado = null) {
  const carpeta = cfg.incidencias.graphify;
  const dir = cfg.abs(carpeta);
  const hayCarpeta = existsSync(dir);
  const guion = hayCarpeta && existsSync(join(dir, "actualizar.sh"));
  if (instalado === null) {
    try {
      execFileSync(process.platform === "win32" ? "where" : "which", ["graphify"], { stdio: "ignore", timeout: 5000, windowsHide: true });
      instalado = true;
    } catch {
      instalado = false;
    }
  }
  return { carpeta, hayCarpeta, instalado, actualizar: guion ? `bash ${carpeta}/actualizar.sh` : null };
}

// ───────────────────────── fichas y registro ─────────────────────────

export function areasDe(cfg) {
  return Object.entries(cfg.incidencias.areas).map(([nombre, a]) => ({ nombre, prefijo: a.prefijo, repo: a.repo ?? nombre, evidencia: a.evidencia ?? "capturas", dir: cfg.abs(join(cfg.incidencias.carpeta, nombre)) }));
}

const areaPorNombre = (cfg, nombre) => {
  const a = areasDe(cfg).find((x) => x.nombre === nombre);
  if (!a) throw new Error(`área desconocida: ${nombre} (${areasDe(cfg).map((x) => x.nombre).join(", ")})`);
  return a;
};

/** Área de un ID por su prefijo (`FE-ING-001` → frontend). Valida el ID: forma parte de una ruta. */
export function areaDeId(cfg, id) {
  if (!/^[A-Z]{1,5}-[A-Z0-9]{1,8}-\d{3,}$/.test(String(id ?? ""))) throw new Error(`ID inválido: ${id} (p. ej. FE-GEN-001)`);
  const a = areasDe(cfg).find((x) => String(id).startsWith(`${x.prefijo}-`));
  if (!a) throw new Error(`ningún área usa el prefijo de ${id}`);
  return a;
}

const celdas = (linea) => linea.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
const escaparCelda = (v) => String(v ?? "").replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|").trim();
const eol = (t) => (t.includes("\r\n") ? "\r\n" : "\n");
const limpio = (v) => String(v).replace(/[*_`]/g, "").trim().toLowerCase();

/** Valor de un campo de la tabla de una ficha (`| Estado | Abierta |`), o null. */
export function campo(texto, nombre) {
  for (const l of texto.split(/\r?\n/)) {
    if (!l.startsWith("|")) continue;
    const c = celdas(l);
    if (c.length >= 2 && limpio(c[0]) === limpio(nombre)) return c[1];
  }
  return null;
}

/** La ficha con el campo cambiado (si no existe la fila, queda igual). */
export function conCampo(texto, nombre, valor) {
  let hecho = false;
  return texto
    .split(/\r?\n/)
    .map((l) => {
      if (hecho || !l.startsWith("|") || limpio(celdas(l)[0]) !== limpio(nombre)) return l;
      hecho = true;
      return `| ${celdas(l)[0]} | ${escaparCelda(valor)} |`;
    })
    .join(eol(texto));
}

export const rutaFicha = (area, id) => join(area.dir, "registradas", `${id}.md`);

export function fichas(area) {
  const dir = join(area.dir, "registradas");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[A-Z]+-[A-Z0-9]+-\d+\.md$/.test(f))
    .map((f) => {
      const texto = readFileSync(join(dir, f), "utf8");
      const titulo = (texto.match(/^#\s+(.+)$/m)?.[1] ?? "").replace(/^\S+\s*·\s*/, "").trim();
      return { id: f.slice(0, -3), archivo: join(dir, f), texto, titulo, estado: campo(texto, "Estado") ?? "", componente: campo(texto, "Componente o archivo probable") ?? "" };
    });
}

/** Prioridad por severidad × alcance × esfuerzo (la regla de METODOLOGIA.md de la plantilla). */
export function prioridad(sev, alcance, esfuerzo) {
  const s = String(sev ?? "").toUpperCase();
  const global = /^global/i.test(alcance ?? "");
  if (!/^S[1-4]$/.test(s)) return "—";
  if (s === "S1" || (s === "S2" && global)) return "P1";
  if (s === "S2" || (s === "S3" && global && /^bajo/i.test(esfuerzo ?? ""))) return "P2";
  return "P3";
}

/** Columnas del registro → valor que sale de la ficha. */
function valorColumna(col, f, modulo) {
  const c = limpio(col).replace(/\.$/, "");
  const de = (n) => campo(f.texto, n);
  if (c === "id") return `[${f.id}](registradas/${f.id}.md)`;
  if (c === "título" || c === "titulo") return f.titulo;
  if (c === "módulo" || c === "modulo") return de("Módulo") ?? modulo;
  if (c.startsWith("sev")) return de("Severidad");
  if (c.startsWith("prio")) return de("Prioridad");
  if (c.startsWith("esfuerzo")) return de("Esfuerzo y riesgo") ?? de("Esfuerzo");
  if (c === "raíz" || c === "raiz") return de("Incidencia raíz");
  return de(col);
}

/**
 * Pone el registro al día con las fichas (puro). Solo toca la celda «Estado» de las filas que difieren y agrega
 * las que faltan; lo demás queda como está. Un estado reservado en el registro no se baja: se informa.
 */
export function sincronizar(registro, lista, { reabrir = false } = {}) {
  const L = registro.split(/\r?\n/);
  const cab = L.findIndex((l) => l.startsWith("|") && limpio(celdas(l)[0]) === "id" && celdas(l).some((c) => limpio(c) === "estado"));
  if (cab < 0) throw new Error("REGISTRO.md no tiene una tabla con las columnas ID y Estado");
  const cols = celdas(L[cab]);
  const iEstado = cols.findIndex((c) => limpio(c) === "estado");
  const filas = new Map();
  let fin = cab + 1;
  for (let i = cab + 2; i < L.length && L[i].startsWith("|"); i++) {
    const id = celdas(L[i])[0].match(/[A-Z]+-[A-Z0-9]+-\d+/)?.[0];
    if (id) filas.set(id, i);
    fin = i;
  }
  const cambios = [];
  const nuevas = [];
  const conflictos = [];
  for (const f of lista) {
    if (!filas.has(f.id)) {
      nuevas.push(f.id);
      continue;
    }
    const c = celdas(L[filas.get(f.id)]);
    const hay = c[iEstado] ?? "";
    if (hay === f.estado || !f.estado) continue;
    // Lo que el responsable ya decidió en el registro no lo deshace una ficha sin actualizar.
    if (esReservado(hay) && !esReservado(f.estado) && !reabrir) {
      conflictos.push({ id: f.id, registro: hay, ficha: f.estado });
      continue;
    }
    cambios.push({ id: f.id, de: hay, a: f.estado });
    c[iEstado] = escaparCelda(f.estado);
    L[filas.get(f.id)] = `| ${c.join(" | ")} |`;
  }
  const agregadas = lista.filter((f) => nuevas.includes(f.id)).map((f) => `| ${cols.map((col) => escaparCelda(valorColumna(col, f, f.id.split("-")[1]) || "—")).join(" | ")} |`);
  L.splice(fin + 1, 0, ...agregadas);
  return { texto: L.join(eol(registro)), cambios, nuevas, conflictos, sinFicha: [...filas.keys()].filter((id) => !lista.some((f) => f.id === id)) };
}

function ponerRegistroAlDia(area, escribir = true, solo = null) {
  const f = join(area.dir, "REGISTRO.md");
  if (!existsSync(f)) return null;
  const lista = fichas(area).filter((x) => !solo || x.id === solo);
  const r = sincronizar(readFileSync(f, "utf8"), lista);
  if (escribir && (r.cambios.length || r.nuevas.length)) escribirAtomico(f, r.texto);
  return { cambios: r.cambios, nuevas: r.nuevas, conflictos: r.conflictos, ...(solo ? {} : { sinFicha: r.sinFicha }) };
}

/** Bloque de la PLANTILLA: lo que va entre las vallas ```markdown, o todo el archivo si no las tiene. */
export const bloquePlantilla = (t) => (t.match(/```markdown\r?\n([\s\S]*?)\r?\n```/)?.[1] ?? t);

/** Ficha nueva desde la plantilla (puro): pone el ID y los campos; lo que no se dio queda «—». */
export function fichaDesde(plantilla, { id, titulo, campos }) {
  const pre = id.split("-")[0];
  let t = bloquePlantilla(plantilla).replace(/\r\n/g, "\n");
  t = t.replace(/^#\s+.*$/m, () => `# ${id} · ${titulo}`).replace(new RegExp(`${pre}-<[^>\\n]+>-NNN`, "g"), id);
  return t
    .split("\n")
    .map((l) => {
      if (!l.startsWith("|")) return l;
      const c = celdas(l);
      if (c.length !== 2 || /^:?-+:?$/.test(c[0]) || limpio(c[0]) === "campo") return l;
      const k = Object.keys(campos).find((x) => limpio(x) === limpio(c[0]));
      return `| ${c[0]} | ${escaparCelda((k && campos[k]) || "—")} |`;
    })
    .join("\n");
}

function siguienteId(area, modulo) {
  const pre = `${area.prefijo}-${modulo}-`;
  const reg = join(area.dir, "REGISTRO.md");
  const vistos = [...fichas(area).map((f) => f.id), ...((existsSync(reg) ? readFileSync(reg, "utf8") : "").match(/[A-Z]+-[A-Z0-9]+-\d+/g) ?? [])];
  const max = Math.max(0, ...vistos.filter((x) => x.startsWith(pre)).map((x) => Number(x.slice(pre.length))));
  return `${pre}${String(max + 1).padStart(3, "0")}`;
}

/** Incidencias abiertas que nombran un archivo (por su ruta, o por su nombre si no es genérico). */
export function queNombran(lista, archivos) {
  const generico = /^(page|index|layout|route|main|styles?)\.\w+$/i;
  return lista
    .filter((f) => esAbierta(f.estado))
    .map((f) => ({ id: f.id, titulo: f.titulo, estado: f.estado, archivos: archivos.filter((a) => f.texto.includes(a) || (!generico.test(a.split("/").pop()) && new RegExp(`(^|[^\\w.-])${a.split("/").pop().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(f.componente))) }))
    .filter((x) => x.archivos.length);
}

export async function alcance(cfg, archivos) {
  const changes = {};
  for (const x of archivos) {
    const [repo, f] = x.split(/:(.+)/);
    if (!f) throw new Error(`usa repo:ruta (${x})`);
    (changes[repo] ??= []).push(f);
  }
  const { impacto } = await import("./impacto.mjs");
  const p = impacto(cfg, { changes }).pantallas.map((q) => ({ repo: q.repo, ruta: q.ruta, via: q.via.join(" → ") }));
  const sueltos = Object.values(changes).flat();
  return { pantallas: p, sugerido: p.length > 1 ? "nace en algo compartido: registra una incidencia raíz y enlaza las vistas" : "una sola vista o ninguna conocida", yaRegistradas: areasDe(cfg).flatMap((a) => queNombran(fichas(a), sueltos)) };
}

export async function nueva(cfg, d) {
  const area = areaPorNombre(cfg, d.area);
  const modulo = String(d.modulo ?? "").toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(modulo)) throw new Error("--modulo: código corto en letras (p. ej. GEN)");
  if (!d.titulo) throw new Error("--titulo: qué pasa, no cómo arreglarlo");
  const fp = join(area.dir, "PLANTILLA.md");
  if (!existsSync(fp)) throw new Error(`falta ${area.nombre}/PLANTILLA.md (incidencias.mjs base)`);
  const hoy = new Date().toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" });
  const campos = {
    Estado: d.estado ?? "Abierta",
    Rol: d.rol,
    "Vista y ruta": d.vista,
    "Método y ruta": d.vista,
    Resolución: area.evidencia === "capturas" ? cfg.incidencias.resoluciones.map((r) => r.replace("x", " × ")).join(" · ") : "",
    "Perspectiva que la detectó": d.perspectiva,
    Categoría: d.categoria,
    Severidad: d.severidad,
    Alcance: d.alcance,
    "Esfuerzo y riesgo": d.esfuerzo,
    Prioridad: d.prioridad ?? prioridad(d.severidad, d.alcance, d.esfuerzo),
    "Incidencia raíz": d.raiz,
    "Componente o archivo probable": d.archivo,
    "Fecha y quién la registró": `${hoy} · ${d.quien ?? "—"}`,
  };
  if (esReservado(campos.Estado)) throw new Error(`una incidencia nueva no puede nacer «${campos.Estado}»`);
  mkdirSync(join(area.dir, "registradas"), { recursive: true });
  // Antes de crearla: las abiertas que ya nombran ese archivo (para no registrar dos veces lo mismo).
  const parecidas = d.archivo ? queNombran(fichas(area), String(d.archivo).split(",").map((x) => x.trim().replace(/^[\w-]+:(?!\\)/, "").replace(/`/g, ""))) : [];
  let id = siguienteId(area, modulo);
  for (let i = 0; ; i++) {
    try {
      // `wx`: si otra sesión tomó ese número en el medio, se usa el siguiente en vez de pisarla.
      writeFileSync(rutaFicha(area, id), `${fichaDesde(readFileSync(fp, "utf8"), { id, titulo: d.titulo, campos })}\n`, { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST" || i > 20) throw e;
      id = id.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(3, "0"));
    }
  }
  for (const m of MOMENTOS) mkdirSync(join(area.dir, "capturas", id, m), { recursive: true });
  return { id, ficha: rutaFicha(area, id), evidencia: join(area.dir, "capturas", id), registro: ponerRegistroAlDia(area, true, id), parecidas };
}

// ───────────────────────── evidencia ─────────────────────────

/** Estado del repo del área al tomar la evidencia: sin esto no se sabe si el «antes» era de verdad el antes. */
export function marcaRepo(cfg, area) {
  const r = reposGit(cfg).find((x) => x.nombre === area.repo);
  if (!r) return { commit: null, sinCommit: null };
  const dir = cfg.abs(r.ruta);
  return { commit: git(dir, ["rev-parse", "--short", "HEAD"]), rama: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), sinCommit: (git(dir, ["status", "--porcelain", "--untracked-files=no"]) ?? "").split("\n").filter(Boolean).length };
}

const metaDe = (carpeta) => {
  try {
    return JSON.parse(readFileSync(join(carpeta, "evidencia.json"), "utf8"));
  } catch {
    return null;
  }
};

/** Carpeta de un momento, lista para escribir. El «antes» no se sobrescribe y el «después» exige un «antes». */
export function prepararEvidencia(cfg, id, momento, { reemplazar = false } = {}) {
  if (!MOMENTOS.includes(momento)) throw new Error("--momento: antes o despues");
  const area = areaDeId(cfg, id);
  if (!existsSync(rutaFicha(area, id))) throw new Error(`no existe la ficha ${id}`);
  const raiz = join(area.dir, "capturas", id);
  const dir = join(raiz, momento);
  const llena = (d) => existsSync(d) && readdirSync(d).some((f) => f !== "evidencia.json");
  if (momento === "antes" && llena(dir) && !reemplazar) throw new Error(`${id} ya tiene su «antes»: no se sobrescribe (--reemplazar si fue un error)`);
  if (momento === "despues" && !llena(join(raiz, "antes"))) throw new Error(`${id} no tiene «antes»: tómalo primero con la versión sin corregir (sin eso no hay con qué comparar)`);
  mkdirSync(dir, { recursive: true });
  return { area, dir, antes: metaDe(join(raiz, "antes")) };
}

export function guardarMeta(cfg, area, dir, datos) {
  const meta = { fecha: new Date().toISOString(), ...marcaRepo(cfg, area), ...datos };
  writeFileSync(join(dir, "evidencia.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

/** Avisos al comparar el después con su antes. */
export function avisosEvidencia(meta, antes) {
  const av = [];
  if (meta.momento === "antes" && meta.sinCommit) av.push(`el repo tenía ${meta.sinCommit} archivos modificados: confirma que la corrección no estaba aplicada`);
  if (antes && meta.momento === "despues") {
    if (antes.commit && antes.commit === meta.commit && !meta.sinCommit) av.push("mismo commit y sin cambios: el después es la misma versión que el antes");
    for (const k of ["ruta", "persona", "metodo"]) if ((antes[k] ?? null) !== (meta[k] ?? null)) av.push(`${k} distinto del antes (${antes[k] ?? "—"} → ${meta[k] ?? "—"})`);
  }
  return av;
}

const SENSIBLE = /pass|clave|contrase|token|secret|authorization|cookie|api[-_]?key|mail|correo|telefono|phone|cedula|dni|birth|nacimiento|direccion|address/i;
/** Quita lo sensible de una respuesta antes de guardarla: la evidencia va a git. */
export function ocultar(v, clave = "") {
  if (Array.isArray(v)) return v.map((x) => ocultar(x, clave));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ocultar(x, k)]));
  if (v !== null && v !== undefined && SENSIBLE.test(clave)) return "[oculto]";
  return typeof v === "string" ? v.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[oculto]").replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[oculto]") : v;
}

async function evidencia(cfg, d) {
  const p = prepararEvidencia(cfg, d.id, d.momento, { reemplazar: d.reemplazar });
  const { peticion } = await import("./fantasmas.mjs");
  const metodo = (d.metodo ?? "GET").toUpperCase();
  const t0 = Date.now();
  const r = await peticion(cfg, { usuario: d.usuario, metodo, ruta: d.ruta, cuerpo: d.cuerpo, max: 200_000 });
  const leer = (t) => {
    try {
      return ocultar(JSON.parse(t));
    } catch {
      return typeof t === "string" ? ocultar(t.slice(0, 5000)) : t ?? null;
    }
  };
  const meta = guardarMeta(cfg, p.area, p.dir, { momento: d.momento, metodo, ruta: d.ruta, persona: d.usuario ?? null, status: r.status, ms: Date.now() - t0 });
  const f = join(p.dir, `${d.id}-${d.momento}.json`);
  writeFileSync(f, `${JSON.stringify({ peticion: { metodo, ruta: d.ruta, usuario: d.usuario ?? null, cuerpo: leer(d.cuerpo) }, respuesta: { status: r.status, ms: meta.ms, cuerpo: leer(r.cuerpo) } }, null, 2)}\n`);
  return { archivo: f, status: r.status, ms: meta.ms, ...(p.antes ? { statusAntes: p.antes.status } : {}), avisos: avisosEvidencia(meta, p.antes) };
}

// ───────────────────────── estado y cambios ─────────────────────────

/** Evidencia que falta en el después, respecto de lo que se tomó antes. */
export function faltaDespues(area, id) {
  const lista = (m) => {
    const d = join(area.dir, "capturas", id, m);
    return existsSync(d) ? readdirSync(d).filter((f) => f !== "evidencia.json") : [];
  };
  const antes = lista("antes");
  const despues = new Set(lista("despues"));
  if (!antes.length) return ["no hay evidencia de antes"];
  return antes.map((f) => f.replace(/antes/g, "despues")).filter((f) => !despues.has(f));
}

export function cambiar(cfg, { id, estado, nota, reabrir = false }) {
  const area = areaDeId(cfg, id);
  const f = rutaFicha(area, id);
  if (!existsSync(f)) throw new Error(`no existe la ficha ${id}`);
  if (!ESTADOS.some((e) => estado === e || String(estado ?? "").startsWith(`${e} · `))) throw new Error(`estado desconocido: ${estado} (${ESTADOS.join(", ")}; «Abierta · <motivo>» también vale)`);
  const texto = readFileSync(f, "utf8");
  const de = campo(texto, "Estado");
  if (de === null) throw new Error(`${id} no tiene la fila «Estado»`);
  if (esReservado(de) && !esReservado(estado) && !reabrir) throw new Error(`${id} está «${de}»: la decidió el responsable. Si pide reabrirla, agrega --reabrir (se le pregunta)`);
  if (/^corregida/i.test(estado)) {
    const falta = faltaDespues(area, id);
    if (falta.length) throw new Error(`${id} no puede pasar a «${estado}»: falta evidencia del después (${falta.join(", ")})`);
  }
  if (/^(descartada|resuelta)/i.test(estado) && !nota) throw new Error(`«${estado}» necesita --nota con el motivo o el commit`);
  const hoy = new Date().toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" });
  let t = conCampo(texto, "Estado", esReservado(estado) ? `${estado} (${hoy})` : estado);
  if (nota) t = `${t.replace(/\s*$/, "")}${eol(t)}- ${hoy} · ${estado}: ${escaparCelda(nota)}${eol(t)}`;
  escribirAtomico(f, t);
  const reg = join(area.dir, "REGISTRO.md");
  let registro = null;
  if (existsSync(reg)) {
    const r = sincronizar(readFileSync(reg, "utf8"), fichas(area).filter((x) => x.id === id), { reabrir });
    if (r.cambios.length || r.nuevas.length) escribirAtomico(reg, r.texto);
    registro = { cambios: r.cambios, nuevas: r.nuevas, conflictos: r.conflictos };
  }
  return { id, de, a: campo(t, "Estado"), registro };
}

/** ¿El evento pone un estado reservado? "deny" = escribirlo a mano; "ask" = por la CLI (lo decide el usuario). */
export function estadoReservadoEn(cfg, event) {
  if (cfg.incidencias?.activo === false) return null;
  const ti = event?.tool_input ?? {};
  const carpeta = String(cfg.incidencias?.carpeta ?? "incidencias").replace(/\\/g, "/").replace(/\/$/, "");
  const alt = RESERVADOS.join("|");
  if (["Edit", "Write", "MultiEdit"].includes(event?.tool_name)) {
    const f = String(ti.file_path ?? "").replace(/\\/g, "/").toLowerCase();
    const raiz = `${cfg.abs(carpeta).replace(/\\/g, "/").toLowerCase()}/`;
    if (!f.startsWith(raiz) && !f.startsWith(`${carpeta.toLowerCase()}/`)) return null;
    if (!/(\/registradas\/[^/]+\.md|\/registro\.md)$/.test(f)) return null;
    // Se cuentan las celdas con estado reservado: solo importa que aparezca una que no estaba.
    const cuenta = (t) => (String(t ?? "").match(new RegExp(`\\|\\s*[*_]*(?:${alt})(?![\\p{L}])[^|\\n]*\\|`, "giu")) ?? []).length;
    let antes = "";
    if (event.tool_name === "Write") {
      try {
        antes = readFileSync(ti.file_path, "utf8");
      } catch {
        antes = "";
      }
    }
    // Un Edit puede cambiar solo la palabra («Abierta» → «Verificada»), sin las barras de la celda.
    const suelta = (a, b) => new RegExp(`^\\W*(?:${alt})(?![\\p{L}])`, "iu").test(String(b ?? "").trim()) && !new RegExp(`(?:${alt})`, "iu").test(String(a ?? ""));
    const pares = event.tool_name === "Write" ? [[antes, ti.content]] : event.tool_name === "Edit" ? [[ti.old_string, ti.new_string]] : (ti.edits ?? []).map((e) => [e?.old_string, e?.new_string]);
    return pares.some(([a, b]) => cuenta(b) > cuenta(a) || (event.tool_name !== "Write" && suelta(a, b))) ? "deny" : null;
  }
  if (event?.tool_name === "Bash" || event?.tool_name === "PowerShell") {
    const cmd = String(ti.command ?? "");
    if (/incidencias[.]mjs["']?[ ]+cambiar[ ]/.test(cmd) && /--reabrir/.test(cmd)) return "ask";
    if (!new RegExp(`(?:${alt})`, "i").test(cmd)) return null;
    if (/incidencias\.mjs["']?\s+cambiar\b/.test(cmd) && new RegExp(`--estado[=\\s]+["']?(?:${alt})`, "i").test(cmd)) return "ask";
    // Reemplazar el estado en las fichas con la terminal (sed, redirección, Set-Content…).
    const toca = cmd.replace(/\\/g, "/").toLowerCase();
    if (/(registradas\/|registro\.md)/.test(toca) && /\bsed\b[^|;&]*\s-\w*i|\bperl\b[^|;&]*\s-\w*i|\btee\b|(?:^|[^\d&>])>{1,2}\s*[^\s&|;]*(?:registradas\/|registro\.md)|set-content|add-content|out-file|writefile|write_text/i.test(toca)) return "deny";
  }
  return null;
}

export const MOTIVO_RESERVADO = `neurodanza: «${RESERVADOS.join("», «")}» solo los pone el responsable. Usa incidencias.mjs cambiar --id <ID> --estado … cuando el usuario lo pida (se le pregunta en la ventana de permisos); tú puedes llegar hasta «Corregida · por verificar».`;

// ───────────────────────── comandos del día ─────────────────────────

export function estado(cfg, { red = true, instalado = null } = {}) {
  const p = preferencias(cfg);
  const preguntas = [];
  const repos = reposGit(cfg).map((r) => {
    const dir = cfg.abs(r.ruta);
    const ramas = ramasRemotas(dir);
    const porDefecto = (git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) ?? "").replace("origin/", "");
    const guardada = p.ramas[r.nombre];
    const rama = guardada && existeRama(dir, guardada) ? guardada : null;
    const info = { repo: r.nombre, actual: git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), sinCommit: (git(dir, ["status", "--porcelain"]) ?? "").split("\n").filter(Boolean).length, desarrollo: rama };
    if (!rama) {
      const cs = candidatas(ramas, porDefecto);
      if (guardada) info.aviso = `origin/${guardada} ya no existe`;
      if (ramas.length) preguntas.push({ tema: "rama", repo: r.nombre, texto: `¿Cuál es la rama de desarrollo de ${r.nombre}?`, opciones: cs.length ? cs : ramas.slice(0, 8) });
      return info;
    }
    if (p.traer !== "nunca") {
      if (red && git(dir, ["fetch", "--quiet", "origin", rama], 45_000) === null) info.aviso = "no se pudo consultar el remoto";
      info.atras = Number(git(dir, ["rev-list", "--count", `HEAD..origin/${rama}`]) ?? 0);
      if (info.atras && p.traer === "preguntar" && info.actual === rama && !info.sinCommit) preguntas.push({ tema: "traer", repo: r.nombre, texto: `origin/${rama} tiene ${info.atras} commits nuevos. ¿Los traigo?`, opciones: ["sí", "no", "siempre", "nunca"] });
    }
    return info;
  });
  const g = estadoGraphify(cfg, instalado);
  const gUsable = g.hayCarpeta ? !!g.actualizar : g.instalado;
  if (gUsable && p.graphify === "preguntar") preguntas.push({ tema: "graphify", texto: g.actualizar ? `¿Actualizo el mapa de graphify (${g.actualizar})?` : "graphify está instalado y el proyecto no tiene mapa. ¿Quieres usarlo primero?", opciones: ["sí", "no", "siempre", "nunca"] });
  const carpeta = cfg.abs(cfg.incidencias.carpeta);
  const faltan = archivosBase(cfg).filter((x) => !existsSync(x.destino)).length;
  if (!existsSync(carpeta)) preguntas.push({ tema: "base", texto: `¿Creo ${cfg.incidencias.carpeta}/ con las plantillas?`, opciones: ["sí", "no"] });
  const areas = areasDe(cfg).map((a) => {
    const l = fichas(a);
    const porEstado = {};
    for (const f of l) {
      const e = f.estado.replace(/\s*\(.*$/, "") || "sin estado";
      porEstado[e] = (porEstado[e] ?? 0) + 1;
    }
    return { area: a.nombre, total: l.length, porEstado };
  });
  return { repos, graphify: { ...g, usar: gUsable && p.graphify !== "nunca" }, incidencias: { carpeta: cfg.incidencias.carpeta, existe: existsSync(carpeta), archivosQueFaltan: faltan, areas }, preguntas };
}

export function traer(cfg, nombre) {
  const r = repoPorNombre(cfg, nombre);
  const p = preferencias(cfg);
  const rama = p.ramas[nombre];
  if (!rama) throw new Error(`falta la rama de desarrollo de ${nombre} (incidencias.mjs guardar --rama ${nombre}=<rama>)`);
  if (p.traer === "nunca") return { repo: nombre, hecho: false, motivo: "el usuario eligió no traer nunca" };
  const dir = cfg.abs(r.ruta);
  if (git(dir, ["fetch", "--quiet", "origin", rama], 60_000) === null) return { repo: nombre, hecho: false, motivo: "no se pudo consultar el remoto" };
  const antes = git(dir, ["rev-parse", "HEAD"]);
  const actual = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const atras = Number(git(dir, ["rev-list", "--count", `HEAD..origin/${rama}`]) ?? 0);
  const base = { repo: nombre, rama, actual, atras };
  if (!atras) return { ...base, hecho: false, motivo: "ya está al día" };
  if (actual !== rama) return { ...base, hecho: false, motivo: `estás en ${actual}: no se mezcla ${rama} en tu rama` };
  if (git(dir, ["status", "--porcelain"])) return { ...base, hecho: false, motivo: "hay trabajo sin guardar: no se toca" };
  if (git(dir, ["merge", "--ff-only", "--quiet", `origin/${rama}`], 60_000) === null) return { ...base, hecho: false, motivo: "la rama local se separó de la remota: no hay avance rápido" };
  return { ...base, hecho: true, desde: antes, hasta: git(dir, ["rev-parse", "HEAD"]), revisar: revisar(cfg, nombre, antes) };
}

export function revisar(cfg, nombre, desde) {
  const dir = cfg.abs(repoPorNombre(cfg, nombre).ruta);
  if (!/^[\w./-]+$/.test(String(desde ?? "")) || String(desde).startsWith("-")) throw new Error("--desde: un commit o rama");
  const salida = git(dir, ["diff", "--name-only", desde, "HEAD"]);
  if (salida === null) throw new Error(`no pude comparar con ${desde}`);
  const archivos = salida.split(/\r?\n/).filter(Boolean);
  return areasDe(cfg).filter((a) => a.repo === nombre).flatMap((a) => queNombran(fichas(a), archivos));
}

function archivosBase(cfg) {
  const out = [];
  const raiz = cfg.abs(cfg.incidencias.carpeta);
  out.push({ origen: join(PLANTILLAS, "README.md"), destino: join(raiz, "README.md") });
  for (const a of areasDe(cfg)) {
    const de = existsSync(join(PLANTILLAS, a.nombre)) ? a.nombre : a.evidencia === "capturas" ? "frontend" : "backend";
    for (const f of ["METODOLOGIA.md", "PLANTILLA.md", "REGISTRO.md"]) out.push({ origen: join(PLANTILLAS, de, f), destino: join(a.dir, f), area: a });
  }
  return out;
}

/** Vistas (o rutas de la API) del índice que el inventario no nombra. */
export async function inventario(cfg, nombre, escribir = false) {
  const area = areaPorNombre(cfg, nombre);
  const { indiceDe, reposDe } = await import("./indice.mjs");
  const r = reposDe(cfg).find((x) => x.nombre === area.repo);
  if (!r) return { area: nombre, vistas: 0, nuevas: [], aviso: `no hay repo «${area.repo}» (incidencias.areas.${nombre}.repo)` };
  const ind = indiceDe(cfg, r);
  const todas = area.evidencia === "capturas" ? ind.pantallas.map((p) => p.ruta) : ind.rutasApi.map((x) => `${x.metodo} ${x.ruta}`);
  const vistas = [...new Set(todas)].sort((a, b) => a.localeCompare(b));
  const f = join(area.dir, "INVENTARIO.md");
  if (existsSync(f)) {
    // Se compara por la ruta entera o por su cola (los inventarios suelen agrupar bajo un prefijo del módulo).
    const citadas = new Set([...readFileSync(f, "utf8").matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/^…\//, "").replace(/^\//, "")));
    const nuevas = vistas.filter((v) => ![...citadas].some((c) => v.replace(/^\//, "") === c || (c && v.endsWith(`/${c}`))));
    return { area: nombre, vistas: vistas.length, nuevas, existe: true };
  }
  if (escribir) {
    const grupos = new Map();
    for (const v of vistas) {
      const g = v.replace(/^[A-Z]+ /, "").split("/").filter((s) => s && !/^[[:]/.test(s) && !/^(api|v\d+)$/.test(s))[0] ?? "inicio";
      grupos.set(g, [...(grupos.get(g) ?? []), v]);
    }
    const que = area.evidencia === "capturas" ? "Vista" : "Ruta";
    const L = [`# Inventario · ${nombre}`, "", `Sale del código (${vistas.length}). Al revisar, marca cada una: ☐ pendiente · ◐ en revisión · ☑ revisada.`, ""];
    for (const [g, vs] of grupos) L.push(`## ${g} (${vs.length})`, "", `| ${que} | Rol | Estado |`, "|---|---|---|", ...vs.map((v) => `| \`${v}\` | | ☐ |`), "");
    mkdirSync(area.dir, { recursive: true });
    writeFileSync(f, L.join("\n"), { flag: "wx" });
  }
  return { area: nombre, vistas: vistas.length, nuevas: vistas, existe: escribir };
}

export async function crearBase(cfg) {
  const creados = [];
  const respetados = [];
  for (const x of archivosBase(cfg)) {
    if (existsSync(x.destino)) {
      respetados.push(x.destino);
      continue;
    }
    mkdirSync(dirname(x.destino), { recursive: true });
    writeFileSync(x.destino, readFileSync(x.origen, "utf8").replace(/\{prefijo\}/g, x.area?.prefijo ?? ""), { flag: "wx" });
    creados.push(x.destino);
  }
  for (const a of areasDe(cfg)) {
    mkdirSync(join(a.dir, "registradas"), { recursive: true });
    mkdirSync(join(a.dir, "capturas"), { recursive: true });
    if (!existsSync(join(a.dir, "INVENTARIO.md")) && (await inventario(cfg, a.nombre, true)).existe) creados.push(join(a.dir, "INVENTARIO.md"));
  }
  return { creados, respetados };
}

/** Cómo son los commits de un repo (puro): convencionales o no, largo y alcances frecuentes. */
export function estiloCommits(asuntos) {
  const xs = asuntos.filter((a) => a && !/^Merge /.test(a));
  const re = /^(\w+)(?:\(([^)]+)\))?!?:\s/;
  const conv = xs.filter((a) => re.test(a));
  const contar = (l) => Object.entries(l.filter(Boolean).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const largos = xs.map((a) => a.length).sort((a, b) => a - b);
  return { muestra: xs.length, convencionales: xs.length ? Math.round((conv.length / xs.length) * 100) : 0, tipos: contar(conv.map((a) => a.match(re)[1])).slice(0, 6), alcances: contar(conv.map((a) => a.match(re)[2])).slice(0, 6), largoTipico: largos[Math.floor(largos.length / 2)] ?? 0, ejemplos: xs.slice(0, 5) };
}

export function reglas(cfg, nombre) {
  const dir = cfg.abs(repoPorNombre(cfg, nombre).ruta);
  const archivos = readdirSync(dir).filter((f) => /^(commitlint\.config\.|\.commitlintrc|\.czrc|\.gitmessage|CONTRIBUTING|AGENTS\.md|CLAUDE\.md)/i.test(f));
  for (const f of [".husky/commit-msg", ".github/CONTRIBUTING.md", ".github/pull_request_template.md"]) if (existsSync(join(dir, f))) archivos.push(f);
  return { repo: nombre, leer: archivos, ...estiloCommits((git(dir, ["log", "-40", "--format=%s"]) ?? "").split(/\r?\n/)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    if (i > 0) return process.argv[i + 1];
    return process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
  };
  const hay = (n) => process.argv.includes(`--${n}`);
  const cmd = process.argv[2];
  try {
    const cfg = loadConfig(process.cwd());
    if (!cfg) throw new Error("No hay neurodanza.config.json en esta carpeta ni en las de arriba.");
    if (cfg.incidencias.activo === false) throw new Error("incidencias.activo es false en la configuración");
    let r;
    if (cmd === "estado") r = estado(cfg, { red: !hay("sin-red") });
    else if (cmd === "guardar") r = guardarPreferencia(cfg, { rama: arg("rama"), traer: arg("traer"), graphify: arg("graphify") });
    else if (cmd === "base") r = await crearBase(cfg);
    else if (cmd === "inventario") r = await inventario(cfg, arg("area") ?? "frontend", hay("escribir"));
    else if (cmd === "traer") r = traer(cfg, arg("repo"));
    else if (cmd === "alcance") r = await alcance(cfg, String(arg("archivos") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    else if (cmd === "nueva") r = await nueva(cfg, Object.fromEntries(["area", "modulo", "titulo", "rol", "vista", "perspectiva", "categoria", "severidad", "alcance", "esfuerzo", "prioridad", "raiz", "archivo", "quien", "estado"].map((k) => [k, arg(k)])));
    else if (cmd === "evidencia") r = await evidencia(cfg, { id: arg("id"), momento: arg("momento"), ruta: arg("ruta"), metodo: arg("metodo"), usuario: arg("usuario"), cuerpo: arg("cuerpo"), reemplazar: hay("reemplazar") });
    else if (cmd === "cambiar") r = cambiar(cfg, { id: arg("id"), estado: arg("estado"), nota: arg("nota"), reabrir: hay("reabrir") });
    else if (cmd === "registro") r = areasDe(cfg).filter((a) => !arg("area") || a.nombre === arg("area")).map((a) => ({ area: a.nombre, ...(ponerRegistroAlDia(a, hay("escribir")) ?? { aviso: "sin REGISTRO.md" }) }));
    else if (cmd === "revisar") r = revisar(cfg, arg("repo"), arg("desde"));
    else if (cmd === "reglas") r = reglas(cfg, arg("repo"));
    else throw new Error("comandos: estado | guardar | base | inventario | traer | alcance | nueva | evidencia | cambiar | registro | revisar | reglas");
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(`incidencias: ${e.message}`);
    process.exitCode = 2;
  }
}
