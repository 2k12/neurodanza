import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../lib/config.mjs";
import { autoconfigurar, avisoPermisos, conBloque } from "../lib/autoconfig.mjs";
import { baseWorktrees, worktreesFuera } from "../lib/director.mjs";
import { check } from "../hooks/guardrails.mjs";

const proyecto = (esRepo) => {
  const root = mkdtempSync(join(tmpdir(), "nd-auto-"));
  if (esRepo) mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "app", ruta: "app" }] }));
  return { root, cfg: loadConfig(root) };
};

test("autoconfig: bloque del .gitignore idempotente", () => {
  const una = conBloque("node_modules/\n");
  assert.match(una, /^node_modules\/\n\n# neurodanza.*\n\.neurodanza\/\*\n!\.neurodanza\/errores\.json\n!\.neurodanza\/aprendido\/\n$/);
  assert.equal(conBloque(una), una, "no lo duplica");
  assert.equal(conBloque(".neurodanza/\n"), ".neurodanza/\n", "respeta uno que ya existía");
  assert.match(conBloque(""), /^# neurodanza/);
});

test("autoconfig: raíz que no es repo (varios repos en una carpeta principal): worktrees dentro, sin permisos ni .gitignore", () => {
  const { root, cfg } = proyecto(false);
  assert.equal(baseWorktrees(cfg), join(root, ".neurodanza", "wt"));
  assert.equal(worktreesFuera(cfg), false);
  assert.deepEqual(autoconfigurar(cfg), { mensaje: "", contexto: "" });
});

test("autoconfig: raíz que es repo: .gitignore una vez y aviso de permisos hasta que se den", () => {
  const { root, cfg } = proyecto(true);
  assert.ok(worktreesFuera(cfg));
  const a = autoconfigurar(cfg);
  assert.match(a.mensaje, /agregué al \.gitignore/);
  assert.match(a.contexto, /additionalDirectories/);
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /!\.neurodanza\/aprendido\//);
  assert.equal(autoconfigurar(cfg).mensaje, "", "la segunda vez no cambia nada");
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { additionalDirectories: ["../.neurodanza-wt"] } }));
  assert.equal(avisoPermisos(cfg), "", "con el permiso dado, no avisa");
  assert.deepEqual(autoconfigurar({ ...cfg, autoconfigurar: false }), { mensaje: "", contexto: "" });
});

test("director: el principal no edita los worktrees aunque vivan en .neurodanza/wt", () => {
  const { root, cfg } = proyecto(false);
  const on = { modo: { activo: true }, tareas: [] };
  const ev = (file_path) => ({ tool_name: "Edit", tool_input: { file_path, new_string: "x" } });
  assert.equal(check(ev(join(root, ".neurodanza", "plan.md")), cfg, undefined, on), null);
  assert.match(check(ev(join(root, ".neurodanza", "wt", "t1", "app", "a.ts")), cfg, undefined, on), /no edita código/);
});
