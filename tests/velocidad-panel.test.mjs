// Paso 5 (velocidad): revisores y panel en paralelo.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { veredictoRonda } from "../panel/panel.mjs";

const PANEL = fileURLToPath(new URL("../panel/panel.mjs", import.meta.url));
const ev = (...notas) => notas.map((nota, i) => ({ persona: `p${i}`, nota }));

test("ronda: un revisor que reprobó durante la ronda impide aprobarla aunque el promedio alcance", () => {
  assert.equal(veredictoRonda({ evaluaciones: ev(9.5, 9.4, 9.6) }, 8.99).aprobado, true);
  const r = veredictoRonda({ evaluaciones: ev(9.5, 9.4, 9.6), revisores: "reprobados" }, 8.99);
  assert.equal(r.aprobado, false);
  assert.match(r.motivo, /se repite tras la corrección/);
});

test("ronda: con la app fundida y notas faltantes queda pendiente (ni aprobada ni reprobada)", () => {
  const r = veredictoRonda({ evaluaciones: [{ persona: "a" }] }, 8.99, [{ capa: "app", motivo: "no arranca" }]);
  assert.equal(r.pendiente, true);
  assert.equal(r.aprobado, false);
  assert.match(r.motivo, /pendiente: no se pudo verificar app \(no arranca\)/);
  // Una capa ajena al panel (bd) no lo deja pendiente.
  assert.equal(veredictoRonda({ evaluaciones: [{ persona: "a" }] }, 8.99, [{ capa: "bd", motivo: "x" }]).pendiente, undefined);
});

test("ventana en vivo: varias personas hablando a la vez no rompen la ronda", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nd-ronda-par-"));
  writeFileSync(join(dir, "ronda.jsonl"), JSON.stringify({ type: "inicio", personas: [] }) + "\n");
  const decir = (persona, i) =>
    new Promise((res) => spawn(process.execPath, [PANEL, "decir", "--ronda", dir, "--persona", persona, "--estado", "Probando", "--texto", `mensaje ${i} de ${persona} con tildes: «acción»`], { windowsHide: true }).on("close", res));
  const personas = ["ana", "luis", "marta", "pedro", "sofia"];
  await Promise.all(personas.flatMap((p) => [1, 2, 3, 4].map((i) => decir(p, i))));
  const lineas = readFileSync(join(dir, "ronda.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.equal(lineas.length, 1 + personas.length * 4, "no se perdió ningún mensaje");
  for (const l of lineas) JSON.parse(l); // ninguna línea quedó mezclada con otra
  assert.ok(lineas.some((l) => l.includes("«acción»")), "las tildes llegan intactas");
});
