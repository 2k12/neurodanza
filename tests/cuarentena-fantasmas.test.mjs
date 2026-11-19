// Pasos 5 y 6 (seguridad): cuarentena y fantasmas.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { leerAgentes, reiniciarAgentes } from "../lib/agentes.mjs";
import { load as cargarErrores } from "../lib/errores.mjs";

const HOOK = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));

function proyecto(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-cf-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], figuras: { activo: true, cuarentena: 3 }, app: { urls: ["http://localhost:3000"] }, autoconfigurar: false, ...extra }));
  return { root, cfg: loadConfig(root) };
}
const run = (root, ev) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root, ...ev }), encoding: "utf8" });

test("cuarentena: 3 rechazos la activan; un ask no cuenta; se reinicia por ciclo", () => {
  const { root, cfg } = proyecto();
  const rev = { agent_id: "rev7", agent_type: "neurodanza:revisor-ui" };
  const editar = { ...rev, tool_name: "Edit", tool_input: { file_path: join(root, "a.ts"), old_string: "a", new_string: "b" } };
  const ask = run(root, { ...rev, tool_name: "Bash", tool_input: { command: "npm install x" } });
  assert.match(ask.stdout, /"permissionDecision":"ask"/);
  assert.equal(leerAgentes(cfg).rev7.rechazos, undefined, "un ask no cuenta como rechazo");
  assert.equal(run(root, editar).status, 2);
  assert.equal(run(root, editar).status, 2);
  const tercero = run(root, editar);
  assert.equal(tercero.status, 2);
  assert.match(tercero.stderr, /estás en cuarentena por 3 bloqueos/);
  const despues = run(root, { ...rev, tool_name: "Read", tool_input: { file_path: join(root, "a.ts") } });
  assert.equal(despues.status, 2, "en cuarentena, ni siquiera puede leer");
  assert.match(despues.stderr, /cuarentena/);
  assert.equal(leerAgentes(cfg).rev7.cuarentena, true);
  assert.ok(Object.values(cargarErrores(join(root, ".neurodanza", "errores.json")).errores).some((e) => e.categoria === "cuarentena"), "la cuarentena queda en errores conocidos");
  reiniciarAgentes(cfg);
  assert.equal(run(root, { ...rev, tool_name: "Read", tool_input: { file_path: join(root, "a.ts") } }).status, 0, "ciclo nuevo: sin cuarentena");
  // El agente principal nunca entra en cuarentena.
  for (let k = 0; k < 4; k++) run(root, { tool_name: "Write", tool_input: { file_path: join(root, ".neurodanza", "figuras.json"), content: "{}" } });
  assert.equal(run(root, { tool_name: "Read", tool_input: { file_path: join(root, "a.ts") } }).status, 0);
});

