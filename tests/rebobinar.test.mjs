// Paso 3 (Edge of Tomorrow): rebobinar con memoria.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../lib/config.mjs";
import { cargar } from "../lib/constructos.mjs";
import { decidir, intentosAnteriores, leerMuertes, preparar, rebobinar, reflexionDeMuerte } from "../lib/director.mjs";

test("decidir: corregir encima lo puntual, rebobinar lo alto, de diseño o grande", () => {
  assert.equal(decidir([{ gravedad: "media", archivo: "a.ts", problema: "falta aria-label" }], 200).decision, "corregir");
  assert.equal(decidir([{ gravedad: "alta", archivo: "a.ts", problema: "fuga entre empresas" }], 200).decision, "rebobinar");
  assert.equal(decidir([{ gravedad: "media", problema: "el diseño mezcla la consulta con la vista" }], 200).decision, "rebobinar");
  assert.match(decidir([{ gravedad: "baja", archivo: "a.ts", lineas: 60 }], 100).motivo, /supera 50 %/);
  assert.equal(decidir([1, 2, 3, 4, 5, 6].map((k) => ({ gravedad: "baja", archivo: `f${k}.ts` })), 1000).decision, "rebobinar", "muchos archivos: no es puntual");
  assert.equal(decidir([], 100).decision, "corregir");
});

test("rebobinar: guarda la muerte, vuelve a la misma foto y el contrato trae la memoria; respeta el tope", () => {
  const root = mkdtempSync(join(tmpdir(), "nd-rebob-"));
  const app = join(root, "app");
  mkdirSync(join(app, "src"), { recursive: true });
  const g = (...a) => execFileSync("git", a, { cwd: app, stdio: "pipe" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  writeFileSync(join(app, "src", "a.mjs"), "export const a = 1;\n");
  g("add", ".");
  g("commit", "-qm", "inicio");
  writeFileSync(join(app, "src", "b.mjs"), "export const b = 1; // sin commit: está en la foto\n");
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "app", ruta: "app", codigo: ["src/**"] }], director: { worktrees: "wt/{proyecto}", rebobinar: { maxMuertes: 2 } }, autoconfigurar: false }));
  const cfg = loadConfig(root);
  const t = preparar(cfg, { tarea: "pedidos", repos: ["app"], archivos: { app: ["src/**"] } });
  const wt = t.repos[0].ruta;
  writeFileSync(join(wt, "src", "malo.mjs"), "export const malo = 1;\n");
  const memoria = { motivo: "diseño equivocado", hallazgos: [{ gravedad: "alta", problema: "mezcla la consulta con la vista", archivo: "app/src/malo.mjs" }], notas: ["Ana no encontró el filtro"], constructo: "implementador-backend" };
  const r1 = rebobinar(cfg, "pedidos", memoria);
  assert.equal(r1.ok, true);
  assert.ok(!existsSync(join(wt, "src", "malo.mjs")), "el intento fallido ya no está en el worktree");
  assert.ok(existsSync(join(wt, "src", "b.mjs")), "la foto original (con lo que no estaba en commit) sigue igual");
  const [m] = leerMuertes(cfg);
  assert.deepEqual([m.tarea, m.n, m.archivos], ["pedidos", 1, ["app/src/malo.mjs"]]);
  assert.match(readFileSync(join(root, m.patch), "utf8"), /malo/);
  assert.match(r1.contrato, /## Intentos anteriores y por qué fallaron[^]*Intento 1: diseño equivocado[^]*\[alta\] mezcla la consulta[^]*persona: Ana no encontró el filtro/);
  // La muerte llegó a los constructos como evidencia contra quien la causó.
  const lecciones = cargar(cfg).constructos["implementador-backend"].lecciones;
  assert.ok(lecciones.some((l) => l.etiqueta.startsWith("muerte:")));
  rebobinar(cfg, "pedidos", memoria);
  const r3 = rebobinar(cfg, "pedidos", memoria);
  assert.equal(r3.ok, false);
  assert.equal(r3.tope, true, "con maxMuertes = 2 la tercera no rebobina: se informa al usuario");
});

test("rebobinar: textos de la memoria y de la evidencia", () => {
  assert.equal(intentosAnteriores([]), "");
  const r = reflexionDeMuerte({ tarea: "t1", n: 1, motivo: "x", hallazgos: [{ problema: "Acción oculta permitida en la API" }], constructo: "implementador-frontend" });
  assert.equal(r.problemas[0].etiqueta, "muerte:accion-oculta-permitida-en-la-api");
  assert.equal(r.problemas[0].constructo, "implementador-frontend");
});
