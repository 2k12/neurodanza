// neurodanza · encabezados del proyecto (`app.encabezados`) en las peticiones por API: fantasmas, CLI de la app,
// evidencia de incidencias y usuarios del panel. Solo viajan a hosts de la app. Ver docs/03-configuracion.md.
import { hostsApp } from "./figuras.mjs";

/** Los pone neurodanza (Authorization es la sesión de cada persona) o los calcula Node. */
export const RESERVADOS = ["authorization", "content-type", "content-length", "host", "connection", "transfer-encoding"];

/** Reemplaza {variable} y ${ENTORNO} (con ${ENTORNO:-defecto}) en textos y objetos. */
export const expandir = (v, vars) => (typeof v === "string" ? v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (m, k, d) => process.env[k] ?? d ?? "") : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandir(x, vars)])) : v);

/** Errores de forma de `app.encabezados` (lista vacía = válido). */
export function erroresEncabezados(e) {
  if (e === undefined || e === null) return [];
  if (typeof e !== "object" || Array.isArray(e)) return ["app.encabezados: objeto { nombre: texto }"];
  const out = [];
  for (const [k, v] of Object.entries(e)) {
    if (!/^[\w!#$%&'*+.^`|~-]+$/.test(k)) out.push(`app.encabezados: nombre inválido «${k}»`);
    else if (RESERVADOS.includes(k.toLowerCase())) out.push(`app.encabezados.${k}: lo pone neurodanza, no se puede cambiar`);
    if (typeof v !== "string" || /[\r\n]/.test(v)) out.push(`app.encabezados.${k}: texto de una línea`);
  }
  return out;
}

/**
 * Encabezados para una persona. Los que usan {id}, {rol} o {email} se omiten si no hay persona. Una variable de
 * entorno que falta es un error: mandar el encabezado vacío haría parecer que la app rechaza el ataque.
 */
export function encabezadosApp(cfg, vars = {}) {
  const e = cfg.app?.encabezados ?? {};
  const errores = erroresEncabezados(e);
  if (errores.length) throw new Error(errores.join("; "));
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    const falta = [...v.matchAll(/\$\{(\w+)(:-)?/g)].find((m) => !m[2] && !process.env[m[1]]);
    if (falta) throw new Error(`app.encabezados.${k}: falta la variable de entorno ${falta[1]}`);
    const sinPersona = [...v.matchAll(/(?<!\$)\{(\w+)\}/g)].some((m) => !(m[1] in vars));
    if (!sinPersona) out[k] = expandir(v, vars);
  }
  return out;
}

/**
 * fetch con los encabezados del proyecto. fetch los reenviaría en una redirección a otro sitio, así que aquí las
 * redirecciones se siguen a mano y en cada salto se decide si el destino es de la app.
 */
export async function pedirApp(cfg, url, { headers = {}, ...op } = {}, vars = {}) {
  const extra = encabezadosApp(cfg, vars);
  if (!Object.keys(extra).length) return fetch(url, { ...op, headers });
  const hosts = hostsApp(cfg);
  let u = new URL(url);
  let h = { ...headers };
  let { method = "GET", body } = op;
  for (let saltos = 0; ; saltos++) {
    const propios = hosts.includes(u.hostname.toLowerCase()) ? extra : {};
    const res = await fetch(u, { ...op, method, body, headers: { ...propios, ...h }, redirect: "manual" });
    const destino = [301, 302, 303, 307, 308].includes(res.status) ? res.headers.get("location") : null;
    if (!destino) return res;
    if (saltos >= 10) throw new Error("demasiadas redirecciones");
    await res.body?.cancel();
    const siguiente = new URL(destino, u);
    if (siguiente.origin !== u.origin) h = Object.fromEntries(Object.entries(h).filter(([k]) => k.toLowerCase() !== "authorization"));
    if (res.status === 303 || (res.status < 303 && method === "POST")) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
    }
    u = siguiente;
  }
}
