// neurodanza · regresión mecánica: repite sin modelo los recorridos permanentes que el cambio puede tocar (el mapa
// de impacto) y compara cada uno con su última versión aprobada: métricas (clics, tiempo, pasos que dejaron de
// cumplir, errores) y la firma de cada pantalla (título, controles, campos, texto). Solo lo que cambió va a la
// persona dueña del recorrido para que lo juzgue; lo que sigue igual no gasta pasos de modelo. Ver
// docs/23-regresion-mecanica.md.
import { baseAprobada, compararEjecuciones, diferenciasPantalla, ejecutarRecorrido, registrarMemoria, textoDiferencia, textoRegresion } from "./recorridos.mjs";

/** Estado de un recorrido repetido (puro). */
export function estadoDe({ base, regresiones, diferencias }) {
  if (!base) return "primera vez";
  if (regresiones.length) return "regresion";
  if (diferencias.length) return "diferencias";
  return "igual";
}

/** Lo que dice la dueña del recorrido en la ventana, con su estado de la ronda. */
export function mensajeDe(r) {
  const seg = (ms) => `${Math.round(ms / 100) / 10} s`;
  const t = r.totales ? `${r.totales.clics} clics, ${seg(r.totales.ms)}` : "";
  if (r.estado === "igual") return { estado: "Verificando", texto: `✔ Repetí «${r.tarea}»: igual que en la v${r.base.version} (${t}).` };
  if (r.estado === "primera vez") return { estado: "Verificando", texto: `Repetí «${r.tarea}» por primera vez (${t}): queda como base cuando se apruebe.` };
  const lineas = [...r.regresiones.map((x) => x.texto), ...r.diferencias.slice(0, 3).map(textoDiferencia)];
  return { estado: r.estado === "regresion" ? "Con error" : "Con observación", texto: `⚠ «${r.tarea}» cambió frente a la v${r.base.version}: ${lineas.join(" · ")}` };
}

/**
 * Repite los recorridos afectados. `navegadorPara(persona, recorrido)` → navegador con la interfaz de
 * `ejecutarRecorrido` (más `firma()`), y `cerrar?()`; `decir(persona, {estado, texto})` escribe en la ventana.
 * Registra cada ejecución en la memoria (sin aprobar: se aprueba con la ronda). Devuelve los resultados.
 */
export async function repetir(cfg, recorridos, { navegadorPara, version, decir = null, umbrales = cfg.panel?.regresion } = {}) {
  const out = [];
  for (const rec of recorridos) {
    const nav = await navegadorPara(rec.persona, rec);
    let ej;
    try {
      ej = await ejecutarRecorrido(nav, rec);
    } finally {
      await nav.cerrar?.();
    }
    const base = baseAprobada(cfg, rec.id, { excluirVersion: version });
    const entrada = registrarMemoria(cfg, rec, ej, { version, persona: rec.persona, aprobado: false });
    const regresiones = base ? compararEjecuciones(base, entrada, umbrales).map((x) => ({ ...x, texto: textoRegresion(x, rec.tarea, base.version) })) : [];
    const diferencias = base ? diferenciasPantalla(base, entrada) : [];
    const r = { id: rec.id, persona: rec.persona, tarea: rec.tarea, version: String(version ?? ""), base: base ? { version: base.version, fecha: base.fecha } : null, totales: ej.totales, regresiones, diferencias, capturas: ej.pasos.map((p) => p.captura).filter(Boolean) };
    r.estado = estadoDe(r);
    if (decir) await decir(rec.persona, mensajeDe(r));
    out.push(r);
  }
  return out;
}

/** Resumen de una repetición: cuántos iguales y cuáles necesitan a su persona. */
export function resumenRepeticion(resultados, noAfectados = []) {
  const cuenta = (e) => resultados.filter((r) => r.estado === e).length;
  return {
    repetidos: resultados.length,
    iguales: cuenta("igual"),
    primeraVez: cuenta("primera vez"),
    conDiferencias: cuenta("diferencias"),
    conRegresion: cuenta("regresion"),
    noAfectados: noAfectados.length,
    juzgar: resultados.filter((r) => r.estado === "diferencias" || r.estado === "regresion").map((r) => ({ id: r.id, persona: r.persona, estado: r.estado })),
  };
}
