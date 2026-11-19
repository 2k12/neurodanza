#!/usr/bin/env node
// App falsa del banco de pruebas. BENCH_APP=caido: no arranca. BENCH_APP=500: responde 500.
// BENCH_UX=v1|v2: pantallas simuladas (enlaces, campos y listas). En la v2, exportar pedidos pide 2 clics más
// (Más acciones → Opciones de exportación → Exportar).
import { createServer } from "node:http";
const puerto = Number(process.env.BENCH_PUERTO ?? 47613);
if (process.env.BENCH_APP === "caido") {
  console.error("la app no arranca: falta la base de datos");
  process.exit(1);
}
const v2 = process.env.BENCH_UX === "v2";
const a = (href, texto) => `<a href="${href}">${texto}</a>`;
const campo = (l) => `<label>${l}<input name="${l}"></label>`;
const lista = (l, ops) => `<label>${l}<select name="${l}">${ops.map((o) => `<option>${o}</option>`).join("")}</select></label>`;
const P = {
  "/login": "<h1>Ingresar</h1>",
  "/inicio": `<h1>Inicio</h1>${a("/pedidos", "Pedidos")}${a("/clientes", "Clientes")}${a("/productos", "Productos")}${a("/reportes", "Reportes")}${a("/usuarios", "Usuarios")}${a("/configuracion", "Configuración")}`,
  "/pedidos": `<h1>Pedidos</h1>${a("/pedidos/nuevo", "Nuevo pedido")}${a("/pedidos/filtrar", "Filtrar")}${v2 ? a("/pedidos/acciones", "Más acciones") : a("/pedidos/exportar", "Exportar")}${a("/inicio", "Inicio")}`,
  "/pedidos/acciones": `<h1>Acciones</h1>${a("/pedidos/opciones", "Opciones de exportación")}${a("/pedidos", "Volver")}`,
  "/pedidos/opciones": `<h1>Opciones de exportación</h1>${a("/pedidos/exportar", "Exportar")}${a("/pedidos", "Volver")}`,
  "/pedidos/exportar": `<h1>Exportar pedidos</h1>${lista("Formato", ["CSV", "Excel"])}${a("/pedidos/listo", "Descargar")}`,
  "/pedidos/listo": `<h1>Exportación lista</h1>${a("/pedidos", "Volver")}`,
  "/pedidos/nuevo": `<h1>Nuevo pedido</h1>${campo("Cliente")}${campo("Total")}${a("/pedidos/guardado", "Guardar")}`,
  "/pedidos/guardado": `<h1>Pedido guardado</h1>${a("/pedidos", "Volver")}`,
  "/pedidos/filtrar": `<h1>Filtrar</h1>${campo("Desde")}${campo("Hasta")}${a("/pedidos", "Aplicar")}`,
  "/clientes": `<h1>Clientes</h1>${a("/clientes/nuevo", "Nuevo cliente")}${a("/clientes/importar", "Importar")}${a("/inicio", "Inicio")}`,
  "/clientes/nuevo": `<h1>Nuevo cliente</h1>${campo("Nombre")}${a("/clientes", "Guardar")}`,
  "/clientes/importar": `<h1>Importar clientes</h1>${a("/clientes", "Volver")}`,
  "/productos": `<h1>Productos</h1>${a("/productos/nuevo", "Nuevo producto")}${a("/productos/categorias", "Categorías")}${a("/inicio", "Inicio")}`,
  "/productos/nuevo": `<h1>Nuevo producto</h1>${campo("Nombre")}${a("/productos", "Guardar")}`,
  "/productos/categorias": `<h1>Categorías</h1>${a("/productos", "Volver")}`,
  "/reportes": `<h1>Reportes</h1>${a("/reportes/ventas", "Ventas")}${a("/reportes/inventario", "Inventario")}${a("/inicio", "Inicio")}`,
  "/reportes/ventas": `<h1>Ventas</h1>${a("/reportes", "Volver")}`,
  "/reportes/inventario": `<h1>Inventario</h1>${a("/reportes", "Volver")}`,
  "/usuarios": `<h1>Usuarios</h1>${a("/usuarios/invitar", "Invitar")}${a("/inicio", "Inicio")}`,
  "/usuarios/invitar": `<h1>Invitar</h1>${campo("Correo")}${a("/usuarios", "Enviar")}`,
  "/configuracion": `<h1>Configuración</h1>${a("/configuracion/empresa", "Empresa")}${a("/configuracion/impuestos", "Impuestos")}${a("/inicio", "Inicio")}`,
  "/configuracion/empresa": `<h1>Empresa</h1>${a("/configuracion", "Volver")}`,
  "/configuracion/impuestos": `<h1>Impuestos</h1>${a("/configuracion", "Volver")}`,
};
createServer((req, res) => {
  const mal = process.env.BENCH_APP === "500";
  const ruta = (req.url ?? "/").split("?")[0];
  const html = P[ruta];
  res.writeHead(mal ? 500 : html ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
  res.end(mal ? "error" : html ?? "<h1>No existe</h1>");
}).listen(puerto, () => console.log(`app en http://localhost:${puerto}`));
