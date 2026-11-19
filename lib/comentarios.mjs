// neurodanza · comentarios en código JS/TS (barreras.comentarios). La barrera rechaza al editar los comentarios
// NUEVOS que no van, así el agente ni siquiera los escribe (no hay una ronda extra para borrarlos).
//   "basura":   código comentado y TODO/FIXME/XXX/HACK sin ticket.
//   "estricto": todo comentario, salvo directivas, JSDoc con etiquetas de API (@param, @returns…) de lo exportado
//               y `// POR QUÉ: …` (la decisión que el código no puede decir).
// Los comentarios que ya estaban no cuentan. Ver docs/04-barreras.md.

export const EXTENSIONES = /\.(c|m)?(j|t)sx?$/i;
const DIRECTIVA = /^\s*(eslint|@ts-|prettier-ignore|istanbul|c8|v8 ignore|webpackChunkName|webpackPrefetch|#region|#endregion|global\s|jshint|type-coverage|biome-ignore|@vite-ignore|@jsx|@refresh|<reference|@license|@preserve|SPDX-License-Identifier)/i;
const ETIQUETAS_API = /@(param|returns?|throws|deprecated|example|see|template|typedef|type|property|callback)\b/;
const POR_QUE = /^\s*\**\s*(POR QU[ÉE]|WHY)\s*:/i;
const TAREA = /\b(TODO|FIXME|XXX|HACK)\b(?!\(#\d+\))/;
const CODIGO = [
  /^(import|export)\s.+(from\s+['"].+['"]|[{}])\s*;?$/,
  /^(const|let|var)\s+[\w${}[\],\s]+=\s*.+;?$/,
  /^(return|await|throw)\s.+;$/,
  /^(if|for|while|switch)\s*\(.*\)\s*\{?$/,
  /^\}\s*(else\b.*)?\{?$/,
  /^(console|process|this|window|document)\.[\w.]+\(.*\);?$/,
  /^[\w$.[\]]+\s*\(.*\)\s*;$/,
  /^[\w$.[\]]+\s*(=|\+=|-=)\s*[^=].*;$/,
  /^<\/?[A-Z][\w.]*(\s[^>]*)?\/?>$/,
  /^(function|class|interface|type)\s+\w+.*[{=]\s*$/,
];

// Después de estos caracteres (o palabras), una `/` empieza una expresión regular y no una división.
const ANTES_DE_REGEX = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Comentarios de un texto JS/TS: { tipo: "linea"|"bloque", texto, linea, fin } (fin = índice tras el comentario).
 * Salta textos ('', "", `` con ${…}) y expresiones regulares, así `"http://x"` o `/\/\//` no cuentan.
 */
export function comentariosDe(src) {
  const out = [];
  const s = String(src);
  let i = 0;
  let linea = 1;
  let previo = "";
  const pila = [];
  const avanzar = (n) => {
    for (let k = 0; k < n; k++) if (s[i + k] === "\n") linea++;
    i += n;
  };
  while (i < s.length) {
    const c = s[i];
    const d = s[i + 1];
    if (c === "/" && d === "/") {
      const fin = s.indexOf("\n", i);
      const f = fin === -1 ? s.length : fin;
      out.push({ tipo: "linea", texto: s.slice(i + 2, f), linea, inicio: i, fin: f });
      i = f;
      continue;
    }
    if (c === "/" && d === "*") {
      const fin = s.indexOf("*/", i + 2);
      const f = fin === -1 ? s.length : fin + 2;
      out.push({ tipo: "bloque", texto: s.slice(i + 2, fin === -1 ? s.length : fin), linea, inicio: i, fin: f });
      avanzar(f - i);
      continue;
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < s.length && s[k] !== c && s[k] !== "\n") k += s[k] === "\\" ? 2 : 1;
      avanzar(k + 1 - i);
      previo = "x";
      continue;
    }
    if (c === "`") {
      let k = i + 1;
      while (k < s.length && s[k] !== "`") {
        if (s[k] === "\\") k += 2;
        else if (s[k] === "$" && s[k + 1] === "{") {
          pila.push("`");
          k += 2;
          break;
        } else k++;
      }
      if (pila.at(-1) === "`" && s[k - 1] === "{" && s[k - 2] === "$") {
        avanzar(k - i);
        pila[pila.length - 1] = "${";
        previo = "{";
        continue;
      }
      avanzar(k + 1 - i);
      previo = "x";
      continue;
    }
    if (c === "}" && pila.at(-1) === "${") {
      // Vuelve al texto de la plantilla.
      pila.pop();
      let k = i + 1;
      while (k < s.length && s[k] !== "`") {
        if (s[k] === "\\") k += 2;
        else if (s[k] === "$" && s[k + 1] === "{") {
          pila.push("${");
          k += 2;
          break;
        } else k++;
      }
      if (pila.at(-1) === "${" && s[k - 1] === "{" && s[k - 2] === "$") {
        avanzar(k - i);
        previo = "{";
        continue;
      }
      avanzar(k + 1 - i);
      previo = "x";
      continue;
    }
    if (c === "{" && pila.length) pila.push("{");
    else if (c === "}" && pila.at(-1) === "{") pila.pop();
    if (c === "/" && ANTES_DE_REGEX.test(previo.trimEnd())) {
      let k = i + 1;
      let clase = false;
      while (k < s.length && s[k] !== "\n" && (s[k] !== "/" || clase)) {
        if (s[k] === "\\") k++;
        else if (s[k] === "[") clase = true;
        else if (s[k] === "]") clase = false;
        k++;
      }
      if (s[k] === "/") {
        k++;
        while (/[a-z]/i.test(s[k] ?? "")) k++;
        avanzar(k - i);
        previo = "x";
        continue;
      }
    }
    if (!/\s/.test(c)) previo = (previo + c).slice(-12);
    else if (c === "\n") previo = previo.endsWith(" ") ? previo : `${previo} `;
    avanzar(1);
  }
  return out;
}

/** ¿Un JSDoc documenta algo exportado? (lo siguiente tras el comentario empieza con `export`) */
const documentaExport = (src, c) => /^\s*export\b/.test(String(src).slice(c.fin, c.fin + 200));

/** ¿Es código comentado? (alguna línea del comentario parece una instrucción) */
const esCodigo = (c) =>
  c.texto
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
    .filter(Boolean)
    .some((l) => CODIGO.some((re) => re.test(l)));

/**
 * Por qué un comentario no va según el modo, o null si va. `src` = el texto donde está (para ver qué documenta).
 */
export function motivo(c, src, modo) {
  if (!modo) return null;
  if (DIRECTIVA.test(c.texto) || (c.tipo === "linea" && c.texto.startsWith("/"))) return null;
  if (c.inicio === 0 && /^#!/.test(String(src))) return null;
  if (TAREA.test(c.texto)) return "TODO sin ticket (usa `TODO(#123): …`)";
  if (esCodigo(c) && !(c.tipo === "bloque" && c.texto.startsWith("*"))) return "código comentado (git guarda la historia)";
  if (modo !== "estricto") return null;
  if (POR_QUE.test(c.texto)) return null;
  if (c.tipo === "bloque" && c.texto.startsWith("*")) {
    if (!documentaExport(src, c)) return "JSDoc de algo que no se exporta";
    // De lo exportado va el contrato de la API (etiquetas), no la prosa que repite el nombre.
    return ETIQUETAS_API.test(c.texto) ? null : "JSDoc sin etiquetas de API (@param, @returns, @throws, @deprecated, @example)";
  }
  return "comentario explicativo";
}

const clave = (c) => c.texto.replace(/\s+/g, " ").trim();

/**
 * Comentarios nuevos de `despues` (no estaban en `antes`) que no van según el modo. Cada uno con su motivo.
 */
export function comentariosProhibidos(antes, despues, modo) {
  if (!modo) return [];
  const previos = new Map();
  for (const c of comentariosDe(antes ?? "")) previos.set(clave(c), (previos.get(clave(c)) ?? 0) + 1);
  const out = [];
  for (const c of comentariosDe(despues ?? "")) {
    const k = clave(c);
    if (previos.get(k)) {
      previos.set(k, previos.get(k) - 1);
      continue;
    }
    const m = motivo(c, despues, modo);
    if (m) out.push({ ...c, motivo: m });
  }
  return out;
}

/** Texto del rechazo. */
export function textoRechazo(prohibidos, modo) {
  const lista = prohibidos
    .slice(0, 4)
    .map((c) => `línea ${c.linea}: «${(c.tipo === "linea" ? "//" : "/*") + c.texto.replace(/\s+/g, " ").trim().slice(0, 60)}» (${c.motivo})`)
    .join("; ");
  const mas = prohibidos.length > 4 ? ` y ${prohibidos.length - 4} más` : "";
  return modo === "estricto"
    ? `neurodanza: comentarios que no van (barreras.comentarios: estricto): ${lista}${mas}. Quítalos: el código se explica con buenos nombres. Solo van directivas (eslint, @ts-…), JSDoc de lo exportado y \`// POR QUÉ: …\` para una decisión que el código no puede decir.`
    : `neurodanza: comentarios basura: ${lista}${mas}. Quítalos.`;
}
