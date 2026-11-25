// neurodanza · gasto: cuánto pesan los tokens de una sesión y el tope por ciclo (`ciclo.maxTokens`). El tope se mira
// solo al lanzar un subagente, que es donde crece el gasto: al llegar, la barrera lo rechaza y el usuario decide si el
// ciclo sigue. Apagado por defecto. Ver docs/27-costo.md.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { leerFusible } from "./fusible.mjs";
import { escribirAtomico } from "./procesos.mjs";

const n = (x) => (Number.isFinite(x) ? x : 0);

/**
 * Peso aproximado de unos tokens, en tokens de entrada (puro): la salida cuesta 5 veces la entrada; escribir caché, 2;
 * leerla, 0,1. Sirve para comparar dentro de un mismo modelo; no es dinero.
 */
export const peso = ({ entrada = 0, salida = 0, cacheLeida = 0, cacheCreada = 0 }) => Math.round(n(entrada) + n(salida) * 5 + n(cacheCreada) * 2 + n(cacheLeida) * 0.1);

const tokensDe = (u) => ({ entrada: n(u.input_tokens), salida: n(u.output_tokens), cacheLeida: n(u.cache_read_input_tokens), cacheCreada: n(u.cache_creation_input_tokens) });

/** Peso de las líneas de un transcript desde una fecha (puro). Un mensaje llega en varias líneas: cuenta una vez. */
export function pesoDeLineas(lineas, desde = "") {
  const porMensaje = new Map();
  for (const l of lineas) {
    if (!l.includes('"usage"')) continue;
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    const u = e?.type === "assistant" ? e.message?.usage : null;
    if (!u || (desde && e.timestamp && e.timestamp < desde)) continue;
    const id = e.message.id ?? e.requestId ?? e.uuid;
    porMensaje.set(id, Math.max(porMensaje.get(id) ?? 0, peso(tokensDe(u))));
  }
  return [...porMensaje.values()].reduce((s, x) => s + x, 0);
}

/** Peso de la sesión (su transcript y los de sus subagentes) desde que empezó el ciclo. */
export function pesoDelCiclo(cfg, transcript) {
  const desde = leerFusible(cfg).inicio || "";
  const dir = join(String(transcript).replace(/\.jsonl$/, ""), "subagents");
  let subs = [];
  try {
    subs = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".jsonl")).map((f) => join(dir, String(f)));
  } catch {
    subs = [];
  }
  return [transcript, ...subs].reduce((s, f) => {
    try {
      return s + pesoDeLineas(readFileSync(f, "utf8").split("\n"), desde);
    } catch {
      return s;
    }
  }, 0);
}

const archivo = (cfg) => cfg.abs(".neurodanza/gasto.json");
const ciclo = (cfg) => leerFusible(cfg).inicio || "sin ciclo";

function permitidos(cfg) {
  try {
    const e = JSON.parse(readFileSync(archivo(cfg), "utf8"));
    return e.ciclo === ciclo(cfg) ? n(e.topes) : 0;
  } catch {
    return 0;
  }
}

/** El usuario aceptó seguir: otro tope igual para este ciclo. */
export function seguir(cfg) {
  const topes = permitidos(cfg) + 1;
  mkdirSync(cfg.abs(".neurodanza"), { recursive: true });
  escribirAtomico(archivo(cfg), JSON.stringify({ ciclo: ciclo(cfg), topes }));
  return { tope: cfg.ciclo.maxTokens * (topes + 1) };
}

/** Motivo para no lanzar otro subagente, o null. Sin `ciclo.maxTokens` no lee nada. */
export function topeAlcanzado(cfg, event, cli) {
  const max = cfg.ciclo?.maxTokens ?? 0;
  if (!(max > 0) || !["Agent", "Task"].includes(event.tool_name) || !event.transcript_path) return null;
  const tope = max * (permitidos(cfg) + 1);
  const gastado = pesoDelCiclo(cfg, event.transcript_path);
  if (gastado < tope) return null;
  return `neurodanza: este ciclo ya gastó ${gastado} de ${tope} (ciclo.maxTokens, peso aproximado en tokens). No lances más subagentes: dile al usuario qué falta y pregúntale si sigue. Si acepta: node "${cli}" seguir`;
}

/** ¿El comando amplía el tope? Lo decide el usuario en la ventana de permisos. */
export const ampliaTope = (event) => ["Bash", "PowerShell", "Monitor"].includes(event.tool_name) && /ciclo\.mjs["']?\s+["']?seguir\b/.test(String(event.tool_input?.command ?? ""));
