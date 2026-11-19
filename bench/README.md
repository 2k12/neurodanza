# Banco de pruebas de velocidad

`bench.mjs` (sin dependencias) mide cuánto tarda el harness en las situaciones que lo dejaban colgado. Arma un proyecto de prueba a partir de `fixture/` en una carpeta temporal —una raíz con `neurodanza.config.json` y dos repos git, `api/` y `web/`— y corre los hooks reales del plugin que se le indique.

```
node bench/bench.mjs --plugin <carpeta del plugin> --salida bench/base.json     # 5 corridas por métrica (mediana)
node bench/bench.mjs --solo stop_normal,guardrails_ms --corridas 1             # rápido, para probar
node bench/bench.mjs --comparar bench/base.json,bench/parte1.json              # tabla base vs. ahora
```

La base se midió contra una copia intacta de `main` (0.6.1) mientras se escribía el código nuevo, para que los cambios no la contaminaran.

## El proyecto de prueba (`fixture/`)

| Pieza | Qué simula |
|---|---|
| `herramientas/tarea.mjs` | Lint, tipos y pruebas: scripts Node con una duración fija (sin ESLint ni TypeScript reales). Con `--colgable` y `BENCH_COLGADO=1` no termina nunca; con `BENCH_FALLA=<nombre>` falla. |
| `api/` | lint 0,4 s · tipos 0,9 s · pruebas relacionadas 1 s (colgables) · **suite completa 30 s** (`repos[].suite`) |
| `web/` | lint 0,3 s · tipos 0,7 s · pruebas relacionadas 0,6 s |
| `servidor.mjs` | La app. `BENCH_APP=caido`: no arranca. `BENCH_APP=500`: responde 500. |
| `neurodanza.config.json` | Configuración del proyecto. Para medir rápido el corte por tiempo usa topes cortos: `ciclo.maxSegundos.revisor: 20`, `ciclo.latidoSeg: 8` (los valores por defecto son 300 y 90). |

## Las métricas

| Métrica | Cómo se mide |
|---|---|
| `stop_normal` | Tiempo de pared del hook `Stop` con un cambio en ambos repos (contenido nuevo cada corrida: sin caché). |
| `stop_colgado` | Igual, con las pruebas relacionadas de `api` colgadas (`BENCH_COLGADO=1`). Tope de medición: 330 s. También cuenta procesos huérfanos que queden vivos. |
| `guardrails_ms` | Latencia media por llamada de `hooks/guardrails.mjs`: 1000 eventos variados por stdin (Read, Edit, Write, Bash, PowerShell, Grep; un tercio de subagentes). Incluye el arranque de Node, que es lo que paga cada llamada real. |
| `subagente_congelado` | Un subagente falso (revisor) da 3 pasos y se congela; otro sigue dando pasos (así corren los hooks). Se mide cuándo el harness lo marca «sin latido» y cuándo lo da por agotado (corte), y si al volver se le rechaza la herramienta. Sin corte se informa el tope de medición (45 s). |
| `revision_y_panel` | Ciclo simulado desde «diff listo» hasta «veredicto»: revisores falsos 4 × 20 s (en paralelo entre ellos) y personas falsas 3 × 30 s, más levantar la app real del proyecto de prueba. El orden lo lee del `SKILL.md` del plugin medido: si dice que revisores y panel van **en el mismo turno**, corren a la vez; si no, uno después del otro. |
| `fallo_externo` | La app no arranca. Se siguen las reglas del skill: hasta `panel.maxRondas` (3) rondas, en cada una se levanta la app y cada una de las 3 personas intenta entrar (3 s simulados por intento de persona + una petición HTTP real). Con `lib/fusible.mjs` en el plugin, cada fallo se registra y, con la capa fundida, el ciclo avanza con el panel pendiente. Se informan intentos y tiempo. |
| `retomar_tras_corte` | Un implementador simulado lee 10 módulos, edita 4, corre las pruebas (falla una) y se corta. Se cuenta cuántos pasos y lecturas necesita el reemplazo para terminar: sin pila relee todo; con `lib/pilas.mjs` recibe el mensaje de `reenfundar` y solo relee lo que cambió. |
| `reintento_fallido` | Un intento sale mal por diseño (40 líneas, 12 pasos) y los revisores lo reprueban con un hallazgo alto. Sin `director.mjs decidir` se corrige encima (+25 líneas, 8 pasos); con él, se rebobina a la foto original y se rehace con la memoria del fallo (30 líneas, 9 pasos). Se informa el diff final y los pasos totales. |
| `bloqueos_seguridad` | 200 llamadas de herramienta reales a la barrera (13 acciones: leer, editar, verificar, externas como `npm install` o `curl` externo, destructivas como `rm -rf`, `git reset --hard`, `git push --force`), repartidas entre revisor, implementador y agente principal. Se cuenta cuántas se permiten, se rechazan o se preguntan al usuario, y la latencia media. |
| `panel_pasos` | Una persona falsa evalúa «exportar pedidos» en la app simulada (`fixture/servidor.mjs`, pantallas con enlaces, campos y listas). **Sin guion** sigue el recorrido sistemático de `agents/persona-evaluadora.md`: en cada pantalla, `navegar`, mirar la captura y probar cada control, por todo lo que alcanza desde la ruta del diff, hasta su presupuesto (40 pasos). **Con recorrido** (`lib/recorridos.mjs`): una llamada que ejecuta el recorrido acordado, leer su informe y exploración libre acotada a `panel.exploracionPasos` en pantallas del diff. Ambas con 6 mensajes en la ventana. Se cuentan pasos y tiempo (cada paso cuesta `--paso-ms`, 300 ms) y si la tarea quedó verificada. |
| `regresion_ux` | La misma tarea en la v1 de la app y en la v2 (`BENCH_UX=v2`), que pide 2 clics más. Con memoria por recorrido, la v1 queda aprobada y se compara la v2: ¿se marca la regresión? Se informa en cuántas de las corridas se detectó. |
| `exploracion_implementador` | Repo generado estilo NestJS + Next (30 entidades, ~300 archivos con referencias cruzadas). Tarea: «agregar el campo descuento al crear pedidos». **Sin índice**: un Glob y un Grep del tema y la lectura de cada archivo que coincide. **Con índice** (`lib/indice.mjs`): solo los archivos que marca `resumen --foco`. Se cuentan lecturas y búsquedas y si se encontraron los 4 archivos que hay que tocar. Con índice, también el tiempo de generarlo en frío y en caché (proyecto de prueba, repo mediano y uno de ~3000 archivos). |
| `stop_y_ciclo_total` | El ciclo simulado completo como lo indica el skill del plugin medido: especialistas (si hay `lib/hotel.mjs`), implementar (los pasos de `exploracion_implementador` + 8), verificar (el hook `Stop` real), revisión + panel + fantasmas (4 revisores × 12 pasos, 3 personas × los pasos de `panel_pasos`, 2 fantasmas × 10 pasos si hay `lib/fantasmas.mjs`; a la vez si el skill lo dice) y cerrar. Cada paso cuesta `--paso-ms`. |

Los subagentes, revisores y personas son simulados (procesos con demoras controladas y eventos de hook reales): miden la orquestación y los hooks, no la velocidad de un modelo.

## Resultados

### Base (0.6.1, Windows 11, Node 26, 5 corridas, mediana)

| Métrica | Base |
|---|---|
| `stop_normal` | 1,5 s |
| `stop_colgado` | 300,4 s (esperó el tope interno de las pruebas relacionadas; 0 huérfanos) |
| `guardrails_ms` | 76,5 ms |
| `subagente_congelado` | sin corte (tope de medición 45 s); al volver, la herramienta se permitió (re-medido con el banco corregido: mismo resultado) |
| `revision_y_panel` | 50,4 s (revisores, después panel) |
| `fallo_externo` | 28,5 s · 12 intentos · se rinde (informa al usuario) |

Datos completos: [`base.json`](base.json).

### Parte 1 (0.7.0, mismas condiciones)

| Métrica | Base | Ahora | Mejora |
|---|---|---|---|
| `stop_normal` | 1,55 s | 1,61 s | −3,7 % (empeoró) |
| `stop_colgado` | 300,4 s | 85,5 s | 71,6 % |
| `guardrails_ms` | 76,5 ms | 85,9 ms | −12,3 % (empeoró; límite: 25 %) |
| `subagente_congelado` | sin corte (tope de medición 45 s) | corte a los 20,9 s; «sin latido» a los 10,5 s; al volver, rechazado | antes no se cortaba |
| `revision_y_panel` | 50,4 s | 30,4 s | 39,6 % |
| `fallo_externo` | 28,5 s · 12 intentos · se rinde | 3,8 s · 2 intentos · avanza con el panel pendiente | 86,7 % |

Mejora = (base − ahora) / base × 100. Datos completos: [`parte1.json`](parte1.json).

Lo que empeoró y por qué:

- **`stop_normal` (+3,7 %, +60 ms):** el Stop ahora decide qué pasa al fondo, lo lanza (un proceso desacoplado, ~10 ms), revisa el fusible y registra más estado. Una primera versión quedaba en +20 %: las firmas de cada repo se calculaban una tras otra antes de empezar las comprobaciones (~300 ms) y la cancelación del fondo anterior esperaba a `taskkill` (~600 ms en Windows). Ahora las firmas corren en paralelo y la cancelación no espera.
- **`guardrails_ms` (+12,3 %):** cada llamada de un subagente registra su paso (`.neurodanza/agentes/<id>.json`) y revisa el latido de los demás. La medida tiene ruido: con el mismo código, otra corrida dio 79,2 ms (+3,6 %), y en esta las dos últimas pasadas dieron 91,9 y 126,2 ms. En ambas queda bajo el límite del 25 %.

Notas para leer los números:

- `subagente_congelado` usa los topes cortos del proyecto de prueba (revisor 20 s, latido 8 s): el corte llega cuando vence el tope configurado. Con los valores por defecto sería a los 300 s (revisor) y el latido a los 90 s.
- `stop_colgado` ahora corta a los 85 s (tope de 90 s menos el margen 5 s): la prueba colgada se corta, se informa «no alcanzó a correr» y pasa al fondo. 0 huérfanos en ambas versiones.
- `revision_y_panel` y `fallo_externo` miden la orquestación que indica el skill con agentes simulados: el ahorro real depende de cuánto tarden los revisores y las personas de verdad.

### Parte 2 (0.8.0, mismas condiciones)

Base nueva medida antes de programar (`base2.json`, código de la Parte 1) y resultado (`parte2.json`):

| Métrica | Base 2 | Ahora | Mejora |
|---|---|---|---|
| `retomar_tras_corte` | 16 pasos · 12 lecturas (relee todo) | 5 pasos · 1 lectura | 68,8 % en pasos; 91,7 % en lecturas |
| `reintento_fallido` | 65 líneas · 20 pasos (corrige encima) | 30 líneas · 21 pasos (rebobina) | 53,8 % en líneas; +1 paso (empeoró) |
| `bloqueos_seguridad` | permite 200 · rechaza 0 · pregunta 0 | permite 98 · rechaza 12 · pregunta 90 | antes se permitía todo |
| `guardrails_ms` | 126,4 ms | 68,2 ms | ver nota |

Las 5 corridas de cada métrica nueva dieron el mismo valor (son conteos deterministas). Las otras métricas de la Parte 1, contra `parte1.json`: `stop_normal` 1,61 → 1,39 s, `stop_colgado` 85,5 → 85,4 s, `subagente_congelado` corte a los 20,9 → 21,8 s (+4 %, el tope del proyecto de prueba es 20 s), `revision_y_panel` 30,4 → 30,3 s, `fallo_externo` 3,8 → 3,4 s con 2 intentos.

Qué se permite, rechaza y pregunta (`bloqueos_seguridad`, con `figuras.activo`):

| Figura | Revisor | Implementador | Principal |
|---|---|---|---|
| ◯ leer | permite | permite | permite |
| △ editar | **rechaza** | permite | permite |
| □ verificar | permite | permite | permite |
| ◇ externo | **pregunta** | **pregunta** | **pregunta** |
| ✕ destructivo | **pregunta** | **pregunta** | **pregunta** |

**Latencia de la barrera (límite: +25 %).** La máquina varía mucho entre sesiones: el mismo código de la Parte 1 midió 85,9 ms en `parte1.json` y 126,4 ms en `base2.json`. Por eso se midió además **intercalado** (base y nuevo alternados, 5 rondas cada uno, mediana), que es la comparación válida:

| Métrica | Parte 1 | Parte 2 | Cambio |
|---|---|---|---|
| `guardrails_ms` | 69,0 ms | 69,9 ms | +1,3 % (empeoró, bajo el límite) |
| `bloqueos_seguridad` (latencia) | 76,1 ms | 72,1 ms | −5,2 % |

La barrera ahora clasifica cada llamada y registra rechazos, pero revisa los latidos como mucho cada 2 s (antes en cada llamada): por eso queda igual. Contra `parte1.json` sin intercalar daría 85,9 → 68,2 ms (−20,6 %), pero esa diferencia es de la máquina, no del código.

Lo que empeoró y por qué:

- **`reintento_fallido`, +1 paso (20 → 21):** rebobinar rehace el trabajo desde la foto original (9 pasos) en vez de agregar una corrección (8 pasos). A cambio el diff final queda en 30 líneas en vez de 65, sin el código del intento equivocado.
- **`guardrails_ms`, +1,3 %** (intercalado): clasificar la figura cuesta poco más que el arranque de Node.

Notas:

- `retomar_tras_corte` y `reintento_fallido` siguen un modelo de agente simulado (cuántas lecturas y pasos hace): miden que el mecanismo entregue lo necesario, no cuánto ahorra un modelo real.
- `bloqueos_seguridad` mide la decisión de la barrera, no lo que el usuario responde: las 90 preguntas aparecen en la ventana de permisos de Claude Code.

Datos completos: [`base2.json`](base2.json), [`parte2.json`](parte2.json).
