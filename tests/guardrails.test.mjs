import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { check, withoutHeredocs, withoutQuotes } from "../hooks/guardrails.mjs";

const EJ = fileURLToPath(new URL("../ejemplos/nest-next/", import.meta.url));
const cfg = loadConfig(EJ);
const ev = (tool_name, tool_input) => ({ tool_name, tool_input });

test("barreras: secretos, rutas protegidas y migraciones", () => {
  assert.match(check(ev("Read", { file_path: join(EJ, "backend", ".env") }), cfg), /secretos/);
  assert.equal(check(ev("Read", { file_path: join(EJ, "backend", ".env.example") }), cfg), null);
  assert.match(check(ev("Edit", { file_path: join(EJ, "backend/src/modules/einvoice/legacy-xml.ts"), new_string: "x" }), cfg), /congelado/);
  const mig = join(EJ, "backend/prisma/migrations/2026_x/migration.sql");
  assert.match(check(ev("Edit", { file_path: mig, new_string: "x" }), cfg, () => true), /migración/);
  assert.equal(check(ev("Write", { file_path: mig, content: "x" }), cfg, () => false), null);
});

test("barreras: comandos (heredoc y comillas no se ejecutan)", () => {
  assert.match(check(ev("Bash", { command: "npx prisma migrate reset --force" }), cfg), /borra/);
  assert.equal(check(ev("Bash", { command: 'echo "prisma migrate reset"' }), cfg), null);
  assert.equal(check(ev("Bash", { command: "cat > a.md <<'EOF'\nprisma migrate reset\nEOF" }), cfg), null);
  assert.match(check(ev("Bash", { command: "rm -rf /c/" }), cfg), /raíz/);
  assert.equal(check(ev("Bash", { command: "rm -rf dist" }), cfg), null);
  assert.equal(withoutQuotes(withoutHeredocs("a 'b' \"c\"")), "a '' ''");
});

test("barreras: firmas de IA en commits y código; archivos exentos", () => {
  assert.match(check(ev("Bash", { command: 'git commit -m "x\n\nCo-Authored-By: A <a@b>"' }), cfg), /atribución/);
  assert.equal(check(ev("Bash", { command: "git commit -m 'feat: x'" }), cfg), null);
  assert.match(check(ev("Write", { file_path: join(EJ, "frontend/a.ts"), content: "// 🤖 Generated with Claude Code" }), cfg), /IA/);
  assert.equal(check(ev("Write", { file_path: join(EJ, "frontend/.claude/hooks/guardrails.mjs"), content: "Co-Authored-By:" }), cfg), null);
});

test("barreras: cualquier .env* por la terminal salvo los permitidos", () => {
  assert.match(check(ev("Bash", { command: "cat backend/.env.staging" }), cfg), /secretos/);
  assert.equal(check(ev("Bash", { command: "cat backend/.env.example" }), cfg), null);
});
