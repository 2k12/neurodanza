#!/usr/bin/env node
// neurodanza · banco de pruebas de velocidad (sin dependencias).
// Arma un proyecto de prueba (bench/fixture → carpeta temporal con dos repos git, api y web), corre los
// hooks del plugin indicado con --plugin y mide 6 métricas con N corridas (mediana). Ver bench/README.md.
//
//   node bench/bench.mjs [--plugin <carpeta del plugin>] [--salida bench/base.json] [--corridas 5] [--solo stop_normal,guardrails_ms]
//   node bench/bench.mjs --comparar bench/base.json,bench/parte1.json      tabla base vs. ahora (markdown)
import { execFileSync, execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const METRICAS = { stop_normal: stopNormal, stop_colgado: stopColgado, guardrails_ms: guardrailsMs, subagente_congelado: subagenteCongelado, revision_y_panel: revisionYPanel, fallo_externo: falloExterno, retomar_tras_corte: retomarTrasCorte, reintento_fallido: reintentoFallido, bloqueos_seguridad: bloqueosSeguridad };

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
