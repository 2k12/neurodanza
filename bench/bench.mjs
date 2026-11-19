#!/usr/bin/env node
// neurodanza · banco de pruebas de velocidad (sin dependencias).
// Arma un proyecto de prueba (bench/fixture → carpeta temporal con dos repos git, api y web), corre los
// hooks del plugin indicado con --plugin y mide 18 métricas con N corridas (mediana). Ver bench/README.md.
// --paso-ms: costo simulado de cada paso de un agente en las métricas de la parte 3 (300 por defecto).
//
//   node bench/bench.mjs [--plugin <carpeta del plugin>] [--salida bench/base.json] [--corridas 5] [--solo stop_normal,guardrails_ms]
//   node bench/bench.mjs --comparar bench/base.json,bench/parte1.json      tabla base vs. ahora (markdown)
import { execFileSync, execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PLUGIN = resolve(arg("plugin", join(AQUI, "..")));
const CORRIDAS = Number(arg("corridas", "5"));
const SOLO = arg("solo", "")
  .split(",")
  .filter(Boolean);
const SALIDA = arg("salida", "");
const TOPE_COLGADO_S = Number(arg("tope-colgado", "330"));
const TOPE_CONGELADO_S = Number(arg("tope-congelado", "45"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// ───────────────────────── proyecto de prueba ─────────────────────────

function armarProyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-bench-"));
  cpSync(join(AQUI, "fixture"), root, { recursive: true });
  for (const repo of ["api", "web"]) {
    const dir = join(root, repo);
    const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    g("init", "-q");
    g("config", "user.email", "bench@localhost");
    g("config", "user.name", "bench");
    g("config", "core.autocrlf", "false");
    g("add", ".");
    g("commit", "-qm", "inicio");
  }
  return root;
}

let contador = 0;
/** Cambia un archivo en ambos repos (contenido nuevo cada vez: sin caché). */
function cambiar(root) {
  contador++;
  writeFileSync(join(root, "api", "src", "index.mjs"), `export const sumar = (a, b) => a + b + ${contador};\n`);
  writeFileSync(join(root, "web", "src", "app.mjs"), `export const titulo = "Pedidos ${contador}";\n`);
}

/** Mata un proceso y todo su árbol (Windows: taskkill /T; resto: el grupo). */
function matarArbol(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* ya terminó */
  }
}

/** Procesos que el plugin dejó en segundo plano (fondo.json, si existe) y huérfanos del proyecto. */
function limpiarFondo(root) {
  try {
    const f = JSON.parse(readFileSync(join(root, ".neurodanza", "fondo.json"), "utf8"));
    for (const t of Object.values(f.tareas ?? {})) matarArbol(t.pid);
  } catch {
    /* sin fondo */
  }
  // Huérfanos de las herramientas falsas (solo las crea el banco): se matan para no ensuciar la corrida siguiente.
  try {
    if (process.platform === "win32") execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*tarea.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: "ignore" });
    else execSync("pkill -f tarea.mjs || true", { stdio: "ignore" });
  } catch {
    /* nada que limpiar */
  }
}

/** Cuenta los procesos huérfanos de las herramientas falsas que siguen vivos. */
function huerfanos() {
  try {
    if (process.platform === "win32") {
      const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*tarea.mjs*' }).Count"`, { encoding: "utf8" });
      return Number(out.trim() || 0);
    }
    return Number(execSync("pgrep -fc tarea.mjs || true", { encoding: "utf8" }).trim() || 0);
  } catch {
    return 0;
  }
}

/** Corre un hook del plugin con el evento por stdin. Devuelve { ms, salida, cortado }. */
function hook(script, modo, evento, { env = {}, topeMs = 0 } = {}) {
  return new Promise((res) => {
    const t0 = process.hrtime.bigint();
    const p = spawn(process.execPath, [join(PLUGIN, "hooks", script), ...(modo ? [modo] : [])], { cwd: evento.cwd, env: { ...process.env, ...env }, detached: process.platform !== "win32", windowsHide: true });
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.stderr.on("data", (d) => (salida += d));
    let cortado = false;
    const timer = topeMs
      ? setTimeout(() => {
          cortado = true;
          matarArbol(p.pid);
        }, topeMs)
      : null;
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      res({ ms: Number(process.hrtime.bigint() - t0) / 1e6, salida, code, cortado });
    });
    p.stdin.end(JSON.stringify(evento));
  });
}

// ───────────────────────── métricas ─────────────────────────

async function stopNormal(root) {
  const xs = [];
  for (let i = 0; i < CORRIDAS; i++) {
    cambiar(root);
    const r = await hook("feedback.mjs", "stop", { cwd: root, session_id: `normal-${i}-${Date.now()}` });
    xs.push(r.ms / 1000);
    limpiarFondo(root);
    log(`stop_normal #${i + 1}: ${(r.ms / 1000).toFixed(2)} s`);
  }
  return { valor: mediana(xs), unidad: "s", corridas: xs };
}

async function stopColgado(root) {
  const xs = [];
  const notas = [];
  for (let i = 0; i < CORRIDAS; i++) {
    cambiar(root);
    const antes = huerfanos();
    const r = await hook("feedback.mjs", "stop", { cwd: root, session_id: `colgado-${i}-${Date.now()}` }, { env: { BENCH_COLGADO: "1" }, topeMs: TOPE_COLGADO_S * 1000 });
    await sleep(500);
    const quedaron = huerfanos() - antes;
    xs.push(r.ms / 1000);
    notas.push({ segundos: r.ms / 1000, cortadoPorElBanco: r.cortado, huerfanos: quedaron, bloqueo: /block|corrige|no alcanzó/i.test(r.salida) });
    limpiarFondo(root);
    log(`stop_colgado #${i + 1}: ${(r.ms / 1000).toFixed(1)} s${r.cortado ? " (cortado por el banco)" : ""} · huérfanos ${quedaron}`);
  }
  return { valor: mediana(xs), unidad: "s", corridas: xs, detalle: notas, topeMedicion: TOPE_COLGADO_S };
}

function eventosVariados(root, n) {
  const f = (p) => join(root, p);
  const base = [
    { tool_name: "Read", tool_input: { file_path: f("api/src/index.mjs") } },
    { tool_name: "Read", tool_input: { file_path: f("api/.env") } },
    { tool_name: "Edit", tool_input: { file_path: f("api/src/index.mjs"), old_string: "a", new_string: "b" } },
    { tool_name: "Write", tool_input: { file_path: f("web/src/app.mjs"), content: "export const x = 1;\n" } },
    { tool_name: "Bash", tool_input: { command: "git status" } },
    { tool_name: "Bash", tool_input: { command: "npm test" } },
    { tool_name: "Bash", tool_input: { command: "npx vitest related --run src/index.mjs", timeout: 60000 } },
    { tool_name: "Bash", tool_input: { command: "npm run dev" } },
    { tool_name: "PowerShell", tool_input: { command: "Get-ChildItem" } },
    { tool_name: "Grep", tool_input: { pattern: "sumar" } },
  ];
  return Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], cwd: root, session_id: "guard", ...(i % 3 === 0 ? { agent_id: `ag-${i % 7}`, agent_type: "neurodanza:revisor-ui" } : {}) }));
}

async function guardrailsMs(root) {
  const xs = [];
  const n = Number(arg("eventos", "1000"));
  for (let i = 0; i < CORRIDAS; i++) {
    for (const p of ["agentes.json", "agentes"]) rmSync(join(root, ".neurodanza", p), { recursive: true, force: true });
    let total = 0;
    for (const ev of eventosVariados(root, n)) total += (await hook("guardrails.mjs", "", ev)).ms;
    xs.push(total / n);
    log(`guardrails_ms #${i + 1}: ${(total / n).toFixed(1)} ms`);
  }
  return { valor: mediana(xs), unidad: "ms", corridas: xs, eventos: n };
}

/**
 * Subagente congelado: A (revisor) da pasos y se congela; B sigue dando pasos (para que corran los hooks).
 * Se mide cuándo el harness marca a A «sin latido» y cuándo lo da por agotado (corta), y si al volver le
 * rechaza la herramienta. Sin corte: se informa el tope de medición.
 */
/** Registro de un agente: `.neurodanza/agentes/<id>.json` (o `.neurodanza/agentes.json` si un plugin usa uno solo). */
function leerAgente(root, id) {
  for (const leer of [() => JSON.parse(readFileSync(join(root, ".neurodanza", "agentes", `${id.replace(/[^\w.-]/g, "_")}.json`), "utf8")), () => JSON.parse(readFileSync(join(root, ".neurodanza", "agentes.json"), "utf8")).agentes?.[id]]) {
    try {
      const a = leer();
      if (a) return a;
    } catch {
      /* no existe */
    }
  }
  return null;
}

async function subagenteCongelado(root) {
  const xs = [];
  const det = [];
  for (let i = 0; i < CORRIDAS; i++) {
    for (const p of ["agentes.json", "agentes"]) rmSync(join(root, ".neurodanza", p), { recursive: true, force: true });
    const A = `congelado-${i}-${Date.now()}`;
    const paso = (agent_id, cmd) => hook("guardrails.mjs", "", { cwd: root, session_id: "cong", agent_id, agent_type: "neurodanza:revisor-ui", tool_name: "Bash", tool_input: { command: cmd } });
    const t0 = Date.now();
    for (let k = 0; k < 3; k++) {
      await paso(A, `git diff ${k}`);
      await sleep(1000);
    }
    const tCongela = (Date.now() - t0) / 1000;
    let tLatido = null;
    let tCorte = null;
    while ((Date.now() - t0) / 1000 < TOPE_CONGELADO_S) {
      await paso("trabajador", "git status");
      // El registro es un archivo por agente (.neurodanza/agentes/<id>.json); el plugin base no registra nada.
      const a = leerAgente(root, A);
      if (a?.sinLatido && tLatido === null) tLatido = (Date.now() - t0) / 1000;
      if (a?.agotado && tCorte === null) tCorte = (Date.now() - t0) / 1000;
      if (tCorte !== null && tLatido !== null) break;
      await sleep(1000);
    }
    const vuelve = await paso(A, "git log -1");
    const rechazado = vuelve.code === 2 || /deny|se acabó tu tiempo/i.test(vuelve.salida);
    const valor = tCorte ?? null;
    xs.push(valor ?? TOPE_CONGELADO_S);
    det.push({ congelaA: tCongela, sinLatidoA: tLatido, cortadoA: tCorte, alVolverRechazado: rechazado });
    log(`subagente_congelado #${i + 1}: ${valor === null ? `sin corte (tope ${TOPE_CONGELADO_S} s)` : `corte a los ${valor.toFixed(1)} s`} · sin latido ${tLatido ?? "—"} · al volver ${rechazado ? "rechazado" : "sigue"}`);
  }
  const sinCorte = det.every((d) => d.cortadoA === null);
  return { valor: sinCorte ? null : mediana(xs), unidad: "s", sinCorte, topeMedicion: TOPE_CONGELADO_S, corridas: xs, detalle: det };
}

/** ¿El skill lanza revisores y panel en el mismo turno? (lo lee del skill del plugin medido) */
function skillParalelo() {
  try {
    return /revisores[^\n]{0,200}panel[^\n]{0,200}en el mismo turno|en el mismo turno[^\n]{0,200}revisores[^\n]{0,200}panel/i.test(readFileSync(join(PLUGIN, "skills", "neurodanza-feature", "SKILL.md"), "utf8"));
  } catch {
    return false;
  }
}

const dormir = (ms) => new Promise((res) => spawn(process.execPath, ["-e", `setTimeout(()=>{},${ms})`], { windowsHide: true }).on("close", res));

async function levantarApp(root, env = {}) {
  const p = spawn(process.execPath, [join(root, "servidor.mjs")], { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: "ignore" });
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    try {
      const r = await fetch("http://localhost:47613/login", { signal: AbortSignal.timeout(500) });
      if (r.ok || r.status) return { p, ok: r.ok };
    } catch {
      /* todavía no */
    }
    if (p.exitCode !== null) return { p, ok: false };
    await sleep(100);
  }
  return { p, ok: false };
}

async function revisionYPanel(root) {
  const paralelo = skillParalelo();
  const REV = Array(4).fill(20000);
  const PER = Array(3).fill(30000);
  const xs = [];
  for (let i = 0; i < CORRIDAS; i++) {
    const t0 = Date.now();
    let app;
    if (paralelo) {
      app = await levantarApp(root);
      await Promise.all([...REV, ...PER].map(dormir));
    } else {
      await Promise.all(REV.map(dormir));
      app = await levantarApp(root);
      await Promise.all(PER.map(dormir));
    }
    app.p.kill();
    const s = (Date.now() - t0) / 1000;
    xs.push(s);
    log(`revision_y_panel #${i + 1} (${paralelo ? "paralelo" : "secuencial"}): ${s.toFixed(1)} s`);
  }
  return { valor: mediana(xs), unidad: "s", corridas: xs, orden: paralelo ? "revisores y panel en el mismo turno" : "revisores, después panel", modelo: "revisores 4 × 20 s en paralelo; personas 3 × 30 s en paralelo" };
}

/**
 * App que no arranca. Base: se siguen las reglas del skill (hasta panel.maxRondas rondas; en cada una se
 * levanta la app y cada persona intenta entrar). Con fusible (lib/fusible.mjs en el plugin): cada fallo se
 * registra y, con la capa fundida, el ciclo sigue con el panel pendiente.
 */
async function falloExterno(root) {
  const cfg = JSON.parse(readFileSync(join(root, "neurodanza.config.json"), "utf8"));
  const rondas = cfg.panel?.maxRondas ?? 3;
  const conFusible = existsSync(join(PLUGIN, "lib", "fusible.mjs"));
  const fusible = (...a) => {
    try {
      return execFileSync(process.execPath, [join(PLUGIN, "lib", "fusible.mjs"), ...a], { cwd: root, encoding: "utf8" });
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const TURNO_PERSONA_MS = 3000; // lo que tarda un agente persona en arrancar e intentar entrar (simulado)
  const xs = [];
  const det = [];
  for (let i = 0; i < CORRIDAS; i++) {
    if (conFusible) fusible("reiniciar");
    const t0 = Date.now();
    let intentos = 0;
    let resultado = "se rinde (informa al usuario)";
    fuera: for (let r = 1; r <= rondas; r++) {
      intentos++;
      const app = await levantarApp(root, { BENCH_APP: "caido" });
      app.p.kill();
      if (!app.ok && conFusible) {
        fusible("falla", "--capa", "app", "--detalle", "no arranca");
        if (/fundida/.test(fusible("estado", "--capa", "app"))) {
          resultado = "avanza con el panel pendiente";
          break fuera;
        }
      }
      for (let k = 0; k < 3; k++) {
        if (conFusible && /fundida/.test(fusible("estado", "--capa", "app"))) {
          resultado = "avanza con el panel pendiente";
          break fuera;
        }
        intentos++;
        await dormir(TURNO_PERSONA_MS);
        try {
          await fetch("http://localhost:47613/login", { signal: AbortSignal.timeout(4000) });
        } catch {
          if (conFusible) fusible("falla", "--capa", "app", "--detalle", "persona no pudo entrar");
        }
      }
    }
    const s = (Date.now() - t0) / 1000;
    xs.push(s);
    det.push({ intentos, resultado, segundos: s });
    log(`fallo_externo #${i + 1}: ${intentos} intentos · ${s.toFixed(1)} s · ${resultado}`);
  }
  return { valor: mediana(xs), unidad: "s", intentos: mediana(det.map((d) => d.intentos)), resultado: det[0].resultado, corridas: xs, detalle: det, modelo: `hasta ${rondas} rondas; 3 personas por ronda; ${TURNO_PERSONA_MS / 1000} s por intento de persona` };
}

// ───────────────────────── comparar ─────────────────────────

/** Tabla markdown base vs. ahora. Mejora = (base − ahora) / base × 100 (positiva = más rápido). */
export function comparar(base, ahora) {
  const fmt = (m) => {
    if (!m) return "—";
    if (m.valor === null && m.sinCorte) return `sin corte (tope de medición ${m.topeMedicion} s)`;
    if (m.texto) return m.texto;
    if (m.unidad === "pasos" && m.segundos !== undefined) return `${m.valor} pasos · ${m.segundos.toFixed(1)} s`;
    const v = m.unidad === "ms" ? `${m.valor.toFixed(1)} ms` : m.unidad === "s" ? `${m.valor.toFixed(1)} s` : `${m.valor} ${m.unidad}`;
    if (m.intentos !== undefined) return `${v} · ${m.intentos} intentos`;
    if (m.lecturas !== undefined) return `${v} · ${m.lecturas} lecturas`;
    if (m.pasos !== undefined && m.unidad === "líneas") return `${v} · ${m.pasos} pasos`;
    if (m.permite !== undefined) return `${v} · permite ${m.permite} · rechaza ${m.rechaza} · pregunta ${m.pregunta}`;
    return v;
  };
  const filas = ["| Métrica | Base | Ahora | Mejora |", "|---|---|---|---|"];
  for (const k of Object.keys({ ...base.metricas, ...ahora.metricas })) {
    const b = base.metricas[k];
    const a = ahora.metricas[k];
    let mejora = "—";
    if (b && a && b.valor === null && b.sinCorte && a.valor !== null) mejora = `corte en ≤ ${a.valor.toFixed(1)} s (antes, sin corte)`;
    else if (b?.valor && a?.valor !== null && a?.valor !== undefined) mejora = `${(((b.valor - a.valor) / b.valor) * 100).toFixed(1)} %`;
    filas.push(`| \`${k}\` | ${fmt(b)} | ${fmt(a)} | ${mejora} |`);
  }
  return filas.join("\n");
}

const comparacion = arg("comparar", "");
if (comparacion) {
  const [a, b] = comparacion.split(",");
  console.log(comparar(JSON.parse(readFileSync(a, "utf8")), JSON.parse(readFileSync(b, "utf8"))));
  process.exit(0);
}

// ───────────────────────── principal ─────────────────────────

// ───────────────────────── parte 2: no perder trabajo y seguridad ─────────────────────────

const hayLib = (n) => existsSync(join(PLUGIN, "lib", `${n}.mjs`));
const libCli = (n, args, cwd) => {
  try {
    return execFileSync(process.execPath, [join(PLUGIN, "lib", `${n}.mjs`), ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return String(e.stdout ?? "") + String(e.stderr ?? "");
  }
};

/**
 * Un paso de un subagente falso: pasa por la barrera (PreToolUse) y, si el plugin lo tiene, por el hook
 * que guarda la pila (PostToolUse). Devuelve la decisión de la barrera.
 */
async function pasoAgente(root, agent_id, agent_type, tool_name, tool_input, tool_response = {}) {
  const ev = { cwd: root, session_id: "bench2", agent_id, agent_type, tool_name, tool_input };
  const pre = await hook("guardrails.mjs", "", ev);
  if (existsSync(join(PLUGIN, "hooks", "pilas.mjs"))) await hook("pilas.mjs", "", { ...ev, hook_event_name: "PostToolUse", tool_response });
  return pre;
}

/**
 * Retomar tras un corte. Un implementador lee 10 módulos, edita 2 y se corta (quedaban 2 ediciones y 2
 * pasadas de lint). Mientras tanto otra tarea cambia uno de los módulos leídos. El reemplazo:
 *  - sin pila (hoy): no sabe qué se hizo → relee los 10 módulos y los 2 editados, y sigue;
 *  - con pila: lee el mensaje de `pilas.mjs reenfundar` y relee solo lo que ese mensaje dice que cambió.
 * Se cuentan los pasos (herramientas) y las lecturas del reemplazo hasta volver al mismo punto y terminar.
 */
async function retomarTrasCorte(root) {
  const conPila = hayLib("pilas");
  const xs = [];
  const det = [];
  for (let i = 0; i < CORRIDAS; i++) {
    const A = `impl-a-${i}-${Date.now()}`;
    const B = `impl-b-${i}-${Date.now()}`;
    const mod = (k) => join(root, "api", "src", "modulos", `m${k}.mjs`);
    for (let k = 1; k <= 10; k++) await pasoAgente(root, A, "neurodanza:implementador", "Read", { file_path: mod(k) });
    for (const k of [1, 2]) {
      const nuevo = `export const modulo${k} = (x) => x * ${k} + ${i};\n`;
      writeFileSync(mod(k), nuevo);
      await pasoAgente(root, A, "neurodanza:implementador", "Edit", { file_path: mod(k), old_string: "x", new_string: nuevo });
    }
    // Otra tarea cambia un módulo que A ya había leído.
    writeFileSync(mod(7), `export const modulo7 = (x) => x * 7 + ${Date.now()};\n`);
    let pasos = 0;
    let lecturas = 0;
    const leer = async (f) => {
      pasos++;
      lecturas++;
      await pasoAgente(root, B, "neurodanza:implementador", "Read", { file_path: f });
    };
    if (conPila) {
      const msg = libCli("pilas", ["reenfundar", "--agente", A], root);
      // Relee solo lo que el mensaje marca como cambiado desde que se leyó.
      const cambiados = [...msg.matchAll(/^\s*- ([^\n]+?) \(cambió/gm)].map((m) => m[1].trim());
      for (const f of cambiados) await leer(join(root, f));
      det.push({ mensajeLineas: msg.split("\n").length, releidos: cambiados });
    } else {
      for (let k = 1; k <= 10; k++) await leer(mod(k));
      for (const k of [1, 2]) await leer(mod(k));
      det.push({ releidos: "todo" });
    }
    // Lo que faltaba: 2 ediciones y 2 pasadas de lint.
    for (const k of [3, 4]) {
      pasos++;
      await pasoAgente(root, B, "neurodanza:implementador", "Edit", { file_path: mod(k), old_string: "x", new_string: "x" });
    }
    for (let k = 0; k < 2; k++) {
      pasos++;
      await pasoAgente(root, B, "neurodanza:implementador", "Bash", { command: "node ../herramientas/tarea.mjs --nombre lint --ms 1", timeout: 60000 }, { stdout: "lint: ok" });
    }
    xs.push(pasos);
    det[det.length - 1] = { ...det[det.length - 1], pasos, lecturas };
    log(`retomar_tras_corte #${i + 1} (${conPila ? "con pila" : "sin pila"}): ${pasos} pasos · ${lecturas} lecturas`);
  }
  return { valor: mediana(xs), unidad: "pasos", lecturas: mediana(det.map((d) => d.lecturas)), modo: conPila ? "con pila" : "sin pila", corridas: xs, detalle: det };
}

/** Líneas cambiadas de un worktree contra su base (lo que llegaría al repo). */
function lineasDiff(wt, base) {
  try {
    execFileSync("git", ["add", "-A"], { cwd: wt, stdio: "ignore" });
    const out = execFileSync("git", ["diff", "--cached", "--numstat", base], { cwd: wt, encoding: "utf8" });
    return out.split("\n").filter(Boolean).reduce((n, l) => n + l.split("\t").slice(0, 2).reduce((a, x) => a + (Number(x) || 0), 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Reintento fallido (simulado). Intento 1: el implementador escribe un módulo con un diseño equivocado
 * (40 líneas, 12 pasos) y un revisor lo reprueba con un hallazgo alto de diseño.
 *  - Corregir encima (hoy): agrega la corrección sobre lo que había (25 líneas más, 8 pasos); quedan
 *    restos del primer diseño en el diff.
 *  - Rebobinar con memoria (si el plugin tiene `director.mjs decidir`/`rebobinar`): el worktree vuelve a
 *    la foto original y el intento 2, sabiendo qué falló, escribe el diseño correcto (30 líneas, 9 pasos).
 * Se miden las líneas del diff final (git real) y los pasos totales.
 */
async function reintentoFallido(root) {
  const director = (args) => libCli("director", args, root);
  const conRebobinar = /rebobinar/.test(readFileSync(join(PLUGIN, "lib", "director.mjs"), "utf8"));
  const xs = [];
  const det = [];
  const escribir = (wt, nombre, lineas, marca) => writeFileSync(join(wt, "src", nombre), Array.from({ length: lineas }, (_, k) => `export const ${marca}${k} = ${k};`).join("\n") + "\n");
  for (let i = 0; i < CORRIDAS; i++) {
    const tarea = `pedidos-${i}-${Date.now() % 100000}`;
    const prep = JSON.parse(director(["preparar", "--tarea", tarea, "--repos", "api", "--archivos", "api:src/**", "--objetivo", "módulo de pedidos"]));
    let wt = prep.repos[0].ruta;
    const base = JSON.parse(readFileSync(join(root, ".neurodanza", "director", "tareas", `${tarea}.json`), "utf8")).repos[0].base;
    let pasos = 12;
    escribir(wt, "pedidos.mjs", 40, "malo");
    let decision = "corregir";
    if (conRebobinar) {
      const hall = join(root, `hallazgos-${i}.json`);
      writeFileSync(hall, JSON.stringify([{ gravedad: "alta", archivo: "api/src/pedidos.mjs", problema: "el diseño mezcla la consulta con la vista", diseno: true }]));
      decision = JSON.parse(director(["decidir", "--tarea", tarea, "--hallazgos", hall])).decision;
    }
    if (decision === "rebobinar") {
      const mem = join(root, `memoria-${i}.json`);
      writeFileSync(mem, JSON.stringify({ motivo: "diseño equivocado", hallazgos: [{ gravedad: "alta", problema: "el diseño mezcla la consulta con la vista", constructo: "implementador" }] }));
      const r = JSON.parse(director(["rebobinar", "--tarea", tarea, "--memoria", mem]));
      wt = r.repos[0].ruta;
      escribir(wt, "pedidos.mjs", 30, "bueno");
      pasos += 9;
    } else {
      // Encima: agrega la capa corregida; el primer diseño queda en parte.
      const viejo = readFileSync(join(wt, "src", "pedidos.mjs"), "utf8");
      writeFileSync(join(wt, "src", "pedidos.mjs"), viejo + Array.from({ length: 25 }, (_, k) => `export const arreglo${k} = ${k};`).join("\n") + "\n");
      pasos += 8;
    }
    const lineas = lineasDiff(wt, base);
    director(["descartar", "--tarea", tarea]);
    xs.push(lineas);
    det.push({ decision, lineas, pasos });
    log(`reintento_fallido #${i + 1} (${decision}): diff final ${lineas} líneas · ${pasos} pasos`);
  }
  return { valor: mediana(xs), unidad: "líneas", pasos: mediana(det.map((d) => d.pasos)), modo: det[0].decision, corridas: xs, detalle: det, modelo: "intento 1: 40 líneas, 12 pasos; encima: +25 líneas, 8 pasos; rebobinar: 30 líneas, 9 pasos" };
}

/** 200 eventos con acciones de cada figura (de distintos tipos de agente): permitidos, rechazados, preguntados y latencia. */
async function bloqueosSeguridad(root) {
  const f = (p) => join(root, p);
  const casos = [
    ["leer", "Read", { file_path: f("api/src/index.mjs") }],
    ["leer", "Bash", { command: "git status && git diff --stat" }],
    ["leer", "Grep", { pattern: "modulo" }],
    ["editar", "Edit", { file_path: f("api/src/index.mjs"), old_string: "a", new_string: "b" }],
    ["editar", "Bash", { command: "sed -i 's/a/b/' api/src/index.mjs" }],
    ["verificar", "Bash", { command: "npx vitest run src/index.test.mjs", timeout: 60000 }],
    ["verificar", "Bash", { command: "npx eslint src/index.mjs" }],
    ["externo", "Bash", { command: "npm install left-pad" }],
    ["externo", "Bash", { command: "curl https://example.com/datos" }],
    ["externo", "Bash", { command: "git push origin main" }],
    ["destructivo", "Bash", { command: "rm -rf api/src" }],
    ["destructivo", "Bash", { command: "git reset --hard HEAD~3" }],
    ["destructivo", "Bash", { command: 'bash -c "git clean -fdx"' }],
  ];
  const tipos = [
    ["neurodanza:revisor-ui", "rev"],
    ["neurodanza:implementador", "impl"],
    [null, "principal"],
  ];
  const xs = [];
  let ultimo;
  for (let i = 0; i < CORRIDAS; i++) {
    for (const p of ["agentes", "figuras.json"]) rmSync(join(root, ".neurodanza", p), { recursive: true, force: true });
    const cuenta = { permite: 0, rechaza: 0, pregunta: 0 };
    const porFigura = {};
    let total = 0;
    for (let k = 0; k < 200; k++) {
      const [figura, tool_name, tool_input] = casos[k % casos.length];
      const [tipo, pref] = tipos[Math.floor(k / casos.length) % tipos.length];
      // Un agente por tipo y acción (≤ 39 por corrida, como en un ciclo real): cada uno repite siempre la
      // misma acción, así una cuarentena no cambia la categoría de su decisión.
      // Un id nuevo cada 39 eventos (~5 s): ningún agente llega al tope de tiempo del proyecto de prueba (20 s)
      // ni junta rechazos para la cuarentena; así se mide la decisión de seguridad sola.
      const ev = { cwd: root, session_id: "seg", tool_name, tool_input, ...(tipo ? { agent_id: `${pref}-${i}-${Math.floor(k / (casos.length * tipos.length))}-${k % casos.length}`, agent_type: tipo } : {}) };
      const r = await hook("guardrails.mjs", "", ev);
      total += r.ms;
      let d = "permite";
      if (r.code === 2) d = "rechaza";
      else if (/"permissionDecision"\s*:\s*"ask"/.test(r.salida)) d = "pregunta";
      else if (/"permissionDecision"\s*:\s*"deny"/.test(r.salida)) d = "rechaza";
      cuenta[d]++;
      const clave = `${figura} · ${pref}`;
      porFigura[clave] ??= { permite: 0, rechaza: 0, pregunta: 0 };
      porFigura[clave][d]++;
    }
    xs.push(total / 200);
    ultimo = { cuenta, porFigura };
    log(`bloqueos_seguridad #${i + 1}: permite ${cuenta.permite} · rechaza ${cuenta.rechaza} · pregunta ${cuenta.pregunta} · ${(total / 200).toFixed(1)} ms`);
  }
  return { valor: mediana(xs), unidad: "ms", ...ultimo.cuenta, porFigura: ultimo.porFigura, corridas: xs };
}

// ───────────────────────── parte 3: panel, exploración y ciclo total ─────────────────────────

// Costo simulado de pensar cada paso (herramienta) de un agente. Es igual en base y final: lo que cambia es
// cuántos pasos se dan y qué corre en paralelo.
const PASO_MS = Number(arg("paso-ms", "300"));
const libMod = async (n) => (hayLib(n) ? import(pathToFileURL(join(PLUGIN, "lib", `${n}.mjs`)).href) : null);
const configDe = async (root) => (await import(pathToFileURL(join(PLUGIN, "lib", "config.mjs")).href)).loadConfig(root);
const pensar = (n = 1) => sleep(PASO_MS * n);

/**
 * Navegador falso sobre la app simulada (HTTP). Implementa la interfaz que `lib/recorridos.mjs` espera de un
 * navegador (la misma que el panel cumple con Playwright): ir, click, elegir, llenar, tecla, esperar, cumple, errores.
 */
function navegadorHttp(web) {
  let actual = { url: "", html: "" };
  const errores = [];
  const enlaces = () => [...actual.html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => ({ href: m[1], texto: m[2] }));
  const ir = async (ruta) => {
    const r = await fetch(web + ruta);
    actual = { url: ruta, html: await r.text() };
    if (r.status >= 400) errores.push(`HTTP ${r.status} ${ruta}`);
  };
  const texto = () => actual.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return {
    enlaces,
    url: () => actual.url,
    ir,
    async click(nombre) {
      const e = enlaces().find((x) => x.texto === nombre);
      if (!e) throw new Error(`no encontré «${nombre}»`);
      await ir(e.href);
    },
    async elegir(combo, opcion) {
      if (!new RegExp(`<label>${combo}<select[^>]*>[\\s\\S]*?<option>${opcion}</option>`, "i").test(actual.html)) throw new Error(`no encontré la lista «${combo}» con «${opcion}»`);
    },
    async llenar(etiqueta) {
      if (!actual.html.includes(`<label>${etiqueta}<input`)) throw new Error(`no encontré el campo «${etiqueta}»`);
    },
    async tecla() {},
    async esperar(ms) {
      await sleep(Number(ms) || 0);
    },
    async cumple(espera = {}) {
      if (espera.url) return { ok: actual.url.startsWith(espera.url), encontrado: actual.url };
      const t = espera.texto ?? espera.mensaje ?? espera.elemento;
      if (!t) return { ok: true, encontrado: "" };
      const ok = texto().includes(t);
      return { ok, encontrado: ok ? t : texto().slice(0, 80) };
    },
    errores: () => [...errores],
  };
}

/** La app simulada en su versión (v1|v2), en un puerto propio. */
async function levantarUx(root, version, puerto) {
  const p = spawn(process.execPath, [join(root, "servidor.mjs")], { cwd: root, env: { ...process.env, BENCH_UX: version, BENCH_PUERTO: String(puerto) }, windowsHide: true, stdio: "ignore" });
  const web = `http://localhost:${puerto}`;
  for (let t0 = Date.now(); Date.now() - t0 < 5000; await sleep(100)) {
    try {
      if ((await fetch(`${web}/login`, { signal: AbortSignal.timeout(500) })).ok) return { p, web };
    } catch {
      /* todavía no */
    }
  }
  return { p, web };
}

// Recorrido de la tarea «exportar pedidos» en cada versión de la app (mismo id: es el mismo recorrido).
const RECORRIDO_UX = {
  v1: {
    id: "exportar-pedidos",
    persona: "ana",
    tarea: "Exportar los pedidos a CSV",
    maxClics: 4,
    maxSegundos: 60,
    pasos: [
      { ruta: "/pedidos", espera: { texto: "Pedidos" }, porQue: "Es donde empiezo cada mañana" },
      { click: "Exportar", espera: { url: "/pedidos/exportar" }, porQue: "Necesito el archivo para contabilidad", critico: true },
      { elegir: "Formato", opcion: "CSV", espera: { elemento: "Descargar" }, porQue: "Contabilidad solo acepta CSV" },
      { click: "Descargar", espera: { texto: "Exportación lista" }, porQue: "Sin el archivo no cierro el día", critico: true },
    ],
  },
  v2: {
    id: "exportar-pedidos",
    persona: "ana",
    tarea: "Exportar los pedidos a CSV",
    maxClics: 4,
    maxSegundos: 60,
    pasos: [
      { ruta: "/pedidos", espera: { texto: "Pedidos" }, porQue: "Es donde empiezo cada mañana" },
      { click: "Más acciones", espera: { texto: "Acciones" }, porQue: "Busco cómo exportar" },
      { click: "Opciones de exportación", espera: { texto: "Opciones de exportación" }, porQue: "Busco cómo exportar" },
      { click: "Exportar", espera: { url: "/pedidos/exportar" }, porQue: "Necesito el archivo para contabilidad", critico: true },
      { elegir: "Formato", opcion: "CSV", espera: { elemento: "Descargar" }, porQue: "Contabilidad solo acepta CSV" },
      { click: "Descargar", espera: { texto: "Exportación lista" }, porQue: "Sin el archivo no cierro el día", critico: true },
    ],
  },
};

/**
 * Una persona falsa evalúa «exportar pedidos» (ruta del diff: /pedidos).
 *  - Sin guion (hoy): recorrido sistemático de agents/persona-evaluadora.md: en cada pantalla, una llamada a
 *    `navegar`, mirar la captura y probar cada control; sigue por todo lo que alcanza desde las rutas del diff,
 *    hasta su presupuesto de pasos.
 *  - Con recorrido (si el plugin tiene lib/recorridos.mjs): una llamada a `navegar --recorrido` (lo ejecuta
 *    entero), leer su informe y la exploración libre acotada a `panel.exploracionPasos`, solo en pantallas del diff.
 * Más 6 mensajes en la ventana en vivo en ambos casos. Cada paso de la persona cuesta PASO_MS.
 */
async function personaFalsa(root, web, { maxPasos = 40, rutasDiff = ["/pedidos"] } = {}) {
  const rec = await libMod("recorridos");
  const cfg = await configDe(root);
  const nav = navegadorHttp(web);
  let pasos = 0;
  const paso = async (fn) => {
    pasos++;
    await pensar();
    if (fn) await fn();
  };
  let verificada = false;
  const MENSAJES = 6;
  if (rec?.ejecutarRecorrido) {
    let ej;
    await paso(async () => {
      ej = await rec.ejecutarRecorrido(nav, RECORRIDO_UX.v1);
    });
    await paso(); // leer el informe del recorrido
    verificada = ej.totales.cumplidos === RECORRIDO_UX.v1.pasos.length;
    const tope = cfg?.panel?.exploracionPasos ?? 10;
    const vistas = new Set();
    const cola = [...rutasDiff];
    let libres = 0;
    while (cola.length && libres < tope) {
      const r = cola.shift();
      if (vistas.has(r)) continue;
      vistas.add(r);
      libres++;
      await paso(() => nav.ir(r));
      for (const e of nav.enlaces()) if (rutasDiff.some((d) => e.href.startsWith(d)) && !vistas.has(e.href)) cola.push(e.href);
    }
  } else {
    const vistas = new Set();
    const cola = [...rutasDiff];
    while (cola.length && pasos < maxPasos - MENSAJES) {
      const r = cola.shift();
      if (vistas.has(r)) continue;
      vistas.add(r);
      await paso(() => nav.ir(r)); // navegar
      await paso(); // mirar la captura
      for (const e of nav.enlaces()) {
        if (pasos >= maxPasos - MENSAJES) break;
        await paso(); // probar el control
        if (!vistas.has(e.href)) cola.push(e.href);
      }
      if (r === "/pedidos/listo") verificada = true;
    }
  }
  for (let i = 0; i < MENSAJES; i++) await paso();
  return { pasos, verificada, modo: rec?.ejecutarRecorrido ? "con recorrido" : "sin guion" };
}

async function panelPasos(root) {
  const app = await levantarUx(root, "v1", 47614);
  const xs = [];
  const det = [];
  try {
    for (let i = 0; i < CORRIDAS; i++) {
      const t0 = Date.now();
      const r = await personaFalsa(root, app.web);
      const s = (Date.now() - t0) / 1000;
      xs.push(r.pasos);
      det.push({ ...r, segundos: s });
      log(`panel_pasos #${i + 1} (${r.modo}): ${r.pasos} pasos · ${s.toFixed(1)} s · tarea verificada: ${r.verificada ? "sí" : "no"}`);
    }
  } finally {
    app.p.kill();
  }
  return { valor: mediana(xs), unidad: "pasos", segundos: mediana(det.map((d) => d.segundos)), verificada: det.every((d) => d.verificada), modo: det[0].modo, corridas: xs, detalle: det, modelo: `cada paso de la persona: ${PASO_MS} ms; 6 mensajes en la ventana` };
}

/**
 * Regresión de experiencia: la persona hace «exportar pedidos» en la v1 (queda en la memoria del recorrido como
 * aprobada) y luego en la v2, que pide 2 clics más. ¿El harness lo marca? Sin memoria por recorrido: no.
 */
async function regresionUx(root) {
  const rec = await libMod("recorridos");
  const cfg = await configDe(root);
  const det = [];
  for (let i = 0; i < CORRIDAS; i++) {
    if (!rec?.compararMemoria) {
      det.push({ detectada: false, motivo: "sin memoria por recorrido" });
      log(`regresion_ux #${i + 1}: no detectada (sin memoria por recorrido)`);
      continue;
    }
    rmSync(cfg.abs(cfg.panel.memoria), { recursive: true, force: true });
    const ej = {};
    for (const [k, version, puerto] of [
      ["v1", "1.0.0", 47615],
      ["v2", "2.0.0", 47616],
    ]) {
      const app = await levantarUx(root, k, puerto);
      try {
        ej[k] = await rec.ejecutarRecorrido(navegadorHttp(app.web), RECORRIDO_UX[k]);
      } finally {
        app.p.kill();
      }
      const cmp = k === "v2" ? rec.compararMemoria(cfg, RECORRIDO_UX[k].id, ej[k]) : null;
      rec.registrarMemoria(cfg, RECORRIDO_UX[k], ej[k], { version, persona: "ana", aprobado: k === "v1" });
      if (cmp) {
        const r = { detectada: cmp.regresiones.length > 0, regresiones: cmp.regresiones.map((x) => x.texto), clics: [ej.v1.totales.clics, ej.v2.totales.clics] };
        det.push(r);
        log(`regresion_ux #${i + 1}: ${r.detectada ? "detectada" : "no detectada"} · clics ${r.clics.join(" → ")} · ${r.regresiones.join(" | ")}`);
      }
    }
  }
  const detectadas = det.filter((d) => d.detectada).length;
  return { valor: detectadas, unidad: `de ${CORRIDAS} detectadas`, texto: `${detectadas} de ${CORRIDAS} detectadas${det[0]?.clics ? ` (clics ${det[0].clics.join(" → ")})` : ""}`, detalle: det };
}

// Repo generado estilo NestJS + Next: por entidad, controlador, servicio, DTO, entidad, módulo, migración, prueba,
// dos pantallas y un componente, con referencias cruzadas entre entidades.
const ENTIDADES = ["pedidos", "clientes", "productos", "facturas", "pagos", "envios", "proveedores", "inventario", "usuarios", "roles", "empresas", "sucursales", "bodegas", "compras", "ventas", "cotizaciones", "devoluciones", "notas", "impuestos", "monedas", "categorias", "marcas", "descuentos", "promociones", "reportes", "auditoria", "tareas", "eventos", "contratos", "cuentas"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function generarRepoGrande(dir, nEnt = 30, copias = 1) {
  const w = (rel, s) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), s);
  };
  const ents = [];
  for (let c = 0; c < copias; c++) for (const e of ENTIDADES.slice(0, nEnt)) ents.push(c ? `${e}${c}` : e);
  ents.forEach((e, i) => {
    const E = cap(e);
    const otra = ents[(i + 1) % ents.length];
    const otra2 = ents[(i + 7) % ents.length];
    w(`backend/src/${e}/${e}.controller.ts`, `import { Body, Controller, Get, Param, Post } from "@nestjs/common";\nimport { ${E}Service } from "./${e}.service";\nimport { Crear${E}Dto } from "./dto/crear-${e}.dto";\n\n@Controller("${e}")\nexport class ${E}Controller {\n  constructor(private readonly servicio: ${E}Service) {}\n  @Get()\n  listar() { return this.servicio.listar(); }\n  @Get(":id")\n  uno(@Param("id") id: string) { return this.servicio.uno(id); }\n  @Post()\n  crear(@Body() dto: Crear${E}Dto) { return this.servicio.crear(dto); }\n}\n`);
    w(`backend/src/${e}/${e}.service.ts`, `import { Injectable } from "@nestjs/common";\nimport { ${E} } from "./${e}.entity";\nimport { ${cap(otra)}Service } from "../${otra}/${otra}.service";\n\n// Usa ${otra} y ${otra2} para validar.\n@Injectable()\nexport class ${E}Service {\n  listar(): ${E}[] { return []; }\n  uno(id: string) { return { id }; }\n  crear(dto: unknown) { return dto; }\n}\n`);
    w(`backend/src/${e}/dto/crear-${e}.dto.ts`, `export class Crear${E}Dto {\n  nombre!: string;\n  total?: number;\n}\n`);
    w(`backend/src/${e}/${e}.entity.ts`, `import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";\n\n@Entity("${e}")\nexport class ${E} {\n  @PrimaryGeneratedColumn("uuid") id!: string;\n  @Column() nombre!: string;\n}\n`);
    w(`backend/src/${e}/${e}.module.ts`, `import { Module } from "@nestjs/common";\nimport { ${E}Controller } from "./${e}.controller";\nimport { ${E}Service } from "./${e}.service";\n\n@Module({ controllers: [${E}Controller], providers: [${E}Service] })\nexport class ${E}Module {}\n`);
    w(`backend/src/migrations/17000000${String(i).padStart(4, "0")}-crear-${e}.ts`, `export class Crear${E}17000000${i} {\n  async up(q: any) { await q.query("CREATE TABLE ${e} (id uuid primary key)"); }\n}\n`);
    w(`backend/test/${e}.spec.ts`, `import { ${E}Service } from "../src/${e}/${e}.service";\n\ndescribe("${E}Service", () => { it("lista", () => expect(new ${E}Service().listar()).toEqual([])); });\n`);
    w(`frontend/app/${e}/page.tsx`, `import { Tabla${E} } from "../../components/${e}/tabla-${e}";\n\nexport default function Pagina${E}() { return <Tabla${E} />; }\n`);
    w(`frontend/app/${e}/nuevo/page.tsx`, `export default function Nuevo${E}() { return <form><label>Nombre<input /></label><button>Guardar</button></form>; }\n`);
    w(`frontend/components/${e}/tabla-${e}.tsx`, `export function Tabla${E}() { return <table><caption>${E} (ver también ${otra2})</caption></table>; }\n`);
  });
  w("frontend/lib/api.ts", `export const rutas = ${JSON.stringify(ents)};\n`);
  w("backend/README.md", `# backend\n\nMódulos: ${ents.join(", ")}.\n`);
  return ents.length;
}

function armarGrande(root, nEnt, copias, nombre = "grande") {
  const dir = join(root, nombre);
  rmSync(dir, { recursive: true, force: true });
  generarRepoGrande(dir, nEnt, copias);
  writeFileSync(join(dir, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "grande", ruta: "." }] }, null, 2));
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "bench@localhost");
  g("config", "user.name", "bench");
  g("config", "core.autocrlf", "false");
  g("add", ".");
  g("commit", "-qm", "inicio");
  return dir;
}

function archivosDe(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === ".neurodanza") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...archivosDe(dir, r));
    else out.push(r);
  }
  return out;
}

// Tarea: «agregar el campo descuento al crear pedidos (API y pantalla)». Archivos que hay que tocar:
const OBJETIVO_TAREA = ["backend/src/pedidos/dto/crear-pedidos.dto.ts", "backend/src/pedidos/pedidos.entity.ts", "backend/src/pedidos/pedidos.service.ts", "frontend/app/pedidos/nuevo/page.tsx"];

/**
 * Cuántas lecturas y búsquedas hace un implementador falso para ubicar los archivos de la tarea.
 *  - Sin índice: Glob del tema, Grep del tema y Read de cada archivo que coincide (para decidir si es suyo).
 *  - Con índice (lib/indice.mjs): el contrato trae `indice.mjs resumen --foco pedidos`; lee solo los archivos
 *    que ese resumen marca como probables.
 */
function explorarTarea(dir, conIndice) {
  if (conIndice) {
    const out = libCli("indice", ["resumen", "--repo", "grande", "--foco", "pedidos"], dir);
    const leidos = [...new Set([...out.matchAll(/^\s*[-·]\s*([\w./[\]-]+\.(?:tsx?|jsx?|mjs))\b/gm)].map((m) => m[1]))];
    return { lecturas: leidos.length, busquedas: 0, encontro: OBJETIVO_TAREA.every((f) => leidos.includes(f)), leidos };
  }
  const todos = archivosDe(dir);
  const porNombre = todos.filter((f) => f.includes("pedido"));
  const porTexto = todos.filter((f) => readFileSync(join(dir, f), "utf8").includes("pedidos"));
  const leidos = [...new Set([...porNombre, ...porTexto])];
  return { lecturas: leidos.length, busquedas: 2, encontro: OBJETIVO_TAREA.every((f) => leidos.includes(f)), leidos };
}

async function exploracionImplementador(root) {
  const conIndice = hayLib("indice");
  const dir = armarGrande(root, 30, 1);
  const xs = [];
  const det = [];
  for (let i = 0; i < CORRIDAS; i++) {
    rmSync(join(dir, ".neurodanza"), { recursive: true, force: true });
    const r = explorarTarea(dir, conIndice);
    xs.push(r.lecturas + r.busquedas);
    det.push({ lecturas: r.lecturas, busquedas: r.busquedas, encontro: r.encontro });
    log(`exploracion_implementador #${i + 1} (${conIndice ? "con índice" : "sin índice"}): ${r.lecturas} lecturas · ${r.busquedas} búsquedas · encontró todo: ${r.encontro ? "sí" : "no"}`);
  }
  // Tiempo de generar el índice en frío y en caché: proyecto de prueba, repo mediano (30 entidades) y grande (300).
  let indice = null;
  if (conIndice) {
    const medir = (cwd) => {
      const ys = [];
      for (let i = 0; i < 3; i++) {
        rmSync(join(cwd, ".neurodanza", "indice"), { recursive: true, force: true });
        const t0 = Date.now();
        libCli("indice", ["generar"], cwd);
        ys.push(Date.now() - t0);
      }
      const t1 = Date.now();
      libCli("indice", ["generar"], cwd);
      return { frioMs: mediana(ys), cacheMs: Date.now() - t1 };
    };
    const grande = armarGrande(root, 30, 10, "grande10");
    indice = { fixture: medir(root), mediano: { archivos: archivosDe(dir).length, ...medir(dir) }, grande: { archivos: archivosDe(grande).length, ...medir(grande) } };
    rmSync(grande, { recursive: true, force: true });
    log(`indice: fixture ${indice.fixture.frioMs} ms · mediano (${indice.mediano.archivos} archivos) ${indice.mediano.frioMs} ms, en caché ${indice.mediano.cacheMs} ms · grande (${indice.grande.archivos}) ${indice.grande.frioMs} ms`);
  }
  return { valor: mediana(xs), unidad: "lecturas y búsquedas", texto: `${mediana(xs)} (${mediana(det.map((d) => d.lecturas))} lecturas · ${det[0].busquedas} búsquedas)`, encontro: det.every((d) => d.encontro), modo: conIndice ? "con índice" : "sin índice", indice, corridas: xs, detalle: det };
}

/**
 * El ciclo simulado completo, tal como lo indica el skill del plugin medido:
 *  1. especialistas (si hay lib/hotel.mjs): 2 en paralelo, 8 pasos cada uno, antes de delegar;
 *  2. implementar: un implementador da (exploración de la tarea + 6 ediciones + 2 verificaciones) pasos;
 *  3. verificar: el hook Stop real del plugin sobre el proyecto de prueba;
 *  4. revisión + panel + fantasmas: 4 revisores × 12 pasos, 3 personas × los pasos de `panel_pasos` y, si hay
 *     lib/fantasmas.mjs, 2 fantasmas × 10 pasos; en el mismo turno si el skill lo dice, si no uno tras otro.
 * Cada paso de un agente cuesta PASO_MS. Mide el orden y la cantidad de pasos que fija el harness, no un modelo.
 */
async function stopYCicloTotal(root) {
  const hotel = hayLib("hotel");
  const fantasmas = hayLib("fantasmas");
  const paralelo = skillParalelo();
  const dir = armarGrande(root, 30, 1);
  const explora = explorarTarea(dir, hayLib("indice"));
  const app = await levantarUx(root, "v1", 47617);
  const persona = await personaFalsa(root, app.web);
  app.p.kill();
  const pasosImpl = explora.lecturas + explora.busquedas + 6 + 2;
  const xs = [];
  const det = [];
  for (let i = 0; i < CORRIDAS; i++) {
    const t = {};
    const t0 = Date.now();
    let tt = Date.now();
    if (hotel) await Promise.all([dormir(8 * PASO_MS), dormir(8 * PASO_MS)]);
    t.especialistas = (Date.now() - tt) / 1000;
    tt = Date.now();
    await dormir(pasosImpl * PASO_MS);
    t.implementar = (Date.now() - tt) / 1000;
    tt = Date.now();
    cambiar(root);
    await hook("feedback.mjs", "stop", { cwd: root, session_id: `ciclo-${i}-${Date.now()}` });
    limpiarFondo(root);
    t.verificar = (Date.now() - tt) / 1000;
    tt = Date.now();
    const REV = Array(4).fill(12 * PASO_MS);
    const PER = Array(3).fill(persona.pasos * PASO_MS);
    const FAN = fantasmas ? Array(2).fill(10 * PASO_MS) : [];
    if (paralelo) await Promise.all([...REV, ...PER, ...FAN].map(dormir));
    else {
      await Promise.all(REV.map(dormir));
      await Promise.all([...PER, ...FAN].map(dormir));
    }
    t.revisionPanel = (Date.now() - tt) / 1000;
    const s = (Date.now() - t0) / 1000;
    xs.push(s);
    det.push(t);
    log(`stop_y_ciclo_total #${i + 1}: ${s.toFixed(1)} s · especialistas ${t.especialistas.toFixed(1)} · implementar ${t.implementar.toFixed(1)} · verificar ${t.verificar.toFixed(1)} · revisión y panel ${t.revisionPanel.toFixed(1)}`);
  }
  const fase = (k) => mediana(det.map((d) => d[k]));
  return { valor: mediana(xs), unidad: "s", corridas: xs, fases: { especialistas: fase("especialistas"), implementar: fase("implementar"), verificar: fase("verificar"), revisionPanel: fase("revisionPanel") }, modelo: { pasoMs: PASO_MS, pasosImplementador: pasosImpl, pasosPersona: persona.pasos, especialistas: hotel, fantasmas, orden: paralelo ? "revisión, panel y fantasmas en el mismo turno" : "revisores, después panel" } };
}

// ───────────────────────── parte 4: ODD, CLI de la app y comentarios ─────────────────────────

/** Proyecto de prueba aparte para una métrica: copia del fixture con git y la configuración ajustada. */
function proyectoCon(ajuste) {
  const r = armarProyecto();
  const f = join(r, "neurodanza.config.json");
  const c = JSON.parse(readFileSync(f, "utf8"));
  ajuste(c, r);
  writeFileSync(f, JSON.stringify(c, null, 2));
  return r;
}
const escribir = (root, rel, txt) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), txt);
};
const borrar = (root) => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows puede retener archivos */
  }
};

// Tres cambios de distinto riesgo sobre el proyecto de prueba (api y web).
const funcionesMedio = Array.from({ length: 12 }, (_, i) => `export function regla${i}(pedido) {\n  const total = pedido.items.reduce((s, x) => s + x.precio * x.cantidad, 0);\n  return total > ${100 + i} ? "revisar" : "ok";\n}\n`).join("");
const CAMBIOS_RIESGO = {
  chico: { "web/src/app.mjs": 'export const titulo = "Pedidos del día";\n' },
  medio: { "api/src/modulos/m3.mjs": funcionesMedio },
  alto: {
    "api/src/modulos/auth-guard.mjs": 'export function puede(usuario, accion) {\n  return usuario.rol === "ADMIN" || (usuario.permisos ?? []).includes(accion);\n}\n',
    "api/migraciones/002_roles.sql": "ALTER TABLE usuarios ADD COLUMN rol text NOT NULL DEFAULT 'VENDEDOR';\n",
    "web/src/app.mjs": 'export const titulo = "Pedidos";\nexport const soloAdmin = true;\n',
  },
};

/**
 * Lo que lanza el harness para cada cambio y cuántos pasos de agente cuesta (proxy de tokens). Sin
 * lib/riesgo.mjs, lo que fija el skill 1.0.0: los revisores de `ciclo.mjs revisores`, fantasmas si aplican,
 * 3 personas con su recorrido si hay pantallas y 2 especialistas en modo director (2 repos). Con riesgo, su plan.
 * Pasos: revisor 12, persona 14 + 8 del recorrido, fantasma 10, especialista 8 (los del banco de la parte 3).
 */
async function cicloPorRiesgo() {
  const det = {};
  let total = 0;
  for (const [nombre, archivos] of Object.entries(CAMBIOS_RIESGO)) {
    const root = proyectoCon((c) => {
      c.retroalimentacion = { ...(c.retroalimentacion ?? {}), pantallas: ["web:src/**"], migraciones: "api:migraciones/**" };
      c.repos[0].codigo = ["src/**", "migraciones/**"];
    });
    for (const [rel, txt] of Object.entries(archivos)) escribir(root, rel, txt);
    const salida = libCli("ciclo", ["revisores"], root);
    let j = {};
    try {
      j = JSON.parse(salida);
    } catch {
      // En la 1.0.0 `ciclo.mjs revisores` se colgaba (importación circular con fantasmas.mjs, salida 13): se
      // calcula lo mismo llamando a sus funciones, que es lo que el skill pretendía.
      log(`ciclo revisores no respondió JSON (${salida.trim().split("\n")[0].slice(0, 90)}): uso sus funciones`);
      const ciclo = await libMod("ciclo");
      const fan = await libMod("fantasmas");
      const cfg = await configDe(root);
      const cambios = ciclo.changesInBranch(cfg, "main");
      const leer = (repo, f) => readFileSync(join(root, repo, f), "utf8");
      j = { ...ciclo.revisoresPara(cfg, cambios), fantasmas: fan?.fantasmasPara ? fan.fantasmasPara(cfg, cambios, leer) : null, cliFalla: true };
    }
    const repos = new Set(Object.keys(archivos).map((f) => f.split("/")[0]));
    const pantallas = Object.keys(archivos).some((f) => f.startsWith("web/"));
    let plan;
    if (j.riesgo?.plan) plan = { nivel: j.riesgo.nivel, ...j.riesgo.plan };
    else plan = { nivel: "—", revisores: (j.lanzar ?? []).length, personas: pantallas ? 3 : 0, recorridos: pantallas, fantasmas: j.fantasmas?.lanzar ? 2 : 0, especialistas: repos.size >= 2 && hayLib("hotel") ? 2 : 0 };
    const pasos = plan.revisores * 12 + plan.personas * (14 + (plan.recorridos ? 8 : 0)) + plan.fantasmas * 10 + plan.especialistas * 8;
    const subagentes = plan.revisores + plan.personas + plan.fantasmas + plan.especialistas;
    det[nombre] = { ...plan, subagentes, pasos, ...(j.cliFalla ? { cliFalla: true } : {}) };
    total += pasos;
    log(`ciclo_por_riesgo ${nombre}: nivel ${plan.nivel} · ${subagentes} subagentes · ${pasos} pasos`);
    borrar(root);
  }
  return { valor: total, unidad: "pasos", detalle: det, texto: `chico ${det.chico.pasos} · medio ${det.medio.pasos} · alto ${det.alto.pasos} pasos (${total} en total)` };
}

const APP_CLI = join(PLUGIN, "lib", "app.mjs").replace(/\\/g, "/");
/**
 * Tareas repetitivas contra la app: a mano (lo que escribe un agente sin CLI: login, token y petición) y,
 * si el plugin trae lib/app.mjs, con la CLI. Mide los caracteres que escribe el agente y si la tarea funcionó.
 */
async function comandosApp() {
  const puerto = 47621;
  const root = proyectoCon((c) => {
    c.app = { ...(c.app ?? {}), urls: [`http://localhost:${puerto}`] };
    c.panel = { ...(c.panel ?? {}), elenco: ".claude/personas/personas.json", usuarios: { login: { url: "/api/auth/login", cuerpo: { email: "${ND_ADMIN_EMAIL:-admin@ejemplo.com}", password: "${ND_ADMIN_PASSWORD:-Clave123!}" }, token: "accessToken" }, email: "persona.{id}@ejemplo.com", clave: "${ND_PERSONA_PASSWORD:-Clave123!}" } };
  });
  escribir(root, ".claude/personas/personas.json", JSON.stringify({ personas: [{ id: "vendedor", nombre: "Vera", rol: "VENDEDOR" }] }));
  const app = await levantarUx(root, "v1", puerto);
  const b = app.web;
  const login = `const r=await fetch(b+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'persona.vendedor@ejemplo.com',password:'Clave123!'})});const {accessToken}=await r.json();`;
  const tareas = [
    {
      id: "listar-pedidos",
      mano: `node -e "const b='${b}';(async()=>{${login}const p=await fetch(b+'/api/pedidos',{headers:{Authorization:'Bearer '+accessToken}});console.log(p.status,(await p.text()).slice(0,500))})()"`,
      cli: `node "${APP_CLI}" api GET /api/pedidos --como vendedor`,
      ok: /200/,
    },
    {
      id: "crear-pedido",
      mano: `node -e "const b='${b}';(async()=>{${login}const p=await fetch(b+'/api/pedidos',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken},body:JSON.stringify({cliente:'Bruno'})});console.log(p.status,(await p.text()).slice(0,500))})()"`,
      cli: `node "${APP_CLI}" api POST /api/pedidos --como vendedor --cuerpo "{\\"cliente\\":\\"Bruno\\"}"`,
      ok: /201/,
    },
    {
      id: "verificar-api",
      mano: "cd api && node ../herramientas/tarea.mjs --nombre lint --ms 400 src/index.mjs && node ../herramientas/tarea.mjs --nombre tipos --ms 900 && node ../herramientas/tarea.mjs --nombre pruebas --ms 1000 src/index.mjs",
      cli: `node "${APP_CLI}" verificar --repo api --archivos src/index.mjs`,
      ok: /./,
    },
  ];
  const conCli = hayLib("app");
  const correr = (cmd) => {
    try {
      return { ok: true, out: execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }) };
    } catch (e) {
      return { ok: false, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
    }
  };
  const det = [];
  let chars = 0;
  for (const t of tareas) {
    const cmd = conCli ? t.cli : t.mano;
    const r = correr(cmd);
    const funciona = r.ok && t.ok.test(r.out);
    det.push({ tarea: t.id, caracteres: cmd.length, funciona, salida: r.out.trim().slice(0, 160) });
    chars += cmd.length;
    log(`comandos_app ${t.id}: ${cmd.length} caracteres · ${funciona ? "funciona" : "FALLA"}`);
  }
  app.p.kill();
  borrar(root);
  const funcionan = det.filter((d) => d.funciona).length;
  return { valor: chars, unidad: "caracteres", tokensEstimados: Math.round(chars / 4), funcionan, detalle: det, texto: `${chars} caracteres (≈ ${Math.round(chars / 4)} tokens) · ${funcionan} de ${det.length} funcionan` };
}

// Ediciones de código: comentarios que no deberían escribirse, permitidos, y código sin comentarios.
const EDICIONES_COMENTARIOS = {
  prohibidos: [
    "// Calcula el total del pedido\nconst total = suma(items);\n",
    "const iva = total * 0.15; // IVA de Ecuador\n",
    "/* Recorremos los items para validar */\nfor (const it of items) validar(it);\n",
    "function interna(x) {\n  // devolvemos el doble\n  return x * 2;\n}\n",
    "/**\n * Ayuda interna, no exportada.\n */\nfunction ayuda() {\n  return 1;\n}\n",
    "// Primero buscamos el usuario\nconst u = await buscar(id);\n// Luego validamos\nvalidar(u);\n",
    "if (!u) {\n  // no existe: error\n  throw new Error('No existe');\n}\n",
    "// Importamos lo necesario\nimport { a } from './a.mjs';\n",
    "export const x = 1; /* valor inicial */\n",
    "// Estado del formulario\nlet estado = 'inicial';\n",
    "// Este bloque maneja el envío\nasync function enviar() {\n  await guardar();\n}\n",
    "// Retorna la lista ordenada\nreturn lista.sort();\n",
  ],
  permitidos: [
    "// eslint-disable-next-line no-console\nconsole.log(x);\n",
    "/**\n * Total del pedido con impuestos.\n * @param {object} pedido\n */\nexport function totalDe(pedido) {\n  return pedido.total;\n}\n",
    "// POR QUÉ: el SRI rechaza montos con más de 2 decimales.\nconst monto = Math.round(v * 100) / 100;\n",
    "// @ts-expect-error la librería no trae tipos\nimport x from 'sin-tipos';\n",
  ],
  sinComentarios: ["const url = 'http://localhost:3000/api';\n", "const total = items.reduce((s, x) => s + x, 0);\n", 'export const titulo = "Pedidos // del día";\n', "const re = /\\/\\/ +x/;\n"],
};

/** Barrera de comentarios: cuántas ediciones con comentarios prohibidos se rechazan y cuántas buenas se dejan pasar. */
async function comentariosBarrera() {
  const root = proyectoCon((c) => {
    c.barreras = { ...(c.barreras ?? {}), comentarios: "estricto" };
  });
  let rechazadas = 0;
  let falsas = 0;
  const ms = [];
  let i = 0;
  const correr = async (txt) => {
    const r = await hook("guardrails.mjs", null, { cwd: root, session_id: "bench-com", tool_name: "Write", tool_input: { file_path: join(root, "api", "src", `nuevo${i++}.mjs`), content: txt } });
    ms.push(r.ms);
    return r.code === 2;
  };
  for (const t of EDICIONES_COMENTARIOS.prohibidos) if (await correr(t)) rechazadas++;
  for (const t of [...EDICIONES_COMENTARIOS.permitidos, ...EDICIONES_COMENTARIOS.sinComentarios]) if (await correr(t)) falsas++;
  borrar(root);
  const n = EDICIONES_COMENTARIOS.prohibidos.length;
  const buenas = EDICIONES_COMENTARIOS.permitidos.length + EDICIONES_COMENTARIOS.sinComentarios.length;
  const pct = Math.round((rechazadas / n) * 1000) / 10;
  log(`comentarios_barrera: ${rechazadas}/${n} rechazadas · ${falsas}/${buenas} falsos rechazos`);
  return { valor: pct, unidad: "%", rechazadas, prohibidas: n, falsosRechazos: falsas, buenas, ms: mediana(ms), texto: `${rechazadas} de ${n} rechazadas (${String(pct).replace(".", ",")} %) · ${falsas} de ${buenas} buenas rechazadas por error` };
}

const PEDIDO_TEXTUAL = 'Agregar un filtro por estado en la pantalla de pedidos. El botón debe decir «Filtrar por estado», si no hay resultados mostrar «No hay pedidos con ese estado» y si el estado no existe responder "Estado inválido".';
const FRASES_TEXTUALES = ["Filtrar por estado", "No hay pedidos con ese estado", "Estado inválido"];
/** ¿El contrato del implementador lleva las frases exactas del pedido? (el objetivo lo resume el director) */
async function pedidoTextual() {
  const root = proyectoCon(() => {});
  escribir(root, ".neurodanza/pedido.txt", PEDIDO_TEXTUAL);
  const extra = [];
  if (hayLib("funcionalidad")) {
    libCli("funcionalidad", ["crear", "--tema", "filtro-estado", "--pedido", join(root, ".neurodanza", "pedido.txt")], root);
    extra.push("--funcionalidad", "filtro-estado");
  }
  const salida = libCli("director", ["preparar", "--tarea", "filtro", "--repos", "web", "--archivos", "web:src/**", "--objetivo", "Filtro de pedidos por estado", "--terminado", "el filtro funciona", ...extra], root);
  const presentes = FRASES_TEXTUALES.filter((f) => salida.includes(f));
  libCli("director", ["descartar", "--tarea", "filtro"], root);
  borrar(root);
  log(`pedido_textual: ${presentes.length} de ${FRASES_TEXTUALES.length} frases en el contrato`);
  return { valor: presentes.length, unidad: "frases", de: FRASES_TEXTUALES.length, presentes, texto: `${presentes.length} de ${FRASES_TEXTUALES.length} frases exactas en el contrato` };
}

/**
 * Pruebas primero: dos implementaciones, una sin ver la prueba en rojo y otra con la prueba en rojo antes de
 * implementar. Cuenta las que el harness clasifica bien (avisa en la primera, registra el rojo en la segunda).
 */
async function pruebaPrimero() {
  const conLib = hayLib("pruebas");
  const resultados = {};
  for (const caso of ["sinRojo", "conRojo"]) {
    const root = proyectoCon((c) => {
      c.repos[0].relacionadas = "node --test {archivos}";
      c.ciclo = { ...(c.ciclo ?? {}), pruebaPrimero: "avisar" };
    });
    const prueba = 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { restar } from "./index.mjs";\ntest("restar", () => assert.equal(restar(5, 3), 2));\n';
    const impl = "export const sumar = (a, b) => a + b;\nexport const restar = (a, b) => a - b;\n";
    let registro = "";
    if (caso === "sinRojo") {
      escribir(root, "api/src/index.mjs", impl);
      escribir(root, "api/src/index.test.mjs", prueba);
    } else {
      escribir(root, "api/src/index.test.mjs", prueba);
      if (conLib) registro = libCli("pruebas", ["rojo", "--repo", "api", "--archivo", "src/index.test.mjs"], root);
      escribir(root, "api/src/index.mjs", impl);
    }
    const stop = await hook("feedback.mjs", "stop", { cwd: root, session_id: `pp-${caso}-${Date.now()}` });
    limpiarFondo(root);
    const aviso = /no se vio (la|una) prueba en rojo/i.test(stop.salida);
    resultados[caso] = caso === "sinRojo" ? aviso : !aviso && /rojo/i.test(registro);
    log(`prueba_primero ${caso}: ${resultados[caso] ? "bien" : "no"}${aviso ? " (avisó)" : ""}`);
    borrar(root);
  }
  const bien = Object.values(resultados).filter(Boolean).length;
  return { valor: bien, unidad: "casos", de: 2, detalle: resultados, texto: `${bien} de 2 bien clasificados` };
}

// ───────────────────────── parte 5: autoajuste ─────────────────────────

/**
 * Autoajuste: sesiones sembradas (bench/transcripts.mjs) con lo que un harness que se mide debería aprender.
 * Primero, como hoy, cada comando pasa por la barrera mientras se trabaja (lo que el plugin ve en vivo); después,
 * si el plugin tiene lib/autoajuste.mjs, la pasada diaria sobre los transcripts. Se cuenta:
 *  - aprendido (6): la lección del rechazo repetido, los 2 errores repetidos en el catálogo, la macro sugerida y
 *    las 2 propuestas (presupuesto del revisor y el lint del repo api);
 *  - falsos: propuestas o lecciones que no estaban sembradas (el ruido);
 *  - evaluación (2): tras aplicar el presupuesto, ¿mantiene si los cortes bajan y propone revertir si no?
 */
async function autoajusteMetrica() {
  const { escenarioAutoajuste, despuesDelAjuste, escribirTranscripts } = await import(pathToFileURL(join(AQUI, "transcripts.mjs")).href);
  const auto = hayLib("autoajuste") ? await import(pathToFileURL(join(PLUGIN, "lib", "autoajuste.mjs")).href) : null;
  const hoy = Date.now();
  const leer = (root, rel, d) => {
    try {
      return JSON.parse(readFileSync(join(root, rel), "utf8"));
    } catch {
      return d;
    }
  };
  const armar = async () => {
    const esc = escenarioAutoajuste(hoy);
    const root = proyectoCon((c) => {
      c.repos.find((r) => r.nombre === "api").lint = "npx eslint src";
    });
    const trans = join(root, ".transcripts");
    escribirTranscripts(trans, esc.sesiones);
    for (const s of esc.sesiones) for (const e of s.eventos) if (e.cmd !== undefined) await hook("guardrails.mjs", "", { cwd: root, session_id: s.sesion, tool_name: "Bash", tool_input: { command: e.cmd } });
    return { esc, root, trans };
  };
  const { esc, root, trans } = await armar();
  const t0 = Date.now();
  const inf = auto ? await auto.diario(await configDe(root), { carpetas: [trans], ahora: hoy }) : null;
  const ms = Date.now() - t0;
  const cons = leer(root, ".neurodanza/constructos/constructos.json", { constructos: {} });
  const leccion = (cons.constructos.principal?.lecciones ?? []).some((l) => /push directo a main/.test(l.texto) && l.estado !== "descartada");
  const errores = Object.values(leer(root, ".neurodanza/errores.json", { errores: {} }).errores ?? {});
  const erroresBien = ["unexpected EOF", "eslint"].filter((x) => errores.some((e) => String(e.ejemplo).includes(x))).length;
  const rep = leer(root, ".neurodanza/app/repetidos.json", { comandos: {} });
  const macro = Object.values(rep.comandos ?? {}).some((e) => e.veces >= 3 && /PrismaClient/.test(e.ejemplo));
  const ids = (inf?.propuestas ?? []).map((p) => p.id);
  const propBien = esc.esperado.propuestas.filter((p) => ids.includes(p)).length;
  const falsos = ids.filter((p) => !esc.esperado.propuestas.includes(p)).length + Object.keys(cons.constructos).filter((k) => !esc.esperado.lecciones.includes(k)).length + errores.filter((e) => !["unexpected EOF", "eslint"].some((x) => String(e.ejemplo).includes(x))).length;
  const aprendido = Number(leccion) + erroresBien + Number(macro) + propBien;
  borrar(root);
  // Evaluación de un ajuste aplicado: con y sin cortes después.
  let evalBien = 0;
  if (auto) {
    for (const cortes of [false, true]) {
      const x = await armar();
      await auto.diario(await configDe(x.root), { carpetas: [x.trans], ahora: hoy });
      try {
        auto.aplicar(await configDe(x.root), "presupuesto:revisor", { ahora: hoy - 2.5 * 86_400_000 });
        escribirTranscripts(x.trans, despuesDelAjuste(hoy, { cortes }));
        const i2 = await auto.diario(await configDe(x.root), { carpetas: [x.trans], ahora: hoy });
        const ev = i2.evaluaciones.find((e) => e.id === "presupuesto:revisor");
        if (ev?.decision === (cortes ? "revertir" : "mantener")) evalBien++;
      } catch (e) {
        log(`autoajuste evaluación: ${e.message}`);
      }
      borrar(x.root);
    }
  }
  const texto = `aprendido ${aprendido} de 6 · falsos ${falsos} · evaluación ${evalBien} de 2${auto ? ` · pasada ${ms} ms` : ""}`;
  log(`autoajuste: ${texto} (lección ${leccion ? "sí" : "no"}, errores ${erroresBien}/2, macro ${macro ? "sí" : "no"}, propuestas ${propBien}/2)`);
  return { valor: aprendido, unidad: "de 6", falsos, evaluacion: evalBien, ms: auto ? ms : null, detalle: { leccion, errores: erroresBien, macro, propuestas: ids }, texto };
}

/** Latencia del hook de inicio de sesión (SessionStart), N veces sobre el mismo proyecto. */
async function inicioMs(root) {
  const xs = [];
  for (let i = 0; i < Math.max(CORRIDAS, 5) * 4; i++) {
    const r = await hook("feedback.mjs", "inicio", { cwd: root, session_id: `ini-${i}` });
    xs.push(r.ms);
  }
  log(`inicio_ms: mediana ${mediana(xs).toFixed(1)} ms`);
  return { valor: mediana(xs), unidad: "ms", corridas: xs };
}

const METRICAS = { stop_normal: stopNormal, stop_colgado: stopColgado, guardrails_ms: guardrailsMs, subagente_congelado: subagenteCongelado, revision_y_panel: revisionYPanel, fallo_externo: falloExterno, retomar_tras_corte: retomarTrasCorte, reintento_fallido: reintentoFallido, bloqueos_seguridad: bloqueosSeguridad, panel_pasos: panelPasos, regresion_ux: regresionUx, exploracion_implementador: exploracionImplementador, stop_y_ciclo_total: stopYCicloTotal, ciclo_por_riesgo: cicloPorRiesgo, comandos_app: comandosApp, comentarios_barrera: comentariosBarrera, pedido_textual: pedidoTextual, prueba_primero: pruebaPrimero, autoajuste: autoajusteMetrica, inicio_ms: inicioMs };

const root = armarProyecto();
log(`proyecto de prueba: ${root} · plugin: ${PLUGIN} · ${CORRIDAS} corridas`);
const resultado = { fecha: new Date().toISOString(), plugin: PLUGIN, version: JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8")).version, plataforma: `${process.platform} ${process.arch}`, node: process.version, corridas: CORRIDAS, metricas: {} };
for (const [nombre, fn] of Object.entries(METRICAS)) {
  if (SOLO.length && !SOLO.includes(nombre)) continue;
  log(`── ${nombre}`);
  resultado.metricas[nombre] = await fn(root);
}
limpiarFondo(root);
const json = JSON.stringify(resultado, null, 2);
if (SALIDA) writeFileSync(resolve(SALIDA), json + "\n");
console.log(json);
try {
  rmSync(root, { recursive: true, force: true });
} catch {
  /* Windows puede retener archivos un momento */
}
