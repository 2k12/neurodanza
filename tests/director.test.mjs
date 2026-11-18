import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { contrato, descartar, enWorktree, fueraDeContrato, integrar, leerTareas, parseArchivos, preparar, tareaValida } from "../lib/director.mjs";
import { check, modifica } from "../hooks/guardrails.mjs";

const EJ = fileURLToPath(new URL("../ejemplos/nest-next/", import.meta.url));
const cfg = loadConfig(EJ);
const ev = (tool_name, tool_input, agent_id) => ({ tool_name, tool_input, ...(agent_id ? { agent_id } : {}) });

test("director: contrato, archivos y worktrees (funciones puras)", () => {
  assert.ok(tareaValida("pedidos-api"));
  assert.ok(!tareaValida("../x"));
  assert.deepEqual(parseArchivos("backend:src/pedidos/**, frontend:app/pedidos/**,docs/**"), { backend: ["src/pedidos/**"], frontend: ["app/pedidos/**"], "*": ["docs/**"] });
  const arch = parseArchivos("backend:src/pedidos/**");
  assert.deepEqual(fueraDeContrato("backend", ["src/pedidos/a.ts", "src/auth/b.ts"], arch), ["src/auth/b.ts"]);
  assert.deepEqual(fueraDeContrato("frontend", ["x.ts"], {}), [], "sin globs no restringe");
  const t = { id: "t1", archivos: arch, repos: [{ nombre: "backend", ruta: "C:/wt/proj/t1/backend" }] };
  assert.equal(enWorktree([t], "C:\\wt\\proj\\t1\\backend\\src\\a.ts").rel, "src/a.ts");
  assert.equal(enWorktree([t], "C:/otro/a.ts"), null);
  assert.match(contrato({ tarea: "t1", objetivo: "x", repos: t.repos, archivos: arch, terminado: "pruebas", maxPasos: 60 }), /Presupuesto: 60 pasos/);
});

test("director: barreras para el principal y para los subagentes", () => {
  const on = { modo: { activo: true }, tareas: [] };
  const edit = ev("Edit", { file_path: join(EJ, "backend/src/a.ts"), new_string: "x" });
  assert.match(check(edit, cfg, undefined, on), /no edita código/);
  assert.equal(check(edit, cfg, undefined, { modo: { activo: false }, tareas: [] }), null, "sin modo director, edita");
  assert.equal(check(ev("Write", { file_path: join(EJ, ".neurodanza/plan.md"), content: "- [ ] 1" }), cfg, undefined, on), null, "el plan sí");
  assert.match(check(ev("Bash", { command: "sed -i 's/a/b/' src/a.ts" }), cfg, undefined, on), /modifica archivos/);
  assert.equal(check(ev("Bash", { command: "pnpm lint && pnpm test 2>&1 | tail -5" }), cfg, undefined, on), null);
  assert.equal(check(ev("Bash", { command: 'node "/p/lib/director.mjs" integrar --tarea t1' }), cfg, undefined, on), null);
  assert.equal(check(ev("Bash", { command: 'git commit -m "feat: x > y"' }), cfg, undefined, on), null);

  const t = { id: "t1", archivos: { backend: ["src/pedidos/**"] }, repos: [{ nombre: "backend", ruta: "C:/wt/nest-next/t1/backend" }] };
  const ctx = { modo: { activo: true }, tareas: [t] };
  assert.equal(check(ev("Edit", { file_path: "C:/wt/nest-next/t1/backend/src/pedidos/a.ts", new_string: "x" }, "ag1"), cfg, undefined, ctx), null);
  assert.match(check(ev("Edit", { file_path: "C:/wt/nest-next/t1/backend/src/auth/a.ts", new_string: "x" }, "ag1"), cfg, undefined, ctx), /Fuera del contrato/);
  assert.match(check(ev("Edit", { file_path: join(EJ, "backend/src/pedidos/a.ts"), new_string: "x" }, "ag1"), cfg, undefined, ctx), /worktree de tu tarea/);
  // Las rutas protegidas valen también dentro del worktree.
  const t2 = { ...t, archivos: {} };
  assert.match(check(ev("Edit", { file_path: "C:/wt/nest-next/t1/backend/src/modules/einvoice/legacy-xml.ts", new_string: "x" }, "ag1"), cfg, undefined, { modo: { activo: true }, tareas: [t2] }), /congelado/);
  assert.ok(modifica("echo hola > a.txt") && !modifica("pnpm test > /dev/null 2>&1") && !modifica('echo "a > b"'));
});

test("director: preparar, integrar solo lo del contrato y descartar (git real)", () => {
  const root = mkdtempSync(join(tmpdir(), "nd-dir-"));
  const app = join(root, "app");
  mkdirSync(join(app, "src"), { recursive: true });
  mkdirSync(join(app, "node_modules", "dep"), { recursive: true });
  const g = (...a) => execFileSync("git", a, { cwd: app, stdio: "pipe" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  writeFileSync(join(app, ".gitignore"), "node_modules/\n");
  writeFileSync(join(app, "src", "a.ts"), "export const a = 1\n");
  writeFileSync(join(app, "src", "b.ts"), "export const b = 1\n");
  writeFileSync(join(app, "node_modules", "dep", "index.js"), "dep\n");
  g("add", ".");
  g("commit", "-qm", "init");
  writeFileSync(join(app, "src", "c.ts"), "export const c = 1\n"); // sin commit: el worktree debe verlo
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "app", ruta: "app", codigo: ["src/**"] }], director: { worktrees: "wt/{proyecto}" } }));
  const c = loadConfig(root);

  const t = preparar(c, { tarea: "t1", repos: ["app"], archivos: { app: ["src/a.ts"] } });
  const wt = t.repos[0].ruta;
  assert.ok(existsSync(join(wt, "src", "c.ts")), "la base incluye lo que no está en commit");
  assert.equal(readFileSync(join(wt, "node_modules", "dep", "index.js"), "utf8"), "dep\n", "dependencias enlazadas");
  writeFileSync(join(wt, "src", "a.ts"), "export const a = 2\n");
  writeFileSync(join(wt, "src", "b.ts"), "fuera\n");
  const r1 = integrar(c, "t1");
  assert.equal(r1.ok, false);
  assert.deepEqual(r1.fuera, ["app/src/b.ts"]);
  writeFileSync(join(wt, "src", "b.ts"), "export const b = 1\n");
  const r2 = integrar(c, "t1");
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.aplicados, ["app/src/a.ts"]);
  assert.equal(readFileSync(join(app, "src", "a.ts"), "utf8").replace(/\r\n/g, "\n"), "export const a = 2\n");
  assert.ok(!existsSync(wt), "el worktree se borra");
  assert.equal(readFileSync(join(app, "node_modules", "dep", "index.js"), "utf8"), "dep\n", "las dependencias reales quedan intactas");
  assert.equal(leerTareas(c).length, 0);

  preparar(c, { tarea: "t2", repos: ["app"], archivos: {} });
  descartar(c, "t2");
  assert.equal(leerTareas(c).length, 0);
  assert.equal(readFileSync(join(app, "node_modules", "dep", "index.js"), "utf8"), "dep\n");
});
