// neurodanza · banco de la revisión en el Stop con lectura (evals/revision.mjs). Un proyecto de dos repos (api y web)
// y cambios cuyo error solo se ve mirando fuera del diff: el otro lado del contrato, la función que se llama, la
// guardia que se usa. Los limpios se parecen a los errores, pero el contexto confirma que están bien.

export const BASE = {
  "api/src/pedidos/pedidos.repo.ts": `import { db } from "../db";
// Toda consulta de pedidos va filtrada por empresa, salvo las de soporte interno.
export const pedidosRepo = {
  porEstadoEmpresa: (estado: string, empresaId: number) => db.pedidos.findMany({ where: { estado, empresaId }, take: 50 }),
  // Solo para el panel de soporte interno: ve todas las empresas.
  porEstadoGlobal: (estado: string) => db.pedidos.findMany({ where: { estado }, take: 50 }),
  porId: (id: number, empresaId: number) => db.pedidos.findFirst({ where: { id, empresaId } }),
  borrar: (id: number, empresaId: number) => db.pedidos.deleteMany({ where: { id, empresaId } }),
};
// Consultas compartidas con el job nocturno de conciliación (recorre todas las empresas).
export const consultas = {
  buscar: (estado: string) => db.pedidos.findMany({ where: { estado }, take: 50 }),
  vigentes: (estado: string, empresaId: number) => db.pedidos.findMany({ where: { estado, empresaId, borrado: false }, take: 50 }),
};
`,
  "api/src/pedidos/pedidos.controller.ts": `import { consultas, pedidosRepo } from "./pedidos.repo";
import { soloAdmin, logueado, operador } from "../auth/guardias";
import { validarPagina } from "./pedidos.validacion";

export async function listar(req, res) {
  const { limite } = validarPagina(req.query);
  const items = await pedidosRepo.porEstadoEmpresa(String(req.query.estado ?? "pendiente"), req.usuario.empresaId);
  res.json(items.slice(0, limite).map((p) => ({ id: p.id, cliente: p.cliente, total: p.total, estado: p.estado })));
}

export async function detalle(req, res) {
  const p = await pedidosRepo.porId(Number(req.params.id), req.usuario.empresaId);
  if (!p) return res.status(404).json({ error: "no existe" });
  res.json({ id: p.id, cliente: p.cliente, total: p.total, estado: p.estado });
}

export const rutas = [
  { metodo: "get", ruta: "/pedidos", guardia: logueado, accion: listar },
  { metodo: "get", ruta: "/pedidos/:id", guardia: logueado, accion: detalle },
];
`,
  "api/src/pedidos/pedidos.validacion.ts": `export const ESTADOS = ["pendiente", "pagado", "cancelado"] as const;
export const MAX_LIMITE = 100;
export function validarPagina(q) {
  const limite = Math.min(Number(q.limite ?? 20), MAX_LIMITE);
  return { limite };
}
`,
  "api/src/auth/guardias.ts": `// logueado: cualquier usuario con sesión, de cualquier rol (incluido "lector").
export const logueado = (u) => !!u;
// soloAdmin: rol admin de la empresa.
export const soloAdmin = (u) => u?.rol === "admin";
// operador: cualquier rol asignado.
export const operador = (u) => !!u?.rol;
`,
  "api/src/db.ts": `export const db: any = globalThis.__db;
`,
  "web/src/pedidos/api.ts": `export async function cargarPedidos(estado: string) {
  const r = await fetch(\`/pedidos?estado=\${estado}&limite=50\`);
  return (await r.json()) as { id: number; cliente: string; total: number; estado: string }[];
}
export async function cargarPedido(id: number) {
  const r = await fetch(\`/pedidos/\${id}\`);
  if (r.status === 404) return null;
  return await r.json();
}
`,
  "web/src/pedidos/Lista.tsx": `import { cargarPedidos } from "./api";
export async function filas(estado: "pendiente" | "pagado" | "cancelado") {
  const ps = await cargarPedidos(estado);
  return ps.map((p) => \`\${p.cliente}: \${p.total.toFixed(2)}\`);
}
`,
};

/** Reemplaza `de` por `a` en un archivo (el cambio del caso). */
const r = (archivo, de, a) => ({ archivo, de, a });

export const CASOS = [
  // Errores que solo se ven con contexto.
  { id: "limite-menor", tipo: "error", revisor: "revisor-coherencia", cambios: [r("api/src/pedidos/pedidos.validacion.ts", "MAX_LIMITE = 100", "MAX_LIMITE = 20")], porque: "web pide limite=50 y ahora recibe 20 sin aviso" },
  { id: "consulta-global", tipo: "error", revisor: "revisor-permisos", cambios: [r("api/src/pedidos/pedidos.controller.ts", "pedidosRepo.porEstadoEmpresa(String(req.query.estado ?? \"pendiente\"), req.usuario.empresaId)", "pedidosRepo.porEstadoGlobal(String(req.query.estado ?? \"pendiente\"))")], porque: "porEstadoGlobal no filtra por empresa (solo soporte interno)" },
  { id: "campo-renombrado", tipo: "error", revisor: "revisor-coherencia", cambios: [r("api/src/pedidos/pedidos.controller.ts", "res.json(items.slice(0, limite).map((p) => ({ id: p.id, cliente: p.cliente, total: p.total, estado: p.estado })));", "res.json(items.slice(0, limite).map((p) => ({ id: p.id, cliente: p.cliente, importe: p.total, estado: p.estado })));")], porque: "web lee p.total" },
  { id: "guardia-abierta", tipo: "error", revisor: "revisor-permisos", cambios: [r("api/src/pedidos/pedidos.controller.ts", "  { metodo: \"get\", ruta: \"/pedidos/:id\", guardia: logueado, accion: detalle },\n", "  { metodo: \"get\", ruta: \"/pedidos/:id\", guardia: logueado, accion: detalle },\n  { metodo: \"delete\", ruta: \"/pedidos/:id\", guardia: logueado, accion: async (req, res) => { await pedidosRepo.borrar(Number(req.params.id), req.usuario.empresaId); res.status(204).end(); } },\n")], porque: "logueado deja borrar a cualquier rol, incluido lector" },
  { id: "estado-quitado", tipo: "error", revisor: "revisor-coherencia", cambios: [r("api/src/pedidos/pedidos.validacion.ts", "[\"pendiente\", \"pagado\", \"cancelado\"]", "[\"pendiente\", \"pagado\", \"anulado\"]")], porque: "web sigue usando cancelado" },
  { id: "codigo-error", tipo: "error", revisor: "revisor-coherencia", cambios: [r("api/src/pedidos/pedidos.controller.ts", "if (!p) return res.status(404).json({ error: \"no existe\" });", "if (!p) return res.status(410).json({ error: \"no existe\" });")], porque: "web solo trata 404" },
  // Difíciles: el nombre no delata nada; solo leyendo la función o la guardia se ve.
  { id: "helper-sin-filtro", tipo: "error", revisor: "revisor-permisos", cambios: [r("api/src/pedidos/pedidos.controller.ts", "pedidosRepo.porEstadoEmpresa(String(req.query.estado ?? \"pendiente\"), req.usuario.empresaId)", "consultas.buscar(String(req.query.estado ?? \"pendiente\"))")], porque: "consultas.buscar no filtra por empresa" },
  { id: "guardia-neutra", tipo: "error", revisor: "revisor-permisos", cambios: [r("api/src/pedidos/pedidos.controller.ts", "  { metodo: \"get\", ruta: \"/pedidos/:id\", guardia: logueado, accion: detalle },\n", "  { metodo: \"get\", ruta: \"/pedidos/:id\", guardia: logueado, accion: detalle },\n  { metodo: \"delete\", ruta: \"/pedidos/:id\", guardia: operador, accion: async (req, res) => { await pedidosRepo.borrar(Number(req.params.id), req.usuario.empresaId); res.status(204).end(); } },\n")], porque: "operador es cualquier rol, incluido lector" },
  { id: "limpio-helper-con-filtro", tipo: "limpio", revisor: "revisor-permisos", cambios: [r("api/src/pedidos/pedidos.controller.ts", "pedidosRepo.porEstadoEmpresa(String(req.query.estado ?? \"pendiente\"), req.usuario.empresaId)", "consultas.vigentes(String(req.query.estado ?? \"pendiente\"), req.usuario.empresaId)")] },
  // Limpios que se parecen: el contexto confirma que están bien.
  { id: "limpio-limite-mayor", tipo: "limpio", revisor: "revisor-coherencia", cambios: [r("api/src/pedidos/pedidos.validacion.ts", "MAX_LIMITE = 100", "MAX_LIMITE = 200")] },
  { id: "limpio-filtro-por-id", tipo: "limpio", revisor: "revisor-permisos", cambios: [r("api/src/pedidos/pedidos.controller.ts", "pedidosRepo.porEstadoEmpresa(String(req.query.estado ?? \"pendiente\"), req.usuario.empresaId)", "pedidosRepo.porEstadoEmpresa(String(req.query.estado || \"pendiente\"), req.usuario.empresaId)")] },
  { id: "limpio-campo-nuevo", tipo: "limpio", revisor: "revisor-coherencia", cambios: [r("api/src/pedidos/pedidos.controller.ts", "res.json({ id: p.id, cliente: p.cliente, total: p.total, estado: p.estado });", "res.json({ id: p.id, cliente: p.cliente, total: p.total, estado: p.estado, moneda: p.moneda ?? \"USD\" });")] },
  { id: "limpio-borrar-admin", tipo: "limpio", revisor: "revisor-permisos", cambios: [r("api/src/pedidos/pedidos.controller.ts", "  { metodo: \"get\", ruta: \"/pedidos/:id\", guardia: logueado, accion: detalle },\n", "  { metodo: \"get\", ruta: \"/pedidos/:id\", guardia: logueado, accion: detalle },\n  { metodo: \"delete\", ruta: \"/pedidos/:id\", guardia: soloAdmin, accion: async (req, res) => { await pedidosRepo.borrar(Number(req.params.id), req.usuario.empresaId); res.status(204).end(); } },\n")] },
];
