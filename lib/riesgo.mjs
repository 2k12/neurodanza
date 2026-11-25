#!/usr/bin/env node
// neurodanza · riesgo del cambio (proporcionalidad, idea de ODD): bajo, medio o alto, y qué corre en cada uno.
// Un cambio chico no paga el ciclo completo; uno de permisos, migraciones o dos repos, sí.
//   node riesgo.mjs [--base main]                       nivel del cambio en la rama y su plan (JSON)
//   node riesgo.mjs --archivos "repo:glob,repo:archivo" [--lineas N]   nivel previsto antes de implementar (N = líneas
//     de código que estimas; sin eso, un cambio de código nunca se prevé bajo)
// Ver docs/20-odd-en-neurodanza.md.
import { fileURLToPath } from "node:url";
import { archivosConPatron, changesInBranch, lineasPorArchivo } from "./cambios.mjs";
import { loadConfig, matchesAny } from "./config.mjs";

export const NIVELES = ["bajo", "medio", "alto"];
// Orden en que se elige el único revisor de un cambio medio: el que cuida lo más caro de romper.
const PRIORIDAD = ["revisor-permisos", "revisor-coherencia", "revisor-ui", "revisor-docs"];
const CONTRATO = /(dto|schema|valid|contrat|contract|zod|yup|openapi|swagger|entity|prisma)/i;
const DOCS = /\.(md|mdx|txt|rst)$/i;
const PRUEBA = /(\.|\/)(test|spec|e2e)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?)\//i;

/** Archivos del cambio con su repo, sin los ignorados del repo. */
function archivosDe(cfg, changes) {
  return Object.entries(changes).flatMap(([repo, fs]) => {
    const r = cfg.repos.find((x) => x.nombre === repo);
    return fs.filter((f) => !matchesAny(f, r?.ignorar ?? [])).map((f) => ({ repo, f }));
  });
}

/**
 * Nivel de riesgo de un cambio (puro). `changes` = { repo: [archivos] }; `lineas` = { repo: { archivo: n } } o
 * { repo: n } (agregadas + borradas), o null si todavía no se sabe (antes de implementar). `permisos` =
 * { repo: [archivos] } cuyas líneas cambiadas tocan permisos (`archivosConPatron` con `ciclo.riesgo.permisosEnCodigo`).
 * - alto: un archivo de `ciclo.riesgo.altos` o de migraciones, 3 repos con código, más de `lineasAlto`, o código en
 *   2 repos con más de `lineasDosRepos` líneas (0 = siempre). Sin diff todavía, 2 repos es medio y se confirma después.
 * - bajo: solo documentación o pruebas, o hasta `lineasBajo` líneas en un repo sin contratos (DTO, esquemas…)
 *   y sin tocar permisos en el código.
 * - medio: lo demás.
 */
export function nivelDe(cfg, changes, lineas = null, { permisos = null } = {}) {
  const R = cfg.ciclo?.riesgo ?? {};
  const files = archivosDe(cfg, changes);
  if (!files.length) return { nivel: "bajo", motivos: ["no hay cambios"], lineas: 0 };
  const migraciones = cfg.retroalimentacion?.migraciones;
  // Un nombre sensible (`*permis*`, `*auth*`…) en el repo de docs, en documentación o en pruebas no es riesgo.
  const sensible = ({ repo, f }) => repo !== cfg.retroalimentacion?.docs && !DOCS.test(f) && !PRUEBA.test(f) && matchesAny(f, R.altos ?? []);
  const altos = files.filter(({ repo, f }) => sensible({ repo, f }) || (migraciones?.repo === repo && (f === migraciones.schema || matchesAny(f, [migraciones.nuevas ?? "-"]))));
  const codigo = files.filter(({ repo, f }) => {
    const r = cfg.repos.find((x) => x.nombre === repo);
    return r && r.nombre !== cfg.retroalimentacion?.docs && matchesAny(f, r.codigo ?? []) && !DOCS.test(f) && !PRUEBA.test(f);
  });
  const repos = new Set(codigo.map((x) => x.repo));
  // Los topes de líneas miden código: no cuentan docs, pruebas, el repo de docs ni archivos fuera del código.
  // `lineas` = { repo: { archivo: n } } (lineasPorArchivo) o { repo: n } (solo repos con código).
  const total = !lineas
    ? null
    : Object.entries(lineas)
        .filter(([repo]) => repos.has(repo))
        .reduce((s, [repo, v]) => s + (typeof v === "number" ? v : codigo.filter((x) => x.repo === repo).reduce((t, x) => t + (v[x.f] ?? 0), 0)), 0);
  // Código cuyas líneas cambiadas tocan permisos (useCan, permission, hasRole…): nunca es riesgo bajo.
  const perm = codigo.filter((x) => permisos?.[x.repo]?.includes(x.f)).map((x) => `${x.repo}/${x.f}`);
  const res = (nivel, motivos) => ({ nivel, motivos, lineas: total, ...(perm.length ? { permisos: perm } : {}) });
  const motivos = [];
  if (altos.length) motivos.push(`archivos sensibles: ${altos.slice(0, 3).map((x) => `${x.repo}/${x.f}`).join(", ")}`);
  const tope = R.lineasDosRepos ?? 0;
  if (repos.size > 2 || (repos.size === 2 && (tope === 0 || (total !== null && total > tope)))) motivos.push(`código en ${[...repos].join(" y ")}${repos.size === 2 && tope ? ` con ${total} líneas (más de ${tope})` : ""}`);
  if (total !== null && total > R.lineasAlto) motivos.push(`${total} líneas (más de ${R.lineasAlto})`);
  if (motivos.length) return res("alto", motivos);
  if (!codigo.length) return res("bajo", ["solo documentación, pruebas o archivos fuera del código"]);
  const contratos = codigo.filter(({ f }) => CONTRATO.test(f));
  if (contratos.length) return res("medio", [`contratos: ${contratos.slice(0, 2).map((x) => x.f).join(", ")}`]);
  if (perm.length) return res("medio", [`el código cambiado toca permisos: ${perm.slice(0, 2).join(", ")}`]);
  if (total === null) return { nivel: "medio", motivos: ["todavía sin diff: se confirma al verificar"], lineas: null };
  if (repos.size === 2) return res("medio", [`${total} líneas en ${[...repos].join(" y ")} (hasta ${tope})`]);
  if (total <= R.lineasBajo) return res("bajo", [`${total} líneas en ${[...repos][0]} (hasta ${R.lineasBajo}), sin contratos ni archivos sensibles`]);
  return res("medio", [`${total} líneas en ${[...repos][0]}`]);
}

/** Patrón de `ciclo.riesgo.permisosEnCodigo` (null si está apagado). */
export const patronPermisos = (cfg) => {
  const p = cfg.ciclo?.riesgo?.permisosEnCodigo;
  return p ? new RegExp(p, "i") : null;
};

/**
 * Qué corre en cada nivel (puro). `revisores` = lo de `revisoresPara`; `fantasmas` = lo de `fantasmasPara`;
 * `pantallas` = si el cambio toca pantallas.
 * - bajo: lint, tipos y pruebas; sin revisores, panel, fantasmas ni especialistas.
 * - medio: un revisor (el de más prioridad que aplica), una persona si hay pantallas, un fantasma si aplica.
 * - alto: el ciclo completo.
 * Con `ciclo.riesgo.activo: false` todo cambio es alto (el ciclo de siempre).
 */
export function planDe(cfg, nivel, { revisores = [], fantasmas = false, pantallas = false, repos = 1, permisos = false, archivos = 0 } = {}) {
  // El modo director (y sus especialistas) cuesta más que implementar directo: solo en cambios con muchos archivos.
  const director = archivos > (cfg.director?.minArchivos ?? 8);
  const todos = cfg.ciclo?.revisores === "todos";
  if (nivel === "bajo" && !todos)
    return { revisores: 0, lanzar: [], personas: 0, recorridos: false, fantasmas: 0, especialistas: 0, director: false, funcionalidad: false };
  if (nivel === "medio" && !todos) {
    // En dos repos lo más caro de romper es que digan cosas distintas, salvo que el código toque permisos.
    const orden = repos >= 2 && !permisos ? ["revisor-coherencia", ...PRIORIDAD] : PRIORIDAD;
    const uno = orden.find((r) => revisores.includes(r));
    return { revisores: uno ? 1 : 0, lanzar: uno ? [uno] : [], personas: pantallas ? 1 : 0, recorridos: pantallas, fantasmas: fantasmas ? 1 : 0, especialistas: 0, director: false, funcionalidad: false };
  }
  const lanzar = todos ? [...PRIORIDAD] : PRIORIDAD.filter((r) => revisores.includes(r));
  return {
    revisores: lanzar.length,
    lanzar,
    personas: pantallas ? cfg.panel?.min ?? 3 : 0,
    recorridos: pantallas,
    fantasmas: fantasmas ? Math.min(2, cfg.fantasmas?.max ?? 2) : 0,
    especialistas: director && cfg.hotel?.activo !== false && repos >= 2 ? 2 : 0,
    director,
    funcionalidad: true,
  };
}

/** ¿El cambio toca pantallas? (`retroalimentacion.pantallas`, con o sin `repo:`) */
export function tocaPantallas(cfg, changes) {
  return Object.entries(changes).some(([repo, fs]) =>
    fs.some((f) =>
      (cfg.retroalimentacion?.pantallas ?? []).some((spec) => {
        const [r, g] = spec.includes(":") ? spec.split(/:(.+)/) : [null, spec];
        return (!r || r === repo) && matchesAny(f, [g]);
      }),
    ),
  );
}

/** Nivel y plan de un cambio. Con `ciclo.riesgo.activo: false`, siempre alto. */
export function riesgoDe(cfg, changes, lineas, { revisores = [], fantasmas = false, permisos = null } = {}) {
  const n = cfg.ciclo?.riesgo?.activo === false ? { nivel: "alto", motivos: ["ciclo.riesgo.activo es false: ciclo completo"], lineas: null } : nivelDe(cfg, changes, lineas, { permisos });
  // Si el código cambiado toca permisos, el revisor de permisos aplica aunque ningún nombre de archivo lo diga.
  if (n.permisos?.length && !revisores.includes("revisor-permisos")) revisores = [...revisores, "revisor-permisos"];
  const repos = new Set(Object.entries(changes).filter(([, fs]) => fs.length).map(([r]) => r)).size;
  return { ...n, plan: planDe(cfg, n.nivel, { revisores, fantasmas, pantallas: tocaPantallas(cfg, changes), repos, permisos: !!n.permisos?.length, archivos: archivosDe(cfg, changes).length }) };
}

/** Riesgo del cambio en la rama (commits contra la base + lo que no está en commit). */
export function riesgoEnRama(cfg, base, extra = {}) {
  return riesgoDe(cfg, changesInBranch(cfg, base), lineasPorArchivo(cfg, base), { ...extra, permisos: permisosEnRama(cfg, base) });
}

/** Archivos de la rama cuyas líneas cambiadas tocan permisos (null con `ciclo.riesgo.permisosEnCodigo: false`). */
export function permisosEnRama(cfg, base) {
  const re = patronPermisos(cfg);
  return re ? archivosConPatron(cfg, base, re) : null;
}

/** `repo:glob,repo:archivo` → { repo: [glob…] } (para prever el nivel con los archivos del plan). */
export function archivosPrevistos(texto) {
  const out = {};
  for (const parte of String(texto ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [repo, glob] = parte.includes(":") ? parte.split(/:(.+)/) : ["", parte];
    // Un glob se juzga como un archivo de ejemplo que coincide con él (src/x/** → src/x/x/x.ts).
    (out[repo] ??= []).push(glob.replace(/\*\*\/?/g, "x/").replace(/\*/g, "x").replace(/\/$/, "/x.ts"));
  }
  return out;
}

/** Texto de una línea para el plan y el informe. */
export const textoRiesgo = (r) => `Riesgo ${r.nivel}: ${r.motivos.join("; ")}. Corre: ${r.plan.revisores ? `${r.plan.revisores} revisor${r.plan.revisores > 1 ? "es" : ""} (${r.plan.lanzar.map((x) => x.replace("revisor-", "")).join(", ")})` : "sin revisores"}${r.plan.personas ? `, ${r.plan.personas} persona${r.plan.personas > 1 ? "s" : ""}` : ", sin panel"}${r.plan.fantasmas ? `, ${r.plan.fantasmas} fantasma${r.plan.fantasmas > 1 ? "s" : ""}` : ""}${r.plan.especialistas ? `, ${r.plan.especialistas} especialistas` : ""}.`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const base = arg("base") ?? cfg.retroalimentacion.version?.ramaBase ?? "main";
  const { revisoresPara } = await import("./ciclo.mjs");
  let r;
  if (arg("archivos")) {
    const changes = archivosPrevistos(arg("archivos"));
    const n = Number(arg("lineas"));
    const rs = Object.keys(changes);
    const lineas = arg("lineas") && Number.isFinite(n) ? Object.fromEntries(rs.map((x) => [x, Math.ceil(n / rs.length)])) : null;
    r = riesgoDe(cfg, changes, lineas, { revisores: revisoresPara(cfg, changes).lanzar });
  } else {
    const changes = changesInBranch(cfg, base);
    r = riesgoDe(cfg, changes, lineasPorArchivo(cfg, base), { revisores: revisoresPara(cfg, changes).lanzar, permisos: permisosEnRama(cfg, base) });
  }
  console.log(JSON.stringify({ ...r, texto: textoRiesgo(r) }, null, 2));
}
