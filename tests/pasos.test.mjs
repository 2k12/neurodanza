// 1.8.0: pasos del ciclo en un comando.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { leerAgentes, registrarPaso } from "../lib/agentes.mjs";
import { loadConfig } from "../lib/config.mjs";
import { leerFusible } from "../lib/fusible.mjs";
import { referenciasDe, revisoresFaltantes } from "../lib/pasos.mjs";

const CICLO = fileURLToPath(new URL("../lib/ciclo.mjs", import.meta.url));

function proyecto({ falla = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-pasos-"));
  const api = join(root, "api");
  mkdirSync(join(api, "src", "auth"), { recursive: true });
  writeFileSync(join(api, "src", "auth", "a.mjs"), "export const a = 1;\n");
  writeFileSync(join(api, "src", "b.mjs"), "export const formatoDinero = 1;\n");
  const g = (...a) => execFileSync("git", a, { cwd: api, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  for (const [k, v] of [["user.email", "t@localhost"], ["user.name", "t"]]) g("config", k, v);
  g("add", ".");
  g("commit", "-qm", "inicio");
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "api", ruta: "api", codigo: ["src/**"], lint: `node -e "process.exit(${falla ? 1 : 0})"` }], autoconfigurar: false }));
  return { root, api, cfg: loadConfig(root) };
}
const ciclo = (root, ...a) => spawnSync(process.execPath, [CICLO, ...a], { cwd: root, encoding: "utf8" });

test("preparar: bajo va directo; alto dice qué leer e inicia el ciclo; busca en el índice", () => {
  const { root, cfg } = proyecto();
  const bajo = ciclo(root, "preparar", "--archivos", "api:src/b.mjs", "--lineas", "10", "--buscar", "dinero");
  assert.equal(bajo.status, 0, bajo.stderr);
  assert.match(bajo.stdout, /Riesgo bajo[^]*Hazlo directo/);
  assert.match(bajo.stdout, /formatoDinero/);
  assert.equal(leerFusible(cfg).inicio, "", "lo bajo no inicia un ciclo");
  const alto = ciclo(root, "preparar", "--archivos", "api:src/auth/a.mjs", "--lineas", "3");
  assert.match(alto.stdout, /Riesgo alto[^]*planificar\.md, referencias\/revision\.md, referencias\/cerrar\.md/);
  assert.ok(leerFusible(cfg).inicio);
  assert.ok(alto.stdout.length < 900, `salida corta: ${alto.stdout.length}`);
});

test("referencias: panel y director solo si el plan los trae", () => {
  const p = (x) => ({ nivel: "alto", plan: { personas: 0, director: false, ...x } });
  assert.deepEqual(referenciasDe(p({})), ["planificar", "revision", "cerrar"]);
  assert.deepEqual(referenciasDe(p({ personas: 3, director: true })), ["planificar", "director", "revision", "panel", "cerrar"]);
  assert.deepEqual(referenciasDe({ nivel: "bajo", plan: { personas: 0, director: false } }), []);
});

test("cerrar: exige los revisores del riesgo real y que todo pase", () => {
  const { root, api, cfg } = proyecto();
  writeFileSync(join(api, "src", "auth", "a.mjs"), "export const a = 2;\n");
  const r1 = ciclo(root, "cerrar");
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /faltan revisores de este riesgo: .*revisor-permisos/);
  assert.match(r1.stdout, /✔ lint/);
  const faltan = /riesgo: ([^.]*)\. Lánzalos/.exec(r1.stdout)[1].split(", ");
  for (const [i, t] of faltan.entries()) registrarPaso(cfg, { agent_id: `r${i}`, agent_type: `neurodanza:${t}` });
  assert.deepEqual(revisoresFaltantes(faltan, leerAgentes(cfg)), []);
  const r2 = ciclo(root, "cerrar");
  assert.equal(r2.status, 0, r2.stdout);
  assert.match(r2.stdout, /listo para informar/);
});

test("cerrar: un lint que falla no está listo", () => {
  const { root, api } = proyecto({ falla: true });
  writeFileSync(join(api, "src", "b.mjs"), "export const formatoDinero = 2;\n");
  const r = ciclo(root, "cerrar");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Riesgo bajo[^]*✖ lint[^]*no está listo/);
});

