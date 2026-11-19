// Pasos 1 y 2 (no perder trabajo): pilas mecánicas y re-enfundar guiado.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { aplicar, guardarPaso, leerPila, pasoDe, resumen } from "../lib/pilas.mjs";

const HOOK = fileURLToPath(new URL("../hooks/pilas.mjs", import.meta.url));

function proyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-pilas-"));
  mkdirSync(join(root, "src"));
  for (let k = 1; k <= 5; k++) writeFileSync(join(root, "src", `m${k}.mjs`), `export const m${k} = ${k};\n`);
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false }));
  return { root, cfg: loadConfig(root) };
}
const ev = (root, tool_name, tool_input, extra = {}) => ({ cwd: root, agent_id: "imp1", agent_type: "neurodanza:implementador", tool_name, tool_input, ...extra });

test("pilas: cada herramienta deja su paso (lectura con hash, edición con +/−, comando con su salida si falló, avance)", () => {
  const { root, cfg } = proyecto();
  const leido = pasoDe(cfg, ev(root, "Read", { file_path: join(root, "src", "m1.mjs") }));
  assert.equal(leido.leido, "src/m1.mjs");
  assert.match(leido.hash, /^[0-9a-f]{16}$/);
  const editado = pasoDe(cfg, ev(root, "Edit", { file_path: join(root, "src", "m2.mjs"), old_string: "a", new_string: "b\nc" }));
  assert.deepEqual([editado.editado, editado.mas, editado.menos], ["src/m2.mjs", 2, 1]);
  const fallo = pasoDe(cfg, ev(root, "Bash", { command: "pnpm test" }, { tool_response: { stdout: "1 failed", stderr: "Error: espera 2", exitCode: 1 } }));
  assert.equal(fallo.fallo, true);
  assert.match(fallo.salida, /Error: espera 2/);
  const bien = pasoDe(cfg, ev(root, "Bash", { command: "pnpm lint" }, { tool_response: { stdout: "ok", stderr: "" } }));
  assert.equal(bien.fallo, false);
  assert.equal(bien.codigo, null, "sin código de salida en la respuesta: desconocido, no inventado");
  const av = pasoDe(cfg, ev(root, "Bash", { command: 'node "/p/lib/pilas.mjs" avance --texto "servicio listo; falta la pantalla"' }));
  assert.equal(av.avance, "servicio listo; falta la pantalla");
  assert.equal(pasoDe(cfg, ev(root, "Grep", { pattern: "x" })), null);
  const p = [leido, editado, fallo, av].reduce(aplicar, { id: "imp1", tipo: "", tarea: null, contrato: null, inicio: null, pasos: 0, leidos: {}, editados: {}, comandos: [], ultimaHerramienta: null, avance: [] });
  assert.equal(p.pasos, 4);
  assert.equal(p.avance[0].texto, "servicio listo; falta la pantalla");
});

test("pilas: 20 pasos del mismo agente a la vez no se pierden (cada paso es un archivo atómico)", async () => {
  const { root, cfg } = proyecto();
  await Promise.all(
    Array.from({ length: 20 }, (_, k) =>
      new Promise((res) => {
        const p = spawn(process.execPath, [HOOK], { windowsHide: true });
        p.on("close", res);
        p.stdin.end(JSON.stringify(ev(root, "Read", { file_path: join(root, "src", `m${(k % 5) + 1}.mjs`) })));
      }),
    ),
  );
  const pila = leerPila(cfg, "imp1");
  assert.equal(pila.pasos, 20);
  assert.equal(Object.keys(pila.leidos).length, 5);
  assert.equal(leerPila(cfg, "imp1").pasos, 20, "compactar dos veces no duplica pasos");
});

test("pilas: el resumen es corto y dice qué no releer", () => {
  const { root, cfg } = proyecto();
  for (let k = 1; k <= 5; k++) guardarPaso(cfg, "imp1", pasoDe(cfg, ev(root, "Read", { file_path: join(root, "src", `m${k}.mjs`) }), 1000 + k));
  writeFileSync(join(root, "src", "m3.mjs"), "export const m3 = 33;\n"); // otro lo cambió
  const txt = resumen(cfg, leerPila(cfg, "imp1"));
  assert.ok(txt.split("\n").length <= 60);
  assert.match(txt, /Leídos que siguen iguales \(4\)/);
  assert.match(txt, /src\/m3\.mjs \(cambió desde que se leyó\)/);
});

