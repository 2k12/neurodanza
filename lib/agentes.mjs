// neurodanza · registro de tiempo por subagente (corte por tiempo, no solo por pasos).
// Cada evento de hook con `agent_id` actualiza `.neurodanza/agentes/<agent_id>.json`: cuándo empezó, su
// tipo, su último paso y cuántos pasos lleva. Un archivo por agente (escritura atómica): varios agentes
// a la vez no se pisan ni pierden actualizaciones, sin bloqueos. `leerAgentes` los reúne.
// Al 80 % de `ciclo.maxSegundos` se avisa; al 100 % la barrera rechaza toda herramienta nueva del agente.
// Si pasa `ciclo.latidoSeg` sin dar un paso, queda marcado «sin latido». Ver docs/15-velocidad.md.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { escribirAtomico } from "./procesos.mjs";

export const MENSAJE_CORTE = "neurodanza: se acabó tu tiempo. Entrega YA tu respuesta en el formato pedido con lo que tienes y marca lo que no alcanzaste a revisar.";

/** Clase de un subagente por su tipo (`neurodanza:revisor-ui` → revisor). */
export function clase(tipo) {
  const t = String(tipo ?? "");
  if (/revisor-/.test(t)) return "revisor";
  if (/persona/.test(t)) return "persona";
  if (/implementador/.test(t)) return "implementador";
  return "otro";
}

const carpeta = (cfg) => cfg.abs(".neurodanza/agentes");
const seguro = (id) => String(id).replace(/[^\w.-]/g, "_").slice(0, 80);
const archivo = (cfg, id) => join(carpeta(cfg), `${seguro(id)}.json`);

function leer(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Tope en segundos para un agente según su clase. */
export const maxSegDe = (cfg, tipo) => cfg.ciclo?.maxSegundos?.[clase(tipo)] ?? cfg.ciclo?.maxSegundos?.otro ?? 420;

/**
 * Juicio de tiempo de un agente (puro). Devuelve el agente actualizado y qué hacer:
 * `corte` (100 %: rechazar), `aviso` (80 %, una sola vez) o nada.
 */
export function juzgarPaso(agente, ahora, maxSeg) {
  const usado = (ahora - agente.inicio) / 1000;
  const a = { ...agente, ultimoPaso: ahora, pasos: (agente.pasos ?? 0) + 1, maxSeg, sinLatido: false };
  if (usado >= maxSeg) return { agente: { ...a, agotado: true }, corte: true };
  if (usado >= maxSeg * 0.8 && !agente.avisado80) {
    const resta = Math.max(1, Math.round(maxSeg - usado));
    return { agente: { ...a, avisado80: true }, aviso: `neurodanza: llevas ${Math.round(usado)} de ${maxSeg} s. Te quedan ~${resta} s: cierra, verifica solo lo que falte para decidir y entrega tu respuesta en el formato pedido.` };
  }
  return { agente: a };
}

/** Registra un paso de un subagente (desde guardrails). Devuelve { agente, corte?, aviso? }. */
export function registrarPaso(cfg, event, ahora = Date.now()) {
  const id = event.agent_id;
  mkdirSync(carpeta(cfg), { recursive: true });
  const f = archivo(cfg, id);
  const previo = leer(f) ?? { id, tipo: event.agent_type ?? "", inicio: ahora, pasos: 0 };
  if (previo.terminado) previo.terminado = false;
  const r = juzgarPaso(previo, ahora, maxSegDe(cfg, previo.tipo || event.agent_type));
  r.agente.ultimo = `${event.tool_name ?? ""}`.slice(0, 40);
  escribirAtomico(f, JSON.stringify(r.agente));
  return r;
}

/**
 * Revisa a los demás agentes (desde cualquier evento): marca «sin latido» a quien pasó `latidoSeg` sin un
 * paso, y «agotado» a quien superó su tope aunque no haya vuelto a intentar nada. Barato: pocos archivos.
 */
export function revisarLatidos(cfg, ahora = Date.now(), excepto = "") {
  const latido = (cfg.ciclo?.latidoSeg ?? 90) * 1000;
  let dir;
  try {
    dir = readdirSync(carpeta(cfg));
  } catch {
    return [];
  }
  const marcados = [];
  for (const n of dir) {
    if (!n.endsWith(".json")) continue;
    const f = join(carpeta(cfg), n);
    const a = leer(f);
    if (!a || a.terminado || a.id === excepto) continue;
    const sinLatido = ahora - (a.ultimoPaso ?? a.inicio) > latido;
    const agotado = (ahora - a.inicio) / 1000 >= (a.maxSeg ?? maxSegDe(cfg, a.tipo));
    if ((sinLatido && !a.sinLatido) || (agotado && !a.agotado)) {
      const b = { ...a, sinLatido: a.sinLatido || sinLatido, agotado: a.agotado || agotado };
      if (sinLatido && !a.sinLatido) b.sinLatidoDesde = ahora;
      escribirAtomico(f, JSON.stringify(b));
      marcados.push(b);
    }
  }
  return marcados;
}

/** Un subagente terminó (SubagentStop): ya no cuenta para latidos. */
export function terminar(cfg, id, ahora = Date.now()) {
  const f = archivo(cfg, id);
  const a = leer(f);
  if (a) escribirAtomico(f, JSON.stringify({ ...a, terminado: true, fin: ahora, sinLatido: false }));
}

/** Todos los agentes registrados: { id: agente }. */
export function leerAgentes(cfg) {
  const out = {};
  try {
    for (const n of readdirSync(carpeta(cfg))) if (n.endsWith(".json")) {
      const a = leer(join(carpeta(cfg), n));
      if (a?.id) out[a.id] = a;
    }
  } catch {
    /* sin agentes */
  }
  return out;
}

/** Borra registros de más de un día (al iniciar la sesión). */
export function limpiarViejos(cfg, ahora = Date.now()) {
  try {
    for (const n of readdirSync(carpeta(cfg))) {
      const f = join(carpeta(cfg), n);
      if (ahora - statSync(f).mtimeMs > 86_400_000) rmSync(f, { force: true });
    }
  } catch {
    /* nada que limpiar */
  }
}
