// Paso 2 (Westworld): memoria por recorrido y regresiones de experiencia.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { compararEjecuciones, compararMemoria, leerMemoria, notaConRegresiones, registrarMemoria, textoRegresion } from "../lib/recorridos.mjs";
import { ajustarEvaluaciones } from "../panel/panel.mjs";

const PANEL = fileURLToPath(new URL("../panel/panel.mjs", import.meta.url));
const REC = { id: "exportar-pedidos", persona: "ana", tarea: "Exportar los pedidos", maxClics: 4, maxSegundos: 60, permanente: true, pasos: [{ ruta: "/pedidos", espera: { texto: "Pedidos" }, porQue: "p" }, { click: "Exportar", espera: { texto: "Exportación lista" }, porQue: "p" }] };

function proyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-mem-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false, panel: { ventana: "ninguna" } }));
  mkdirSync(join(root, ".claude", "personas"), { recursive: true });
  writeFileSync(join(root, ".claude", "personas", "personas.json"), JSON.stringify({ personas: [{ id: "ana", rol: "ADMIN" }] }));
  return { root, cfg: loadConfig(root) };
}
/** Ejecución con `clics` totales, `ms` y si el último paso cumple. */
const ejec = (clics, ms = 1000, cumpleUltimo = true, errores = 0) => ({
  id: REC.id,
  pasos: [
    { n: 1, paso: "ir a /pedidos", esperado: "ver «Pedidos»", clics: 0, campos: 0, ms: ms / 2, errores: [], cumple: true },
    { n: 2, paso: "click en «Exportar»", esperado: "ver «Exportación lista»", clics, campos: 0, ms: ms / 2, errores: Array(errores).fill("HTTP 500 /api"), cumple: cumpleUltimo, encontrado: cumpleUltimo ? "ok" : "pantalla «Pedidos» sin «Exportación lista»" },
  ],
  totales: { pasos: 2, clics, campos: 0, ms, errores, cumplidos: cumpleUltimo ? 2 : 1 },
});

test("memoria: registra métricas por paso y totales por versión; la misma versión y persona se reemplaza", () => {
  const { cfg, root } = proyecto();
  registrarMemoria(cfg, REC, ejec(2), { version: "1.0.0", persona: "ana", aprobado: true });
  registrarMemoria(cfg, REC, ejec(3), { version: "1.0.0", persona: "ana", aprobado: true });
  registrarMemoria(cfg, REC, ejec(4), { version: "2.0.0", persona: "ana" });
  const m = JSON.parse(readFileSync(join(root, ".claude", "personas", "memoria", "exportar-pedidos.json"), "utf8"));
  assert.deepEqual(m.historial.map((e) => [e.version, e.totales.clics, e.aprobado]), [["1.0.0", 3, true], ["2.0.0", 4, false]]);
  assert.deepEqual(Object.keys(m.historial[0].pasos[1]).sort(), ["campos", "clics", "cumple", "errores", "esperado", "ms", "n", "paso"]);
  assert.equal(leerMemoria(cfg, "no-existe").historial.length, 0);
});

test("comparación: umbrales de clics y tiempo, pasos que dejan de cumplir y errores nuevos", () => {
  const base = ejec(2, 4000);
  assert.deepEqual(compararEjecuciones(base, ejec(2, 4800)), []);
  assert.deepEqual(compararEjecuciones(base, ejec(2, 4900)), []); // +22 %: bajo el umbral
  assert.deepEqual(compararEjecuciones(base, ejec(3, 4000)).map((r) => r.tipo), ["clics"]);
  assert.deepEqual(compararEjecuciones(base, ejec(3, 4000), { clics: 2 }), []);
  assert.deepEqual(compararEjecuciones(base, ejec(2, 5600)).map((r) => r.tipo), ["tiempo"]);
  assert.deepEqual(compararEjecuciones(base, ejec(2, 5600), { tiempo: 0.5 }), []);
  assert.deepEqual(compararEjecuciones(ejec(2, 500), ejec(2, 900)), []); // +80 %, pero menos de 1 s: ruido
  const r = compararEjecuciones(base, ejec(2, 4000, false, 1));
  assert.deepEqual(r.map((x) => x.tipo), ["paso", "errores"]);
  assert.match(r[0].ahora, /sin «Exportación lista»/);
});

test("regresiones: el mensaje va en la voz de la persona y la nota baja según la regla", () => {
  assert.equal(textoRegresion({ tipo: "clics", antes: 2, ahora: 4 }, "exportar pedidos", "2.0"), "En la 2.0 «exportar pedidos» me tomaba 2 clics; ahora 4.");
  assert.equal(textoRegresion({ tipo: "tiempo", antes: 2000, ahora: 3500 }, "exportar", "1.0"), "En la 1.0 «exportar» me tomaba 2 s; ahora 3.5 s.");
  assert.match(textoRegresion({ tipo: "paso", paso: "ver «Exportación lista»", ahora: "no apareció" }, "x", "1.0"), /^En la 1\.0 podía ver «Exportación lista»; ahora no \(no apareció\)\.$/);
  assert.deepEqual(notaConRegresiones(9, [{ tipo: "clics" }]), { nota: 8, descuento: 1 });
  assert.deepEqual(notaConRegresiones(9, [{ tipo: "tiempo" }]), { nota: 8.5, descuento: 0.5 });
  assert.deepEqual(notaConRegresiones(9, [{ tipo: "paso" }, { tipo: "errores" }, { tipo: "clics" }]), { nota: 6, descuento: 3 });
  assert.deepEqual(notaConRegresiones(2, [{ tipo: "paso" }, { tipo: "paso" }]), { nota: 1, descuento: 3 });
  const data = ajustarEvaluaciones({ evaluaciones: [{ persona: "ana", nota: 9, recorrido: { id: "x", informe: "i" }, pasos: [{ n: 1, resultado: "cumple" }] }] }, { leer: () => ejec(4), regresionesDe: () => [{ tipo: "clics", texto: "En la 1.0 me tomaba 2 clics; ahora 4." }] });
  assert.deepEqual([data.evaluaciones[0].nota, data.evaluaciones[0].notaPersona, data.evaluaciones[0].regresiones], [8, 9, ["En la 1.0 me tomaba 2 clics; ahora 4."]]);
  // Idempotente: calificar dos veces no descuenta dos veces.
  ajustarEvaluaciones(data, { leer: () => ejec(4), regresionesDe: () => [{ tipo: "clics", texto: "t" }] });
  assert.equal(data.evaluaciones[0].nota, 8);
});

test("sin historial previo no falla; la versión que se califica no se compara consigo misma", () => {
  const { cfg, root } = proyecto();
  assert.deepEqual(compararMemoria(cfg, REC.id, ejec(4)), { base: null, regresiones: [], motivo: "sin historial previo" });
  registrarMemoria(cfg, REC, ejec(2), { version: "1.0.0", aprobado: false });
  assert.equal(compararMemoria(cfg, REC.id, ejec(4)).motivo, "sin una versión aprobada para comparar");
  registrarMemoria(cfg, REC, ejec(2), { version: "1.0.0", aprobado: true });
  assert.equal(compararMemoria(cfg, REC.id, ejec(4)).regresiones[0].texto, "En la 1.0.0 «Exportar los pedidos» me tomaba 2 clics; ahora 4.");
  assert.deepEqual(compararMemoria(cfg, REC.id, ejec(4), { excluirVersion: "1.0.0" }).regresiones, []);
  const r = spawnSync(process.execPath, [PANEL, "comparar", "--recorrido", "otro"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sin historial previo/);
});

test("calificar de punta a punta: la v1 queda aprobada en la memoria y la v2, con 2 clics más, baja la nota y lo dice", () => {
  const { root } = proyecto();
  const recFile = join(root, ".claude", "personas", "recorridos", "exportar-pedidos.json");
  mkdirSync(join(root, ".claude", "personas", "recorridos"), { recursive: true });
  writeFileSync(recFile, JSON.stringify(REC));
  const ronda = (version, clics) => {
    const inf = join(root, `rec-${version}.json`);
    writeFileSync(inf, JSON.stringify(ejec(clics)));
    const res = join(root, `panel-${version}.json`);
    writeFileSync(res, JSON.stringify({ version, revisores: "aprobados", evaluaciones: [{ persona: "ana", nota: 9.5, recorrido: { id: REC.id, archivo: recFile, informe: inf }, pasos: [{ n: 1, resultado: "cumple" }, { n: 2, resultado: "cumple" }] }] }));
    const r = spawnSync(process.execPath, [PANEL, "calificar", "--resultado", res], { cwd: root, encoding: "utf8" });
    return { r, data: JSON.parse(readFileSync(res, "utf8")) };
  };
  const v1 = ronda("1.0.0", 2);
  assert.equal(v1.r.status, 0, v1.r.stderr);
  assert.equal(v1.data.evaluaciones[0].nota, 9.5);
  const v2 = ronda("2.0.0", 4);
  assert.equal(v2.data.evaluaciones[0].nota, 8.5);
  assert.deepEqual(v2.data.evaluaciones[0].regresiones, ["En la 1.0.0 «Exportar los pedidos» me tomaba 2 clics; ahora 4."]);
  assert.match(v2.r.stdout, /⚠ regresión · ana: En la 1\.0\.0/);
  assert.equal(v2.r.status, 1); // 8.5 ≤ 8.99: no aprueba
  const mem = JSON.parse(readFileSync(join(root, ".claude", "personas", "memoria", "exportar-pedidos.json"), "utf8"));
  assert.deepEqual(mem.historial.map((e) => [e.version, e.aprobado]), [["1.0.0", true], ["2.0.0", false]]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, ".neurodanza", "regresiones.json"), "utf8"))), ["ana"]);
  // Repetir calificar sobre la v2 no compara la v2 consigo misma ni descuenta dos veces.
  const otra = spawnSync(process.execPath, [PANEL, "calificar", "--resultado", join(root, "panel-2.0.0.json")], { cwd: root, encoding: "utf8" });
  assert.equal(otra.status, 1);
  assert.equal(JSON.parse(readFileSync(join(root, "panel-2.0.0.json"), "utf8")).evaluaciones[0].nota, 8.5);
});
