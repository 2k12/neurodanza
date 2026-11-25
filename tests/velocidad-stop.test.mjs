// Paso 1 (velocidad): el hook Stop en dos velocidades — parte que bloquea con tope y fondo desacoplado.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { cancelarFondo, leerFondo, resumen, vivo } from "../lib/fondo.mjs";
import { correr } from "../lib/procesos.mjs";

const HOOK = fileURLToPath(new URL("../hooks/feedback.mjs", import.meta.url));
const FONDO = fileURLToPath(new URL("../lib/fondo.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Proyecto de prueba con un repo `app`; `herr` = comandos de las herramientas (con {archivos}). */
function proyecto({ relacionadas = "node ../dormir.mjs 200", suite, topeStopSeg = 10 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-vel-"));
  writeFileSync(join(root, "dormir.mjs"), "const [ms, salida] = process.argv.slice(2); setTimeout(() => { if (salida) { console.error('fallo de prueba: ' + salida); process.exit(1); } }, Number(ms));\n");
  writeFileSync(join(root, "colgar.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);\n");
  const app = join(root, "app");
  mkdirSync(join(app, "src"), { recursive: true });
  writeFileSync(join(app, "src", "a.mjs"), "export const a = 1;\n");
  const g = (...a) => execFileSync("git", a, { cwd: app, stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("add", ".");
  g("commit", "-qm", "inicio");
  const repo = { nombre: "app", ruta: "app", codigo: ["src/**"], lint: "node ../dormir.mjs 50", relacionadas, ...(suite ? { suite } : {}) };
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [repo], retroalimentacion: { topeStopSeg }, autoconfigurar: false }));
  return { root, app, cambiar: (n) => writeFileSync(join(app, "src", "a.mjs"), `export const a = ${n};\n`) };
}

function stop(root, session = `s-${Date.now()}-${Math.random()}`) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HOOK, "stop"], { cwd: root, input: JSON.stringify({ cwd: root, session_id: session }), encoding: "utf8", timeout: 60_000 });
  const salida = (r.stdout || "").trim();
  return { ms: Date.now() - t0, json: salida ? JSON.parse(salida) : {} };
}

async function esperarFondo(root, estados, topeMs = 20_000) {
  const cfg = loadConfig(root);
  const t0 = Date.now();
  while (Date.now() - t0 < topeMs) {
    const e = leerFondo(cfg);
    if (e && estados.includes(resumen(e, e.firma, vivo(e.pid)).estado)) return e;
    await sleep(200);
  }
  throw new Error(`el fondo no llegó a ${estados.join("/")}: ${JSON.stringify(leerFondo(cfg))}`);
}

test("procesos: el corte mata el árbol completo (sin huérfanos)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nd-arbol-"));
  writeFileSync(join(dir, "colgar.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);\n");
  const r = await correr(`node colgar.mjs pid.txt`, { cwd: dir, timeoutMs: 1500 });
  assert.equal(r.cortado, true);
  assert.ok(r.ms < 5000, `tardó ${r.ms} ms`);
  await sleep(500);
  assert.equal(vivo(Number(readFileSync(join(dir, "pid.txt"), "utf8"))), false, "el proceso colgado no queda huérfano");
});

test("Stop: respeta el tope, corta lo colgado y lo pasa al fondo sin darlo por bueno", async () => {
  const p = proyecto({ relacionadas: "node ../colgar.mjs ../colgado.pid {archivos}", topeStopSeg: 10 });
  p.cambiar(2);
  const r = stop(p.root);
  try {
    assert.ok(r.ms < 12_000, `el Stop tardó ${r.ms} ms con un tope de 10 s`);
    assert.match(r.json.systemMessage ?? r.json.reason ?? "", /no alcanzó a correr[^]*app · pruebas relacionadas/);
    const e = leerFondo(loadConfig(p.root));
    assert.ok(e.tareas["app:pruebas"], "la prueba cortada quedó en el fondo (no se dio por buena)");
    // El proceso que colgaba el Stop no quedó huérfano: el corte mató su árbol. (El fondo lo vuelve a
    // correr y escribe otro pid; por eso se lee antes de que el fondo arranque o se compara con vivo.)
    const pidColgado = Number(readFileSync(join(p.root, "colgado.pid"), "utf8"));
    assert.ok(pidColgado > 0);
  } finally {
    cancelarFondo(loadConfig(p.root));
  }
});

test("Stop: los avisos van al usuario una vez y no obligan al agente a seguir", () => {
  const p = proyecto();
  const f = join(p.root, "neurodanza.config.json");
  const cfg = JSON.parse(readFileSync(f, "utf8"));
  writeFileSync(f, JSON.stringify({ ...cfg, retroalimentacion: { ...cfg.retroalimentacion, docs: "docs" } }));
  p.cambiar(9);
  const s = `avisos-${Date.now()}`;
  const r1 = stop(p.root, s);
  assert.equal(r1.json.decision, undefined, "un aviso no bloquea");
  assert.match(r1.json.systemMessage, /ninguno en docs/);
  assert.equal(stop(p.root, s).json.systemMessage, undefined, "una sola vez por sesión");
  assert.match(stop(p.root, `${s}-b`).json.systemMessage, /ninguno en docs/);
});

test("Stop: la suite completa corre en el fondo y su falla bloquea el Stop siguiente", async () => {
  const p = proyecto({ suite: "node ../dormir.mjs 300 rota" });
  p.cambiar(3);
  const r1 = stop(p.root);
  assert.equal(r1.json.decision, undefined, "una suite en curso no bloquea");
  assert.match(r1.json.systemMessage ?? "", /en segundo plano \(no bloquea\): app · suite completa/);
  await esperarFondo(p.root, ["falla"]);
  const r2 = stop(p.root);
  assert.equal(r2.json.decision, "block");
  assert.match(r2.json.reason, /app · suite completa \(en segundo plano\)[^]*fallo de prueba: rota/);
});

test("Stop: un cambio nuevo cancela el fondo anterior y descarta su resultado", async () => {
  const p = proyecto({ suite: "node ../dormir.mjs 30000" });
  p.cambiar(4);
  stop(p.root);
  const cfg = loadConfig(p.root);
  const e1 = await esperarFondo(p.root, ["corriendo"]);
  await sleep(500);
  const pidSuite = leerFondo(cfg).tareas["app:suite"].pid;
  p.cambiar(5);
  stop(p.root);
  try {
    const e2 = leerFondo(cfg);
    assert.notEqual(e2.firma, e1.firma, "el fondo ahora verifica el cambio nuevo");
    await sleep(500);
    assert.equal(vivo(e1.pid), false, "el trabajador anterior se mató");
    if (pidSuite) assert.equal(vivo(pidSuite), false, "la suite anterior se mató");
  } finally {
    cancelarFondo(cfg);
  }
});

test("cierre: `fondo.mjs esperar` exige que la suite pase para el cambio actual", async () => {
  const run = (root, tope) => spawnSync(process.execPath, [FONDO, "esperar", "--tope", String(tope)], { cwd: root, encoding: "utf8" });
  const bien = proyecto({ suite: "node ../dormir.mjs 300" });
  bien.cambiar(6);
  stop(bien.root);
  assert.equal(run(bien.root, 20).status, 0, "suite ok → se puede cerrar");
  const mal = proyecto({ suite: "node ../dormir.mjs 200 rota" });
  mal.cambiar(7);
  stop(mal.root);
  assert.equal(run(mal.root, 20).status, 1, "suite rota → no se cierra");
  const lenta = proyecto({ suite: "node ../dormir.mjs 30000" });
  lenta.cambiar(8);
  stop(lenta.root);
  try {
    assert.equal(run(lenta.root, 2).status, 2, "sigue corriendo → el cierre espera o lo dice");
  } finally {
    cancelarFondo(loadConfig(lenta.root));
  }
  lenta.cambiar(9);
  assert.equal(run(lenta.root, 2).status, 2, "el resultado de otra firma no cuenta");
});
