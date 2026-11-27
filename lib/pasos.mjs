// neurodanza · pasos del ciclo en un solo comando: `ciclo.mjs preparar` y `ciclo.mjs cerrar`. Cada llamada del agente
// relee todo su contexto: lo que no necesita juicio va junto y con salida corta. Ver docs/27-costo.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clase, leerAgentes, reiniciarAgentes } from "./agentes.mjs";
import { verificar } from "./app.mjs";
import { changesInBranch, lineasPorArchivo } from "./cambios.mjs";
import { matchesAny } from "./config.mjs";
import { archivoDe, load, top } from "./errores.mjs";
import { leerFondo, resumen as resumenFondo, vivo } from "./fondo.mjs";
import { fundidas, leerFusible, reiniciar } from "./fusible.mjs";
import { buscar, indiceDe, reposDe } from "./indice.mjs";
import { limpiar } from "./pilas.mjs";
import { aplicar, claveDiff, diffEnRama, porteroPara } from "./portero.mjs";
import { aprobados, enStop } from "./revision.mjs";
import { archivosPrevistos, permisosEnRama, riesgoDe, textoRiesgo } from "./riesgo.mjs";

/** Riesgo de unos archivos previstos y, si se estiman, sus líneas de código. */
export function riesgoPrevisto(cfg, revisoresPara, archivos, lineas) {
  const changes = archivosPrevistos(archivos);
  const rs = Object.keys(changes);
  const n = Number(lineas);
  const porRepo = lineas !== undefined && lineas !== "" && Number.isFinite(n) ? Object.fromEntries(rs.map((x) => [x, Math.ceil(n / rs.length)])) : null;
  return riesgoDe(cfg, changes, porRepo, { revisores: revisoresPara(cfg, changes).lanzar });
}

/** Riesgo real de la rama, con los revisores que aplican. */
export function riesgoReal(cfg, revisoresPara, fantasmasPara, base) {
  const changes = changesInBranch(cfg, base);
  const leer = (repo, f) => {
    try {
      return readFileSync(join(cfg.abs(cfg.repos.find((r) => r.nombre === repo).ruta), f), "utf8").slice(0, 200_000);
    } catch {
      return "";
    }
  };
  const r = riesgoDe(cfg, changes, lineasPorArchivo(cfg, base), { revisores: revisoresPara(cfg, changes).lanzar, fantasmas: fantasmasPara(cfg, changes, leer).lanzar, permisos: permisosEnRama(cfg, base) });
  return { changes, r };
}

const REFERENCIAS = { bajo: [], medio: ["planificar", "revision", "cerrar"], alto: ["planificar", "revision", "cerrar"] };

/** Referencias que debe leer el agente, según el plan (puro). */
export function referenciasDe(r) {
  const out = [...REFERENCIAS[r.nivel]];
  if (r.plan.personas) out.splice(out.indexOf("cerrar"), 0, "panel");
  if (r.plan.director) out.splice(1, 0, "director");
  return out;
}

/** Empieza el ciclo y devuelve lo que hace falta para decidir. */
export function preparar(cfg, { revisoresPara, archivos = "", lineas, buscarTexto = "" }) {
  const r = archivos ? riesgoPrevisto(cfg, revisoresPara, archivos, lineas) : null;
  if (!r || r.nivel !== "bajo") {
    reiniciar(cfg);
    reiniciarAgentes(cfg);
  }
  const out = [];
  if (r) {
    const refs = referenciasDe(r);
    out.push(textoRiesgo(r), refs.length ? `Lee, al llegar a cada paso: ${refs.map((x) => `referencias/${x}.md`).join(", ")}.` : "Hazlo directo: sin plan en archivo, referencias ni subagentes.");
    if (r.nivel !== "bajo") out.push(`Presupuesto de pasos por subagente: ${JSON.stringify(cfg.ciclo.maxPasos)}.`);
  } else out.push("Sin --archivos no se prevé el riesgo.");
  const conocidos = top(load(archivoDe(cfg)), 3).filter((e) => e.solucion);
  if (conocidos.length) out.push(`Errores conocidos: ${conocidos.map((e) => `${String(e.texto ?? "").split("\n")[0].slice(0, 120)} → ${e.solucion}`).join(" · ")}`);
  if (buscarTexto) {
    const hay = reposDe(cfg).flatMap((x) => buscar(indiceDe(cfg, x), buscarTexto).slice(0, 8).map((b) => `- ${x.nombre}/${b.archivo} (${b.tipo}: ${b.texto})`));
    out.push(hay.length ? `«${buscarTexto}» en:\n${hay.slice(0, 12).join("\n")}` : `«${buscarTexto}»: sin coincidencias en el índice.`);
  }
  return out.join("\n");
}

/** Revisores del plan que no se lanzaron en este ciclo (puro). */
export function revisoresFaltantes(lanzar, agentes) {
  const vistos = new Set(Object.values(agentes).filter((a) => clase(a.tipo) === "revisor").map((a) => String(a.tipo).replace(/^neurodanza:/, "")));
  return lanzar.filter((x) => !vistos.has(x));
}

/** Verifica lo cambiado en cada repo y dice qué falta para cerrar. `ok` false si algo falla o falta. */
export async function cerrar(cfg, { revisoresPara, fantasmasPara, firmaActual, base, sinVerificar = false, portero = {} }) {
  const { changes, r: r0 } = riesgoReal(cfg, revisoresPara, fantasmasPara, base);
  // Con `ciclo.portero.activo`, un cambio medio por líneas puede quedarse sin revisor (lib/portero.mjs).
  const r = aplicar(r0, await porteroPara(cfg, r0, { base, ...portero }));
  const out = [textoRiesgo(r)];
  let ok = true;
  const tocados = cfg.repos.map((x) => [x, (changes[x.nombre] ?? []).filter((f) => matchesAny(f, x.codigo ?? []) && !matchesAny(f, x.ignorar ?? []))]).filter(([, fs]) => fs.length);
  if (!sinVerificar)
    for (const [repo, v] of await Promise.all(tocados.map(async ([x, fs]) => [x.nombre, await verificar(cfg, x.nombre, fs.map((f) => `"${f}"`))]))) {
      ok &&= v.ok;
      out.push(`${repo}: ${v.texto || "sin comandos configurados"}`);
    }
  // Con `ciclo.revisionEnStop.activo` cuentan también los que aprobaron este diff en el hook Stop.
  const diff = cfg.ciclo?.revisionEnStop?.activo ? diffEnRama(cfg, base) : "";
  const delStop = diff ? aprobados(cfg, claveDiff(diff)) : new Set();
  const faltan = revisoresFaltantes(r.plan.lanzar, leerAgentes(cfg)).filter((x) => !delStop.has(x));
  if (faltan.length) {
    ok = false;
    const stop = enStop(cfg, r, base, diff);
    out.push(
      faltan.every((x) => stop.includes(x))
        ? `✖ faltan revisores de este riesgo: ${faltan.join(", ")}. Los corre el hook Stop con el diff: termina el turno y corrige lo que encuentren.`
        : `✖ faltan revisores de este riesgo: ${faltan.join(", ")}. Lánzalos en un solo mensaje (referencias/revision.md).`,
    );
  }
  const fondo = leerFondo(cfg);
  const f = resumenFondo(fondo, firmaActual(cfg), vivo(fondo?.pid));
  if (f.estado === "falla") {
    ok = false;
    out.push(`✖ suite completa: falla\n${f.fallas.map((t) => `${t.repo} · ${t.paso}:\n${String(t.salida ?? "").split(/\r?\n/).slice(-15).join("\n")}`).join("\n")}`);
  } else if (f.pendientes?.length) out.push("suite completa: sigue en segundo plano; si el cierre la exige, usa fondo.mjs esperar.");
  const capas = fundidas(cfg);
  if (capas.length) out.push(`no se pudo verificar: ${capas.map((c) => `${c.capa} (${c.motivo})`).join(", ")}. El panel queda pendiente: lo decide el usuario.`);
  if (ok) limpiar(cfg);
  out.push(ok ? "✔ listo para informar." : `✖ no está listo${leerFusible(cfg).inicio ? "" : " (el ciclo no se inició con preparar)"}.`);
  return { ok, texto: out.join("\n") };
}
