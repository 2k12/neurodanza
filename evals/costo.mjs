#!/usr/bin/env node
// neurodanza · ¿cuánto cuesta el plugin? Las mismas tareas sin él y con él, con Claude Code de verdad, en un proyecto
// temporal de dos repos. Mide USD, tokens, turnos, subagentes y si el resultado pasa pruebas que el agente no ve.
// `permisos` es de riesgo alto: lanza revisores. Gasta tokens. No mide el panel (el proyecto no tiene pantallas). Ver docs/27-costo.md.
//
// Uso: node costo.mjs [--plugin <carpeta>] [--modelo sonnet] [--tareas bajo,medio,alto,permisos] [--modos sin,con,ciclo] [--veces 1] [--tope 2] [--config '{"ciclo":{…}}'] [--conservar]
//   --config se mezcla con la config del proyecto (un nivel: `ciclo` se mezcla clave a clave). `fondoUSD` suma lo que
//   gastaron el portero y la revisión en el Stop, que corren fuera de la sesión; `usdTotal` = usd + fondoUSD.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matarArbol } from "../lib/procesos.mjs";

const PEDIDOS = `const pedidos = [
  { id: 1, cliente: "Ana", estado: "pendiente", total: 10, empresaId: 1 },
  { id: 2, cliente: "Beto", estado: "pagado", total: 25.5, empresaId: 1 },
  { id: 3, cliente: "Caro", estado: "pendiente", total: 7, empresaId: 2 },
];
export function listar(usuario) {
  return pedidos.filter((p) => p.empresaId === usuario.empresaId);
}
export function crear(usuario, datos) {
  if (!datos.cliente) return { status: 400, error: "El cliente es obligatorio" };
  const p = { id: pedidos.length + 1, estado: "pendiente", ...datos, empresaId: usuario.empresaId };
  pedidos.push(p);
  return { status: 201, pedido: p };
}
`;
const BASE = {
  "api/package.json": '{ "name": "api", "type": "module", "scripts": { "test": "node --test" } }\n',
  "api/src/pedidos.mjs": PEDIDOS,
  "api/src/formato.mjs": "export const dinero = (n) => `$${n.toFixed(2)}`;\n",
  "api/src/auth/permisos.mjs": "export const ROLES = { ADMIN: [\"crear\", \"ver\"], VENDEDOR: [\"ver\"] };\nexport function puede(usuario, accion) {\n  return ROLES[usuario.rol].includes(accion);\n}\n",
  "api/test/pedidos.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { listar } from "../src/pedidos.mjs";\ntest("solo los de su empresa", () => assert.equal(listar({ empresaId: 1 }).length, 2));\n',
  "web/package.json": '{ "name": "web", "type": "module", "scripts": { "test": "node --test" } }\n',
  "web/src/validar.mjs": 'export function validarPedido(d) {\n  const errores = {};\n  if (!d.cliente) errores.cliente = "El cliente es obligatorio";\n  return errores;\n}\n',
  "web/test/validar.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { validarPedido } from "../src/validar.mjs";\ntest("cliente obligatorio", () => assert.ok(validarPedido({}).cliente));\n',
};
const OCULTA = 'import assert from "node:assert/strict";\nconst api = await import("./api/src/pedidos.mjs");\nconst f = await import("./api/src/formato.mjs");\nconst web = await import("./web/src/validar.mjs");\nconst u1 = { empresaId: 1 };\n';

/** Tareas con su comprobación oculta. */
export const TAREAS = {
  bajo: {
    pedido: "En api/src/formato.mjs, dinero() falla con null o undefined: debe devolver «$0.00» en esos casos. Agrega su prueba.",
    oculta: 'assert.equal(f.dinero(null), "$0.00");\nassert.equal(f.dinero(undefined), "$0.00");\nassert.equal(f.dinero(2), "$2.00");\n',
  },
  medio: {
    pedido: "En api, listar() acepta un segundo parámetro opcional { estado, min, max, orden }: filtra por estado exacto, por total mínimo y máximo (incluidos) y ordena por total con orden «asc» o «desc». Un estado que no sea «pendiente» ni «pagado» lanza un Error «Estado inválido». Sin parámetro, todo sigue igual. Nunca debe devolver pedidos de otra empresa. Con sus pruebas.",
    oculta: 'assert.equal(api.listar(u1).length, 2);\nassert.deepEqual(api.listar(u1, { estado: "pagado" }).map((p) => p.id), [2]);\nassert.deepEqual(api.listar(u1, { orden: "desc" }).map((p) => p.id), [2, 1]);\nassert.deepEqual(api.listar(u1, { min: 10, max: 10 }).map((p) => p.id), [1]);\nassert.deepEqual(api.listar({ empresaId: 2 }, { estado: "pendiente" }).map((p) => p.id), [3]);\nassert.throws(() => api.listar(u1, { estado: "x" }), /Estado inválido/);\n',
  },
  permisos: {
    pedido: "En api/src/auth/permisos.mjs, puede() falla si el rol no existe o no hay usuario: debe devolver false. Agrega el rol SUPERVISOR, que puede ver y anular; además de él, solo ADMIN puede anular. Con sus pruebas. Es un cambio de permisos: sigue el ciclo completo, con sus revisores.",
    oculta: "const { puede } = await import(\"./api/src/auth/permisos.mjs\");\nassert.equal(puede({ rol: \"X\" }, \"ver\"), false);\nassert.equal(puede(undefined, \"ver\"), false);\nassert.equal(puede({ rol: \"constructor\" }, \"ver\"), false);\nassert.equal(puede({ rol: \"toString\" }, \"ver\"), false);\nassert.equal(puede({ rol: \"SUPERVISOR\" }, \"anular\"), true);\nassert.equal(puede({ rol: \"SUPERVISOR\" }, \"crear\"), false);\nassert.equal(puede({ rol: \"ADMIN\" }, \"anular\"), true);\nassert.equal(puede({ rol: \"VENDEDOR\" }, \"anular\"), false);\n",
  },
  alto: {
    pedido: "Los pedidos llevan ahora una nota opcional de hasta 200 caracteres. En api, crear() la guarda sin espacios al inicio ni al final y responde { status: 400, error: «La nota admite hasta 200 caracteres» } si se pasa después de recortarla. En web, validarPedido() da ese mismo mensaje en errores.nota con la misma regla. crear() nunca debe dejar que los datos cambien id ni empresaId. Con sus pruebas en los dos repos.",
    oculta: 'assert.equal(api.crear(u1, { cliente: "Z", nota: "  hola " }).pedido.nota, "hola");\nconst larga = api.crear(u1, { cliente: "Z", nota: "x".repeat(201) });\nassert.equal(larga.status, 400);\nassert.equal(larga.error, "La nota admite hasta 200 caracteres");\nassert.equal(api.crear(u1, { cliente: "Z", nota: ` ${"x".repeat(200)} ` }).status, 201);\nassert.equal(api.crear(u1, { cliente: "Z" }).status, 201);\nconst m = api.crear(u1, { cliente: "Z", id: 999, empresaId: 2 }).pedido;\nassert.notEqual(m.id, 999);\nassert.equal(m.empresaId, 1);\nassert.equal(web.validarPedido({ cliente: "Z", nota: "x".repeat(201) }).nota, "La nota admite hasta 200 caracteres");\nassert.equal(web.validarPedido({ cliente: "Z", nota: ` ${"x".repeat(200)} ` }).nota, undefined);\n',
  },
};

function armar(modo, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-costo-"));
  for (const [f, t] of Object.entries(BASE)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), t);
  }
  if (modo !== "sin") {
    const repo = (nombre) => ({ nombre, ruta: nombre, codigo: ["src/**"], relacionadas: "node --test {archivos}" });
    const base = { repos: [repo("api"), repo("web")], panel: { ventana: "ninguna" }, figuras: { activo: false }, autoajuste: { activo: false }, autoconfigurar: false };
    writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ ...base, ...extra, ...(extra.ciclo ? { ciclo: { ...base.ciclo, ...extra.ciclo } } : {}) }));
  }
  for (const r of ["api", "web"]) {
    const g = (...a) => execFileSync("git", a, { cwd: join(root, r), stdio: "ignore" });
    g("init", "-q", "-b", "main");
    for (const [k, v] of [["user.email", "banco@localhost"], ["user.name", "banco"], ["core.autocrlf", "false"]]) g("config", k, v);
    g("add", ".");
    g("commit", "-qm", "inicio");
  }
  return root;
}

/** Resume los mensajes de una corrida (puro): costo, tokens, turnos, subagentes y cuánto gastó cada modelo. */
export function resumir(msgs) {
  const fin = msgs.findLast((m) => m.type === "result");
  const usos = msgs.filter((m) => m.type === "assistant").flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : [])).filter((c) => c.type === "tool_use");
  const t = Object.values(fin?.modelUsage ?? {}).reduce((s, u) => ({ salida: s.salida + (u.outputTokens ?? 0), entrada: s.entrada + (u.inputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), cacheLeida: s.cacheLeida + (u.cacheReadInputTokens ?? 0) }), { salida: 0, entrada: 0, cacheLeida: 0 });
  return { usd: fin?.total_cost_usd ?? null, ...t, turnos: fin?.num_turns ?? null, herramientas: usos.length, subagentes: usos.filter((c) => c.name === "Agent" || c.name === "Task").map((c) => String(c.input?.subagent_type ?? "general").replace(/^neurodanza:/, "")), fin: fin?.subtype ?? "sin resultado" };
}

/** Lo que gastaron el portero y la revisión en el Stop (procesos aparte, fuera del costo de la sesión). */
export function gastoFondo(root) {
  const leer = (f) => {
    try {
      return JSON.parse(readFileSync(join(root, ".neurodanza", f), "utf8"));
    } catch {
      return {};
    }
  };
  const rev = leer("revision.json").revisiones ?? [];
  const por = Object.values(leer("portero.json").decisiones ?? {});
  const usd = [...rev, ...por].reduce((s, x) => s + (x.costo ?? 0), 0);
  return { fondoUSD: Math.round(usd * 10000) / 10000, revisiones: rev.map((x) => `${x.revisor.replace(/^revisor-/, "")}:${x.estado ?? "pendiente"}`), portero: por.map((x) => x.decision) };
}

function correr(root, tarea, modo, { plugin, modelo, tope }) {
  const extra = modo !== "sin" ? readFileSync(join(plugin, "plantillas", "AGENTS-neurodanza.md"), "utf8") : "";
  const sistema = join(root, "..", `${root.split(/[\\/]/).pop()}.txt`);
  writeFileSync(sistema, extra || "Proyecto con dos repos: api y web.");
  const args = ["-p", "--setting-sources", "", "--strict-mcp-config", "--permission-mode", "bypassPermissions", "--model", modelo, "--max-budget-usd", String(tope), "--no-session-persistence", "--output-format", "stream-json", "--verbose", "--append-system-prompt-file", sistema, ...(modo !== "sin" ? ["--plugin-dir", plugin] : [])];
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^CLAUDE(CODE|_CODE)_(?!OAUTH|USE)/.test(k) || k === "CLAUDECODE") delete env[k];
  const t0 = Date.now();
  return new Promise((ok) => {
    const win = process.platform === "win32";
    const h = spawn("claude", win ? args.map((a) => `"${a}"`) : args, { cwd: root, env, shell: win, windowsHide: true, detached: !win });
    let out = "";
    let err = "";
    const reloj = setTimeout(() => matarArbol(h.pid), 20 * 60_000);
    h.stdout.on("data", (x) => (out += x));
    h.stderr.on("data", (x) => (err += x));
    h.on("error", (e) => (err += e));
    h.on("close", () => {
      clearTimeout(reloj);
      rmSync(sistema, { force: true });
      const msgs = out.split(/\r?\n/).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      writeFileSync(join(root, "oculta.mjs"), OCULTA + TAREAS[tarea].oculta);
      const p = spawnSync(process.execPath, [join(root, "oculta.mjs")], { encoding: "utf8", cwd: root });
      if (process.argv.includes("--conservar")) writeFileSync(join(root, "traza.jsonl"), out);
      const r = resumir(msgs);
      const fondo = gastoFondo(root);
      ok({ tarea, modo, ...r, ...fondo, usdTotal: r.usd === null ? null : Math.round((r.usd + fondo.fondoUSD) * 10000) / 10000, seg: Math.round((Date.now() - t0) / 1000), pasa: p.status === 0, ...(p.status ? { fallo: p.stderr.match(/(AssertionError|Error)[^\n]*/)?.[0]?.slice(0, 200) } : {}), ...(r.usd === null ? { error: (err || out).slice(-300) } : {}), root });
    });
    h.stdin.end(`${modo === "ciclo" ? "/neurodanza:neurodanza-feature " : ""}${TAREAS[tarea].pedido}\n\nEl plan ya está aprobado: no preguntes nada ni esperes confirmación. No hagas commit.`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const op = { plugin: resolve(arg("plugin", fileURLToPath(new URL("..", import.meta.url)))), modelo: arg("modelo", "sonnet"), tope: Number(arg("tope", "2")) };
  const filas = [];
  for (let v = 0; v < Number(arg("veces", "1")); v++)
    for (const tarea of arg("tareas", "bajo,medio,alto").split(","))
      for (const modo of arg("modos", "sin,con").split(",")) {
        const root = armar(modo, JSON.parse(arg("config", "{}")));
        const { root: r, ...f } = await correr(root, tarea, modo, op);
        filas.push(f);
        console.error(JSON.stringify(f), process.argv.includes("--conservar") ? r : "");
        if (!process.argv.includes("--conservar")) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
      }
  console.log(JSON.stringify({ modelo: op.modelo, filas }, null, 1));
}
