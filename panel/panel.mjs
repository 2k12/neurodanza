#!/usr/bin/env node
// neurodanza · panel de personas. Personas simuladas (una por rol) prueban cada cambio con la app
// corriendo, conversan en una ventana en vivo (Windows) y lo califican de 1 a 10; el cambio se
// aprueba si el promedio supera `panel.umbral`. Todo sale de `neurodanza.config.json`.
// Ver docs/07-panel-personas.md.
//
// Uso (desde cualquier carpeta del proyecto; en Git Bash de Windows antepone MSYS_NO_PATHCONV=1):
//   node panel.mjs elegir --rutas /pedidos,/pedidos/[id]       personas para esas rutas (de min a max según roles)
//   node panel.mjs usuarios                                     crea los usuarios de prueba de las personas
//   node panel.mjs navegar --persona <id> --rutas <r1,r2> --salida <carpeta> [--acciones <json>] [--dispositivo tablet|celular]
//   node panel.mjs navegar --persona <id> --recorrido <archivo o id> --salida <carpeta> [--rutas …]   primero el recorrido acordado
//   node panel.mjs calificar --resultado <json>                 promedio y aprobación (reescribe el json)
//   node panel.mjs comparar --recorrido <id> [--ejecucion <recorrido.json>]   regresiones contra la última versión aprobada
//   node panel.mjs en-vivo --ronda <carpeta> --personas a,b,c --titulo "…" --cambio "…"
//   node panel.mjs decir --ronda <carpeta> --persona <id> --texto "…" [--estado "Probando"]   (estados: ESTADOS_RONDA)
//   node panel.mjs oir --ronda <carpeta>
//   node panel.mjs cerrar --ronda <carpeta> --resultado <json>
//   node panel.mjs ventana --resultado <json>                   resumen final (sin ronda en vivo)
//   node panel.mjs crear --rol <ROL> [--rolDoc x] [--cargo "…"]  persona nueva para un rol sin persona
//   node panel.mjs app                                          ¿la app responde? (si no, cuenta para el fusible; 3 = capa fundida)
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { falla as fallaFusible, fundida, fundidas, textoCapa } from "../lib/fusible.mjs";
import { compararEjecuciones, compararMemoria, ejecutarRecorrido, leerMemoria, leerRecorrido, notaConRegresiones, notaPorPasos, registrarMemoria, textoRegresion, validarRecorrido, verificarCongelado } from "../lib/recorridos.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ───────────────────────── funciones puras (probadas en tests/panel.test.mjs) ─────────────────────────

/** Rutas y si el rol puede modificarlas, desde una tabla Markdown `| Pantalla | \`ruta\` | ✅/❌/— |`. */
export function parseRoleMap(md) {
  const out = new Map();
  for (const m of md.matchAll(/^\|[^|]+\|\s*`([^`]+)`\s*\|\s*(✅|❌|—|si|sí|no)\s*\|/gim)) out.set(m[1], /✅|—|s[ií]/i.test(m[2]));
  return out;
}

const covers = (screen, route) => route === screen || route.startsWith(screen + "/");

/**
 * Elige las personas más afectadas por las rutas cambiadas. Puntaje por ruta: 2 si el rol puede
 * modificarla, 1 si solo la ve, dividido por la raíz de cuántas pantallas ve el rol. Cantidad: una
 * por rol que puede modificar algo de lo cambiado, entre `min` y `max` (o `n` si se indica).
 */
export function selectPersonas(rutas, personas, maps, { min = 3, max = 5, n, ignorar = [] } = {}) {
  const order = personas.map((p) => p.rol);
  const bestMatch = (map, r) => {
    let match = "";
    for (const screen of map.keys()) if (covers(screen, r) && screen.length > match.length && !ignorar.includes(screen)) match = screen;
    return match;
  };
  const scored = personas.map((p) => {
    const map = maps[p.rol] ?? new Map();
    let raw = 0;
    let writes = false;
    for (const r of rutas) {
      const match = bestMatch(map, r);
      if (!match) continue;
      raw += map.get(match) ? 2 : 1;
      writes ||= map.get(match);
    }
    return { p, raw, writes, score: raw / Math.sqrt(Math.max(map.size, 1)) };
  });
  const writers = new Set(scored.filter((s) => s.writes).map((s) => s.p.rol)).size;
  const count = n ?? Math.min(max, Math.max(min, writers));
  const byOrder = (a, b) => order.indexOf(a.p.rol) - order.indexOf(b.p.rol);
  return scored
    .filter((s) => s.raw > 0)
    .sort((a, b) => b.score - a.score || byOrder(a, b))
    .concat(scored.filter((s) => s.raw === 0).sort(byOrder))
    .slice(0, count)
    .map((s) => s.p);
}

/** Promedio y aprobación: aprueba si el promedio de todas las notas es mayor que el umbral. */
/** Estados de una persona mientras prueba (qué hace o qué encontró). */
export const ESTADOS_RONDA = ["Ingresando", "Probando", "Verificando", "Con observación", "Con error", "Bloqueado"];

/** Estados finales, atados a la escala de notas (de mayor a menor). */
export const ESTADOS_FINALES = [
  [10, "Sin observaciones"],
  [9, "Observaciones menores"],
  [7, "Funciona con dificultad"],
  [5, "Requiere ayuda"],
  [0, "No funciona"],
];

/** Estado final que corresponde a una nota (el estado nunca contradice la nota). */
export function estadoFinal(nota) {
  const n = Number(nota);
  if (!Number.isFinite(n)) return "";
  return ESTADOS_FINALES.find(([min]) => n >= min)[1];
}

/**
 * Veredicto de una ronda (puro). Además del promedio: si un revisor reprobó con hallazgo alto mientras el
 * panel corría (`data.revisores === "reprobados"`), la ronda no puede aprobar (se repite tras corregir); y
 * si faltan notas porque la app o el navegador están fundidos, la ronda queda PENDIENTE.
 */
export function veredictoRonda(data, umbral, capasFundidas = []) {
  const s = score(data.evaluaciones ?? [], umbral);
  const sinPanel = capasFundidas.filter((f) => f.capa === "app" || f.capa === "chromium");
  if (sinPanel.length && s.motivo === "faltan notas") return { ...s, aprobado: false, pendiente: true, motivo: `pendiente: no se pudo verificar ${sinPanel.map((f) => `${f.capa} (${f.motivo})`).join(", ")}` };
  if (data.revisores === "reprobados") return { ...s, aprobado: false, motivo: "un revisor reprobó con hallazgo alto durante la ronda: la ronda se repite tras la corrección" };
  return s;
}

export function score(evaluaciones, umbral) {
  const notas = evaluaciones.map((e) => Number(e.nota)).filter((x) => Number.isFinite(x));
  if (notas.length === 0 || notas.length !== evaluaciones.length) return { promedio: 0, aprobado: false, motivo: "faltan notas" };
  const promedio = Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 100) / 100;
  return { promedio, aprobado: promedio > umbral, motivo: promedio > umbral ? "aprobado" : `promedio ${promedio} ≤ ${umbral}` };
}

/** `${VAR:-por defecto}` con variables de entorno y `{clave}` con valores dados. */
export function expand(value, vars = {}, env = process.env) {
  if (typeof value === "string") {
    return value
      .replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, k, d) => env[k] ?? d ?? "")
      .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => expand(v, vars, env));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, vars, env)]));
  return value;
}

/** Persona nueva para un rol: toma la foto menos usada y le agrega un número (Ana2, Ana3…). */
export function addPersona(cast, rol, { rolDoc, cargo, fotos = [] } = {}) {
  const baseOf = (p) => p.foto ?? String(p.id).replace(/\d+$/, "");
  const pool = fotos.length ? fotos : [...new Set(cast.map(baseOf))];
  const uses = (b) => cast.filter((p) => baseOf(p) === b).length;
  const foto = [...pool].sort((a, b) => uses(a) - uses(b) || a.localeCompare(b))[0] ?? "persona";
  let k = uses(foto) + 1;
  while (cast.some((p) => p.id === (k === 1 ? foto : `${foto}${k}`))) k++;
  const id = k === 1 ? foto : `${foto}${k}`;
  const colors = ["#8b5cf6", "#0ea5e9", "#f43f5e", "#22c55e", "#eab308", "#f97316", "#14b8a6", "#64748b"];
  return [
    ...cast,
    {
      id,
      nombre: id.charAt(0).toUpperCase() + id.slice(1),
      foto,
      rol,
      rolDoc: rolDoc ?? rol.toLowerCase(),
      cargo: cargo ?? `Usuario con rol ${rol}`,
      perfil: `Usa el producto con el rol ${rol} en su trabajo diario. Juzga si lo que le toca hacer es claro, rápido y sin errores.`,
      valora: ["claridad", "pocos pasos", "que no falle"],
      color: colors[cast.length % colors.length],
    },
  ];
}

// ───────────────────────── contexto del proyecto ─────────────────────────

function context() {
  const cfg = loadConfig(process.cwd());
  if (!cfg) throw new Error("No hay neurodanza.config.json en esta carpeta ni en las de arriba (corre /neurodanza-init).");
  const elenco = cfg.abs(cfg.panel.elenco);
  if (!existsSync(elenco)) throw new Error(`No existe el elenco ${elenco} (corre /neurodanza-init).`);
  const cast = JSON.parse(readFileSync(elenco, "utf8"));
  return { cfg, elenco, cast, fotos: cfg.abs(cfg.panel.fotos), avatars: join(dirname(elenco), "avatars") };
}

function imageOf(ctx, p) {
  const base = p.foto ?? String(p.id).replace(/\d+$/, "");
  const foto = join(ctx.fotos, `${base}.png`);
  return existsSync(foto) ? foto : join(ctx.avatars, `${p.id}.png`);
}

function roleMaps(ctx) {
  const { roles } = ctx.cfg;
  const maps = {};
  if (roles.adaptador === "json") {
    const file = ctx.cfg.abs(roles.fuente);
    const data = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    for (const [rol, rutas] of Object.entries(data)) maps[rol] = new Map(Object.entries(rutas).map(([r, w]) => [r, !!w]));
    return maps;
  }
  for (const p of ctx.cast.personas) {
    const f = ctx.cfg.abs(String(roles.fuente).replace("{rolDoc}", p.rolDoc ?? p.rol.toLowerCase()).replace("{rol}", p.rol));
    maps[p.rol] = existsSync(f) ? parseRoleMap(readFileSync(f, "utf8")) : new Map();
  }
  return maps;
}

/** Capa fundida en el fusible → no se reintenta: el panel queda pendiente (el comando sale con 3). */
function exigirCapa(cfg, capa) {
  if (!fundida(cfg, capa)) return;
  const e = new Error(`${textoCapa(cfg, capa)}: no se reintenta en este ciclo; el panel queda PENDIENTE (lo decide el usuario).`);
  e.pendiente = true;
  throw e;
}

/**
 * URL de la app que responde. Si ninguna responde, registra el fallo en el fusible (capa app) y corta:
 * antes se seguía con la primera URL y el login fallaba tarde, en cada persona.
 */
async function detectWeb(cfg) {
  if (process.env.NEURODANZA_WEB_URL) return process.env.NEURODANZA_WEB_URL.replace(/\/$/, "");
  exigirCapa(cfg, "app");
  const vistas = [];
  for (const url of cfg.app.urls) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}${cfg.app.login.ruta.split("?")[0]}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) return url.replace(/\/$/, "");
      vistas.push(`${url} → HTTP ${r.status}`);
    } catch (e) {
      vistas.push(`${url} → ${e?.cause?.code ?? e?.name ?? "sin respuesta"}`);
    }
  }
  const c = fallaFusible(cfg, "app", `la app no responde (${vistas.join("; ")})`);
  const e = new Error(c.fundida ? `${textoCapa(cfg, "app")}: el panel queda PENDIENTE (lo decide el usuario).` : `la app no responde: ${vistas.join("; ")}. Revisa que esté levantada con el código nuevo (app.levantar). Fallo ${c.fallos.length} de ${cfg.fusible?.maxFallos ?? 2} en este ciclo.`);
  e.pendiente = c.fundida;
  throw e;
}

/** Playwright del proyecto (se busca en los repos configurados y en la raíz). */
async function playwright(cfg) {
  for (const dir of [cfg.root, ...cfg.repos.map((r) => cfg.abs(r.ruta))]) {
    try {
      const req = createRequire(join(dir, "package.json"));
      const mod = await import(pathToFileURL(req.resolve("@playwright/test")).href);
      return mod.chromium ? mod : mod.default;
    } catch {
      continue;
    }
  }
  fallaFusible(cfg, "chromium", "no hay @playwright/test en el proyecto");
  throw new Error("No encontré @playwright/test en el proyecto: instálalo (pnpm add -D @playwright/test) y corre `npx playwright install chromium`.");
}

/** Abre Chromium; si no abre, lo registra en el fusible (capa chromium). */
async function abrirNavegador(cfg) {
  exigirCapa(cfg, "chromium");
  const { chromium } = await playwright(cfg);
  try {
    return await chromium.launch();
  } catch (e) {
    const c = fallaFusible(cfg, "chromium", String(e?.message ?? e).split("\n")[0]);
    const err = new Error(`Chromium no abre: ${String(e?.message ?? e).split("\n")[0]}${c.fundida ? " — capa chromium fundida: el panel queda PENDIENTE." : ""}`);
    err.pendiente = c.fundida;
    throw err;
  }
}

function credentialsOf(ctx, p) {
  const u = ctx.cfg.panel.usuarios;
  if (!u) throw new Error("Falta panel.usuarios en neurodanza.config.json (cómo entra cada persona).");
  if (u.propietario && p.rol === u.propietario.rol) return expand({ email: u.propietario.email, clave: u.propietario.clave });
  return { email: expand(u.email, { id: p.id, rol: p.rol }), clave: expand(u.clave) };
}

async function http(web, def, vars, token) {
  const res = await fetch(`${web}${expand(def.url, vars)}`, {
    method: def.metodo ?? "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: def.cuerpo ? JSON.stringify(expand(def.cuerpo, vars)) : undefined,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ───────────────────────── comandos ─────────────────────────

function args() {
  const a = {};
  const v = process.argv.slice(3);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith("--")) a[v[i].slice(2)] = v[i + 1]?.startsWith("--") ? true : v[++i];
  return a;
}
const list = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

async function usuarios(ctx) {
  const u = ctx.cfg.panel.usuarios;
  if (!u?.login || !u?.crear) throw new Error("panel.usuarios.login y panel.usuarios.crear son obligatorios para crear usuarios.");
  const web = await detectWeb(ctx.cfg);
  const login = await http(web, u.login, {});
  const token = login.body?.[u.login.token ?? "accessToken"];
  if (!token) throw new Error(`login del administrador: ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`);
  for (const p of ctx.cast.personas) {
    if (u.propietario && p.rol === u.propietario.rol) {
      console.log(`= ${p.nombre} usa la cuenta del propietario`);
      continue;
    }
    const vars = { id: p.id, nombre: p.nombre, rol: p.rol, email: expand(u.email, { id: p.id, rol: p.rol }), clave: expand(u.clave) };
    const r = await http(web, u.crear, vars, token);
    if (r.status >= 200 && r.status < 300) console.log(`+ ${p.nombre} (${p.rol}) creado`);
    else if (r.status === 409) console.log(`= ${p.nombre} (${p.rol}) ya existe`);
    else console.log(`! ${p.nombre}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
}

/** Indicadores de carga comunes; `panel.carga.cargando` agrega los del proyecto. */
export const CARGANDO = [
  '[aria-busy="true"]',
  '[role="progressbar"]:not([aria-valuenow])',
  '[data-loading="true"]',
  ".animate-pulse",
  ".animate-spin",
  '[class*="skeleton" i]',
  '[class*="spinner" i]',
  '[class*="loading" i]',
];

/** Corre en la página: lista si no hay indicadores de carga visibles y el DOM no cambió en `quietoMs`. */
function pantallaQuieta({ selectores, quietoMs }) {
  const w = window;
  if (!w.__ndCambio) {
    w.__ndCambio = Date.now();
    new MutationObserver(() => (w.__ndCambio = Date.now())).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  if (document.readyState !== "complete") return false;
  if (document.fonts && document.fonts.status !== "loaded") return false;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  for (const sel of selectores) {
    let els = [];
    try {
      els = document.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const el of els) if (visible(el)) return false;
  }
  return Date.now() - w.__ndCambio >= quietoMs;
}

/**
 * Espera a que la pantalla termine de cargar antes de una captura: red quieta, sin indicadores de carga visibles
 * (esqueletos, spinners, `aria-busy`) y el DOM sin cambios en `quietoMs`. Tope `maxSeg`; devuelve false si se cumplió
 * el tope (la captura se toma igual y el informe lo dice).
 */
export async function esperarPantalla(page, { maxSeg = 15, quietoMs = 400, cargando = [] } = {}) {
  const fin = Date.now() + maxSeg * 1000;
  await page.waitForLoadState?.("networkidle", { timeout: Math.min(5000, maxSeg * 1000) }).catch(() => {});
  if (!page.waitForFunction) return true;
  const resto = Math.max(500, fin - Date.now());
  return page
    .waitForFunction(pantallaQuieta, { selectores: [...CARGANDO, ...cargando], quietoMs }, { timeout: resto, polling: 100 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Navegador de Playwright con la interfaz que espera `ejecutarRecorrido` (lib/recorridos.mjs). `registro`
 * acumula errores de consola y respuestas HTTP con error (≥ 400, salvo las de `app.ignorarConsola`).
 */
export function navegadorPlaywright(page, web, registro, { capturas = null, carga = {} } = {}) {
  const scope = async () => {
    const main = page.locator("main").first();
    return (await main.count()) ? main : page;
  };
  const listo = () => page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  const ruta = () => {
    try {
      return new URL(page.url()).pathname;
    } catch {
      return page.url();
    }
  };
  return {
    async ir(r) {
      await page.goto(`${web}${r}`, { waitUntil: "networkidle" }).catch(() => null);
    },
    async click(nombre, { exacto = false } = {}) {
      const s = await scope();
      await s.getByRole("button", { name: nombre, exact: exacto }).or(s.getByRole("link", { name: nombre, exact: exacto })).or(s.getByRole("tab", { name: nombre })).first().click({ timeout: 5000 });
      await listo();
    },
    async elegir(lista, opcion, { exacto = false } = {}) {
      const s = await scope();
      await s.getByRole("combobox", { name: new RegExp(lista, "i") }).first().click({ timeout: 5000 });
      await page.getByRole("option", { name: opcion, exact: exacto }).first().click({ timeout: 5000 });
    },
    async llenar(etiqueta, valor) {
      const s = await scope();
      await s.getByLabel(etiqueta).first().fill(valor, { timeout: 5000 });
    },
    tecla: (k) => page.keyboard.press(k),
    esperar: (ms) => page.waitForTimeout(ms),
    async cumple(e = {}) {
      try {
        if (e.url) {
          await page.waitForURL((u) => u.pathname.startsWith(e.url), { timeout: 5000 });
          return { ok: true, encontrado: ruta() };
        }
        const t = e.elemento ?? e.texto ?? e.mensaje;
        if (!t) return { ok: true, encontrado: "" };
        const loc = e.elemento ? page.getByRole("button", { name: t }).or(page.getByRole("link", { name: t })).or(page.getByLabel(t)).or(page.getByText(t)) : page.getByText(t);
        await loc.first().waitFor({ state: "visible", timeout: 5000 });
        return { ok: true, encontrado: t };
      } catch {
        const h1 = ((await page.locator("h1").first().textContent({ timeout: 1000 }).catch(() => "")) ?? "").trim();
        return { ok: false, encontrado: e.url ? ruta() : h1 ? `pantalla «${h1}» sin «${e.elemento ?? e.texto ?? e.mensaje}»` : "no apareció" };
      }
    },
    errores: () => registro,
    async despues(fila) {
      if (!capturas) return;
      const f = join(capturas, `recorrido-${String(fila.n).padStart(2, "0")}.png`);
      if (!(await esperarPantalla(page, carga))) fila.cargaIncompleta = true;
      await page.screenshot({ path: f, fullPage: true });
      fila.captura = f;
    },
  };
}

/**
 * Notas con detalle por paso (Tenet): un paso crítico que no cumple (según la persona o la ejecución mecánica)
 * limita la nota a `panel.notaMaxSiFalla`. Guarda la nota de la persona en `notaPersona`. `leer(ruta)` → JSON|null.
 */
export function ajustarEvaluaciones(data, { notaMax = 6, leer = () => null, regresionesDe = () => [] } = {}) {
  for (const e of data.evaluaciones ?? []) {
    if (!e.pasos && !e.recorrido) continue;
    if (e.reutilizada) continue; // ya se ajustó en su ronda
    const rec = e.recorrido?.archivo ? leer(e.recorrido.archivo) : null;
    const ej = e.recorrido?.informe ? leer(e.recorrido.informe) : null;
    const notaPersona = Number(e.notaPersona ?? e.nota);
    // Westworld: las regresiones de experiencia frente a la última versión aprobada bajan la nota (regla documentada).
    const regs = ej ? regresionesDe(e, rec, ej.recorrido ?? ej) : [];
    let nota = notaPersona;
    if (regs.length) {
      const c = notaConRegresiones(nota, regs);
      nota = c.nota;
      Object.assign(e, { regresiones: regs.map((r) => r.texto), descuentoRegresiones: c.descuento });
    }
    // Tenet: un paso crítico que no cumple limita la nota.
    const r = notaPorPasos({ ...e, nota }, notaMax, rec, ej?.recorrido ?? ej);
    if (r.limitada) {
      nota = r.nota;
      e.limite = r.motivo;
    }
    if (nota !== notaPersona) Object.assign(e, { notaPersona, nota });
  }
  return data;
}

/** Regresiones de una evaluación con recorrido, contra la memoria del proyecto. */
const regresionesConfig = (cfg, version) => (e, rec, ej) => {
  const id = e.recorrido?.id ?? rec?.id ?? ej?.id;
  return id ? compararMemoria(cfg, id, ej, { excluirVersion: version }).regresiones : [];
};

/**
 * Tras calificar: cada recorrido **permanente** guarda su ejecución en la memoria (versión de la app del resultado,
 * aprobada si la ronda aprobó) y las regresiones por persona quedan en `.neurodanza/regresiones.json` (el mapa).
 */
function guardarMemorias(cfg, data, aprobado) {
  const porPersona = {};
  for (const e of data.evaluaciones ?? []) {
    if (e.regresiones?.length) porPersona[e.persona] = e.regresiones;
    if (e.reutilizada || !e.recorrido?.informe) continue;
    const ej = leerJsonSiExiste(e.recorrido.informe);
    const ejec = ej?.recorrido ?? ej;
    const rec = (e.recorrido.archivo && leerJsonSiExiste(e.recorrido.archivo)) || leerRecorrido(cfg, e.recorrido.id ?? ejec?.id ?? "");
    if (!ejec?.pasos || !rec) continue;
    const permanente = rec.permanente === true || existsSync(join(cfg.abs(cfg.panel.recorridos), `${rec.id}.json`));
    if (permanente) registrarMemoria(cfg, rec, ejec, { version: data.version, persona: e.persona, aprobado });
  }
  try {
    mkdirSync(cfg.abs(".neurodanza"), { recursive: true });
    writeFileSync(cfg.abs(".neurodanza/regresiones.json"), JSON.stringify(porPersona, null, 2));
  } catch {
    /* el mapa es una ayuda */
  }
}

/** `panel.mjs comparar --recorrido <id> [--ejecucion <recorrido.json>]`: regresiones contra la última versión aprobada. */
function comparar(ctx, a) {
  const { cfg } = ctx;
  if (!a.recorrido) throw new Error("comparar: --recorrido <id> es obligatorio");
  const mem = leerMemoria(cfg, a.recorrido);
  let ej = a.ejecucion ? leerJsonSiExiste(a.ejecucion) : null;
  ej = ej?.recorrido ?? ej;
  if (!ej) {
    // Sin ejecución dada: la última registrada contra la última aprobada anterior.
    const ultima = mem.historial.at(-1);
    if (!ultima) return console.log(JSON.stringify({ recorrido: a.recorrido, regresiones: [], motivo: "sin historial previo" }, null, 2));
    const previa = mem.historial.slice(0, -1).reverse().find((x) => x.aprobado);
    if (!previa) return console.log(JSON.stringify({ recorrido: a.recorrido, regresiones: [], motivo: "sin una versión aprobada anterior" }, null, 2));
    const regs = compararEjecuciones(previa, ultima, cfg.panel.regresion).map((r) => ({ ...r, texto: textoRegresion(r, ultima.tarea ?? a.recorrido, previa.version) }));
    return console.log(JSON.stringify({ recorrido: a.recorrido, contra: previa.version, version: ultima.version, regresiones: regs }, null, 2));
  }
  const r = compararMemoria(cfg, a.recorrido, ej);
  console.log(JSON.stringify({ recorrido: a.recorrido, contra: r.base?.version ?? null, regresiones: r.regresiones, ...(r.motivo ? { motivo: r.motivo } : {}) }, null, 2));
  if (r.regresiones.length) console.error(r.regresiones.map((x) => `⚠ ${x.texto}`).join("\n"));
}

const leerJsonSiExiste = (f) => {
  try {
    return JSON.parse(readFileSync(resolve(f), "utf8"));
  } catch {
    return null;
  }
};

async function navegar(ctx, a) {
  const { cfg } = ctx;
  const p = ctx.cast.personas.find((x) => x.id === a.persona);
  if (!p) throw new Error(`persona desconocida: ${a.persona}`);
  const recorrido = a.recorrido ? leerRecorrido(cfg, a.recorrido) : null;
  if (a.recorrido && !recorrido) throw new Error(`no encontré el recorrido ${a.recorrido} (archivo o id de ${cfg.panel.recorridos})`);
  if (recorrido) {
    const errores = validarRecorrido(recorrido);
    if (errores.length) throw new Error(`recorrido inválido:\n- ${errores.join("\n- ")}`);
  }
  const web = await detectWeb(cfg);
  const out = resolve(a.salida ?? join(tmpdir(), `neurodanza-${p.id}`));
  mkdirSync(out, { recursive: true });
  const acciones = a.acciones ? JSON.parse(readFileSync(a.acciones, "utf8")) : [];
  const viewport = a.dispositivo === "tablet" ? { width: 1024, height: 768 } : a.dispositivo === "celular" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  // Cada persona corre en su propio proceso con su propio navegador y contexto: no comparten sesión.
  const browser = await abrirNavegador(cfg);
  const page = await browser.newPage({ viewport, locale: cfg.app.idioma ?? "es-EC" });
  const problemas = [];
  const ignore = (cfg.app.ignorarConsola ?? ["status of 401"]).map((r) => new RegExp(r, "i"));
  page.on("console", (m) => m.type() === "error" && !ignore.some((re) => re.test(m.text())) && problemas.push(`consola: ${m.text().slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 500 && problemas.push(`HTTP ${r.status()} ${r.url().replace(web, "")}`));
  // Para el recorrido: errores de consola y toda respuesta HTTP con error (≥ 400) que no se ignore.
  const registro = [];
  page.on("console", (m) => m.type() === "error" && !ignore.some((re) => re.test(m.text())) && registro.push(`consola: ${m.text().slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 400 && !ignore.some((re) => re.test(`status of ${r.status()}`)) && registro.push(`HTTP ${r.status()} ${r.url().replace(web, "")}`));
  const informe = { persona: p.id, rol: p.rol, dispositivo: a.dispositivo ?? "escritorio", web, pantallas: [], problemas };
  const L = cfg.app.login;
  try {
    const c = credentialsOf(ctx, p);
    await page.goto(`${web}${L.ruta}`);
    await page.getByLabel(L.usuario, { exact: true }).fill(c.email);
    await page.getByLabel(L.clave, { exact: true }).fill(c.clave);
    await page.getByRole("button", { name: new RegExp(L.boton, "i") }).click();
    // «espera» = ruta a la que se llega tras entrar; con "/" basta con haber salido de la pantalla de login.
    const loginPath = L.ruta.split("?")[0];
    try {
      if (!L.espera || L.espera === "/") await page.waitForURL((u) => !u.pathname.startsWith(loginPath), { timeout: 20_000 });
      else await page.waitForURL((u) => u.pathname.startsWith(L.espera), { timeout: 20_000 });
    } catch (e) {
      // El login no avanza: es la app (o sus usuarios) la que falla, no la persona.
      fallaFusible(cfg, "app", `el login de ${p.id} no avanza en 20 s`);
      throw e;
    }
    // Primero el recorrido acordado (Tenet): se ejecuta entero y se registra paso por paso.
    if (recorrido) {
      registro.length = 0;
      informe.recorrido = await ejecutarRecorrido(navegadorPlaywright(page, web, registro, { capturas: out, carga: cfg.panel.carga }), recorrido);
      informe.recorrido.archivo = existsSync(a.recorrido) ? resolve(a.recorrido) : null;
      informe.recorrido.congeladoOk = recorrido.congelado ? verificarCongelado(recorrido) : null;
      writeFileSync(join(out, "recorrido.json"), JSON.stringify(informe.recorrido, null, 2));
    }
    let n = 0;
    for (const ruta of list(a.rutas)) {
      n++;
      const slug = `${String(n).padStart(2, "0")}-${ruta.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "inicio"}`;
      const res = await page.goto(`${web}${ruta}`, { waitUntil: "load" }).catch(() => null);
      const cargada = await esperarPantalla(page, cfg.panel.carga);
      if (!cargada) problemas.push(`${ruta}: la pantalla no terminó de cargar en ${cfg.panel.carga.maxSeg} s (indicador de carga visible o cambiando)`);
      const shot = join(out, `${slug}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      const pantalla = await page.evaluate(() => {
        const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 60);
        return {
          titulo: document.querySelector("h1")?.textContent?.trim() ?? document.title,
          botones: [...document.querySelectorAll("button, a[role=button], [role=tab], [role=combobox]")].filter(vis).map(name).filter(Boolean).slice(0, 60),
          campos: [...document.querySelectorAll("input, select, textarea")].filter(vis).map((el) => el.getAttribute("aria-label") || el.labels?.[0]?.textContent?.trim() || el.getAttribute("placeholder") || el.name).filter(Boolean).slice(0, 40),
          texto: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 3500),
        };
      });
      const entrada = { ruta, url: page.url().replace(web, ""), estado: res?.status?.() ?? 0, captura: shot, ...pantalla, pasos: [] };
      for (const act of acciones.filter((x) => x.ruta === ruta)) {
        for (const paso of act.pasos ?? []) {
          try {
            const main = page.locator("main").first();
            const scope = (await main.count()) ? main : page;
            if (paso.click) await scope.getByRole("button", { name: paso.click, exact: !!paso.exacto }).or(scope.getByRole("link", { name: paso.click, exact: !!paso.exacto })).or(scope.getByRole("tab", { name: paso.click })).first().click({ timeout: 5000 });
            else if (paso.elegir) {
              await scope.getByRole("combobox", { name: new RegExp(paso.elegir, "i") }).first().click({ timeout: 5000 });
              await page.getByRole("option", { name: paso.opcion, exact: !!paso.exacto }).first().click({ timeout: 5000 });
            } else if (paso.llenar) await scope.getByLabel(paso.llenar).first().fill(String(paso.valor ?? ""), { timeout: 5000 });
            else if (paso.tecla) await page.keyboard.press(paso.tecla);
            else if (paso.esperar) await page.waitForTimeout(Number(paso.esperar));
            if (paso.captura) {
              const extra = join(out, `${slug}-${paso.captura}.png`);
              await esperarPantalla(page, cfg.panel.carga);
              await page.screenshot({ path: extra, fullPage: true });
              entrada.pasos.push({ ...paso, ok: true, captura: extra });
            } else entrada.pasos.push({ ...paso, ok: true });
          } catch (e) {
            entrada.pasos.push({ ...paso, ok: false, error: String(e).split("\n")[0].slice(0, 200) });
          }
        }
      }
      informe.pantallas.push(entrada);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(out, "informe.json"), JSON.stringify(informe, null, 2));
  const rec = informe.recorrido;
  console.log(JSON.stringify({ informe: join(out, "informe.json"), ...(rec ? { recorrido: { informe: join(out, "recorrido.json"), cumplidos: `${rec.totales.cumplidos}/${rec.totales.pasos}`, clics: rec.totales.clics, segundos: Math.round(rec.totales.ms / 100) / 10, dentroDeLimites: rec.totales.dentroDeLimites, pasos: rec.pasos.map((x) => `${x.n}. ${x.cumple ? "✔" : "✖"} ${x.paso} → esperaba ${x.esperado}${x.cumple ? "" : `, encontré ${x.encontrado}`}`) } } : {}), pantallas: informe.pantallas.map((x) => ({ ruta: x.ruta, captura: x.captura, estado: x.estado })), problemas }, null, 2));
}

function calificar(ctx, a) {
  const file = resolve(a.resultado);
  const crudo = JSON.parse(readFileSync(file, "utf8"));
  const data = ajustarEvaluaciones(crudo, { notaMax: ctx.cfg.panel.notaMaxSiFalla ?? 6, leer: leerJsonSiExiste, regresionesDe: regresionesConfig(ctx.cfg, crudo.version) });
  const umbral = ctx.cfg.panel.umbral;
  const s = veredictoRonda(data, umbral, fundidas(ctx.cfg));
  Object.assign(data, s, { umbral, fecha: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  guardarMemorias(ctx.cfg, data, s.aprobado);
  console.log(JSON.stringify(s));
  // En el chat: lo que limitó o bajó cada nota.
  for (const e of data.evaluaciones ?? []) {
    for (const r of e.regresiones ?? []) console.log(`⚠ regresión · ${e.persona}: ${r}`);
    if (e.limite) console.log(`✖ ${e.persona}: ${e.limite}`);
  }
  // Si la ventana en vivo sigue abierta, se cierra aquí con las notas (aunque después nadie llame a `cerrar`).
  const cerrada = cerrarRondaActiva(ctx.cfg.root, "", data, umbral);
  if (cerrada) console.log(`ronda en vivo cerrada con las notas · ${cerrada}`);
  if (!s.aprobado) process.exitCode = 1;
}

/** Abre una ventana WPF sin consola visible (wscript + launch-hidden.vbs). Solo Windows. */
function launchWindow(ctx, script, scriptArgs) {
  if (ctx.cfg.panel.ventana !== "windows") return false;
  if (process.platform !== "win32") {
    console.log("(la ventana en vivo solo existe en Windows; el resultado se ve en el chat)");
    return false;
  }
  const ps = spawn("wscript.exe", [join(HERE, "launch-hidden.vbs"), join(HERE, script), ...scriptArgs], { detached: true, stdio: "ignore", windowsHide: true });
  ps.unref();
  return true;
}

const roundFile = (dir) => join(resolve(dir), "ronda.jsonl");
const append = (dir, ev) => appendFileSync(roundFile(dir), JSON.stringify({ ...ev, t: new Date().toISOString() }) + "\n", "utf8");

// ── Ronda activa: se recuerda por proyecto para cerrarla aunque nadie llame a `cerrar` ──
const activaFile = (root) => join(tmpdir(), `neurodanza-ronda-${createHash("sha1").update(String(root)).digest("hex").slice(0, 12)}.txt`);

/** ¿La ronda de esa carpeta sigue abierta (empezó y no tiene evento de fin)? */
export function rondaAbierta(dir) {
  const f = roundFile(dir);
  if (!existsSync(f)) return false;
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
  return lines.length > 0 && !lines.some((l) => l.includes('"type":"fin"'));
}

/** Evento de fin con notas, estados (desde la nota) y veredicto de un resultado del panel. */
function finDe(umbral, data) {
  return { type: "fin", promedio: data.promedio, aprobado: !!data.aprobado, umbral, notas: (data.evaluaciones ?? []).map((e) => ({ persona: e.persona, nota: e.nota, estado: estadoFinal(e.nota), ...(e.regresiones?.length ? { regresiones: e.regresiones } : {}) })) };
}

/**
 * Cierra la ronda en vivo que quedó abierta en el proyecto (la ventana se cierra sola). Con `data`
 * muestra las notas; sin ella, la marca como cerrada con el motivo. Devuelve la carpeta o null.
 */
export function cerrarRondaActiva(root, motivo, data = null, umbral = 0) {
  const af = activaFile(root);
  if (!existsSync(af)) return null;
  const dir = readFileSync(af, "utf8").trim();
  rmSync(af, { force: true });
  if (!dir || !rondaAbierta(dir)) return null;
  append(dir, data ? finDe(umbral, data) : { type: "fin", cancelada: true, motivo });
  return dir;
}

function enVivo(ctx, a) {
  const dir = resolve(a.ronda);
  if (cerrarRondaActiva(ctx.cfg.root, "empezó otra ronda")) console.log("(la ronda anterior seguía abierta: se cerró)");
  mkdirSync(dir, { recursive: true });
  writeFileSync(roundFile(dir), "", "utf8");
  const personas = list(a.personas).map((id) => {
    const p = ctx.cast.personas.find((x) => x.id === id) ?? { id, nombre: id, cargo: "", color: "#64748b" };
    return { id: p.id, nombre: p.nombre, cargo: p.cargo, color: p.color, imagen: imageOf(ctx, p) };
  });
  append(dir, { type: "inicio", titulo: a.titulo ?? "Panel de personas", cambio: a.cambio ?? "", personas });
  writeFileSync(activaFile(ctx.cfg.root), dir, "utf8");
  const opened = launchWindow(ctx, "live-window.ps1", ["-State", roundFile(dir)]);
  console.log(`${opened ? "ventana en vivo abierta" : "ronda iniciada (sin ventana)"} · ${roundFile(dir)}`);
}

function decir(a) {
  if (!a.persona || !a.texto) throw new Error("decir: --persona y --texto son obligatorios");
  const validos = [...ESTADOS_RONDA, ...ESTADOS_FINALES.map(([, e]) => e)];
  if (a.estado && !validos.includes(String(a.estado))) throw new Error(`decir: estado «${a.estado}» no válido. Usa uno de: ${validos.join(", ")}`);
  append(resolve(a.ronda), { type: "msg", persona: a.persona, texto: String(a.texto), ...(a.estado ? { estado: String(a.estado) } : {}) });
}

function oir(a) {
  const f = roundFile(a.ronda);
  if (!existsSync(f)) return console.log("(nadie ha hablado todavía)");
  const msgs = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "msg");
  console.log(msgs.map((m) => `${m.persona}: ${m.texto}`).join("\n") || "(nadie ha hablado todavía)");
}

function cerrar(ctx, a) {
  const data = JSON.parse(readFileSync(resolve(a.resultado), "utf8"));
  if (rondaAbierta(a.ronda)) append(resolve(a.ronda), finDe(ctx.cfg.panel.umbral, data));
  rmSync(activaFile(ctx.cfg.root), { force: true });
  console.log(`ronda cerrada: ${data.aprobado ? "aprobado" : "no aprobado"} · promedio ${data.promedio}`);
}

function ventana(ctx, a) {
  const data = JSON.parse(readFileSync(resolve(a.resultado), "utf8"));
  const cards = (data.evaluaciones ?? []).map((e) => {
    const p = ctx.cast.personas.find((x) => x.id === e.persona) ?? { id: e.persona };
    return { nombre: p.nombre ?? e.persona, cargo: p.cargo ?? "", color: p.color ?? "#64748b", imagen: imageOf(ctx, p), estado: estadoFinal(e.nota), nota: e.nota, frase: e.resumen ?? "" };
  });
  const payload = { titulo: data.aprobado ? "Aprobado por el panel" : "No aprobado", cambio: data.cambio ?? "", promedio: data.promedio, aprobado: !!data.aprobado, segundos: Number(a.segundos ?? 9), cards };
  const tmp = join(tmpdir(), `neurodanza-ventana-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(payload));
  launchWindow(ctx, "window.ps1", ["-Data", tmp]);
  console.log(`${payload.titulo} · promedio ${payload.promedio}`);
}

function crear(ctx, a) {
  if (!a.rol) throw new Error("crear: --rol <ROL> es obligatorio");
  const fotos = existsSync(ctx.fotos) ? readdirSync(ctx.fotos).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)) : [];
  const next = addPersona(ctx.cast.personas, String(a.rol).toUpperCase(), { rolDoc: a.rolDoc, cargo: a.cargo, fotos });
  writeFileSync(ctx.elenco, JSON.stringify({ ...ctx.cast, personas: next }, null, 2) + "\n");
  const nueva = next.at(-1);
  console.log(`+ ${nueva.nombre} (${nueva.rol}) con la foto ${nueva.foto}; crea su usuario con: panel.mjs usuarios`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const a = args();
  try {
    if (cmd === "decir") decir(a);
    else if (cmd === "oir") oir(a);
    else if (cmd === "app") {
      // ¿La app responde? Antes de lanzar a las personas: si no, cuenta para el fusible (capa app).
      const cfg = loadConfig(process.cwd());
      if (!cfg) throw new Error("No hay neurodanza.config.json en esta carpeta ni en las de arriba.");
      console.log(`app ok · ${await detectWeb(cfg)}`);
    } else {
      const ctx = context();
      const p = ctx.cfg.panel;
      if (cmd === "elegir") {
        const elegidas = selectPersonas(list(a.rutas), ctx.cast.personas, roleMaps(ctx), { min: p.min, max: p.max, n: a.n ? Number(a.n) : undefined, ignorar: p.ignorarRutas ?? [] });
        console.log(JSON.stringify(elegidas.map((x) => ({ id: x.id, nombre: x.nombre, rol: x.rol, cargo: x.cargo })), null, 2));
      } else if (cmd === "usuarios") await usuarios(ctx);
      else if (cmd === "navegar") await navegar(ctx, a);
      else if (cmd === "calificar") calificar(ctx, a);
      else if (cmd === "comparar") comparar(ctx, a);
      else if (cmd === "en-vivo") enVivo(ctx, a);
      else if (cmd === "cerrar") cerrar(ctx, a);
      else if (cmd === "ventana") ventana(ctx, a);
      else if (cmd === "crear") crear(ctx, a);
      else console.log("comandos: elegir | usuarios | navegar | calificar | comparar | en-vivo | decir | oir | cerrar | ventana | crear");
    }
  } catch (e) {
    console.error(String(e?.message ?? e));
    // 3 = capa fundida: el panel queda pendiente (no es un error de la persona ni del cambio).
    process.exitCode = e?.pendiente ? 3 : 2;
  }
}
