// Paso 5: especialistas consultados por el director antes de delegar.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { contrato } from "../lib/director.mjs";
import { decidirFigura } from "../lib/figuras.mjs";
import { maxSegDe } from "../lib/agentes.mjs";
import { indiceDe } from "../lib/indice.mjs";
import { archivosDeTarea, elegir, focoDe, guardarRespuesta, parseArchivos, planConsulta, preguntasDe, seccion, validarRespuesta } from "../lib/hotel.mjs";

const CLI = fileURLToPath(new URL("../lib/hotel.mjs", import.meta.url));
const AGENTES = fileURLToPath(new URL("../agents/", import.meta.url));

function proyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-hotel-"));
  const w = (rel, s) => {
    mkdirSync(dirname(join(root, "api", rel)), { recursive: true });
    writeFileSync(join(root, "api", rel), s);
  };
  w("src/pedidos/pedidos.controller.ts", `@Controller("pedidos")\nexport class PedidosController {\n @Get() l() {}\n}\n`);
  w("src/pedidos/pedidos.service.ts", `export class PedidosService {}\n`);
  w("src/pedidos/pedido.entity.ts", `@Entity("pedidos")\nexport class Pedido {}\n`);
  w("src/migrations/1700-crear-pedidos.ts", `export class CrearPedidos {}\n`);
  w("src/auth/roles.guard.ts", `export class RolesGuard {}\n`);
  w("web/app/pedidos/page.tsx", `export default function P() {}\n`);
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "api", ruta: "api" }], autoconfigurar: false }));
  execFileSync("git", ["init", "-q"], { cwd: join(root, "api") });
  return { root, cfg: loadConfig(root) };
}
const RESP = (especialista, pregunta) => ({ especialista, respuestas: [{ pregunta, respuesta: "Con `npm run migration:generate`; carpeta src/migrations, nombre <timestamp>-<accion>-<tabla>.", archivos: ["src/migrations/1700-crear-pedidos.ts"], confianza: "alta" }] });

test("hotel: los especialistas se eligen por los archivos de la tarea (rutas y tipos del índice)", () => {
  const { cfg } = proyecto();
  const ind = { api: indiceDe(cfg, cfg.repos[0]) };
  const plan = (archivos) => elegir(archivosDeTarea(ind, parseArchivos(archivos))).map((x) => x.especialista);
  assert.deepEqual(plan("api:src/pedidos/pedido.entity.ts"), ["datos"]);
  assert.deepEqual(plan("api:src/migrations/**").sort(), ["datos"]);
  assert.deepEqual(plan("api:web/app/pedidos/**").sort(), ["a11y", "rendimiento"]);
  assert.deepEqual(plan("api:src/auth/**"), ["permisos"]);
  assert.deepEqual(plan("api:src/pedidos/**").sort(), ["datos", "permisos", "rendimiento"]);
  // Un archivo nuevo (todavía no existe) también cuenta por su ruta.
  assert.deepEqual(plan("api:prisma/schema.prisma"), ["datos"]);
  assert.equal(focoDe([{ rel: "src/pedidos/pedidos.service.ts" }, { rel: "web/app/pedidos/page.tsx" }]), "pedidos");
  assert.match(preguntasDe("datos", "pedidos")[2], /¿Cómo se modela pedidos hoy/);
});

test("hotel: las respuestas se cachean por firma del área + pregunta; sin cambios, no se vuelve a lanzar", () => {
  const { root, cfg } = proyecto();
  const op = { archivos: "api:src/pedidos/pedido.entity.ts,api:src/migrations/**" };
  const p1 = planConsulta(cfg, op);
  assert.equal(p1.length, 1);
  assert.equal(p1[0].especialista, "datos");
  assert.ok(p1[0].lanzar);
  assert.equal(p1[0].pendientes.length, 3);
  assert.match(p1[0].contexto, /src\/pedidos\/pedido\.entity\.ts/);
  assert.equal(guardarRespuesta(cfg, { especialista: "datos", respuestas: [{ pregunta: "x" }] }).ok, false);
  for (const q of p1[0].pendientes) assert.ok(guardarRespuesta(cfg, RESP("datos", q)).ok);
  const p2 = planConsulta(cfg, op);
  assert.equal(p2[0].lanzar, false);
  assert.equal(p2[0].enCache.length, 3);
  // Un commit o cambio fuera del área no invalida la caché…
  writeFileSync(join(root, "api", "src", "auth", "roles.guard.ts"), "export class RolesGuard { otro() {} }\n");
  assert.equal(planConsulta(cfg, op)[0].lanzar, false);
  // …pero cambiar un modelo sí: se vuelve a preguntar.
  writeFileSync(join(root, "api", "src", "pedidos", "pedido.entity.ts"), `@Entity("pedidos")\nexport class Pedido { descuento = 0 }\n`);
  assert.equal(planConsulta(cfg, op)[0].lanzar, true);
  // El mapa ve las consultas.
  const c = JSON.parse(readFileSync(join(root, ".neurodanza", "hotel", "consultas.json"), "utf8"));
  assert.deepEqual(c.consultas.map((x) => [x.especialista, x.estado]), [["datos", "consultando"]]);
});

test("hotel: la sección «Lo que ya sabemos de este proyecto» entra en el contrato", () => {
  const { root, cfg } = proyecto();
  const archivos = { api: ["src/migrations/**"] };
  assert.equal(seccion(cfg, { archivos }), "");
  for (const q of planConsulta(cfg, { archivos })[0].pendientes) guardarRespuesta(cfg, RESP("datos", q));
  const s = seccion(cfg, { archivos });
  assert.match(s, /^## Lo que ya sabemos de este proyecto \(especialistas\)/);
  assert.match(s, /\*\*datos\*\* · ¿Cómo se crean y nombran las migraciones[\s\S]*migration:generate[\s\S]*ver src\/migrations\/1700-crear-pedidos\.ts/);
  assert.match(s, /pídelo en `pendiente`: el director decide/);
  const c = contrato({ tarea: "t", objetivo: "o", repos: [], archivos, terminado: "x", maxPasos: 60, secciones: [s] });
  assert.match(c, /Lo que ya sabemos de este proyecto/);
  assert.equal(seccion({ ...cfg, hotel: { activo: false } }, { archivos }), "");
  // CLI: elegir con --archivos.
  const r = spawnSync(process.execPath, [CLI, "elegir", "--archivos", "api:src/auth/**"], { cwd: root, encoding: "utf8" });
  assert.deepEqual(JSON.parse(r.stdout).map((x) => x.especialista), ["permisos"]);
  const sinTarea = spawnSync(process.execPath, [CLI, "preguntas", "--tarea", "no-existe"], { cwd: root, encoding: "utf8" });
  assert.equal(sinTarea.status, 2);
});

test("hotel: especialistas de solo lectura, con su presupuesto, y solo el director lanza subagentes", () => {
  for (const n of ["datos", "a11y", "permisos", "rendimiento"]) {
    const md = readFileSync(join(AGENTES, `especialista-${n}.md`), "utf8");
    assert.match(md, /^tools: Read, Glob, Grep$/m, n);
    assert.match(md, /^model: sonnet$/m);
    assert.match(md, /8 pasos y 120 s/);
    assert.match(md, new RegExp(`"especialista": "${n}", "respuestas"`));
  }
  assert.deepEqual(validarRespuesta(RESP("datos", "q")), []);
  const { cfg } = proyecto();
  assert.equal(maxSegDe(cfg, "neurodanza:especialista-datos"), 120);
  const ev = (tool_name, tool_input) => ({ cwd: cfg.root, agent_id: "e1", agent_type: "neurodanza:especialista-datos", tool_name, tool_input });
  assert.equal(decidirFigura(ev("Read", { file_path: join(cfg.root, "x") }), cfg, ["leer"]), null);
  assert.equal(decidirFigura(ev("Edit", { file_path: join(cfg.root, "x") }), cfg, ["leer"])?.decision, "deny");
  assert.ok(existsSync(join(AGENTES, "especialista-datos.md")));
});
