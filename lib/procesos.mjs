// neurodanza · correr comandos con tope de tiempo y matar el árbol completo al cortar.
// `exec` con `timeout` mata solo el shell: en Windows el proceso real (node, tsc, vitest…) queda vivo y
// huérfano, y si retiene la salida el callback nunca llega. Aquí el corte mata todo el árbol y la promesa
// se resuelve al salir el proceso, sin esperar a que se cierren las tuberías. Ver docs/15-velocidad.md.
import { execSync, spawn } from "node:child_process";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Mata un proceso y todos sus hijos (Windows: taskkill /T /F; macOS y Linux: su grupo). Con
 * `{ esperar: false }` no espera a taskkill (en Windows tarda ~300 ms): para cancelar algo que ya no importa.
 */
export function matarArbol(pid, { esperar = true } = {}) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      if (esperar) execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore", windowsHide: true });
      else spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ya terminó */
    }
  }
}

/**
 * Corre un comando de shell con tope. Resuelve { ok, out, ms, cortado, code }. `cortado` = se acabó el
 * tiempo y se mató el árbol (no se sabe si habría pasado: nunca cuenta como bien).
 */
export function correr(cmd, { cwd, timeoutMs = 240_000, env, grupoPropio = true, alIniciar } = {}) {
  const t0 = Date.now();
  return new Promise((res) => {
    let out = "";
    let listo = false;
    const p = spawn(cmd, { cwd, shell: true, env: env ? { ...process.env, ...env } : process.env, windowsHide: true, detached: grupoPropio && process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    alIniciar?.(p.pid);
    const fin = (r) => {
      if (listo) return;
      listo = true;
      clearTimeout(timer);
      p.stdout?.destroy();
      p.stderr?.destroy();
      res({ ...r, out: out.slice(-20_000), ms: Date.now() - t0 });
    };
    const guardar = (d) => {
      out += d;
      if (out.length > 200_000) out = out.slice(-100_000);
    };
    p.stdout.on("data", guardar);
    p.stderr.on("data", guardar);
    const timer = setTimeout(() => {
      matarArbol(p.pid);
      fin({ ok: false, cortado: true, code: null });
    }, Math.max(1, timeoutMs));
    p.on("error", (e) => fin({ ok: false, cortado: false, code: null, error: String(e.message) }));
    // Lo normal: `close` (ya se leyó toda la salida). Si un nieto retiene la salida, `close` no llega:
    // entonces, 30 ms después de `exit`, se resuelve igual para no dejar colgada la promesa.
    p.on("close", (code) => fin({ ok: code === 0, cortado: false, code }));
    p.on("exit", (code) => setTimeout(() => fin({ ok: code === 0, cortado: false, code }), 30));
  });
}

/** Escritura atómica: archivo temporal + rename (un lector nunca ve un JSON a medias). */
export function escribirAtomico(file, texto) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, texto);
  try {
    renameSync(tmp, file);
  } catch {
    // En Windows el rename puede fallar si otro proceso tiene el archivo abierto: se reintenta una vez.
    try {
      renameSync(tmp, file);
    } catch {
      writeFileSync(file, texto);
      try {
        unlinkSync(tmp);
      } catch {
        /* ya no está */
      }
    }
  }
}
