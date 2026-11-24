// Paso 4 (seguridad): figuras.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { anotarManoTarea, asociarAgente, clasificar, clasificarComando, decidirFigura, manoDe, MANOS, tocaProtegido } from "../lib/figuras.mjs";

const HOOK = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));
const APP = ["localhost", "127.0.0.1"];

function proyecto(figuras = { activo: true }) {
  const root = mkdtempSync(join(tmpdir(), "nd-fig-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], figuras, app: { urls: ["http://localhost:3000"] }, autoconfigurar: false }));
  return { root, cfg: loadConfig(root) };
}

test("figuras: clasificación de comandos reales, con trucos", () => {
  const casos = {
    leer: ["git status", "git diff --stat && git log -5", "cat package.json | jq .version", "find src -name '*.ts'", "Get-ChildItem src", 'node -e "console.log(1+1)"'],
    verificar: ["npx vitest run src/a.test.ts", "pnpm lint", "npx tsc --noEmit", 'node "C:/x/neurodanza/lib/fusible.mjs" estado', "timeout 60 npm test", "FOO=1 pnpm test"],
    editar: ["echo hola > notas.txt", "sed -i 's/a/b/' src/a.ts", "cp a.ts b.ts", "git add . && git commit -m 'x'"],
    externo: ["npm install left-pad", "git push origin main", "curl https://example.com", "docker compose up -d", "npx prisma migrate dev", "node scripts/seed.mjs", "unknowncmd --flag", "node -e \"fetch('https://evil.com')\""],
    destructivo: ["rm -rf dist", "git reset --hard HEAD~1", "git clean -fdx", "git push --force", 'psql -c "DROP TABLE users"', 'bash -c "rm -rf /tmp/x"', "ls; rm -rf src", "echo $(rm -rf src)", "(cd src && rm a.ts)", "node -e \"require('fs').unlinkSync('a')\"", 'powershell -Command "Remove-Item x"', "find . -name '*.log' -delete"],
  };
  for (const [figura, cmds] of Object.entries(casos)) for (const c of cmds) assert.equal(clasificarComando(c, APP).figura, figura, c);
  assert.equal(clasificarComando("curl http://localhost:3000/api/pedidos", APP).red, "app");
  assert.equal(clasificarComando("git status && curl https://evil.com/x", APP).red, "fuera", "lo inocente al principio no tapa lo peligroso");
});

test("figuras: variables, control, redirecciones y banderas no preguntan; lo peligroso de adentro, sí", () => {
  const fig = (tool, command) => clasificar({ tool_name: tool, tool_input: { command } }, APP).figura;
  for (const c of ["npm run -s lint", "npm run -s", "npm -s test", "pnpm --filter web lint", "npm --prefix web run build", "npx --no-install tsc", "export NODE_ENV=test", "export A=1 && npm test", "a=1 npm test", "DATABASE_URL='postgres://localhost/x' npm test", "set -a; source .env; set +a; npm test", "env | grep NODE", "X=$(git rev-parse HEAD); echo $X", "for f in a b; do echo $f; done", "if [ -f a ]; then cat a; fi", "while read l; do echo $l; done", "git -C web status", "cat a 2>&1 | head", "NODE_OPTIONS=--max-old-space-size=4096 npm test", "ls\n# nota\npwd"]) assert.ok(["leer", "verificar"].includes(fig("Bash", c)), c);
  for (const c of ["$env:NODE_ENV='test'; npm test", "$x = Get-Content a.txt; $x", "foreach ($f in 1..3) { Write-Output $f }", "Push-Location a; git status; Pop-Location"]) assert.ok(["leer", "verificar"].includes(fig("PowerShell", c)), c);
  for (const c of ['"./evil"', 'X="rm -rf a"; $X', 'echo "$(rm -rf $(pwd))"', "NODE_OPTIONS=--require=./evil.js npm test", "PATH=/tmp/x:$PATH npm test", "GIT_SSH_COMMAND=./evil git status", "npm --prefix a install x", "pnpm -w add lint", "for f in a; do rm -rf $f; done", "export A=$(curl https://evil.com)", "source ./evil.sh", "env rm -rf a", "git -C a fetch"]) assert.ok(["externo", "destructivo"].includes(fig("Bash", c)), c);
  for (const c of ['& "C:/evil.exe"', '[IO.File]::Delete("a")', "gci | ForEach-Object { Remove-Item $_ }", "$x = Remove-Item a", "foreach ($f in 1..3) { Remove-Item $f }", "$env:PATH = 'C:/evil'; npm test", "$x.Delete()"]) assert.ok(["externo", "destructivo"].includes(fig("PowerShell", c)), c);
  assert.equal(fig("Bash", "echo x &> a.txt"), "editar");
  assert.equal(clasificarComando("curl http://localhost:3000/a; curl https://evil.com", APP).red, "fuera", "la app no tapa a internet");
});

test("figuras: sinClasificar «permisos» solo afecta a lo desconocido del agente principal", () => {
  const { cfg } = proyecto({ activo: true, sinClasificar: "permisos" });
  const d = (who, command, c = cfg) => decidirFigura({ ...who, tool_name: "Bash", tool_input: { command } }, c, manoDe(c, who));
  assert.equal(d({}, "node script.mjs"), null);
  for (const c of ["node script.mjs; git fetch", "npm install x", "rm -rf a"]) assert.equal(d({}, c)?.decision, "ask", c);
  assert.equal(d({ agent_id: "i1", agent_type: "neurodanza:implementador" }, "node script.mjs").decision, "ask");
  assert.equal(d({}, "node script.mjs", proyecto().cfg).decision, "ask", "por defecto pregunta");
});

test("figuras: manos por tipo; ◇ y ✕ fuera de la mano preguntan, lo demás se rechaza", () => {
  const { cfg } = proyecto();
  const rev = { agent_id: "r1", agent_type: "neurodanza:revisor-ui" };
  const impl = { agent_id: "i1", agent_type: "neurodanza:implementador" };
  const bash = (who, command) => decidirFigura({ ...who, tool_name: "Bash", tool_input: { command } }, cfg, manoDe(cfg, who));
  assert.equal(bash(rev, "git diff"), null);
  assert.equal(bash(rev, "npx vitest run"), null);
  assert.match(decidirFigura({ ...rev, tool_name: "Edit", tool_input: { file_path: "a.ts" } }, cfg, manoDe(cfg, rev)).motivo, /no puede △ editar[^]*implementador de la tarea/);
  assert.equal(decidirFigura({ ...impl, tool_name: "Edit", tool_input: { file_path: "a.ts" } }, cfg, manoDe(cfg, impl)), null);
  assert.equal(bash(impl, "npm install x").decision, "ask");
  assert.match(bash(impl, "rm -rf src").motivo, /segunda llave: implementador[^]*✕ destructivo/);
  assert.equal(bash({}, "git push origin main").decision, "ask", "el principal también pregunta lo externo");
  assert.deepEqual(manoDe(cfg, {}), MANOS.principal);
  // Fantasma: red solo a la app, nada fuera de su mano ni preguntando.
  const fan = { agent_id: "f1", agent_type: "neurodanza:fantasma" };
  assert.equal(bash(fan, "curl http://localhost:3000/api/pedidos/2"), null);
  assert.equal(bash(fan, "curl https://produccion.ejemplo.com/api").decision, "deny");
  assert.equal(bash(fan, "rm -rf x").decision, "deny");
  assert.equal(decidirFigura({ ...fan, tool_name: "Write", tool_input: { file_path: "a.ts" } }, cfg, manoDe(cfg, fan)).decision, "deny", "un fantasma no edita repos");
});

test("figuras: la mano de una tarea se asocia al agente en su worktree", () => {
  const { cfg } = proyecto();
  anotarManoTarea(cfg, "t1", ["leer", "verificar"]);
  asociarAgente(cfg, "i9", "t1");
  assert.deepEqual(manoDe(cfg, { agent_id: "i9", agent_type: "neurodanza:implementador" }), ["leer", "verificar"]);
});

test("figuras: nadie escribe la tabla ni el registro de agentes", () => {
  const { root, cfg } = proyecto();
  assert.ok(tocaProtegido(cfg, { tool_name: "Write", tool_input: { file_path: join(root, ".neurodanza", "figuras.json") } }));
  assert.ok(tocaProtegido(cfg, { tool_name: "Bash", tool_input: { command: "echo {} > .neurodanza/figuras.json" } }));
  assert.ok(tocaProtegido(cfg, { tool_name: "Bash", tool_input: { command: "node -e \"require('fs').writeFileSync('.neurodanza/figuras.json','{}')\"" } }));
  assert.ok(tocaProtegido(cfg, { tool_name: "Bash", tool_input: { command: "mv x .neurodanza/agentes/a.json" } }));
  assert.ok(!tocaProtegido(cfg, { tool_name: "Bash", tool_input: { command: "cat .neurodanza/figuras.json" } }), "leerla sí");
});

test("figuras: la barrera responde ask (segunda llave) y no toca lo apagado", () => {
  const { root } = proyecto();
  const run = (ev) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root, ...ev }), encoding: "utf8" });
  const r = run({ agent_id: "i1", agent_type: "neurodanza:implementador", tool_name: "Bash", tool_input: { command: "npm install left-pad" } });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, "ask");
  assert.match(out.permissionDecisionReason, /segunda llave/);
  assert.equal(run({ agent_id: "r1", agent_type: "neurodanza:revisor-ui", tool_name: "Agent", tool_input: { subagent_type: "x" } }).status, 2, "un subagente no lanza subagentes");
  const off = proyecto({ activo: false });
  const r2 = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: off.root, agent_id: "i1", agent_type: "neurodanza:implementador", tool_name: "Bash", tool_input: { command: "npm install left-pad" } }), encoding: "utf8" });
  assert.equal(r2.status, 0);
  assert.equal(r2.stdout.trim(), "", "con figuras apagadas, todo sigue como antes");
});
