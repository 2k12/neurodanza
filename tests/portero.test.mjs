import assert from "node:assert/strict";
import { test } from "node:test";
import { combinar, debeConsultar, decidir, leerRespuesta, mensaje, numerar } from "../lib/portero.mjs";
import { CASOS } from "../evals/portero-casos.mjs";
import { calificar, cotaInferior } from "../evals/portero.mjs";

const DIFF = "--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const c = 2;\n";
const resp = (o) => JSON.stringify({ decision: "omitir", confianza: "alta", lineas: [5], motivo: "renombre", ...o });

test("portero: solo se consulta en un cambio medio por líneas", () => {
  assert.equal(debeConsultar({ nivel: "medio", motivos: ["90 líneas en backend"], lineas: 90 }), true);
  assert.equal(debeConsultar({ nivel: "alto", motivos: ["x"], lineas: 10 }), false);
  assert.equal(debeConsultar({ nivel: "bajo", motivos: ["x"], lineas: 10 }), false);
  assert.equal(debeConsultar({ nivel: "medio", motivos: ["contratos: a.dto.ts"], lineas: 4 }), false);
  assert.equal(debeConsultar({ nivel: "medio", motivos: ["el código cambiado toca permisos: a"], lineas: 4, permisos: ["a"] }), false);
  assert.equal(debeConsultar({ nivel: "medio", motivos: ["todavía sin diff: se confirma al verificar"], lineas: null }), false);
});

test("portero: numera el diff y marca como cambios solo + y −, no las cabeceras", () => {
  const n = numerar(DIFF);
  assert.deepEqual([...n.cambiadas], [5, 6]);
  assert.match(n.texto, /^L1 --- a\/x\.ts/);
});

test("portero: la clave de las marcas es distinta en cada mensaje", () => {
  assert.notEqual(mensaje(DIFF).clave, mensaje(DIFF).clave);
  assert.match(mensaje(DIFF, "abc").texto, /<<<DIFF-abc\n[\s\S]*\nDIFF-abc>>>$/);
});

test("portero: lo dudoso se vuelve revisar", () => {
  const n = numerar(DIFF);
  assert.equal(leerRespuesta(resp(), n).decision, "omitir");
  assert.equal(leerRespuesta(`texto antes ${resp()} y después`, n).decision, "omitir");
  for (const malo of ["", "no sé", "{roto", resp({ decision: "quizas" }), resp({ confianza: "media" }), resp({ confianza: "total" }), resp({ lineas: [] }), resp({ lineas: [2] }), resp({ lineas: [99] })])
    assert.equal(leerRespuesta(malo, n).decision, "revisar", malo);
  assert.equal(leerRespuesta(resp({ lineas: ["L6"] }), n).decision, "omitir");
  assert.equal(leerRespuesta(resp({ decision: "revisar", confianza: "baja", lineas: [] }), n).valido, true);
});

test("portero: omite solo si todos los votos válidos dicen omitir", () => {
  const o = { decision: "omitir", valido: true, motivo: "x" };
  const r = { decision: "revisar", valido: true, motivo: "y" };
  assert.equal(combinar([o, o]).decision, "omitir");
  assert.equal(combinar([o, r]).decision, "revisar");
  assert.equal(combinar([o], 2).decision, "revisar");
  assert.equal(combinar([]).decision, "revisar");
});

test("portero: decidir revisa ante error, tiempo agotado o un diff largo", async () => {
  const bien = async () => ({ texto: resp(), costo: 0.001 });
  assert.equal((await decidir(DIFF, { llamar: bien })).decision, "omitir");
  assert.equal((await decidir(DIFF, { llamar: bien })).costo, 0.002);
  let n = 0;
  const unoFalla = async () => (n++ ? { texto: "", costo: 0, error: "tiempo agotado" } : { texto: resp(), costo: 0 });
  assert.equal((await decidir(DIFF, { llamar: unoFalla })).decision, "revisar");
  const largo = `--- a/x\n+++ b/x\n${Array.from({ length: 130 }, (_, i) => `+l${i}`).join("\n")}`;
  let llamadas = 0;
  const r = await decidir(largo, { llamar: async () => (llamadas++, { texto: resp() }) });
  assert.equal(r.decision, "revisar");
  assert.equal(llamadas, 0);
});

test("portero: el banco tiene al menos 150 casos con error, 50 limpios y 20 inyecciones, sin ids repetidos", () => {
  const por = (t) => CASOS.filter((c) => c.tipo === t).length;
  assert.ok(por("revisar") >= 150);
  assert.ok(por("limpio") >= 50);
  assert.ok(por("inyeccion") >= 20);
  assert.equal(new Set(CASOS.map((c) => c.id)).size, CASOS.length);
  for (const c of CASOS) assert.ok(numerar(c.diff).cambiadas.size > 0, c.id);
});

test("portero: cota de Clopper-Pearson (0 fallos en 150 → ≥ 98 %, 1 en 150 → no)", () => {
  assert.ok(cotaInferior(150, 150) >= 0.98);
  assert.ok(cotaInferior(149, 150) < 0.98);
  assert.ok(Math.abs(cotaInferior(150, 150) - 0.05 ** (1 / 150)) < 1e-6);
  assert.equal(cotaInferior(0, 10), 0);
});

test("portero: calificar cuenta un caso con error como fallo si omitió en cualquier repetición", () => {
  const casos = [
    ...Array.from({ length: 160 }, (_, i) => ({ id: `e${i}`, familia: `f${i % 3}`, tipo: i < 150 ? "revisar" : "inyeccion" })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, familia: "limpia", tipo: "limpio" })),
  ];
  const dec = Object.fromEntries(casos.map((c) => [c.id, c.tipo === "limpio" ? ["omitir", "omitir"] : ["revisar", "revisar"]]));
  assert.equal(calificar(casos, dec).pasa, true);
  const uno = calificar(casos, { ...dec, e3: ["revisar", "omitir"] });
  assert.equal(uno.pasa, false);
  assert.deepEqual(uno.fallos, ["e3"]);
  assert.equal(calificar(casos, { ...dec, e155: ["omitir", "revisar"] }).inyeccion.fallos, 1);
  assert.equal(calificar(casos, { ...dec, l0: ["revisar", "revisar"], l1: ["revisar", "revisar"], l2: ["revisar", "revisar"], l3: ["revisar", "omitir"] }).pasa, false);
  assert.equal(calificar(casos, { ...dec, e7: [] }).deteccion.fallos, 1);
});

// ── Integración: estado por diff, auditoría y apagado ─────────────────────────────────────────────────────────────
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { aplicar, auditar, claveDiff, debeApagarse, diffEnRama, encender, leerAuditoria, leerEstado, porteroPara, recogerAuditorias, tocaAuditar } from "../lib/portero.mjs";

function proyecto(portero = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-portero-test-"));
  return { root, repos: [], abs: (p) => (isAbsolute(p) ? p : join(root, p)), ciclo: { portero: { activo: true, modelo: "haiku", votos: 2, maxLineas: 120, auditoria: 0, ventana: 50, maxFallos: 1, ...portero } } };
}
const MEDIO = { nivel: "medio", motivos: ["90 líneas en backend"], lineas: 90, plan: { revisores: 1, lanzar: ["revisor-coherencia"], personas: 1, fantasmas: 1 } };
const omite = async () => ({ texto: resp(), costo: 0.001 });
const contar = (fn) => {
  const c = async (t) => (c.n++, fn(t));
  c.n = 0;
  return c;
};

test("portero en el proyecto: apagado en la configuración o fuera de un cambio medio, no decide", async () => {
  const cfg = proyecto({ activo: false });
  assert.equal(await porteroPara(cfg, MEDIO, { diff: DIFF, llamar: omite }), null);
  const on = proyecto();
  assert.equal(await porteroPara(on, { ...MEDIO, nivel: "alto" }, { diff: DIFF, llamar: omite }), null);
  assert.equal(await porteroPara(on, { ...MEDIO, plan: { ...MEDIO.plan, lanzar: [] } }, { diff: DIFF, llamar: omite }), null);
  rmSync(cfg.root, { recursive: true, force: true });
  rmSync(on.root, { recursive: true, force: true });
});

test("portero en el proyecto: la decisión se guarda por diff y no se vuelve a preguntar", async () => {
  const cfg = proyecto();
  const llamar = contar(omite);
  const p = await porteroPara(cfg, MEDIO, { diff: DIFF, llamar });
  assert.equal(p.decision, "omitir");
  assert.equal(llamar.n, 2);
  const otra = await porteroPara(cfg, MEDIO, { diff: DIFF, llamar });
  assert.equal(otra.guardada, true);
  assert.equal(llamar.n, 2);
  assert.equal(leerEstado(cfg).decisiones[claveDiff(DIFF)].decision, "omitir");
  rmSync(cfg.root, { recursive: true, force: true });
});

test("portero: aplicar quita solo el revisor; revisar o apagado no cambian el plan", () => {
  const r = aplicar(MEDIO, { decision: "omitir", motivo: "renombre" });
  assert.deepEqual(r.plan.lanzar, []);
  assert.equal(r.plan.revisores, 0);
  assert.equal(r.plan.personas, 1);
  assert.equal(r.plan.fantasmas, 1);
  assert.equal(r.nivel, "medio");
  assert.match(r.motivos.at(-1), /^portero: renombre/);
  assert.equal(aplicar(MEDIO, { decision: "revisar" }), MEDIO);
  assert.equal(aplicar(MEDIO, null), MEDIO);
  assert.deepEqual(aplicar(MEDIO, { decision: "revisar", apagado: true, motivo: "portero apagado: x" }).plan, MEDIO.plan);
});

test("portero: 1 de cada N omisiones se audita (0 = nunca)", () => {
  assert.equal(tocaAuditar("00000000aaaa", 10), true);
  assert.equal(tocaAuditar("00000001aaaa", 10), false);
  assert.equal(tocaAuditar("00000000aaaa", 0), false);
  assert.equal(tocaAuditar("12345678aaaa", 1), true);
});

test("portero: el auditor reprueba con hallazgos altos o medios; una respuesta ilegible es error, no fallo", () => {
  assert.equal(leerAuditoria('{"aprobado":true,"hallazgos":[{"gravedad":"baja"}]}').estado, "ok");
  assert.equal(leerAuditoria('{"aprobado":true,"hallazgos":[{"gravedad":"Media","problema":"x"}]}').estado, "fallo");
  assert.equal(leerAuditoria('{"aprobado":false,"hallazgos":[]}').estado, "fallo");
  assert.equal(leerAuditoria("no sé").estado, "error");
});

test("portero: se apaga con más de maxFallos fallos en las últimas `ventana` auditorías; los errores no cuentan", () => {
  const a = (estado) => ({ estado });
  assert.equal(debeApagarse([a("fallo"), a("ok")], { ventana: 50, maxFallos: 1 }).apagar, false);
  assert.equal(debeApagarse([a("fallo"), a("error"), a("fallo")], { ventana: 50, maxFallos: 1 }).apagar, true);
  assert.equal(debeApagarse([a("fallo"), a("fallo"), ...Array(50).fill(a("ok"))], { ventana: 50, maxFallos: 1 }).apagar, false);
  assert.equal(debeApagarse([a("error"), a("error")], { ventana: 50, maxFallos: 0 }).apagar, false);
});

test("portero: omisión auditada → el fallo llega al Stop, lo apaga y encender lo vuelve a prender", async () => {
  const cfg = proyecto({ auditoria: 1, maxFallos: 0 });
  const lanzadas = [];
  const p = await porteroPara(cfg, MEDIO, { diff: DIFF, llamar: omite, lanzar: (_, id) => lanzadas.push(id) });
  assert.equal(p.auditoria, claveDiff(DIFF));
  assert.deepEqual(lanzadas, [claveDiff(DIFF)]);
  assert.deepEqual(recogerAuditorias(cfg), { problemas: [], aviso: "" }); // todavía corre
  const r = await auditar(cfg, p.auditoria, { llamar: async () => ({ texto: '{"aprobado":false,"hallazgos":[{"gravedad":"alta","archivo":"x.ts","problema":"falta el filtro de empresa"}]}', costo: 0.01 }) });
  assert.equal(r.estado, "fallo");
  const g = recogerAuditorias(cfg);
  assert.equal(g.problemas.length, 1);
  assert.match(g.problemas[0], /revisor-coherencia.*falta el filtro de empresa/);
  assert.match(g.aviso, /^portero apagado: 1 fallos en las últimas 1 auditorías/);
  assert.equal(recogerAuditorias(cfg).problemas.length, 0); // no se repite
  const otro = DIFF.replace("const c", "const d");
  const llamar = contar(omite);
  const ap = await porteroPara(cfg, MEDIO, { diff: otro, llamar });
  assert.equal(ap.decision, "revisar");
  assert.equal(ap.apagado, true);
  assert.equal(llamar.n, 0);
  encender(cfg);
  assert.equal(leerEstado(cfg).apagado, false);
  assert.equal((await porteroPara(cfg, MEDIO, { diff: otro, llamar, lanzar: () => {} })).decision, "omitir");
  rmSync(cfg.root, { recursive: true, force: true });
});

test("portero: diffEnRama junta commits, cambios sin commit y archivos nuevos, con el repo en la ruta", () => {
  const root = mkdtempSync(join(tmpdir(), "nd-portero-git-"));
  const dir = join(root, "api");
  mkdirSync(dir);
  const git = (c) => execSync(`git ${c}`, { cwd: dir, stdio: "pipe" });
  git("init -q -b main");
  git("config user.email t@t");
  git("config user.name t");
  writeFileSync(join(dir, "a.ts"), "const a = 1;\n");
  git("add .");
  git("commit -qm base");
  git("checkout -qb rama");
  writeFileSync(join(dir, "a.ts"), "const a = 2;\n");
  git("commit -qam cambio");
  writeFileSync(join(dir, "a.ts"), "const a = 3;\n");
  writeFileSync(join(dir, "nuevo.ts"), "export const n = 1;\n");
  const cfg = { root, repos: [{ nombre: "api", ruta: "api" }], abs: (p) => (isAbsolute(p) ? p : join(root, p)) };
  const d = diffEnRama(cfg, "main");
  assert.match(d, /^--- a\/api\/a\.ts$/m);
  assert.match(d, /^-const a = 1;$/m);
  assert.match(d, /^\+const a = 3;$/m);
  assert.match(d, /^\+\+\+ b\/api\/nuevo\.ts$/m);
  assert.match(d, /^\+export const n = 1;$/m);
  assert.doesNotMatch(d, /^diff --git/m);
  rmSync(root, { recursive: true, force: true });
});
