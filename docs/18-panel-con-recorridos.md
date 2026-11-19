# 18. Panel con recorridos: Tenet, Westworld y guion

Hasta la 0.8, cada persona del panel exploraba la app sin saber de antemano qué iba a buscar: recorría todo lo que alcanzaba desde las rutas del cambio, hasta su presupuesto. Era lento y difícil de comparar entre versiones. Ahora tiene tres piezas:

| Pieza | Qué cambia | Dónde |
|---|---|---|
| **Tenet: recorridos acordados** | Antes de implementar, cada persona escribe qué espera poder hacer; el usuario lo aprueba con el plan y es criterio de terminado | `lib/recorridos.mjs`, paso 0 del skill |
| **Westworld: memoria por recorrido** | Cada recorrido permanente guarda sus métricas por versión; una regresión de experiencia (más clics, más tiempo) se marca | `panel.mjs comparar`, `panel.memoria` |
| **Guion** | La persona ejecuta primero su recorrido (una llamada) y explora poco, solo en pantallas del diff | `agents/persona-evaluadora.md`, `panel.exploracionPasos` |

## 1. Tenet: recorridos acordados antes de implementar

En el paso 0 del skill, **antes del visto bueno del usuario**, el director elige las personas (`panel.mjs elegir`) y cada una escribe su **recorrido futuro**:

```json
{ "id": "exportar-pedidos", "persona": "ana", "tarea": "Exportar los pedidos a CSV",
  "maxClics": 4, "maxSegundos": 60,
  "pasos": [
    { "ruta": "/pedidos", "espera": { "texto": "Pedidos" }, "porQue": "es donde empiezo cada mañana" },
    { "click": "Exportar", "espera": { "url": "/pedidos/exportar" }, "porQue": "contabilidad lo pide", "critico": true },
    { "elegir": "Formato", "opcion": "CSV", "espera": { "elemento": "Descargar" }, "porQue": "solo aceptan CSV" },
    { "click": "Descargar", "espera": { "texto": "Exportación lista" }, "porQue": "sin el archivo no cierro el día", "critico": true }
  ] }
```

- **Un paso = una acción** con el formato de `--acciones` de `panel.mjs navegar` (`ruta`, `click`, `elegir`+`opcion`, `llenar`+`valor`, `tecla`, `esperar`) y su **`espera`**: lo que debe ver al final (`texto`, `elemento`, `url` o `mensaje`). `porQue` dice qué le importa a esa persona (desde su `perfil` y `valora`).
- `critico: true` marca los pasos sin los cuales la tarea no sirve. Si ninguno lo está, cuenta el último.

```
node <plugin>/lib/recorridos.mjs guardar --ciclo <c> --archivo <json>      valida y guarda .neurodanza/recorridos/<c>/<persona>.json
node <plugin>/lib/recorridos.mjs plan --ciclo <c>                          texto para el plan
node <plugin>/lib/recorridos.mjs aprobar --ciclo <c> [--permanentes a,b]   congela con hash; los permanentes van a git
node <plugin>/lib/recorridos.mjs contrato --ciclo <c> [--personas a,b]     sección del contrato del implementador
```

- **Aprobación:** el usuario ve los recorridos en el plan y los aprueba junto con él (puede editarlos). `aprobar` los **congela con su hash**: cualquier cambio posterior se detecta (`verificar`) y `guardar` se niega a reescribir uno aprobado.
- **Permanentes:** los que se repetirán entre versiones se copian a `panel.recorridos` (`.claude/personas/recorridos/`, en git) con su `id` estable. Son los que guardan memoria (Westworld).
- **Contrato:** el implementador los recibe como criterio de terminado («cuando termines, estos pasos deben poder hacerse»): `director.mjs preparar … --recorridos <ciclo> --personas <ids>`.
- **En el panel**, cada persona ejecuta primero su recorrido:

```
node <plugin>/panel/panel.mjs navegar --persona ana --recorrido <archivo o id> --salida <carpeta>
```

Lo ejecuta **entero en una llamada** (con Playwright, una captura por paso) y deja `recorrido.json`: por paso, clics, campos, tiempo, errores de consola, respuestas HTTP con error y si se cumplió la `espera` («esperaba X, encontré Y»). La persona califica cada paso contra lo que predijo: `cumple`, `cumple con fricción` o `no cumple`.

**Calificación:** `panel.mjs calificar` usa el detalle por paso. Un paso **crítico** que no cumple (según la persona o según la ejecución mecánica) limita la nota de esa persona a `panel.notaMaxSiFalla` (6). La nota que dio la persona queda en `notaPersona` y el motivo en `limite`.

**Evals:** `plantillas/casos-base.json` trae `persona-recorrido-falla`: un recorrido con un botón que no existe. La persona debe marcar ese paso `no cumple`.

## 2. Westworld: memoria por recorrido

Por cada recorrido **permanente**, `calificar` guarda la ejecución en `panel.memoria` (`.claude/personas/memoria/<id>.json`, en git: la comparación es compartida por todo el equipo): versión de la app, fecha, persona, si la ronda aprobó, y las métricas por paso y totales.

```
node <plugin>/panel/panel.mjs comparar --recorrido <id> [--ejecucion <carpeta>/recorrido.json]
```

compara con la **última versión aprobada** y marca **regresiones de experiencia**:

| Regresión | Cuándo |
|---|---|
| Más clics | `panel.regresion.clics` (1) o más clics que antes |
| Más tiempo | más de `panel.regresion.tiempo` (0.3 = +30 %) **y** al menos 1 s más (diferencias de milisegundos son ruido) |
| Paso que dejó de cumplir | un paso que en la versión aprobada cumplía y ahora no |
| Errores nuevos | más errores de consola o HTTP que antes |

Sin historial previo, no falla: responde sin regresiones y con el motivo.

- **En la voz de la persona:** «En la 1.0.0 «Exportar los pedidos a CSV» me tomaba 4 clics; ahora 6». La persona dueña del recorrido corre `comparar` antes de calificar y lo dice en la ventana en vivo (`Con observación`).
- **Regla de la nota** (la aplica `calificar`, no la persona, para no descontar dos veces): paso que dejó de cumplir −2, errores nuevos −1, más clics −1, más tiempo −0,5; **tope −3**; la nota nunca baja de 1. Después se aplica el tope por paso crítico. La versión que se califica nunca se compara consigo misma, y calificar dos veces no descuenta dos veces.
- **Dónde se ve:** en el chat (`⚠ regresión · ana: …`), en el evento de cierre de la ronda en vivo y en el mapa (`⚠ 2 regresiones` junto a la persona).
- `/neurodanza-init` crea las carpetas de recorridos y memoria y explica cómo marcar un recorrido como permanente.

## 3. Personas con guion: menos pasos

- **Primero el recorrido** (una llamada), **después** exploración libre con un máximo de `panel.exploracionPasos` (10) y **solo en pantallas que tocó el diff**.
- **Presupuesto por defecto de las personas: 20 pasos y 210 s** (antes 40 y 420). No se bajó a ciegas: `panel_pasos` midió 14 pasos con recorrido frente a 40 sin guion (35 %). Se aplicó esa proporción con un margen del 40 % para pantallas con más controles que las del banco: 40 × 0,35 × 1,4 ≈ 20 pasos y 420 × 0,35 × 1,4 ≈ 210 s.

## Medido

Del banco de pruebas (agentes y app simulados): ver [`bench/README.md`](../bench/README.md#parte-3-y-tabla-final).

## Límites

- **El recorrido mide lo que la persona predijo.** Una pantalla que nadie incluyó en un recorrido solo se revisa en la exploración libre, que ahora es corta.
- **La espera es textual.** `texto`, `elemento`, `url` y `mensaje` se comprueban con Playwright (texto visible, rol o etiqueta, ruta). Un cambio de redacción en la app hace fallar el paso aunque la función siga bien: es intencional (la persona lee esos textos), pero conviene revisar los recorridos permanentes cuando cambia el texto de un botón.
- **El tiempo depende de la máquina.** Por eso la regresión de tiempo pide +30 % y al menos 1 s más.
