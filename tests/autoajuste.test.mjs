import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { despuesDelAjuste, escenarioAutoajuste, escribirTranscripts, lineasSesion } from "../bench/transcripts.mjs";
import { aplicar, diario, evaluarAjustes, revertir, textoInicio } from "../lib/autoajuste.mjs";
import { loadConfig } from "../lib/config.mjs";
import { errorConTexto, rechazoDe, recolectar, resumirSesion, slugDe } from "../lib/telemetria.mjs";

const GUARD = fileURLToPath(new URL("../hooks/guardrails.mjs", import.meta.url));

function proyecto(config = {}) {
  const root = mkdtempSync(join(tmpdir(), "nd-auto-"));
  writeFileSync(join(root, "neurodanza.config.json"), JSON.stringify({ repos: [], ...config }, null, 2));
  return { root, cfg: loadConfig(root), trans: join(root, "transcripts") };
}

test("telemetría: rechazos de barrera, cortes y permisos del usuario se distinguen", () => {
  assert.deepEqual(rechazoDe('PreToolUse:Bash hook error: [node "x/guardrails.mjs"]: guardia: no se hace push a main 3 veces'), { motivo: "guardia: no se hace push a main N veces", texto: "guardia: no se hace push a main 3 veces" });
  assert.equal(rechazoDe("<tool_use_error>neurodanza: borra la base</tool_use_error>").motivo, "neurodanza: borra la base");
  assert.equal(rechazoDe("The user doesn't want to proceed with this tool use."), null);
  assert.equal(rechazoDe("Exit code 1\nfalló"), null);
  assert.equal(errorConTexto("<ruta> N <ruta>"), false);
  assert.equal(errorConTexto("eslint: not found en <ruta>"), true);
  assert.equal(slugDe("C:\\Users\\a\\leza"), "C--Users-a-leza");
});

test("telemetría: una sesión cuenta tokens una vez por mensaje, comandos que fallan, rechazos y cortes", () => {
  const ls = lineasSesion({ sesion: "s", inicio: "2026-11-01T10:00:00Z", eventos: [{ cmd: "git status" }, { cmd: "npx eslint src", falla: "eslint: not found", codigo: 127 }, { rechazo: "guardia: no" }, { corte: true }], tokens: { input: 5, output: 100 } });
  const r = resumirSesion(ls);
  assert.equal(r.tokens.salida, 400); // 4 mensajes, cada uno en 2 líneas
  assert.equal(r.comandos.length, 2);
  assert.equal(r.comandos.filter((c) => c.falla).length, 1);
  assert.equal(r.rechazos.length, 1); // el corte no es un rechazo
  assert.equal(r.cortes, 1);
});

test("telemetría: recolecta incremental, con el tipo de cada subagente de su .meta.json", () => {
  const { root, cfg, trans } = proyecto();
  try {
    escribirTranscripts(trans, escenarioAutoajuste().sesiones);
    const a = recolectar(cfg, { carpetas: [trans] });
    assert.equal(a.sesiones, 3);
    assert.equal(a.subagentes, 4);
    assert.ok(a.lista.some((s) => s.agente === "revisor-ui"));
    assert.equal(recolectar(cfg, { carpetas: [trans] }).leidos, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("autoajuste: del escenario sembrado salen la lección, los errores, la macro y las 2 propuestas; del ruido, nada", async () => {
  const esc = escenarioAutoajuste();
  const { root, cfg, trans } = proyecto(esc.config);
  try {
    escribirTranscripts(trans, esc.sesiones);
    const inf = await diario(cfg, { carpetas: [trans] });
    const ids = inf.propuestas.map((p) => p.id).sort();
    assert.deepEqual(ids, [...esc.esperado.propuestas].sort());
    assert.equal(inf.errores > 0, true);
    const errores = JSON.parse(readFileSync(join(root, ".neurodanza", "errores.json"), "utf8")).errores;
    assert.equal(Object.keys(errores).length, esc.esperado.errores);
    assert.equal(inf.macros, esc.esperado.macros);
    const cons = JSON.parse(readFileSync(join(root, ".neurodanza", "constructos", "constructos.json"), "utf8"));
    const ls = cons.constructos.principal.lecciones;
    assert.equal(ls.length, 1);
    assert.equal(ls[0].estado, "a prueba");
    assert.match(ls[0].texto, /push directo a main/);
    // Ni el rechazo suelto ni el corte (un corte no es una regla rota) dan lecciones.
    assert.equal(cons.constructos["revisor-ui"], undefined);
    // Una segunda pasada no vuelve a contar las mismas sesiones.
    const otra = await diario(cfg, { carpetas: [trans] });
    assert.equal(otra.errores, 0);
    assert.equal(JSON.parse(readFileSync(join(root, ".neurodanza", "constructos", "constructos.json"), "utf8")).constructos.principal.lecciones[0].evidencias.length, ls[0].evidencias.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("autoajuste: aplicar un presupuesto cambia la config; después se mantiene si los cortes bajan y se revierte si no", async () => {
  const hoy = Date.now();
  for (const cortes of [false, true]) {
    const esc = escenarioAutoajuste(hoy);
    const { root, cfg, trans } = proyecto(esc.config);
    try {
      escribirTranscripts(trans, esc.sesiones);
      await diario(cfg, { carpetas: [trans], ahora: hoy });
      const fila = aplicar(cfg, "presupuesto:revisor", { ahora: hoy - 2.5 * 86_400_000 });
      assert.equal(fila.de, 300);
      assert.equal(fila.a, 450);
      assert.equal(JSON.parse(readFileSync(cfg.file, "utf8")).ciclo.maxSegundos.revisor, 450);
      escribirTranscripts(trans, despuesDelAjuste(hoy, { cortes }));
      const inf = await diario(loadConfig(root), { carpetas: [trans], ahora: hoy });
      const ev = inf.evaluaciones.find((e) => e.id === "presupuesto:revisor");
      assert.equal(ev.decision, cortes ? "revertir" : "mantener", JSON.stringify(ev));
      // La propuesta aplicada no vuelve a aparecer.
      assert.ok(!inf.propuestas.some((p) => p.id === "presupuesto:revisor"));
      if (cortes) {
        revertir(loadConfig(root), "presupuesto:revisor");
        assert.equal(JSON.parse(readFileSync(cfg.file, "utf8")).ciclo.maxSegundos.revisor, 300);
      }
      assert.match(textoInicio(loadConfig(root), { lanzar: false, ahora: hoy }), cortes ? /no mejoró/ : /propuesta/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("autoajuste: evaluar espera hasta tener sesiones suficientes después del cambio", () => {
  const r = evaluarAjustes({ lista: [] }, [{ id: "presupuesto:revisor", tipo: "presupuesto", estado: "aplicado", fecha: new Date().toISOString() }]);
  assert.equal(r[0].decision, "esperar");
});

test("barrera: aplicar o revertir un ajuste lo pregunta al usuario", () => {
  const { root } = proyecto();
  try {
    mkdirSync(join(root, "x"), { recursive: true });
    const ev = { cwd: root, session_id: "t", tool_name: "Bash", tool_input: { command: 'node "C:/p/lib/autoajuste.mjs" aplicar --id presupuesto:revisor' } };
    const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(ev), encoding: "utf8" });
    assert.match(r.stdout, /"permissionDecision"\s*:\s*"ask"/);
    assert.match(r.stdout, /autoajuste/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
