import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { addPersona, expand, parseRoleMap, score, selectPersonas } from "../panel/panel.mjs";
import { avatarSvg, lookFor } from "../panel/avatares.mjs";

const rows = (r) => "| Pantalla | Ruta | Modifica |\n|---|---|---|\n" + r.map(([ruta, w]) => `| X | \`${ruta}\` | ${w} |`).join("\n");
const cast = [
  { id: "ana", rol: "OWNER", foto: "ana" },
  { id: "bruno", rol: "SALES", foto: "bruno" },
  { id: "carla", rol: "WAREHOUSE", foto: "carla" },
  { id: "dario", rol: "FINANCE", foto: "dario" },
  { id: "elena2", rol: "VIEWER", foto: "elena" },
];

test("roles en Markdown: ✅ modifica, ❌ solo ve", () => {
  const m = parseRoleMap(rows([["/pedidos", "✅"], ["/facturas", "❌"]]));
  assert.equal(m.get("/pedidos"), true);
  assert.equal(m.get("/facturas"), false);
});

test("elegir: la pantalla más específica, ignora rutas como Inicio y de 3 a 5 según los roles que modifican", () => {
  const all = [["/app", "✅"], ["/pedidos", "✅"], ["/despacho", "✅"], ["/a", "✅"], ["/b", "✅"]];
  const maps = {
    OWNER: parseRoleMap(rows(all)),
    SALES: parseRoleMap(rows([["/app", "✅"], ["/pedidos", "✅"]])),
    WAREHOUSE: parseRoleMap(rows([["/app", "✅"], ["/pedidos", "❌"], ["/despacho", "✅"]])),
    FINANCE: parseRoleMap(rows([["/app", "✅"], ["/pedidos", "❌"]])),
    VIEWER: parseRoleMap(rows(all.map(([r]) => [r, "❌"]))),
  };
  const ids = (x) => x.map((p) => p.id);
  assert.equal(ids(selectPersonas(["/pedidos/1"], cast, maps, { ignorar: ["/app"] }))[0], "bruno");
  assert.equal(ids(selectPersonas(["/despacho"], cast, maps, { ignorar: ["/app"] }))[0], "carla");
  assert.equal(selectPersonas(["/despacho"], cast, maps, { ignorar: ["/app"] }).length, 3, "mínimo 3");
  const everyone = Object.fromEntries(cast.map((p) => [p.rol, parseRoleMap(rows([["/x", "✅"]]))]));
  assert.equal(selectPersonas(["/x"], cast, everyone, { min: 3, max: 4 }).length, 4, "máximo");
  assert.equal(selectPersonas(["/x"], cast, everyone, { n: 2 }).length, 2, "n explícito");
});

test("calificar: aprueba solo si el promedio supera el umbral y están todas las notas", () => {
  assert.deepEqual(score([{ nota: 9 }, { nota: 9.2 }, { nota: 9.1 }], 8.99), { promedio: 9.1, aprobado: true, motivo: "aprobado" });
  assert.equal(score([{ nota: 9 }, { nota: 9 }, { nota: 8.97 }], 8.99).aprobado, false);
  assert.equal(score([{ nota: 10 }, { nota: "x" }], 8.99).aprobado, false);
});

test("plantillas: variables de entorno con valor por defecto y {claves}", () => {
  assert.equal(expand("${ND_NO_EXISTE:-abc}"), "abc");
  assert.equal(expand("${ND_X}", {}, { ND_X: "1" }), "1");
  assert.deepEqual(expand({ e: "persona.{id}@x.com", r: ["{rol}"] }, { id: "bruno", rol: "SALES" }), { e: "persona.bruno@x.com", r: ["SALES"] });
  assert.equal(expand("{desconocida}"), "{desconocida}");
});

test("crear persona: foto menos usada y número si ya existe", () => {
  const next = addPersona(cast, "AUDITOR", { fotos: ["ana", "bruno", "elena"] });
  const nueva = next.at(-1);
  assert.equal(next.length, cast.length + 1);
  assert.equal(nueva.rol, "AUDITOR");
  assert.equal(nueva.nombre.toLowerCase(), nueva.id);
  assert.ok(nueva.id.startsWith(nueva.foto) && /^\d*$/.test(nueva.id.slice(nueva.foto.length)));
  assert.ok(!cast.some((p) => p.id === nueva.id));
});

test("avatares: rasgos estables por id y SVG válido", () => {
  assert.deepEqual(lookFor({ id: "ana" }), lookFor({ id: "ana" }));
  assert.match(avatarSvg({ id: "ana", color: "#8b5cf6" }), /^<svg[\s\S]*<\/svg>\s*$/);
});

test("plantillas y ejemplo nest-next son JSON válidos", () => {
  for (const f of ["plantillas/neurodanza.config.json", "plantillas/personas.json", "plantillas/casos-base.json", "plantillas/roles.json", "plantillas/neurodanza.schema.json", "ejemplos/nest-next/casos.json"]) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")), f);
  }
});

test("estados: concretos, el final sale de la nota", async () => {
  const { estadoFinal, ESTADOS_RONDA } = await import("../panel/panel.mjs");
  assert.equal(estadoFinal(10), "Sin observaciones");
  assert.equal(estadoFinal(9.2), "Observaciones menores");
  assert.equal(estadoFinal(8.9), "Funciona con dificultad");
  assert.equal(estadoFinal(7), "Funciona con dificultad");
  assert.equal(estadoFinal(6.5), "Requiere ayuda");
  assert.equal(estadoFinal(4), "No funciona");
  assert.equal(estadoFinal("x"), "");
  assert.ok(!ESTADOS_RONDA.some((e) => /content|dudos|molest/i.test(e)));
});

test("ronda activa: se cierra aunque nadie llame a `cerrar`", async () => {
  const { cerrarRondaActiva, rondaAbierta } = await import("../panel/panel.mjs");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const root = mkdtempSync(join(tmpdir(), "nd-ronda-"));
  const dir = join(root, "r1");
  (await import("node:fs")).mkdirSync(dir);
  writeFileSync(join(dir, "ronda.jsonl"), JSON.stringify({ type: "inicio", personas: [] }) + "\n");
  const activa = join(tmpdir(), `neurodanza-ronda-${createHash("sha1").update(root).digest("hex").slice(0, 12)}.txt`);
  writeFileSync(activa, dir);
  assert.ok(rondaAbierta(dir));
  assert.equal(cerrarRondaActiva(root, "terminó el turno"), dir);
  assert.ok(!rondaAbierta(dir));
  assert.match(readFileSync(join(dir, "ronda.jsonl"), "utf8"), /"cancelada":true,"motivo":"terminó el turno"/);
  assert.equal(cerrarRondaActiva(root, "otra vez"), null, "ya no hay ronda activa");
  // Con un resultado, cierra con las notas y el estado sale de la nota.
  writeFileSync(join(dir, "ronda.jsonl"), JSON.stringify({ type: "inicio", personas: [] }) + "\n");
  writeFileSync(activa, dir);
  cerrarRondaActiva(root, "", { promedio: 9.5, aprobado: true, evaluaciones: [{ persona: "ana", nota: 9.5, estado: "Contenta" }] }, 8.99);
  assert.match(readFileSync(join(dir, "ronda.jsonl"), "utf8"), /"estado":"Observaciones menores"/);
});
