#!/usr/bin/env node
// neurodanza · fusible: nada de reintentos infinitos contra algo externo que no responde.
// Cada capa vigilada (app, chromium, bd o cualquier comando externo) cuenta sus fallos en el ciclo
// (`.neurodanza/fusible.json`, se reinicia al empezar uno nuevo). Con `fusible.maxFallos` fallos (2) la
// capa queda «fundida»: el panel y el skill la saltan, el hook Stop lo informa como «no se pudo verificar»
// y el panel queda PENDIENTE (ni aprobado ni reprobado): lo decide el usuario. Ver docs/15-velocidad.md.
//
//   node fusible.mjs falla --capa <c> --detalle "…"     registra un fallo (dice si la capa quedó fundida)
//   node fusible.mjs estado [--capa <c>]                estado de una capa o de todas
//   node fusible.mjs comprobar --capa <c>               corre la comprobación configurada (fusible.comprobaciones) y registra si falla
//   node fusible.mjs reiniciar [--ciclo <id>]           empieza un ciclo nuevo (todas las capas en cero)
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { correr, escribirAtomico } from "./procesos.mjs";

export const archivoFusible = (cfg) => cfg.abs(".neurodanza/fusible.json");
const maxFallos = (cfg) => cfg.fusible?.maxFallos ?? 2;

export function leerFusible(cfg) {
  try {
    return JSON.parse(readFileSync(archivoFusible(cfg), "utf8"));
  } catch {
    return { ciclo: "", inicio: "", capas: {} };
  }
}

function guardar(cfg, e) {
  mkdirSync(cfg.abs(".neurodanza"), { recursive: true });
  escribirAtomico(archivoFusible(cfg), JSON.stringify(e, null, 2));
}

/** Registra un fallo de una capa (puro sobre `estado`). La capa se funde al llegar a `max` fallos. */
export function registrarFallo(estado, capa, detalle, max = 2, fecha = new Date().toISOString()) {
  const c = (estado.capas[capa] ??= { fallos: [], fundida: false });
  c.fallos.push({ fecha, detalle: String(detalle ?? "").slice(0, 300) });
  if (!c.fundida && c.fallos.length >= max) {
    c.fundida = true;
    c.motivo = String(detalle ?? "").slice(0, 200) || "falló varias veces";
    c.desde = fecha;
  }
  return c;
}

export function falla(cfg, capa, detalle) {
  const e = leerFusible(cfg);
  const c = registrarFallo(e, capa, detalle, maxFallos(cfg));
  guardar(cfg, e);
  return c;
}

/** Capas fundidas del ciclo: [{ capa, motivo }]. */
export function fundidas(cfg) {
  return Object.entries(leerFusible(cfg).capas)
    .filter(([, c]) => c.fundida)
    .map(([capa, c]) => ({ capa, motivo: c.motivo ?? "" }));
}

export const fundida = (cfg, capa) => leerFusible(cfg).capas[capa]?.fundida === true;

export function reiniciar(cfg, ciclo = "") {
  guardar(cfg, { ciclo: String(ciclo || new Date().toISOString()), inicio: new Date().toISOString(), capas: {} });
}

/** Texto del estado de una capa: «fundida (motivo)» u «ok (n/max fallos)». */
export function textoCapa(cfg, capa) {
  const c = leerFusible(cfg).capas[capa];
  if (!c) return `${capa}: ok (0/${maxFallos(cfg)} fallos)`;
  return c.fundida ? `${capa}: fundida (${c.motivo})` : `${capa}: ok (${c.fallos.length}/${maxFallos(cfg)} fallos)`;
}

/** Corre la comprobación configurada de una capa (p. ej. bd). Devuelve { ok, texto }. */
export async function comprobar(cfg, capa) {
  if (fundida(cfg, capa)) return { ok: false, texto: textoCapa(cfg, capa) };
  const cmd = cfg.fusible?.comprobaciones?.[capa];
  if (!cmd) return { ok: true, texto: `${capa}: sin comprobación configurada (fusible.comprobaciones.${capa})` };
  const r = await correr(cmd, { cwd: cfg.root, timeoutMs: 30_000 });
  if (r.ok) return { ok: true, texto: `${capa}: ok` };
  const c = falla(cfg, capa, r.cortado ? "no respondió en 30 s" : String(r.out).trim().split(/\r?\n/).pop() || `salió con ${r.code}`);
  return { ok: false, texto: c.fundida ? `${capa}: fundida (${c.motivo})` : `${capa}: falló (${c.fallos.length}/${maxFallos(cfg)})` };
}

// ───────────────────────── CLI ─────────────────────────

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
  const cmd = process.argv[2];
  const capa = arg("capa");
  if (cmd === "falla") {
    if (!capa) {
      console.error('Uso: fusible.mjs falla --capa <c> --detalle "…"');
      process.exit(1);
    }
    const c = falla(cfg, capa, arg("detalle") ?? "");
    console.log(c.fundida ? `${capa}: fundida (${c.motivo}) — sáltala: el panel queda pendiente` : `${capa}: fallo ${c.fallos.length}/${maxFallos(cfg)}`);
  } else if (cmd === "estado") {
    if (capa) console.log(textoCapa(cfg, capa));
    else {
      const e = leerFusible(cfg);
      const lineas = Object.keys(e.capas).map((k) => textoCapa(cfg, k));
      console.log(lineas.length ? lineas.join("\n") : "todas las capas ok");
    }
  } else if (cmd === "comprobar") {
    const r = await comprobar(cfg, capa ?? "");
    console.log(r.texto);
    process.exitCode = r.ok ? 0 : 1;
  } else if (cmd === "reiniciar") {
    reiniciar(cfg, arg("ciclo"));
    console.log("fusible reiniciado: ciclo nuevo");
  } else {
    console.error("Uso: fusible.mjs falla --capa <c> --detalle … | estado [--capa <c>] | comprobar --capa <c> | reiniciar [--ciclo <id>]");
    process.exit(1);
  }
}
