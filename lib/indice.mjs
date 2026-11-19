#!/usr/bin/env node
// neurodanza · índice pre-cocido por commit: un mapa del repo hecho sin modelo (expresiones regulares y lectura
// de archivos, sin dependencias) para que implementadores, revisores, personas y especialistas no exploren desde
// cero. Se cachea por hash del commit + firma de los cambios sin commit en `.neurodanza/indice/<repo>-<firma>.json`.
// Ver docs/19-menos-exploracion.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node indice.mjs generar [--repo <r>]                       genera (o reutiliza) el índice de cada repo
//   node indice.mjs resumen --repo <r> [--foco <glob, ruta o texto>] [--max 60]   texto corto para un prompt
//   node indice.mjs buscar --que <texto> [--repo <r>]          rutas, exportaciones o pantallas que coinciden
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, extname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRegExp, loadConfig } from "./config.mjs";
import { fingerprint, parseStatus } from "./firma.mjs";
import { escribirAtomico } from "./procesos.mjs";

/** Carpetas que nunca entran en el índice. */
export const IGNORAR = new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt", ".git", ".turbo", ".cache", "coverage", ".neurodanza", ".vercel", ".output", "tmp", ".idea", ".vscode"]);
const CODIGO = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const MAX_BYTES = 400_000;

// ───────────────────────── análisis de un archivo (puro) ─────────────────────────

/** Exportaciones: funciones, clases, constantes, tipos, interfaces, enums y `export { a, b as c }`. */
export function exportacionesDe(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) for (const p of m[1].split(",")) {
    const n = p.trim().split(/\s+as\s+/).pop()?.trim();
    if (n && /^[\w$]+$/.test(n)) out.add(n);
  }
  if (/^\s*export\s+default\s+(?!function|class|async)/m.test(src)) out.add("default");
  return [...out];
}

/** Imports internos (relativos o con alias `@/` / `~/`), tal como aparecen. */
export function importsDe(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (/^(\.{1,2}\/|@\/|~\/)/.test(s)) out.add(s);
  }
  return [...out];
}

const unir = (...p) => ("/" + p.map((x) => String(x ?? "").replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")).replace(/\/+/g, "/");

/** Rutas de la API de NestJS (`@Controller` + `@Get/@Post/…`) y Express (`router.get('/x')`, `app.post(…)`). */
export function rutasApiDe(src) {
  const out = [];
  const ctrl = src.match(/@Controller\(\s*(?:['"`]([^'"`]*)['"`]|\{[^}]*path\s*:\s*['"`]([^'"`]*)['"`][^}]*\})?\s*\)/);
  if (ctrl) {
    const pref = ctrl[1] ?? ctrl[2] ?? "";
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete|All|Options|Head)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g)) out.push({ metodo: m[1].toUpperCase(), ruta: unir(pref, m[2] ?? ""), marco: "nest" });
  }
  for (const m of src.matchAll(/\b(?:router|app|r|api|rutas|routes)\.(get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`]*)['"`]/g)) out.push({ metodo: m[1].toUpperCase(), ruta: m[2], marco: "express" });
  return out;
}

/** Ruta de Next a partir de la ruta del archivo (`app/` y `pages/`), o null. */
export function rutaNext(rel) {
  const p = rel.replace(/\\/g, "/");
  let m = p.match(/(?:^|\/)app\/(.*?)(?:^|\/)?(page|route)\.(?:tsx?|jsx?|mdx?)$/);
  if (m) {
    const ruta = unir(...m[1].split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")));
    return { tipo: m[2] === "route" ? "api" : "pantalla", ruta };
  }
  m = p.match(/(?:^|\/)pages\/(.+)\.(?:tsx?|jsx?|mdx?)$/);
  if (m && !/(^|\/)_(app|document|error)$/.test(m[1])) {
    const ruta = unir(...m[1].replace(/(^|\/)index$/, "").split("/"));
    return { tipo: m[1].startsWith("api/") ? "api" : "pantalla", ruta };
  }
  return null;
}

/** Tipo de archivo por convención de nombre (ayuda a enfocar el resumen). */
export function tipoDe(rel) {
  const b = posix.basename(rel.replace(/\\/g, "/"));
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(b) || /(^|\/)(__tests__|e2e)\//.test(rel)) return "prueba";
  if (/(^|\/)migrations?\//.test(rel) || /migration\.sql$/.test(b)) return "migración";
  if (/\.controller\.[jt]s$/.test(b)) return "controlador";
  if (/\.service\.[jt]s$/.test(b)) return "servicio";
  if (/\.dto\.[jt]s$/.test(b) || /(^|\/)dto\//.test(rel)) return "dto";
  if (/\.entity\.[jt]s$/.test(b) || /\.prisma$/.test(b)) return "modelo";
  if (/\.module\.[jt]s$/.test(b)) return "módulo";
  if (/\.(guard|interceptor|pipe|middleware)\.[jt]s$/.test(b)) return "guardia";
  if (rutaNext(rel)?.tipo === "pantalla") return "pantalla";
  if (rutaNext(rel)?.tipo === "api" || /(routes?|router)\.[jt]s$/.test(b)) return "ruta-api";
  if (/\.(tsx|jsx)$/.test(b)) return "componente";
  return "código";
}

// ───────────────────────── recorrido del repo ─────────────────────────

function caminar(dir, rel = "", out = []) {
  let entradas;
  try {
    entradas = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entradas) {
    if (IGNORAR.has(e.name) || (e.name.startsWith(".") && e.name !== ".claude")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) caminar(dir, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Resuelve un import interno a un archivo del repo (sin extensión o con index). */
function resolverImport(desde, spec, archivos) {
  let base;
  if (spec.startsWith("@/") || spec.startsWith("~/")) base = spec.slice(2);
  else base = posix.normalize(posix.join(posix.dirname(desde), spec));
  const sinExt = base.replace(/\.(m|c)?[jt]sx?$/, "");
  for (const c of [base, ...[...CODIGO].map((x) => sinExt + x), ...[...CODIGO].map((x) => `${sinExt}/index${x}`)]) if (archivos.has(c)) return c;
  if (spec.startsWith("@/") || spec.startsWith("~/")) for (const pre of ["src/", "app/", ""]) for (const x of CODIGO) if (archivos.has(`${pre}${sinExt}${x}`)) return `${pre}${sinExt}${x}`;
  return null;
}

/** Índice de una carpeta (puro salvo lectura de archivos). */
export function indexar(dir, { nombre = "", firma = "" } = {}) {
  const lista = caminar(dir);
  const set = new Set(lista);
  const archivos = {};
  const rutasApi = [];
  const pantallas = [];
  const modelos = [];
  const migraciones = [];
  const carpetas = {};
  for (const rel of lista) {
    const ext = extname(rel);
    const carpeta = rel.includes("/") ? rel.split("/").slice(0, Math.min(3, rel.split("/").length - 1)).join("/") : ".";
    carpetas[carpeta] = (carpetas[carpeta] ?? 0) + 1;
    const tipo = tipoDe(rel);
    if (tipo === "migración") migraciones.push(rel);
    if (ext === ".prisma") {
      const src = readFileSync(join(dir, rel), "utf8");
      for (const m of src.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) modelos.push({ nombre: m[1], archivo: rel, orm: "prisma" });
      archivos[rel] = { tipo: "modelo", bytes: src.length, exporta: [], importa: [] };
      continue;
    }
    if (!CODIGO.has(ext)) continue;
    let bytes = 0;
    try {
      bytes = statSync(join(dir, rel)).size;
    } catch {
      continue;
    }
    const src = bytes <= MAX_BYTES ? readFileSync(join(dir, rel), "utf8") : "";
    const info = { tipo, bytes, exporta: exportacionesDe(src), importa: importsDe(src).map((s) => resolverImport(rel, s, set)).filter(Boolean) };
    archivos[rel] = info;
    for (const r of rutasApiDe(src)) rutasApi.push({ ...r, archivo: rel });
    const nx = rutaNext(rel);
    if (nx?.tipo === "pantalla") pantallas.push({ ruta: nx.ruta, archivo: rel });
    if (nx?.tipo === "api") for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) rutasApi.push({ metodo: m[1], ruta: nx.ruta, marco: "next", archivo: rel });
    if (/@Entity\(/.test(src)) for (const m of src.matchAll(/@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g)) modelos.push({ nombre: m[1], archivo: rel, orm: "typeorm" });
  }
  // Pruebas de cada módulo: por nombre (pedidos.service.spec.ts → pedidos.service.ts) o por lo que importan.
  const pruebas = {};
  const porBase = {};
  for (const rel of Object.keys(archivos)) if (archivos[rel].tipo !== "prueba") (porBase[posix.basename(rel).replace(/\.[^.]+$/, "")] ??= []).push(rel);
  for (const [rel, info] of Object.entries(archivos)) {
    if (info.tipo !== "prueba") continue;
    const base = posix.basename(rel).replace(/\.(test|spec)\.[^.]+$/, "");
    const destinos = new Set([...(porBase[base] ?? []), ...info.importa.filter((i) => archivos[i]?.tipo !== "prueba")]);
    for (const d of destinos) (pruebas[d] ??= []).push(rel);
  }
  return { repo: nombre, firma, fecha: new Date().toISOString(), total: lista.length, carpetas, archivos, rutasApi, pantallas, modelos, migraciones, pruebas };
}

// ───────────────────────── caché por firma ─────────────────────────

const sh = (cmd, cwd) => {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

/** Firma de un repo: commit + archivos cambiados sin commit (tamaño y fecha). Sin git: tamaño y fecha de todo. */
export function firmaRepo(dir) {
  const head = sh("git rev-parse HEAD", dir);
  if (head === null) {
    const partes = caminar(dir).map((f) => {
      try {
        const st = statSync(join(dir, f));
        return `${f}:${st.size}:${st.mtimeMs}`;
      } catch {
        return f;
      }
    });
    return fingerprint(["sin-git", ...partes]).slice(0, 16);
  }
  const cambiados = parseStatus(sh("git status --porcelain --untracked-files=all", dir) ?? "").filter((f) => !f.startsWith(".neurodanza/"));
  const stats = cambiados.map((f) => {
    try {
      const st = statSync(join(dir, f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${f}:-`;
    }
  });
  return fingerprint([head.trim(), ...stats]).slice(0, 16);
}

const carpetaIndice = (cfg) => cfg.abs(join(".neurodanza", "indice"));
const slug = (s) => String(s).replace(/[^\w.-]+/g, "-");

/** Índice de un repo de la configuración: lo reutiliza si la firma no cambió. */
export function indiceDe(cfg, repo) {
  const dir = cfg.abs(repo.ruta);
  const firma = firmaRepo(dir);
  const file = join(carpetaIndice(cfg), `${slug(repo.nombre)}-${firma}.json`);
  if (existsSync(file)) {
    try {
      return { ...JSON.parse(readFileSync(file, "utf8")), cache: true };
    } catch {
      /* se regenera */
    }
  }
  const ind = indexar(dir, { nombre: repo.nombre, firma });
  mkdirSync(dirname(file), { recursive: true });
  // Solo el último índice de cada repo (los viejos sobran).
  for (const f of readdirSync(dirname(file))) if (f.startsWith(`${slug(repo.nombre)}-`) && f !== posix.basename(file) && f.endsWith(".json")) rmSync(join(dirname(file), f), { force: true });
  escribirAtomico(file, JSON.stringify(ind));
  return { ...ind, cache: false };
}

/** Repos de la configuración; sin repos, la raíz del proyecto. */
export const reposDe = (cfg) => (cfg.repos.length ? cfg.repos : [{ nombre: "raiz", ruta: "." }]).filter((r) => existsSync(cfg.abs(r.ruta)));

// ───────────────────────── resumen y búsqueda (puros) ─────────────────────────

const esGlob = (s) => /[*?{]/.test(s);
/** ¿Un archivo, ruta o exportación coincide con el foco? Puntaje (0 = no). */
function puntaje(rel, info, foco, ind) {
  const f = foco.toLowerCase();
  if (esGlob(foco)) return globToRegExp(foco.replace(/^[\w-]+:/, "")).test(rel) ? 3 : 0;
  if (foco.startsWith("/")) {
    const enRuta = [...ind.rutasApi, ...ind.pantallas].some((r) => r.archivo === rel && (r.ruta === foco || r.ruta.startsWith(foco + "/") || r.ruta.startsWith(foco)));
    if (enRuta) return 3;
  }
  const palabra = f.replace(/^\//, "");
  if (rel.toLowerCase().includes(palabra)) return 2;
  if ((info.exporta ?? []).some((e) => e.toLowerCase().includes(palabra))) return 1;
  return 0;
}

/**
 * Texto corto para un prompt (≤ `max` líneas). Con foco, «los archivos de esta tarea probablemente son…»
 * (por ruta, nombre o exportación; con sus pruebas, rutas y pantallas). Sin foco, un mapa general.
 */
export function resumen(ind, { foco = "", max = 60 } = {}) {
  const L = [];
  const focos = String(foco).split(",").map((x) => x.trim()).filter(Boolean);
  const linea = (rel) => {
    const i = ind.archivos[rel] ?? {};
    const ex = (i.exporta ?? []).slice(0, 4).join(", ");
    return `- ${rel} (${i.tipo ?? "archivo"}${ex ? `; exporta ${ex}` : ""})`;
  };
  if (focos.length) {
    const cand = Object.entries(ind.archivos)
      .map(([rel, info]) => [rel, Math.max(...focos.map((f) => puntaje(rel, info, f, ind)))])
      .filter(([, p]) => p > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const fuentes = cand.filter(([rel]) => ind.archivos[rel].tipo !== "prueba").map(([rel]) => rel);
    L.push(`Índice de ${ind.repo} (${ind.total} archivos) · foco «${focos.join(", ")}»`);
    if (!cand.length) L.push("Nada coincide con el foco: usa `indice.mjs buscar --que <texto>`.");
    else {
      L.push("Los archivos de esta tarea probablemente son:");
      for (const rel of fuentes.slice(0, 20)) L.push(linea(rel));
      const pr = [...new Set(fuentes.flatMap((r) => ind.pruebas[r] ?? []))];
      if (pr.length) L.push("Sus pruebas:", ...pr.slice(0, 8).map((p) => `- ${p}`));
      const rutas = ind.rutasApi.filter((r) => fuentes.includes(r.archivo));
      if (rutas.length) L.push("Rutas de la API:", ...rutas.slice(0, 10).map((r) => `  ${r.metodo} ${r.ruta} → ${r.archivo}`));
      const pan = ind.pantallas.filter((p) => fuentes.includes(p.archivo));
      if (pan.length) L.push("Pantallas:", ...pan.slice(0, 10).map((p) => `  ${p.ruta} → ${p.archivo}`));
      const usan = Object.entries(ind.archivos).filter(([rel, i]) => !fuentes.includes(rel) && i.tipo !== "prueba" && i.importa.some((x) => fuentes.includes(x))).map(([rel]) => rel);
      if (usan.length) L.push(`También los importan (revisa si cambias una firma): ${usan.slice(0, 6).join(", ")}${usan.length > 6 ? ` y ${usan.length - 6} más` : ""}`);
    }
  } else {
    L.push(`Índice de ${ind.repo} (${ind.total} archivos)`);
    L.push("Carpetas:", ...Object.entries(ind.carpetas).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `  ${c} (${n})`));
    if (ind.rutasApi.length) L.push(`Rutas de la API (${ind.rutasApi.length}):`, ...ind.rutasApi.slice(0, 12).map((r) => `  ${r.metodo} ${r.ruta} → ${r.archivo}`));
    if (ind.pantallas.length) L.push(`Pantallas (${ind.pantallas.length}):`, ...ind.pantallas.slice(0, 12).map((p) => `  ${p.ruta} → ${p.archivo}`));
    if (ind.modelos.length) L.push(`Modelos: ${ind.modelos.slice(0, 15).map((m) => `${m.nombre} (${m.archivo})`).join(", ")}`);
    if (ind.migraciones.length) L.push(`Migraciones: ${ind.migraciones.length} (última: ${ind.migraciones.sort().at(-1)})`);
  }
  return L.slice(0, max).join("\n");
}

/** Rutas, exportaciones, pantallas y archivos que coinciden con un texto. */
export function buscar(ind, que) {
  const q = String(que ?? "").toLowerCase();
  if (!q) return [];
  const out = [];
  for (const r of ind.rutasApi) if (r.ruta.toLowerCase().includes(q)) out.push({ tipo: "ruta-api", texto: `${r.metodo} ${r.ruta}`, archivo: r.archivo });
  for (const p of ind.pantallas) if (p.ruta.toLowerCase().includes(q)) out.push({ tipo: "pantalla", texto: p.ruta, archivo: p.archivo });
  for (const m of ind.modelos) if (m.nombre.toLowerCase().includes(q)) out.push({ tipo: "modelo", texto: m.nombre, archivo: m.archivo });
  for (const [rel, i] of Object.entries(ind.archivos)) {
    for (const e of i.exporta) if (e.toLowerCase().includes(q)) out.push({ tipo: "exporta", texto: e, archivo: rel });
    if (rel.toLowerCase().includes(q) && !out.some((o) => o.archivo === rel)) out.push({ tipo: i.tipo, texto: rel, archivo: rel });
  }
  return out;
}

// ───────────────────────── CLI ─────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const cfg = loadConfig(process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json en esta carpeta ni en las de arriba.");
    process.exit(2);
  }
  if (cfg.indice?.activo === false) {
    console.log("(índice apagado: indice.activo es false)");
    process.exit(0);
  }
  const todos = reposDe(cfg);
  const elegidos = arg("repo") ? todos.filter((r) => r.nombre === arg("repo") || r.ruta === arg("repo")) : todos;
  if (arg("repo") && !elegidos.length) {
    console.error(`repo desconocido: ${arg("repo")} (repos: ${todos.map((r) => r.nombre).join(", ")})`);
    process.exit(2);
  }
  if (cmd === "generar") {
    for (const r of elegidos) {
      const t0 = Date.now();
      const ind = indiceDe(cfg, r);
      console.log(`${r.nombre}: ${ind.total} archivos · ${ind.rutasApi.length} rutas de API · ${ind.pantallas.length} pantallas · ${ind.cache ? "en caché" : "generado"} en ${Date.now() - t0} ms`);
    }
  } else if (cmd === "resumen") {
    console.log(elegidos.map((r) => resumen(indiceDe(cfg, r), { foco: arg("foco") ?? "", max: Number(arg("max") ?? cfg.indice?.maxLineas ?? 60) })).join("\n\n"));
  } else if (cmd === "buscar") {
    const res = elegidos.flatMap((r) => buscar(indiceDe(cfg, r), arg("que")).map((x) => ({ repo: r.nombre, ...x })));
    console.log(res.length ? res.slice(0, 40).map((x) => `${x.repo} · ${x.tipo} · ${x.texto} → ${x.archivo}`).join("\n") : "(nada coincide)");
  } else console.log("Uso: indice.mjs generar [--repo r] | resumen --repo <r> [--foco <glob, ruta o texto>] | buscar --que <texto> [--repo r]");
}
