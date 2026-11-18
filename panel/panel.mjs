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
//   node panel.mjs calificar --resultado <json>                 promedio y aprobación (reescribe el json)
//   node panel.mjs en-vivo --ronda <carpeta> --personas a,b,c --titulo "…" --cambio "…"
//   node panel.mjs decir --ronda <carpeta> --persona <id> --texto "…" [--estado "Probando"]   (estados: ESTADOS_RONDA)
//   node panel.mjs oir --ronda <carpeta>
//   node panel.mjs cerrar --ronda <carpeta> --resultado <json>
//   node panel.mjs ventana --resultado <json>                   resumen final (sin ronda en vivo)
//   node panel.mjs crear --rol <ROL> [--rolDoc x] [--cargo "…"]  persona nueva para un rol sin persona
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.mjs";

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

async function detectWeb(cfg) {
  if (process.env.NEURODANZA_WEB_URL) return process.env.NEURODANZA_WEB_URL.replace(/\/$/, "");
  for (const url of cfg.app.urls) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}${cfg.app.login.ruta.split("?")[0]}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) return url.replace(/\/$/, "");
    } catch {
      continue;
    }
  }
  return cfg.app.urls[0].replace(/\/$/, "");
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
  throw new Error("No encontré @playwright/test en el proyecto: instálalo (pnpm add -D @playwright/test) y corre `npx playwright install chromium`.");
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

async function navegar(ctx, a) {
  const { cfg } = ctx;
  const p = ctx.cast.personas.find((x) => x.id === a.persona);
  if (!p) throw new Error(`persona desconocida: ${a.persona}`);
  const web = await detectWeb(cfg);
  const out = resolve(a.salida ?? join(tmpdir(), `neurodanza-${p.id}`));
  mkdirSync(out, { recursive: true });
  const acciones = a.acciones ? JSON.parse(readFileSync(a.acciones, "utf8")) : [];
  const viewport = a.dispositivo === "tablet" ? { width: 1024, height: 768 } : a.dispositivo === "celular" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const { chromium } = await playwright(cfg);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, locale: cfg.app.idioma ?? "es-EC" });
  const problemas = [];
  const ignore = (cfg.app.ignorarConsola ?? ["status of 401"]).map((r) => new RegExp(r, "i"));
  page.on("console", (m) => m.type() === "error" && !ignore.some((re) => re.test(m.text())) && problemas.push(`consola: ${m.text().slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 500 && problemas.push(`HTTP ${r.status()} ${r.url().replace(web, "")}`));
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
    if (!L.espera || L.espera === "/") await page.waitForURL((u) => !u.pathname.startsWith(loginPath), { timeout: 20_000 });
    else await page.waitForURL((u) => u.pathname.startsWith(L.espera), { timeout: 20_000 });
    let n = 0;
    for (const ruta of list(a.rutas)) {
      n++;
      const slug = `${String(n).padStart(2, "0")}-${ruta.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "inicio"}`;
      const res = await page.goto(`${web}${ruta}`, { waitUntil: "networkidle" }).catch(() => null);
      await page.waitForTimeout(600);
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
  console.log(JSON.stringify({ informe: join(out, "informe.json"), pantallas: informe.pantallas.map((x) => ({ ruta: x.ruta, captura: x.captura, estado: x.estado })), problemas }, null, 2));
}

function calificar(ctx, a) {
  const file = resolve(a.resultado);
  const data = JSON.parse(readFileSync(file, "utf8"));
  const umbral = ctx.cfg.panel.umbral;
  const s = score(data.evaluaciones ?? [], umbral);
  Object.assign(data, s, { umbral, fecha: new Date().toISOString() });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log(JSON.stringify(s));
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

function enVivo(ctx, a) {
  const dir = resolve(a.ronda);
  mkdirSync(dir, { recursive: true });
  writeFileSync(roundFile(dir), "", "utf8");
  const personas = list(a.personas).map((id) => {
    const p = ctx.cast.personas.find((x) => x.id === id) ?? { id, nombre: id, cargo: "", color: "#64748b" };
    return { id: p.id, nombre: p.nombre, cargo: p.cargo, color: p.color, imagen: imageOf(ctx, p) };
  });
  append(dir, { type: "inicio", titulo: a.titulo ?? "Panel de personas", cambio: a.cambio ?? "", personas });
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
  append(resolve(a.ronda), {
    type: "fin",
    promedio: data.promedio,
    aprobado: !!data.aprobado,
    umbral: ctx.cfg.panel.umbral,
    notas: (data.evaluaciones ?? []).map((e) => ({ persona: e.persona, nota: e.nota, estado: estadoFinal(e.nota) })),
  });
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
    else {
      const ctx = context();
      const p = ctx.cfg.panel;
      if (cmd === "elegir") {
        const elegidas = selectPersonas(list(a.rutas), ctx.cast.personas, roleMaps(ctx), { min: p.min, max: p.max, n: a.n ? Number(a.n) : undefined, ignorar: p.ignorarRutas ?? [] });
        console.log(JSON.stringify(elegidas.map((x) => ({ id: x.id, nombre: x.nombre, rol: x.rol, cargo: x.cargo })), null, 2));
      } else if (cmd === "usuarios") await usuarios(ctx);
      else if (cmd === "navegar") await navegar(ctx, a);
      else if (cmd === "calificar") calificar(ctx, a);
      else if (cmd === "en-vivo") enVivo(ctx, a);
      else if (cmd === "cerrar") cerrar(ctx, a);
      else if (cmd === "ventana") ventana(ctx, a);
      else if (cmd === "crear") crear(ctx, a);
      else console.log("comandos: elegir | usuarios | navegar | calificar | en-vivo | decir | oir | cerrar | ventana | crear");
    }
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exitCode = 2;
  }
}
