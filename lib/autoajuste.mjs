#!/usr/bin/env node
// neurodanza · autoajuste: el harness se mide y se ajusta solo, con freno. Una vez al día (al iniciar la primera
// sesión, en segundo plano) lee la telemetría de las sesiones (lib/telemetria.mjs) y:
//   - rechazos de las barreras que se repiten → lecciones del agente que los provoca (constructos: candidata →
//     a prueba → aprobada solo si el rechazo baja por día; si no baja, se descarta sola);
//   - errores de comandos que se repiten (aunque el comando cambie) → catálogo de errores conocidos (se muestran
//     al iniciar; con su solución anotada, la próxima vez viene con ella);
//   - comandos largos repetidos entre sesiones → sugerencias de macro (app.mjs sugeridas);
//   - subagentes que se cortan por tiempo una y otra vez → propuesta de presupuesto (la aplica el usuario) que
//     después se evalúa: si los cortes no bajan, se propone revertirla;
//   - comandos configurados que fallan siempre y fallos de los scripts del plugin → propuestas para corregirlos.
// Ver docs/22-autoajuste.md.
//
// Uso (desde cualquier carpeta del proyecto):
//   node autoajuste.mjs diario [--transcripts <carpeta>] [--silencioso]   recolecta, aprende y propone
//   node autoajuste.mjs propuestas                                         pendientes y evaluaciones
//   node autoajuste.mjs aplicar --id <id> | descartar --id <id> | revertir --id <id>
//   node autoajuste.mjs informe                                            qué aprendió y qué cambió, con números
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clase } from "./agentes.mjs";
import { loadConfig } from "./config.mjs";
import { escribirAtomico } from "./procesos.mjs";
import { normalizarComando, recolectar } from "./telemetria.mjs";

export const UMBRALES = { rechazos: 3, errores: 3, cortes: 3, sesionesCorte: 2, sesionesEvaluar: 5, mejoraMin: 0.3, factorPresupuesto: 1.5, horasCerrada: 2 };

const leerJson = (f, d) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
const archivoEstado = (cfg) => cfg.abs(".neurodanza/autoajuste.json");
/** Ajustes aplicados (en git: los comparte el equipo y queda la historia). */
export const archivoAjustes = (cfg) => cfg.abs(cfg.autoajuste?.ajustes ?? ".claude/neurodanza-ajustes.json");
const guardar = (f, d) => {
  mkdirSync(dirname(f), { recursive: true });
  escribirAtomico(f, JSON.stringify(d, null, 2) + "\n");
};
const hash = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 8);

/** `ascii-con-guiones` corto para una etiqueta. */
const slug = (s, max = 40) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "x";

/** Etiqueta de constructo para un motivo de rechazo: `barrera:<palabras>-<hash>` (estable por motivo). */
export const etiquetaRechazo = (motivo) => `barrera:${slug(motivo, 32)}-${hash(motivo).slice(0, 4)}`;
/** Constructo de un agente de la telemetría (`principal` o el tipo del subagente). */
export const constructoDe = (agente) => String(agente || "principal").replace(/^neurodanza:/, "");
const dia = (iso) => String(iso ?? "").slice(0, 10) || "sin-fecha";

/**
 * Reflexiones por día (puro) para los constructos, a partir de las sesiones cerradas que todavía no se
 * procesaron. Solo entran los motivos de rechazo que se repiten (≥ `rechazos` veces en total): uno suelto no es
 * una lección. `agentes` del día = todos los que trabajaron (también sin problemas: así el juicio ve si bajó).
 * Devuelve { reflexiones, procesadas } (las claves nuevas).
 */
export function reflexionesDe(resumen, procesadas = [], { u = UMBRALES, ahora = Date.now() } = {}) {
  const hechas = new Set(procesadas);
  const repetidos = new Set(Object.entries(resumen.rechazos ?? {}).filter(([, a]) => a.veces >= u.rechazos).map(([m]) => m));
  const porDia = new Map();
  const nuevas = [];
  for (const s of resumen.lista ?? []) {
    const clave = s.archivo ?? `${s.sesion}|${s.agente}|${s.inicio}`;
    if (hechas.has(clave)) continue;
    if (!s.fin || ahora - Date.parse(s.fin) < u.horasCerrada * 3600_000) continue; // todavía puede seguir
    nuevas.push(clave);
    const d = dia(s.inicio);
    const r = porDia.get(d) ?? { ciclo: `telemetria-${d}`, agentes: new Map(), problemas: [] };
    const c = constructoDe(s.subagente ? s.agente || "subagente" : "principal");
    r.agentes.set(c, { constructo: c });
    for (const x of s.rechazos ?? []) {
      if (!repetidos.has(x.motivo)) continue;
      const texto = x.texto ?? x.motivo;
      r.problemas.push({ constructo: c, etiqueta: etiquetaRechazo(x.motivo), fuente: "telemetría", detalle: texto, leccion: `La barrera rechaza esto (ya pasó ${resumen.rechazos[x.motivo].veces} veces): «${texto}». No lo intentes; si de verdad hace falta, pídeselo al usuario.` });
    }
    porDia.set(d, r);
  }
  const reflexiones = [...porDia.values()].sort((a, b) => a.ciclo.localeCompare(b.ciclo)).map((r) => ({ ...r, agentes: [...r.agentes.values()] }));
  return { reflexiones, procesadas: nuevas };
}

/** Errores de comandos repetidos por sesión nueva (puro): [{ texto, sesion }] para el catálogo de errores conocidos. */
export function erroresDe(resumen, procesadas = [], { u = UMBRALES, ahora = Date.now() } = {}) {
  const hechas = new Set(procesadas);
  const repetidos = Object.entries(resumen.errores ?? {}).filter(([, e]) => e.veces >= u.errores);
  const firmas = new Map(repetidos);
  const out = [];
  for (const s of resumen.lista ?? []) {
    const clave = s.archivo ?? `${s.sesion}|${s.agente}|${s.inicio}`;
    if (hechas.has(clave) || !s.fin || ahora - Date.parse(s.fin) < u.horasCerrada * 3600_000) continue;
    for (const f of new Set(s.fallos ?? [])) if (firmas.has(f)) out.push({ texto: `comando que falla:\n${f}\nejemplo: ${firmas.get(f).comandos[0] ?? ""}`.slice(0, 600), sesion: `${s.sesion}|${s.agente}` });
  }
  return out;
}

/** Comandos de la configuración (normalizados) → { repo, campo }. */
function comandosConfigurados(cfg) {
  const out = new Map();
  for (const r of cfg.repos ?? []) for (const campo of ["lint", "tipos", "relacionadas", "suite", "levantar"]) if (r[campo]) out.set(normalizarComando(String(r[campo]).replace(/\{[^}]+\}/g, "")).replace(/\s+$/, ""), { repo: r.nombre, campo });
  return out;
}
const sinCd = (norm) => norm.replace(/^cd\s+\S+\s*&&\s*/, "");

/** Clave de configuración del tope de tiempo de una clase de subagente. */
export const claveTiempo = (c) => (c === "fantasma" ? "fantasmas.maxSegundos" : c === "especialista" ? "hotel.maxSegundos" : `ciclo.maxSegundos.${c}`);
const leerClave = (obj, clave) => clave.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
function ponerClave(obj, clave, valor) {
  const ks = clave.split(".");
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k] ??= {};
  o[ks.at(-1)] = valor;
}

/**
 * Propuestas (puro): presupuesto para las clases de subagente que se cortan por tiempo una y otra vez, comandos
 * configurados que fallan siempre y fallos de los scripts del plugin. Las aplicadas o descartadas no vuelven.
 */
export function propuestasDe(cfg, resumen, { ajustes = [], descartadas = [], u = UMBRALES } = {}) {
  const fuera = new Set([...ajustes.map((a) => a.id), ...descartadas]);
  const out = [];
  const porClase = {};
  for (const [ag, a] of Object.entries(resumen.cortes ?? {})) {
    if (ag === "principal") continue;
    const c = clase(ag);
    const x = (porClase[c] ??= { veces: 0, sesiones: new Set(), agentes: [] });
    x.veces += a.veces;
    a.sesiones.forEach((s) => x.sesiones.add(s));
    x.agentes.push(ag);
  }
  for (const [c, x] of Object.entries(porClase)) {
    if (x.veces < u.cortes || x.sesiones.size < u.sesionesCorte) continue;
    const clave = claveTiempo(c);
    const de = leerClave(cfg, clave);
    if (!Number.isFinite(de)) continue;
    const id = `presupuesto:${c}`;
    if (fuera.has(id)) continue;
    out.push({ id, tipo: "presupuesto", clave, de, a: Math.round((de * u.factorPresupuesto) / 10) * 10, texto: `${x.agentes.join(", ")} se cortó por tiempo ${x.veces} veces en ${x.sesiones.size} sesiones: subir ${clave} de ${de} a ${Math.round((de * u.factorPresupuesto) / 10) * 10} s.` });
  }
  const conf = comandosConfigurados(cfg);
  for (const [norm, a] of Object.entries(resumen.comandos ?? {})) {
    if (a.fallos < u.errores) continue;
    const k = conf.get(sinCd(norm)) ?? conf.get(norm);
    if (!k) continue;
    const id = `config:${k.repo}.${k.campo}`;
    if (fuera.has(id)) continue;
    const [error] = Object.entries(a.errores).sort((x, y) => y[1] - x[1])[0] ?? [""];
    out.push({ id, tipo: "config", repo: k.repo, campo: k.campo, error, texto: `repos[${k.repo}].${k.campo} falló ${a.fallos} de ${a.veces} veces («${error.slice(0, 160)}»): corregirlo en neurodanza.config.json.` });
  }
  for (const [firma, e] of Object.entries(resumen.errores ?? {})) {
    if (e.veces < u.errores) continue;
    const delPlugin = /neurodanza\.config\.json|neurodanza[\\/][^\s]*\.mjs/.test(firma) || e.comandos.some((c) => /neurodanza[\\/](?:[\w.-]+[\\/])*(lib|panel|hooks)[\\/]\w+\.mjs/.test(c));
    if (!delPlugin) continue;
    const id = `plugin:${hash(firma)}`;
    if (fuera.has(id)) continue;
    out.push({ id, tipo: "plugin", texto: `Un script del plugin falló ${e.veces} veces (${Object.entries(e.agentes).map(([k, v]) => `${k} ${v}`).join(", ")}): «${firma.slice(0, 160)}». Ejemplo: ${String(e.comandos[0] ?? "").slice(0, 200)}` });
  }
  return out;
}

/** Comandos largos repetidos entre sesiones que todavía no están en las sugerencias de macro (puro). */
export function macrosDe(cfg, resumen, repetidos = { comandos: {} }) {
  const min = cfg.cli?.repetidoMin ?? 200;
  const veces = cfg.cli?.repetidoVeces ?? 3;
  const ya = new Set(Object.values(repetidos.comandos ?? {}).map((e) => normalizarComando(e.ejemplo)));
  return Object.entries(resumen.comandos ?? {})
    .filter(([norm, a]) => a.largo >= min && a.veces >= veces && a.sesiones.length >= 2 && !/\bapp\.mjs\b/.test(norm) && !ya.has(norm))
    .map(([norm, a]) => ({ norm, veces: a.veces, sesiones: a.sesiones.length }));
}

/**
 * Evalúa los ajustes aplicados con lo que pasó después (puro). Presupuesto: cortes por sesión de esa clase antes
 * y después; con `sesionesEvaluar` sesiones después, mantener si bajó al menos `mejoraMin`, si no, revertir.
 * Config: mantener si el comando dejó de fallar.
 */
export function evaluarAjustes(resumen, ajustes, { u = UMBRALES } = {}) {
  return ajustes
    .filter((a) => a.estado === "aplicado")
    .map((a) => {
      const t = Date.parse(a.fecha);
      if (a.tipo === "presupuesto") {
        const c = a.id.split(":")[1];
        const sesiones = (resumen.lista ?? []).filter((s) => s.subagente && clase(s.agente) === c);
        const antes = sesiones.filter((s) => Date.parse(s.inicio) < t);
        const despues = sesiones.filter((s) => Date.parse(s.inicio) >= t);
        const tasa = (xs) => (xs.length ? xs.reduce((n, s) => n + (s.cortes ?? 0), 0) / xs.length : 0);
        if (despues.length < u.sesionesEvaluar) return { id: a.id, decision: "esperar", texto: `${despues.length} de ${u.sesionesEvaluar} sesiones de ${c} después del cambio` };
        const ta = tasa(antes);
        const td = tasa(despues);
        const mejora = ta > 0 ? (ta - td) / ta : 0;
        const r = { id: a.id, antes: Math.round(ta * 1000) / 1000, despues: Math.round(td * 1000) / 1000, mejora: Math.round(mejora * 100) };
        return mejora >= u.mejoraMin ? { ...r, decision: "mantener", texto: `cortes por sesión de ${c}: ${r.antes} → ${r.despues} (−${r.mejora} %)` } : { ...r, decision: "revertir", texto: `cortes por sesión de ${c}: ${r.antes} → ${r.despues}: no bajó lo suficiente (${r.mejora} % < ${Math.round(u.mejoraMin * 100)} %)` };
      }
      if (a.tipo === "config") {
        const despues = (resumen.lista ?? []).filter((s) => Date.parse(s.inicio) >= t);
        const fallos = despues.reduce((n, s) => n + (s.fallos ?? []).filter((f) => a.error && f === a.error).length, 0);
        if (despues.length < u.sesionesEvaluar) return { id: a.id, decision: "esperar", texto: `${despues.length} de ${u.sesionesEvaluar} sesiones después del cambio` };
        return fallos ? { id: a.id, decision: "revisar", texto: `sigue fallando (${fallos} veces después del cambio)` } : { id: a.id, decision: "mantener", texto: "dejó de fallar" };
      }
      return { id: a.id, decision: "mantener", texto: "sin métrica automática" };
    });
}

// ───────────────────────── con archivos ─────────────────────────

/**
 * Una pasada diaria: recolecta, aprende (lecciones, errores conocidos, macros), propone y evalúa. Devuelve el informe
 * y lo guarda en `.neurodanza/autoajuste.json`.
 */
export async function diario(cfg, { carpetas, ahora = Date.now() } = {}) {
  const u = { ...UMBRALES, ...(cfg.autoajuste?.umbrales ?? {}) };
  const resumen = recolectar(cfg, { ...(carpetas ? { carpetas } : {}), ahora });
  const estado = leerJson(archivoEstado(cfg), { procesadas: [], descartadas: [] });
  const ajustes = leerJson(archivoAjustes(cfg), { ajustes: [] });
  const informe = { fecha: new Date(ahora).toISOString(), sesiones: resumen.sesiones, subagentes: resumen.subagentes, lecciones: [], errores: 0, macros: 0 };

  // Lecciones (constructos): el juicio de siempre decide si quedan.
  const { reflexiones, procesadas } = reflexionesDe(resumen, estado.procesadas, { u, ahora });
  if (reflexiones.length && cfg.constructos?.activo !== false) {
    const k = await import("./constructos.mjs");
    const data = k.cargar(cfg);
    for (const r of reflexiones) informe.lecciones.push(...k.aplicarReflexion(data, r, cfg.constructos ?? {}, new Date(ahora).toISOString()));
    informe.lecciones.push(...k.evaluarTodo(data, cfg.constructos ?? {}, () => null, new Date(ahora).toISOString()));
    k.guardar(cfg, data);
  }
  // Errores conocidos: una vez por sesión, como los que marcan los hooks.
  const errs = erroresDe(resumen, estado.procesadas, { u, ahora });
  if (errs.length) {
    const e = await import("./errores.mjs");
    for (const x of errs) e.registrarEnProyecto(cfg, [x.texto], x.sesion);
    informe.errores = errs.length;
  }
  // Macros: los repetidos entre sesiones entran a las sugerencias (app.mjs sugeridas).
  const fRep = cfg.abs(".neurodanza/app/repetidos.json");
  const rep = leerJson(fRep, { comandos: {} });
  const ms = macrosDe(cfg, resumen, rep);
  for (const m of ms) rep.comandos[createHash("sha1").update(m.norm).digest("hex").slice(0, 10)] ??= { veces: m.veces, ejemplo: m.norm.slice(0, 4000), primera: ahora, ultima: ahora, descartado: false, origen: "telemetría" };
  if (ms.length) {
    guardar(fRep, rep);
    informe.macros = ms.length;
  }
  informe.propuestas = propuestasDe(cfg, resumen, { ajustes: ajustes.ajustes, descartadas: estado.descartadas, u });
  informe.evaluaciones = evaluarAjustes(resumen, ajustes.ajustes, { u });
  informe.semanas = resumen.semanas;
  guardar(archivoEstado(cfg), { ...estado, procesadas: [...estado.procesadas, ...procesadas].slice(-20_000), ultimo: informe });
  return informe;
}

const estadoDe = (cfg) => leerJson(archivoEstado(cfg), { procesadas: [], descartadas: [] });

/** Aplica una propuesta. Presupuesto: cambia neurodanza.config.json; config y plugin: quedan como aceptadas (el arreglo es a mano). */
export function aplicar(cfg, id, { ahora = Date.now() } = {}) {
  const estado = estadoDe(cfg);
  const p = (estado.ultimo?.propuestas ?? []).find((x) => x.id === id);
  if (!p) throw new Error(`no hay una propuesta pendiente con id ${id} (node autoajuste.mjs propuestas).`);
  const ajustes = leerJson(archivoAjustes(cfg), { ajustes: [] });
  const fila = { id, tipo: p.tipo, texto: p.texto, fecha: new Date(ahora).toISOString(), estado: "aplicado" };
  if (p.tipo === "presupuesto") {
    const raw = JSON.parse(readFileSync(cfg.file, "utf8"));
    ponerClave(raw, p.clave, p.a);
    writeFileSync(cfg.file, JSON.stringify(raw, null, 2) + "\n");
    Object.assign(fila, { clave: p.clave, de: p.de, a: p.a });
  }
  if (p.tipo === "config") fila.error = p.error;
  ajustes.ajustes.push(fila);
  guardar(archivoAjustes(cfg), ajustes);
  return fila;
}

/** Revierte un ajuste de presupuesto (vuelve al valor de antes). */
export function revertir(cfg, id, { ahora = Date.now() } = {}) {
  const ajustes = leerJson(archivoAjustes(cfg), { ajustes: [] });
  const a = ajustes.ajustes.find((x) => x.id === id && x.estado === "aplicado");
  if (!a) throw new Error(`no hay un ajuste aplicado con id ${id}.`);
  if (a.tipo === "presupuesto") {
    const raw = JSON.parse(readFileSync(cfg.file, "utf8"));
    ponerClave(raw, a.clave, a.de);
    writeFileSync(cfg.file, JSON.stringify(raw, null, 2) + "\n");
  }
  Object.assign(a, { estado: "revertido", revertido: new Date(ahora).toISOString() });
  guardar(archivoAjustes(cfg), ajustes);
  return a;
}

export function descartar(cfg, id) {
  const estado = estadoDe(cfg);
  estado.descartadas = [...new Set([...(estado.descartadas ?? []), id])];
  if (estado.ultimo) estado.ultimo.propuestas = (estado.ultimo.propuestas ?? []).filter((p) => p.id !== id);
  guardar(archivoEstado(cfg), estado);
}

/**
 * Línea para el inicio de sesión (vacía si no hay nada): propuestas pendientes y ajustes a revertir. Y si la última
 * pasada es de otro día, lanza la de hoy en segundo plano (no demora el inicio).
 */
export function textoInicio(cfg, { ahora = Date.now(), lanzar = true } = {}) {
  if (cfg.autoajuste?.activo === false) return "";
  const estado = estadoDe(cfg);
  const u = estado.ultimo;
  if (lanzar && (!u || dia(u.fecha) !== dia(new Date(ahora).toISOString()))) {
    try {
      spawn(process.execPath, [fileURLToPath(import.meta.url), "diario", "--silencioso"], { cwd: cfg.root, detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch {
      /* el autoajuste es una ayuda */
    }
  }
  if (!u) return "";
  const cli = `node "${fileURLToPath(import.meta.url).replace(/\\/g, "/")}"`;
  const partes = [];
  const props = u.propuestas ?? [];
  if (props.length) partes.push(`${props.length} propuesta${props.length > 1 ? "s" : ""} de ajuste (${props.map((p) => p.tipo).join(", ")})`);
  const rev = (u.evaluaciones ?? []).filter((e) => e.decision === "revertir" || e.decision === "revisar");
  if (rev.length) partes.push(`${rev.length} ajuste${rev.length > 1 ? "s" : ""} que no mejoró lo que debía`);
  return partes.length ? `neurodanza (autoajuste): ${partes.join(" y ")}. Muéstraselo al usuario en una línea al empezar: ${cli} propuestas. Con su visto bueno: ${cli} aplicar --id <id> (o revertir --id <id>).` : "";
}

// ───────────────────────── CLI ─────────────────────────

function arg(n) {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig(process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json en esta carpeta ni en las de arriba.");
    process.exit(2);
  }
  const cmd = process.argv[2];
  try {
    if (cmd === "diario") {
      const r = await diario(cfg, arg("transcripts") ? { carpetas: [resolve(arg("transcripts"))] } : {});
      if (!process.argv.includes("--silencioso")) console.log(JSON.stringify({ sesiones: r.sesiones, subagentes: r.subagentes, lecciones: r.lecciones, erroresConocidos: r.errores, macros: r.macros, propuestas: r.propuestas, evaluaciones: r.evaluaciones }, null, 2));
    } else if (cmd === "propuestas") {
      const u = estadoDe(cfg).ultimo;
      if (!u) console.log("todavía no hay una pasada: node autoajuste.mjs diario");
      else {
        console.log(`Pasada del ${u.fecha.slice(0, 16).replace("T", " ")} · ${u.sesiones} sesiones y ${u.subagentes} subagentes`);
        for (const p of u.propuestas ?? []) console.log(`- [${p.id}] ${p.texto}`);
        for (const e of u.evaluaciones ?? []) console.log(`- evaluación [${e.id}] ${e.decision}: ${e.texto}`);
        if (!u.propuestas?.length && !u.evaluaciones?.length) console.log("sin propuestas ni evaluaciones pendientes");
      }
    } else if (cmd === "aplicar") console.log(JSON.stringify(aplicar(cfg, arg("id")), null, 2));
    else if (cmd === "revertir") console.log(JSON.stringify(revertir(cfg, arg("id")), null, 2));
    else if (cmd === "descartar") {
      descartar(cfg, arg("id"));
      console.log(`descartada: ${arg("id")}`);
    } else if (cmd === "informe") {
      const u = estadoDe(cfg).ultimo;
      const a = leerJson(archivoAjustes(cfg), { ajustes: [] });
      console.log(JSON.stringify({ ultimaPasada: u?.fecha ?? null, lecciones: u?.lecciones ?? [], erroresConocidos: u?.errores ?? 0, macros: u?.macros ?? 0, ajustes: a.ajustes, semanas: u?.semanas ?? {} }, null, 2));
    } else console.log("Uso: autoajuste.mjs diario [--transcripts <carpeta>] [--silencioso] | propuestas | aplicar --id <id> | descartar --id <id> | revertir --id <id> | informe");
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  }
}
