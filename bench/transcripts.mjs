// neurodanza · transcripts falsos de Claude Code (mismo formato que ~/.claude/projects/<slug>/*.jsonl) para las
// pruebas y el banco. Cada evento es una herramienta con su resultado:
//   { cmd, falla?: "texto del error", codigo? }   comando de terminal (Bash)
//   { rechazo: "motivo", herramienta? }           la barrera lo rechazó (PreToolUse … hook error)
//   { corte: true }                                corte por tiempo de neurodanza
//   { lanzar: "neurodanza:revisor-ui" }            lanza un subagente
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let n = 0;
const id = (p) => `${p}_${(++n).toString(36)}`;

/** Líneas JSONL de una sesión. `inicio` = fecha ISO; cada evento suma 30 s. */
export function lineasSesion({ sesion, inicio, eventos = [], tokens = { input: 10, output: 200 }, agente = null }) {
  const lineas = [];
  let t = Date.parse(inicio);
  const ts = () => new Date((t += 30_000)).toISOString();
  const base = { sessionId: sesion, ...(agente ? { isSidechain: true, agentId: sesion } : {}) };
  for (const e of eventos) {
    const uso = id("toolu");
    const msg = id("msg");
    let tool;
    if (e.cmd !== undefined) tool = { type: "tool_use", id: uso, name: "Bash", input: { command: e.cmd } };
    else if (e.rechazo !== undefined) tool = { type: "tool_use", id: uso, name: e.herramienta ?? "Bash", input: { command: e.intento ?? "git push origin main" } };
    else if (e.lanzar) tool = { type: "tool_use", id: uso, name: "Agent", input: { subagent_type: e.lanzar, prompt: "…" } };
    else tool = { type: "tool_use", id: uso, name: "Read", input: { file_path: "src/a.ts" } };
    // La respuesta llega en dos líneas con el mismo id de mensaje (los tokens se cuentan una vez).
    const usage = { input_tokens: tokens.input, output_tokens: tokens.output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 };
    lineas.push({ ...base, type: "assistant", timestamp: ts(), message: { id: msg, role: "assistant", content: [{ type: "text", text: "…" }], usage } });
    lineas.push({ ...base, type: "assistant", timestamp: ts(), message: { id: msg, role: "assistant", content: [tool], usage } });
    let res;
    if (e.cmd !== undefined) res = e.falla ? { type: "tool_result", tool_use_id: uso, is_error: true, content: `Exit code ${e.codigo ?? 1}\n${e.falla}` } : { type: "tool_result", tool_use_id: uso, content: "ok" };
    else if (e.rechazo !== undefined) res = { type: "tool_result", tool_use_id: uso, is_error: true, content: `PreToolUse:${e.herramienta ?? "Bash"} hook error: [node "C:/x/hooks/guardrails.mjs"]: ${e.rechazo}` };
    else if (e.corte) res = { type: "tool_result", tool_use_id: uso, is_error: true, content: "PreToolUse:Read hook error: [node guardrails.mjs]: neurodanza: se acabó tu tiempo. Entrega YA tu respuesta en el formato pedido con lo que tienes." };
    else res = { type: "tool_result", tool_use_id: uso, content: "…" };
    lineas.push({ ...base, type: "user", timestamp: ts(), message: { role: "user", content: [res] } });
  }
  return lineas.map((l) => JSON.stringify(l));
}

/**
 * Escribe una carpeta de transcripts: `sesiones` = [{ sesion, inicio, eventos, subagentes?: [{ tipo, eventos }] }].
 * Los subagentes van en `<sesion>/subagents/agent-<id>.jsonl` con su `.meta.json` (agentType), como Claude Code.
 */
export function escribirTranscripts(dir, sesiones) {
  mkdirSync(dir, { recursive: true });
  for (const s of sesiones) {
    writeFileSync(join(dir, `${s.sesion}.jsonl`), lineasSesion(s).join("\n") + "\n");
    (s.subagentes ?? []).forEach((a, i) => {
      const sub = join(dir, s.sesion, "subagents");
      mkdirSync(sub, { recursive: true });
      const aid = `agent-${s.sesion.slice(0, 6)}${i}`;
      writeFileSync(join(sub, `${aid}.jsonl`), lineasSesion({ sesion: s.sesion, inicio: s.inicio, eventos: a.eventos, agente: a.tipo }).join("\n") + "\n");
      writeFileSync(join(sub, `${aid}.meta.json`), JSON.stringify({ agentType: a.tipo, finished: true }));
    });
  }
}

const LARGO = `node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.pedido.findMany({ where: { estado: 'PENDIENTE' }, include: { cliente: true, lineas: { include: { producto: true } } }, take: 20 }).then((r) => console.log(JSON.stringify(r, null, 2))).finally(() => p.$disconnect())"`;
const EOF = "/usr/bin/bash: -c: line 3: unexpected EOF while looking for matching `''";

/**
 * Escenario sembrado del autoajuste (lo usan las pruebas y el banco). Días antes de `hoy`:
 *  - el mismo rechazo de la barrera 4 veces en 3 sesiones (agente principal) → lección;
 *  - el mismo error de comillas en 3 comandos distintos de 2 sesiones → error conocido;
 *  - un comando largo 3 veces en 2 sesiones → sugerencia de macro;
 *  - revisor-ui cortado por tiempo en 3 sesiones → propuesta de presupuesto (revisor);
 *  - el lint configurado del repo api falla 3 veces → propuesta de config;
 *  - ruido que no debe proponer nada: un rechazo suelto, un fallo suelto y 2 cortes de una persona en 1 sesión.
 */
export function escenarioAutoajuste(hoy = Date.now()) {
  const d = (k) => new Date(hoy - k * 86_400_000).toISOString();
  const push = { rechazo: "guardia: neurodanza está en main: no se hace push directo a main. Crear una rama y llevar el cambio por PR.", intento: "git push origin main" };
  const lint = { cmd: "cd api && npx eslint src", falla: "sh: 1: eslint: not found", codigo: 127 };
  const sesiones = [
    { sesion: "s1-aaaa", inicio: d(5), eventos: [push, { cmd: LARGO }, { cmd: "node -e 'console.log('a')'", falla: EOF, codigo: 2 }, lint, { rechazo: "neurodanza: suelto, una sola vez" }], subagentes: [{ tipo: "neurodanza:revisor-ui", eventos: [{ corte: true }] }] },
    { sesion: "s2-bbbb", inicio: d(4), eventos: [push, push, { cmd: LARGO }, { cmd: "node -e 'x('b')'", falla: EOF, codigo: 2 }, lint, { cmd: "ls /no/existe", falla: "ls: cannot access '/no/existe': No such file or directory", codigo: 2 }], subagentes: [{ tipo: "neurodanza:revisor-ui", eventos: [{ corte: true }] }, { tipo: "neurodanza:persona-evaluadora", eventos: [{ corte: true }, { corte: true }] }] },
    { sesion: "s3-cccc", inicio: d(3), eventos: [push, { cmd: LARGO }, { cmd: "node -e 'y('c')'", falla: EOF, codigo: 2 }, lint], subagentes: [{ tipo: "neurodanza:revisor-ui", eventos: [{ corte: true }] }] },
  ];
  const esperado = {
    lecciones: ["principal"],
    errores: 2, // comillas y eslint (el ls suelto no)
    macros: 1,
    propuestas: ["presupuesto:revisor", "config:api.lint"],
    noPropuestas: ["presupuesto:persona"],
  };
  return { sesiones, esperado, config: { repos: [{ nombre: "api", ruta: "api", codigo: ["src/**"], lint: "npx eslint src" }] } };
}

/** Sesiones después de aplicar un ajuste de presupuesto: revisores con o sin cortes. */
export function despuesDelAjuste(hoy, { cortes }) {
  return Array.from({ length: 5 }, (_, i) => ({ sesion: `p${i}-${cortes ? "c" : "s"}`, inicio: new Date(hoy - (4 - i) * 3_600_000 * 5 - 86_400_000).toISOString(), eventos: [{ cmd: "git status" }], subagentes: [{ tipo: "neurodanza:revisor-ui", eventos: cortes ? [{ corte: true }] : [{ cmd: "git diff" }] }] }));
}
