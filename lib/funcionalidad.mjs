#!/usr/bin/env node
// neurodanza · documento de la funcionalidad (idea de ODD): el pedido del usuario TEXTUAL y sus specs, en un
// archivo que leen los subagentes, en vez de un resumen del director. Así las frases exactas («Filtrar por
// estado», un mensaje de error) llegan intactas al implementador, a los revisores y a las personas.
//   node funcionalidad.mjs crear --tema <t> --pedido <archivo o texto> [--riesgo "<texto>"]
//   node funcionalidad.mjs spec --tema <t> --texto "<criterio>"            agrega un S# (los textos entre comillas quedan exactos)
//   node funcionalidad.mjs tarea --tema <t> --id <T1> --specs S1,S2 --texto "<qué>"
//   node funcionalidad.mjs hecha --tema <t> --id <T1> --evidencia "<qué se comprobó>" [--commit <sha>]
//   node funcionalidad.mjs registrar --tema <t> --texto "<corrección, decisión o evidencia>"
//   node funcionalidad.mjs leer --tema <t> [--specs S1,S2]                 hasta «## Registro» (o solo esas specs)
// Ver docs/20-odd-en-neurodanza.md.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { escribirAtomico } from "./procesos.mjs";

export const carpeta = (cfg) => cfg.abs(".neurodanza/funcionalidades");
const slug = (t) => {
  const s = String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!s) throw new Error("--tema es obligatorio (minúsculas y guiones).");
  return s;
};
export const archivo = (cfg, tema) => join(carpeta(cfg), `${slug(tema)}.md`);

/** Frases exactas de un texto: lo que va entre «», “”, "" o `` (de 2 a 200 caracteres). */
export function frasesExactas(texto) {
  const out = [];
  for (const m of String(texto).matchAll(/«([^»]{2,200})»|“([^”]{2,200})”|"([^"\n]{2,200})"|`([^`\n]{2,200})`/g)) {
    const f = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Estructura del documento a partir del markdown (puro). */
export function parsear(md) {
  const sec = (nombre) => {
    const m = String(md).match(new RegExp(`^## ${nombre}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
    return m ? m[1] : "";
  };
  const specs = [...sec("Specs").matchAll(/^- \*\*(S\d+)\*\* (.+)$/gm)].map((m) => ({ id: m[1], texto: m[2] }));
  const tareas = [...sec("Tareas").matchAll(/^- \[( |x)\] \*\*(T[\w-]+)\*\* \(([^)]*)\) (.+?)(?: · (.+))?$/gm)].map((m) => ({ id: m[2], hecha: m[1] === "x", specs: m[3].split(",").map((s) => s.trim()).filter(Boolean), texto: m[4], evidencia: m[5] ?? "" }));
  // Una entrada del registro puede ocupar varias líneas (el pedido textual va citado debajo de L1).
  const registro = sec("Registro")
    .split(/^(?=- \*\*L\d+\*\* )/m)
    .map((b) => b.match(/^- \*\*(L\d+)\*\* ([\s\S]*?)\s*$/))
    .filter(Boolean)
    .map((m) => ({ id: m[1], texto: m[2] }));
  const cabecera = String(md).split(/^## Specs/m)[0];
  return { cabecera, specs, tareas, registro };
}

/** Markdown del documento (puro). El pedido textual va en L1 del registro, y el registro va al final. */
export function componer({ cabecera, specs, tareas, registro }) {
  return [
    cabecera.trimEnd(),
    "",
    "## Specs",
    ...specs.map((s) => `- **${s.id}** ${s.texto}`),
    "",
    "## Tareas",
    ...tareas.map((t) => `- [${t.hecha ? "x" : " "}] **${t.id}** (${t.specs.join(", ")}) ${t.texto}${t.evidencia ? ` · ${t.evidencia}` : ""}`),
    "",
    "## Registro",
    ...registro.map((l) => `- **${l.id}** ${l.texto}`),
    "",
  ].join("\n");
}

const hoy = () => new Date().toISOString().slice(0, 10);
const leer = (cfg, tema) => {
  const f = archivo(cfg, tema);
  if (!existsSync(f)) throw new Error(`no hay documento para «${tema}»: node funcionalidad.mjs crear --tema ${slug(tema)} --pedido …`);
  return parsear(readFileSync(f, "utf8"));
};
const guardar = (cfg, tema, doc) => {
  mkdirSync(carpeta(cfg), { recursive: true });
  escribirAtomico(archivo(cfg, tema), componer(doc));
};

/** Crea el documento: el pedido textual en L1 y una spec por cada frase exacta del pedido. */
export function crear(cfg, { tema, pedido, riesgo = "" }) {
  if (!String(pedido ?? "").trim()) throw new Error("--pedido es obligatorio (archivo o texto, tal cual lo escribió el usuario).");
  if (existsSync(archivo(cfg, tema))) throw new Error(`ya existe ${archivo(cfg, tema)}: agrégale specs o tareas.`);
  const specs = frasesExactas(pedido).map((f, i) => ({ id: `S${i + 1}`, texto: `Texto exacto: «${f}»` }));
  const cabecera = [`# ${slug(tema)}`, "", "Los subagentes leen specs y tareas, y el pedido textual (L1). Las frases entre «» se usan tal cual, sin parafrasear.", riesgo ? `Riesgo: ${riesgo}` : ""].filter((x, i) => x || i < 3).join("\n");
  const doc = { cabecera, specs, tareas: [], registro: [{ id: "L1", texto: `${hoy()} · pedido textual del usuario:\n\n${String(pedido).trim().split(/\r?\n/).map((l) => `  > ${l}`).join("\n")}` }] };
  guardar(cfg, tema, doc);
  return { archivo: archivo(cfg, tema), specs };
}

export function agregarSpec(cfg, { tema, texto }) {
  const doc = leer(cfg, tema);
  const id = `S${doc.specs.length + 1}`;
  doc.specs.push({ id, texto: String(texto).trim() });
  guardar(cfg, tema, doc);
  return id;
}

export function agregarTarea(cfg, { tema, id, specs = [], texto }) {
  const doc = leer(cfg, tema);
  const faltan = specs.filter((s) => !doc.specs.some((x) => x.id === s));
  if (faltan.length) throw new Error(`no existen: ${faltan.join(", ")}.`);
  if (doc.tareas.some((t) => t.id === id)) throw new Error(`ya existe la tarea ${id}.`);
  doc.tareas.push({ id, hecha: false, specs, texto: String(texto).trim(), evidencia: "" });
  guardar(cfg, tema, doc);
}

/** Marca una tarea con la evidencia observada (y el commit que la contiene, si hay). Sin evidencia no se marca. */
export function marcarHecha(cfg, { tema, id, evidencia, commit = "" }) {
  if (!String(evidencia ?? "").trim()) throw new Error("--evidencia es obligatoria: qué se comprobó (comando y resultado).");
  const doc = leer(cfg, tema);
  const t = doc.tareas.find((x) => x.id === id);
  if (!t) throw new Error(`no existe la tarea ${id}.`);
  t.hecha = true;
  t.evidencia = `${String(evidencia).trim()}${commit ? ` (commit ${commit})` : ""}`;
  guardar(cfg, tema, doc);
}

export function registrar(cfg, { tema, texto }) {
  const doc = leer(cfg, tema);
  const id = `L${doc.registro.length + 1}`;
  doc.registro.push({ id, texto: `${hoy()} · ${String(texto).trim()}` });
  guardar(cfg, tema, doc);
  return id;
}

/** Lo que lee un subagente: todo hasta «## Registro», más el pedido textual (L1); o solo las specs pedidas. */
export function paraSubagente(cfg, tema, ids = []) {
  const doc = leer(cfg, tema);
  const specs = ids.length ? doc.specs.filter((s) => ids.includes(s.id)) : doc.specs;
  return [
    `### Funcionalidad · ${slug(tema)} (${archivo(cfg, tema).replace(/\\/g, "/")})`,
    "Pedido del usuario, textual (no lo parafrasees; las frases entre «» van tal cual):",
    doc.registro[0]?.texto.replace(/^[^\n]*\n\n/, "") ?? "",
    ids.length ? `Tus specs (${ids.join(", ")}):` : "Specs:",
    ...specs.map((s) => `- ${s.id}: ${s.texto}`),
    "Al terminar, di qué specs cubriste.",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("No hay neurodanza.config.json aquí ni arriba.");
    process.exit(1);
  }
  const arg = (n) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const lista = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const cmd = process.argv[2];
    const tema = arg("tema");
    if (cmd === "crear") {
      const p = arg("pedido");
      const pedido = p && existsSync(p) ? readFileSync(p, "utf8") : p;
      const r = crear(cfg, { tema, pedido, riesgo: arg("riesgo") ?? "" });
      console.log(`documento: ${r.archivo}\n${r.specs.length} spec${r.specs.length === 1 ? "" : "s"} con frases exactas${r.specs.length ? `: ${r.specs.map((s) => s.id).join(", ")}` : ""}. Agrega los criterios con: node funcionalidad.mjs spec --tema ${slug(tema)} --texto "…"`);
    } else if (cmd === "spec") console.log(agregarSpec(cfg, { tema, texto: arg("texto") }));
    else if (cmd === "tarea") {
      agregarTarea(cfg, { tema, id: arg("id"), specs: lista(arg("specs")), texto: arg("texto") });
      console.log(`tarea ${arg("id")} agregada.`);
    } else if (cmd === "hecha") {
      marcarHecha(cfg, { tema, id: arg("id"), evidencia: arg("evidencia"), commit: arg("commit") ?? "" });
      console.log(`tarea ${arg("id")} hecha.`);
    } else if (cmd === "registrar") console.log(registrar(cfg, { tema, texto: arg("texto") }));
    else if (cmd === "leer") console.log(paraSubagente(cfg, tema, lista(arg("specs"))));
    else {
      console.error("comandos: crear | spec | tarea | hecha | registrar | leer");
      process.exit(1);
    }
  } catch (e) {
    console.error(`funcionalidad: ${e.message}`);
    process.exit(1);
  }
}
