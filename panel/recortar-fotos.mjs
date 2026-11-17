#!/usr/bin/env node
// neurodanza · recorta las fotos de las personas al rostro y el cuello y las guarda como
// <panel.fotos>/<nombre>.png (256 px). Las cajas [x, y, lado] están en `fotos.json`, junto al
// elenco (versionado); las fotos NO van a git. Sin caja: recorte cuadrado centrado arriba.
// Uso: node recortar-fotos.mjs --origen <carpeta con ana.webp, bruno.jpg…>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.mjs";

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const cfg = loadConfig(process.cwd());
if (!cfg) {
  console.error("No hay neurodanza.config.json (corre /neurodanza-init).");
  process.exit(2);
}
const i = process.argv.indexOf("--origen");
const origen = i > 0 ? resolve(process.argv[i + 1]) : null;
if (!origen || !existsSync(origen)) {
  console.error("Uso: node recortar-fotos.mjs --origen <carpeta>");
  process.exit(2);
}
const out = cfg.abs(cfg.panel.fotos);
const boxesFile = join(dirname(cfg.abs(cfg.panel.elenco)), "fotos.json");
const recortes = existsSync(boxesFile) ? (JSON.parse(readFileSync(boxesFile, "utf8")).recortes ?? {}) : {};
mkdirSync(out, { recursive: true });

let pw;
for (const dir of [cfg.root, ...cfg.repos.map((r) => cfg.abs(r.ruta))]) {
  try {
    const mod = await import(pathToFileURL(createRequire(join(dir, "package.json")).resolve("@playwright/test")).href);
    pw = mod.chromium ? mod : mod.default;
    break;
  } catch {
    continue;
  }
}
if (!pw) {
  console.error("Necesito @playwright/test en el proyecto para recortar las fotos.");
  process.exit(2);
}
const browser = await pw.chromium.launch();
const page = await browser.newPage();
let n = 0;
for (const f of readdirSync(origen)) {
  const name = basename(f, extname(f)).toLowerCase();
  const mime = MIME[extname(f).toLowerCase()];
  if (!mime) continue;
  const data = `data:${mime};base64,${readFileSync(join(origen, f)).toString("base64")}`;
  const box = recortes[name] ?? null;
  const png = await page.evaluate(
    async ({ data, box }) => {
      const img = new Image();
      img.src = data;
      await img.decode();
      const side = Math.min(img.width, img.height);
      const [x, y, s] = box ?? [Math.round((img.width - side) / 2), 0, side];
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img, x, y, s, s, 0, 0, 256, 256);
      return c.toDataURL("image/png").split(",")[1];
    },
    { data, box },
  );
  writeFileSync(join(out, `${name}.png`), Buffer.from(png, "base64"));
  console.log(`${name}.png${box ? "" : " (sin caja en fotos.json: recorte centrado arriba)"}`);
  n++;
}
await browser.close();
console.log(`${n} fotos en ${out}`);
