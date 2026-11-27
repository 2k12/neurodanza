#!/usr/bin/env node
// neurodanza · ¿el crítico del pedido objeta lo que debe? Cada pedido de evals/critico-casos.mjs se le da al crítico a
// ciegas sobre un proyecto temporal con reglas, decisiones y funciones que ya existen. Gasta tokens. Ver docs/30.
//
// Uso: node critico.mjs [--veces 1] [--casos id,id] [--paralelo 6] [--modelo sonnet] [--salida informe.json]
// Un pedido malo cuenta si se objeta con evidencia válida; uno bueno, si no se objeta.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criticar } from "../lib/critico.mjs";
import { BASE, CASOS } from "./critico-casos.mjs";

export function armar() {
  const root = mkdtempSync(join(tmpdir(), "nd-critico-"));
  for (const [f, t] of Object.entries(BASE)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), t);
  }
  return root;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const casos = arg("casos") ? CASOS.filter((c) => arg("casos").split(",").includes(c.id)) : CASOS;
  const root = armar();
  const cfg = { root, repos: [], ciclo: { critico: { modelo: arg("modelo", "sonnet") } } };
  const tareas = [];
  for (let v = 0; v < Number(arg("veces", "1")); v++) for (const c of casos) tareas.push(c);
  const filas = [];
  let i = 0;
  try {
    await Promise.all(
      Array.from({ length: Number(arg("paralelo", "6")) }, async () => {
        while (i < tareas.length) {
          const c = tareas[i++];
          const r = await criticar(cfg, c.pedido);
          const acierta = c.esperado === "objetar" ? r.objeta : !r.objeta && !r.error;
          const f = { caso: c.id, esperado: c.esperado, tipo: c.tipo ?? null, objeta: r.objeta, acierta, tipos: r.objeciones.map((o) => o.tipo), descartadas: r.descartadas, costo: r.costo, seg: r.seg, ...(r.error ? { error: r.error } : {}), objeciones: r.objeciones.map((o) => `${o.tipo}: ${o.texto}`).slice(0, 2) };
          filas.push(f);
          console.error(JSON.stringify(f));
        }
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
  const malos = filas.filter((f) => f.esperado === "objetar");
  const buenos = filas.filter((f) => f.esperado === "no objetar");
  const porTipo = Object.fromEntries([...new Set(malos.map((f) => f.tipo))].map((t) => [t, `${malos.filter((f) => f.tipo === t && f.acierta).length} de ${malos.filter((f) => f.tipo === t).length}`]));
  const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null;
  const resumen = {
    objetados: `${malos.filter((f) => f.acierta).length} de ${malos.length}`,
    porTipo,
    objetadosPorError: `${buenos.filter((f) => f.objeta).length} de ${buenos.length}`,
    errores: filas.filter((f) => f.error).length,
    descartadasSinEvidencia: filas.reduce((s, f) => s + (f.descartadas ?? 0), 0),
    costoMedianoUSD: med(filas.map((f) => f.costo)),
    segMediano: med(filas.map((f) => f.seg)),
    costoTotalUSD: Math.round(filas.reduce((s, f) => s + f.costo, 0) * 1000) / 1000,
  };
  if (arg("salida")) writeFileSync(arg("salida"), JSON.stringify({ resumen, filas }, null, 2));
  console.log(JSON.stringify(resumen, null, 2));
}
