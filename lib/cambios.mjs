// neurodanza · archivos cambiados en la rama de cada repo (commits contra la base + lo que no está en commit).
// Módulo aparte para que ciclo.mjs y fantasmas.mjs lo usen sin importarse entre ellos.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

/** Suma agregadas + borradas de una salida de `git diff --numstat`. */
const suma = (txt) =>
  txt
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 3)
    .reduce((s, [a, d]) => s + (Number(a) || 0) + (Number(d) || 0), 0);

/**
 * Líneas cambiadas (agregadas + borradas) por repo: commits contra la base más lo que no está en commit.
 * Los archivos nuevos sin seguimiento cuentan con todas sus líneas (los de más de 1 MB no cuentan).
 */
export function lineasEnRama(cfg, base) {
  const out = {};
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta);
    if (!existsSync(join(dir, ".git"))) continue;
    const committed = sh(`git diff --numstat ${base}...HEAD`, dir) || sh(`git diff --numstat origin/${base}...HEAD`, dir);
    let n = suma(committed) + suma(sh("git diff --numstat HEAD", dir));
    for (const f of sh("git ls-files --others --exclude-standard", dir).split(/\r?\n/).filter(Boolean)) {
      try {
        const p = join(dir, f);
        if (statSync(p).size <= 1_000_000) n += readFileSync(p, "utf8").split(/\r?\n/).filter((l, i, a) => l || i < a.length - 1).length;
      } catch {
        /* ilegible */
      }
    }
    out[r.nombre] = n;
  }
  return out;
}
