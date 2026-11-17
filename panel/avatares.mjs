#!/usr/bin/env node
// neurodanza · avatares dibujados de respaldo (cuando una persona no tiene foto): <elenco>/avatars/<id>.svg
// y <id>.png (256 px; la ventana de Windows no dibuja SVG). Los rasgos salen del id (siempre iguales).
// Uso: node avatares.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../lib/config.mjs";

const SKINS = ["#f1c3a1", "#e8b796", "#e2ad8b", "#dcae8e", "#d9a07a", "#c68b63", "#b97a56", "#a8694a"];
const HAIRS = ["#111827", "#1f2937", "#374151", "#3b2416", "#7c2d12", "#9ca3af", "#e5e7eb"];
const STYLES = ["short", "long", "bob", "bun", "braid", "cap", "bald"];
const EXTRAS = ["none", "earrings", "beard", "mustache", "hat", "none"];

/** Número estable a partir de un texto. */
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Rasgos del avatar (piel, cabello, peinado, lentes, accesorio) derivados del id. */
export function lookFor(p) {
  const h = hash(p.id);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >> 3) % HAIRS.length],
    style: STYLES[(h >> 6) % STYLES.length],
    glasses: ((h >> 9) & 1) === 1,
    extra: EXTRAS[(h >> 10) % EXTRAS.length],
  };
}

function hairBack(l) {
  if (l.style === "long") return `<path d="M58 118 Q56 60 128 52 Q200 60 198 118 L204 196 Q170 214 128 212 Q86 214 52 196 Z" fill="${l.hair}"/>`;
  if (l.style === "braid") return `<path d="M176 120 Q196 160 184 206" stroke="${l.hair}" stroke-width="18" fill="none" stroke-linecap="round"/>`;
  if (l.style === "bun") return `<circle cx="128" cy="50" r="24" fill="${l.hair}"/>`;
  if (l.style === "bob") return `<path d="M66 126 Q60 62 128 56 Q196 62 190 126 L192 162 Q160 150 128 150 Q96 150 64 162 Z" fill="${l.hair}"/>`;
  return "";
}

function hairFront(l) {
  switch (l.style) {
    case "short":
      return `<path d="M78 106 Q80 62 128 60 Q176 62 178 106 Q160 84 128 84 Q96 84 78 106 Z" fill="${l.hair}"/>`;
    case "cap":
      return `<path d="M74 104 Q78 58 128 56 Q178 58 182 104 Z" fill="#1d4ed8"/><path d="M128 100 L196 104 Q198 112 184 112 L128 108 Z" fill="#1e40af"/>`;
    case "bald":
      return `<path d="M80 116 Q78 100 86 96 M176 116 Q178 100 170 96" stroke="${l.hair}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    default:
      return `<path d="M76 112 Q78 62 128 60 Q178 62 180 112 Q150 80 104 92 Q88 98 76 112 Z" fill="${l.hair}"/>`;
  }
}

function extras(l) {
  const parts = [];
  if (l.extra === "beard") parts.push(`<path d="M88 150 Q90 196 128 200 Q166 196 168 150 Q150 170 128 170 Q106 170 88 150 Z" fill="${l.hair}"/>`);
  if (l.extra === "mustache") parts.push(`<path d="M106 156 Q128 146 150 156 Q128 160 106 156 Z" fill="${l.hair}"/>`);
  if (l.extra === "earrings") parts.push(`<circle cx="80" cy="150" r="5" fill="#facc15"/><circle cx="176" cy="150" r="5" fill="#facc15"/>`);
  if (l.extra === "hat") parts.push(`<ellipse cx="128" cy="74" rx="78" ry="14" fill="#a16207"/><path d="M90 74 Q92 34 128 32 Q164 34 166 74 Z" fill="#ca8a04"/>`);
  return parts.join("");
}

export function avatarSvg(p) {
  const l = lookFor(p);
  const glasses = l.glasses
    ? `<g fill="none" stroke="#1f2937" stroke-width="4"><circle cx="108" cy="128" r="14"/><circle cx="148" cy="128" r="14"/><path d="M122 128 h12"/></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs><clipPath id="c"><circle cx="128" cy="128" r="128"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="256" height="256" fill="${p.color}"/>
    <circle cx="128" cy="128" r="128" fill="#ffffff" opacity="0.12"/>
    ${hairBack(l)}
    <path d="M52 256 Q56 200 128 196 Q200 200 204 256 Z" fill="#f8fafc" opacity="0.92"/>
    <path d="M110 176 h36 v26 q-18 10 -36 0 Z" fill="${l.skin}"/>
    <ellipse cx="128" cy="128" rx="50" ry="58" fill="${l.skin}"/>
    <ellipse cx="78" cy="132" rx="8" ry="12" fill="${l.skin}"/><ellipse cx="178" cy="132" rx="8" ry="12" fill="${l.skin}"/>
    ${hairFront(l)}
    <circle cx="108" cy="128" r="5" fill="#1f2937"/><circle cx="148" cy="128" r="5" fill="#1f2937"/>
    <path d="M100 112 q8 -6 16 0 M140 112 q8 -6 16 0" stroke="#1f2937" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>
    ${glasses}
    <path d="M110 162 Q128 176 146 162" stroke="#7f1d1d" stroke-width="4" fill="none" stroke-linecap="round"/>
    ${extras(l)}
  </g>
</svg>
`;
}


if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig(process.cwd());
  if (!cfg) {
    console.error("No hay neurodanza.config.json (corre /neurodanza-init).");
    process.exit(2);
  }
  const elenco = cfg.abs(cfg.panel.elenco);
  const out = join(dirname(elenco), "avatars");
  const { personas } = JSON.parse(readFileSync(elenco, "utf8"));
  mkdirSync(out, { recursive: true });
  for (const p of personas) writeFileSync(join(out, `${p.id}.svg`), avatarSvg(p));
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
    console.log(`${personas.length} avatares SVG en ${out} (sin @playwright/test no se generan los PNG de la ventana)`);
    process.exit(0);
  }
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  for (const p of personas) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${avatarSvg(p)}</body></html>`);
    await page.locator("svg").screenshot({ path: join(out, `${p.id}.png`), omitBackground: true });
  }
  await browser.close();
  console.log(`avatares: ${personas.length} (svg + png) en ${out}`);
}
