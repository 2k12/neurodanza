// neurodanza · firma del cambio: identifica el estado exacto de lo cambiado en cada repo (commit, diff
// contra HEAD y tamaño y fecha de los archivos cambiados). Misma firma = mismo resultado de lint, tipos y
// pruebas. La usan la caché del hook Stop y el trabajo en segundo plano (fondo).
import { execFile, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** Firma de un conjunto de partes. */
export const fingerprint = (parts) => createHash("sha1").update(parts.join("\u0000")).digest("hex");

function sh(cmd, cwd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }) };
  } catch {
    return { ok: false, out: "" };
  }
}

/** Firma del estado de un repo con estos archivos cambiados. */
export function repoFingerprint(cfg, repo, files) {
  const dir = cfg.abs(repo.ruta);
  const diff = sh("git diff HEAD --no-ext-diff --no-color", dir);
  const head = sh("git rev-parse HEAD", dir);
  const stats = files.map((f) => {
    try {
      const st = statSync(join(dir, f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${f}:-`;
    }
  });
  const cmds = JSON.stringify([repo.lint, repo.tipos, repo.relacionadas, repo.suite]);
  return fingerprint([repo.nombre, head.out, diff.ok ? diff.out : String(Date.now()), ...stats, cmds]);
}

const git = (args, cwd) =>
  new Promise((res) => execFile("git", args, { cwd, encoding: "utf8", timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out) => res({ ok: !err, out: out ?? "" })));

/**
 * Igual que `repoFingerprint`, pero sin bloquear: los dos comandos de git de cada repo, y los de todos
 * los repos, corren a la vez (el hook Stop no paga cada `git diff` uno tras otro).
 */
export async function repoFingerprintAsync(cfg, repo, files) {
  const dir = cfg.abs(repo.ruta);
  const [diff, head] = await Promise.all([git(["diff", "HEAD", "--no-ext-diff", "--no-color"], dir), git(["rev-parse", "HEAD"], dir)]);
  const stats = files.map((f) => {
    try {
      const st = statSync(join(dir, f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${f}:-`;
    }
  });
  const cmds = JSON.stringify([repo.lint, repo.tipos, repo.relacionadas, repo.suite]);
  return fingerprint([repo.nombre, head.out, diff.ok ? diff.out : String(Date.now()), ...stats, cmds]);
}

/** Firma del cambio completo (todos los repos con cambios). `porRepo` = { repo: firma }. */
export const firmaCambio = (porRepo) => fingerprint(Object.entries(porRepo).sort(([a], [b]) => a.localeCompare(b)).map(([r, f]) => `${r}=${f}`));

/** Archivos con cambios sin commit (incluye nuevos; excluye borrados). */
export function parseStatus(porcelain) {
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l.length > 3 && !/^( D|D )/.test(l))
    .map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""))
    .filter((f) => !f.endsWith("/"));
}

/** Archivos cambiados por repo: { repo: [archivos] } (solo repos con .git). */
export function changesOf(cfg) {
  const out = {};
  for (const r of cfg.repos) {
    const dir = cfg.abs(r.ruta);
    if (!existsSync(join(dir, ".git"))) continue;
    const s = sh("git status --porcelain --untracked-files=all", dir);
    out[r.nombre] = s.ok ? parseStatus(s.out) : [];
  }
  return out;
}

/** Firma del cambio actual del proyecto (la que usan el hook Stop y el fondo). */
export function firmaActual(cfg) {
  const changes = changesOf(cfg);
  const touched = cfg.repos.filter((r) => (changes[r.nombre] ?? []).length > 0);
  return firmaCambio(Object.fromEntries(touched.map((r) => [r.nombre, repoFingerprint(cfg, r, changes[r.nombre])])));
}
