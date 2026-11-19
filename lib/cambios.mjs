// neurodanza · archivos cambiados en la rama de cada repo (commits contra la base + lo que no está en commit).
// Módulo aparte para que ciclo.mjs y fantasmas.mjs lo usen sin importarse entre ellos.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
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
