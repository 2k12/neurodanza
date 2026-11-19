// Paso 3: comentarios (barreras.comentarios y la regla ESLint en modo estricto).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { check } from "../hooks/guardrails.mjs";
import { comentariosDe, comentariosProhibidos } from "../lib/comentarios.mjs";
import { DEFAULTS, merge } from "../lib/config.mjs";
import plugin from "../eslint/no-junk-comments.mjs";

const ctx = { modo: { activo: false }, tareas: [] };
const proyecto = (comentarios) => {
  const root = mkdtempSync(join(tmpdir(), "nd-com-"));
  return { ...merge(DEFAULTS, { barreras: { comentarios } }), root, abs: (p) => join(root, p) };
};

test("comentarios: no confunde // dentro de textos, URLs, plantillas ni expresiones regulares", () => {
  assert.equal(comentariosDe("const u = 'http://x/y';\nconst t = \"a // b\";\nconst r = /\\/\\/x/g;\n").length, 0);
  assert.equal(comentariosDe("const s = `a ${b} // c`;\n").length, 0);
  assert.deepEqual(comentariosDe("const s = `a ${x // dentro\n} b`;\n").map((c) => c.texto.trim()), ["dentro"]);
  assert.deepEqual(comentariosDe("const d = a / b; // división\n").map((c) => c.texto.trim()), ["división"]);
  assert.deepEqual(comentariosDe("<div>{/* nota */}</div>\n").map((c) => c.texto.trim()), ["nota"]);
});

test("comentarios estricto: solo directivas, JSDoc con etiquetas de lo exportado y POR QUÉ", () => {
  const malos = (src) => comentariosProhibidos("", src, "estricto").map((c) => c.motivo);
  assert.deepEqual(malos("// Calcula el total\nconst t = 1;\n"), ["comentario explicativo"]);
  assert.deepEqual(malos("/** Interna. */\nfunction a() {}\n"), ["JSDoc de algo que no se exporta"]);
  assert.match(malos("/** Total del pedido. */\nexport function total() {}\n")[0], /sin etiquetas de API/);
  assert.deepEqual(malos("/**\n * Total.\n * @param {object} p\n */\nexport function total(p) {}\n"), []);
  assert.deepEqual(malos("// POR QUÉ: el SRI rechaza más de 2 decimales.\nconst m = 1;\n"), []);
  assert.deepEqual(malos("// eslint-disable-next-line no-console\nconsole.log(1);\n// @ts-expect-error sin tipos\nimport x from 'y';\n"), []);
  assert.deepEqual(malos("#!/usr/bin/env node\nconst a = 1;\n"), []);
});

test("comentarios basura: solo código comentado y TODO sin ticket", () => {
  const malos = (src) => comentariosProhibidos("", src, "basura").map((c) => c.motivo);
  assert.deepEqual(malos("// Calcula el total\nconst t = 1;\n"), []);
  assert.match(malos("// const viejo = calcular(x);\n")[0], /código comentado/);
  assert.match(malos("// TODO arreglar\n")[0], /TODO sin ticket/);
  assert.deepEqual(malos("// TODO(#12): arreglar\n"), []);
});

test("comentarios: los que ya estaban no cuentan (solo los nuevos)", () => {
  const antes = "// Calcula el total\nconst t = 1;\n";
  assert.deepEqual(comentariosProhibidos(antes, `${antes}const u = 2;\n`, "estricto"), []);
  assert.equal(comentariosProhibidos(antes, `${antes}// otro\nconst u = 2;\n`, "estricto").length, 1);
});

test("barrera: rechaza al editar los comentarios nuevos que no van; apagada no hace nada", () => {
  const cfg = proyecto("estricto");
  const f = join(cfg.root, "src", "a.ts");
  const edit = (old_string, new_string) => check({ tool_name: "Edit", tool_input: { file_path: f, old_string, new_string } }, cfg, () => true, ctx);
  assert.match(edit("const t = 1;", "// suma\nconst t = 1;"), /comentarios que no van .*línea 1: «\/\/suma»/);
  assert.equal(edit("// viejo\nconst t = 1;", "// viejo\nconst t = 2;"), null);
  assert.equal(check({ tool_name: "Write", tool_input: { file_path: join(cfg.root, "README.md"), content: "// no es código" } }, cfg, () => false, ctx), null);
  const existente = join(cfg.root, "b.ts");
  writeFileSync(existente, "// ya estaba\nexport const a = 1;\n");
  assert.equal(check({ tool_name: "Write", tool_input: { file_path: existente, content: "// ya estaba\nexport const a = 2;\n" } }, cfg, (p) => p === existente, ctx), null);
  assert.equal(check({ tool_name: "Edit", tool_input: { file_path: f, old_string: "a", new_string: "// suma\nb" } }, proyecto(false), () => true, ctx), null);
});

/** Corre la regla ESLint sobre un texto con un contexto mínimo (sin ESLint instalado). */
function eslint(src, opciones = []) {
  const reportes = [];
  const comentarios = comentariosDe(src).map((c) => ({ type: c.tipo === "linea" ? "Line" : "Block", value: c.texto, loc: { start: { line: c.linea } }, fin: c.fin }));
  const sourceCode = {
    getAllComments: () => comentarios,
    getTokenAfter: (c) => ({ value: (src.slice(c.fin).match(/^\s*([\w$]+|\S)/) ?? [])[1] }),
  };
  plugin.rules["no-junk-comments"].create({ sourceCode, options: opciones, report: (r) => reportes.push(r.messageId) }).Program();
  return reportes;
}

test("regla ESLint: modo estricto con el mismo criterio que la barrera", () => {
  assert.deepEqual(eslint("// suma\nconst a = 1;\n"), []);
  assert.deepEqual(eslint("// suma\nconst a = 1;\n", [{ modo: "estricto" }]), ["estricto"]);
  assert.deepEqual(eslint("/**\n * @param {number} a\n */\nexport function f(a) {}\n", [{ modo: "estricto" }]), []);
  assert.deepEqual(eslint("/** Prosa. */\nexport function f() {}\n", [{ modo: "estricto" }]), ["estricto"]);
  assert.deepEqual(eslint("// POR QUÉ: requisito del SRI.\nconst a = 1;\n// eslint-disable-next-line\nb();\n", [{ modo: "estricto" }]), []);
  assert.deepEqual(eslint("// TODO arreglar\n", [{ modo: "estricto" }]), ["task"]);
});
