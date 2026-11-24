// La documentación sigue al código: comandos, agentes, skills, hooks y enlaces.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const leer = (f) => readFileSync(join(RAIZ, f), "utf8");
const md = (d) => readdirSync(join(RAIZ, d)).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3));
const DOC = leer("docs/26-comandos.md");
const CLIS = ["lib", "panel", "evals"].flatMap((d) => readdirSync(join(RAIZ, d)).filter((n) => n.endsWith(".mjs")).map((n) => `${d}/${n}`)).filter((f) => /process\.argv\[2\]|const \[cmd|const cmd =/.test(leer(f)));

test("docs/26: cada comando de cada CLI", () => {
  const faltan = [];
  for (const f of CLIS) {
    const base = f.split("/").pop();
    const cmds = new Set([...leer(f).matchAll(/(?:\bcmd|process\.argv\[2\]) === "([\w-]+)"/g)].map((m) => m[1]));
    if (cmds.size && !DOC.includes(base)) faltan.push(base);
    const seccion = DOC.split(/^### /m).filter((s) => s.includes(base)).join("\n");
    for (const c of cmds) if (!new RegExp("`(?:" + base.replace(".", "[.]") + " )?" + c + "(?![\\w-])").test(seccion)) faltan.push(`${base} ${c}`);
  }
  assert.deepEqual(faltan, []);
});

test("docs/26: agentes, skills, eventos y cantidades", () => {
  const agentes = md("agents");
  const skills = readdirSync(join(RAIZ, "skills"));
  const { hooks } = JSON.parse(leer("hooks/hooks.json"));
  for (const x of [...agentes, ...skills, ...Object.keys(hooks)]) assert.ok(DOC.includes(`\`${x}\``) || DOC.includes(`\`/${x}\``), `falta ${x}`);
  for (const t of hooks.PreToolUse[0].matcher.split("|")) assert.ok(DOC.includes(`\`${t}\``), `falta ${t}`);
  assert.ok(DOC.includes(`| Agentes | ${agentes.length} |`));
  assert.ok(DOC.includes(`| Comandos \`/\` | ${skills.length + 1} |`));
  assert.ok(DOC.includes(`| Hooks | ${Object.values(hooks).flat().length}, en ${Object.keys(hooks).length} eventos |`));
});

test("los enlaces entre documentos y las referencias a docs/ existen", () => {
  const rotos = [];
  for (const f of ["README.md", ...md("docs").map((n) => `docs/${n}.md`)]) for (const m of leer(f).matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) if (!existsSync(join(RAIZ, dirname(f), m[1]))) rotos.push(`${f} → ${m[1]}`);
  for (const d of ["lib", "hooks", "evals", "panel", "agents"]) for (const n of readdirSync(join(RAIZ, d))) if (/\.(mjs|md)$/.test(n)) for (const m of leer(`${d}/${n}`).matchAll(/docs\/\d\d-[\w-]+\.md/g)) if (!existsSync(join(RAIZ, m[0]))) rotos.push(`${d}/${n} → ${m[0]}`);
  for (const n of md("docs")) if (!leer("README.md").includes(`docs/${n}.md`)) rotos.push(`README sin docs/${n}.md`);
  assert.deepEqual(rotos, []);
});
