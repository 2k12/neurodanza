#!/usr/bin/env node
// neurodanza · ciclo de retroalimentación.
//   node feedback.mjs post  → PostToolUse: lint del archivo recién editado (error = se lo muestra al agente)
//   node feedback.mjs stop  → Stop: no deja terminar si lo cambiado no pasa lint, tipos, pruebas
//                             relacionadas o la definición de terminado del proyecto. La parte que
//                             bloquea corre en paralelo, con caché y con tope (retroalimentacion.topeStopSeg):
//                             lo que no alcanza se corta y pasa al fondo, junto con la suite completa
//                             (lib/fondo.mjs). Las fallas del fondo bloquean el Stop siguiente.
//   node feedback.mjs inicio → SessionStart: autoconfiguración y errores conocidos del proyecto como contexto.
//   node feedback.mjs fin    → SessionEnd: cierra la ronda del panel que haya quedado abierta.
// Todo sale de `neurodanza.config.json`; sin ese archivo no hace nada. Ver docs/05-retroalimentacion.md.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny, repoOf } from "../lib/config.mjs";
import { autoconfigurar } from "../lib/autoconfig.mjs";
import { enWorktree, leerTareas } from "../lib/director.mjs";
import { cerrarRondaActiva } from "../panel/panel.mjs";
import { archivoDe, load as loadErrores, registrarEnProyecto, top } from "../lib/errores.mjs";
import { riesgoEnRama } from "../lib/riesgo.mjs";
import { changesOf, firmaActual, firmaCambio, fingerprint, parseStatus, repoFingerprintAsync } from "../lib/firma.mjs";
import { asegurarFondo, idTarea, leerFondo, resumen as resumenFondo, vivo } from "../lib/fondo.mjs";
import { correr } from "../lib/procesos.mjs";
import { fundidas } from "../lib/fusible.mjs";
import { limpiarViejos } from "../lib/agentes.mjs";

export { fingerprint, firmaActual, parseStatus };

/** Margen que el hook Stop se guarda para decidir y responder antes de su tope. */
const MARGEN_STOP_MS = 5000;
const nombrePaso = (p) => (p === "pruebas" ? "pruebas relacionadas" : p === "suite" ? "suite completa" : p);

const norm = (p) => String(p ?? "").replace(/\\/g, "/");
const tail = (s, n = 25) => String(s).split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");

function sh(cmd, cwd, timeout = 240_000) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || String(e.message) };
  }
}

/** ¿Algún archivo cambiado coincide con `repo:glob` (o `glob` = cualquier repo)? */
export function changedMatching(changes, specs = []) {
  const out = [];
  for (const spec of specs) {
    const [repo, glob] = spec.includes(":") ? spec.split(/:(.+)/) : [null, spec];
    for (const [name, files] of Object.entries(changes)) {
      if (repo && repo !== name) continue;
      out.push(...files.filter((f) => matchesAny(f, [glob])).map((f) => `${name}/${f}`));
    }
  }
  return [...new Set(out)];
}

const quote = (files) => files.map((f) => `"${f}"`).join(" ");
const minor = (v) => String(v).split(".").slice(0, 2).join(".");
const versionOf = (json) => {
  try {
    return JSON.parse(json).version ?? "";
  } catch {
    return "";
  }
};

/** ¿Hay en `dir` un JSON de esta versión que cumpla `ok`? (evaluaciones del panel o de evals) */
export function approvedFor(dir, version, ok) {
  if (!dir || !existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const e = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (e.version === version && ok(e)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Riesgo del cambio en la rama (lib/riesgo.mjs), o null si no se pudo calcular. */
function riesgoActual(cfg) {
  try {
    return riesgoEnRama(cfg, cfg.retroalimentacion.version?.ramaBase ?? "main");
  } catch {
    return null;
  }
}

/**
 * Reglas de la definición de terminado (puras, para poder probarlas).
 * @returns {{hard: string[], soft: string[]}}
 */
export function doneProblems(cfg, changes, ctx) {
  const rf = cfg.retroalimentacion;
  const hard = [];
  const soft = [];
  const v = rf.version;
  if (v && ctx.version && ctx.baseVersion) {
    const src = changedMatching(changes, v.cambios ?? []);
    if (src.length > 0 && ctx.version === ctx.baseVersion) {
      hard.push(`${v.repo}: hay cambios de código y la versión sigue en ${ctx.version} (igual que ${v.ramaBase ?? "main"}). Sube ${v.archivo} (feat → minor, fix → patch).`);
    }
    if (rf.bitacora && ctx.version !== ctx.baseVersion && !ctx.bitacoraExists(rf.bitacora.archivo.replace("{minor}", minor(ctx.version)).replace("{version}", ctx.version))) {
      hard.push(`docs: falta la bitácora de la versión ${minor(ctx.version)} en ${rf.bitacora.ruta}.`);
    }
  }
  const m = rf.migraciones;
  if (m && (changes[m.repo] ?? []).includes(m.schema) && !(changes[m.repo] ?? []).some((f) => matchesAny(f, [m.nuevas]))) {
    hard.push(`${m.repo}: cambió ${m.schema} sin una migración nueva.`);
  }
  const screens = changedMatching(changes, rf.pantallas);
  // Con la app o el navegador fundidos (fusible), el panel no se pudo hacer: queda PENDIENTE, ni aprobado ni
  // reprobado. No bloquea: lo decide el usuario.
  const sinPanel = (ctx.fundidas ?? []).filter((f) => f.capa === "app" || f.capa === "chromium");
  // Proporcionalidad: con riesgo bajo el panel no corre (ciclo.riesgo); se dice, sin bloquear.
  // `ctx.riesgo` puede ser una función: se calcula solo si hace falta (cuesta varias llamadas a git).
  const faltaPanel = screens.length > 0 && ctx.version && !ctx.panelApproved(ctx.version);
  const riesgo = faltaPanel ? (typeof ctx.riesgo === "function" ? ctx.riesgo() : ctx.riesgo) : null;
  const sinPersonas = riesgo && riesgo.plan?.personas === 0;
  if (faltaPanel && sinPersonas) soft.push(`riesgo ${riesgo.nivel} (${riesgo.motivos.join("; ")}): el panel de personas no corre para este cambio.`);
  else if (screens.length > 0 && ctx.version && !ctx.panelApproved(ctx.version)) {
    if (sinPanel.length) soft.push(`panel de personas PENDIENTE: no se pudo verificar ${sinPanel.map((f) => `${f.capa} (${f.motivo})`).join(", ")}. No cuenta como aprobado ni reprobado: pregúntale al usuario cómo sigue.`);
    else hard.push(`panel de personas: cambiaste pantallas y no hay una evaluación aprobada (promedio > ${cfg.panel.umbral}) de la versión ${ctx.version}. Sigue el paso 4 de /neurodanza-feature.`);
  }
  if (screens.length > 0 && rf.guias && changedMatching(changes, [rf.guias]).length === 0) {
    soft.push(`cambiaste pantallas (${screens.slice(0, 3).join(", ")}${screens.length > 3 ? "…" : ""}) sin tocar su guía de usuario. Si cambió lo que ve o hace el usuario, actualízala; si no, ignora este aviso.`);
  }
  const tooling = changedMatching(changes, cfg.evals.vigilar ?? []);
  if (tooling.length > 0 && ctx.version && !ctx.evalsApproved(ctx.version)) {
    soft.push(`evals: cambiaste agentes, personas o skills (${tooling.slice(0, 2).join(", ")}${tooling.length > 2 ? "…" : ""}) y no hay evals aprobadas de la versión ${ctx.version}. Corre /neurodanza-evals.`);
  }
  // Solo cuenta código (repos[].codigo); un AGENTS.md o un README no exigen docs. Los docs ya
  // commiteados en la rama (ctx.docsInBranch) también cuentan.
  const codeChanged = cfg.repos.some(
    (r) => r.nombre !== rf.docs && (changes[r.nombre] ?? []).some((f) => matchesAny(f, r.codigo ?? []) && !matchesAny(f, r.ignorar ?? [])),
  );
  if (rf.docs && codeChanged && (changes[rf.docs] ?? []).length === 0 && !ctx.docsInBranch) {
    soft.push(`docs: hay cambios de código y ninguno en ${rf.docs}. Revisa la definición de terminado.`);
  }
  return { hard, soft };
}

/**
 * ¿Una evaluación del panel cuenta como aprobada? Promedio sobre el umbral, y además: no pendiente (capa
 * fundida) y sin revisores que reprobaron durante la ronda (esa ronda se repite tras la corrección).
 */
export const panelCuenta = (umbral) => (e) => e.aprobado === true && Number(e.promedio) > umbral && e.pendiente !== true && e.revisores !== "reprobados";

/** ¿El repo de docs tiene commits en la rama actual que no están en la rama base? */
function docsCommittedInBranch(cfg) {
  const docs = cfg.repos.find((r) => r.nombre === cfg.retroalimentacion.docs);
  if (!docs) return false;
  const dir = cfg.abs(docs.ruta);
  const base = cfg.retroalimentacion.version?.ramaBase ?? "main";
  for (const ref of [`origin/${base}`, base]) {
    const r = sh(`git rev-list --count ${ref}..HEAD`, dir, 10_000);
    if (r.ok) return Number(r.out.trim()) > 0;
  }
  return false;
}

/**
 * Lint, tipos y pruebas relacionadas de un repo, a la vez y con hora límite (`hasta`). Lo que no termina a
 * tiempo se corta (se mata su árbol) y vuelve en `cortadas`: nunca cuenta como bien. `hecho(paso)` = ya
 * pasó en segundo plano para esta misma firma, así que no se repite.
 */
async function codeChecks(cfg, repo, files, { hasta = Infinity, hecho = () => false } = {}) {
  const dir = cfg.abs(repo.ruta);
  const code = files.filter((f) => matchesAny(f, repo.codigo ?? []) && !matchesAny(f, repo.ignorar ?? []));
  const problems = [];
  const pasos = [];
  const cortadas = [];
  if (code.length === 0) return { problems, pasos, cortadas };
  const lintable = repo.lintGlobs ? code.filter((f) => matchesAny(f, repo.lintGlobs)) : code;
  const none = new RegExp(repo.sinPruebas ?? "No tests found|No test files found", "i");
  const jobs = [];
  const agregar = (paso, comando, n, sinPruebas) => {
    if (hecho(paso)) pasos.push({ repo: repo.nombre, paso, ok: true, ms: 0, fondo: true });
    else jobs.push({ paso, comando, n, sinPruebas });
  };
  if (repo.lint && lintable.length > 0) agregar("lint", repo.lint.replace("{archivos}", quote(lintable)), 25);
  if (repo.tipos) agregar("tipos", repo.tipos, 25);
  if (repo.relacionadas) agregar("pruebas", repo.relacionadas.replace("{archivos}", quote(code)), 30, none);
  const resultados = await Promise.all(
    jobs.map(async (j) => {
      const resta = hasta - Date.now();
      if (resta < 500) return { j, r: { ok: false, cortado: true, ms: 0, out: "" } };
      return { j, r: await correr(j.comando, { cwd: dir, timeoutMs: Math.min(300_000, resta) }) };
    }),
  );
  for (const { j, r } of resultados) {
    if (r.cortado) {
      cortadas.push({ repo: repo.nombre, paso: j.paso, comando: j.comando, cwd: dir });
      pasos.push({ repo: repo.nombre, paso: j.paso, ok: false, cortado: true, ms: r.ms });
      continue;
    }
    const ok = r.ok || Boolean(j.sinPruebas?.test(r.out));
    pasos.push({ repo: repo.nombre, paso: j.paso, ok, ms: r.ms });
    if (!ok) problems.push(`${repo.nombre} · ${nombrePaso(j.paso)}:\n${tail(r.out, j.n)}`);
  }
  return { problems, pasos, cortadas };
}

const cacheFile = (cfg) => join(tmpdir(), `neurodanza-cache-${createHash("sha1").update(cfg.root).digest("hex").slice(0, 12)}.json`);

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Estado de la última verificación, para el mapa en vivo (`neurodanza-mapa`). No falla nunca. */
function writeEstado(cfg, estado) {
  try {
    const dir = cfg.abs(".neurodanza");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "estado.json"), JSON.stringify({ ...estado, at: new Date().toISOString() }, null, 2));
  } catch {
    /* el mapa es opcional */
  }
}

/**
 * Corre los generadores cuyas condiciones se cumplen, en orden y dentro de la hora límite. Los marcados
 * `error` bloquean si fallan; los que no alcanzan se cortan y pasan al fondo.
 */
async function regenerate(cfg, changes, hasta = Infinity) {
  const problems = [];
  const cortadas = [];
  for (const g of cfg.retroalimentacion.regenerar) {
    if (changedMatching(changes, g.cuando ?? []).length === 0) continue;
    const repo = cfg.repos.find((r) => r.nombre === g.en);
    const cwd = repo ? cfg.abs(repo.ruta) : cfg.root;
    const paso = `generador ${g.nombre ?? g.comando}`;
    const resta = hasta - Date.now();
    const r = resta < 500 ? { cortado: true } : await correr(g.comando, { cwd, timeoutMs: Math.min(240_000, resta) });
    if (r.cortado) cortadas.push({ repo: g.en ?? "raíz", paso, comando: g.comando, cwd });
    else if (!r.ok && g.error) problems.push(`${g.nombre ?? g.comando}:\n${tail(r.out)}`);
  }
  return { problems, cortadas };
}

function counter(session) {
  const file = join(tmpdir(), `neurodanza-feedback-${String(session || "x").replace(/[^\w-]/g, "")}.json`);
  let state = { n: 0, sig: "" };
  try {
    state = { n: 0, sig: "", ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    state = { n: 0, sig: "" };
  }
  return { n: state.n, sig: state.sig, set: (v, sig = "") => writeFileSync(file, JSON.stringify({ n: v, sig })) };
}

function versionContext(cfg) {
  const v = cfg.retroalimentacion.version;
  if (!v) return { version: "", baseVersion: "" };
  const repo = cfg.repos.find((r) => r.nombre === v.repo);
  if (!repo) return { version: "", baseVersion: "" };
  const dir = cfg.abs(repo.ruta);
  const file = join(dir, v.archivo);
  const version = existsSync(file) ? versionOf(readFileSync(file, "utf8")) : "";
  const base = sh(`git show ${v.ramaBase ?? "main"}:${v.archivo}`, dir, 10_000);
  return { version, baseVersion: base.ok ? versionOf(base.out) : "" };
}

async function stop(cfg, event) {
  const t0 = Date.now();
  // Hora límite de la parte que bloquea: lo que no termine antes se corta y pasa al fondo.
  const tope = (cfg.retroalimentacion.topeStopSeg ?? 90) * 1000;
  const hasta = t0 + tope - MARGEN_STOP_MS;
  // La ronda en vivo NO se cierra aquí: las personas corren en segundo plano y siguen probando
  // después de que termina el turno principal. Se cierra con `calificar`, con otra ronda, al terminar
  // la sesión (`fin`) o tras 20 minutos sin mensajes.
  const changes = changesOf(cfg);
  const c = counter(event.session_id);
  if (Object.values(changes).every((f) => f.length === 0)) {
    writeEstado(cfg, { fase: "sin cambios", pasos: [], problemas: 0, ms: Date.now() - t0 });
    return c.set(0);
  }

  const touched = cfg.repos.filter((r) => (changes[r.nombre] ?? []).length > 0);
  // Firmas de todos los repos a la vez (git en paralelo): misma firma = mismo resultado.
  const firmas = Object.fromEntries(await Promise.all(touched.map(async (r) => [r.nombre, await repoFingerprintAsync(cfg, r, changes[r.nombre])])));
  const firma = firmaCambio(firmas);
  const hard = [];
  const notas = [];

  // 1. Lo que verificó el fondo para ESTE cambio: sus fallas bloquean; lo que ya pasó no se repite.
  const previo = leerFondo(cfg);
  const antes = resumenFondo(previo, firma, vivo(previo?.pid));
  for (const t of antes.fallas) hard.push(`${t.repo} · ${nombrePaso(t.paso)} (en segundo plano)${t.estado === "cortada" ? ": se acabó el tiempo del fondo" : ""}:\n${t.salida ?? ""}`);
  const okFondo = new Set(antes.ok.map((t) => idTarea(t.repo, t.paso)));

  // 2. Parte bloqueante: generadores, y lint, tipos y pruebas relacionadas en paralelo por repo, con caché.
  const gen = await regenerate(cfg, changes, hasta);
  hard.push(...gen.problems);
  const useCache = cfg.retroalimentacion.cache !== false;
  const cache = useCache ? readJson(cacheFile(cfg), {}) : {};
  const results = await Promise.all(
    touched.map(async (repo) => {
      const sig = firmas[repo.nombre];
      const prev = cache[repo.nombre];
      if (useCache && prev?.sig === sig) return { problems: prev.problems, pasos: prev.pasos.map((p) => ({ ...p, cache: true })), cortadas: [] };
      const r = await codeChecks(cfg, repo, changes[repo.nombre], { hasta, hecho: (paso) => okFondo.has(idTarea(repo.nombre, paso)) });
      // Solo se guarda un resultado completo: lo cortado no se sabe si pasa.
      if (useCache && r.cortadas.length === 0) cache[repo.nombre] = { sig, problems: r.problems, pasos: r.pasos };
      return r;
    }),
  );
  const pasos = results.flatMap((r) => r.pasos);
  hard.push(...results.flatMap((r) => r.problems));
  if (useCache) {
    try {
      writeFileSync(cacheFile(cfg), JSON.stringify(cache));
    } catch {
      /* sin caché sigue funcionando */
    }
  }

  // 3. Fondo: la suite completa de cada repo tocado y lo que no alcanzó a correr.
  const cortadas = [...gen.cortadas, ...results.flatMap((r) => r.cortadas)];
  const suites = touched
    .filter((r) => r.suite && (changes[r.nombre] ?? []).some((f) => matchesAny(f, r.codigo ?? []) && !matchesAny(f, r.ignorar ?? [])))
    .map((r) => ({ repo: r.nombre, paso: "suite", comando: r.suite, cwd: cfg.abs(r.ruta) }));
  let fondo = previo;
  if (suites.length || cortadas.length) {
    try {
      fondo = asegurarFondo(cfg, firma, [...suites, ...cortadas]);
    } catch (e) {
      notas.push(`no pude lanzar el segundo plano: ${e.message}`);
    }
  }
  const ahora = resumenFondo(fondo, firma, vivo(fondo?.pid));
  if (cortadas.length) notas.push(`no alcanzó a correr dentro del tope de ${Math.round(tope / 1000)} s: ${cortadas.map((t) => `${t.repo} · ${nombrePaso(t.paso)}`).join(", ")}. Sigue en segundo plano; si falla, bloquea el próximo Stop.`);
  if (!antes.fallas.length && ahora.pendientes.length) notas.push(`en segundo plano (no bloquea): ${ahora.pendientes.map((t) => `${t.repo} · ${nombrePaso(t.paso)}`).join(", ")}. Antes de cerrar el ciclo: \`node <plugin>/lib/fondo.mjs esperar\`.`);

  const { version, baseVersion } = versionContext(cfg);
  const umbral = cfg.panel.umbral;
  const capasFundidas = fundidas(cfg);
  for (const f of capasFundidas) notas.push(`no se pudo verificar: ${f.capa} (${f.motivo}). No se reintenta en este ciclo.`);
  const done = doneProblems(cfg, changes, {
    version,
    baseVersion,
    bitacoraExists: (name) => existsSync(join(cfg.abs(cfg.retroalimentacion.bitacora.ruta), name)),
    panelApproved: (ver) => approvedFor(cfg.abs(cfg.panel.evaluaciones), ver, panelCuenta(umbral)),
    evalsApproved: (ver) => approvedFor(cfg.abs(cfg.evals.informes), ver, (e) => e.informe?.aprobado === true),
    docsInBranch: docsCommittedInBranch(cfg),
    fundidas: capasFundidas,
    riesgo: () => riesgoActual(cfg),
  });
  hard.push(...done.hard);
  writeEstado(cfg, { fase: "verificar", pasos, problemas: hard.length, avisos: done.soft.length, cortadas: cortadas.length, fondo: { firma, estado: ahora.estado, pendientes: ahora.pendientes.length }, ms: Date.now() - t0 });

  const max = cfg.retroalimentacion.maxBloqueos;
  const soft = event.stop_hook_active ? [] : done.soft;
  const info = notas.length ? `neurodanza: ${notas.join(" · ")}` : "";
  if (hard.length === 0 && soft.length === 0) {
    if (info) process.stdout.write(JSON.stringify({ systemMessage: info }));
    return c.set(0);
  }
  // Los mismos problemas seguidos suman intentos; si cambian, se empieza de nuevo.
  const sig = hard.join("\n");
  const n = sig === c.sig ? c.n : 0;
  if (hard.length > 0 && n >= max) {
    // Tras `maxBloqueos` intentos con los mismos problemas, deja terminar (avisa una sola vez)
    // hasta que cambien. Antes volvía a 0 y bloqueaba otra vez sin fin.
    if (n === max) process.stdout.write(JSON.stringify({ systemMessage: `neurodanza: siguen ${hard.length} problema(s) tras ${max} intentos; revisa a mano.` }));
    c.set(max + 1, sig);
    return;
  }
  c.set(hard.length > 0 ? n + 1 : n, sig);
  const reason = ["Antes de terminar, corrige esto (neurodanza):", ...registrarEnProyecto(cfg, hard, event.session_id).map((h) => `✖ ${h}`), ...soft.map((x) => `• ${x}`), ...notas.map((x) => `ℹ ${x}`)].join("\n\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

async function post(cfg, event) {
  if (!cfg.retroalimentacion.lintAlEditar) return;
  const file = norm(event?.tool_input?.file_path ?? event?.tool_input?.notebook_path ?? "");
  let at = file ? repoOf(cfg, file) : null;
  if (!at && file) {
    // Archivo en el worktree de una tarea del modo director: lint con la configuración de su repo, ahí mismo.
    const w = enWorktree(leerTareas(cfg), file);
    const repo = w && cfg.repos.find((r) => r.nombre === w.repo.nombre);
    if (repo) at = { repo, dir: w.repo.ruta, rel: w.rel };
  }
  if (!at || !at.repo.lint) return;
  const { repo, rel } = at;
  if (!matchesAny(rel, repo.codigo ?? []) || matchesAny(rel, repo.ignorar ?? [])) return;
  if (repo.lintGlobs && !matchesAny(rel, repo.lintGlobs)) return;
  const r = await correr(repo.lint.replace("{archivos}", `"${rel}"`), { cwd: at.dir, timeoutMs: 50_000 });
  if (r.cortado) return; // el lint de un archivo no debería tardar tanto: el Stop lo vuelve a correr
  if (!r.ok) {
    const [msg] = registrarEnProyecto(cfg, [`${repo.nombre} · lint:\n${tail(r.out)}`], event.session_id);
    process.stderr.write(`Lint de ${repo.nombre}/${rel}:\n${msg.split("\n").slice(1).join("\n")}\n`);
    process.exit(2);
  }
}

/** Contexto de inicio con los errores conocidos más útiles (vacío si no hay). */
export function contextoErrores(list) {
  if (!list.length) return "";
  const lines = list.map((e) => `- [${e.firma}] ${e.categoria} (${e.veces}×): ${e.patron.slice(0, 140)}${e.solucion ? `\n  Solución: ${e.solucion}` : " (sin solución anotada)"}`);
  return ["neurodanza · errores conocidos de este proyecto (si aparece uno, aplica su solución antes de investigar de cero):", ...lines].join("\n");
}

/** Fin de la sesión (SessionEnd): una ronda del panel que quedó abierta ya no la sigue nadie. */
function fin(cfg) {
  try {
    if (cerrarRondaActiva(cfg.root, "terminó la sesión")) process.stderr.write("neurodanza: cerré la ronda del panel que quedó abierta.\n");
  } catch {
    /* el panel es opcional */
  }
}

/** Resultado del fondo para el cambio actual, al iniciar la sesión (vacío si no hay nada que decir). */
function informeFondoInicio(cfg) {
  try {
    const e = leerFondo(cfg);
    if (!e) return "";
    const r = resumenFondo(e, firmaActual(cfg), vivo(e.pid));
    if (r.estado === "falla") return `neurodanza · en segundo plano falló para el cambio actual (el próximo Stop lo bloquea):\n${r.fallas.map((t) => `✖ ${t.repo} · ${nombrePaso(t.paso)}:\n${t.salida ?? ""}`).join("\n")}`;
    if (r.estado === "corriendo") return `neurodanza · sigue en segundo plano: ${r.pendientes.map((t) => `${t.repo} · ${nombrePaso(t.paso)}`).join(", ")} (no bloquea).`;
    return "";
  } catch {
    return "";
  }
}

function inicio(cfg, event) {
  // Deja el proyecto listo (.gitignore, aviso de permisos) y carga los errores conocidos.
  const auto = autoconfigurar(cfg, event?.cwd ?? process.cwd());
  limpiarViejos(cfg);
  const errores = cfg.errores?.activo === false ? "" : contextoErrores(top(loadErrores(archivoDe(cfg)), cfg.errores?.alIniciar ?? 5));
  const contexto = [auto.contexto, informeFondoInicio(cfg), errores].filter(Boolean).join("\n\n");
  const out = {};
  if (auto.mensaje) out.systemMessage = auto.mensaje;
  if (contexto) out.hookSpecificOutput = { hookEventName: "SessionStart", additionalContext: contexto };
  if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let event = {};
  try {
    event = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    event = {};
  }
  let cfg = null;
  try {
    cfg = loadConfig(event.cwd ?? process.cwd());
  } catch (e) {
    process.stderr.write(`neurodanza: ${e.message}\n`);
    process.exit(0);
  }
  if (!cfg) process.exit(0);
  if (process.argv[2] === "post") await post(cfg, event);
  else if (process.argv[2] === "stop") await stop(cfg, event);
  else if (process.argv[2] === "inicio") inicio(cfg, event);
  else if (process.argv[2] === "fin") fin(cfg);
}
