import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../lib/config.mjs";
import { coincide, impacto, pantallasAfectadas, recorridosAfectados } from "../lib/impacto.mjs";
import { aprobarVersion, diferenciasPantalla, normalizarFirma } from "../lib/recorridos.mjs";
import { mensajeDe, repetir, resumenRepeticion } from "../lib/regresion.mjs";

// App en memoria: por ruta, título y enlaces. `roto` quita un enlace (la regresión sembrada).
const APP = (roto = false) => ({
  "/pedidos": { h1: "Pedidos", enlaces: { Exportar: "/pedidos/exportar", Nuevo: "/pedidos/nuevo" } },
  "/pedidos/exportar": { h1: "Exportar pedidos", enlaces: { Descargar: "/pedidos/listo" } },
  "/pedidos/listo": { h1: "Exportación lista", enlaces: {} },
  "/clientes": { h1: "Clientes", enlaces: roto ? { Nuevo: "/clientes/nuevo" } : { Nuevo: "/clientes/nuevo", Importar: "/clientes/importar" } },
  "/clientes/importar": { h1: "Importar clientes", enlaces: {} },
  "/productos": { h1: "Productos", enlaces: {} },
});
function nav(app) {
  let ruta = "";
  return {
    ir: async (r) => {
      ruta = r;
    },
    click: async (n) => {
      const d = app[ruta]?.enlaces?.[n];
      if (!d) throw new Error(`no encontré «${n}»`);
      ruta = d;
    },
    elegir: async () => {},
    llenar: async () => {},
    tecla: async () => {},
    esperar: async () => {},
    cumple: async (e) => (e.url ? { ok: ruta.startsWith(e.url), encontrado: ruta } : { ok: (app[ruta]?.h1 ?? "").includes(e.texto), encontrado: app[ruta]?.h1 ?? "" }),
    errores: () => [],
    firma: async () => ({ titulo: app[ruta]?.h1, controles: Object.keys(app[ruta]?.enlaces ?? {}), campos: [], texto: `${app[ruta]?.h1} hoy ${Date.now()}` }),
  };
}
const REC = {
  pedidos: { id: "exportar-pedidos", persona: "ana", tarea: "Exportar pedidos", maxClics: 4, maxSegundos: 60, pasos: [{ ruta: "/pedidos", espera: { texto: "Pedidos" }, porQue: "x" }, { click: "Exportar", espera: { url: "/pedidos/exportar" }, porQue: "x" }, { click: "Descargar", espera: { texto: "Exportación lista" }, porQue: "x" }] },
  clientes: { id: "importar-clientes", persona: "luis", tarea: "Importar clientes", maxClics: 3, maxSegundos: 60, pasos: [{ ruta: "/clientes", espera: { texto: "Clientes" }, porQue: "x" }, { click: "Importar", espera: { url: "/clientes/importar" }, porQue: "x" }] },
  productos: { id: "ver-productos", persona: "eva", tarea: "Ver productos", maxClics: 1, maxSegundos: 60, pasos: [{ ruta: "/productos", espera: { texto: "Productos" }, porQue: "x" }] },
};

function proyecto() {
  const root = mkdtempSync(join(tmpdir(), "nd-reg-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "web", ruta: "web", codigo: ["src/**"] }] }));
  return { root, cfg: loadConfig(root) };
}

test("impacto: un componente compartido llega a sus pantallas; los recorridos que pasan por ellas quedan afectados", () => {
  const ind = {
    archivos: { "src/ui/tabla.tsx": { importa: [] }, "src/app/pedidos/page.tsx": { importa: ["src/ui/tabla.tsx"] }, "src/app/clientes/page.tsx": { importa: ["src/ui/tabla.tsx"] }, "src/app/productos/page.tsx": { importa: [] } },
    pantallas: [{ ruta: "/pedidos", archivo: "src/app/pedidos/page.tsx" }, { ruta: "/clientes", archivo: "src/app/clientes/page.tsx" }, { ruta: "/productos", archivo: "src/app/productos/page.tsx" }],
  };
  const p = pantallasAfectadas(ind, ["src/ui/tabla.tsx"]);
  assert.deepEqual(p.map((x) => x.ruta), ["/clientes", "/pedidos"]);
  const r = recorridosAfectados(Object.values(REC), p);
  assert.deepEqual(r.afectados.map((x) => x.id).sort(), ["exportar-pedidos", "importar-clientes"]);
  assert.deepEqual(r.noAfectados, ["ver-productos"]);
  assert.ok(coincide("/pedidos/[id]", "/pedidos/7") && !coincide("/pedidos", "/pedidos/7"));
});

test("firma: los números no la cambian; un control que desaparece, sí", () => {
  const a = normalizarFirma({ titulo: "Clientes", controles: ["Nuevo", "Importar"], texto: "Clientes 12 de 2026" });
  const b = normalizarFirma({ titulo: "Clientes", controles: ["Importar", "Nuevo", "Nuevo"], texto: "Clientes 99 de 2027" });
  assert.deepEqual(a, b);
  const d = diferenciasPantalla({ pasos: [{ n: 1, esperado: "x", firma: a }] }, { pasos: [{ n: 1, paso: "ir a /clientes", esperado: "x", firma: normalizarFirma({ titulo: "Clientes", controles: ["Nuevo"], texto: "Clientes" }) }] });
  assert.deepEqual(d[0].desaparece, ["Importar"]);
});

test("repetir: la primera vez queda como base; después, igual o con la regresión y la diferencia de pantalla", async () => {
  const { root, cfg } = proyecto();
  try {
    const recs = [REC.pedidos, REC.clientes];
    const v1 = await repetir(cfg, recs, { version: "1.0.0", navegadorPara: async () => nav(APP()) });
    assert.deepEqual(v1.map((r) => r.estado), ["primera vez", "primera vez"]);
    for (const r of recs) aprobarVersion(cfg, r.id, "1.0.0");
    const dichos = [];
    const v2 = await repetir(cfg, recs, { version: "1.1.0", navegadorPara: async () => nav(APP(true)), decir: (p, m) => dichos.push([p, m]) });
    assert.equal(v2[0].estado, "igual");
    assert.equal(v2[1].estado, "regresion");
    assert.match(v2[1].regresiones.map((x) => x.texto).join(" "), /podía/);
    assert.deepEqual(v2[1].diferencias[0].desaparece, ["Importar"]);
    assert.equal(dichos.length, 2);
    assert.equal(dichos[0][1].estado, "Verificando");
    assert.equal(dichos[1][1].estado, "Con error");
    assert.match(mensajeDe(v2[1]).texto, /ya no está «Importar»/);
    const res = resumenRepeticion(v2, ["ver-productos"]);
    assert.deepEqual({ iguales: res.iguales, conRegresion: res.conRegresion, noAfectados: res.noAfectados }, { iguales: 1, conRegresion: 1, noAfectados: 1 });
    assert.deepEqual(res.juzgar.map((x) => x.persona), ["luis"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("impacto en un repo git: el diff de la rama → pantallas por imports → recorridos permanentes", () => {
  const { root, cfg } = proyecto();
  try {
    const web = join(root, "web");
    const g = (...a) => execFileSync("git", a, { cwd: web, stdio: "ignore" });
    const w = (rel, txt) => {
      mkdirSync(join(web, rel, ".."), { recursive: true });
      writeFileSync(join(web, rel), txt);
    };
    mkdirSync(web, { recursive: true });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@localhost");
    g("config", "user.name", "t");
    w("src/ui/tabla.tsx", "export function Tabla() { return null; }\n");
    w("src/app/pedidos/page.tsx", 'import { Tabla } from "@/ui/tabla";\nexport default function P() { return Tabla(); }\n');
    w("src/app/clientes/page.tsx", 'import { Tabla } from "../../ui/tabla";\nexport default function C() { return Tabla(); }\n');
    w("src/app/productos/page.tsx", "export default function X() { return null; }\n");
    g("add", ".");
    g("commit", "-qm", "inicio");
    g("checkout", "-qb", "cambio");
    w("src/ui/tabla.tsx", "export function Tabla() { return 1; }\n");
    const dir = join(root, ".claude", "personas", "recorridos");
    mkdirSync(dir, { recursive: true });
    for (const r of Object.values(REC)) writeFileSync(join(dir, `${r.id}.json`), JSON.stringify(r));
    const r = impacto(cfg, { base: "main" });
    assert.deepEqual(r.pantallas.map((p) => p.ruta), ["/clientes", "/pedidos"]);
    assert.deepEqual(r.afectados.map((x) => x.id).sort(), ["exportar-pedidos", "importar-clientes"]);
    assert.deepEqual(r.noAfectados, ["ver-productos"]);
    assert.deepEqual(r.duenos.sort(), ["ana", "luis"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
