// Espera de carga antes de las capturas del panel, con Chromium real. Necesita @playwright/test: lo busca en
// ND_PLAYWRIGHT_DIR (carpeta con node_modules) o en este repo; si no está, la prueba se salta.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { esperarPantalla } from "../panel/panel.mjs";

async function cargarPlaywright() {
  for (const dir of [process.env.ND_PLAYWRIGHT_DIR, process.cwd()].filter(Boolean)) {
    try {
      const mod = await import(pathToFileURL(createRequire(join(dir, "package.json")).resolve("@playwright/test")).href);
      return mod.chromium ? mod : mod.default;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

// Esqueleto que la app cambia por los datos 1,5 s después de cargar la página (sin pedidos de red pendientes:
// `networkidle` ya se cumple con el esqueleto en pantalla).
const PAGINA = (ms, clase) => `<!doctype html><html><body><main>
<div id="lista"><div class="${clase}" style="height:40px;width:300px;background:#ddd">…</div></div>
<script>setTimeout(() => { document.getElementById("lista").innerHTML = "<h1>Pedidos</h1><p>Pedido 7 de Ana</p>"; }, ${ms});</script>
</main></body></html>`;

const pw = await cargarPlaywright();

test("esperarPantalla: no captura con el esqueleto en pantalla; espera a los datos", { skip: !pw && "sin @playwright/test (ND_PLAYWRIGHT_DIR)" }, async () => {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(PAGINA(Number(u.searchParams.get("ms") ?? 1500), u.searchParams.get("clase") ?? "skeleton"));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const web = `http://127.0.0.1:${srv.address().port}`;
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    const texto = () => page.evaluate(() => document.body.innerText);

    // Lo de antes (goto networkidle + 600 ms): la captura sale con el esqueleto.
    await page.goto(`${web}/?ms=1500`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    assert.doesNotMatch(await texto(), /Pedido 7/);

    // Con la espera: los datos ya están.
    await page.goto(`${web}/?ms=1500`, { waitUntil: "load" });
    assert.equal(await esperarPantalla(page), true);
    assert.match(await texto(), /Pedido 7 de Ana/);

    // Sin indicador conocido, igual espera a que el DOM quede quieto (cambio a los 300 ms, quieto 400 ms).
    await page.goto(`${web}/?ms=300&clase=x`, { waitUntil: "load" });
    assert.equal(await esperarPantalla(page), true);
    assert.match(await texto(), /Pedido 7 de Ana/);

    // Un indicador que no se va: respeta el tope y lo dice (false).
    await page.goto(`${web}/?ms=999999&clase=animate-spin`, { waitUntil: "load" });
    const t0 = Date.now();
    assert.equal(await esperarPantalla(page, { maxSeg: 1.5 }), false);
    assert.ok(Date.now() - t0 < 4000);

    // Selector propio del proyecto (panel.carga.cargando).
    await page.goto(`${web}/?ms=1200&clase=mi-cargador`, { waitUntil: "load" });
    assert.equal(await esperarPantalla(page, { cargando: [".mi-cargador"], quietoMs: 0 }), true);
    assert.match(await texto(), /Pedido 7 de Ana/);
  } finally {
    await browser.close();
    srv.close();
  }
});
