import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { claveDiff } from "../lib/portero.mjs";
import { agenteDe, aprobados, enStop, informe, lanzarRevisiones, leerRevisiones, pedidoRevision, revisar, revisionEnStop } from "../lib/revision.mjs";

const DIFF = "--- a/api/x.ts\n+++ b/api/x.ts\n@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const c = 2;\n";
const plan = (lanzar) => ({ nivel: "medio", plan: { lanzar } });

function proyecto(rv = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-revision-test-"));
  return { root, repos: [], abs: (p) => (isAbsolute(p) ? p : join(root, p)), ciclo: { revisionEnStop: { activo: true, maxLineas: 1500, timeoutSeg: 300, ...rv } } };
}
// Corre la revisión en el mismo proceso, con un modelo de mentira.
const enProceso = (respuesta) => (cfg, id) => revisar(cfg, id, { llamar: async () => (typeof respuesta === "string" ? { texto: respuesta, costo: 0.01 } : respuesta) });

test("revisión: el pedido trae el diff y el revisor sale de su .md", () => {
  assert.match(pedidoRevision("revisor-permisos", DIFF), /```diff\n--- a\/api\/x\.ts[\s\S]*```$/);
  const a = agenteDe("revisor-permisos");
  assert.ok(a.modelo && a.sistema.length > 100 && !a.sistema.startsWith("---"));
});

test("revisión: apagada o sin revisores no hace nada; el agente los sigue lanzando", async () => {
  const cfg = proyecto({ activo: false });
  try {
    assert.deepEqual(await revisionEnStop(cfg, plan(["revisor-permisos"]), { diff: DIFF }), { problemas: [], notas: [] });
    assert.deepEqual(enStop(cfg, plan(["revisor-permisos"]), "main", DIFF), []);
    cfg.ciclo.revisionEnStop.activo = true;
    assert.deepEqual(await revisionEnStop(cfg, plan([]), { diff: DIFF }), { problemas: [], notas: [] });
    assert.deepEqual(enStop(cfg, plan(["revisor-permisos"]), "main", DIFF), ["revisor-permisos"]);
  } finally {
    rmSync(cfg.root, { recursive: true, force: true });
  }
});

test("revisión: un hallazgo alto bloquea mientras el diff no cambie; uno de un diff anterior, una sola vez", async () => {
  const cfg = proyecto();
  try {
    const malo = enProceso(JSON.stringify({ aprobado: false, hallazgos: [{ gravedad: "alta", archivo: "api/x.ts", problema: "sin filtro de empresa", arreglo: "agrega where empresaId" }] }));
    const r1 = await revisionEnStop(cfg, plan(["revisor-permisos"]), { diff: DIFF, lanzar: malo, hasta: Date.now() + 5000, intervalo: 10 });
    assert.equal(r1.problemas.length, 1);
    assert.match(r1.problemas[0], /revisor-permisos .*sin filtro de empresa.*agrega where empresaId/);
    // Mismo diff: no se lanza otra vez, y sigue bloqueando.
    let lanzadas = 0;
    const r2 = await revisionEnStop(cfg, plan(["revisor-permisos"]), { diff: DIFF, lanzar: () => lanzadas++, hasta: Date.now() + 100 });
    assert.equal(lanzadas, 0);
    assert.equal(r2.problemas.length, 1);
    // Diff nuevo (corregido): el hallazgo viejo llega una vez más como «diff anterior» y luego no.
    const otro = DIFF.replace("const c", "const d");
    const r3 = await revisionEnStop(cfg, plan(["revisor-permisos"]), { diff: otro, lanzar: enProceso('{"aprobado":true,"hallazgos":[]}'), hasta: Date.now() + 5000, intervalo: 10 });
    assert.equal(r3.problemas.length, 0, "ya se informó antes; el nuevo aprobó");
    assert.deepEqual([...aprobados(cfg, claveDiff(otro))], ["revisor-permisos"]);
    assert.deepEqual([...aprobados(cfg, claveDiff(DIFF))], []);
  } finally {
    rmSync(cfg.root, { recursive: true, force: true });
  }
});

test("revisión: lo que no terminó a tiempo es una nota y llega en el siguiente Stop; un error no bloquea", async () => {
  const cfg = proyecto();
  try {
    const ids = [];
    const r1 = await revisionEnStop(cfg, plan(["revisor-coherencia", "revisor-ui"]), { diff: DIFF, lanzar: (c, id) => ids.push(id), hasta: Date.now() + 50, intervalo: 10 });
    assert.equal(ids.length, 2);
    assert.deepEqual(r1.problemas, []);
    assert.match(r1.notas.join(" "), /segundo plano.*revisor-coherencia, revisor-ui/);
    // Terminan después: una con hallazgo medio, otra con error.
    await enProceso(JSON.stringify({ aprobado: false, hallazgos: [{ gravedad: "media", problema: "límite distinto" }] }))(cfg, ids[0]);
    await enProceso({ error: "tiempo agotado" })(cfg, ids[1]);
    const r2 = informe(cfg, claveDiff(DIFF));
    assert.equal(r2.problemas.length, 1);
    assert.match(r2.notas.join(" "), /revisor-ui no pudo revisar.*tiempo agotado/);
    assert.equal(informe(cfg, claveDiff(DIFF)).notas.length, 0, "el error se dice una vez");
    assert.equal(leerRevisiones(cfg).revisiones.length, 2);
  } finally {
    rmSync(cfg.root, { recursive: true, force: true });
  }
});

test("revisión: un diff más largo que maxLineas no se revisa en el Stop", async () => {
  const cfg = proyecto({ maxLineas: 1 });
  try {
    let lanzadas = 0;
    const r = await revisionEnStop(cfg, plan(["revisor-ui"]), { diff: DIFF, lanzar: () => lanzadas++ });
    assert.equal(lanzadas, 0);
    assert.match(r.notas[0], /2 líneas cambiadas .*lanza tú los revisores: revisor-ui/);
    assert.deepEqual(enStop(cfg, plan(["revisor-ui"]), "main", DIFF), []);
  } finally {
    rmSync(cfg.root, { recursive: true, force: true });
  }
});

test("revisión: con lectura, el revisor recibe dónde está cada repo y herramientas de solo lectura en el proyecto", async () => {
  assert.match(pedidoRevision("revisor-coherencia", DIFF, { api: "backend", web: "frontend" }), /Puedes leer el proyecto .*api → backend, web → frontend/);
  assert.match(pedidoRevision("revisor-coherencia", DIFF), /Solo tienes el diff/);
  for (const lectura of [false, true]) {
    const cfg = proyecto({ lectura });
    cfg.repos = [{ nombre: "api", ruta: "backend" }];
    try {
      const [id] = lanzarRevisiones(cfg, { diff: DIFF, revisores: ["revisor-coherencia"], lanzar: () => {} });
      let visto = null;
      const { llamarClaude } = await import("../lib/portero.mjs");
      assert.equal(typeof llamarClaude, "function");
      await revisar(cfg, id, { llamar: async (t) => ((visto = t), { texto: '{"aprobado":true,"hallazgos":[]}', costo: 0 }) });
      assert.equal(/api → backend/.test(visto), lectura);
    } finally {
      rmSync(cfg.root, { recursive: true, force: true });
    }
  }
});
