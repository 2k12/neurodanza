#!/usr/bin/env node
// App falsa del banco de pruebas. BENCH_APP=caido: no arranca. BENCH_APP=500: responde 500.
import { createServer } from "node:http";
const puerto = Number(process.env.BENCH_PUERTO ?? 47613);
if (process.env.BENCH_APP === "caido") {
  console.error("la app no arranca: falta la base de datos");
  process.exit(1);
}
createServer((req, res) => {
  const mal = process.env.BENCH_APP === "500";
  res.writeHead(mal ? 500 : 200, { "Content-Type": "text/html" });
  res.end(mal ? "error" : "<h1>Ingresar</h1>");
}).listen(puerto, () => console.log(`app en http://localhost:${puerto}`));
