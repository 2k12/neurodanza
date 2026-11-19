import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, merge } from "../lib/config.mjs";
import { revisoresPara } from "../lib/ciclo.mjs";
import { anotar, firmaDe, normalize, registrar, top } from "../lib/errores.mjs";
import { contextoErrores, fingerprint } from "../hooks/feedback.mjs";

const cfg = loadConfig(fileURLToPath(new URL("../ejemplos/nest-next/", import.meta.url)));

test("errores: la firma ignora rutas, números y textos entre comillas", () => {
  const a = "backend · tipos:\nsrc/pedidos/pedidos.service.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.";
  const b = "backend · tipos:\nsrc/clientes/x.service.ts(9,1): error TS2322: Type 'Date' is not assignable to type 'string'.";
  assert.equal(firmaDe(a), firmaDe(b));
  assert.notEqual(firmaDe(a), firmaDe("frontend · lint:\n  12:3  error  'x' is defined but never used  no-unused-vars"));
  assert.match(normalize("C:\\p\\src\\a.ts:12:3 falla"), /^<ruta>/);
});

test("errores: cuenta una vez por sesión y anota la solución cuando existe", () => {
  const data = { errores: {} };
  const p = "frontend · lint:\n  3:1  error  Unexpected console statement  no-console";
  registrar(data, [p], "t1", "s1");
  registrar(data, [p], "t2", "s1");
  const [r] = registrar(data, [p], "t3", "s2");
  assert.equal(r.veces, 2, "dos sesiones, aunque bloqueó 3 veces");
  assert.match(anotar(r, "node e.mjs"), /se repite \[.+\] \(2 veces\).*node e\.mjs resolver --firma/s);
  data.errores[r.firma].solucion = "Usar el logger del proyecto en vez de console.";
  const [k] = registrar(data, [p], "t4", "s3");
  assert.match(anotar(k), /error conocido .*Se resolvió así: Usar el logger/);
  assert.equal(top(data)[0].firma, r.firma);
  assert.match(contextoErrores(top(data)), /Solución: Usar el logger/);
  assert.equal(contextoErrores([]), "");
});

test("revisores: solo los que aplican al cambio", () => {
  const solo = (changes) => revisoresPara(cfg, changes).lanzar;
  assert.deepEqual(solo({ frontend: [], backend: [], docs: [] }), []);
  assert.deepEqual(solo({ backend: ["src/pedidos/pedidos.util.ts"], frontend: [], docs: [] }), ["revisor-docs"]);
  assert.deepEqual(solo({ backend: ["src/pedidos/dto/crear-pedido.dto.ts"] }), ["revisor-coherencia", "revisor-docs"]);
  assert.deepEqual(solo({ backend: ["src/pedidos/pedidos.controller.ts"], frontend: ["components/boton.tsx"] }), ["revisor-coherencia", "revisor-permisos", "revisor-ui", "revisor-docs"]);
  const r = revisoresPara(cfg, { backend: ["src/pedidos/pedidos.util.ts"] });
  assert.match(r.omitir["revisor-ui"], /sin pantallas/);
  assert.equal(revisoresPara(merge(cfg, { ciclo: { revisores: "todos" } }), { backend: ["src/a.util.ts"] }).lanzar.length, 4);
});

test("caché del hook Stop: misma entrada, misma firma", () => {
  assert.equal(fingerprint(["a", "diff"]), fingerprint(["a", "diff"]));
  assert.notEqual(fingerprint(["a", "diff"]), fingerprint(["a", "diff2"]));
  assert.notEqual(fingerprint(["ab", "c"]), fingerprint(["a", "bc"]));
});

test("ciclo.mjs revisores responde JSON (sin importación circular con fantasmas.mjs)", async () => {
  const { execFileSync } = await import("node:child_process");
  const salida = execFileSync(process.execPath, [fileURLToPath(new URL("../lib/ciclo.mjs", import.meta.url)), "revisores"], { cwd: cfg.root, encoding: "utf8", timeout: 30_000 });
  const j = JSON.parse(salida);
  assert.ok(Array.isArray(j.lanzar));
  assert.ok("fantasmas" in j);
});
