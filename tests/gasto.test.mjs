// 1.7.0: gasto por tipo de agente, tope por ciclo y modo director con su mínimo de archivos.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, validate } from "../lib/config.mjs";
import { reiniciar } from "../lib/fusible.mjs";
import { peso, pesoDeLineas } from "../lib/gasto.mjs";
import { gastoPorAgente, resumirSesion } from "../lib/telemetria.mjs";

const lib = (f) => fileURLToPath(new URL(`../lib/${f}`, import.meta.url));
const HOOK = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));
const linea = (id, salida, extra = {}) => JSON.stringify({ type: "assistant", timestamp: "2099-01-01T00:00:00Z", ...extra, message: { id, model: extra.model ?? "m1", usage: { input_tokens: 10, output_tokens: salida, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }, content: [] } });

function proyecto(ciclo = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-gasto-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false, ciclo, telemetria: { transcripts: "t" } }));
  mkdirSync(join(root, "t", "s1", "subagents"), { recursive: true });
  return root;
}

test("peso: salida ×5, caché escrita ×2 y leída ×0,1; un mensaje en varias líneas cuenta una vez, con su valor final", () => {
  assert.equal(peso({ entrada: 10, salida: 10, cacheLeida: 100, cacheCreada: 5 }), 80);
  assert.equal(pesoDeLineas([linea("a", 1), linea("a", 10), linea("b", 10), "basura", '{"usage"']), 160);
  assert.equal(pesoDeLineas([linea("a", 10)], "2099-06-01"), 0, "antes del ciclo no cuenta");
});

test("telemetría: gasto por tipo de agente y modelo, de mayor a menor, y la salida final de cada mensaje", () => {
  const p = resumirSesion([linea("a", 1), linea("a", 10)], { archivo: "/t/s1.jsonl" });
  assert.equal(p.tokens.salida, 10);
  const r1 = resumirSesion([linea("b", 100)], { archivo: "/t/s1/subagents/x.jsonl", agente: "neurodanza:revisor-ui" });
  const r2 = resumirSesion([linea("c", 100)], { archivo: "/t/s1/subagents/y.jsonl", agente: "neurodanza:revisor-ui" });
  const g = gastoPorAgente([p, r1, r2]);
  assert.deepEqual(g.map((x) => [x.agente, x.modelo, x.veces, x.salida]), [["revisor-ui", "m1", 2, 200], ["principal", "m1", 1, 10]]);
  assert.equal(Math.round(g.reduce((s, x) => s + x.porcentaje, 0)), 100);
  assert.deepEqual(gastoPorAgente([]), []);
});

test("telemetría: el comando gasto", () => {
  const root = proyecto();
  writeFileSync(join(root, "t", "s1.jsonl"), linea("a", 10));
  writeFileSync(join(root, "t", "s1", "subagents", "agent-x.jsonl"), linea("b", 100));
  writeFileSync(join(root, "t", "s1", "subagents", "agent-x.meta.json"), JSON.stringify({ agentType: "neurodanza:revisor-ui" }));
  const r = spawnSync(process.execPath, [lib("telemetria.mjs"), "gasto"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| revisor-ui \| m1 \| 1 \|/);
  assert.match(r.stdout, /\| principal \| m1 \| 1 \|/);
  const viejo = spawnSync(process.execPath, [lib("telemetria.mjs"), "gasto", "--dias", "1"], { cwd: root, encoding: "utf8" });
  assert.equal(viejo.status, 0);
});

test("tope del ciclo: rechaza otro subagente, lo amplía solo el usuario y sin configurarlo no hace nada", () => {
  const ev = (root, x) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root, transcript_path: join(root, "t", "s1.jsonl"), ...x }), encoding: "utf8" });
  const agente = { tool_name: "Agent", tool_input: { subagent_type: "neurodanza:revisor-ui", prompt: "x" } };
  const libre = proyecto();
  writeFileSync(join(libre, "t", "s1.jsonl"), linea("a", 1_000_000));
  assert.equal(ev(libre, agente).status, 0, "apagado por defecto");

  const root = proyecto({ maxTokens: 1000 });
  const cfg = loadConfig(root);
  assert.deepEqual(validate(cfg), []);
  reiniciar(cfg);
  writeFileSync(join(root, "t", "s1.jsonl"), linea("a", 100));
  assert.equal(ev(root, agente).status, 0);
  writeFileSync(join(root, "t", "s1", "subagents", "agent-x.jsonl"), linea("b", 200));
  const r = ev(root, agente);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ciclo ya gastó \d+ de 1000/);
  assert.equal(ev(root, { tool_name: "Read", tool_input: { file_path: join(root, "a.ts") } }).status, 0, "lo demás sigue");
  const cmd = { tool_name: "Bash", tool_input: { command: `node "${lib("ciclo.mjs")}" seguir` } };
  assert.match(ev(root, cmd).stdout, /"permissionDecision":"ask"/);
  assert.match(ev(root, { ...cmd, permission_mode: "auto" }).stdout, /"permissionDecision":"ask"/);
  assert.equal(ev(root, { ...cmd, agent_id: "a1", agent_type: "neurodanza:revisor-ui" }).status, 2, "un subagente no lo amplía");
  assert.equal(ev(root, { tool_name: "Write", tool_input: { file_path: join(root, ".neurodanza", "gasto.json"), content: "{}" } }).status, 2);
  assert.equal(spawnSync(process.execPath, [lib("ciclo.mjs"), "seguir"], { cwd: root }).status, 0);
  assert.equal(ev(root, agente).status, 0, "ampliado");
  reiniciar(cfg, "otro");
  writeFileSync(join(root, "t", "s1.jsonl"), linea("a", 5000));
  assert.equal(ev(root, agente).status, 2, "un ciclo nuevo empieza con un solo tope");
});

test("config: maxTokens y minArchivos con su forma", () => {
  for (const c of [{ ciclo: { maxTokens: -1 } }, { ciclo: { maxTokens: "x" } }, { director: { minArchivos: -2 } }]) {
    const root = mkdtempSync(join(tmpdir(), "nd-gasto-"));
    writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false }));
    const base = loadConfig(root);
    const k = Object.keys(c)[0];
    assert.equal(validate({ ...base, [k]: { ...base[k], ...c[k] } }).length, 1);
  }
});
