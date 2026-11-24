// 1.5.0: resumen de la respuesta completa, notas vacías y varias corridas por caso de fantasma.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { calificar } from "../evals/evals.mjs";
import { loadConfig } from "../lib/config.mjs";
import * as fantasmas from "../lib/fantasmas.mjs";

const FANT = fileURLToPath(new URL("../lib/fantasmas.mjs", import.meta.url));
const { peticion, resumenLista } = fantasmas;

function proyecto(url = "http://localhost:9") {
  const root = mkdtempSync(join(tmpdir(), "nd-res-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false, app: { urls: [url] } }));
  return loadConfig(root);
}

test("resumen: lista directa o en data, items o results; null si no es lista", () => {
  const filas = [{ storeId: "a" }, { storeId: "a" }, { storeId: "b" }, {}];
  const esperado = { registros: 4, agrupado: { storeId: { valores: [{ valor: "a", cantidad: 2 }, { valor: "b", cantidad: 1 }], distintos: 2, faltan: 0, sinCampo: 1 } } };
  for (const j of [filas, { data: filas }, { items: filas }, { results: filas }]) assert.deepEqual(resumenLista(JSON.stringify(j)), esperado);
  for (const t of ["", "<html>", "null", "3", '{"id":1}', '{"data":{}}', '[{"storeId":"a"']) assert.equal(resumenLista(t), null, t);
  assert.deepEqual(resumenLista("[]"), { registros: 0, agrupado: null });
  assert.deepEqual(resumenLista('[{"id":1},2,null]'), { registros: 3, agrupado: null });
});

test("resumen: todos los campos de cliente, sin confundir tipos, y --agrupar a.b", () => {
  const t = JSON.stringify([{ tenant_id: 1, companyId: null, tienda: { id: 7 } }, { tenant_id: "1", companyId: null, tienda: { id: 8 } }, { tenant_id: 1, tienda: null }]);
  const r = resumenLista(t).agrupado;
  assert.deepEqual(Object.keys(r), ["tenant_id", "companyId"]);
  assert.deepEqual(r.tenant_id.valores, [{ valor: 1, cantidad: 2 }, { valor: "1", cantidad: 1 }]);
  assert.deepEqual(r.companyId, { valores: [{ valor: null, cantidad: 2 }], distintos: 1, faltan: 0, sinCampo: 1 });
  const a = resumenLista(t, "tienda.id").agrupado;
  assert.deepEqual(a, { "tienda.id": { valores: [{ valor: 7, cantidad: 1 }, { valor: 8, cantidad: 1 }], distintos: 2, faltan: 0, sinCampo: 1 } });
  assert.equal(resumenLista(t, "constructor.name").agrupado["constructor.name"].sinCampo, 3, "solo campos propios");
});

test("resumen: limita los valores y dice cuántos faltan", () => {
  const r = resumenLista(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ storeId: `${"x".repeat(300)}${i}` })))).agrupado.storeId;
  assert.equal(r.valores.length, 20);
  assert.equal(r.distintos, 50);
  assert.equal(r.faltan, 30);
  assert.ok(r.valores.every((v) => v.valor.length <= 81));
});

test("petición y CLI: el resumen ve lo que el cuerpo cortado ya no muestra", async () => {
  // El registro ajeno está al final, fuera de los primeros 2000 caracteres.
  const filas = [...Array.from({ length: 200 }, (_, i) => ({ id: i, storeId: "mia", tienda: { id: 1 } })), { id: 999, storeId: "ajena", tienda: { id: 2 } }];
  const srv = createServer((req, res) => res.end(req.url === "/corta" ? "[]" : JSON.stringify(filas)));
  await new Promise((r) => srv.listen(0, r));
  const cfg = proyecto(`http://localhost:${srv.address().port}`);
  try {
    const r = await peticion(cfg, { ruta: "/x" });
    assert.equal(r.cortada, true);
    assert.equal(r.cuerpo.length, 2000);
    assert.doesNotMatch(r.cuerpo, /ajena/);
    assert.equal(r.resumen.registros, 201);
    assert.ok(r.resumen.agrupado.storeId.valores.some((v) => v.valor === "ajena"));
    const c = await peticion(cfg, { ruta: "/corta" });
    assert.equal(c.cortada, false);
    const out = await new Promise((ok) => {
      const h = spawn(process.execPath, [FANT, "request", "--ruta", "/x", "--agrupar", "tienda.id"], { cwd: cfg.root });
      let t = "";
      h.stdout.on("data", (x) => (t += x));
      h.on("close", () => ok(JSON.parse(t)));
    });
    assert.deepEqual(Object.keys(out.resumen.agrupado), ["tienda.id"]);
    assert.equal(out.resumen.agrupado["tienda.id"].distintos, 2);
  } finally {
    srv.close();
    srv.closeAllConnections();
  }
  assert.match(spawnSync(process.execPath, [FANT, "ayuda"], { cwd: cfg.root, encoding: "utf8" }).stderr, /--agrupar/);
});

test("«sin evidencia» queda a la vista en el veredicto, sin bloquear", () => {
  const { root } = proyecto();
  const correr = (...a) => spawnSync(process.execPath, [FANT, ...a], { cwd: root, encoding: "utf8" });
  const g = correr("resultado", "--json", JSON.stringify({ id: "h1", hipotesis: "fuga", confirmado: false, conclusion: "sin evidencia" }));
  assert.match(g.stdout, /sin evidencia/);
  const v = correr("veredicto");
  assert.equal(v.status, 0);
  assert.deepEqual(JSON.parse(v.stdout), { confirmados: [], sinEvidencia: [{ id: "h1", hipotesis: "fuga" }] });
});

const U = { deteccion: 0, falsosPositivos: 0 };
test("evals: una nota nula o vacía es «sin nota» y no aprueba", () => {
  const casos = { umbrales: U, revisores: [], personas: [{ id: "rota", esperado: { notaMax: 5 } }] };
  for (const nota of [null, "", "  ", undefined, [], false, true, "x"]) {
    const r = calificar({ personas: { rota: { nota } } }, casos);
    assert.equal(r.aprobado, false, JSON.stringify(nota));
    assert.equal(r.personas[0].motivo, "sin nota");
  }
  for (const nota of [0, 4, "4", "4.5"]) assert.equal(calificar({ personas: { rota: { nota } } }, casos).aprobado, true, JSON.stringify(nota));
});

test("evals: con recorrido, una nota vacía tampoco aprueba", () => {
  const casos = { umbrales: U, revisores: [], personas: [{ id: "rec", recorrido: { pasos: [{ n: 1, accion: "entrar" }] }, esperado: { notaMax: 5 } }] };
  for (const nota of [null, ""]) {
    const r = calificar({ personas: { rec: { nota, pasos: [{ n: 1, resultado: "cumple" }] } } }, casos);
    assert.equal(r.aprobado, false);
    assert.equal(r.personas[0].motivo, "sin nota");
  }
});

test("evals: la nota base de repiteDe vacía tampoco aprueba", () => {
  const casos = { umbrales: U, revisores: [], personas: [{ id: "rep", repiteDe: "base", esperado: { diferenciaMax: 1.5 } }] };
  for (const nota of [null, ""]) {
    const r = calificar({ personas: { base: { nota }, rep: { nota: 1 } } }, casos);
    assert.equal(r.aprobado, false);
    assert.match(r.personas[0].motivo, /sin nota en base/);
  }
  assert.equal(calificar({ personas: { base: { nota: 2 }, rep: { nota: 1 } } }, casos).aprobado, true);
});

test("evals: varias corridas, regla fija (2 de 3 confirman; el limpio, ninguna falsa)", () => {
  const si = { confirmados: [{ tecnica: "fuga", confirmado: true }] };
  const no = { confirmados: [] };
  const fuga = (corridas, rs) => calificar({ fantasmas: { f: rs } }, { umbrales: U, revisores: [], fantasmas: [{ id: "f", esperado: "confirmar", tecnica: "fuga", corridas }] }).fantasmas[0];
  const limpio = (corridas, rs) => calificar({ fantasmas: { f: rs } }, { umbrales: U, revisores: [], fantasmas: [{ id: "f", esperado: "limpio", corridas }] }).fantasmas[0];
  assert.equal(fuga(undefined, si).ok, true, "formato anterior");
  assert.equal(fuga(3, [si, si, no]).ok, true);
  assert.equal(fuga(3, [si, no, no]).ok, false);
  assert.equal(fuga(3, [si, si]).ok, false);
  assert.match(fuga(3, [si, si]).motivo, /2 de 3 corridas/);
  assert.equal(fuga(3, si).ok, false);
  assert.equal(fuga(3, [si, si, no, no, no]).ok, false, "las corridas de más también cuentan");
  assert.equal(fuga(3, [si, si, null]).ok, true, "una corrida sin resultado no confirma");
  assert.equal(fuga(1, []).ok, false);
  assert.equal(limpio(3, [no, no, no]).ok, true);
  assert.equal(limpio(3, [no, si, no]).ok, false);
  assert.equal(limpio(3, [no, no, null]).ok, false);
  assert.equal(limpio(1, { confirmados: [], conclusion: "sin evidencia" }).ok, false, "sin evidencia no es limpio");
});
