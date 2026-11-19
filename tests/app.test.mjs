// Paso 2: CLI de la app (sesiones, peticiones, verificar) y macros que nacen del uso.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { aceptar, api, borrar, comandoDeMacro, compacto, contarRepetido, credenciales, expandirMacro, leerMacros, normalizar, pistaApp, podar, sugeridas, token, usarMacro, verificar } from "../lib/app.mjs";
import { loadConfig } from "../lib/config.mjs";

const GUARD = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));

/** App falsa con login por token; cuenta los logins. */
function appFalsa() {
  const estado = { logins: 0, validos: new Set() };
  const srv = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => {
      const json = (s, b) => {
        res.writeHead(s, { "Content-Type": "application/json" });
        res.end(JSON.stringify(b));
      };
      if (req.url === "/api/login") {
        const { email, password } = JSON.parse(cuerpo || "{}");
        if (password !== "Clave1!") return json(401, {});
        estado.logins++;
        const t = `t${estado.logins}-${email}`;
        estado.validos.add(t);
        return json(200, { accessToken: t });
      }
      const t = String(req.headers.authorization ?? "").replace("Bearer ", "");
      if (!estado.validos.has(t)) return json(401, { message: "sin sesión" });
      if (req.url === "/api/pedidos") return json(200, Array.from({ length: 3 }, (_, i) => ({ id: i + 1, quien: t.split("-")[1] })));
      json(404, {});
    });
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, estado, url: `http://localhost:${srv.address().port}` })));
}

function proyecto(url = "http://localhost:9", extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-app-"));
  mkdirSync(join(root, ".claude", "personas"), { recursive: true });
  writeFileSync(join(root, ".claude", "personas", "personas.json"), JSON.stringify({ personas: [{ id: "vera", nombre: "Vera", rol: "VENDEDOR" }, { id: "olga", nombre: "Olga", rol: "OWNER" }] }));
  writeFileSync(
    join(root, "neurodanza.config.json"),
    JSON.stringify({
      repos: [{ nombre: "api", ruta: "." , lint: 'node -e "process.exit(0)"', tipos: 'node -e "console.log(4242);process.exit(2)"', relacionadas: 'node -e "process.exit(0)" {archivos}' }],
      autoconfigurar: false,
      app: { urls: [url] },
      panel: { usuarios: { login: { url: "/api/login", cuerpo: { email: "admin@x.com", password: "Clave1!" }, token: "accessToken" }, email: "persona.{id}@x.com", clave: "Clave1!", propietario: { rol: "OWNER" } } },
      ...extra,
    }),
  );
  return loadConfig(root);
}

test("app: credenciales por id, por rol, del propietario y del admin", () => {
  const cfg = proyecto();
  assert.equal(credenciales(cfg, "vera").vars.email, "persona.vera@x.com");
  assert.equal(credenciales(cfg, "vendedor").quien, "vera");
  assert.equal(credenciales(cfg, "olga").propietario, true);
  assert.equal(credenciales(cfg, "admin").quien, "admin");
  assert.throws(() => credenciales(cfg, "nadie"), /no hay una persona/);
});

test("app: la sesión queda en caché y se renueva sola si la app la rechaza (401)", async () => {
  const a = await appFalsa();
  try {
    const cfg = proyecto(a.url);
    const r1 = await api(cfg, { ruta: "/api/pedidos", como: "vendedor" });
    assert.equal(r1.status, 200);
    assert.match(r1.texto, /persona\.vera@x\.com/);
    await api(cfg, { ruta: "/api/pedidos", como: "vendedor" });
    assert.equal(a.estado.logins, 1, "la segunda petición usa la sesión en caché");
    a.estado.validos.clear();
    const r3 = await api(cfg, { ruta: "/api/pedidos", como: "vendedor" });
    assert.equal(r3.status, 200);
    assert.equal(a.estado.logins, 2, "con 401 vuelve a entrar una vez");
    const vencida = await token(cfg, "vendedor", { ahora: Date.now() + 11 * 60_000 });
    assert.equal(vencida.cache, false, "pasado cli.sesionMin entra de nuevo");
  } finally {
    a.srv.close();
  }
});

test("app: solo pide a hosts de la app", async () => {
  const cfg = proyecto("http://localhost:9");
  await assert.rejects(api(cfg, { ruta: "https://ejemplo.com/x" }), /host no permitido/);
});

test("app: salida compacta (lista en una línea por elemento, recortada)", () => {
  assert.equal(compacto({ status: 200, texto: '[{"a":1},{"a":2}]' }), 'HTTP 200\n2 elementos\n{"a":1}\n{"a":2}');
  assert.match(compacto({ status: 200, texto: "x".repeat(50) }, 10), /40 caracteres más/);
});

test("app: verificar corre lint, tipos y pruebas en paralelo y solo muestra lo que falla", async () => {
  const cfg = proyecto();
  const r = await verificar(cfg, "api", ["a.ts"]);
  assert.equal(r.ok, false);
  assert.match(r.texto, /✔ lint .* · ✖ tipos .* · ✔ pruebas/);
  assert.match(r.texto, /── tipos\n4242/);
});

test("macros: un comando largo repetido se propone a la tercera vez (los números no lo hacen distinto)", () => {
  const cfg = proyecto();
  const largo = (n) => `node -e "const id=${n};" ${"&& echo listo ".repeat(20)}`;
  assert.equal(normalizar(largo(1)), normalizar(largo(2)));
  assert.equal(contarRepetido(cfg, largo(1)), null);
  assert.equal(contarRepetido(cfg, largo(2)), null);
  assert.match(contarRepetido(cfg, largo(3)), /ya se escribió 3 veces/);
  assert.equal(contarRepetido(cfg, largo(4)), null, "se avisa una sola vez");
  assert.equal(contarRepetido(cfg, "echo corto"), null);
  assert.equal(sugeridas(cfg).length, 1);
});

test("macros: aceptar con variables, usar, juzgar el comando real, podar y borrar", () => {
  const cfg = proyecto();
  const [s] = (() => {
    for (let i = 0; i < 3; i++) contarRepetido(cfg, `psql -c "select * from pedidos where id = ${i}" ${"--quiet ".repeat(30)}`);
    return sugeridas(cfg);
  })();
  const m = aceptar(cfg, { id: s.id, nombre: "pedido", descripcion: "Un pedido por id", comando: 'psql -c "select * from pedidos where id = {id}"' });
  assert.equal(m.usos, 0);
  assert.equal(sugeridas(cfg).length, 0, "lo aceptado ya no se propone");
  assert.throws(() => expandirMacro(m, {}), /--id <valor>/);
  assert.equal(expandirMacro(m, { id: "7" }), 'psql -c "select * from pedidos where id = 7"');
  assert.equal(comandoDeMacro(cfg, 'node "C:/x/lib/app.mjs" macro pedido --id 7'), 'psql -c "select * from pedidos where id = 7"');
  usarMacro(cfg, "pedido", Date.parse("2026-01-01"));
  assert.equal(leerMacros(cfg).macros.pedido.usos, 1);
  assert.deepEqual(podar(cfg, Date.parse("2026-03-15")).map((x) => x.nombre), ["pedido"]);
  assert.deepEqual(podar(cfg, Date.parse("2026-01-10")), []);
  borrar(cfg, "pedido");
  assert.deepEqual(leerMacros(cfg).macros, {});
});

test("pista: un login a mano contra la app sugiere la CLI, una vez por agente", () => {
  const cfg = proyecto("http://localhost:3000");
  const ev = (cmd, agent_id) => ({ session_id: "s", agent_id, tool_input: { command: cmd } });
  const mano = `node -e "fetch('http://localhost:3000/api/login',{method:'POST'}).then(r=>r.json()).then(j=>fetch('http://localhost:3000/api/x',{headers:{Authorization:'Bearer '+j.accessToken}}))"`;
  assert.match(pistaApp(cfg, ev(mano, "a1")), /app\.mjs" api <METODO>/);
  assert.equal(pistaApp(cfg, ev(mano, "a1")), null);
  assert.ok(pistaApp(cfg, ev(mano, "a2")));
  assert.equal(pistaApp(cfg, ev("curl https://ejemplo.com/login", "a3")), null, "otro host: sin pista");
});

const guard = (root, evento) =>
  new Promise((res) => {
    const p = spawn(process.execPath, [GUARD], { cwd: root });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => res({ code, out, err }));
    p.stdin.end(JSON.stringify({ cwd: root, session_id: "s", ...evento }));
  });

test("barrera: una macro se juzga por lo que corre, y guardarla o borrarla lo decide el usuario", async () => {
  const cfg = proyecto();
  aceptar(cfg, { nombre: "limpiar", comando: "rm -rf /" });
  aceptar(cfg, { nombre: "listar", comando: "ls" });
  const app = fileURLToPath(new URL("../lib/app.mjs", import.meta.url)).replace(/\\/g, "/");
  const mala = await guard(cfg.root, { tool_name: "Bash", tool_input: { command: `node "${app}" macro limpiar` } });
  assert.equal(mala.code, 2);
  assert.match(mala.err, /rm -rf/);
  const buena = await guard(cfg.root, { tool_name: "Bash", tool_input: { command: `node "${app}" macro listar` } });
  assert.equal(buena.code, 0);
  const guardar = await guard(cfg.root, { tool_name: "Bash", tool_input: { command: `node "${app}" aceptar --id abc --nombre x` } });
  assert.equal(JSON.parse(guardar.out).hookSpecificOutput.permissionDecision, "ask");
});
