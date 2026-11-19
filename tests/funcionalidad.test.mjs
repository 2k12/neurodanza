// Paso 4: documento de la funcionalidad (pedido textual y specs que leen los subagentes).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { agregarSpec, agregarTarea, archivo, componer, crear, frasesExactas, marcarHecha, paraSubagente, parsear, registrar } from "../lib/funcionalidad.mjs";

const PEDIDO = 'Agregar un filtro por estado. El botón dice «Filtrar por estado», sin resultados «No hay pedidos con ese estado» y si el estado no existe "Estado inválido".';
const proyecto = () => {
  const root = mkdtempSync(join(tmpdir(), "nd-func-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false }));
  return loadConfig(root);
};

test("funcionalidad: las frases exactas del pedido (« », “ ”, \" \", ` `)", () => {
  assert.deepEqual(frasesExactas(PEDIDO), ["Filtrar por estado", "No hay pedidos con ese estado", "Estado inválido"]);
  assert.deepEqual(frasesExactas("usa `pedidos.estado` y “Listo”"), ["pedidos.estado", "Listo"]);
  assert.deepEqual(frasesExactas('un "x" corto'), []);
});

test("funcionalidad: crear deja el pedido textual en L1 y una spec por frase; el registro va al final", () => {
  const cfg = proyecto();
  const r = crear(cfg, { tema: "Filtro por estado", pedido: PEDIDO });
  assert.equal(r.specs.length, 3);
  const md = readFileSync(archivo(cfg, "filtro-por-estado"), "utf8");
  assert.ok(md.indexOf("## Specs") < md.indexOf("## Tareas") && md.indexOf("## Tareas") < md.indexOf("## Registro"));
  assert.match(md, /\*\*S1\*\* Texto exacto: «Filtrar por estado»/);
  assert.match(md, /\*\*L1\*\* .* pedido textual del usuario:\n\n {2}> Agregar un filtro/);
  assert.throws(() => crear(cfg, { tema: "Filtro por estado", pedido: PEDIDO }), /ya existe/);
});

test("funcionalidad: specs, tareas con evidencia obligatoria y registro; el texto se conserva al reescribir", () => {
  const cfg = proyecto();
  crear(cfg, { tema: "filtro", pedido: PEDIDO });
  assert.equal(agregarSpec(cfg, { tema: "filtro", texto: "El filtro se recuerda al volver a la pantalla." }), "S4");
  agregarTarea(cfg, { tema: "filtro", id: "T1", specs: ["S1", "S4"], texto: "Botón y estado del filtro en web" });
  assert.throws(() => agregarTarea(cfg, { tema: "filtro", id: "T2", specs: ["S9"], texto: "x" }), /no existen: S9/);
  assert.throws(() => marcarHecha(cfg, { tema: "filtro", id: "T1", evidencia: "" }), /evidencia es obligatoria/);
  marcarHecha(cfg, { tema: "filtro", id: "T1", evidencia: "vitest run filtro.test.ts: 3 pasan", commit: "abc123" });
  assert.equal(registrar(cfg, { tema: "filtro", texto: "El usuario pidió que el filtro sea un menú." }), "L2");
  const doc = parsear(readFileSync(archivo(cfg, "filtro"), "utf8"));
  assert.deepEqual(doc.tareas[0], { id: "T1", hecha: true, specs: ["S1", "S4"], texto: "Botón y estado del filtro en web", evidencia: "vitest run filtro.test.ts: 3 pasan (commit abc123)" });
  assert.equal(componer(doc), readFileSync(archivo(cfg, "filtro"), "utf8"));
});

test("funcionalidad: lo que recibe un subagente trae el pedido textual y solo sus specs", () => {
  const cfg = proyecto();
  crear(cfg, { tema: "filtro", pedido: PEDIDO });
  const t = paraSubagente(cfg, "filtro", ["S3"]);
  assert.match(t, /Pedido del usuario, textual/);
  assert.match(t, /«Filtrar por estado»/);
  assert.match(t, /- S3: Texto exacto: «Estado inválido»/);
  assert.doesNotMatch(t, /- S1:/);
});

test("director: preparar con --funcionalidad lleva las frases exactas al contrato", () => {
  const root = mkdtempSync(join(tmpdir(), "nd-func-dir-"));
  const web = join(root, "web");
  execFileSync("git", ["init", "-q", web]);
  writeFileSync(join(web, "a.mjs"), "export const a = 1;\n");
  for (const a of [["config", "user.email", "t@l"], ["config", "user.name", "t"], ["add", "."], ["commit", "-qm", "i"]]) execFileSync("git", a, { cwd: web });
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "web", ruta: "web", codigo: ["**"] }], autoconfigurar: false, director: { worktrees: join(root, "..", `${root.split(/[\\/]/).pop()}-wt`) } }));
  const cfg = loadConfig(root);
  crear(cfg, { tema: "filtro", pedido: PEDIDO });
  const cli = fileURLToPath(new URL("../lib/director.mjs", import.meta.url));
  const salida = JSON.parse(execFileSync(process.execPath, [cli, "preparar", "--tarea", "t1", "--repos", "web", "--archivos", "web:**", "--objetivo", "Filtro de pedidos por estado", "--funcionalidad", "filtro", "--specs", "S1,S2,S3"], { cwd: root, encoding: "utf8" }));
  for (const f of frasesExactas(PEDIDO)) assert.ok(salida.contrato.includes(f), f);
  execFileSync(process.execPath, [cli, "descartar", "--tarea", "t1"], { cwd: root });
});
