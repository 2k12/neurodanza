#!/usr/bin/env node
// neurodanza · pruebas primero (idea de ODD): ver la prueba en ROJO antes de implementar y en VERDE después.
// Una prueba que nunca falló no demuestra que prueba la regla nueva.
//   node pruebas.mjs rojo --repo <repo> --archivo <prueba> [--dir <carpeta del repo>] [--proyecto <raíz>]   debe fallar
//     (la corre con `repos[].relacionadas`; --dir para correrla en un worktree del modo director)
//   node pruebas.mjs verde --repo <repo> --archivo <prueba>   la corre otra vez; debe pasar
//   node pruebas.mjs estado                                    pruebas con rojo y verde registrados
// El hook Stop avisa (ciclo.pruebaPrimero: "avisar") o bloquea ("exigir") si cambió código y una prueba nueva o
// cambiada no se vio en rojo. Ver docs/20-odd-en-neurodanza.md.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, matchesAny } from "./config.mjs";
import { correr, escribirAtomico } from "./procesos.mjs";

export const ES_PRUEBA = /(\.|\/)(test|spec|e2e)\.[cm]?[jt]sx?$|(^|\/)__tests__\//i;
const archivoRegistro = (cfg) => cfg.abs(".neurodanza/pruebas.json");

export function leerRegistro(cfg) {
  try {
    return JSON.parse(readFileSync(archivoRegistro(cfg), "utf8"));
  } catch {
    return {};
  }
}
function guardarRegistro(cfg, data) {
  mkdirSync(dirname(archivoRegistro(cfg)), { recursive: true });
  escribirAtomico(archivoRegistro(cfg), JSON.stringify(data, null, 2));
}
const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "");

/** Corre una prueba con el comando de pruebas relacionadas del repo. */
async function correrPrueba(cfg, repo, archivo, dir = null) {
  const r = cfg.repos.find((x) => x.nombre === repo);
  if (!r) throw new Error(`no hay un repo «${repo}» en la configuración.`);
  if (!r.relacionadas?.includes("{archivos}")) throw new Error(`${repo}: repos[].relacionadas debe tener {archivos} para correr una prueba sola.`);
  const cwd = dir ?? cfg.abs(r.ruta);
  if (!existsSync(`${cwd}/${archivo}`)) throw new Error(`no existe ${archivo} en ${cwd}.`);
  return correr(r.relacionadas.replace("{archivos}", archivo), { cwd, timeoutMs: (cfg.barreras?.timeoutComandos?.maxSeg ?? 120) * 1000 });
}

/**
 * Rojo: la prueba debe fallar antes de implementar. Si pasa, no prueba lo nuevo (o ya estaba hecho) y no se
 * registra. Un corte por tiempo tampoco cuenta.
 */
export async function rojo(cfg, repo, archivo, { ahora = Date.now(), dir = null } = {}) {
  const r = await correrPrueba(cfg, repo, norm(archivo), dir);
  if (r.cortado) return { ok: false, texto: `${repo}/${archivo}: se cortó por tiempo; no cuenta como rojo.` };
  if (r.ok) return { ok: false, texto: `${repo}/${archivo} pasa sin implementar: no prueba la regla nueva (o ya estaba hecha). Revísala antes de seguir.` };
  const data = leerRegistro(cfg);
  ((data[repo] ??= {})[norm(archivo)] = { rojo: ahora, verde: null });
  guardarRegistro(cfg, data);
  return { ok: true, texto: `rojo observado: ${repo}/${archivo} falla antes de implementar.\n${r.out.trim().split(/\r?\n/).slice(-8).join("\n")}` };
}

/** Verde: la misma prueba pasa después de implementar. */
export async function verde(cfg, repo, archivo, { ahora = Date.now(), dir = null } = {}) {
  const r = await correrPrueba(cfg, repo, norm(archivo), dir);
  const data = leerRegistro(cfg);
  const e = data[repo]?.[norm(archivo)];
  if (!r.ok) return { ok: false, texto: `${repo}/${archivo} todavía falla.\n${r.out.trim().split(/\r?\n/).slice(-15).join("\n")}` };
  if (e) {
    e.verde = ahora;
    guardarRegistro(cfg, data);
  }
  return { ok: true, texto: e ? `verde: ${repo}/${archivo} pasa (rojo visto antes).` : `${repo}/${archivo} pasa, pero no se vio en rojo antes: no hay evidencia de que pruebe lo nuevo.` };
}

/**
 * Pruebas nuevas o cambiadas sin rojo registrado, en repos donde además cambió código (puro).
 * `changes` = { repo: [archivos] }; `registro` = lo de `leerRegistro`.
 */
export function sinRojo(cfg, changes, registro) {
  const out = [];
  for (const r of cfg.repos) {
    const fs = (changes[r.nombre] ?? []).filter((f) => !matchesAny(f, r.ignorar ?? []));
    const pruebas = fs.filter((f) => ES_PRUEBA.test(f));
    const codigo = fs.filter((f) => !ES_PRUEBA.test(f) && matchesAny(f, r.codigo ?? ["**"]) && /\.[cm]?[jt]sx?$/.test(f));
    if (!codigo.length) continue;
    for (const p of pruebas) if (!registro[r.nombre]?.[norm(p)]?.rojo) out.push(`${r.nombre}/${p}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--proyecto");
  const cfg = loadConfig(i > 0 ? process.argv[i + 1] : process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  try {
    const cmd = process.argv[2];
    if (cmd === "rojo" || cmd === "verde") {
      const r = await (cmd === "rojo" ? rojo : verde)(cfg, arg("repo"), arg("archivo"), { dir: arg("dir") ?? null });
      console.log(r.texto);
      process.exitCode = r.ok ? 0 : 1;
    } else if (cmd === "estado") {
      const data = leerRegistro(cfg);
      const filas = Object.entries(data).flatMap(([repo, fs]) => Object.entries(fs).map(([f, e]) => `${repo}/${f} · rojo ${new Date(e.rojo).toISOString().slice(11, 19)}${e.verde ? ` · verde ${new Date(e.verde).toISOString().slice(11, 19)}` : " · sin verde"}`));
      console.log(filas.join("\n") || "sin pruebas registradas en este ciclo.");
    } else {
      console.error("comandos: rojo | verde | estado");
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`pruebas: ${e.message}`);
    process.exitCode = 1;
  }
}
