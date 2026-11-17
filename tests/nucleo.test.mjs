import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULTS, globToRegExp, loadConfig, merge, repoOf, validate } from "../lib/config.mjs";
import { changedMatching, doneProblems, parseStatus } from "../hooks/feedback.mjs";

const EJ = fileURLToPath(new URL("../ejemplos/nest-next/", import.meta.url));
const cfg = loadConfig(EJ);

test("configuración: carga, valores por defecto, validación y búsqueda hacia arriba", () => {
  assert.ok(cfg, "carga el ejemplo nest-next");
  assert.equal(cfg.panel.umbral, 8.99);
  assert.equal(cfg.panel.ventana, "windows");
  assert.ok(cfg.reglas.ui.length > 0);
  assert.equal(loadConfig(join(EJ, "sub", "carpeta")).file, cfg.file, "la encuentra desde una subcarpeta");
  assert.equal(loadConfig(mkdtempSync(join(tmpdir(), "nd-"))), null, "sin archivo no hace nada");
  assert.deepEqual(validate(merge(DEFAULTS, { panel: { ventana: "claude" } })), ['panel.ventana: "windows" o "ninguna"']);
  const bad = mkdtempSync(join(tmpdir(), "nd-"));
  writeFileSync(join(bad, "neurodanza.config.json"), "{ no json");
  assert.throws(() => loadConfig(bad), /JSON inválido/);
});

test("globs: **, *, ? y {a,b}", () => {
  assert.ok(globToRegExp("src/**/*.ts").test("src/a/b.ts"));
  assert.ok(globToRegExp("src/**/*.ts").test("src/b.ts"));
  assert.ok(globToRegExp("**/x*.{mjs,ts}").test("a/b/x1.ts"));
  assert.ok(!globToRegExp("*.md").test("docs/a.md"));
  assert.equal(repoOf(cfg, join(EJ, "frontend", "app", "page.tsx")).rel, "app/page.tsx");
});

test("retroalimentación: estado de git y cambios por repo:glob", () => {
  assert.deepEqual(parseStatus(" M app/a.tsx\n?? x.ts\n D old.ts\nR  a.ts -> b.ts\n"), ["app/a.tsx", "x.ts", "b.ts"]);
  const changes = { frontend: ["app/app/pedidos/page.tsx", "content/guias/pedidos.md"], backend: [], docs: [] };
  assert.deepEqual(changedMatching(changes, ["frontend:content/guias/**"]), ["frontend/content/guias/pedidos.md"]);
  assert.deepEqual(changedMatching(changes, ["**/page.tsx"]), ["frontend/app/app/pedidos/page.tsx"]);
});

test("definición de terminado: versión, bitácora, migración, panel, guía, evals y docs", () => {
  const ok = { bitacoraExists: () => true, panelApproved: () => true, evalsApproved: () => true };
  const sameVersion = doneProblems(cfg, { frontend: ["features/a.ts"], docs: ["x.md"] }, { ...ok, version: "1.2.0", baseVersion: "1.2.0" });
  assert.match(sameVersion.hard.join(), /versión sigue en 1.2.0/);
  const noLog = doneProblems(cfg, { frontend: ["features/a.ts"], docs: ["x"] }, { ...ok, version: "1.3.0", baseVersion: "1.2.0", bitacoraExists: () => false });
  assert.match(noLog.hard.join(), /bitácora de la versión 1.3/);
  const schema = doneProblems(cfg, { backend: ["prisma/schema.prisma"], docs: ["x"] }, { ...ok, version: "", baseVersion: "" });
  assert.match(schema.hard.join(), /migración nueva/);
  const screens = doneProblems(cfg, { frontend: ["app/app/pedidos/page.tsx"], docs: ["x"] }, { ...ok, version: "1.3.0", baseVersion: "1.2.0", panelApproved: () => false });
  assert.match(screens.hard.join(), /panel de personas/);
  assert.match(screens.soft.join(), /guía/);
  const tooling = doneProblems(cfg, { frontend: [".claude/agents/x.md"], docs: ["x"] }, { ...ok, version: "1.3.0", baseVersion: "1.2.0", evalsApproved: () => false });
  assert.match(tooling.soft.join(), /neurodanza-evals/);
  const noDocs = doneProblems(cfg, { backend: ["src/a.ts"], docs: [] }, { ...ok, version: "", baseVersion: "" });
  assert.match(noDocs.soft.join(), /ninguno en docs/);
  const clean = doneProblems(cfg, { frontend: ["features/a.ts", "content/guias/a.md"], docs: ["bitacora/v1.3.md"] }, { ...ok, version: "1.3.0", baseVersion: "1.2.0" });
  assert.deepEqual(clean, { hard: [], soft: [] });
});
