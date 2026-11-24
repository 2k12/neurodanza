import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import * as I from "../lib/incidencias.mjs";

const CLI = fileURLToPath(new URL("../lib/incidencias.mjs", import.meta.url));
const GUARD = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));
const g = (dir, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** Proyecto con un repo frontend, su remoto (develop y main) y un segundo clon que hace de equipo. */
function proyecto(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-inc-"));
  const remoto = join(root, "remoto.git");
  const equipo = join(root, "equipo");
  g(root, "init", "-q", "--bare", remoto);
  g(remoto, "symbolic-ref", "HEAD", "refs/heads/main");
  g(root, "clone", "-q", remoto, equipo);
  g(equipo, "checkout", "-q", "-B", "main");
  mkdirSync(join(equipo, "src/app/pedidos"), { recursive: true });
  writeFileSync(join(equipo, "src/Boton.tsx"), "export const Boton = () => null;\n");
  writeFileSync(join(equipo, "src/app/pedidos/page.tsx"), 'import { Boton } from "../../Boton";\nexport default function P() { return Boton(); }\n');
  g(equipo, "add", ".");
  g(equipo, "commit", "-qm", "feat(pedidos): base");
  g(equipo, "push", "-q", "origin", "main");
  g(equipo, "push", "-q", "origin", "main:develop");
  g(equipo, "fetch", "-q");
  g(equipo, "switch", "-q", "-c", "develop", "origin/develop");
  g(root, "clone", "-q", remoto, join(root, "frontend"));
  g(join(root, "frontend"), "switch", "-q", "-c", "develop", "origin/develop");
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [{ nombre: "frontend", ruta: "frontend" }], ...extra }));
  return { root, equipo, front: join(root, "frontend"), cfg: loadConfig(root) };
}
const empujar = (p) => {
  writeFileSync(join(p.equipo, "src/Boton.tsx"), `export const Boton = () => ${Math.random()};\n`);
  g(p.equipo, "commit", "-qam", "fix(pedidos): botón");
  g(p.equipo, "push", "-q", "origin", "develop");
};
const guardia = (p, tool_name, tool_input, extra = {}) => spawnSync(process.execPath, [GUARD], { cwd: p.root, input: JSON.stringify({ cwd: p.root, tool_name, tool_input, permission_mode: "auto", ...extra }), encoding: "utf8" });

test("estado: pregunta la rama una sola vez y no crea nada", () => {
  const p = proyecto();
  const e = I.estado(p.cfg, { instalado: false });
  assert.deepEqual(e.preguntas.map((q) => q.tema), ["rama", "base"]);
  assert.deepEqual(e.preguntas[0].opciones, ["develop", "main"]);
  assert.equal(existsSync(join(p.root, "incidencias")), false);
  assert.equal(existsSync(join(p.root, ".neurodanza")), false);
  I.guardarPreferencia(p.cfg, { rama: "frontend=develop" });
  assert.equal(I.estado(p.cfg, { instalado: false }).preguntas.some((q) => q.tema === "rama"), false);
  assert.throws(() => I.guardarPreferencia(p.cfg, { rama: "frontend=no-existe" }), /no tiene/);
  assert.throws(() => I.guardarPreferencia(p.cfg, { rama: "frontend=--upload-pack=x" }), /inválida/);
});

test("graphify: opcional; solo se pregunta si se puede usar y «nunca» se respeta", () => {
  const p = proyecto();
  const temas = (instalado) => I.estado(p.cfg, { red: false, instalado }).preguntas.map((q) => q.tema);
  assert.equal(temas(false).includes("graphify"), false);
  assert.equal(temas(true).includes("graphify"), true);
  mkdirSync(join(p.root, "graphify"));
  assert.equal(temas(false).includes("graphify"), false); // carpeta sin guion: nada que actualizar
  writeFileSync(join(p.root, "graphify/actualizar.sh"), "");
  assert.equal(I.estado(p.cfg, { red: false, instalado: false }).graphify.actualizar, "bash graphify/actualizar.sh");
  assert.equal(temas(false).includes("graphify"), true);
  I.guardarPreferencia(p.cfg, { graphify: "nunca" });
  assert.equal(temas(false).includes("graphify"), false);
});

test("traer: solo avance rápido, limpio y en la rama de desarrollo", async () => {
  const p = proyecto();
  I.guardarPreferencia(p.cfg, { rama: "frontend=develop" });
  empujar(p);
  assert.equal(I.estado(p.cfg, { instalado: false }).preguntas.find((q) => q.tema === "traer").repo, "frontend");
  writeFileSync(join(p.front, "src/nuevo.ts"), "x");
  assert.match(I.traer(p.cfg, "frontend").motivo, /sin guardar/);
  assert.equal(readFileSync(join(p.front, "src/nuevo.ts"), "utf8"), "x");
  g(p.front, "add", ".");
  g(p.front, "commit", "-qm", "wip");
  assert.match(I.traer(p.cfg, "frontend").motivo, /se separó/);
  g(p.front, "switch", "-q", "-c", "trabajo");
  assert.match(I.traer(p.cfg, "frontend").motivo, /estás en trabajo/);

  const q = proyecto();
  I.guardarPreferencia(q.cfg, { rama: "frontend=develop" });
  await I.crearBase(q.cfg);
  const n = await I.nueva(q.cfg, { area: "frontend", modulo: "GEN", titulo: "Botón pequeño", archivo: "`src/Boton.tsx`" });
  empujar(q);
  const r = I.traer(q.cfg, "frontend");
  assert.equal(r.hecho, true);
  assert.deepEqual(r.revisar.map((x) => x.id), [n.id]);
  assert.equal(I.traer(q.cfg, "frontend").motivo, "ya está al día");
  I.guardarPreferencia(q.cfg, { traer: "nunca" });
  assert.equal(I.traer(q.cfg, "frontend").hecho, false);
});

test("base: crea lo que falta y no sobrescribe", async () => {
  const p = proyecto();
  mkdirSync(join(p.root, "incidencias/frontend"), { recursive: true });
  writeFileSync(join(p.root, "incidencias/frontend/METODOLOGIA.md"), "la mía");
  const r = await I.crearBase(p.cfg);
  assert.equal(readFileSync(join(p.root, "incidencias/frontend/METODOLOGIA.md"), "utf8"), "la mía");
  assert.equal(r.respetados.length, 1);
  assert.match(readFileSync(join(p.root, "incidencias/backend/PLANTILLA.md"), "utf8"), /BE-<MÓDULO>-NNN/);
  assert.match(readFileSync(join(p.root, "incidencias/frontend/INVENTARIO.md"), "utf8"), /`\/pedidos`/);
  assert.deepEqual((await I.inventario(p.cfg, "frontend")).nuevas, []);
  assert.deepEqual((await I.crearBase(p.cfg)).creados, []);
});

test("nueva: ficha de la plantilla, fila en el registro, número siguiente y parecidas", async () => {
  const p = proyecto();
  await I.crearBase(p.cfg);
  const d = { area: "frontend", modulo: "ped", titulo: "Tabla | cortada", rol: "Cajero", severidad: "S2", alcance: "Global", esfuerzo: "Bajo", archivo: "`src/app/pedidos/Tabla.tsx`" };
  const a = await I.nueva(p.cfg, d);
  const b = await I.nueva(p.cfg, d);
  assert.deepEqual([a.id, b.id], ["FE-PED-001", "FE-PED-002"]);
  assert.deepEqual(b.parecidas.map((x) => x.id), ["FE-PED-001"]);
  const t = readFileSync(a.ficha, "utf8");
  assert.match(t, /^# FE-PED-001 · Tabla \| cortada/);
  assert.equal(I.campo(t, "Prioridad"), "P1");
  assert.equal(I.campo(t, "Estado"), "Abierta");
  assert.equal(I.campo(t, "Categoría"), "—");
  assert.equal(/<MÓDULO>|NNN/.test(t), false);
  const reg = readFileSync(join(p.root, "incidencias/frontend/REGISTRO.md"), "utf8");
  assert.match(reg, /\| \[FE-PED-001\]\(registradas\/FE-PED-001\.md\) \| Tabla \\\| cortada \| Cajero \| PED \| — \| S2 \| Global \| Bajo \| P1 \| — \| Abierta \|/);
  assert.equal(existsSync(join(a.evidencia, "antes")), true);
  await assert.rejects(I.nueva(p.cfg, { ...d, estado: "Verificada" }), /no puede nacer/);
  for (const id of ["../x", "FE-PED-001/../..", "fe-ped-001"]) assert.throws(() => I.areaDeId(p.cfg, id), /ID inválido/);
});

test("registro: solo toca Estado, agrega lo que falta y no deshace lo que decidió el responsable", () => {
  const reg = "# R\r\n\r\n> nota\r\n\r\n| ID | Título | Estado |\r\n|---|---|---|\r\n| [FE-A-001](x) | uno \\| dos | Abierta |\r\n| [FE-A-002](x) | dos | Verificada (01/01/2026) |\r\n\r\nfin\r\n";
  const f = (id, estado) => ({ id, titulo: id, estado, texto: `| Estado | ${estado} |` });
  const r = I.sincronizar(reg, [f("FE-A-001", "En corrección"), f("FE-A-002", "Abierta"), f("FE-A-003", "Abierta")]);
  assert.match(r.texto, /\| \[FE-A-001\]\(x\) \| uno \\\| dos \| En corrección \|\r\n/);
  assert.match(r.texto, /FE-A-002\]\(x\) \| dos \| Verificada \(01\/01\/2026\) \|\r\n\| \[FE-A-003\]\(registradas\/FE-A-003\.md\) \| FE-A-003 \| Abierta \|\r\n\r\nfin/);
  assert.equal(/[^\r]\n/.test(r.texto), false);
  assert.deepEqual([r.conflictos.length, r.nuevas], [1, ["FE-A-003"]]);
});

test("evidencia y estado: el antes no se pisa, el después lo exige y «Corregida» exige el después", async () => {
  const p = proyecto();
  await I.crearBase(p.cfg);
  const { id } = await I.nueva(p.cfg, { area: "frontend", modulo: "GEN", titulo: "x" });
  assert.throws(() => I.prepararEvidencia(p.cfg, id, "despues"), /no tiene «antes»/);
  assert.throws(() => I.cambiar(p.cfg, { id, estado: "Corregida · por verificar" }), /no hay evidencia de antes/);
  const a = I.prepararEvidencia(p.cfg, id, "antes");
  writeFileSync(join(a.dir, `${id}-antes-390.png`), "x");
  const meta = I.guardarMeta(p.cfg, a.area, a.dir, { momento: "antes", ruta: "/x", persona: null });
  assert.equal(meta.sinCommit, 0);
  assert.throws(() => I.prepararEvidencia(p.cfg, id, "antes"), /no se sobrescribe/);
  assert.throws(() => I.cambiar(p.cfg, { id, estado: "Corregida · por verificar" }), /despues-390/);
  assert.equal(I.avisosEvidencia({ ...meta, momento: "despues", ruta: "/y" }, meta).length, 2);
  const d = I.prepararEvidencia(p.cfg, id, "despues");
  writeFileSync(join(d.dir, `${id}-despues-390.png`), "x");
  I.cambiar(p.cfg, { id, estado: "Corregida · por verificar" });
  const registro = () => readFileSync(join(p.root, "incidencias/frontend/REGISTRO.md"), "utf8");
  assert.match(registro(), /Corregida · por verificar \|/);
  assert.throws(() => I.cambiar(p.cfg, { id, estado: "Descartada" }), /--nota/);
  assert.throws(() => I.cambiar(p.cfg, { id, estado: "Lista" }), /desconocido/);
  I.cambiar(p.cfg, { id, estado: "Verificada" });
  assert.throws(() => I.cambiar(p.cfg, { id, estado: "Abierta" }), /--reabrir/);
  I.cambiar(p.cfg, { id, estado: "Abierta · parcial", reabrir: true });
  assert.match(registro(), /Abierta · parcial \|/);
});

test("barrera: los estados del responsable no se escriben a mano; por la CLI se preguntan aun en automático", async () => {
  const p = proyecto();
  await I.crearBase(p.cfg);
  const { id, ficha } = await I.nueva(p.cfg, { area: "frontend", modulo: "GEN", titulo: "x" });
  const reg = join(p.root, "incidencias/frontend/REGISTRO.md");
  assert.equal(guardia(p, "Edit", { file_path: ficha, old_string: "| Estado | Abierta |", new_string: "| Estado | Verificada (hoy) |" }).status, 2);
  assert.equal(guardia(p, "Edit", { file_path: ficha, old_string: "Abierta", new_string: "Verificada" }).status, 2);
  assert.equal(guardia(p, "Write", { file_path: reg, content: "| a | Cerrada |" }).status, 2);
  assert.equal(guardia(p, "Bash", { command: `sed -i 's/Abierta/Verificada/' incidencias/frontend/registradas/${id}.md` }).status, 2);
  const cli = { command: `node "${CLI}" cambiar --id ${id} --estado "Verificada"` };
  assert.match(guardia(p, "Bash", cli).stdout, /"ask"/);
  assert.match(guardia(p, "Bash", { command: `node "${CLI}" cambiar --id ${id} --estado Abierta --reabrir` }).stdout, /"ask"/);
  assert.equal(guardia(p, "Bash", cli, { agent_id: "a1", agent_type: "implementador" }).status, 2);
  for (const [tool, input] of [
    ["Edit", { file_path: ficha, old_string: "| Estado | Abierta |", new_string: "| Estado | En corrección |" }],
    ["Edit", { file_path: ficha, old_string: "Una o dos frases", new_string: "La cuenta no queda Verificada" }],
    ["Edit", { file_path: join(p.root, "src.ts"), old_string: "a", new_string: "| x | Verificada |" }],
    ["Bash", { command: `grep -n Verificada ${reg}` }],
    ["Bash", { command: `node "${CLI}" cambiar --id ${id} --estado "En corrección"` }],
  ]) {
    const r = guardia(p, tool, input);
    assert.equal(r.status, 0, JSON.stringify(input) + r.stderr);
    assert.equal(/"ask"/.test(r.stdout), false, JSON.stringify(input));
  }
});

test("evidencia de backend: petición a la app local, con lo sensible oculto", async () => {
  const srv = createServer((req, res) => res.end(JSON.stringify({ id: 1, email: "ana@x.com", nota: "escribe a ana@x.com", hijos: [{ token: "abc", nombre: "Ana" }] })));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const p = proyecto({ app: { urls: [`http://127.0.0.1:${srv.address().port}`] } });
    await I.crearBase(p.cfg);
    const { id, evidencia } = await I.nueva(p.cfg, { area: "backend", modulo: "PED", titulo: "x", vista: "`GET /pedidos`" });
    const correr = (...a) =>
      new Promise((ok) => {
        const h = spawn(process.execPath, [CLI, ...a], { cwd: p.root });
        let out = "";
        h.stdout.on("data", (x) => (out += x));
        h.stderr.on("data", (x) => (out += x));
        h.on("close", (c) => ok({ c, out }));
      });
    const r = await correr("evidencia", "--id", id, "--momento", "antes", "--ruta", "/pedidos");
    assert.equal(r.c, 0, r.out);
    const t = readFileSync(join(evidencia, "antes", `${id}-antes.json`), "utf8");
    assert.equal(/ana@x|abc/.test(t), false);
    assert.match(t, /"nombre": "Ana"/);
    assert.equal((await correr("evidencia", "--id", id, "--momento", "despues", "--ruta", "http://example.com/x")).c, 2);
  } finally {
    srv.close();
  }
});

test("alcance, prioridad y reglas de commits", async () => {
  const p = proyecto();
  const a = await I.alcance(p.cfg, ["frontend:src/Boton.tsx"]);
  assert.deepEqual(a.pantallas.map((x) => x.ruta), ["/pedidos"]);
  const r = I.reglas(p.cfg, "frontend");
  assert.deepEqual([r.convencionales, r.tipos, r.alcances], [100, ["feat"], ["pedidos"]]);
  assert.deepEqual([I.prioridad("S1", "Vista"), I.prioridad("S2", "Global"), I.prioridad("S2", "Vista"), I.prioridad("S3", "Global", "Bajo"), I.prioridad("S3", "Global", "Medio"), I.prioridad("S4")], ["P1", "P1", "P2", "P2", "P3", "P3"]);
});

test("sin configuración no hace nada; apagado tampoco mira estados", () => {
  const dir = mkdtempSync(join(tmpdir(), "nd-sin-"));
  assert.equal(spawnSync(process.execPath, [CLI, "estado"], { cwd: dir }).status, 2);
  const p = proyecto({ incidencias: { activo: false } });
  assert.equal(guardia(p, "Write", { file_path: join(p.root, "incidencias/frontend/REGISTRO.md"), content: "| a | Cerrada |" }).status, 0);
});
