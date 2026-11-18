// neurodanza · autoconfiguración al iniciar la sesión (hook SessionStart, `feedback.mjs inicio`).
// Deja el proyecto listo sin pasos a mano: el bloque de neurodanza en el .gitignore de la raíz (si es un
// repo) y, si los worktrees del modo director quedan fuera del proyecto, un aviso de cómo dar el
// permiso (eso no se hace solo: un plugin no se da permisos a sí mismo). Se apaga con
// `"autoconfigurar": false`. Ver docs/03-configuracion.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { baseWorktrees, raizEsRepo, worktreesFuera } from "./director.mjs";

/** Líneas que neurodanza necesita en el .gitignore: lo local fuera, lo del equipo dentro. */
export const BLOQUE_GITIGNORE = ["# neurodanza: plan, estado, worktrees y datos de los constructos son locales; errores conocidos y lo aprendido se versionan", ".neurodanza/*", "!.neurodanza/errores.json", "!.neurodanza/aprendido/"];

/** Texto del .gitignore con el bloque de neurodanza (o el mismo si ya lo tiene). */
export function conBloque(texto) {
  // El bloque de la 0.5.0 versionaba todos los datos de los constructos: ahora solo lo aprendido.
  if (/^!\.neurodanza\/constructos\/\s*$/m.test(String(texto ?? ""))) return String(texto).replace(/^!\.neurodanza\/constructos\/\s*$/m, "!.neurodanza/aprendido/");
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
function directoriosPermitidos(cfg, cwd = "") {
  const out = [];
  for (const base of [...new Set([cfg.root, cwd ? resolve(cwd) : cfg.root])]) {
    for (const n of ["settings.json", "settings.local.json"]) {
      try {
        const s = JSON.parse(readFileSync(join(base, ".claude", n), "utf8"));
        for (const d of s?.permissions?.additionalDirectories ?? []) out.push(resolve(base, d));
      } catch {
        /* sin archivo */
      }
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

/**
 * Aviso si Claude se abrió dentro de un componente (p. ej. `frontend/`) y la raíz del proyecto no está
 * permitida: el plan, los worktrees y los otros repos quedan fuera de la carpeta de la sesión (o "").
 */
export function avisoComponente(cfg, cwd) {
  if (!cwd) return "";
  const r = relative(cfg.root, resolve(cwd));
  if (r === "" || r.startsWith("..") || /^[a-z]:/i.test(r)) return "";
  const dentro = (d) => {
    const x = relative(d, cfg.root);
    return x === "" || (!x.startsWith("..") && !/^[a-z]:/i.test(x));
  };
  if (directoriosPermitidos(cfg, cwd).some(dentro)) return "";
  const subir = r.split(/[\\/]/).map(() => "..").join("/");
  return `neurodanza · la sesión está en ${r.replace(/\\/g, "/")}, un componente del proyecto (raíz: ${cfg.root.replace(/\\/g, "/")}). El plan, los worktrees del modo director y los demás repos están en la raíz, fuera de esta carpeta. Antes de usar /neurodanza-feature, pídele al usuario (no lo hagas tú) que agregue la raíz una vez: /add-dir ${subir} (o en .claude/settings.json de este repo: { "permissions": { "additionalDirectories": ["${subir}"] } }). Si ya lo hizo en esta sesión, no lo repitas.`;
}

/** Corre la autoconfiguración. Devuelve { mensaje para el usuario, contexto para el modelo }. */
export function autoconfigurar(cfg, cwd = "") {
  if (cfg.autoconfigurar === false) return { mensaje: "", contexto: "" };
  let mensaje = "";
  try {
    if (asegurarGitignore(cfg)) mensaje = "neurodanza: agregué al .gitignore de la raíz el bloque de .neurodanza/ (plan y worktrees locales; errores conocidos y constructos versionados).";
  } catch {
    /* sin permiso de escritura: no es grave */
  }
  return { mensaje, contexto: [avisoComponente(cfg, cwd), avisoPermisos(cfg)].filter(Boolean).join("\n\n") };
}
