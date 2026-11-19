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

/** Suma agregadas + borradas por archivo de una salida de `git diff --numstat --no-renames` en `acc`. */
const sumar = (acc, txt) => {
  for (const [a, d, f] of txt.split(/\r?\n/).map((l) => l.split("\t")).filter((p) => p.length >= 3)) acc[f] = (acc[f] ?? 0) + (Number(a) || 0) + (Number(d) || 0);
  return acc;
};

/**
 * Líneas cambiadas (agregadas + borradas) por repo y archivo: commits contra la base más lo que no está en commit.
 * Los archivos nuevos sin seguimiento cuentan con todas sus líneas (los de más de 1 MB no cuentan).
 */
export function lineasPorArchivo(cfg, base) {
  const out = {};
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta);
    if (!existsSync(join(dir, ".git"))) continue;
    const committed = sh(`git diff --numstat --no-renames ${base}...HEAD`, dir) || sh(`git diff --numstat --no-renames origin/${base}...HEAD`, dir);
    const n = sumar(sumar({}, committed), sh("git diff --numstat --no-renames HEAD", dir));
    for (const f of sh("git ls-files --others --exclude-standard", dir).split(/\r?\n/).filter(Boolean)) {
      try {
        const p = join(dir, f);
        if (statSync(p).size <= 1_000_000) n[f] = (n[f] ?? 0) + readFileSync(p, "utf8").split(/\r?\n/).filter((l, i, a) => l || i < a.length - 1).length;
      } catch {
        /* ilegible */
      }
    }
    out[r.nombre] = n;
  }
  return out;
}

/**
 * Archivos cuyas líneas cambiadas (agregadas o borradas, commits contra la base + sin commit; los nuevos sin
 * seguimiento, enteros) coinciden con `re`, por repo.
 */
export function archivosConPatron(cfg, base, re) {
  const out = {};
  const deDiff = (txt, acc) => {
    let f = null;
    for (const l of txt.split(/\r?\n/)) {
      // `--- a/x` y luego `+++ b/x`; un archivo borrado trae `+++ /dev/null` y se queda con el de `---`.
      if (l.startsWith("--- ")) f = l.startsWith("--- a/") ? l.slice(6) : null;
      else if (l.startsWith("+++ ")) f = l.startsWith("+++ b/") ? l.slice(6) : f;
      else if (f && /^[+-](?![+-]{2} )/.test(l) && re.test(l.slice(1))) acc.add(f);
    }
    return acc;
  };
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta);
    if (!existsSync(join(dir, ".git"))) continue;
    const committed = sh(`git diff -U0 --no-renames --no-color ${base}...HEAD`, dir) || sh(`git diff -U0 --no-renames --no-color origin/${base}...HEAD`, dir);
    const acc = deDiff(sh("git diff -U0 --no-renames --no-color HEAD", dir), deDiff(committed, new Set()));
    for (const f of sh("git ls-files --others --exclude-standard", dir).split(/\r?\n/).filter(Boolean)) {
      try {
        const p = join(dir, f);
        if (statSync(p).size <= 1_000_000 && re.test(readFileSync(p, "utf8"))) acc.add(f);
      } catch {
        /* ilegible */
      }
    }
    out[r.nombre] = [...acc];
  }
  return out;
}

/** Líneas cambiadas por repo (suma de `lineasPorArchivo`). */
export function lineasEnRama(cfg, base) {
  return Object.fromEntries(Object.entries(lineasPorArchivo(cfg, base)).map(([repo, fs]) => [repo, Object.values(fs).reduce((s, n) => s + n, 0)]));
}
