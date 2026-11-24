import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluar, VIAS } from "../evals/barreras.mjs";
import { forkDeJuez, secretoEnBusqueda } from "../hooks/guardrails.mjs";
import { clasificar } from "../lib/figuras.mjs";

test("el hook está registrado para todas las herramientas que la barrera juzga", () => {
  const m = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8")).hooks.PreToolUse[0].matcher.split("|");
  for (const t of ["Read", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "PowerShell", "Agent", "Task"]) assert.ok(m.includes(t), t);
});

test("Grep sobre un .env se rechaza; los permitidos y lo demás, no", () => {
  for (const p of [".env", "C:/x/.env", "a/.env.local", "**/.env*", "{.env,.env.local}"]) assert.equal(secretoEnBusqueda(p, [".env.example"]), true, p);
  for (const p of ["src", ".env.example", "environment.ts", "*.ts", "!.env", "src/env.ts"]) assert.equal(secretoEnBusqueda(p, [".env.example"]), false, p);
});

test("un juez no nace de un fork; los demás forks y los jueces normales, sí", () => {
  for (const i of [{ prompt: "Eres revisor-permisos: revisa" }, { description: "revisor de UI", prompt: "x" }, { prompt: "persona-evaluadora Ana" }]) assert.match(forkDeJuez({ subagent_type: "fork", ...i }), /no se lanza como fork/);
  assert.equal(forkDeJuez({ subagent_type: "fork", prompt: "investiga por qué falla la prueba" }), null);
  assert.equal(forkDeJuez({ subagent_type: "neurodanza:revisor-permisos", prompt: "revisor-permisos" }), null);
  assert.equal(clasificar({ tool_name: "Agent", tool_input: {} }).figura, "leer");
});

test("la comprobación distingue bloqueada, pasó y sin intento", () => {
  const ev = (tool_use_id, tool_name, tool_input, agent_id) => ({ tool_use_id, tool_name, tool_input, agent_id, permission_mode: "auto" });
  const r = evaluar([ev("1", "Bash", { command: "via-bash" }), ev("2", "Grep", { path: ".env" }), ev("3", "Bash", { command: "via-sub" }, "a")], { existe: (f) => f === "via-sub.txt", resultados: [{ id: "1", error: true, texto: "Barrera (neurodanza): x" }, { id: "2", error: false, texto: "CLAVE" }] });
  const de = (id) => r.find((x) => x.id === id).estado;
  assert.deepEqual([de("bash"), de("grep-secreto"), de("sub-bash"), de("monitor")], ["bloqueada", "PASÓ", "PASÓ", "sin intento"]);
  assert.equal(r.length, VIAS.length);
});
