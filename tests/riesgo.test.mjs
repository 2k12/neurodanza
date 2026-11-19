import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { lineasEnRama, lineasPorArchivo } from "../lib/cambios.mjs";
import { loadConfig, merge } from "../lib/config.mjs";
import { archivosConPatron } from "../lib/cambios.mjs";
import { archivosPrevistos, nivelDe, patronPermisos, planDe, riesgoDe, textoRiesgo } from "../lib/riesgo.mjs";
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

test("riesgo: los topes de líneas cuentan solo código (no el repo de docs, docs ni pruebas)", () => {
  // Caso real: ~40 líneas de código en el frontend; el repo de docs en una rama larga con 2578 líneas y pruebas nuevas.
  const changes = { frontend: ["app/pedidos/page.tsx", "app/pedidos/page.test.tsx", "content/guia.md"], docs: ["guia.md", "x.json"] };
  const lineas = { frontend: { "app/pedidos/page.tsx": 35, "app/pedidos/page.test.tsx": 29, "content/guia.md": 2 }, docs: { "guia.md": 2500, "x.json": 78 } };
  const r = nivelDe(cfg, changes, lineas);
  assert.equal(r.lineas, 35);
  assert.equal(r.nivel, "bajo");
  // Con la forma por repo, el repo de docs tampoco suma.
  assert.equal(nivelDe(cfg, { frontend: ["app/pedidos/page.tsx"], docs: ["guia.md"] }, { frontend: 90, docs: 2578 }).lineas, 90);
  // Un nombre sensible fuera del código (evaluación en el repo de docs, guía, prueba) no sube a alto.
  const fuera = { frontend: ["app/pedidos/page.tsx", "app/auth/login.test.tsx", "content/guias/permisos.md"], docs: ["evaluaciones/v1-permisos-lectura.json"] };
  assert.equal(nivelDe(cfg, fuera, { frontend: { "app/pedidos/page.tsx": 10 }, docs: { "evaluaciones/v1-permisos-lectura.json": 300 } }).nivel, "bajo");
  // Pocas líneas que tocan permisos en el código: medio, y entra el revisor de permisos.
  const chico = { frontend: ["app/embarques/lista.tsx"] };
  const conPerm = riesgoDe(cfg, chico, { frontend: { "app/embarques/lista.tsx": 11 } }, { revisores: ["revisor-ui"], permisos: { frontend: ["app/embarques/lista.tsx"] } });
  assert.equal(conPerm.nivel, "medio");
  assert.deepEqual(conPerm.plan.lanzar, ["revisor-permisos"]);
  assert.equal(riesgoDe(cfg, chico, { frontend: { "app/embarques/lista.tsx": 11 } }, { permisos: { frontend: [] } }).nivel, "bajo");
  // El patrón por defecto ve los permisos del caso real y no un cambio de interfaz.
  const re = patronPermisos(cfg);
  for (const l of ['const canRead = useCan("dispatch.read");', '<NoAccess permission="invoices.read" />', "if (!ability.can('read', x)) throw new ForbiddenException();", "if (can('update', pedido))"]) assert.ok(re.test(l), l);
  for (const l of ['<button role="tab" onClick={() => setOpen(true)}>', "const canvas = useRef(null);", "const role = 'dialog';"]) assert.ok(!re.test(l), l);
  // El código sí cuenta: 401 líneas de código siguen siendo alto.
  assert.equal(nivelDe(cfg, { backend: ["src/pedidos/pedidos.service.ts", "src/x.spec.ts"] }, { backend: { "src/pedidos/pedidos.service.ts": 401, "src/x.spec.ts": 900 } }).nivel, "alto");
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
    assert.deepEqual(lineasPorArchivo(c, "main"), { r: { "a.ts": 2, "src/b.ts": 2 } });
    // Permisos en las líneas cambiadas: en commit, sin commit, en un archivo nuevo y en uno borrado.
    g("add", "-A");
    g("commit", "-qm", "b");
    writeFileSync(join(dir, "c.ts"), "const ok = hasRole('ADMIN');\n");
    g("add", "c.ts");
    g("commit", "-qm", "c");
    g("checkout", "-q", "main");
    writeFileSync(join(dir, "d.ts"), "if (isAdmin) borrar();\n");
    g("add", "d.ts");
    g("commit", "-qm", "d");
    g("checkout", "-q", "rama");
    g("merge", "-q", "main");
    g("rm", "-q", "d.ts");
    g("commit", "-qm", "sin d");
    writeFileSync(join(dir, "src", "b.ts"), 'x\nconst ok = useCan("pedidos.read");\n');
    assert.deepEqual(archivosConPatron(c, "main", patronPermisos(cfg)).r.sort(), ["c.ts", "d.ts", "src/b.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
