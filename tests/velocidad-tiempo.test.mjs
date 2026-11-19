// Paso 3 (velocidad): corte por tiempo, no solo por pasos.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { clase, juzgarPaso, leerAgentes, MENSAJE_CORTE, registrarPaso, revisarLatidos, terminar } from "../lib/agentes.mjs";

const HOOK = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));

function proyecto(ciclo = { maxSegundos: { revisor: 10 }, latidoSeg: 3 }) {
  const root = mkdtempSync(join(tmpdir(), "nd-tiempo-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], ciclo, autoconfigurar: false }));
  return { root, cfg: loadConfig(root) };
}
const evento = (root, extra) => ({ cwd: root, session_id: "s", tool_name: "Bash", tool_input: { command: "git status" }, ...extra });

test("tiempo: aviso al 80 % una sola vez y corte al 100 %", () => {
  const a = { id: "a", tipo: "neurodanza:revisor-ui", inicio: 0, pasos: 3 };
  assert.equal(juzgarPaso(a, 5_000, 10).aviso, undefined);
  const r80 = juzgarPaso(a, 8_000, 10);
  assert.match(r80.aviso, /llevas 8 de 10 s/);
  assert.equal(juzgarPaso(r80.agente, 9_000, 10).aviso, undefined, "el aviso no se repite");
  const r100 = juzgarPaso(r80.agente, 10_000, 10);
  assert.equal(r100.corte, true);
  assert.equal(r100.agente.agotado, true);
  assert.deepEqual(["revisor", "persona", "implementador", "otro"], ["neurodanza:revisor-ui", "neurodanza:persona-evaluadora", "neurodanza:implementador", "Explore"].map(clase));
});

test("tiempo: la barrera rechaza toda herramienta del agente agotado; el principal queda exento", () => {
  const { root, cfg } = proyecto();
  // Un agente que empezó hace 20 s (tope 10 s).
  registrarPaso(cfg, { agent_id: "rev1", agent_type: "neurodanza:revisor-ui", tool_name: "Read" }, Date.now() - 20_000);
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(evento(root, { agent_id: "rev1", agent_type: "neurodanza:revisor-ui" })), encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim(), MENSAJE_CORTE);
  const principal = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(evento(root, {})), encoding: "utf8" });
  assert.equal(principal.status, 0, "el agente principal nunca queda bloqueado por el corte");
});

test("tiempo: el aviso del 80 % llega como contexto, sin decidir permisos", () => {
  const { root, cfg } = proyecto();
  registrarPaso(cfg, { agent_id: "rev2", agent_type: "neurodanza:revisor-ui", tool_name: "Read" }, Date.now() - 8_500);
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(evento(root, { agent_id: "rev2", agent_type: "neurodanza:revisor-ui" })), encoding: "utf8" });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /Te quedan/);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, "no devuelve allow: no se salta los permisos");
});

test("tiempo: varios agentes a la vez no se pisan, y el latido marca al que dejó de dar pasos", () => {
  const { cfg } = proyecto({ maxSegundos: { revisor: 60, persona: 60 }, latidoSeg: 3 });
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) for (const id of ["a", "b", "c"]) registrarPaso(cfg, { agent_id: id, agent_type: id === "c" ? "neurodanza:persona-evaluadora" : "neurodanza:revisor-ui", tool_name: "Read" }, t0 + i);
  const todos = leerAgentes(cfg);
  assert.deepEqual(Object.keys(todos).sort(), ["a", "b", "c"]);
  assert.ok(Object.values(todos).every((a) => a.pasos === 20), "ningún paso se perdió");
  // b sigue; a y c se quedan quietos 5 s.
  registrarPaso(cfg, { agent_id: "b", agent_type: "neurodanza:revisor-ui", tool_name: "Read" }, t0 + 5_000);
  const marcados = revisarLatidos(cfg, t0 + 5_000, "b");
  assert.deepEqual(marcados.map((m) => m.id).sort(), ["a", "c"]);
  terminar(cfg, "a");
  assert.equal(leerAgentes(cfg).a.terminado, true);
  assert.equal(revisarLatidos(cfg, t0 + 9_000, "b").length, 0, "un agente terminado no se vuelve a marcar");
});
