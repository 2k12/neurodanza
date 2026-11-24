#!/usr/bin/env node
// neurodanza · evals: miden si los revisores detectan errores sembrados sin reprobar cambios limpios
// y si el panel de personas califica calibrado y estable. Lo orquesta /neurodanza-evals; este script
// arma las instrucciones y califica. Casos e informes: neurodanza.config.json → evals.
//
// Uso:
//   node evals.mjs prompt --revisor revisor-ui     (instrucciones para ese revisor: sus casos + el de control)
//   node evals.mjs personas                         (casos de calibración del panel)
//   node evals.mjs fantasmas                        (casos de fantasmas, sus hipótesis y cuántas corridas lleva cada uno)
//   node evals.mjs calificar --resultados <json>    (puntúa, escribe el informe en el mismo json; exit 1 si no pasa)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { cargar as cargarConstructos, playbookDe } from "../lib/constructos.mjs";
import { notaPorPasos } from "../lib/recorridos.mjs";

/** Casos del proyecto (o vacíos si no hay configuración: así el módulo se puede importar en pruebas). */
function loadCases() {
  const cfg = loadConfig(process.cwd());
  const file = cfg?.abs(cfg.evals.casos);
  return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { umbrales: {}, revisores: [], personas: [] };
}
export const CASOS = loadCases();
export const REVISORES = ["revisor-coherencia", "revisor-permisos", "revisor-ui", "revisor-docs"];

/** Casos que le tocan a un revisor: los suyos más los de control («todos»). */
export const casosDe = (revisor, casos = CASOS) => casos.revisores.filter((c) => c.revisor === revisor || c.revisor === "todos");

export function promptRevisor(revisor, casos = CASOS) {
  const lista = casosDe(revisor, casos);
  return [
    `Esto es una EVALUACIÓN de tu trabajo como ${revisor}. No uses git ni leas el repo para buscar el diff: revisa SOLO los diffs de abajo, como si fueran el cambio completo. Aplica tus reglas de siempre (puedes leer archivos del repo para contexto).`,
    `Responde SOLO un JSON: un arreglo con un objeto por caso, en el mismo orden: [{ "caso": "<id>", "aprobado": true|false, "hallazgos": [{ "gravedad": "alta|media|baja", "archivo": "…", "problema": "…", "arreglo": "…" }] }]. aprobado = false si hay algún hallazgo alto o medio.`,
    ...lista.map((c) => `### Caso ${c.id}\n\`\`\`diff\n${c.diff}\`\`\``),
  ].join("\n\n");
}

const texto = (r) => JSON.stringify(r?.hallazgos ?? []).toLowerCase();

/** Nota numérica, o NaN si falta: Number(null) y Number("") dan 0 y aprobarían los casos con notaMax. */
const numero = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

/** Corridas que pide un caso de fantasma (1 si no lo dice). */
const corridasDe = (f) => (Number.isInteger(f.corridas) && f.corridas >= 1 ? f.corridas : 1);

/**
 * Califica un caso de fantasma con todas sus corridas (puro). Regla fija: la fuga se confirma en al menos dos
 * tercios; el limpio, en ninguna, y todas deben concluir. Faltar corridas reprueba; las de más también cuentan.
 */
export function calificarFantasma(f, resultado) {
  const pedidas = corridasDe(f);
  const rs = Array.isArray(resultado) ? resultado : resultado ? [resultado] : [];
  if (!rs.some(Boolean)) return { caso: f.id, ok: false, motivo: "sin resultado" };
  if (rs.length < pedidas) return { caso: f.id, ok: false, motivo: `${rs.length} de ${pedidas} corridas` };
  const n = rs.length;
  const conf = rs.map((r) => (r?.confirmados ?? []).filter((x) => x.confirmado !== false));
  if (f.esperado === "confirmar") {
    const si = conf.filter((c) => c.some((x) => !f.tecnica || !x.tecnica || x.tecnica === f.tecnica)).length;
    const ok = si >= Math.ceil((2 * n) / 3);
    return { caso: f.id, ok, motivo: n === 1 ? (ok ? "confirmó la fuga" : "no la confirmó") : `la confirmó en ${si} de ${n} corridas` };
  }
  const falsos = conf.reduce((t, c) => t + c.length, 0);
  const sinConcluir = rs.filter((r) => !r || r.conclusion === "sin evidencia").length;
  return { caso: f.id, ok: !falsos && !sinConcluir, motivo: falsos ? `${falsos} falso(s) positivo(s)` : sinConcluir ? `${sinConcluir} corrida(s) sin concluir` : "sin falsos positivos" };
}

/**
 * Puntúa los resultados. `resultados.revisores` = { "<revisor>": [{ caso, aprobado, hallazgos }] };
 * `resultados.personas` = { "<idCaso>": { nota, ... } }; `resultados.fantasmas` = { "<idCaso>": [una por corrida] }.
 */
export function calificar(resultados, casos = CASOS) {
  const u = casos.umbrales;
  const detalle = [];
  let errores = 0;
  let detectados = 0;
  let falsosPositivos = 0;
  for (const c of casos.revisores) {
    const revisores = c.revisor === "todos" ? REVISORES : [c.revisor];
    for (const rev of revisores) {
      const r = (resultados.revisores?.[rev] ?? []).find((x) => x.caso === c.id);
      if (c.esperado === "reprobar") {
        errores++;
        const ok = !!r && r.aprobado === false && (c.claves.length === 0 || c.claves.some((k) => texto(r).includes(k.toLowerCase())));
        if (ok) detectados++;
        detalle.push({ caso: c.id, revisor: rev, esperado: "reprobar", ok, motivo: !r ? "sin respuesta" : r.aprobado ? "lo aprobó" : ok ? "detectado" : "reprobó sin mencionar el problema" });
      } else {
        const ok = !!r && r.aprobado === true;
        if (!ok) falsosPositivos++;
        detalle.push({ caso: c.id, revisor: rev, esperado: "aprobar", ok, motivo: !r ? "sin respuesta" : ok ? "aprobado" : "falso positivo" });
      }
    }
  }
  const deteccion = errores ? Math.round((detectados / errores) * 100) / 100 : 1;

  const personas = [];
  for (const p of casos.personas ?? []) {
    const r = resultados.personas?.[p.id];
    // Con recorrido, la nota pasa por la misma regla que en el panel (un paso crítico que no cumple la limita).
    const propia = numero(r?.nota);
    const nota = p.recorrido && r?.pasos && Number.isFinite(propia) ? notaPorPasos(r, 6, p.recorrido).nota : propia;
    let ok = Number.isFinite(nota);
    let motivo = ok ? `nota ${nota}` : "sin nota";
    if (ok && p.esperado.notaMin !== undefined) ok = nota >= p.esperado.notaMin;
    if (ok && p.esperado.notaMax !== undefined) ok = nota <= p.esperado.notaMax;
    // Recorrido con un paso que no puede cumplirse: la persona debe marcarlo «no cumple».
    if (ok && p.esperado.pasoNoCumple !== undefined) {
      const paso = (r?.pasos ?? []).find((x) => Number(x.n) === p.esperado.pasoNoCumple);
      ok = paso?.resultado === "no cumple";
      motivo = ok ? `nota ${nota}; detectó que el paso ${p.esperado.pasoNoCumple} no cumple` : `no marcó «no cumple» en el paso ${p.esperado.pasoNoCumple} (${paso?.resultado ?? "sin detalle por paso"})`;
    }
    if (ok && p.repiteDe) {
      const base = numero(resultados.personas?.[p.repiteDe]?.nota);
      const dif = Math.abs(nota - base);
      ok = Number.isFinite(base) && dif <= p.esperado.diferenciaMax;
      motivo = Number.isFinite(base) ? `diferencia ${Math.round(dif * 100) / 100} con ${p.repiteDe}` : `sin nota en ${p.repiteDe}`;
    }
    personas.push({ caso: p.id, ok, motivo });
  }

  const fantasmas = (casos.fantasmas ?? []).map((f) => calificarFantasma(f, resultados.fantasmas?.[f.id]));

  const aprobado = deteccion >= u.deteccion && falsosPositivos <= u.falsosPositivos && personas.every((p) => p.ok) && fantasmas.every((f) => f.ok);
  return { aprobado, deteccion, falsosPositivos, personasOk: personas.filter((p) => p.ok).length, personasTotal: personas.length, detalle, personas, fantasmas };
}

function args() {
  const a = {};
  const v = process.argv.slice(3);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith("--")) a[v[i].slice(2)] = v[++i];
  return a;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const a = args();
  if (cmd === "prompt") {
    if (!REVISORES.includes(a.revisor)) {
      console.error(`revisor: ${REVISORES.join(" | ")}`);
      process.exitCode = 2;
    } else {
      // Con sus lecciones del proyecto (constructo): así las evals miden al revisor tal como trabaja hoy
      // y deciden si una lección a prueba se aprueba o se descarta.
      const cfg = loadConfig(process.cwd());
      const lecciones = cfg ? playbookDe(cfg, cargarConstructos(cfg), a.revisor) : "";
      console.log([promptRevisor(a.revisor), lecciones].filter(Boolean).join("\n\n"));
    }
  } else if (cmd === "personas") console.log(JSON.stringify(CASOS.personas, null, 2));
  else if (cmd === "fantasmas") {
    // Casos de fantasmas con las hipótesis que genera neurodanza para cada diff (para lanzar a los fantasmas).
    const { hipotesisDeDiff } = await import("../lib/fantasmas.mjs");
    console.log(JSON.stringify((CASOS.fantasmas ?? []).map((f) => ({ ...f, corridas: corridasDe(f), hipotesis: hipotesisDeDiff(f.diff, [{ rol: "ADMIN" }, { rol: "VIEWER", soloLectura: true }], 3) })), null, 2));
  }
  else if (cmd === "calificar") {
    const file = resolve(a.resultados);
    const data = JSON.parse(readFileSync(file, "utf8"));
    const informe = calificar(data);
    Object.assign(data, { informe, umbrales: CASOS.umbrales, fecha: data.fecha ?? new Date().toISOString() });
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    console.log(JSON.stringify({ aprobado: informe.aprobado, deteccion: informe.deteccion, falsosPositivos: informe.falsosPositivos, personas: `${informe.personasOk}/${informe.personasTotal}` }));
    for (const d of [...informe.detalle, ...informe.personas, ...(informe.fantasmas ?? [])].filter((x) => !x.ok)) console.log(`✖ ${d.caso}${d.revisor ? ` · ${d.revisor}` : ""}: ${d.motivo}`);
    if (!informe.aprobado) process.exitCode = 1;
  } else console.log("comandos: prompt --revisor <revisor> | personas | fantasmas | calificar --resultados <json>");
}
