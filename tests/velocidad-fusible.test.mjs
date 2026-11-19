// Paso 4 (velocidad): fusible por capa externa.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULTS, loadConfig, merge } from "../lib/config.mjs";
import { comprobar, falla, fundida, fundidas, registrarFallo, reiniciar } from "../lib/fusible.mjs";
import { doneProblems, panelCuenta } from "../hooks/feedback.mjs";

const PANEL = fileURLToPath(new URL("../panel/panel.mjs", import.meta.url));

function proyecto(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-fusible-"));
  // Puerto cerrado: la app «no arranca».
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], app: { urls: ["http://127.0.0.1:9"] }, autoconfigurar: false, ...extra }));
  return { root, cfg: loadConfig(root) };
}

test("fusible: un fallo no funde, dos sí; se reinicia por ciclo", () => {
  const e = { capas: {} };
  assert.equal(registrarFallo(e, "app", "no responde").fundida, false);
  const c = registrarFallo(e, "app", "no responde otra vez");
  assert.equal(c.fundida, true);
  assert.equal(c.motivo, "no responde otra vez");
  const { cfg } = proyecto();
  falla(cfg, "app", "a");
  assert.equal(fundida(cfg, "app"), false);
  falla(cfg, "app", "b");
  assert.equal(fundida(cfg, "app"), true);
  assert.deepEqual(fundidas(cfg), [{ capa: "app", motivo: "b" }]);
  reiniciar(cfg, "ciclo-2");
  assert.equal(fundida(cfg, "app"), false, "un ciclo nuevo empieza en cero");
});

test("fusible: panel.mjs registra la app caída, la funde al segundo intento y sale con 3 (pendiente)", () => {
  const { root, cfg } = proyecto();
  const app = () => spawnSync(process.execPath, [PANEL, "app"], { cwd: root, encoding: "utf8" });
  const r1 = app();
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /la app no responde[^]*Fallo 1 de 2/);
  const r2 = app();
  assert.equal(r2.status, 3, "segunda vez: capa fundida, panel pendiente");
  assert.match(r2.stderr, /app: fundida[^]*PENDIENTE/);
  const r3 = app();
  assert.equal(r3.status, 3, "fundida: ni siquiera se reintenta");
  assert.equal(fundidas(cfg).length, 1);
});

test("fusible: con la app fundida, el panel queda pendiente (no bloquea) y no cuenta como aprobado", () => {
  const cfg = merge(DEFAULTS, { retroalimentacion: { pantallas: ["web:app/**"] } });
  const ctx = { version: "1.1.0", baseVersion: "1.0.0", bitacoraExists: () => true, panelApproved: () => false, evalsApproved: () => true, docsInBranch: true };
  const cambios = { web: ["app/pedidos/page.tsx"] };
  assert.match(doneProblems(cfg, cambios, ctx).hard.join(), /panel de personas/, "sin fusible: bloquea");
  const r = doneProblems(cfg, cambios, { ...ctx, fundidas: [{ capa: "app", motivo: "no arranca" }] });
  assert.equal(r.hard.length, 0);
  assert.match(r.soft.join(), /PENDIENTE: no se pudo verificar app \(no arranca\)/);
  const cuenta = panelCuenta(8.99);
  assert.equal(cuenta({ aprobado: true, promedio: 9.5 }), true);
  assert.equal(cuenta({ aprobado: true, promedio: 9.5, pendiente: true }), false);
  assert.equal(cuenta({ aprobado: true, promedio: 9.5, revisores: "reprobados" }), false);
});

test("fusible: comprobaciones configuradas (bd) cuentan para su capa", async () => {
  const { cfg } = proyecto({ fusible: { comprobaciones: { bd: 'node -e "process.exit(1)"' } } });
  assert.equal((await comprobar(cfg, "bd")).ok, false);
  const r = await comprobar(cfg, "bd");
  assert.match(r.texto, /bd: fundida/);
  assert.match((await comprobar(cfg, "otra")).texto, /sin comprobación configurada/);
});
