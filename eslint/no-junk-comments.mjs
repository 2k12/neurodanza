// neurodanza · regla ESLint `neurodanza/no-junk-comments`: barrera contra comentarios basura.
// /neurodanza-init la copia a cada repo (eslint-rules/) y la registra en eslint.config.mjs.
//  - código comentado (líneas que parecen instrucciones, imports, llamadas…)
//  - TODO / FIXME / XXX / HACK sin ticket: se acepta `TODO(#123): …`
//  - atribuciones de IA (Co-Authored-By, «generado por Claude/ChatGPT/Copilot»…)

const DIRECTIVE = /^\s*(eslint|@ts-|prettier-ignore|istanbul|c8|webpackChunkName|#region|#endregion|global\s|jshint|type-coverage)/i;
const TASK = /\b(TODO|FIXME|XXX|HACK)\b(?!\(#\d+\))/;
const AI = /co-authored-by|generated (by|with)\s+(claude|chatgpt|gpt|copilot|an? ai|ai)|generado (por|con)\s+(claude|chatgpt|gpt|copilot|ia|la ia)|\bas an ai\b|anthropic\.com|🤖/i;
const CODE = [
  /^(import|export)\s.+(from\s+['"].+['"]|[{}])\s*;?$/,
  /^(const|let|var)\s+[\w${}\[\],\s]+=\s*.+;?$/,
  /^(return|await|throw)\s.+;$/,
  /^(if|for|while|switch)\s*\(.*\)\s*\{?$/,
  /^\}\s*(else\b.*)?\{?$/,
  /^(console|process|this|window|document)\.[\w.]+\(.*\);?$/,
  /^[\w$.[\]]+\s*\(.*\)\s*;$/,
  /^[\w$.[\]]+\s*(=|\+=|-=)\s*[^=].*;$/,
  /^<\/?[A-Z][\w.]*(\s[^>]*)?\/?>$/,
  /^(function|class|interface|type)\s+\w+.*[{=]\s*$/,
];

/** Partes de un comentario que se revisan como «¿esto es código?» (una por línea). */
function lines(comment) {
  return comment.value
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
    .filter(Boolean);
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Prohíbe código comentado, TODO sin ticket y atribuciones de IA en comentarios" },
    schema: [{ type: "object", properties: { modo: { enum: ["basura", "estricto"] } }, additionalProperties: false }],
    messages: {
      code: "Código comentado: bórralo (git guarda la historia).",
      task: "{{tag}} sin ticket: usa `{{tag}}(#123): …` o resuélvelo ahora.",
      ai: "Atribución de IA en un comentario: no va en el código.",
      estricto: "Comentario: el código se explica con buenos nombres. Solo van directivas, JSDoc con etiquetas de API (@param, @returns…) de lo exportado y `// POR QUÉ: …`.",
    },
  },
  create(context) {
    const source = context.sourceCode ?? context.getSourceCode();
    // Modo estricto (`{ "modo": "estricto" }`): el mismo criterio que la barrera `barreras.comentarios` del plugin.
    const estricto = context.options?.[0]?.modo === "estricto";
    const exportado = (comment) => {
      const t = source.getTokenAfter(comment, { includeComments: false });
      return t?.value === "export";
    };
    const permitidoEstricto = (comment, text) =>
      /^\s*\**\s*(POR QU[ÉE]|WHY)\s*:/i.test(text) ||
      (comment.type === "Block" && text.startsWith("*") && exportado(comment) && /@(param|returns?|throws|deprecated|example|see|template|typedef|type|property|callback)\b/.test(text));
    return {
      Program() {
        for (const comment of source.getAllComments()) {
          const text = comment.value;
          if (comment.type === "Shebang" || DIRECTIVE.test(text) || (comment.type === "Line" && text.startsWith("/"))) continue;
          if (estricto && !AI.test(text) && !TASK.test(text) && !permitidoEstricto(comment, text)) {
            context.report({ loc: comment.loc, messageId: "estricto" });
            continue;
          }
          if (AI.test(text)) {
            context.report({ loc: comment.loc, messageId: "ai" });
            continue;
          }
          const task = TASK.exec(text);
          if (task) {
            context.report({ loc: comment.loc, messageId: "task", data: { tag: task[1] } });
            continue;
          }
          // JSDoc (/** … */) es documentación: los ejemplos de código ahí son válidos.
          if (comment.type === "Block" && text.startsWith("*")) continue;
          if (lines(comment).some((l) => CODE.some((re) => re.test(l)))) {
            context.report({ loc: comment.loc, messageId: "code" });
          }
        }
      },
    };
  },
};

const plugin = { meta: { name: "neurodanza" }, rules: { "no-junk-comments": rule } };
export default plugin;
