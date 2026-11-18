import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { aplicarReflexion, etiquetaValida, evaluarTodo, juzgar, playbookTexto } from "../lib/constructos.mjs";
import { contrato } from "../lib/director.mjs";

const FE = "implementador-frontend";
const aria = { constructo: FE, etiqueta: "ui:aria-label-icono", fuente: "revisor-ui", detalle: "botón sin aria-label", leccion: "Todo botón de solo icono lleva aria-label." };
const ciclo = (n, problemas = [], agentes = [{ constructo: FE }]) => ({ ciclo: `c${n}`, agentes, problemas });
const nuevo = () => ({ constructos: {}, ciclos: [] });
const leccion = (d, c, e) => d.constructos[c].lecciones.find((l) => l.etiqueta === e);

test("constructos: candidata → a prueba con 2 evidencias → aprobada si el problema baja", () => {
  const d = nuevo();
  assert.deepEqual(aplicarReflexion(d, ciclo(1, [aria])), []);
  assert.equal(leccion(d, FE, aria.etiqueta).estado, "candidata");
  assert.equal(playbookTexto(d, FE), "", "una candidata no entra al playbook");
  aplicarReflexion(d, ciclo(2));
  const cambios = aplicarReflexion(d, ciclo(3, [aria]));
  assert.deepEqual(cambios, [{ constructo: FE, etiqueta: aria.etiqueta, estado: "a prueba" }]);
  assert.match(playbookTexto(d, FE), /aria-label\. \(a prueba\)/);
  // Dos ciclos a prueba: todavía no se juzga.
  aplicarReflexion(d, ciclo(4));
  aplicarReflexion(d, ciclo(5));
  assert.deepEqual(evaluarTodo(d), []);
  assert.match(leccion(d, FE, aria.etiqueta).ultimoJuicio, /2\/3 ciclos/);
  // Tercer ciclo limpio: antes 2 en 3 ciclos, después 0 en 3 → aprobada.
  aplicarReflexion(d, ciclo(6));
  const [c] = evaluarTodo(d);
  assert.equal(c.estado, "aprobada");
  assert.match(c.motivo, /0\.67 → 0\.00/);
  assert.doesNotMatch(playbookTexto(d, FE), /a prueba/);
});

test("constructos: se descarta si el problema no baja; otro constructo no cuenta", () => {
  const d = nuevo();
  aplicarReflexion(d, ciclo(1, [aria]));
  aplicarReflexion(d, ciclo(2, [aria]));
  for (let i = 3; i <= 5; i++) aplicarReflexion(d, ciclo(i, [aria]));
  aplicarReflexion(d, { ciclo: "otro", agentes: [{ constructo: "implementador-backend" }], problemas: [] });
  const [c] = evaluarTodo(d);
  assert.equal(c.estado, "descartada");
  assert.match(c.motivo, /no bajó/);
  assert.equal(playbookTexto(d, FE), "", "la descartada sale del playbook");
});

test("constructos: un revisor necesita evals posteriores que no empeoren", () => {
  const d = nuevo();
  const rev = { ...aria, constructo: "revisor-ui", etiqueta: "ui:contraste" };
  const rc = (n, p = []) => ({ ciclo: `r${n}`, agentes: [{ constructo: "revisor-ui" }], problemas: p });
  aplicarReflexion(d, rc(1, [rev]));
  aplicarReflexion(d, rc(2, [rev]));
  for (let i = 3; i <= 5; i++) aplicarReflexion(d, rc(i));
  const l = leccion(d, "revisor-ui", "ui:contraste");
  assert.equal(juzgar(d, "revisor-ui", l).decision, "sigue", "sin evals no se decide");
  const antes = { informe: { aprobado: true, deteccion: 0.9, falsosPositivos: 0 } };
  assert.equal(juzgar(d, "revisor-ui", l, {}, { antes, despues: { informe: { aprobado: true, deteccion: 0.8, falsosPositivos: 0 } } }).decision, "descartada");
  assert.equal(juzgar(d, "revisor-ui", l, {}, { antes, despues: { informe: { aprobado: true, deteccion: 0.95, falsosPositivos: 0 } } }).decision, "aprobada");
});

test("constructos: tope del playbook, etiquetas y contrato con lecciones", () => {
  const d = nuevo();
  for (let i = 0; i < 4; i++) {
    const p = { ...aria, etiqueta: `ui:tema-${i}`, leccion: `Lección ${i}` };
    aplicarReflexion(d, ciclo(`a${i}`, [p]));
    aplicarReflexion(d, ciclo(`b${i}`, [p]));
  }
  for (const l of d.constructos[FE].lecciones) l.estado = "aprobada";
  const cambios = evaluarTodo(d, { maxLecciones: 2 });
  assert.equal(cambios.filter((c) => c.estado === "archivada").length, 2);
  assert.ok(etiquetaValida("ui:aria-label") && !etiquetaValida("UI aria") && !etiquetaValida("ui"));
  const txt = contrato({ tarea: "t1", objetivo: "x", repos: [], archivos: {}, terminado: "y", maxPasos: 60, constructo: FE, lecciones: playbookTexto(d, FE) });
  assert.match(txt, /Constructo: implementador-frontend/);
  assert.match(txt, /Lecciones de este proyecto para implementador-frontend/);
});

test("constructos: la CLI registra la reflexión y escribe playbook y CHANGELOG", () => {
  const root = mkdtempSync(join(tmpdir(), "nd-con-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [] }));
  const cli = fileURLToPath(new URL("../lib/constructos.mjs", import.meta.url));
  const run = (...a) => execFileSync(process.execPath, [cli, ...a], { cwd: root, encoding: "utf8" });
  for (const n of [1, 2]) {
    writeFileSync(join(root, `r${n}.json`), JSON.stringify(ciclo(n, [aria])));
    run("reflexion", "--archivo", join(root, `r${n}.json`));
  }
  const dir = join(root, ".neurodanza", "constructos", FE);
  assert.ok(existsSync(join(dir, "playbook.md")));
  assert.match(readFileSync(join(dir, "playbook.md"), "utf8"), /## A prueba/);
  assert.match(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), /ui:aria-label-icono` → \*\*a prueba\*\*/);
  assert.match(run("playbook", "--constructo", FE), /aria-label/);
});

test("aprendido: lo aprobado se comparte en un archivo versionado que manda", async () => {
  const { sincronizar, leerAprendido, compartidoDe, parseAprendido } = await import("../lib/constructos.mjs");
  const dir = mkdtempSync(join(tmpdir(), "nd-apr-"));
  const d = { constructos: { [FE]: { lecciones: [{ etiqueta: "ui:aria-label-icono", texto: "Todo botón de solo icono lleva aria-label.", estado: "aprobada", evidencias: [] }, { etiqueta: "ui:foco", texto: "Foco visible.", estado: "a prueba", evidencias: [] }], cambios: [] } }, ciclos: [] };
  assert.deepEqual(sincronizar(dir, d), [FE]);
  assert.deepEqual(leerAprendido(dir, FE), [{ texto: "Todo botón de solo icono lleva aria-label.", etiqueta: "ui:aria-label-icono" }], "solo las aprobadas");
  assert.deepEqual(sincronizar(dir, d), [], "sin cambios no reescribe");
  // El equipo borra la línea en un PR: el agente deja de usarla aunque localmente siga aprobada.
  writeFileSync(join(dir, `${FE}.md`), "# Aprendido\n");
  assert.doesNotMatch(playbookTexto(d, FE, leerAprendido(dir, FE)), /aria-label/);
  assert.match(playbookTexto(d, FE, leerAprendido(dir, FE)), /Foco visible\. \(a prueba\)/);
  // Una aprobada que se descarta sale del archivo.
  writeFileSync(join(dir, `${FE}.md`), "- Todo botón de solo icono lleva aria-label. `ui:aria-label-icono`\n");
  d.constructos[FE].lecciones[0].estado = "descartada";
  sincronizar(dir, d);
  assert.deepEqual(parseAprendido(readFileSync(join(dir, `${FE}.md`), "utf8")), []);
  // Dónde: raíz repo → raíz; si no, el repo de docs; si no hay, local.
  const base = { root: "/p", abs: (p) => join("/p", p), repos: [{ nombre: "docs", ruta: "docs" }], retroalimentacion: { docs: "docs" } };
  assert.equal(compartidoDe(base), join("/p", "docs", ".neurodanza", "aprendido"));
  assert.equal(compartidoDe({ ...base, retroalimentacion: {} }), null);
  assert.equal(compartidoDe({ ...base, constructos: { compartido: "local" } }), null);
});
