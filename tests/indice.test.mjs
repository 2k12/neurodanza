// Paso 4: índice pre-cocido por commit.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { buscar, exportacionesDe, importsDe, indexar, indiceDe, resumen, rutaNext, rutasApiDe, tipoDe } from "../lib/indice.mjs";

const CLI = fileURLToPath(new URL("../lib/indice.mjs", import.meta.url));

function repo() {
  const root = mkdtempSync(join(tmpdir(), "nd-ind-"));
  const w = (rel, s) => {
    mkdirSync(dirname(join(root, "api", rel)), { recursive: true });
    writeFileSync(join(root, "api", rel), s);
  };
  w("src/pedidos/pedidos.controller.ts", `import { Controller, Get, Post } from "@nestjs/common";\nimport { PedidosService } from "./pedidos.service";\n@Controller("pedidos")\nexport class PedidosController {\n  @Get() listar() {}\n  @Get(":id") uno() {}\n  @Post("exportar") exportar() {}\n}\n`);
  w("src/pedidos/pedidos.service.ts", `import { Pedido } from "./pedido.entity";\nexport class PedidosService {}\nexport const LIMITE = 10;\nexport type Estado = "a" | "b";\n`);
  w("src/pedidos/pedido.entity.ts", `import { Entity } from "typeorm";\n@Entity("pedidos")\nexport class Pedido {}\n`);
  w("src/pedidos/pedidos.service.spec.ts", `import { PedidosService } from "./pedidos.service";\n`);
  w("src/clientes/rutas.js", `const router = require("express").Router();\nrouter.get("/clientes", h);\nrouter.post("/clientes/:id/notas", h);\nmodule.exports = { router };\n`);
  w("src/migrations/1700-crear-pedidos.ts", `export class CrearPedidos1700 {}\n`);
  w("prisma/schema.prisma", `model Cliente {\n  id Int @id\n}\nmodel Factura {\n  id Int @id\n}\n`);
  w("web/app/(panel)/pedidos/[id]/page.tsx", `import { Tabla } from "@/components/tabla";\nexport default function Pagina() {}\n`);
  w("web/app/api/salud/route.ts", `export async function GET() {}\nexport const POST = () => {};\n`);
  w("web/pages/reportes/index.tsx", `export default function R() {}\n`);
  w("web/components/tabla.tsx", `export function Tabla() {}\nexport { Tabla as TablaPedidos };\n`);
  w("node_modules/lib/index.js", `export const nada = 1;\n`);
  w("dist/x.js", `export const nada = 1;\n`);
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "api", ruta: "api" }], autoconfigurar: false }));
  const g = (...a) => execFileSync("git", a, { cwd: join(root, "api"), stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("add", ".");
  g("commit", "-qm", "inicio");
  return { root, cfg: loadConfig(root) };
}

test("índice: exportaciones, imports internos y tipo de archivo", () => {
  assert.deepEqual(exportacionesDe(`export class A {}\nexport async function b() {}\nexport const C = 1;\nexport interface D {}\nexport type E = 1;\nexport enum F {}\nexport { g, h as i };\nexport default 3;`).sort(), ["A", "C", "D", "E", "F", "b", "default", "g", "i"]);
  assert.deepEqual(importsDe(`import x from "./a";\nimport { y } from "../b/c";\nimport z from "react";\nconst w = require("./d");\nimport("@/e");`), ["./a", "../b/c", "./d", "@/e"]);
  assert.equal(tipoDe("src/a/pedidos.controller.ts"), "controlador");
  assert.equal(tipoDe("src/a/x.spec.ts"), "prueba");
  assert.equal(tipoDe("src/migrations/1-x.ts"), "migración");
  assert.equal(tipoDe("app/pedidos/page.tsx"), "pantalla");
});

test("índice: rutas de NestJS, Express y Next (app y pages), pantallas y modelos", () => {
  assert.deepEqual(rutasApiDe(`@Controller('pedidos')\nclass A {\n @Get()\n l(){}\n @Post(':id/pagar')\n p(){}\n}`).map((r) => `${r.metodo} ${r.ruta}`), ["GET /pedidos", "POST /pedidos/:id/pagar"]);
  assert.deepEqual(rutasApiDe(`app.get('/salud', h); router.delete("/x/:id", h)`).map((r) => `${r.metodo} ${r.ruta}`), ["GET /salud", "DELETE /x/:id"]);
  assert.deepEqual(rutaNext("web/app/(panel)/pedidos/[id]/page.tsx"), { tipo: "pantalla", ruta: "/pedidos/[id]" });
  assert.deepEqual(rutaNext("app/page.tsx"), { tipo: "pantalla", ruta: "/" });
  assert.deepEqual(rutaNext("pages/api/x.ts"), { tipo: "api", ruta: "/api/x" });
  assert.equal(rutaNext("pages/_app.tsx"), null);
  const { root } = repo();
  const ind = indexar(join(root, "api"), { nombre: "api" });
  assert.ok(!Object.keys(ind.archivos).some((f) => f.startsWith("node_modules") || f.startsWith("dist")));
  assert.deepEqual(ind.rutasApi.map((r) => `${r.metodo} ${r.ruta}`).sort(), ["GET /api/salud", "GET /clientes", "GET /pedidos", "GET /pedidos/:id", "POST /api/salud", "POST /clientes/:id/notas", "POST /pedidos/exportar"]);
  assert.deepEqual(ind.pantallas.map((p) => p.ruta).sort(), ["/pedidos/[id]", "/reportes"]);
  assert.deepEqual(ind.modelos.map((m) => `${m.orm}:${m.nombre}`).sort(), ["prisma:Cliente", "prisma:Factura", "typeorm:Pedido"]);
  assert.deepEqual(ind.migraciones, ["src/migrations/1700-crear-pedidos.ts"]);
  assert.deepEqual(ind.pruebas["src/pedidos/pedidos.service.ts"], ["src/pedidos/pedidos.service.spec.ts"]);
  // Un alias (@/) que no se puede ubicar sin el tsconfig no inventa un archivo.
  assert.deepEqual(ind.archivos["web/app/(panel)/pedidos/[id]/page.tsx"].importa, []);
  assert.deepEqual(ind.archivos["src/pedidos/pedidos.controller.ts"].importa, ["src/pedidos/pedidos.service.ts"]);
});

test("índice: caché por firma del commit + cambios sin commit", () => {
  const { root, cfg } = repo();
  const r = cfg.repos[0];
  const a = indiceDe(cfg, r);
  assert.equal(a.cache, false);
  const b = indiceDe(cfg, r);
  assert.equal(b.cache, true);
  assert.equal(b.firma, a.firma);
  // Un cambio sin commit cambia la firma y se regenera (y queda solo el último índice del repo).
  writeFileSync(join(root, "api", "src", "pedidos", "pedidos.service.ts"), `export class PedidosService {}\nexport function descuento() {}\n`);
  const c = indiceDe(cfg, r);
  assert.equal(c.cache, false);
  assert.notEqual(c.firma, a.firma);
  assert.ok(c.archivos["src/pedidos/pedidos.service.ts"].exporta.includes("descuento"));
  assert.equal(readdirSync(join(root, ".neurodanza", "indice")).filter((f) => f.startsWith("api-")).length, 1);
});

test("índice: resumen enfocado («los archivos de esta tarea probablemente son…») y búsqueda", () => {
  const { root, cfg } = repo();
  const ind = indiceDe(cfg, cfg.repos[0]);
  const txt = resumen(ind, { foco: "pedidos" });
  assert.match(txt, /Los archivos de esta tarea probablemente son:/);
  for (const f of ["src/pedidos/pedidos.controller.ts", "src/pedidos/pedidos.service.ts", "src/pedidos/pedido.entity.ts"]) assert.match(txt, new RegExp(`- ${f.replace(/[.[\]()]/g, "\\$&")} \\(`));
  assert.match(txt, /Sus pruebas:\n- src\/pedidos\/pedidos\.service\.spec\.ts/);
  assert.match(txt, /POST \/pedidos\/exportar → src\/pedidos\/pedidos\.controller\.ts/);
  assert.doesNotMatch(txt, /clientes\/rutas/);
  // Foco por glob y por ruta de la API.
  assert.match(resumen(ind, { foco: "api:src/clientes/**" }), /- src\/clientes\/rutas\.js/);
  assert.match(resumen(ind, { foco: "/clientes" }), /- src\/clientes\/rutas\.js/);
  assert.ok(resumen(ind, { foco: "pedidos", max: 3 }).split("\n").length <= 3);
  assert.match(resumen(ind), /Rutas de la API \(7\)/);
  assert.deepEqual(buscar(ind, "exportar").map((x) => x.texto), ["POST /pedidos/exportar"]);
  assert.ok(buscar(ind, "TablaPedidos").some((x) => x.archivo === "web/components/tabla.tsx"));
  // CLI: sin configuración, nada.
  const sin = spawnSync(process.execPath, [CLI, "generar"], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(sin.status, 2);
  const out = spawnSync(process.execPath, [CLI, "resumen", "--repo", "api", "--foco", "pedidos"], { cwd: root, encoding: "utf8" });
  assert.match(out.stdout, /probablemente son/);
  assert.ok(existsSync(join(root, ".neurodanza", "indice")));
});

test("índice: un repo de ~3000 archivos se indexa en menos de 5 s", () => {
  const root = mkdtempSync(join(tmpdir(), "nd-ind-g-"));
  for (let e = 0; e < 300; e++)
    for (const [rel, s] of [
      [`src/m${e}/m${e}.controller.ts`, `import { S } from "./m${e}.service";\n@Controller("m${e}")\nexport class C${e} {\n @Get() l() {}\n @Post() c() {}\n}\n`],
      [`src/m${e}/m${e}.service.ts`, `import { X } from "../m${(e + 1) % 300}/m${(e + 1) % 300}.service";\nexport class S${e} {}\n`],
      [`src/m${e}/m${e}.entity.ts`, `@Entity("m${e}")\nexport class E${e} {}\n`],
      [`src/m${e}/dto/crear.dto.ts`, `export class Crear${e}Dto {}\n`],
      [`src/m${e}/m${e}.module.ts`, `export class M${e} {}\n`],
      [`test/m${e}.spec.ts`, `import { S${e} } from "../src/m${e}/m${e}.service";\n`],
      [`web/app/m${e}/page.tsx`, `export default function P() {}\n`],
      [`web/app/m${e}/nuevo/page.tsx`, `export default function N() {}\n`],
      [`web/components/m${e}.tsx`, `export function T${e}() {}\n`],
      [`src/migrations/${e}-crear.ts`, `export class Mig${e} {}\n`],
    ]) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), s);
    }
  const t0 = Date.now();
  const ind = indexar(root, { nombre: "g" });
  const ms = Date.now() - t0;
  assert.equal(ind.total, 3000);
  assert.equal(ind.rutasApi.length, 600);
  assert.ok(ms < 5000, `tardó ${ms} ms`);
});

test("índice: el contrato del director trae el resumen enfocado en los archivos de la tarea", async () => {
  const { seccionIndice } = await import("../lib/director.mjs");
  const { cfg } = repo();
  const s = seccionIndice(cfg, { repos: [{ nombre: "api" }], archivos: { api: ["src/pedidos/**"] } });
  assert.match(s, /^## Lo que dice el índice del proyecto/);
  assert.match(s, /probablemente son:[\s\S]*- src\/pedidos\/pedidos\.controller\.ts/);
  assert.doesNotMatch(s, /clientes/);
  assert.equal(seccionIndice({ ...cfg, indice: { activo: false } }, { repos: [{ nombre: "api" }], archivos: { api: ["src/**"] } }), "");
});
