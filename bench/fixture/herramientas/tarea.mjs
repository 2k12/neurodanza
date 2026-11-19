#!/usr/bin/env node
// Herramienta falsa para el banco de pruebas: simula lint, tipos o pruebas con una duración fija.
//   node tarea.mjs --nombre <n> --ms <duración> [--colgable] [archivos…]
// Con --colgable y BENCH_COLGADO=1 no termina nunca (para medir el corte del hook Stop).
// Con BENCH_FALLA=<nombre> sale con error y una salida parecida a la de la herramienta real.
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const nombre = arg("nombre", "tarea");
const ms = Number(arg("ms", "500"));
if (process.argv.includes("--colgable") && process.env.BENCH_COLGADO === "1") {
  console.log(`${nombre}: esperando algo que nunca llega…`);
  setInterval(() => {}, 1000);
} else {
  setTimeout(() => {
    if (process.env.BENCH_FALLA === nombre) {
      console.error(`src/index.mjs(3,7): error ${nombre}: algo no cuadra`);
      process.exit(1);
    }
    console.log(`${nombre}: ok en ${ms} ms`);
  }, ms);
}
