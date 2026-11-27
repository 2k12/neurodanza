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
  // Sin nombrar a ningún juez: juzgar un cambio, un plan o un pedido también es ser juez.
  for (const prompt of ["Revisa el diff y dime si el cambio está bien", "Evalúa si la implementación cumple el pedido", "Dame tu veredicto sobre esto", "Actúa como crítico del pedido", "Haz de abogado del diablo con el plan", "review the changes in this PR", "Audita el trabajo hecho"])
    assert.match(forkDeJuez({ subagent_type: "fork", prompt }) ?? "", /no se lanza como fork/, prompt);
  for (const prompt of ["Revisa los logs y encuentra el error", "Busca dónde se define validarPagina", "Corre las pruebas y resume qué falla", "Evalúa el rendimiento de la consulta con EXPLAIN"])
    assert.equal(forkDeJuez({ subagent_type: "fork", prompt }), null, prompt);
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

test("barrera: si se cae, rechaza (exit 2) en vez de dejar pasar; al terminar un subagente, no frena", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const GUARD = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "nd-caida-"));
  try {
    writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "api", ruta: "api", codigo: ["src/**"] }] }));
    const correr = (ev, args = []) => spawnSync(process.execPath, [GUARD, ...args], { cwd: root, input: JSON.stringify({ cwd: root, session_id: "s", ...ev }), encoding: "utf8" });
    // Entrada que hace fallar el código de la barrera: un file_path que no es texto.
    const r = correr({ tool_name: "Edit", tool_input: { file_path: 123 } });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /la barrera falló .*no deja pasar/);
    assert.equal(correr({ tool_name: "Bash", tool_input: { command: "ls" } }).status, 0);
    assert.equal(correr({ agent_id: "a1" }, ["fin-agente"]).status, 0);
    // El hook de barreras tiene onFailure: block (tiempo agotado o no arrancar también rechazan).
    const { hooks } = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
    assert.equal(hooks.PreToolUse[0].hooks[0].onFailure, "block");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
