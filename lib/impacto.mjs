#!/usr/bin/env node
// neurodanza · mapa de impacto: archivo cambiado → pantallas que lo usan (por los imports del índice, y los
// layouts de Next para todo lo que cuelga de su carpeta) → recorridos permanentes que pasan por esas pantallas.
// Así se repiten mecánicamente solo los recorridos que el cambio puede tocar, también en pantallas que nadie
// pensó revisar. Ver docs/23-regresion-mecanica.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node impacto.mjs [--base main] [--archivos "repo:ruta,repo:ruta"]   pantallas y recorridos afectados (JSON)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { changesInBranch } from "./cambios.mjs";
import { loadConfig } from "./config.mjs";
import { indiceDe, reposDe } from "./indice.mjs";
import { carpetaPermanentes } from "./recorridos.mjs";

const LAYOUT = /(^|\/)layout\.(m|c)?[jt]sx?$/;

/**
 * Pantallas afectadas por los archivos cambiados de un repo (puro sobre el índice). Sube por quién importa a
 * quién (hasta `max` saltos); un layout alcanzado afecta a todas las pantallas de su carpeta.
 * Devuelve [{ ruta, archivo, via: [cambiado, …, pantalla] }].
 */
export function pantallasAfectadas(ind, archivos, { max = 8 } = {}) {
  const importadoPor = {};
  for (const [rel, info] of Object.entries(ind.archivos ?? {})) for (const d of info.importa ?? []) (importadoPor[d] ??= []).push(rel);
  const porArchivo = new Map((ind.pantallas ?? []).map((p) => [p.archivo, p]));
  const out = new Map();
  const agregar = (p, via) => {
    if (!out.has(p.ruta)) out.set(p.ruta, { ruta: p.ruta, archivo: p.archivo, via });
  };
  for (const inicio of archivos) {
    const vistos = new Map([[inicio, [inicio]]]);
    let frente = [inicio];
    for (let salto = 0; frente.length && salto <= max; salto++) {
      const sig = [];
      for (const f of frente) {
        const via = vistos.get(f);
        if (porArchivo.has(f)) agregar(porArchivo.get(f), via);
        if (LAYOUT.test(f)) {
          const carpeta = posix.dirname(f);
          for (const p of ind.pantallas ?? []) if (p.archivo.startsWith(`${carpeta}/`)) agregar(p, [...via, p.archivo]);
        }
        for (const q of importadoPor[f] ?? []) {
          if (vistos.has(q)) continue;
          vistos.set(q, [...via, q]);
          sig.push(q);
        }
      }
      frente = sig;
    }
  }
  return [...out.values()].sort((a, b) => a.ruta.localeCompare(b.ruta));
}

/** Rutas por las que pasa un recorrido: las de sus pasos y las que espera alcanzar. */
export const rutasDe = (r) => [...new Set((r.pasos ?? []).flatMap((p) => [p.ruta, p.espera?.url]).filter(Boolean).map((x) => String(x).split("?")[0]))];

/** ¿La ruta concreta de un recorrido es la de una pantalla (con segmentos dinámicos de Next)? */
export function coincide(rutaPantalla, ruta) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const partes = String(rutaPantalla).split("/").filter(Boolean).map((s) => (/^\[\[?\.\.\.[^\]]+\]\]?$/.test(s) ? "(?:/.+)?" : /^\[[^\]]+\]$/.test(s) ? "/[^/]+" : `/${esc(s)}`));
  return new RegExp(`^${partes.join("")}/?$`).test(String(ruta).replace(/\/+$/, "") || "/");
}

/** Recorridos permanentes que pasan por alguna pantalla afectada (puro). */
export function recorridosAfectados(recorridos, pantallas) {
  const afectados = [];
  const noAfectados = [];
  for (const r of recorridos) {
    const rutas = rutasDe(r);
    const toca = pantallas.filter((p) => rutas.some((x) => coincide(p.ruta, x)));
    if (toca.length) afectados.push({ id: r.id, persona: r.persona, tarea: r.tarea, pantallas: toca.map((p) => p.ruta), via: toca[0].via });
    else noAfectados.push(r.id);
  }
  return { afectados, noAfectados };
}

/** Recorridos permanentes del proyecto (archivos `<id>.json` de `panel.recorridos`). */
export function permanentes(cfg) {
  const dir = carpetaPermanentes(cfg);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((r) => r?.id && Array.isArray(r.pasos));
}

/** Impacto del cambio: `changes` = { repo: [archivos] } (por defecto, el de la rama). */
export function impacto(cfg, { base = cfg.retroalimentacion?.version?.ramaBase ?? "main", changes = null } = {}) {
  const ch = changes ?? changesInBranch(cfg, base);
  const pantallas = [];
  for (const r of reposDe(cfg)) {
    const fs = ch[r.nombre] ?? [];
    if (!fs.length) continue;
    const ind = indiceDe(cfg, r);
    for (const p of pantallasAfectadas(ind, fs)) pantallas.push({ ...p, repo: r.nombre });
  }
  const recs = recorridosAfectados(permanentes(cfg), pantallas);
  return { pantallas, ...recs, duenos: [...new Set(recs.afectados.map((x) => x.persona))] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig(process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json en esta carpeta ni en las de arriba.");
    process.exit(2);
  }
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  let changes = null;
  if (arg("archivos")) {
    changes = {};
    for (const x of arg("archivos").split(",").map((s) => s.trim()).filter(Boolean)) {
      const [repo, f] = x.split(/:(.+)/);
      (changes[repo] ??= []).push(f);
    }
  }
  const r = impacto(cfg, { ...(arg("base") ? { base: arg("base") } : {}), changes });
  console.log(JSON.stringify({ pantallas: r.pantallas.map((p) => ({ repo: p.repo, ruta: p.ruta, via: p.via.join(" → ") })), afectados: r.afectados.map((x) => ({ id: x.id, persona: x.persona, pantallas: x.pantallas })), noAfectados: r.noAfectados, duenos: r.duenos }, null, 2));
}
