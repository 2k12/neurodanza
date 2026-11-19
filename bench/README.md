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
| `ciclo_por_riesgo` | Tres cambios sobre el proyecto de prueba: **chico** (un texto en una pantalla de `web`), **medio** (12 reglas nuevas en un módulo de `api`) y **alto** (un guard de permisos y una migración en `api`, más un cambio en `web`). Para cada uno se lee qué lanza el harness: los revisores de `ciclo.mjs revisores`, fantasmas si aplican, 3 personas con su recorrido si cambian pantallas y 2 especialistas en modo director (2 repos); con `lib/riesgo.mjs`, el plan de su nivel de riesgo. Pasos: revisor 12, persona 14 + 8 del recorrido, fantasma 10, especialista 8 (los de la parte 3). Proxy de tokens: no mide un modelo. |
| `comandos_app` | Tres tareas repetitivas contra la app simulada (que ahora tiene login con token y `/api/pedidos`): listar pedidos como una persona, crear un pedido y verificar el repo `api` (lint, tipos y pruebas de un archivo). **A mano**: el comando que escribe un agente sin CLI (script de login, token y petición; la cadena de lint, tipos y pruebas). **Con `lib/app.mjs`**: el comando de la CLI con su ruta absoluta, como lo indica el skill. Se cuentan los caracteres escritos (tokens ≈ caracteres / 4) y si la tarea funcionó. |
| `comentarios_barrera` | 20 escrituras de código por la barrera real con `barreras.comentarios: "estricto"`: 12 con comentarios que no deberían escribirse (explicativos, al final de la línea, JSDoc de una función no exportada) y 8 que deben pasar (directivas, JSDoc de lo exportado, `// POR QUÉ:`, `@ts-expect-error`, y código sin comentarios con `//` dentro de textos, URLs o expresiones regulares). Se cuenta qué porcentaje de las primeras se rechaza y cuántas de las segundas se rechazan por error. |
| `pedido_textual` | Un pedido con 3 frases exactas («Filtrar por estado», «No hay pedidos con ese estado», "Estado inválido"); el director resume el objetivo en una línea («Filtro de pedidos por estado») y prepara la tarea. Se cuenta cuántas frases exactas llegan al contrato del implementador. Con `lib/funcionalidad.mjs`, antes se crea el documento de la funcionalidad con el pedido textual. |
| `prueba_primero` | Dos implementaciones de la misma función con su prueba (`node --test`): una escribe el código y después la prueba; la otra escribe la prueba, la ve en rojo (`pruebas.mjs rojo`, si el plugin lo trae) y después el código. Se cuenta cuántas clasifica bien el harness: aviso en el hook `Stop` para la primera, rojo registrado y sin aviso para la segunda. |
| `autoajuste` | Tres sesiones sembradas en transcripts falsos con el formato real (`transcripts.mjs`): un rechazo repetido, el mismo error en 3 comandos, un comando largo repetido, un revisor cortado por tiempo en 3 sesiones y un lint configurado que falla; más ruido. Cada comando pasa primero por la barrera (lo que se ve en vivo) y después, si existe, la pasada diaria. Cuenta lo aprendido (6), los falsos y si, tras aplicar el presupuesto, mantiene o propone revertir según bajen o no los cortes (2). |
| `regresion_impacto` | Un cambio toca un componente compartido y la pantalla de pedidos (la del diff); clientes usa el mismo componente y en el caso «roto» (`BENCH_ROTO=clientes`) perdió «Importar»; productos no lo usa. 3 recorridos permanentes con su versión aprobada. Una persona prueba la pantalla del diff en ambas versiones; con `lib/regresion.mjs` se repiten sin modelo los afectados y la dueña juzga solo lo que cambió (3 pasos). Cuenta detección, falsos (también en un caso «limpio») y pasos de modelo. |
| `inicio_ms` | Latencia del hook `SessionStart` (20 llamadas, mediana). |
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

### Parte 3 y tabla final

**Qué mide el banco.** Agentes, revisores, personas y la app son **simulados** (procesos con demoras controladas, eventos de hook reales y una app HTTP con pantallas falsas). Mide el **harness**: hooks, scripts, orden del ciclo y cuántos pasos fija. **No mide la velocidad ni la calidad de un modelo.** Todos los números son medianas de 5 corridas en la misma máquina (Windows 11, Node 26); las métricas de la parte 3 usan un costo de 300 ms por paso de agente (`--paso-ms`), igual en la base y en el final.

Una sola tabla con las 13 métricas: cada una contra **su** base original (la que se midió antes de programar la parte que la ataca) y el final (`final.json`, 1.0.0). Mejora = (base − final) / base × 100.

| Métrica | Base | Base original | Final (1.0.0) | Mejora |
|---|---|---|---|---|
| `stop_normal` | base.json (0.6.1) | 1,5 s | 1,4 s | 10,5 % |
| `stop_colgado` | base.json (0.6.1) | 300,4 s | 85,3 s | 71,6 % |
| `guardrails_ms` | base.json (0.6.1) | 76,5 ms | 72,9 ms | 4,7 % |
| `subagente_congelado` | base.json (0.6.1) | sin corte (tope de medición 45 s) | 21,8 s | antes no se cortaba |
| `revision_y_panel` | base.json (0.6.1) | 50,4 s | 30,2 s | 40,0 % |
| `fallo_externo` | base.json (0.6.1) | 28,5 s · 12 intentos | 3,4 s · 2 intentos | 88,0 % |
| `retomar_tras_corte` | base2.json (0.7.0) | 16 pasos · 12 lecturas | 5 pasos · 1 lecturas | 68,8 % en pasos; 91,7 % en lecturas |
| `reintento_fallido` | base2.json (0.7.0) | 65 líneas · 20 pasos | 30 líneas · 21 pasos | 53,8 % en líneas; -5,0 % en pasos |
| `bloqueos_seguridad` | base2.json (0.7.0) | permite 200 · rechaza 0 · pregunta 0 · 103,1 ms | permite 98 · rechaza 12 · pregunta 90 · 74,8 ms | antes se permitían las 200; latencia 27,5 % |
| `panel_pasos` | base3.json (0.8.0) | 40 pasos · 12,4 s | 14 pasos · 4,4 s | 65,0 % en pasos; 64,4 % en tiempo |
| `regresion_ux` | base3.json (0.8.0) | 0 de 5 detectadas | 5 de 5 detectadas (clics 4 → 6) | antes no se detectaba |
| `exploracion_implementador` | base3.json (0.8.0) | 17 (15 lecturas · 2 búsquedas) | 10 (10 lecturas · 0 búsquedas) | 41,2 % |
| `stop_y_ciclo_total` | base3.json (0.8.0) | 21,5 s | 14,0 s | 34,8 % |

**Ciclo simulado completo** (`stop_y_ciclo_total`, del diff pedido al veredicto, con el orden y los pasos que fija el skill de cada versión):

| Versión | Total | Especialistas | Implementar | Verificar | Revisión + panel + fantasmas |
|---|---|---|---|---|---|
| 0.6.1 (base original, `base3-original.json`) | 25,0 s | — | 7,6 s (25 pasos) | 1,7 s | 15,8 s (revisores, después panel; personas de 40 pasos) |
| 0.8.0 (`base3.json`) | 21,5 s | — | 7,6 s (25 pasos) | 1,8 s | 12,1 s (en el mismo turno; personas de 40 pasos) |
| 1.0.0 (`final.json`) | 14,0 s | 2,5 s (2 en paralelo) | 5,5 s (18 pasos) | 1,8 s | 4,3 s (en el mismo turno; personas de 14 pasos) |

**Mejora del ciclo simulado completo: 44,0 % frente a la 0.6.1** (25,0 → 14,0 s) y 34,8 % frente a la 0.8.0.

**Peor espera bloqueante** (el agente principal esperando un hook): el `Stop` con una prueba colgada, **300,4 s → 85,3 s**.

**Tiempo máximo que puede quedar colgado un subagente:** antes, **sin límite** (el banco cortó la medición a los 45 s sin que el harness lo cortara); ahora, su tope de tiempo: en el banco, 21,8 s con el tope del proyecto de prueba (20 s); con los valores por defecto, 210 s para una persona, 300 s para un revisor, 120 s para un especialista y 900 s para un implementador.

**Índice** (dentro de `exploracion_implementador`, una llamada a `indice.mjs generar` incluido el arranque de Node): proyecto de prueba 257 ms; repo mediano de 303 archivos 226 ms en frío y 198 ms en caché; repo de 3003 archivos 630 ms en frío. Todo bajo el límite de 5 s.

**Latencia de la barrera frente a la parte 2**, medida **intercalada** (base y nuevo alternados, 5 rondas, mediana): `guardrails_ms` 70,7 → 77,6 ms (**+9,8 %**, empeoró, bajo el límite del 25 %); `bloqueos_seguridad` 74,3 → 77,2 ms (+3,9 %).

Lo que empeoró y por qué:

- **Latencia de la barrera, +9,8 %:** la barrera ahora también busca la lección que corresponde recordar (operador) en cada llamada de un subagente que lee o edita. Cuesta menos de 5 ms por evento según la prueba; el resto es cargar un módulo más. La tabla contra la 0.6.1 sale con mejora (−4,7 %) porque la máquina variaba entre sesiones; la comparación válida es la intercalada.
- **Especialistas, +2,5 s** en el ciclo simulado y **tokens**: son subagentes (2 × 8 pasos en el banco) que antes no existían. Valen la pena si sus respuestas evitan exploración: en el banco el implementador pasó de 25 a 18 pasos, pero ese ahorro viene del índice; el de los especialistas (no redescubrir convenciones) **no lo mide el banco**. La caché los evita mientras su área no cambie.
- **Fantasmas** (parte 2): 2 × 10 pasos más de tokens en paralelo; no alargan el ciclo simulado porque corren con las personas.
- **`reintento_fallido`, +1 paso** (parte 2): rebobinar rehace desde la foto original.

**Cómo medir el efecto real** en un proyecto (lo que el banco no puede):

1. En `ejemplos/nest-next` (o un proyecto propio), elige 3 cambios típicos (una pantalla nueva, un campo en un formulario con su endpoint, una corrección de permisos).
2. Corre **N = 10 ciclos** de `/neurodanza-feature` con la versión anterior y 10 con la nueva, alternando versión en cada ciclo (para que el día, la red y la carga del servicio afecten a ambas) y desde el mismo commit de partida (`git worktree`).
3. Registra por ciclo, desde el mapa: tiempo total, pasos por subagente y tokens (`/cost` al cerrar), más el veredicto del panel y si hubo rondas extra.
4. Compara **medianas** y el rango intercuartil (P25–P75) de cada versión. Una diferencia es real si las medianas se separan más que el rango intercuartil de cada una; con menos de 10 ciclos por versión, la variación entre corridas de un modelo suele ser mayor que el efecto. Mira también la peor corrida: el harness existe sobre todo para acotarla.

Datos completos: [`base3.json`](base3.json), [`base3-original.json`](base3-original.json), [`final.json`](final.json).

### Parte 4: ODD, CLI de la app y comentarios

Base: la 1.0.0 (`base4.json`); final: la 1.1.0 (`final4.json`). Mismas condiciones que la parte 3: agentes y app simulados, 5 corridas. Las cinco métricas nuevas no dependen del tiempo: miden decisiones del harness, caracteres y clasificaciones.

| Métrica | 1.0.0 | 1.1.0 | Cambio |
|---|---|---|---|
| `ciclo_por_riesgo` | chico 102 · medio 24 · alto 150 pasos (276) | chico 0 · medio 12 · alto 150 pasos (162) | −41,3 % en total; lo alto, igual |
| `comandos_app` | 1121 caracteres (≈ 280 tokens) · 3 de 3 funcionan | 327 caracteres (≈ 82 tokens) · 3 de 3 funcionan | −70,8 % |
| `comentarios_barrera` | 0 de 12 rechazadas · 0 de 8 falsos rechazos | 12 de 12 rechazadas · 0 de 8 falsos rechazos | antes no se rechazaba ninguno |
| `pedido_textual` | 0 de 3 frases exactas en el contrato | 3 de 3 | antes no llegaba ninguna |
| `prueba_primero` | 0 de 2 bien clasificados | 2 de 2 | antes no se distinguía |

**Latencia frente a la 1.0.0**, medida **intercalada** (base y nuevo alternados, 5 rondas, mediana): `guardrails_ms` 75,45 → 76,97 ms (**+2,0 %**, empeoró: la barrera carga el analizador de comentarios y, en comandos de terminal, la CLI para contar repetidos); `stop_normal` 1,40 → 1,41 s (+1,0 %: el riesgo solo se calcula si cambiaron pantallas sin panel aprobado); `bloqueos_seguridad` 78,63 → 81,09 ms (+3,1 %), con las mismas decisiones (98 permite, 12 rechaza, 90 pregunta).

**En la 1.0.0, `ciclo.mjs revisores` no respondía** (salía con 13 por una importación circular con `fantasmas.mjs`, desde la 0.8.0). La base de `ciclo_por_riesgo` se calculó llamando a sus funciones, que es lo que el skill pretendía; en la práctica, el agente no recibía la lista de revisores.

**Lo que el banco no mide:** si el pedido textual evita rondas de corrección, si las pruebas en rojo atrapan errores, ni cuántas macros nacen en un proyecto real. Los comandos a mano de `comandos_app` son más cortos que los que escribió el agente en un proyecto real (412 y 499 caracteres frente a promedios de 1131 y 1191; ver [docs/21](../docs/21-cli-de-la-app.md)).

Datos: [`base4.json`](base4.json), [`final4.json`](final4.json).

### Parte 5: autoajuste y regresión mecánica (1.1.2 → 1.2.0, 5 corridas, mediana)

| Métrica | 1.1.2 | 1.2.0 | Cambio |
|---|---|---|---|
| `autoajuste` | aprendido 1 de 6 (la macro, en vivo) · falsos 0 · evaluación 0 de 2 | aprendido 6 de 6 · falsos 0 · evaluación 2 de 2 · pasada 59 ms | lecciones, errores conocidos y propuestas que antes no existían (la tabla de `--comparar` dice −500 % porque trata más como peor) |
| `regresion_impacto` | regresión fuera del diff **no detectada** · falsos 0 · 14 pasos de modelo (roto) y 14 (limpio) | **detectada** · falsos 0 · 17 (roto) y 14 (limpio) · 2 de 3 recorridos repetidos sin modelo | +3 pasos de modelo solo cuando hay algo que juzgar |

Las otras 19 métricas quedan iguales o dentro de ±1,5 % (`stop_normal` 1,4 s, `guardrails_ms` 78,0 → 77,4 ms, `stop_y_ciclo_total` 14,0 → 14,1 s). `comandos_app` sale 336 → 327 caracteres solo porque la ruta del plugin de la base (un worktree) es más larga.

**Latencia del inicio de sesión, intercalada** (3 rondas): 78,4 → 81,1 ms de media (**+3,4 %**, empeoró: el hook de inicio carga el módulo del autoajuste para leer sus propuestas; la pasada diaria corre aparte, en segundo plano).

**Con las sesiones reales de un proyecto** (9 sesiones, 231 subagentes): primera pasada 4,1 s, las siguientes 82 ms; 17 errores repetidos al catálogo y una propuesta del tipo «plugin» que llevó a corregir las instrucciones de la persona evaluadora.

**Lo que el banco no mide:** si las lecciones bajan los rechazos en sesiones reales (lo juzga cada lección, por día) ni la repetición con Chromium en una app real.

Datos: [`base5.json`](base5.json), [`final5.json`](final5.json).
