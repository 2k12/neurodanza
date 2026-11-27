// Paso 1 (Tenet): recorridos acordados antes de implementar.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { contrato } from "../lib/director.mjs";
import { aAcciones, aprobarRecorridos, congelar, ejecutarRecorrido, guardarRecorrido, hashRecorrido, notaPorPasos, recorridosDe, textoContrato, textoPlan, validarRecorrido, verificarCongelado } from "../lib/recorridos.mjs";
import { ajustarEvaluaciones, navegadorPlaywright } from "../panel/panel.mjs";
import { calificar as calificarEvals } from "../evals/evals.mjs";

const PANEL = fileURLToPath(new URL("../panel/panel.mjs", import.meta.url));

const REC = {
  id: "exportar-pedidos",
  persona: "ana",
  tarea: "Exportar los pedidos a CSV",
  maxClics: 4,
  maxSegundos: 60,
  pasos: [
    { ruta: "/pedidos", espera: { texto: "Pedidos" }, porQue: "empiezo aquí" },
    { click: "Exportar", espera: { url: "/pedidos/exportar" }, porQue: "contabilidad lo pide", critico: true },
    { elegir: "Formato", opcion: "CSV", espera: { elemento: "Descargar" }, porQue: "solo aceptan CSV" },
    { click: "Descargar", espera: { texto: "Exportación lista" }, porQue: "cierro el día", critico: true },
  ],
};

function proyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-rec-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false }));
  return { root, cfg: loadConfig(root) };
}

/** App mínima en memoria para el navegador falso: pantallas con enlaces, listas y textos. */
const APP = {
  "/pedidos": { h1: "Pedidos", enlaces: { Exportar: "/pedidos/exportar" } },
  "/pedidos/exportar": { h1: "Exportar", listas: { Formato: ["CSV", "Excel"] }, enlaces: { Descargar: "/pedidos/listo" } },
  "/pedidos/listo": { h1: "Exportación lista", enlaces: {} },
};
function navFalso(app = APP) {
  let url = "";
  const errores = [];
  return {
    ir: async (r) => {
      url = r;
      if (!app[r]) errores.push(`HTTP 404 ${r}`);
    },
    click: async (n) => {
      const d = app[url]?.enlaces?.[n];
      if (!d) throw new Error(`no encontré «${n}»`);
      url = d;
    },
    elegir: async (l, o) => {
      if (!app[url]?.listas?.[l]?.includes(o)) throw new Error(`no hay «${o}» en «${l}»`);
    },
    llenar: async () => {},
    tecla: async () => {},
    esperar: async () => {},
    cumple: async (e) => {
      if (e.url) return { ok: url.startsWith(e.url), encontrado: url };
      const t = e.texto ?? e.elemento;
      const p = app[url] ?? {};
      const ok = p.h1?.includes(t) || Object.keys(p.enlaces ?? {}).includes(t);
      return { ok, encontrado: ok ? t : p.h1 ?? "nada" };
    },
    errores: () => errores,
  };
}

test("recorridos: formato válido; cada paso con una acción, su espera y su porQué", () => {
  assert.deepEqual(validarRecorrido(REC), []);
  const malo = { id: "Mal Id", persona: "", maxClics: 0, maxSegundos: -1, pasos: [{ click: "a", llenar: "b", valor: "x" }, { elegir: "Formato" }, {}] };
  const e = validarRecorrido(malo).join("\n");
  for (const t of ["id:", "persona:", "tarea:", "maxClics", "maxSegundos", "una sola acción", "elegir necesita opcion", "necesita una ruta o una acción", "espera con", "porQue"]) assert.match(e, new RegExp(t));
  // Reúsa el formato de --acciones de navegar.
  assert.deepEqual(aAcciones(REC), [{ ruta: "/pedidos", pasos: [{ click: "Exportar" }, { elegir: "Formato", opcion: "CSV" }, { click: "Descargar" }] }]);
});

test("recorridos: lo aprobado se congela con su hash; cualquier cambio lo invalida", () => {
  const c = congelar(REC, "2026-01-01");
  assert.equal(c.congelado.hash, hashRecorrido(REC));
  assert.ok(verificarCongelado(c));
  assert.equal(hashRecorrido({ ...REC, porQue: "metadato ajeno" }), hashRecorrido(REC));
  const tocado = structuredClone(c);
  tocado.pasos[1].click = "Exportar todo";
  assert.equal(verificarCongelado(tocado), false);
  assert.equal(verificarCongelado(REC), false);
});

test("recorridos: guardar, plan, aprobar (permanentes a git) y contrato del implementador", () => {
  const { root, cfg } = proyecto();
  assert.equal(guardarRecorrido(cfg, "export-v1", { ...REC, maxClics: 0 }).ok, false);
  const g = guardarRecorrido(cfg, "export-v1", REC);
  assert.ok(g.ok && existsSync(join(root, ".neurodanza", "recorridos", "export-v1", "ana.json")));
  guardarRecorrido(cfg, "export-v1", { ...REC, id: "filtrar-pedidos", persona: "luis" });
  assert.match(textoPlan(recorridosDe(cfg, "export-v1")), /ana · Exportar los pedidos a CSV[\s\S]*click en «Exportar» → debe estar en \/pedidos\/exportar \*\*\(crítico\)\*\*/);
  const ap = aprobarRecorridos(cfg, "export-v1", { permanentes: ["exportar-pedidos"] });
  assert.equal(ap.length, 2);
  assert.ok(ap.every((x) => x.ok && /^[0-9a-f]{16}$/.test(x.hash)));
  const perm = join(root, ".claude", "personas", "recorridos", "exportar-pedidos.json");
  assert.ok(existsSync(perm));
  assert.ok(verificarCongelado(JSON.parse(readFileSync(perm, "utf8"))));
  assert.equal(existsSync(join(root, ".claude", "personas", "recorridos", "filtrar-pedidos.json")), false);
  // Congelado: ya no se reescribe en este ciclo.
  assert.equal(guardarRecorrido(cfg, "export-v1", { ...REC, tarea: "otra" }).ok, false);
  const sec = textoContrato(recorridosDe(cfg, "export-v1").filter((r) => r.persona === "ana"));
  const c = contrato({ tarea: "t1", objetivo: "exportar", repos: [], archivos: {}, terminado: "x", maxPasos: 60, secciones: [sec] });
  assert.match(c, /## Recorridos acordados \(criterio de terminado\)[\s\S]*deben poder hacerse[\s\S]*click en «Exportar» → estar en \/pedidos\/exportar/);
  assert.doesNotMatch(c, /luis/);
});

test("recorridos: la ejecución registra clics, campos, tiempo, errores y si se cumplió cada espera", async () => {
  let t = 0;
  const ej = await ejecutarRecorrido(navFalso(), REC, { reloj: () => (t += 10) });
  assert.deepEqual(ej.pasos.map((p) => p.cumple), [true, true, true, true]);
  assert.deepEqual(ej.pasos.map((p) => p.clics), [0, 1, 2, 1]);
  assert.equal(ej.totales.clics, 4);
  assert.equal(ej.totales.cumplidos, 4);
  assert.ok(ej.totales.dentroDeLimites);
  assert.ok(ej.pasos.every((p) => p.ms > 0));
  // Sin el botón: el paso no cumple, con el motivo; los siguientes tampoco; el error HTTP queda en su paso.
  const sinBoton = { ...APP, "/pedidos": { h1: "Pedidos", enlaces: {} } };
  const r = await ejecutarRecorrido(navFalso(sinBoton), { ...REC, pasos: [{ ruta: "/no-existe", espera: { texto: "x" }, porQue: "p" }, ...REC.pasos] });
  assert.deepEqual(r.pasos[0].errores, ["HTTP 404 /no-existe"]);
  assert.equal(r.pasos[2].cumple, false);
  assert.match(r.pasos[2].encontrado, /no encontré «Exportar»/);
  assert.equal(r.totales.fallidos, 4);
});

test("navegar --recorrido: el navegador de Playwright cumple la interfaz (página falsa) y deja una captura por paso", async () => {
  // Página falsa con la API de Playwright que usa el adaptador.
  let ruta = "";
  const capturas = [];
  // Localizador encadenable: `c` dice si existe; `accion` es lo que hace el click.
  const vis = (c, accion = () => {}) => {
    const l = {
      _c: c,
      _a: accion,
      first: () => l,
      or: (o) => vis(() => c() || o._c(), () => (c() ? accion() : o._a())),
      click: async () => (c() ? accion() : Promise.reject(new Error("timeout"))),
      waitFor: async () => c() || Promise.reject(new Error("timeout")),
      fill: async () => {},
      count: async () => 0,
      textContent: async () => APP[ruta]?.h1 ?? "",
    };
    return l;
  };
  const page = {
    goto: async (u) => {
      ruta = new URL(u).pathname;
    },
    url: () => `http://app${ruta}`,
    locator: () => vis(() => true),
    getByRole: (role, { name }) => {
      if (role === "combobox") return vis(() => !!APP[ruta]?.listas);
      if (role === "option") return vis(() => Object.values(APP[ruta]?.listas ?? {}).flat().includes(name));
      if (role === "tab") return vis(() => false);
      return vis(
        () => !!APP[ruta]?.enlaces?.[name],
        () => {
          ruta = APP[ruta].enlaces[name];
        },
      );
    },
    getByLabel: () => vis(() => false),
    getByText: (t) => vis(() => !!APP[ruta]?.h1?.includes(t)),
    waitForURL: async (f) => (f(new URL(`http://app${ruta}`)) ? null : Promise.reject(new Error("timeout"))),
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    keyboard: { press: async () => {} },
    screenshot: async ({ path }) => capturas.push(path),
  };
  const dir = mkdtempSync(join(tmpdir(), "nd-nav-"));
  const ej = await ejecutarRecorrido(navegadorPlaywright(page, "http://app", [], { capturas: dir }), REC);
  assert.deepEqual(ej.pasos.map((p) => p.cumple), [true, true, true, true]);
  assert.equal(capturas.length, 4);
  assert.match(ej.pasos[3].captura, /recorrido-04\.png$/);
  // Un recorrido inválido corta antes de abrir el navegador, con el motivo.
  const { root } = proyecto();
  mkdirSync(join(root, ".claude", "personas"), { recursive: true });
  writeFileSync(join(root, ".claude", "personas", "personas.json"), JSON.stringify({ personas: [{ id: "ana", rol: "ADMIN" }] }));
  writeFileSync(join(root, "malo.json"), JSON.stringify({ ...REC, pasos: [{ click: "x" }] }));
  const r = spawnSync(process.execPath, [PANEL, "navegar", "--persona", "ana", "--recorrido", "malo.json"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /recorrido inválido[\s\S]*espera con/);
});

test("calificar por pasos: un paso crítico que no cumple limita la nota a panel.notaMaxSiFalla", () => {
  assert.deepEqual(notaPorPasos({ nota: 9, pasos: [{ n: 1, resultado: "cumple" }, { n: 2, resultado: "cumple con fricción" }] }, 6, REC), { nota: 9, limitada: false, motivo: "" });
  const r = notaPorPasos({ nota: 8.5, pasos: [{ n: 2, resultado: "no cumple", motivo: "esperaba exportar, encontré un error" }] }, 6, REC);
  assert.equal(r.nota, 6);
  assert.match(r.motivo, /paso crítico 2/);
  // Un paso no crítico que no cumple no limita (baja la nota la persona, no la regla).
  assert.equal(notaPorPasos({ nota: 9, pasos: [{ n: 3, resultado: "no cumple" }] }, 6, REC).limitada, false);
  // La ejecución mecánica también cuenta, aunque la persona diga «cumple».
  assert.equal(notaPorPasos({ nota: 9, pasos: [{ n: 4, resultado: "cumple" }] }, 6, REC, { pasos: [{}, {}, {}, { cumple: false, critico: true }] }).nota, 6);
  const data = ajustarEvaluaciones({ evaluaciones: [{ persona: "ana", nota: 9, pasos: [{ n: 2, resultado: "no cumple", critico: true }] }, { persona: "luis", nota: 9.5 }] }, { notaMax: 6 });
  assert.deepEqual(data.evaluaciones.map((e) => [e.nota, e.notaPersona]), [[6, 9], [9.5, undefined]]);
});

test("evals: la persona debe detectar el paso del recorrido que no cumple", () => {
  const casos = { umbrales: { deteccion: 0, falsosPositivos: 0 }, revisores: [], personas: [{ id: "rec", recorrido: { ...REC, pasos: REC.pasos.slice(0, 2) }, esperado: { pasoNoCumple: 2, notaMax: 6 } }] };
  const bien = calificarEvals({ personas: { rec: { nota: 8, pasos: [{ n: 1, resultado: "cumple" }, { n: 2, resultado: "no cumple", motivo: "esperaba el botón, no está" }] } } }, casos);
  assert.ok(bien.aprobado, JSON.stringify(bien.personas));
  const mal = calificarEvals({ personas: { rec: { nota: 6, pasos: [{ n: 1, resultado: "cumple" }, { n: 2, resultado: "cumple con fricción" }] } } }, casos);
  assert.equal(mal.aprobado, false);
  assert.match(mal.personas[0].motivo, /no marcó «no cumple» en el paso 2/);
});

test("panel: una nota vacía (null, «», ausente) es una nota que falta, no un 0", async () => {
  const { score, veredictoRonda, estadoFinal } = await import("../panel/panel.mjs");
  for (const vacia of [null, "", undefined, "sin nota"]) {
    const evs = [{ persona: "ana", nota: 9 }, { persona: "luis", nota: vacia }];
    assert.equal(score(evs, 7).motivo, "faltan notas", String(vacia));
    // Con la app fundida, la ronda queda pendiente (no reprobada por un 0 inventado).
    assert.equal(veredictoRonda({ evaluaciones: evs }, 7, [{ capa: "app", motivo: "no levanta" }]).pendiente, true, String(vacia));
    assert.equal(estadoFinal(vacia), "", String(vacia));
  }
  assert.equal(score([{ nota: 0 }, { nota: "8" }], 7).promedio, 4, "un 0 de verdad sí cuenta");
  // Sin nota, las regresiones y los pasos críticos no le inventan una.
  const data = ajustarEvaluaciones(
    { evaluaciones: [{ persona: "ana", nota: null, recorrido: { id: "x", informe: "i" }, pasos: [{ n: 1, resultado: "no cumple", critico: true }] }] },
    { leer: () => ({ recorrido: { pasos: [{ cumple: false, critico: true }] } }), regresionesDe: () => [{ tipo: "clics", texto: "t" }] },
  );
  assert.equal(data.evaluaciones[0].nota, null);
  assert.equal(data.evaluaciones[0].notaPersona, undefined);
});
