// Paso 2 (velocidad): timeout obligatorio en comandos que pueden no terminar.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, merge } from "../lib/config.mjs";
import { acotado, check } from "../hooks/guardrails.mjs";

const cfg = loadConfig(fileURLToPath(new URL("../ejemplos/nest-next/", import.meta.url)));
const sin = { modo: { activo: false }, tareas: [] };
const bash = (command, extra = {}) => check({ tool_name: "Bash", tool_input: { command, ...extra } }, cfg, undefined, sin);
const ps = (command, extra = {}) => check({ tool_name: "PowerShell", tool_input: { command, ...extra } }, cfg, undefined, sin);

test("comandos largos: servidores, watch y suites sin límite se rechazan con cómo correrlos", () => {
  for (const c of ["npm run dev", "pnpm dev", "next dev", "nest start --watch", "npx vite", "nodemon src/main.ts", "npm start"]) assert.match(bash(c) ?? "", /servidor[^]*app\.levantar[^]*run_in_background: true/, c);
  for (const c of ["tsc -w", "npx tsc --watch", "node --watch src/a.js"]) assert.match(bash(c) ?? "", /modo watch[^]*vitest run|modo watch/, c);
  for (const c of ["npm test", "pnpm run test", "vitest", "npx jest", "npx playwright test"]) assert.match(bash(c) ?? "", /suite completa[^]*timeout: 120000/, c);
  assert.match(ps("npm run dev") ?? "", /servidor/, "también en PowerShell");
});

test("comandos largos: con límite, con filtro o que terminan solos se permiten", () => {
  assert.equal(bash("npm test", { timeout: 120000 }), null, "timeout acotado");
  assert.match(bash("npm test", { timeout: 600000 }) ?? "", /suite/, "un timeout mayor que maxSeg no cuenta");
  assert.equal(bash("npm run dev", { run_in_background: true }), null, "en segundo plano");
  assert.equal(bash("timeout 60 npm test"), null, "envuelto en timeout");
  assert.equal(ps("Start-Job { npm test } | Wait-Job -Timeout 60"), null, "PowerShell con -Timeout");
  for (const c of ["npx vitest run", "npx vitest related --run src/a.ts", "npm test -- src/a.test.ts", "pnpm test src/a", "npx jest --ci", "npx jest src/a.test.ts", "npx playwright test --timeout 60000", "vite build", "npm run build", "grep -w foo a.txt", "git status", 'git commit -m "arregla npm test"'])
    assert.equal(bash(c), null, c);
  assert.ok(acotado("gtimeout -s KILL 30s pnpm test", {}, 120));
});

test("comandos largos: la opción apagada no rechaza nada", () => {
  const off = merge(cfg, { barreras: { timeoutComandos: { activo: false } } });
  assert.equal(check({ tool_name: "Bash", tool_input: { command: "npm run dev" } }, off, undefined, sin), null);
});
