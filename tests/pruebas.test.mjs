// Paso 5: pruebas primero (rojo antes de implementar, verde después).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { doneProblems } from "../hooks/feedback.mjs";
import { loadConfig, merge } from "../lib/config.mjs";
import { leerRegistro, rojo, sinRojo, verde } from "../lib/pruebas.mjs";

// Dentro de `node --test`, un `node --test` hijo hereda NODE_TEST_CONTEXT y reporta al padre en vez de fallar.
delete process.env.NODE_TEST_CONTEXT;

function proyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-pruebas-"));
  mkdirSync(join(root, "api", "src"), { recursive: true });
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "api", ruta: "api", codigo: ["src/**"], relacionadas: "node --test {archivos}" }], autoconfigurar: false }));
  writeFileSync(join(root, "api", "src", "index.mjs"), "export const sumar = (a, b) => a + b;\n");
  writeFileSync(join(root, "api", "src", "index.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert";\nimport * as m from "./index.mjs";\ntest("restar", () => assert.equal(m.restar?.(5, 3), 2));\n');
  return loadConfig(root);
}

test("pruebas: rojo se registra solo si la prueba falla; verde cuando pasa con el cambio", async () => {
  const cfg = proyecto();
  const r1 = await rojo(cfg, "api", "src/index.test.mjs");
  assert.equal(r1.ok, true);
  assert.match(r1.texto, /rojo observado/);
  assert.ok(leerRegistro(cfg).api["src/index.test.mjs"].rojo);
  assert.equal((await verde(cfg, "api", "src/index.test.mjs")).ok, false, "sin implementar sigue en rojo");
  writeFileSync(join(cfg.root, "api", "src", "index.mjs"), "export const sumar = (a, b) => a + b;\nexport const restar = (a, b) => a - b;\n");
  const v = await verde(cfg, "api", "src/index.test.mjs");
  assert.equal(v.ok, true);
  assert.match(v.texto, /rojo visto antes/);
  const otra = await rojo(cfg, "api", "src/index.test.mjs");
  assert.equal(otra.ok, false, "una prueba que ya pasa no cuenta como rojo");
  assert.match(otra.texto, /pasa sin implementar/);
});

test("pruebas: sin {archivos} en relacionadas no se puede correr una prueba sola", async () => {
  const cfg = merge(proyecto(), {});
  cfg.repos[0].relacionadas = "node --test";
  await assert.rejects(rojo(cfg, "api", "src/index.test.mjs"), /\{archivos\}/);
});

test("pruebas: el Stop avisa (o bloquea con exigir) si cambió código y una prueba no se vio en rojo", () => {
  const cfg = proyecto();
  const changes = { api: ["src/index.mjs", "src/index.test.mjs"] };
  assert.deepEqual(sinRojo(cfg, changes, {}), ["api/src/index.test.mjs"]);
  assert.deepEqual(sinRojo(cfg, changes, { api: { "src/index.test.mjs": { rojo: 1 } } }), []);
  assert.deepEqual(sinRojo(cfg, { api: ["src/index.test.mjs"] }, {}), [], "solo pruebas, sin código: no aplica");
  const ok = { version: "", baseVersion: "", panelApproved: () => true, evalsApproved: () => true, docsInBranch: true, registroPruebas: {} };
  const avisar = doneProblems(cfg, changes, ok);
  assert.ok(avisar.soft.some((s) => /no se vio la prueba en rojo/.test(s)));
  assert.ok(!avisar.hard.some((s) => /rojo/.test(s)));
  const exigir = doneProblems(merge(cfg, { ciclo: { pruebaPrimero: "exigir" } }), changes, ok);
  assert.ok(exigir.hard.some((s) => /no se vio la prueba en rojo/.test(s)));
  const apagado = doneProblems(merge(cfg, { ciclo: { pruebaPrimero: false } }), changes, ok);
  assert.ok(![...apagado.hard, ...apagado.soft].some((s) => /rojo/.test(s)));
});

test("pruebas: con --dir corre la prueba en otra carpeta (el worktree de una tarea)", async () => {
  const cfg = proyecto();
  const wt = mkdtempSync(join(tmpdir(), "nd-pruebas-wt-"));
  mkdirSync(join(wt, "src"));
  writeFileSync(join(wt, "src", "index.mjs"), "export const restar = (a, b) => a - b;\n");
  writeFileSync(join(wt, "src", "index.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert";\nimport { restar } from "./index.mjs";\ntest("restar", () => assert.equal(restar(5, 3), 2));\n');
  assert.equal((await verde(cfg, "api", "src/index.test.mjs", { dir: wt })).ok, true, "en el worktree ya está implementado");
  assert.equal((await rojo(cfg, "api", "src/index.test.mjs")).ok, true, "en el repo real todavía no");
});
