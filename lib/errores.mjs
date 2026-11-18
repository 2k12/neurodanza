#!/usr/bin/env node
// neurodanza · catálogo de errores conocidos del proyecto.
// Cada problema que marcan los hooks (lint, tipos, pruebas, definición de terminado) se guarda con
// una firma estable (sin rutas, números ni horas) y un contador. Cuando alguien anota cómo se
// resolvió, la próxima vez que aparezca el hook muestra esa solución junto al error.
// Ver docs/12-errores-conocidos.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node errores.mjs listar [--todos]                        los más frecuentes (sin --todos: los repetidos)
//   node errores.mjs resolver --firma <f> --solucion "…"     anota cómo se resuelve
//   node errores.mjs buscar --texto "…"                      ¿este error ya es conocido?
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

/**
 * Texto normalizado de un error: sin rutas, números, horas, hashes ni comillas variables, para que
 * el mismo problema en otro archivo o línea tenga la misma firma.
 */
export function normalize(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(" ")
    .replace(/[A-Za-z]:[\\/][^\s:'"`)]+/g, "<ruta>")
    .replace(/(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+/g, "<ruta>")
    .replace(/\b[0-9a-f]{7,40}\b/gi, "<hash>")
    .replace(/\d+(?:[.:]\d+)*/g, "<n>")
    .replace(/(["'`«])[^"'`»]{1,80}(["'`»])/g, "$1…$2")
    .replace(/\s+/g, " ")
    .slice(0, 240)
    .trim();
}

export const firmaDe = (text) => createHash("sha1").update(normalize(text)).digest("hex").slice(0, 10);

/** Categoría corta del problema, por su encabezado (`backend · tipos:` → `tipos`). */
export function categoria(text) {
  const head = String(text).split(/\r?\n/)[0];
  const m = head.match(/·\s*([\wáéíóúñ ]+?):/i);
  if (m) return m[1].trim();
  const n = head.match(/^([\wáéíóúñ ]+?):/i);
  return n ? n[1].trim() : "otro";
}

export function load(file) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" && data.errores ? data : { errores: {} };
  } catch {
    return { errores: {} };
  }
}

function save(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Registra problemas (puro sobre `data`): suma uno a cada firma vista y devuelve, por problema, si
 * ya era conocido y su solución.
 */
export function registrar(data, problemas, now = new Date().toISOString(), sesion = "") {
  return problemas.map((texto) => {
    const firma = firmaDe(texto);
    const prev = data.errores[firma];
    const e = prev ?? { firma, categoria: categoria(texto), patron: normalize(texto), ejemplo: String(texto).slice(0, 600), veces: 0, primera: now, solucion: null };
    // Una vez por sesión: el mismo error que bloquea 3 veces seguidas no es "3 veces".
    if (!sesion || e.sesion !== sesion) e.veces += 1;
    e.sesion = sesion;
    e.ultima = now;
    data.errores[firma] = e;
    return { texto, firma, veces: e.veces, solucion: e.solucion };
  });
}

/** Texto del problema con la pista del catálogo, si ya se repitió o tiene solución. */
export function anotar({ texto, firma, veces, solucion }, cli = "node <plugin>/lib/errores.mjs") {
  if (solucion) return `${texto}\n  ↳ error conocido [${firma}] (${veces} veces). Se resolvió así: ${solucion}`;
  if (veces > 1) return `${texto}\n  ↳ se repite [${firma}] (${veces} veces) y no tiene solución anotada. Al resolverlo: ${cli} resolver --firma ${firma} --solucion "…"`;
  return texto;
}

/** Los más útiles para empezar una sesión: con solución primero, luego los más repetidos. */
export function top(data, n = 5) {
  return Object.values(data.errores)
    .filter((e) => e.solucion || e.veces > 1)
    .sort((a, b) => Number(Boolean(b.solucion)) - Number(Boolean(a.solucion)) || b.veces - a.veces)
    .slice(0, n);
}

export const archivoDe = (cfg) => cfg.abs(cfg.errores?.archivo ?? ".neurodanza/errores.json");

/** Registra y anota en el archivo del proyecto (no falla nunca: el catálogo es una ayuda). */
export function registrarEnProyecto(cfg, problemas, sesion = "") {
  if (!problemas.length || cfg.errores?.activo === false) return problemas;
  try {
    const file = archivoDe(cfg);
    const data = load(file);
    const cli = `node "${fileURLToPath(import.meta.url).replace(/\\/g, "/")}"`;
    const out = registrar(data, problemas, undefined, sesion).map((r) => anotar(r, cli));
    save(file, data);
    return out;
  } catch {
    return problemas;
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const file = archivoDe(cfg);
  const data = load(file);
  const cmd = process.argv[2];
  if (cmd === "resolver") {
    const firma = arg("firma");
    const solucion = arg("solucion");
    if (!firma || !solucion) {
      console.error('Uso: errores.mjs resolver --firma <f> --solucion "…"');
      process.exit(1);
    }
    const e = data.errores[firma];
    if (!e) {
      console.error(`No conozco la firma ${firma}. Mira: errores.mjs listar --todos`);
      process.exit(1);
    }
    e.solucion = solucion;
    e.resuelto = new Date().toISOString();
    save(file, data);
    console.log(`anotado [${firma}] · ${e.categoria} · ${e.veces} veces`);
  } else if (cmd === "buscar") {
    const e = data.errores[firmaDe(arg("texto") ?? "")];
    console.log(e ? JSON.stringify(e, null, 2) : "no es un error conocido");
  } else {
    const todos = process.argv.includes("--todos");
    const list = todos ? Object.values(data.errores).sort((a, b) => b.veces - a.veces) : top(data, 20);
    if (!list.length) console.log("sin errores repetidos todavía");
    for (const e of list) console.log(`[${e.firma}] ${e.veces}× ${e.categoria} · ${e.patron.slice(0, 110)}${e.solucion ? `\n    ✔ ${e.solucion}` : ""}`);
  }
}
