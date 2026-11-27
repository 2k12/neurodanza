#!/usr/bin/env node
// neurodanza · ayudas del ciclo de /neurodanza-feature (planificador + ejecutor).
//   node ciclo.mjs preparar --archivos "repo:archivo,…" --lineas N [--buscar texto]   empieza: riesgo, qué leer, errores conocidos
//   node ciclo.mjs cerrar [--base main] [--sin-verificar]   verifica lo cambiado y dice qué falta (revisores, suite); exit 1 si falta
//   node ciclo.mjs revisores [--base main]   qué revisores lanzar para lo cambiado en la rama, según su riesgo (JSON)
//   node ciclo.mjs seguir                      el usuario aceptó pasar el tope de gasto (ciclo.maxTokens)
//   node ciclo.mjs presupuesto                 máximo de pasos por tipo de subagente (JSON)
// Ver docs/11-mapa-y-ciclo.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changesInBranch } from "./cambios.mjs";
import { loadConfig, matchesAny } from "./config.mjs";

export { changesInBranch };

export const REVISORES = ["revisor-coherencia", "revisor-permisos", "revisor-ui", "revisor-docs"];

const UI = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html|astro)$/i;
const PERMISOS = /(controller|guard|polic|permis|role|rol(es)?\b|auth|middleware|route|router|endpoint|resolver|access|acl|casl|plan|modul)/i;
const CONTRATO = /(dto|schema|valid|contrat|contract|api|zod|yup|types?\b|interface|entity|model|prisma|openapi|swagger|client|service)/i;

/**
 * Revisores que aplican a un cambio (puro). `changes` = { repo: [archivos] }, solo código y docs.
 * - docs: siempre que haya cambios.
 * - ui: pantallas (`retroalimentacion.pantallas`) o archivos de interfaz.
 * - permisos: pantallas, o archivos de rutas, guardias, roles, auth.
 * - coherencia: código en 2 repos o más, o contratos (DTO, esquemas, validaciones, tipos, API).
 */
export function revisoresPara(cfg, changes) {
  const files = Object.entries(changes).flatMap(([repo, fs]) => fs.map((f) => ({ repo, f })));
  const code = files.filter(({ repo, f }) => {
    const r = cfg.repos.find((x) => x.nombre === repo);
    return r && r.nombre !== cfg.retroalimentacion?.docs && matchesAny(f, r.codigo ?? []) && !matchesAny(f, r.ignorar ?? []);
  });
  const pantallas = files.filter(({ repo, f }) =>
    (cfg.retroalimentacion?.pantallas ?? []).some((spec) => {
      const [r, g] = spec.includes(":") ? spec.split(/:(.+)/) : [null, spec];
      return (!r || r === repo) && matchesAny(f, [g]);
    }),
  );
  const motivos = {};
  const omitir = {};
  if (files.length === 0) return { lanzar: [], motivos, omitir: Object.fromEntries(REVISORES.map((r) => [r, "no hay cambios"])) };
  if (cfg.ciclo?.revisores === "todos") return { lanzar: [...REVISORES], motivos: Object.fromEntries(REVISORES.map((r) => [r, "ciclo.revisores = todos"])), omitir };

  const repos = new Set(code.map((x) => x.repo));
  const contrato = code.filter(({ f }) => CONTRATO.test(f));
  if (repos.size >= 2) motivos["revisor-coherencia"] = `código en ${[...repos].join(" y ")}`;
  else if (contrato.length) motivos["revisor-coherencia"] = `contratos: ${contrato.slice(0, 2).map((x) => x.f).join(", ")}`;
  else omitir["revisor-coherencia"] = "un solo repo y sin contratos (DTO, esquemas, validaciones, API)";

  const perm = code.filter(({ f }) => PERMISOS.test(f));
  if (pantallas.length) motivos["revisor-permisos"] = "cambiaron pantallas";
  else if (perm.length) motivos["revisor-permisos"] = `rutas o accesos: ${perm.slice(0, 2).map((x) => x.f).join(", ")}`;
  else omitir["revisor-permisos"] = "sin pantallas, rutas, guardias ni roles";

  const ui = code.filter(({ f }) => UI.test(f));
  if (pantallas.length || ui.length) motivos["revisor-ui"] = pantallas.length ? "cambiaron pantallas" : `interfaz: ${ui.slice(0, 2).map((x) => x.f).join(", ")}`;
  else omitir["revisor-ui"] = "sin pantallas ni archivos de interfaz";

  // Sin nada configurado contra qué revisar, el revisor de docs solo gasta.
  const rf = cfg.retroalimentacion ?? {};
  const reglas = cfg.reglas?.docs;
  if (rf.docs || rf.bitacora || rf.guias || rf.version || (Array.isArray(reglas) ? reglas.length : reglas)) motivos["revisor-docs"] = "siempre que hay cambios";
  else omitir["revisor-docs"] = "el proyecto no configura documentación (retroalimentacion.docs, bitacora, guias, version o reglas.docs)";
  return { lanzar: REVISORES.filter((r) => motivos[r]), motivos, omitir };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const i = process.argv.indexOf("--base");
  const base = i > 0 ? process.argv[i + 1] : cfg.retroalimentacion.version?.ramaBase ?? "main";
  if (process.argv[2] === "revisores") {
    const changes = changesInBranch(cfg, base);
    // Con la misma lógica, si hay que lanzar fantasmas (endpoints, permisos, consultas, pantallas que escriben).
    const { fantasmasPara } = await import("./fantasmas.mjs");
    const leer = (repo, f) => {
      try {
        return readFileSync(join(cfg.abs(cfg.repos.find((r) => r.nombre === repo).ruta), f), "utf8").slice(0, 200_000);
      } catch {
        return "";
      }
    };
    const rev = revisoresPara(cfg, changes);
    const fan = fantasmasPara(cfg, changes, leer);
    // Proporcionalidad: el nivel de riesgo decide cuántos de los que aplican corren de verdad.
    const { riesgoDe, textoRiesgo, permisosEnRama } = await import("./riesgo.mjs");
    const { lineasPorArchivo } = await import("./cambios.mjs");
    // Con `ciclo.portero.activo`, un cambio medio por líneas puede quedarse sin revisor (lib/portero.mjs).
    const { aplicar, porteroPara } = await import("./portero.mjs");
    const r0 = riesgoDe(cfg, changes, lineasPorArchivo(cfg, base), { revisores: rev.lanzar, fantasmas: fan.lanzar, permisos: permisosEnRama(cfg, base) });
    const r = aplicar(r0, await porteroPara(cfg, r0, { base }));
    if (r.permisos?.length && !rev.motivos["revisor-permisos"]) {
      rev.motivos["revisor-permisos"] = `el código cambiado toca permisos: ${r.permisos.slice(0, 2).join(", ")}`;
      delete rev.omitir["revisor-permisos"];
    }
    const omitir = { ...rev.omitir };
    for (const x of rev.lanzar) if (!r.plan.lanzar.includes(x)) omitir[x] = r.portero && r0.plan.lanzar.includes(x) ? `portero: ${r.portero.motivo}` : `riesgo ${r.nivel}: ${r.plan.revisores ? "corre solo el de más prioridad" : "sin revisores"}`;
    const fantasmas = r.plan.fantasmas ? { ...fan, cantidad: r.plan.fantasmas } : { ...fan, lanzar: false, motivos: fan.lanzar ? [...fan.motivos, `riesgo ${r.nivel}: sin fantasmas`] : fan.motivos };
    // Con `ciclo.revisionEnStop.activo`, los corre el hook Stop con el diff (lib/revision.mjs): el agente no los lanza.
    const { enStop } = await import("./revision.mjs");
    const delStop = enStop(cfg, r, base);
    if (delStop.length) for (const x of delStop) omitir[x] = "lo corre el hook Stop con el diff (ciclo.revisionEnStop): no lo lances";
    console.log(JSON.stringify({ lanzar: r.plan.lanzar.filter((x) => !delStop.includes(x)), ...(delStop.length ? { enStop: delStop } : {}), motivos: Object.fromEntries(Object.entries(rev.motivos).filter(([k]) => r.plan.lanzar.includes(k))), omitir, fantasmas, riesgo: { ...r, texto: textoRiesgo(r) } }, null, 2));
  }
  else if (process.argv[2] === "preparar") {
    const { preparar } = await import("./pasos.mjs");
    const arg = (n) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
    console.log(preparar(cfg, { revisoresPara, archivos: arg("archivos"), lineas: arg("lineas"), buscarTexto: arg("buscar") }));
  } else if (process.argv[2] === "cerrar") {
    const [{ cerrar }, { fantasmasPara }, { firmaActual }] = await Promise.all([import("./pasos.mjs"), import("./fantasmas.mjs"), import("./firma.mjs")]);
    const r = await cerrar(cfg, { revisoresPara, fantasmasPara, firmaActual, base, sinVerificar: process.argv.includes("--sin-verificar") });
    console.log(r.texto);
    process.exitCode = r.ok ? 0 : 1;
  } else if (process.argv[2] === "seguir") {
    if (!(cfg.ciclo.maxTokens > 0)) console.log("no hay tope: ciclo.maxTokens es 0");
    else {
      const { seguir } = await import("./gasto.mjs");
      console.log(`tope del ciclo: ${seguir(cfg).tope}`);
    }
  } else if (process.argv[2] === "presupuesto") console.log(JSON.stringify(cfg.ciclo.maxPasos));
  else {
    console.error("Uso: ciclo.mjs preparar --archivos … --lineas N [--buscar texto] | cerrar [--base <rama>] [--sin-verificar] | revisores [--base <rama>] | presupuesto | seguir");
    process.exit(1);
  }
}
