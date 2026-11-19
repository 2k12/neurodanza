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
    const v = m.unidad === "ms" ? `${m.valor.toFixed(1)} ms` : `${m.valor.toFixed(1)} s`;
    return m.intentos !== undefined ? `${v} · ${m.intentos} intentos` : v;
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

const METRICAS = { stop_normal: stopNormal, stop_colgado: stopColgado, guardrails_ms: guardrailsMs, subagente_congelado: subagenteCongelado, revision_y_panel: revisionYPanel, fallo_externo: falloExterno };

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
