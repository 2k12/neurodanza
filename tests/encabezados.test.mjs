// app.encabezados: llegan a la app en cada petición por API y no salen de sus hosts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { api } from "../lib/app.mjs";
import { loadConfig, validate } from "../lib/config.mjs";
import { encabezadosApp, erroresEncabezados, pedirApp } from "../lib/encabezados.mjs";
import { peticion } from "../lib/fantasmas.mjs";

const PANEL = fileURLToPath(new URL("../panel/panel.mjs", import.meta.url));

/** App que rechaza todo lo que no traiga X-Empresa. */
function servidor(responder) {
  const vistos = [];
  const srv = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      vistos.push({ url: req.url, metodo: req.method, h: req.headers });
      responder(req, res);
    });
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, vistos, puerto: srv.address().port })));
}
const json = (res, s, b) => {
  res.writeHead(s, { "Content-Type": "application/json" });
  res.end(JSON.stringify(b));
};
const exige = (req, res) => {
  if (req.url === "/login") return json(res, 200, {});
  if (!req.headers["x-empresa"]) return json(res, 400, { message: "falta X-Empresa" });
  if (req.url === "/api/login") return json(res, 200, { accessToken: "t1" });
  if (req.url === "/api/usuarios") return json(res, 201, {});
  json(res, req.headers.authorization === "Bearer t1" ? 200 : 401, { empresa: req.headers["x-empresa"] });
};

function proyecto(url, encabezados, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-enc-"));
  mkdirSync(join(root, ".claude", "personas"), { recursive: true });
  writeFileSync(join(root, ".claude", "personas", "personas.json"), JSON.stringify({ personas: [{ id: "vera", nombre: "Vera", rol: "VENDEDOR" }] }));
  const cuerpo = { email: "admin@x.com", password: "Clave1!" };
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], autoconfigurar: false, app: { urls: [url], ...(encabezados ? { encabezados } : {}) }, panel: { usuarios: { login: { url: "/api/login", cuerpo }, crear: { url: "/api/usuarios", cuerpo: { email: "{email}" } }, email: "p.{id}@x.com", clave: "Clave1!" } }, ...extra }));
  return loadConfig(root);
}

test("encabezados: sin ellos la app rechaza; con ellos, fantasmas, CLI y panel entran", async () => {
  const s = await servidor(exige);
  const url = `http://localhost:${s.puerto}`;
  try {
    await assert.rejects(peticion(proyecto(url), { usuario: "vera", ruta: "/api/x" }), /HTTP 400/);
    const cfg = proyecto(url, { "X-Empresa": "fija" });
    assert.deepEqual(JSON.parse((await peticion(cfg, { usuario: "vera", ruta: "/api/x" })).cuerpo), { empresa: "fija" });
    assert.equal((await api(cfg, { ruta: "/api/x", como: "vera" })).status, 200);
    assert.equal((await api(cfg, { ruta: "/api/x", como: "admin" })).status, 200);
    const porPersona = proyecto(url, { "X-Empresa": "e-{id}" });
    const r = await peticion(porPersona, { usuario: "vera", ruta: "/api/x" });
    assert.deepEqual(JSON.parse(r.cuerpo), { empresa: "e-vera" });
    assert.deepEqual(Object.keys(r.request), ["metodo", "ruta", "usuario", "cuerpo"], "los encabezados no quedan en el resultado");
    assert.equal((await peticion(porPersona, { ruta: "/api/x" })).status, 400, "sin persona no se manda");
    const out = await new Promise((ok) => {
      const h = spawn(process.execPath, [PANEL, "usuarios"], { cwd: cfg.root });
      let t = "";
      h.stdout.on("data", (x) => (t += x));
      h.stderr.on("data", (x) => (t += x));
      h.on("close", () => ok(t));
    });
    assert.match(out, /\+ Vera \(VENDEDOR\) creado/);
  } finally {
    s.srv.close();
    s.srv.closeAllConnections();
  }
});

test("encabezados: una redirección a otro sitio no se los lleva, ni el token", async () => {
  // localhost es de la app; 127.0.0.1 (el mismo equipo, otro host) aquí no.
  const fuera = await servidor((req, res) => json(res, 200, {}));
  const app = await servidor((req, res) => {
    if (req.url === "/propia") return json(res, 200, { ok: true });
    res.writeHead(302, { Location: req.url === "/sale" ? `http://127.0.0.1:${fuera.puerto}/robo` : "/propia" });
    res.end();
  });
  const cfg = proyecto(`http://localhost:${app.puerto}`, { "X-Empresa": "secreta" }, { fantasmas: { hosts: ["localhost"] } });
  const op = { method: "POST", body: "{}", headers: { Authorization: "Bearer t" } };
  try {
    await pedirApp(cfg, new URL(`http://localhost:${app.puerto}/sale`), op);
    assert.equal(fuera.vistos.length, 1);
    assert.equal(fuera.vistos[0].h["x-empresa"], undefined);
    assert.equal(fuera.vistos[0].h.authorization, undefined);
    const r = await pedirApp(cfg, new URL(`http://localhost:${app.puerto}/dentro`), op);
    assert.deepEqual(await r.json(), { ok: true });
    const u = app.vistos.at(-1);
    assert.equal(u.metodo, "GET");
    assert.equal(u.h["x-empresa"], "secreta");
    assert.equal(u.h.authorization, "Bearer t");
  } finally {
    for (const s of [fuera, app]) {
      s.srv.close();
      s.srv.closeAllConnections();
    }
  }
});

test("encabezados: validación y variables de entorno", () => {
  assert.deepEqual(erroresEncabezados(undefined), []);
  assert.match(erroresEncabezados({ authorization: "Bearer x" })[0], /lo pone neurodanza/);
  assert.match(erroresEncabezados({ "mal nombre": "x" })[0], /inválido/);
  assert.match(erroresEncabezados({ "X-A": "a\r\nX-B: b" })[0], /una línea/);
  assert.match(erroresEncabezados({ "X-A": 1 })[0], /una línea/);
  assert.match(erroresEncabezados([])[0], /objeto/);
  const cfg = proyecto("http://localhost:9", { "X-A": "${ND_ENC_PRUEBA}", "X-B": "${ND_ENC_OTRA:-b}" });
  assert.deepEqual(validate(cfg).filter((e) => /encabezados/.test(e)), []);
  assert.throws(() => encabezadosApp(cfg), /falta la variable de entorno ND_ENC_PRUEBA/);
  process.env.ND_ENC_PRUEBA = "a";
  assert.deepEqual(encabezadosApp(cfg), { "X-A": "a", "X-B": "b" });
  delete process.env.ND_ENC_PRUEBA;
});
