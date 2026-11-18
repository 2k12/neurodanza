// neurodanza · autoconfiguración al iniciar la sesión (hook SessionStart, `feedback.mjs inicio`).
// Deja el proyecto listo sin pasos a mano: el bloque de neurodanza en el .gitignore de la raíz (si es un
// repo) y, si los worktrees del modo director quedan fuera del proyecto, un aviso de cómo dar el
// permiso (eso no se hace solo: un plugin no se da permisos a sí mismo). Se apaga con
// `"autoconfigurar": false`. Ver docs/03-configuracion.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { baseWorktrees, raizEsRepo, worktreesFuera } from "./director.mjs";

/** Líneas que neurodanza necesita en el .gitignore: lo local fuera, lo del equipo dentro. */
export const BLOQUE_GITIGNORE = ["# neurodanza: plan, estado y worktrees son locales; errores conocidos y constructos se versionan", ".neurodanza/*", "!.neurodanza/errores.json", "!.neurodanza/constructos/"];

/** Texto del .gitignore con el bloque de neurodanza (o el mismo si ya lo tiene). */
export function conBloque(texto) {
  const lineas = String(texto ?? "").split(/\r?\n/).map((l) => l.trim());
  if (lineas.includes(".neurodanza/*") || lineas.includes(".neurodanza/") || lineas.includes(".neurodanza")) return texto ?? "";
  const base = String(texto ?? "");
  return `${base}${base && !base.endsWith("\n") ? "\n" : ""}${base ? "\n" : ""}${BLOQUE_GITIGNORE.join("\n")}\n`;
}

/** Agrega el bloque al .gitignore de la raíz si la raíz es un repo. Devuelve true si cambió algo. */
export function asegurarGitignore(cfg) {
  if (!raizEsRepo(cfg)) return false;
  const f = join(cfg.root, ".gitignore");
  const antes = existsSync(f) ? readFileSync(f, "utf8") : "";
  const despues = conBloque(antes);
  if (despues === antes) return false;
  writeFileSync(f, despues);
  return true;
}

/** Directorios adicionales permitidos en la configuración de Claude Code del proyecto. */
function directoriosPermitidos(cfg) {
  const out = [];
  for (const n of ["settings.json", "settings.local.json"]) {
    try {
      const s = JSON.parse(readFileSync(join(cfg.root, ".claude", n), "utf8"));
      for (const d of s?.permissions?.additionalDirectories ?? []) out.push(resolve(cfg.root, d));
    } catch {
      /* sin archivo */
    }
  }
  return out;
}

/** Aviso para dar permiso a los worktrees, si quedan fuera del proyecto y no están permitidos (o ""). */
export function avisoPermisos(cfg) {
  if (!worktreesFuera(cfg)) return "";
  const base = baseWorktrees(cfg);
  const dentro = (d) => {
    const r = relative(d, base);
    return r === "" || (!r.startsWith("..") && !/^[a-z]:/i.test(r));
  };
  if (directoriosPermitidos(cfg).some(dentro)) return "";
  const rel = relative(cfg.root, dirname(base)).replace(/\\/g, "/");
  return `neurodanza · modo director: los worktrees de las tareas van en ${base.replace(/\\/g, "/")} (fuera del proyecto, porque la raíz es un repo). Si vas a usar el modo director, pídele al usuario que permita esa carpeta una vez (no lo hagas tú): en .claude/settings.json del proyecto, { "permissions": { "additionalDirectories": ["${rel}"] } }, o /add-dir ${rel}. Sin eso, Claude Code pedirá permiso por cada archivo que editen los implementadores.`;
}

/** Corre la autoconfiguración. Devuelve { mensaje para el usuario, contexto para el modelo }. */
export function autoconfigurar(cfg) {
  if (cfg.autoconfigurar === false) return { mensaje: "", contexto: "" };
  let mensaje = "";
  try {
    if (asegurarGitignore(cfg)) mensaje = "neurodanza: agregué al .gitignore de la raíz el bloque de .neurodanza/ (plan y worktrees locales; errores conocidos y constructos versionados).";
  } catch {
    /* sin permiso de escritura: no es grave */
  }
  return { mensaje, contexto: avisoPermisos(cfg) };
}
