import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { lineasEnRama } from "../lib/cambios.mjs";
import { loadConfig, merge } from "../lib/config.mjs";
import { archivosPrevistos, nivelDe, planDe, riesgoDe, textoRiesgo } from "../lib/riesgo.mjs";
import { doneProblems } from "../hooks/feedback.mjs";

const cfg = loadConfig(fileURLToPath(new URL("../ejemplos/nest-next/", import.meta.url)));

test("riesgo: bajo con solo docs o pruebas, o pocas líneas en un repo sin contratos", () => {
  assert.equal(nivelDe(cfg, { docs: ["guia.md"] }, { docs: 300 }).nivel, "bajo");
  assert.equal(nivelDe(cfg, { backend: ["src/pedidos/pedidos.service.spec.ts"] }, { backend: 120 }).nivel, "bajo");
  assert.equal(nivelDe(cfg, { frontend: ["app/pedidos/page.tsx"] }, { frontend: 6 }).nivel, "bajo");
});

test("riesgo: medio con contratos, más de lineasBajo o sin diff todavía", () => {
  assert.equal(nivelDe(cfg, { backend: ["src/pedidos/dto/crear-pedido.dto.ts"] }, { backend: 4 }).nivel, "medio");
  assert.equal(nivelDe(cfg, { backend: ["src/pedidos/pedidos.service.ts"] }, { backend: 90 }).nivel, "medio");
  assert.equal(nivelDe(cfg, { backend: ["src/pedidos/pedidos.service.ts"] }, null).nivel, "medio");
});

test("riesgo: alto con archivos sensibles, migraciones, dos repos o más de lineasAlto", () => {
  assert.equal(nivelDe(cfg, { backend: ["src/auth/jwt.guard.ts"] }, { backend: 3 }).nivel, "alto");
  assert.equal(nivelDe(cfg, { backend: ["prisma/migrations/20260101_x/migration.sql"] }, { backend: 3 }).nivel, "alto");
  assert.equal(nivelDe(cfg, { backend: ["src/pedidos/pedidos.service.ts"], frontend: ["app/pedidos/page.tsx"] }, { backend: 5, frontend: 5 }).nivel, "alto");
  assert.equal(nivelDe(cfg, { backend: ["src/pedidos/pedidos.service.ts"] }, { backend: 401 }).nivel, "alto");
});

test("riesgo: el plan de cada nivel (y ciclo.revisores todos o riesgo apagado = ciclo completo)", () => {
  const rev = ["revisor-ui", "revisor-permisos", "revisor-docs"];
  assert.deepEqual(planDe(cfg, "bajo", { revisores: rev, pantallas: true }).lanzar, []);
  const medio = planDe(cfg, "medio", { revisores: rev, pantallas: true, fantasmas: true });
  assert.deepEqual(medio.lanzar, ["revisor-permisos"]);
  assert.equal(medio.personas, 1);
  assert.equal(medio.fantasmas, 1);
  const alto = planDe(cfg, "alto", { revisores: rev, pantallas: true, repos: 2 });
  assert.deepEqual(alto.lanzar, ["revisor-permisos", "revisor-ui", "revisor-docs"]);
  assert.equal(alto.personas, cfg.panel.min);
  assert.equal(alto.especialistas, 2);
  assert.equal(planDe(merge(cfg, { ciclo: { revisores: "todos" } }), "bajo", { revisores: rev }).revisores, 4);
  const apagado = riesgoDe(merge(cfg, { ciclo: { riesgo: { activo: false } } }), { frontend: ["app/pedidos/page.tsx"] }, { frontend: 1 }, { revisores: rev });
  assert.equal(apagado.nivel, "alto");
  assert.match(textoRiesgo(apagado), /Riesgo alto/);
});

test("riesgo: los globs del plan se juzgan como un archivo que coincide", () => {
  assert.deepEqual(archivosPrevistos("backend:src/pedidos/**,frontend:app/x/page.tsx"), { backend: ["src/pedidos/x/x.ts"], frontend: ["app/x/page.tsx"] });
  assert.equal(nivelDe(cfg, archivosPrevistos("backend:src/auth/**"), null).nivel, "alto");
});

test("Stop: con riesgo bajo, cambiar pantallas sin panel avisa y no bloquea", () => {
  const ok = { version: "1.3.0", baseVersion: "1.2.0", bitacoraExists: () => true, panelApproved: () => false, evalsApproved: () => true, docsInBranch: true };
  const changes = { frontend: ["app/app/pedidos/page.tsx"], docs: ["x"] };
  const bajo = doneProblems(cfg, changes, { ...ok, riesgo: riesgoDe(cfg, { frontend: ["app/pedidos/page.tsx"] }, { frontend: 2 }) });
  assert.ok(!bajo.hard.some((h) => /panel de personas/.test(h)));
  assert.ok(bajo.soft.some((s) => /riesgo bajo/.test(s)));
  const alto = doneProblems(cfg, changes, { ...ok, riesgo: riesgoDe(cfg, { frontend: ["app/auth/page.tsx"] }, { frontend: 2 }) });
  assert.ok(alto.hard.some((h) => /panel de personas/.test(h)));
});

test("líneas en la rama: commits, cambios sin commit y archivos nuevos", () => {
  const dir = mkdtempSync(join(tmpdir(), "nd-lineas-"));
  try {
    const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@localhost");
    g("config", "user.name", "t");
    writeFileSync(join(dir, "a.ts"), "uno\ndos\n");
    g("add", ".");
    g("commit", "-qm", "inicio");
    g("checkout", "-qb", "rama");
    writeFileSync(join(dir, "a.ts"), "uno\ndos\ntres\n");
    g("commit", "-qam", "tres");
    writeFileSync(join(dir, "a.ts"), "uno\ndos\ntres\ncuatro\n");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "b.ts"), "x\ny\n");
    const c = { repos: [{ nombre: "r", ruta: dir }], abs: (p) => p };
    assert.deepEqual(lineasEnRama(c, "main"), { r: 4 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
