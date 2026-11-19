#!/usr/bin/env node
// neurodanza · ayudas del ciclo de /neurodanza-feature (planificador + ejecutor).
//   node ciclo.mjs revisores [--base main]   qué revisores lanzar para lo cambiado en la rama (JSON)
//   node ciclo.mjs presupuesto                 máximo de pasos por tipo de subagente (JSON)
// Ver docs/11-mapa-y-ciclo.md.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny } from "./config.mjs";

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

  motivos["revisor-docs"] = "siempre que hay cambios";
  return { lanzar: REVISORES.filter((r) => motivos[r]), motivos, omitir };
}

const sh = (cmd, cwd) => {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000 });
  } catch {
    return "";
  }
};

/** Archivos cambiados en la rama (commits contra la base + lo que no está en commit), por repo. */
export function changesInBranch(cfg, base) {
  const out = {};
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta);
    if (!existsSync(join(dir, ".git"))) continue;
    const committed = sh(`git diff --name-only ${base}...HEAD`, dir) || sh(`git diff --name-only origin/${base}...HEAD`, dir);
    const pending = sh("git status --porcelain --untracked-files=all", dir)
      .split(/\r?\n/)
      .filter((l) => l.length > 3)
      .map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""));
    out[r.nombre] = [...new Set([...committed.split(/\r?\n/).filter(Boolean), ...pending])];
  }
  return out;
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
    console.log(JSON.stringify({ ...revisoresPara(cfg, changes), fantasmas: fantasmasPara(cfg, changes, leer) }, null, 2));
  }
  else if (process.argv[2] === "presupuesto") console.log(JSON.stringify(cfg.ciclo.maxPasos));
  else {
    console.error("Uso: ciclo.mjs revisores [--base <rama>] | presupuesto");
    process.exit(1);
  }
}
