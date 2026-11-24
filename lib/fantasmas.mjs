#!/usr/bin/env node
// neurodanza · fantasmas: ataques acotados contra la app LOCAL, en modo propuesta.
// Si el cambio toca endpoints, permisos, roles, consultas o pantallas con acciones de escritura, se generan
// hipótesis concretas (rol atacante, recurso, técnica) y un fantasma prueba cada una con los usuarios de
// prueba de las personas. Nunca edita un repo: deja el resultado y una prueba de regresión propuesta en
// `.neurodanza/fantasmas/<ciclo>/<id>.json`. Solo hosts de la app (`fantasmas.hosts` + `app.urls`).
// Ver docs/17-seguridad.md.
//
//   node fantasmas.mjs aplica [--base main]                 ¿hay que lanzar fantasmas para este cambio? (JSON)
//   node fantasmas.mjs hipotesis [--base main]              hasta fantasmas.max hipótesis (JSON; se guardan en el ciclo)
//   node fantasmas.mjs request --usuario <persona> --metodo GET --ruta /api/x [--cuerpo '<json>']
//   node fantasmas.mjs resultado --json '<resultado>'      guarda el resultado de una hipótesis (valida el formato)
//   node fantasmas.mjs veredicto                            confirmados del ciclo (exit 1 si hay alguno alto)
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changesInBranch } from "./cambios.mjs";
import { loadConfig, matchesAny } from "./config.mjs";
import { hostsApp } from "./figuras.mjs";
import { leerFusible } from "./fusible.mjs";
import { escribirAtomico } from "./procesos.mjs";

const ENDPOINT = /(controller|route|router|resolver|handler|endpoint|(^|\/)api\/|\.routes?\.)/i;
const PERMISOS = /(guard|polic|permis|role|(^|\/)rol(es)?\b|auth|acl|casl|middleware)/i;
const CONSULTA = /(repositor|prisma|query|sql|knex|typeorm|sequelize|drizzle|entity|model|dao|schema\.prisma)/i;
const ESCRITURA = /(<form|onSubmit|useMutation|mutation|method:\s*["'](POST|PUT|PATCH|DELETE)|\.(post|put|patch|delete)\(|<button|eliminar|guardar|delete|save)/i;

/** ¿Hay que lanzar fantasmas? (puro sobre los cambios; `leer` devuelve el contenido de un archivo cambiado). */
export function fantasmasPara(cfg, changes, leer = () => "") {
  if (cfg.fantasmas?.activo === false) return { lanzar: false, motivos: ["fantasmas.activo es false"] };
  const motivos = [];
  const files = Object.entries(changes).flatMap(([repo, fs]) => fs.map((f) => ({ repo, f })));
  const hit = (re) => files.filter(({ f }) => re.test(f));
  if (hit(ENDPOINT).length) motivos.push(`endpoints: ${hit(ENDPOINT).slice(0, 2).map((x) => x.f).join(", ")}`);
  if (hit(PERMISOS).length) motivos.push(`permisos o roles: ${hit(PERMISOS).slice(0, 2).map((x) => x.f).join(", ")}`);
  if (hit(CONSULTA).length) motivos.push(`consultas a la base: ${hit(CONSULTA).slice(0, 2).map((x) => x.f).join(", ")}`);
  const pantallas = files.filter(({ repo, f }) =>
    (cfg.retroalimentacion?.pantallas ?? []).some((spec) => {
      const [r, g] = spec.includes(":") ? spec.split(/:(.+)/) : [null, spec];
      return (!r || r === repo) && matchesAny(f, [g]);
    }),
  );
  const conEscritura = pantallas.filter((x) => ESCRITURA.test(leer(x.repo, x.f)));
  if (conEscritura.length) motivos.push(`pantallas con acciones de escritura: ${conEscritura.slice(0, 2).map((x) => x.f).join(", ")}`);
  return { lanzar: motivos.length > 0, motivos };
}

/** Rutas de API que aparecen en las líneas agregadas del diff (Nest, Express, Next). */
export function rutasDelDiff(diff) {
  const out = [];
  const add = (metodo, ruta, archivo) => {
    if (!out.some((r) => r.metodo === metodo && r.ruta === ruta)) out.push({ metodo, ruta, archivo });
  };
  let archivo = "";
  let prefijo = "";
  for (const l of String(diff).split(/\r?\n/)) {
    const f = l.match(/^\+\+\+ b\/(.+)$/);
    if (f) {
      archivo = f[1];
      prefijo = "";
      const next = archivo.match(/app\/api\/(.+)\/route\.[jt]sx?$/);
      if (next) prefijo = `/api/${next[1].replace(/\[(\w+)\]/g, ":$1")}`;
      continue;
    }
    // El prefijo del controlador puede estar en una línea de contexto (sin cambios): se lee igual.
    const ctl = !l.startsWith("-") && l.match(/@Controller\(\s*['"]([^'"]*)['"]/);
    if (ctl) prefijo = `/${ctl[1].replace(/^\//, "")}`;
    if (!l.startsWith("+")) continue;
    const nest = l.match(/@(Get|Post|Put|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?/);
    if (nest) add(nest[1].toUpperCase(), `${prefijo}${nest[2] ? `/${nest[2].replace(/^\//, "")}` : ""}` || "/", archivo);
    const exp = l.match(/\b(?:router|app)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/i);
    if (exp) add(exp[1].toUpperCase(), exp[2], archivo);
    const nx = l.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
    if (nx && prefijo) add(nx[1], prefijo, archivo);
  }
  return out;
}

const tieneId = (ruta) => /(:\w*id\b|\[\w*id\]|\{\w*id\}|:\w+$)/i.test(ruta);

/**
 * Hipótesis concretas (puro): rol atacante, recurso y técnica. `roles` = [{ rol, soloLectura }].
 * Orden: acceso a recurso ajeno, escalada de rol, fuga entre clientes, acción oculta, entrada no validada.
 */
export function hipotesisDeDiff(diff, roles = [], max = 3) {
  const rutas = rutasDelDiff(diff);
  const lectura = roles.find((r) => r.soloLectura)?.rol ?? roles[roles.length - 1]?.rol ?? "rol de menor permiso";
  const otro = roles[0]?.rol ?? "otro usuario";
  const agregadas = String(diff).split(/\r?\n/).filter((l) => l.startsWith("+")).join("\n");
  const out = [];
  const nueva = (h) => out.length < max && out.push({ id: `h${out.length + 1}`, ...h });
  for (const r of rutas.filter((x) => tieneId(x.ruta))) nueva({ tecnica: "recurso-ajeno", rolAtacante: otro, recurso: { metodo: r.metodo, ruta: r.ruta }, como: `pedir ${r.metodo} ${r.ruta} con el id de un recurso que creó otro usuario o cliente`, esperado: "403 o 404, nunca los datos ajenos" });
  for (const r of rutas.filter((x) => x.metodo !== "GET")) nueva({ tecnica: "escalada-de-rol", rolAtacante: lectura, recurso: { metodo: r.metodo, ruta: r.ruta }, como: `llamar ${r.metodo} ${r.ruta} con un usuario de ${lectura} (solo lectura)`, esperado: "403" });
  if (/(tenant|empresa|company|cliente|organization|org)Id/i.test(agregadas) || /(findMany|where|filter|list|listar|buscar)/i.test(agregadas))
    for (const r of rutas.filter((x) => x.metodo === "GET" && !tieneId(x.ruta)).slice(0, 1)) nueva({ tecnica: "fuga-entre-clientes", rolAtacante: otro, recurso: { metodo: r.metodo, ruta: r.ruta }, como: `listar ${r.ruta} (y con filtros) como usuario de otro cliente o empresa: ¿aparecen registros ajenos?`, esperado: "solo registros de su propio cliente" });
  if (/(disabled=|hidden|v-if|v-show|\{\s*can[A-Z(]|puede[A-Z(]|hasPermission|ocult)/.test(agregadas))
    for (const r of rutas.filter((x) => x.metodo !== "GET").slice(0, 1)) nueva({ tecnica: "accion-oculta", rolAtacante: lectura, recurso: { metodo: r.metodo, ruta: r.ruta }, como: `la pantalla oculta o deshabilita la acción para ${lectura}: llamar ${r.metodo} ${r.ruta} directo a la API`, esperado: "403 aunque la pantalla no muestre el botón" });
  if (/(class\s+\w+Dto|\w+Dto\b|@Body\(|@Is\w+\(|z\.\w+\(|@Column|body\.\w+|req\.body)/.test(agregadas))
    for (const r of rutas.filter((x) => x.metodo !== "GET").slice(0, 1)) nueva({ tecnica: "entrada-no-validada", rolAtacante: otro, recurso: { metodo: r.metodo, ruta: r.ruta }, como: `mandar a ${r.metodo} ${r.ruta} campos nuevos vacíos, demasiado largos o de otro tipo (sin cargas destructivas)`, esperado: "400 con un mensaje claro" });
  return out;
}

/** Roles del proyecto con su marca de solo lectura (adaptador json, o por nombre). */
function rolesDe(cfg) {
  let data = {};
  try {
    if (cfg.roles?.adaptador === "json" && cfg.roles.fuente) data = JSON.parse(readFileSync(cfg.abs(cfg.roles.fuente), "utf8"));
  } catch {
    data = {};
  }
  let personas = [];
  try {
    personas = JSON.parse(readFileSync(cfg.abs(cfg.panel.elenco), "utf8")).personas ?? [];
  } catch {
    personas = [];
  }
  const nombres = [...new Set([...Object.keys(data), ...personas.map((p) => p.rol)].filter(Boolean))];
  return nombres.map((rol) => ({ rol, soloLectura: data[rol] ? Object.values(data[rol]).every((w) => !w) : /viewer|lector|consulta|readonly|read|auditor/i.test(rol) }));
}

/** Diff de la rama (commits contra la base + lo que no está en commit), de todos los repos. */
function diffRama(cfg, base) {
  let out = "";
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta);
    if (!existsSync(join(dir, ".git"))) continue;
    for (const cmd of [`git diff ${base}...HEAD`, "git diff HEAD"]) {
      try {
        out += execSync(cmd, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20, timeout: 20_000 });
      } catch {
        /* sin base: sigue */
      }
    }
  }
  return out;
}

const cicloActual = (cfg) => String(leerFusible(cfg).ciclo || "actual").replace(/[^\w.-]/g, "_").slice(0, 60);
export const carpetaCiclo = (cfg) => cfg.abs(`.neurodanza/fantasmas/${cicloActual(cfg)}`);

/** Valida y completa un resultado de fantasma. Lanza si falta algo esencial. */
export function validarResultado(r) {
  const faltan = ["id", "hipotesis", "confirmado"].filter((k) => r?.[k] === undefined);
  if (faltan.length) throw new Error(`al resultado le falta: ${faltan.join(", ")}`);
  if (r.confirmado && !["alta", "media", "baja"].includes(r.gravedad)) throw new Error("un hallazgo confirmado necesita gravedad alta, media o baja");
  if (r.confirmado && !r.request?.metodo) throw new Error("un hallazgo confirmado necesita la request exacta (metodo, ruta, usuario, cuerpo)");
  return { esperado: "", obtenido: "", prueba: { propuesta: "" }, ...r, id: String(r.id).replace(/[^\w.-]/g, "_") };
}

/** Confirmados del ciclo, de mayor a menor gravedad. */
export function confirmados(cfg) {
  const dir = carpetaCiclo(cfg);
  if (!existsSync(dir)) return [];
  const orden = { alta: 0, media: 1, baja: 2 };
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json") && n !== "hipotesis.json")
    .map((n) => {
      try {
        return JSON.parse(readFileSync(join(dir, n), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((r) => r?.confirmado)
    .sort((a, b) => orden[a.gravedad] - orden[b.gravedad]);
}

/** Definición del login de una persona (fantasmas.login, o el de panel.usuarios con sus credenciales). */
export function loginDef(cfg) {
  if (cfg.fantasmas?.login) return cfg.fantasmas.login;
  const l = cfg.panel?.usuarios?.login;
  if (!l) return null;
  const cuerpo = {};
  for (const [k, v] of Object.entries(l.cuerpo ?? {})) cuerpo[k] = /mail|user|usuario|login/i.test(k) ? "{email}" : /pass|clave|contra/i.test(k) ? "{clave}" : v;
  return { ...l, cuerpo };
}

export const expandir = (v, vars) => (typeof v === "string" ? v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (m, k, d) => process.env[k] ?? d ?? "") : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandir(x, vars)])) : v);

/** Petición de un fantasma como una persona, SOLO a un host de la app. */
export async function peticion(cfg, { usuario, metodo = "GET", ruta, cuerpo, max = 2000 }) {
  const base = (cfg.app?.urls ?? [])[0];
  if (!base) throw new Error("no hay app.urls");
  const url = new URL(ruta, base);
  if (!hostsApp(cfg).includes(url.hostname.toLowerCase())) throw new Error(`host no permitido: ${url.hostname} (solo ${hostsApp(cfg).join(", ")})`);
  let token = null;
  if (usuario) {
    const elenco = JSON.parse(readFileSync(cfg.abs(cfg.panel.elenco), "utf8"));
    const p = elenco.personas.find((x) => x.id === usuario);
    if (!p) throw new Error(`persona desconocida: ${usuario}`);
    const u = cfg.panel.usuarios ?? {};
    const vars = { id: p.id, rol: p.rol, email: expandir(u.email ?? "", { id: p.id, rol: p.rol }), clave: expandir(u.clave ?? "", {}) };
    const l = loginDef(cfg);
    if (l) {
      const res = await fetch(new URL(expandir(l.url, vars), base), { method: l.metodo ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expandir(l.cuerpo, vars)), signal: AbortSignal.timeout(10_000) });
      const j = await res.json().catch(() => ({}));
      token = j?.[l.token ?? "accessToken"] ?? null;
      if (!token) throw new Error(`no pude entrar como ${usuario}: HTTP ${res.status}`);
    }
  }
  const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: cuerpo && metodo !== "GET" ? (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)) : undefined, signal: AbortSignal.timeout(15_000) });
  const texto = await res.text();
  return { request: { metodo, ruta, usuario: usuario ?? null, cuerpo: cuerpo ?? null }, status: res.status, cuerpo: texto.slice(0, max) };
}

// ───────────────────────── CLI ─────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const base = arg("base") ?? cfg.retroalimentacion.version?.ramaBase ?? "main";
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  try {
    const cmd = process.argv[2];
    if (cmd === "aplica") {
      const leer = (repo, f) => {
        try {
          return readFileSync(join(cfg.abs(cfg.repos.find((r) => r.nombre === repo).ruta), f), "utf8").slice(0, 200_000);
        } catch {
          return "";
        }
      };
      out(fantasmasPara(cfg, changesInBranch(cfg, base), leer));
    } else if (cmd === "hipotesis") {
      const hs = hipotesisDeDiff(diffRama(cfg, base), rolesDe(cfg), cfg.fantasmas?.max ?? 3);
      mkdirSync(carpetaCiclo(cfg), { recursive: true });
      escribirAtomico(join(carpetaCiclo(cfg), "hipotesis.json"), JSON.stringify(hs, null, 2));
      out({ ciclo: carpetaCiclo(cfg), hipotesis: hs });
    } else if (cmd === "request") {
      out(await peticion(cfg, { usuario: arg("usuario"), metodo: (arg("metodo") ?? "GET").toUpperCase(), ruta: arg("ruta") ?? "/", cuerpo: arg("cuerpo") }));
    } else if (cmd === "resultado") {
      const r = validarResultado(JSON.parse(arg("json") ?? "{}"));
      mkdirSync(carpetaCiclo(cfg), { recursive: true });
      escribirAtomico(join(carpetaCiclo(cfg), `${r.id}.json`), JSON.stringify(r, null, 2));
      console.log(`resultado guardado · ${r.id} · ${r.confirmado ? `confirmado (${r.gravedad})` : "no confirmado"}`);
    } else if (cmd === "veredicto") {
      const cs = confirmados(cfg);
      out({ confirmados: cs.map((c) => ({ id: c.id, gravedad: c.gravedad, hipotesis: c.hipotesis })) });
      if (cs.some((c) => c.gravedad === "alta")) process.exitCode = 1;
    } else {
      console.error("Uso: fantasmas.mjs aplica | hipotesis | request --usuario <p> --metodo M --ruta R [--cuerpo J] | resultado --json J | veredicto");
      process.exit(1);
    }
  } catch (e) {
    console.error(`fantasmas: ${e.message}`);
    process.exit(1);
  }
}
