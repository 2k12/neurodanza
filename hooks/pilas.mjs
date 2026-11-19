#!/usr/bin/env node
// neurodanza · hook PostToolUse (asíncrono): guarda en la pila del subagente lo que acaba de hacer
// (lectura con el hash del contenido, edición con líneas +/−, comando con su salida si falló, o su línea
// de avance). Solo subagentes (evento con agent_id); el agente principal no tiene pila. No bloquea nada:
// corre con `async: true`. Ver docs/16-no-perder-trabajo.md.
import { readFileSync } from "node:fs";
import { loadConfig } from "../lib/config.mjs";
import { leerTareas } from "../lib/director.mjs";
import { guardarPaso, pasoDe } from "../lib/pilas.mjs";

let event = {};
try {
  event = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
if (!event.agent_id) process.exit(0);
try {
  const cfg = loadConfig(event.cwd ?? process.cwd());
  if (!cfg || cfg.pilas?.activo === false) process.exit(0);
  const paso = pasoDe(cfg, event, Date.now(), leerTareas(cfg));
  if (paso) guardarPaso(cfg, event.agent_id, paso);
} catch {
  /* la pila es una ayuda: nunca rompe la herramienta */
}
