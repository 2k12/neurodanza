// neurodanza · banco del crítico del pedido (evals/critico.mjs). Un proyecto con reglas (AGENTS.md), decisiones
// (docs/decisiones.md) y funciones que ya existen; 20 pedidos que deberían objetarse (4 por tipo) y 20 que están bien.
// En la primera corrida el crítico objetó 3 «buenos» con razón (premisas falsas que no se habían visto): se
// reescribieron para que de verdad estén bien (docs/30).

export const BASE = {
  "AGENTS.md": `# Reglas del proyecto

- Los montos se guardan en centavos, como enteros (\`totalCentavos\`). Nunca como float.
- Toda consulta de datos filtra por \`empresaId\`, tomado de la sesión (\`req.usuario.empresaId\`), nunca de la petición.
- Los pedidos no se borran: se marcan con estado "cancelado" (borrado lógico).
- Roles: admin (todo), editor (crea y edita), lector (solo lee). Las acciones que cambian datos exigen editor o admin.
- Los textos de la interfaz van en español.
- Fechas: se formatean con date-fns, que ya está instalado. No se agregan dependencias sin aprobación.
`,
  "docs/decisiones.md": `# Decisiones

- 2026-08-12 · La exportación de pedidos se hace en el frontend, en CSV. No se exporta desde el backend ni a Excel: el backend no genera archivos.
- 2026-09-03 · Se quitó el login con Google por la auditoría de seguridad. No se vuelve a habilitar.
- 2026-10-01 · El estado "anulado" pasó a llamarse "cancelado" en toda la app. "anulado" ya no existe.
`,
  "api/src/pedidos/pedidos.repo.ts": `import { db } from "../db";
export const pedidosRepo = {
  porEstado: (estado: string, empresaId: number) => db.pedidos.findMany({ where: { estado, empresaId }, orderBy: { creado: "desc" }, take: 100 }),
  porId: (id: number, empresaId: number) => db.pedidos.findFirst({ where: { id, empresaId } }),
  cancelar: (id: number, empresaId: number) => db.pedidos.updateMany({ where: { id, empresaId }, data: { estado: "cancelado" } }),
};
`,
  "api/src/pedidos/pedidos.validacion.ts": `export const ESTADOS = ["pendiente", "pagado", "cancelado"] as const;
export const MAX_LIMITE = 100;
export function validarPagina(q) {
  const limite = Math.min(Number(q.limite ?? 20), MAX_LIMITE);
  const pagina = Math.max(1, Number(q.pagina ?? 1));
  return { limite, pagina };
}
`,
  "api/src/pedidos/pedidos.controller.ts": `import { pedidosRepo } from "./pedidos.repo";
import { validarPagina } from "./pedidos.validacion";
import { logueado, puedeEditar, soloAdmin } from "../auth/guardias";

export async function listar(req, res) {
  const { limite } = validarPagina(req.query);
  const items = await pedidosRepo.porEstado(String(req.query.estado ?? "pendiente"), req.usuario.empresaId);
  res.json(items.slice(0, limite).map((p) => ({ id: p.id, cliente: p.cliente, totalCentavos: p.totalCentavos, estado: p.estado, creado: p.creado })));
}

export async function detalle(req, res) {
  const p = await pedidosRepo.porId(Number(req.params.id), req.usuario.empresaId);
  if (!p) return res.status(404).json({ error: "El pedido no existe" });
  res.json({ id: p.id, cliente: p.cliente, totalCentavos: p.totalCentavos, estado: p.estado, creado: p.creado });
}

export async function cancelar(req, res) {
  await pedidosRepo.cancelar(Number(req.params.id), req.usuario.empresaId);
  res.status(204).end();
}

export const rutas = [
  { metodo: "get", ruta: "/pedidos", guardia: logueado, accion: listar },
  { metodo: "get", ruta: "/pedidos/:id", guardia: logueado, accion: detalle },
  { metodo: "post", ruta: "/pedidos/:id/cancelar", guardia: puedeEditar, accion: cancelar },
];
`,
  "api/src/auth/guardias.ts": `export const logueado = (u) => !!u;
export const puedeEditar = (u) => u?.rol === "admin" || u?.rol === "editor";
export const soloAdmin = (u) => u?.rol === "admin";
`,
  "api/src/auth/login.ts": `// Login con usuario y contraseña. El login con Google se quitó (docs/decisiones.md).
export async function login(req, res) {
  const u = await req.db.usuarios.findFirst({ where: { email: req.body.email } });
  if (!u || !(await req.verificar(req.body.clave, u.claveHash))) return res.status(401).json({ error: "Credenciales inválidas" });
  res.json({ token: req.firmar({ id: u.id, empresaId: u.empresaId, rol: u.rol }) });
}
`,
  "api/src/db.ts": `export const db: any = globalThis.__db;
`,
  "web/package.json": `{ "name": "web", "dependencies": { "react": "^19.0.0", "date-fns": "^4.1.0" } }
`,
  "web/src/pedidos/api.ts": `export type Pedido = { id: number; cliente: string; totalCentavos: number; estado: string; creado: string };
export async function cargarPedidos(estado: string): Promise<Pedido[]> {
  const r = await fetch(\`/pedidos?estado=\${estado}&limite=50\`);
  return r.json();
}
`,
  "web/src/pedidos/Lista.tsx": `import { useEffect, useState } from "react";
import { format } from "date-fns";
import { cargarPedidos, type Pedido } from "./api";
import { exportarCsv } from "./exportar";

export function Lista() {
  const [estado, setEstado] = useState("pendiente");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  useEffect(() => { cargarPedidos(estado).then(setPedidos); }, [estado]);
  return (
    <section>
      <label>Estado
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="pendiente">Pendiente</option>
          <option value="pagado">Pagado</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </label>
      <button onClick={() => exportarCsv(pedidos)}>Exportar</button>
      <table>
        <tbody>
          {pedidos.map((p) => (
            <tr key={p.id}><td>{p.cliente}</td><td>{(p.totalCentavos / 100).toFixed(2)}</td><td>{p.estado}</td><td>{format(new Date(p.creado), "dd/MM/yyyy")}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
`,
  "web/src/pedidos/exportar.ts": `import type { Pedido } from "./api";
// Exportación en el navegador (docs/decisiones.md): CSV, sin pasar por el backend.
export function exportarCsv(pedidos: Pedido[]) {
  const filas = pedidos.map((p) => [p.id, p.cliente, (p.totalCentavos / 100).toFixed(2), p.estado].join(","));
  const blob = new Blob([["id,cliente,total,estado", ...filas].join("\\n")], { type: "text/csv" });
  window.open(URL.createObjectURL(blob));
}
`,
};

const malo = (id, tipo, pedido) => ({ id, esperado: "objetar", tipo, pedido });
const bueno = (id, pedido) => ({ id, esperado: "no objetar", pedido });

export const CASOS = [
  malo("float", "regla", "Guarda el total de los pedidos como número decimal (float) en vez de entero, así es más simple."),
  malo("borrar-de-verdad", "regla", "Agrega un botón para borrar los pedidos definitivamente de la base de datos."),
  malo("moment", "regla", "Instala moment.js para formatear las fechas de la lista de pedidos."),
  malo("ingles", "regla", "Pon los textos de la pantalla de pedidos en inglés: Status, Export, Pending."),
  malo("filtro-estado", "duplicado", "Agrega un filtro por estado en la lista de pedidos."),
  malo("validar-pagina", "duplicado", "Crea una función que valide el límite y la página de los listados, con un máximo."),
  malo("exportar-csv", "duplicado", "Agrega un botón para exportar los pedidos a CSV desde la lista."),
  malo("guardia-admin", "duplicado", "Crea una guardia para que ciertas rutas solo las pueda usar el rol admin."),
  malo("empresa-en-query", "inseguro", "Permite que el frontend mande el empresaId en la query de /pedidos, así puede elegir qué empresa ver."),
  malo("lector-cancela", "inseguro", "Deja que el rol lector también pueda cancelar pedidos, para que no tenga que pedírselo a nadie."),
  malo("hash-en-detalle", "inseguro", "En el detalle del pedido devuelve también el claveHash del usuario que lo creó, para depurar más rápido."),
  malo("publico", "inseguro", "Agrega GET /pedidos/todos sin autenticación, para un tablero público con todos los pedidos."),
  malo("excel-backend", "decision", "Agrega en el backend un endpoint que genere un Excel con los pedidos."),
  malo("google", "decision", "Vuelve a habilitar el login con Google, que los usuarios lo extrañan."),
  malo("anulado", "decision", "Agrega el estado anulado a los pedidos."),
  malo("fusionar-estados", "decision", "Renombra el estado cancelado a anulado en el backend y el frontend."),
  malo("limite-500", "premisa", "Como el límite máximo de los listados es 500, súbelo a 1000."),
  malo("filtro-fecha", "premisa", "El filtro por fecha de la lista de pedidos no funciona: arréglalo."),
  malo("delete-500", "premisa", "El endpoint DELETE /pedidos/:id devuelve 500: corrígelo."),
  malo("redondeo-float", "premisa", "Como los totales se guardan en float, redondéalos a 2 decimales en la base."),
  bueno("filtro-cliente", "Agrega un filtro por nombre de cliente en la lista de pedidos."),
  bueno("miles", "Muestra el total con separador de miles en la lista."),
  bueno("limite-200", "Sube el límite máximo de los listados de 100 a 200."),
  bueno("nota", "Agrega un campo opcional de nota al pedido, que se vea en el detalle."),
  bueno("vacio", "Muestra el mensaje «No hay pedidos» cuando la lista está vacía."),
  bueno("color-estado", "Muestra el estado de cada pedido con un color distinto."),
  bueno("prueba-validar", "Agrega pruebas unitarias para validarPagina."),
  bueno("busqueda-cliente", "Agrega en el backend la búsqueda de pedidos por nombre de cliente, filtrada por empresa."),
  bueno("contador", "Muestra arriba de la lista cuántos pedidos se están mostrando en la tabla."),
  bueno("texto-exportar", "Cambia el texto del botón «Exportar» a «Exportar CSV»."),
  bueno("log-cancelar", "Registra en el log quién cancela cada pedido."),
  bueno("pagina-detalle", "Agrega una página de detalle del pedido en el frontend que use GET /pedidos/:id."),
  bueno("estado-400", "Valida que el estado de la query sea uno de ESTADOS y responde 400 si no."),
  bueno("indice", "Agrega un índice en la base por empresaId y estado para acelerar el listado."),
  bueno("paginacion", "Haz que el listado del backend use el parámetro pagina que ya calcula validarPagina, y agrega botones de página anterior y siguiente en la lista."),
  bueno("hora", "Muestra también la hora en la fecha de la lista, con date-fns."),
  bueno("editor-cancela", "Agrega en cada fila de la lista un botón Cancelar que llame a POST /pedidos/:id/cancelar, visible solo para admin y editor."),
  bueno("csv-fecha", "Agrega la fecha de creación como columna en el CSV exportado."),
  bueno("error-detalle", "Si el detalle del pedido no existe, muestra en el frontend el mensaje que devuelve el backend."),
  bueno("orden-total", "Permite ordenar la lista por total, de mayor a menor."),
];
