// Paso 6: operador (lecciones con activadores que se recuerdan al tocar sus archivos).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { aplicarReflexion, cargar, guardar, juzgar, playbookTexto } from "../lib/constructos.mjs";
import { coincide, compilar, leerActivas, recordar, sugerirActivadores } from "../lib/operador.mjs";

const GUARD = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));

function proyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-op-"));
  mkdirSync(join(root, "web", "app"), { recursive: true });
  writeFileSync(join(root, "web", "app", "filtros.tsx"), `export function F() { return <button><Icono /></button>; }\n`);
  writeFileSync(join(root, "web", "app", "lista.tsx"), `export function L() { return <ul />; }\n`);
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false, constructos: { compartido: "local" } }));
  return { root, cfg: loadConfig(root) };
}
const REFLEXION = (ciclo, activadores) => ({
  ciclo,
  agentes: [{ constructo: "revisor-ui" }],
  problemas: [{ constructo: "revisor-ui", etiqueta: "ui:aria-label-icono", fuente: "panel", detalle: "botón de solo icono sin aria-label en web/app/filtros.tsx", leccion: "Todo botón de solo icono lleva aria-label.", ...(activadores ? { activadores } : {}) }],
});
/** Constructos con la lección a prueba (2 evidencias) y guardados: compila las activas. */
function conLeccion(cfg, activadores) {
  const data = cargar(cfg);
  aplicarReflexion(data, REFLEXION("c1", activadores));
  aplicarReflexion(data, REFLEXION("c2", activadores));
  guardar(cfg, data);
  return data;
}
const ev = (root, tool_name, tool_input, agent_id = "r1", agent_type = "neurodanza:revisor-ui") => ({ cwd: root, session_id: "s", agent_id, agent_type, tool_name, tool_input });

test("operador: coincidencia por glob y por texto (literal o /regex/); con los dos, deben coincidir ambos", () => {
  assert.ok(coincide({ archivos: ["**/*.tsx"] }, "web/app/x.tsx"));
  assert.ok(coincide({ archivos: ["*.tsx"] }, "web/app/x.tsx"));
  assert.equal(coincide({ archivos: ["**/*.tsx"] }, "api/x.ts"), false);
  assert.ok(coincide({ texto: ["<button"] }, "x.ts", "a <button> b"));
  assert.ok(coincide({ texto: ["/aria-\\w+/"] }, "x.ts", 'aria-label="x"'));
  assert.equal(coincide({ archivos: ["**/*.tsx"], texto: ["<button"] }, "web/lista.tsx", "<ul />"), false);
  assert.ok(coincide({ archivos: ["**/*.tsx"], texto: ["<button"] }, "web/filtros.tsx", "<button/>"));
  assert.deepEqual(sugerirActivadores("botón sin aria-label en web/app/filtros.tsx y web/x.css"), { archivos: ["**/*.tsx", "**/*.css"] });
  assert.equal(sugerirActivadores("un detalle sin archivos"), null);
});

test("operador: la reflexión propone activadores (o los sugiere desde el detalle) y se ven en lo aprendido", () => {
  const data = { constructos: {}, ciclos: [] };
  aplicarReflexion(data, REFLEXION("c1"));
  const l = data.constructos["revisor-ui"].lecciones[0];
  assert.deepEqual([l.activadores, l.activadoresSugeridos], [{ archivos: ["**/*.tsx"] }, true]);
  const d2 = { constructos: {}, ciclos: [] };
  aplicarReflexion(d2, REFLEXION("c1", { archivos: ["web/**/*.tsx"], texto: ["<button"] }));
  assert.deepEqual(d2.constructos["revisor-ui"].lecciones[0].activadores, { archivos: ["web/**/*.tsx"], texto: ["<button"] });
  // Solo las activas (a prueba o aprobadas) con activadores se compilan; las candidatas no.
  assert.deepEqual(compilar(d2), []);
  aplicarReflexion(d2, REFLEXION("c2"));
  assert.equal(compilar(d2)[0].estado, "a prueba");
  assert.deepEqual(compilar(d2, { "revisor-ui": ["ui:aria-label-icono"] }).length, 1); // a prueba: no se retira
});

test("operador: se recuerda una sola vez por lección y por agente, solo a su constructo, y cuenta las veces", () => {
  const { root, cfg } = proyecto();
  conLeccion(cfg, { archivos: ["**/*.tsx"], texto: ["<button"] });
  assert.equal(leerActivas(cfg).length, 1);
  const filtros = { file_path: join(root, "web", "app", "filtros.tsx") };
  assert.equal(recordar(cfg, ev(root, "Read", { file_path: join(root, "web", "app", "lista.tsx") })), ""); // sin <button
  assert.equal(recordar(cfg, ev(root, "Read", filtros)), "Recuerda (lección aprendida en este proyecto): Todo botón de solo icono lleva aria-label.");
  assert.equal(recordar(cfg, ev(root, "Read", filtros)), ""); // una sola vez
  assert.match(recordar(cfg, ev(root, "Edit", { file_path: join(root, "web", "app", "otro.tsx"), new_string: "<button>" }, "r2")), /Recuerda/); // otro agente
  assert.equal(recordar(cfg, ev(root, "Read", filtros, "i1", "neurodanza:implementador")), ""); // otro constructo
  assert.equal(recordar(cfg, { ...ev(root, "Read", filtros), agent_id: undefined }), ""); // el principal no
  const l = cargar(cfg).constructos["revisor-ui"].lecciones[0];
  assert.equal(l.recordada, 2);
  // El juicio de la lección lo distingue.
  const data = cargar(cfg);
  aplicarReflexion(data, { ciclo: "c3", agentes: [{ constructo: "revisor-ui" }], problemas: [] });
  aplicarReflexion(data, { ciclo: "c4", agentes: [{ constructo: "revisor-ui" }], problemas: [] });
  aplicarReflexion(data, { ciclo: "c5", agentes: [{ constructo: "revisor-ui" }], problemas: [] });
  // (como implementador: los revisores además exigen evals, que aquí no hay)
  const jl = juzgar({ ...data, constructos: { "implementador-ui": data.constructos["revisor-ui"] }, ciclos: data.ciclos.map((c) => ({ ...c, constructos: ["implementador-ui"], problemas: c.problemas?.["revisor-ui"] ? { "implementador-ui": c.problemas["revisor-ui"] } : {} })) }, "implementador-ui", data.constructos["revisor-ui"].lecciones[0]);
  assert.match(jl.motivo, /se recordó 2 veces al tocar sus archivos/);
});

test("operador: las lecciones sin activadores siguen entrando en el contrato como hoy", () => {
  const data = { constructos: {}, ciclos: [] };
  aplicarReflexion(data, { ciclo: "c1", problemas: [{ constructo: "implementador", etiqueta: "api:validar", detalle: "sin archivos", leccion: "Valida en el servidor." }] });
  aplicarReflexion(data, { ciclo: "c2", problemas: [{ constructo: "implementador", etiqueta: "api:validar", detalle: "sin archivos", leccion: "Valida en el servidor." }] });
  assert.equal(data.constructos.implementador.lecciones[0].activadores, undefined);
  assert.match(playbookTexto(data, "implementador"), /Valida en el servidor\. \(a prueba\)/);
  assert.deepEqual(compilar(data), []);
});

test("operador: cuesta menos de 5 ms por evento y llega al subagente por la barrera", async () => {
  const { root, cfg } = proyecto();
  // 30 lecciones activas en 3 constructos para que la coincidencia no sea trivial.
  const data = cargar(cfg);
  for (let k = 0; k < 30; k++) {
    const c = ["revisor-ui", "implementador", "revisor-docs"][k % 3];
    for (const ciclo of ["a", "b"]) aplicarReflexion(data, { ciclo: `${ciclo}${k}`, problemas: [{ constructo: c, etiqueta: `ui:regla-${k}`, detalle: "x", leccion: `Regla ${k}`, activadores: { archivos: [`**/*.tsx`], texto: [`/token${k}\\b/`] } }] });
  }
  guardar(cfg, data);
  const activas = leerActivas(cfg);
  const n = 300;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) recordar(cfg, ev(root, "Edit", { file_path: join(root, "web", "app", `f${i}.tsx`), new_string: `<div>${i}</div>` }, `a${i}`), activas);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  assert.ok(ms < 5, `${ms.toFixed(2)} ms por evento`);
  // De punta a punta: la barrera lo devuelve como contexto (additionalContext).
  const cfg2 = proyecto();
  conLeccion(cfg2.cfg, { archivos: ["**/*.tsx"], texto: ["<button"] });
  const salida = await new Promise((res) => {
    const p = spawn(process.execPath, [GUARD], { cwd: cfg2.root });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => res(out));
    p.stdin.end(JSON.stringify(ev(cfg2.root, "Read", { file_path: join(cfg2.root, "web", "app", "filtros.tsx") })));
  });
  assert.match(JSON.parse(salida).hookSpecificOutput.additionalContext, /Recuerda \(lección aprendida en este proyecto\): Todo botón/);
});
