// Pasos 5 y 6 (seguridad): cuarentena y fantasmas.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { leerAgentes, reiniciarAgentes } from "../lib/agentes.mjs";
import { load as cargarErrores } from "../lib/errores.mjs";
import { confirmados, fantasmasPara, hipotesisDeDiff, rutasDelDiff, validarResultado } from "../lib/fantasmas.mjs";
import { calificar } from "../evals/evals.mjs";

const HOOK = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));
const FANT = fileURLToPath(new URL("../lib/fantasmas.mjs", import.meta.url));

function proyecto(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-cf-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], figuras: { activo: true, cuarentena: 3 }, app: { urls: ["http://localhost:3000"] }, autoconfigurar: false, ...extra }));
  return { root, cfg: loadConfig(root) };
}
const run = (root, ev) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root, ...ev }), encoding: "utf8" });

test("cuarentena: 3 rechazos la activan; un ask no cuenta; se reinicia por ciclo", () => {
  const { root, cfg } = proyecto();
  const rev = { agent_id: "rev7", agent_type: "neurodanza:revisor-ui" };
  const editar = { ...rev, tool_name: "Edit", tool_input: { file_path: join(root, "a.ts"), old_string: "a", new_string: "b" } };
  const ask = run(root, { ...rev, tool_name: "Bash", tool_input: { command: "npm install x" } });
  assert.match(ask.stdout, /"permissionDecision":"ask"/);
  assert.equal(leerAgentes(cfg).rev7.rechazos, undefined, "un ask no cuenta como rechazo");
  assert.equal(run(root, editar).status, 2);
  assert.equal(run(root, editar).status, 2);
  const tercero = run(root, editar);
  assert.equal(tercero.status, 2);
  assert.match(tercero.stderr, /estás en cuarentena por 3 bloqueos/);
  const despues = run(root, { ...rev, tool_name: "Read", tool_input: { file_path: join(root, "a.ts") } });
  assert.equal(despues.status, 2, "en cuarentena, ni siquiera puede leer");
  assert.match(despues.stderr, /cuarentena/);
  assert.equal(leerAgentes(cfg).rev7.cuarentena, true);
  assert.ok(Object.values(cargarErrores(join(root, ".neurodanza", "errores.json")).errores).some((e) => e.categoria === "cuarentena"), "la cuarentena queda en errores conocidos");
  reiniciarAgentes(cfg);
  assert.equal(run(root, { ...rev, tool_name: "Read", tool_input: { file_path: join(root, "a.ts") } }).status, 0, "ciclo nuevo: sin cuarentena");
  // El agente principal nunca entra en cuarentena.
  for (let k = 0; k < 4; k++) run(root, { tool_name: "Write", tool_input: { file_path: join(root, ".neurodanza", "figuras.json"), content: "{}" } });
  assert.equal(run(root, { tool_name: "Read", tool_input: { file_path: join(root, "a.ts") } }).status, 0);
});

test("fantasmas: cuándo aplican y qué hipótesis generan", () => {
  const { cfg } = proyecto({ retroalimentacion: { pantallas: ["web:app/**"] } });
  assert.equal(fantasmasPara(cfg, { api: ["src/util/fechas.ts"] }).lanzar, false);
  assert.match(fantasmasPara(cfg, { api: ["src/pedidos/pedidos.controller.ts"] }).motivos[0], /endpoints/);
  assert.equal(fantasmasPara(cfg, { web: ["app/pedidos/page.tsx"] }, () => "<form onSubmit={guardar}>").lanzar, true);
  const diff = "+++ b/api/src/pedidos.controller.ts\n @Controller('pedidos')\n+  @Get(':id')\n+  @Post()\n+  crear(@Body() dto: CrearPedidoDto) {}\n";
  assert.deepEqual(rutasDelDiff(diff).map((r) => `${r.metodo} ${r.ruta}`), ["GET /pedidos/:id", "POST /pedidos"]);
  const hs = hipotesisDeDiff(diff, [{ rol: "ADMIN" }, { rol: "VIEWER", soloLectura: true }], 3);
  assert.deepEqual(hs.map((h) => h.tecnica), ["recurso-ajeno", "escalada-de-rol", "entrada-no-validada"]);
  assert.equal(hs[1].rolAtacante, "VIEWER");
});

test("fantasmas: solo hosts de la app, resultado con formato y veredicto; no editan repos", () => {
  const { root, cfg } = proyecto();
  const fuera = spawnSync(process.execPath, [FANT, "request", "--ruta", "https://produccion.ejemplo.com/api/x"], { cwd: root, encoding: "utf8" });
  assert.equal(fuera.status, 1);
  assert.match(fuera.stderr, /host no permitido: produccion\.ejemplo\.com/);
  assert.throws(() => validarResultado({ id: "h1", hipotesis: "x", confirmado: true }), /gravedad/);
  const bueno = { id: "h1", hipotesis: "VIEWER puede POST /pedidos", tecnica: "escalada-de-rol", confirmado: true, gravedad: "alta", request: { metodo: "POST", ruta: "/api/pedidos", usuario: "lucia" }, esperado: "403", obtenido: "201", prueba: { propuesta: "it('VIEWER no crea pedidos', …)" } };
  const g = spawnSync(process.execPath, [FANT, "resultado", "--json", JSON.stringify(bueno)], { cwd: root, encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  assert.equal(confirmados(cfg)[0].gravedad, "alta");
  assert.equal(spawnSync(process.execPath, [FANT, "veredicto"], { cwd: root, encoding: "utf8" }).status, 1, "un confirmado alto bloquea el aprobado");
  const edita = run(root, { agent_id: "f1", agent_type: "neurodanza:fantasma", tool_name: "Edit", tool_input: { file_path: join(root, "src", "a.ts"), old_string: "a", new_string: "b" } });
  assert.equal(edita.status, 2, "un fantasma no edita repos");
  const red = run(root, { agent_id: "f1", agent_type: "neurodanza:fantasma", tool_name: "Bash", tool_input: { command: "curl https://produccion.ejemplo.com/api" } });
  assert.equal(red.status, 2, "ni sale a otros hosts");
});

test("evals: el fantasma de la fuga sembrada debe confirmarla y el limpio no dar falsos positivos", () => {
  const casos = { umbrales: { deteccion: 0, falsosPositivos: 0 }, revisores: [], personas: [], fantasmas: [{ id: "fuga", esperado: "confirmar", tecnica: "fuga-entre-clientes" }, { id: "limpio", esperado: "limpio" }] };
  const ok = calificar({ fantasmas: { fuga: { confirmados: [{ tecnica: "fuga-entre-clientes", confirmado: true }] }, limpio: { confirmados: [] } } }, casos);
  assert.equal(ok.aprobado, true);
  const mal = calificar({ fantasmas: { fuga: { confirmados: [] }, limpio: { confirmados: [{ confirmado: true }] } } }, casos);
  assert.equal(mal.aprobado, false);
  assert.deepEqual(mal.fantasmas.map((f) => f.motivo), ["no la confirmó", "1 falso(s) positivo(s)"]);
});
