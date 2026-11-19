#!/usr/bin/env node
// neurodanza · comprobaciones en segundo plano (fondo). La suite completa y lo que no alcanzó a correr
// dentro del tope del hook Stop se corren en un proceso desacoplado que escribe su avance en
// `.neurodanza/fondo.json` junto con la firma del cambio que verifica. Un cambio nuevo cancela el anterior
// (mata su árbol por PID). El resultado se informa en el siguiente Stop o al iniciar la sesión.
// Ver docs/15-velocidad.md.
//
//   node fondo.mjs estado                    estado del fondo (JSON)
//   node fondo.mjs esperar [--tope <seg>]    espera a que termine el fondo de la firma actual (exit 0 ok, 1 falló, 2 no terminó)
//   node fondo.mjs cancelar                  mata el fondo en curso
//   node fondo.mjs trabajar --raiz <dir>     (interno) el proceso desacoplado que corre las tareas
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { firmaActual } from "./firma.mjs";
import { correr, escribirAtomico, matarArbol } from "./procesos.mjs";

const AQUI = fileURLToPath(import.meta.url);
export const archivoFondo = (cfg) => cfg.abs(".neurodanza/fondo.json");
const tail = (s, n = 30) => String(s).split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");

/** ¿Sigue vivo un proceso? */
export function vivo(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

export function leerFondo(cfg) {
  try {
    return JSON.parse(readFileSync(archivoFondo(cfg), "utf8"));
  } catch {
    return null;
  }
}

function guardar(cfg, estado) {
  mkdirSync(cfg.abs(".neurodanza"), { recursive: true });
  escribirAtomico(archivoFondo(cfg), JSON.stringify(estado, null, 2));
}

/**
 * Mata el trabajador y las tareas en curso de un estado de fondo, sin esperar (el Stop no debe pagar
 * los ~300 ms de taskkill). Es seguro: el trabajador viejo revisa la firma antes de escribir.
 */
function cancelarEstado(estado, esperar = false) {
  if (!estado) return;
  for (const t of Object.values(estado.tareas ?? {})) if (t.estado === "corriendo") matarArbol(t.pid, { esperar });
  matarArbol(estado.pid, { esperar });
}

/**
 * Resumen del fondo para la firma actual (puro sobre `estado`). `trabajadorVivo` dice si el proceso sigue.
 * @returns {{ estado: "sin"|"otra-firma"|"corriendo"|"ok"|"falla"|"interrumpido", fallas: object[], pendientes: object[], ok: object[] }}
 */
export function resumen(estado, firma, trabajadorVivo = false) {
  if (!estado) return { estado: "sin", fallas: [], pendientes: [], ok: [] };
  if (estado.firma !== firma) return { estado: "otra-firma", fallas: [], pendientes: [], ok: [] };
  const ts = Object.values(estado.tareas ?? {});
  const fallas = ts.filter((t) => t.estado === "falla" || t.estado === "cortada");
  // Una tarea cancelada no corrió: cuenta como pendiente (nunca como bien).
  const pendientes = ts.filter((t) => t.estado === "pendiente" || t.estado === "corriendo" || t.estado === "cancelada");
  const ok = ts.filter((t) => t.estado === "ok");
  if (fallas.length) return { estado: "falla", fallas, pendientes, ok };
  if (pendientes.length) return { estado: trabajadorVivo ? "corriendo" : "interrumpido", fallas, pendientes, ok };
  return { estado: "ok", fallas, pendientes, ok };
}

export const idTarea = (repo, paso) => `${repo}:${paso}`;

/**
 * Asegura que el fondo verifique `tareas` para `firma`. Con otra firma, cancela el fondo anterior y empieza
 * de nuevo; con la misma, agrega las tareas que falten. Lanza el trabajador si hay pendientes y no corre.
 * `tareas` = [{ repo, paso, comando, cwd }]. Devuelve el estado guardado.
 */
export function asegurarFondo(cfg, firma, tareas, { lanzar = true } = {}) {
  let estado = leerFondo(cfg);
  if (estado && estado.firma !== firma) {
    cancelarEstado(estado);
    estado = null;
  }
  estado ??= { firma, inicio: new Date().toISOString(), pid: null, tareas: {} };
  let nuevas = 0;
  for (const t of tareas) {
    const id = idTarea(t.repo, t.paso);
    const prev = estado.tareas[id];
    // Una tarea interrumpida (el trabajador murió) o cancelada se vuelve a correr.
    if (prev && prev.estado !== "cancelada" && !(prev.estado === "corriendo" && !vivo(estado.pid))) continue;
    estado.tareas[id] = { ...t, estado: "pendiente" };
    nuevas++;
  }
  const hayPendientes = Object.values(estado.tareas).some((t) => t.estado === "pendiente");
  if (lanzar && hayPendientes && !vivo(estado.pid)) {
    guardar(cfg, estado);
    const p = spawn(process.execPath, [AQUI, "trabajar", "--raiz", cfg.root], { cwd: cfg.root, detached: true, stdio: "ignore", windowsHide: true });
    p.unref();
    estado.pid = p.pid;
    estado.lanzado = new Date().toISOString();
  }
  if (nuevas || lanzar) guardar(cfg, estado);
  return estado;
}

export function cancelarFondo(cfg) {
  const estado = leerFondo(cfg);
  cancelarEstado(estado, true); // a pedido: aquí sí se espera a que muera
  if (estado) {
    for (const t of Object.values(estado.tareas)) if (t.estado === "corriendo" || t.estado === "pendiente") t.estado = "cancelada";
    estado.pid = null;
    guardar(cfg, estado);
  }
}

/** El proceso desacoplado: corre las tareas pendientes (en paralelo por repo, en orden dentro de cada uno). */
async function trabajar(cfg) {
  const tope = (cfg.retroalimentacion.topeFondoSeg ?? 1800) * 1000;
  const inicial = leerFondo(cfg);
  if (!inicial) return;
  const firma = inicial.firma;
  const actualizar = (id, cambios) => {
    const e = leerFondo(cfg);
    if (!e || e.firma !== firma || !e.tareas[id]) return false; // llegó un cambio nuevo: esta corrida ya no sirve
    e.tareas[id] = { ...e.tareas[id], ...cambios };
    guardar(cfg, e);
    return true;
  };
  const porRepo = {};
  for (const [id, t] of Object.entries(inicial.tareas)) if (t.estado === "pendiente") (porRepo[t.repo] ??= []).push([id, t]);
  await Promise.all(
    Object.values(porRepo).map(async (lista) => {
      for (const [id, t] of lista) {
        if (!actualizar(id, { estado: "corriendo", desde: new Date().toISOString() })) return;
        const r = await correr(t.comando, { cwd: t.cwd, timeoutMs: tope, grupoPropio: false, alIniciar: (pid) => actualizar(id, { pid }) });
        const estado = r.ok ? "ok" : r.cortado ? "cortada" : "falla";
        if (!actualizar(id, { estado, ms: r.ms, salida: r.ok ? "" : tail(r.out), hasta: new Date().toISOString(), pid: null })) return;
      }
    }),
  );
  const e = leerFondo(cfg);
  if (e && e.firma === firma && e.pid === process.pid) {
    e.pid = null;
    e.fin = new Date().toISOString();
    guardar(cfg, e);
  }
}

// ───────────────────────── CLI ─────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const cfg = loadConfig(arg("raiz") ?? process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  if (cmd === "trabajar") {
    // Si este proceso no es el trabajador registrado, lo registra (lanzado por asegurarFondo).
    const e = leerFondo(cfg);
    if (e && !vivo(e.pid)) {
      e.pid = process.pid;
      guardar(cfg, e);
    }
    await trabajar(cfg);
  } else if (cmd === "estado") {
    const e = leerFondo(cfg);
    console.log(JSON.stringify(e ? { ...e, trabajadorVivo: vivo(e.pid) } : { estado: "sin fondo" }, null, 2));
  } else if (cmd === "cancelar") {
    cancelarFondo(cfg);
    console.log("fondo cancelado");
  } else if (cmd === "esperar") {
    const tope = Number(arg("tope") ?? 900) * 1000;
    const t0 = Date.now();
    const firma = firmaActual(cfg);
    for (;;) {
      const e = leerFondo(cfg);
      const r = resumen(e, firma, vivo(e?.pid));
      if (r.estado === "ok" || r.estado === "sin") {
        console.log(r.estado === "ok" ? `suite completa ok para este cambio (${r.ok.length} tareas)` : "no hay nada en segundo plano para este cambio");
        process.exit(0);
      }
      if (r.estado === "falla") {
        console.log(`falló en segundo plano:\n${r.fallas.map((t) => `✖ ${t.repo} · ${t.paso}${t.estado === "cortada" ? " (se acabó el tiempo)" : ""}:\n${t.salida ?? ""}`).join("\n\n")}`);
        process.exit(1);
      }
      if (r.estado === "otra-firma" || r.estado === "interrumpido") {
        console.log(r.estado === "otra-firma" ? "el fondo verificaba otro cambio: corre el hook Stop (termina el turno) para lanzarlo con el cambio actual" : "el fondo se interrumpió: el próximo Stop lo vuelve a lanzar");
        process.exit(2);
      }
      if (Date.now() - t0 > tope) {
        console.log(`la suite sigue corriendo tras ${Math.round(tope / 1000)} s: ${r.pendientes.map((t) => `${t.repo} · ${t.paso}`).join(", ")}`);
        process.exit(2);
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  } else {
    console.error("Uso: fondo.mjs estado | esperar [--tope <seg>] | cancelar");
    process.exit(1);
  }
}

