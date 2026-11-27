#!/usr/bin/env node
// neurodanza · ¿leer el proyecto ayuda al revisor del Stop? Cada caso de evals/revision-casos.mjs se revisa con solo el
// diff y con lectura (Read, Grep, Glob), con el modelo y el esfuerzo del revisor. Gasta tokens. Ver docs/29.
//
// Uso: node revision.mjs [--veces 2] [--modos diff,lectura] [--casos id,id] [--paralelo 5] [--salida informe.json]
// Un caso con error cuenta como detectado si el revisor no aprueba (hallazgo alto o medio); uno limpio, si aprueba.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { diffEnRama } from "../lib/portero.mjs";
import { lanzarRevisiones, leerRevisiones, revisar } from "../lib/revision.mjs";
import { BASE, CASOS } from "./revision-casos.mjs";

/** Proyecto temporal con la base en `main` y el cambio del caso sin commit. */
export function armar(caso, lectura) {
  const root = mkdtempSync(join(tmpdir(), "nd-revision-"));
  const repo = (nombre) => ({ nombre, ruta: nombre, codigo: ["src/**"] });
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [repo("api"), repo("web")], ciclo: { revisionEnStop: { activo: true, lectura } }, autoajuste: { activo: false }, autoconfigurar: false }));
  for (const [f, t] of Object.entries(BASE)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), t);
  }
  for (const r of ["api", "web"]) {
    const g = (...a) => execFileSync("git", a, { cwd: join(root, r), stdio: "ignore" });
    g("init", "-q", "-b", "main");
    g("add", "-A");
    g("-c", "user.email=eval@example.com", "-c", "user.name=eval", "commit", "-qm", "base");
  }
  for (const c of caso.cambios) {
    const p = join(root, c.archivo);
    const antes = readFileSync(p, "utf8");
    if (!antes.includes(c.de)) throw new Error(`${caso.id}: no encuentro el texto a cambiar en ${c.archivo}`);
    writeFileSync(p, antes.replace(c.de, c.a));
  }
  return root;
}

async function uno(caso, modo) {
  const root = armar(caso, modo === "lectura");
  try {
    const cfg = loadConfig(root);
    const diff = diffEnRama(cfg, "main");
    const [id] = lanzarRevisiones(cfg, { diff, revisores: [caso.revisor], lanzar: () => {} });
    const t0 = Date.now();
    const res = await revisar(cfg, id);
    const a = leerRevisiones(cfg).revisiones.find((x) => x.id === id);
    const acierta = caso.tipo === "error" ? res.estado === "fallo" : res.estado === "ok";
    return { caso: caso.id, tipo: caso.tipo, modo, estado: res.estado, acierta, costo: res.costo ?? 0, seg: Math.round((Date.now() - t0) / 1000), hallazgos: (res.hallazgos ?? []).map((h) => h.problema).slice(0, 2), ...(a?.motivo ? { motivo: a.motivo } : {}) };
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const casos = arg("casos") ? CASOS.filter((c) => arg("casos").split(",").includes(c.id)) : CASOS;
  const tareas = [];
  for (let v = 0; v < Number(arg("veces", "2")); v++) for (const modo of arg("modos", "diff,lectura").split(",")) for (const c of casos) tareas.push([c, modo]);
  const filas = [];
  const paralelo = Number(arg("paralelo", "5"));
  let i = 0;
  await Promise.all(
    Array.from({ length: paralelo }, async () => {
      while (i < tareas.length) {
        const [c, modo] = tareas[i++];
        const f = await uno(c, modo);
        filas.push(f);
        console.error(JSON.stringify(f));
      }
    }),
  );
  const resumen = {};
  for (const modo of new Set(filas.map((f) => f.modo))) {
    const de = filas.filter((f) => f.modo === modo);
    const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null;
    resumen[modo] = {
      errores: `${de.filter((f) => f.tipo === "error" && f.acierta).length} de ${de.filter((f) => f.tipo === "error").length}`,
      limpios: `${de.filter((f) => f.tipo === "limpio" && f.acierta).length} de ${de.filter((f) => f.tipo === "limpio").length}`,
      fallidas: de.filter((f) => f.estado === "error").length,
      costoMedianoUSD: med(de.map((f) => f.costo)),
      segMediano: med(de.map((f) => f.seg)),
      costoTotalUSD: Math.round(de.reduce((s, f) => s + f.costo, 0) * 1000) / 1000,
    };
  }
  const informe = { resumen, filas };
  if (arg("salida")) writeFileSync(arg("salida"), JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(resumen, null, 2));
}
