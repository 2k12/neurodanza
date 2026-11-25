# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## 1.8.0 · 2026-11-24

### Cambiado
- `revisor-ui` y `revisor-docs` con esfuerzo bajo. Con los cuatro revisores así: −44 % de costo y 14 de 14 errores detectados (casos fáciles).
- `revisor-docs` no corre si el proyecto no configura documentación.
- Plantilla de `AGENTS.md` mínima.

### Agregado
- `evals/costo.mjs`: tarea `permisos`, que lanza revisores. `evals/sesgo.mjs --esfuerzo` y `--variantes`.
- `ciclo.mjs preparar` y `ciclo.mjs cerrar`, disponibles pero fuera del skill: pedirlos desde él no bajó el costo (docs/27).

## 1.7.0 · 2026-11-24

### Agregado
- **`telemetria.mjs gasto`:** qué gasta cada tipo de agente y modelo.
- **Tope de gasto por ciclo** (`ciclo.maxTokens`, apagado por defecto): al llegar no se lanzan más subagentes y solo el usuario lo amplía (`ciclo.mjs seguir`).

### Cambiado
- **Los cambios chicos se hacen sin `/neurodanza-feature`:** los hooks verifican. Los proyectos ya preparados conservan su línea de `AGENTS.md`: cámbiala a mano.
- **Modo director y especialistas** solo con más de `director.minArchivos` (8) archivos o si el usuario lo pide.

### Corregido
- La telemetría tomaba el conteo parcial del primer fragmento de cada mensaje; ahora, el mayor.

## 1.6.0 · 2026-11-24

Menos tokens, medido con Claude Code real (docs/27): el plugin baja entre 28 y 53 % por tarea y `/neurodanza-feature` entre 39 y 51 %. Sigue costando más que no usarlo.

### Corregido
- **Los avisos del `Stop` bloqueaban:** obligaban al agente a otra vuelta en cada turno. Ahora los ve el usuario, una vez por sesión.
- **Mensajes con la ruta completa** del comando: sin ella, el agente buscaba el plugin en todo el disco.
- **Riesgo previsto:** sin diff, un cambio de código nunca era bajo. `riesgo.mjs --lineas N`.

### Cambiado
- El skill `/neurodanza-feature` pasa de 29,2 a 5,8 KB; el resto se lee por paso en `referencias/`.
- Código en 2 repos es medio hasta `ciclo.riesgo.lineasDosRepos` (150) líneas, con el revisor de coherencia; lo sensible sigue siendo alto.
- Las personas del panel corren en Sonnet (antes, el modelo de la sesión). Sin medir si califican igual.

### Agregado
- `evals/costo.mjs`: mide el costo con y sin el plugin.

## 1.5.1 · 2026-11-24

### Agregado
- `docs/26-comandos.md`: de qué se compone el plugin y qué hace cada comando. Una prueba falla si un comando, agente, skill o hook no está, o si hay un enlace roto.

### Corregido
- README y docs/01 al día (barrera en `Grep` y `Agent`, los 11 agentes, revisores y panel según el riesgo, incidencias y encabezados); docs/08 con fantasmas.
- La ayuda de `director.mjs` y `panel.mjs` omitía comandos, y `riesgo.mjs` apuntaba a un documento que no existe.

## 1.5.0 · 2026-11-24

### Agregado
- **Fantasmas:** `request` devuelve `cortada` y `resumen` (registros y cuántos por cliente), calculado sobre la respuesta completa; `--agrupar <campo o a.b>`.
- **«Sin evidencia»:** si la respuesta vino cortada y sin resumen, el fantasma no concluye «sin fuga». `veredicto` lo muestra aparte, sin bloquear.
- **Evals:** varias corridas por caso de fantasma (`corridas`) con regla fija: dos tercios confirman la fuga; en el limpio, ninguna falsa y todas concluyen.

### Corregido
- **Evals:** una nota nula o vacía valía 0 y aprobaba casos con `notaMax`; ahora es «sin nota» y no aprueba, tampoco como base de `repiteDe`.

### Cambiado
- Los casos base de fantasmas piden 3 corridas (el triple de tokens). Los proyectos ya configurados siguen con 1 hasta que agreguen `corridas`.

## 1.4.0 · 2026-11-24

### Agregado
- **`app.encabezados`:** encabezados del proyecto en las peticiones por API de los fantasmas, el login, la CLI de la app, la evidencia de incidencias y los usuarios del panel. Con `{id}`, `{rol}`, `{email}` y `${ENTORNO}`. Solo viajan a hosts de la app, también al redirigir. Sin configurarlo no cambia nada.

### Cambiado
- El fantasma no toma por bloqueado un ataque si el caso legítimo también falla.

## 1.3.1 · 2026-11-24

### Corregido
Comprobado con Claude Code 2.1.331 de verdad (`evals/barreras.mjs`): pasaban 3 de 9 vías; ahora, ninguna.
- **Un subagente podía lanzar otros** con las figuras activas: la regla existía, pero el hook no estaba registrado para `Agent`.
- **`Grep` podía leer un `.env`.**
- **Un juez lanzado como fork** heredaba la conversación: ahora se rechaza.

### Agregado
- `evals/barreras.mjs`: repite la comprobación cuando Claude Code se actualice. `evals/sesgo.mjs`: mide a los revisores con un encargo neutro y uno sesgado. Ver docs/25.

### Cambiado
- `Grep` y `Agent` pasan por la barrera: cada uno suma su tiempo, y los `Grep` de un subagente cuentan como pasos para sus avisos.

## 1.3.0 · 2026-11-24

### Agregado
- **Incidencias** (`/neurodanza-incidencias`, `lib/incidencias.mjs`): consulta la rama de desarrollo de cada repo y si se usa graphify (opcional), trae lo nuevo solo con avance rápido, registra fichas de frontend y backend con plantillas genéricas y mantiene el registro al día. Ver docs/24.
- **Evidencia de antes y después:** `panel.mjs capturas` (tres resoluciones) e `incidencias.mjs evidencia` (petición y respuesta de la app local, con lo sensible oculto). El antes no se pisa y «Corregida» exige el después.
- **«Verificada», «Cerrada» y «Descartada» las decide el responsable:** la barrera rechaza escribirlas a mano y por la CLI las pregunta, también en automático.
- Configuración `incidencias`.

### Cambiado
- La barrera tarda 68,8 ms por comando (antes 67,4; +2 %).

## 1.2.2 · 2026-11-23

### Cambiado
- **En el modo automático de Claude Code, las figuras ya no preguntan** (`figuras.enAuto: "clasificador"`, por defecto). Un `ask` de un hook interrumpe y le quita la decisión al clasificador del modo automático; ahora decide él. Los `deny` siguen, revisores, personas y especialistas no salen de su mano, y guardar macros o aplicar ajustes se pregunta siempre. Es menos estricto que antes en ese modo: con `"preguntar"` vuelve lo anterior.

## 1.2.1 · 2026-11-23

### Corregido
- **Las figuras preguntaban por comandos inofensivos.** En 3404 comandos reales del agente principal, la segunda llave preguntaba por el 60,2 %; ahora, por el 47,3 % (18,7 % con `figuras.sinClasificar: "permisos"`). Se preguntaba por `2>&1` (se partía por el `&` y quedaba un comando «1»), variables de entorno, `set -e`, `for`/`if`/`while`, `git -C`, banderas de npm, pnpm, yarn y npx, y comandos de solo lectura que faltaban.
- **Huecos que pasaban sin preguntar:** un programa entre comillas (`"./x"`, `& "x.exe"`), `$(…)` anidado, `ForEach-Object { Remove-Item … }`, métodos de .NET, variables que inyectan código (`NODE_OPTIONS`, `PATH`, `GIT_SSH_COMMAND`…) y una petición a la app puesta antes de otra a internet.

### Agregado
- `figuras.sinClasificar` (`"preguntar"` por defecto, o `"permisos"`): lo que no se puede clasificar, del agente principal, lo deciden los permisos de Claude Code.

## 1.2.0 · 2026-11-19

Autoajuste y regresión mecánica. Ver `docs/22-autoajuste.md`, `docs/23-regresion-mecanica.md` y `bench/`.

### Agregado
- **Telemetría de las sesiones** (`lib/telemetria.mjs`): de los transcripts de Claude Code del proyecto (la carpeta principal y la de cada repo, con los subagentes y su tipo), sin hooks nuevos. Tokens, comandos y sus errores, rechazos de las barreras, cortes y subagentes por sesión; incremental.
- **Autoajuste** (`lib/autoajuste.mjs`, `autoajuste`): una pasada al día en segundo plano al iniciar.
  - Los rechazos repetidos se vuelven lecciones del agente que los provoca, con el freno de los constructos (se aprueban solo si bajan por día).
  - Los errores de comandos repetidos entran a los errores conocidos.
  - Los comandos largos repetidos entre sesiones entran a las macros sugeridas.
  - Los cortes por tiempo repetidos y los comandos configurados que fallan siempre son **propuestas**: las aplica el usuario (la barrera lo pregunta) y después se evalúan (mantener o revertir).
  - Las lecciones del agente principal se muestran al iniciar.
- **Mapa de impacto** (`lib/impacto.mjs`): archivo cambiado → pantallas (por imports y layouts de Next) → recorridos permanentes que pasan por ellas.
- **Regresión mecánica** (`lib/regresion.mjs`, `panel.mjs repetir`):
  - Repite sin modelo los recorridos afectados, cada uno como su persona.
  - Los compara con su última versión aprobada: las métricas de siempre y la **firma de cada pantalla** (título, controles, campos y texto sin números).
  - La dueña de cada uno se suma a la ventana en vivo y dice si quedó igual o qué cambió. Solo lo que cambió va a la persona, en **modo juzgar** (`agents/persona-evaluadora.md`).
  - La ronda aprobada deja esa versión como base.
- Ventana en vivo: evento `persona` (sumar una persona a mitad de la ronda).
- Banco: `autoajuste`, `regresion_impacto` e `inicio_ms`; `bench/transcripts.mjs` (transcripts falsos con el formato real).

### Corregido
- La persona evaluadora corría el panel desde la carpeta equivocada («No hay neurodanza.config.json», 5 veces en las sesiones de un proyecto real; lo encontró el autoajuste): sus instrucciones dicen ahora que corra los comandos desde la carpeta del proyecto.
- Si la firma de una pantalla falla, el paso del recorrido vale igual (antes no existía la firma; ahora nunca marca un paso como fallido).

## 1.1.2 · 2026-11-19

### Corregido
- **El riesgo contaba líneas que no eran del cambio.** En un proyecto real, un cambio de ~25 líneas de código en el frontend salió como riesgo alto con 2562 líneas: sumaba el repo de docs, que estaba en una rama larga con cambios de varias versiones (2578 líneas), y las líneas de pruebas. Ahora los topes `lineasBajo` y `lineasAlto` cuentan solo código (`repos[].codigo`, sin documentación, pruebas ni el repo de docs), por archivo (`lineasPorArchivo`).
- **Un nombre «sensible» fuera del código subía a alto.** La evaluación `docs/evaluaciones/v0.28.2-permisos-lectura.json` del repo de docs coincidía con `*permis*`. Los globs de `ciclo.riesgo.altos` ya no aplican al repo de docs, a la documentación ni a las pruebas.

### Agregado
- **Permisos en el contenido** (`ciclo.riesgo.permisosEnCodigo`): si las líneas cambiadas del código tocan permisos (`useCan`, `hasRole`, `permission`, `NoAccess`, `can(`…), el cambio es al menos medio y entra el revisor de permisos, aunque ningún nombre de archivo lo diga. Sin esto, el arreglo de arriba dejaba ese cambio real (permisos de Embarques y Facturas) en riesgo bajo y sin revisores; ahora sale medio con el revisor de permisos y una persona, lo que la sesión eligió a mano.
- Medido: `ciclo_por_riesgo` igual (162 pasos); `stop_normal` intercalado 4 veces, 1,447 s → 1,439 s (igual).

## 1.1.1 · 2026-11-19

### Corregido
- **El panel tomaba la captura sin esperar a que cargara la pantalla.** Esperaba a la red quieta y 600 ms fijos: si la app pinta un esqueleto o un spinner y luego los datos, la captura salía con el esqueleto (en el banco, 0 de 10 capturas completas en una pantalla que tarda 1,5 s). Ahora, antes de cada captura (rutas, pasos del recorrido y `captura` de las acciones), espera a la red quieta, a que no haya indicadores de carga visibles (`aria-busy`, `progressbar` sin valor, esqueletos, spinners, `.animate-pulse`/`.animate-spin`) y a que el DOM quede quieto (`panel.carga`). Si se cumple el tope, captura igual y el informe lo dice. Medido con Chromium, 10 veces por pantalla: la que tarda 1,5 s pasa de 0 de 10 a 10 de 10 capturas completas (mediana 1126 → 1960 ms); una pantalla sin carga diferida, de 1123 a 966 ms.
- **`ciclo.mjs revisores` salía con 13 desde la 0.8.0** (importación circular con `fantasmas.mjs`). Ya estaba corregido en la 1.1.0 (`lib/cambios.mjs`); se anota aquí porque la 1.0.0 de `main` lo tiene.

### Agregado
- `panel.carga` (`maxSeg` 15, `quietoMs` 400, `cargando`: selectores CSS de carga propios del proyecto).

## 1.1.0 · 2026-11-19

ODD en neurodanza, la app por comandos y comentarios. Ver `docs/20-odd-en-neurodanza.md`, `docs/21-cli-de-la-app.md` y `bench/`.

### Agregado
- **Proporcionalidad** (`lib/riesgo.mjs`, `ciclo.riesgo`): cada cambio es de riesgo bajo (lint, tipos y pruebas; sin revisores, panel, fantasmas ni especialistas), medio (1 revisor y 1 persona) o alto (el ciclo completo). `ciclo.mjs revisores` lo aplica y el hook `Stop` no exige el panel con riesgo bajo.
- **CLI de la app** (`lib/app.mjs`, `cli`): `estado`, `login`, `api … --como <persona|ROL|admin>` con la sesión en caché, `abrir` y `verificar` (lint, tipos y pruebas en paralelo). Funciona en cualquier proyecto desde la configuración.
- **Macros que nacen del uso**: la barrera cuenta los comandos largos repetidos y propone guardarlos (`sugeridas`, `aceptar`, `podar`); quedan en git. Una macro se juzga por el comando que corre, y guardarla o borrarla lo aprueba el usuario.
- **Barrera de comentarios** (`lib/comentarios.mjs`, `barreras.comentarios`): rechaza al editar los comentarios nuevos que no van; en `"estricto"` solo pasan directivas, JSDoc con etiquetas de API de lo exportado y `// POR QUÉ: …`. La regla ESLint gana el modo estricto. Apagada por defecto; la plantilla la propone.
- **Documento de la funcionalidad** (`lib/funcionalidad.mjs`): el pedido del usuario textual, specs `S#`, tareas con evidencia y registro; `director.mjs preparar --funcionalidad` lo lleva al contrato.
- **Pruebas primero** (`lib/pruebas.mjs`, `ciclo.pruebaPrimero`): `rojo` antes de implementar y `verde` después; el hook `Stop` avisa (o bloquea con `"exigir"`) si una prueba nueva no se vio en rojo.
- Banco: `ciclo_por_riesgo`, `comandos_app`, `comentarios_barrera`, `pedido_textual`, `prueba_primero`; la app simulada tiene login con token y `/api/pedidos`.

### Corregido
- `ciclo.mjs revisores` salía con 13 sin responder desde la 0.8.0 (importación circular con `fantasmas.mjs`): `changesInBranch` pasa a `lib/cambios.mjs`.

### Medido (5 corridas, mediana; agentes y app simulados)
Pasos de subagentes para tres cambios: 276 → 162 (−41,3 %; el chico pasa de 102 a 0 y el alto queda igual en 150). Tres tareas contra la app: 1121 → 327 caracteres (−70,8 %), todas funcionan. Comentarios que no van: 0 → 12 de 12 rechazados, sin falsos rechazos; sobre un proyecto real, el modo estricto rechazaría el 99,1 % y el 99,5 % de sus comentarios. Frases exactas del pedido en el contrato: 0 → 3 de 3. **Empeoró:** la barrera, +2,0 % (75,45 → 76,97 ms, intercalado), y el `Stop`, +1,0 %.

## 1.0.0 · 2026-11-19

Panel mejor y más rápido, menos exploración. **Versión mayor: cambia el flujo de `/neurodanza-feature`** (las personas escriben su recorrido antes de implementar y el director consulta especialistas antes de delegar). Ver `docs/18-panel-con-recorridos.md`, `docs/19-menos-exploracion.md` y `bench/`.

### Agregado
- **Recorridos acordados (Tenet)** (`lib/recorridos.mjs`, `panel.recorridos`, `panel.notaMaxSiFalla`): antes del visto bueno, cada persona escribe su recorrido futuro (pasos verificables con lo que espera ver, `maxClics`, `maxSegundos` y `porQue`); el usuario lo aprueba con el plan y queda congelado con su hash; los permanentes van a git. Entra en el contrato del implementador como criterio de terminado. En el panel, `panel.mjs navegar --recorrido` lo ejecuta entero y la persona califica paso por paso; un paso crítico que no cumple limita su nota a 6. Caso de calibración en las evals.
- **Memoria por recorrido (Westworld)** (`panel.memoria`, `panel.regresion`, `panel.mjs comparar`): historial por versión de cada recorrido permanente; regresiones de experiencia frente a la última versión aprobada (más clics, más tiempo, pasos que dejan de cumplir, errores nuevos), dichas por la persona en su voz, descontadas con una regla documentada y marcadas en el chat y el mapa.
- **Índice pre-cocido por commit** (`lib/indice.mjs`, `indice.*`): sin modelo, por repo: carpetas, exportaciones, imports, rutas de API (NestJS, Express, Next), pantallas, modelos, migraciones y pruebas; caché por commit + cambios sin commit; `resumen --foco` y `buscar --que`. Va en el contrato y en los mensajes de revisores y personas.
- **Especialistas** (`agents/especialista-{datos,a11y,permisos,rendimiento}.md`, `lib/hotel.mjs`, `hotel.*`): el director los consulta en paralelo antes de delegar; solo lectura, 8 pasos y 120 s; contexto pre-cocido desde el índice; respuestas en caché por firma del área + pregunta; el contrato trae «Lo que ya sabemos de este proyecto».
- **Operador** (`lib/operador.mjs`): las lecciones aceptan `activadores` (globs y patrones); la barrera recuerda la lección una vez por agente cuando su constructo lee o edita un archivo que coincide (< 5 ms por evento); se cuenta cada recuerdo y el juicio de la lección lo menciona.
- Banco: `panel_pasos`, `regresion_ux`, `exploracion_implementador`, `stop_y_ciclo_total`; app simulada con pantallas (`BENCH_UX=v1|v2`) y repos generados.

### Cambiado
- **Presupuesto de las personas: 20 pasos y 210 s (antes 40 y 420).** No se bajó a ciegas: `panel_pasos` midió 14 pasos con recorrido y exploración acotada frente a 40 sin guion (35 %); se aplicó esa proporción con un margen del 40 % para pantallas con más controles que las del banco (40 × 0,35 × 1,4 ≈ 20; 420 × 0,35 × 1,4 ≈ 210).
- La persona explora como máximo `panel.exploracionPasos` (10) pasos tras su recorrido, solo en pantallas del diff.
- Mapa 1.0.0: regresiones por persona (`⚠ n`), consultas a especialistas (`🏨 datos ✔ (caché)`); las personas que escriben su recorrido siguen en la fase de planificar.

### Medido (5 corridas, mediana; agentes y app simulados)
Panel: 40 → 14 pasos y 12,4 → 4,4 s (65,0 %); regresión de 2 clics más: antes no se detectaba, ahora en 5 de 5; implementador ubicando los archivos de una tarea: 17 → 10 lecturas y búsquedas (41,2 %), encontrando los 4 archivos en ambos casos; ciclo simulado completo: 25,0 s en la 0.6.1 → 21,5 s en la 0.8.0 → 14,0 s (44,0 % frente a la 0.6.1). Índice de 3003 archivos en 630 ms. **Empeoró:** la latencia de la barrera, +9,8 % frente a la 0.8.0 (intercalado; límite 25 %), y el ciclo suma 2,5 s y tokens de especialistas que el banco no puede compensar con su ahorro real.

## 0.8.0 · 2026-11-19

No perder trabajo y seguridad práctica. Ver `docs/16-no-perder-trabajo.md`, `docs/17-seguridad.md` y `bench/`.

### Agregado
- **Pilas** (`lib/pilas.mjs`, `hooks/pilas.mjs`, `pilas.*`): un `PostToolUse` asíncrono guarda lo que lee (con hash), edita y corre cada subagente, en archivos atómicos por paso; cada `pilas.avanceCada` pasos la barrera le pide una línea de avance.
- **Re-enfundar guiado** (`pilas.mjs reenfundar`): el reemplazo de un agente cortado recibe el contrato, lo hecho, qué no releer, qué cambió, lo que falta y el presupuesto restante; mismo worktree; una sola vez por tarea.
- **Rebobinar con memoria** (`director.mjs decidir` / `rebobinar`, `director.rebobinar.*`): corregir encima lo puntual o volver a la foto original con un contrato que cuenta los intentos fallidos; cada muerte va a `.neurodanza/muertes.json` y a los constructos como evidencia.
- **Figuras** (`lib/figuras.mjs`, `figuras.*`): ◯ leer △ editar □ verificar ◇ externo ✕ destructivo y una mano por tipo de agente; fuera de la mano, ◇ y ✕ se preguntan al usuario (`ask`) y lo demás se rechaza. La tabla y el registro de agentes no los escribe ningún agente; un subagente no lanza subagentes. Apagadas en configuraciones existentes, prendidas por `/neurodanza-init`.
- **Cuarentena** (`figuras.cuarentena`): 3 rechazos dejan al subagente sin herramientas; queda en errores conocidos; `agentes.mjs reiniciar` al empezar el ciclo.
- **Fantasmas en modo propuesta** (`lib/fantasmas.mjs`, `agents/fantasma.md`, `fantasmas.*`): hipótesis de recurso ajeno, escalada de rol, fuga entre clientes, acción oculta y entrada no validada, probadas contra la app local; nunca editan; un confirmado alto cuenta como hallazgo alto y trae una prueba de regresión propuesta. Casos de evals.
- Banco: `retomar_tras_corte`, `reintento_fallido`, `bloqueos_seguridad`.

### Cambiado
- Mapa 0.4.0: reemplazos `↻`, muertes `✝`, cuarentena `⛔`, fantasmas `👻`.
- La barrera revisa latidos como mucho cada 2 s.

### Medido (5 corridas, mediana)
Retomar tras un corte 16 pasos y 12 lecturas → 5 y 1 (68,8 %); reintento tras un fallo de diseño 65 → 30 líneas de diff (53,8 %), con un paso más (20 → 21); de 200 acciones de seguridad antes se permitían todas, ahora 98 se permiten, 12 se rechazan y 90 se preguntan. Latencia de la barrera, medida intercalada contra la Parte 1: +1,3 % (límite 25 %).

## 0.7.0 · 2026-11-19

Velocidad: que el harness nunca se quede colgado. Ver `docs/15-velocidad.md` y `bench/`.

### Agregado
- **Banco de pruebas** (`bench/bench.mjs`, sin dependencias): proyecto de prueba con dos repos git y 6 métricas con 5 corridas. Base contra 0.6.1 y resultados de esta versión en `bench/`.
- **Hook Stop en dos velocidades:** la parte que bloquea tiene tope (`retroalimentacion.topeStopSeg`, 90 s); lo que no alcanza se corta matando su árbol de procesos y pasa al **fondo** (`lib/fondo.mjs`), un proceso desacoplado que también corre la suite completa (`repos[].suite`) atada a la firma del cambio. Sus fallas bloquean el Stop siguiente; un cambio nuevo lo cancela; `fondo.mjs esperar` es requisito del cierre.
- **Timeout obligatorio** (`barreras.timeoutComandos`): servidores, modos watch y suites completas sin límite se rechazan con la forma exacta de correrlos.
- **Corte por tiempo** (`ciclo.maxSegundos`, `ciclo.latidoSeg`, `lib/agentes.mjs`): aviso al 80 %, rechazo de toda herramienta al 100 % (sin el mapa, lo hace la barrera), latido y registro por agente. Hook `SubagentStop`.
- **Fusible** (`lib/fusible.mjs`, `fusible.*`): dos fallos de la app, Chromium o una capa configurada en el ciclo la funden; el panel queda pendiente. `panel.mjs app`.

### Cambiado
- `/neurodanza-feature` lanza en el mismo turno los revisores y el panel, sobre una sola app levantada. Un revisor que reprueba con hallazgo alto impide que esa ronda apruebe.
- Timeouts de los hooks: Stop 120 s (antes 600), lint al editar 60 s (antes 90).
- Mapa 0.3.0: tiempo usado / total por subagente, «sin latido» y capas fundidas.

### Medido (5 corridas, mediana)
Stop con un comando colgado 300,4 s → 85,5 s (71,6 %); del diff al veredicto 50,4 s → 30,4 s (39,6 %); app que no arranca 28,5 s y 12 intentos → 3,8 s y 2 intentos (86,7 %); subagente congelado: antes sin corte, ahora cortado al vencer su tope. Empeoraron el Stop normal (+3,7 %) y la latencia de la barrera (+12,3 %, bajo el límite del 25 %).

## 0.6.1 · 2026-11-18

- **La ventana Role Agents ya no se cierra al terminar cada turno.** El hook `Stop` cerraba la ronda en vivo aunque las personas siguieran probando en segundo plano. Ahora la ronda se cierra con `calificar`, con otra ronda, al terminar la sesión (hook nuevo `SessionEnd`, `feedback.mjs fin`) o tras 20 minutos sin mensajes.

## 0.6.0 · 2026-11-18

### Cambiado
- **Constructos: lo crudo local, lo aprendido en git.** Los datos de cada ciclo (evidencias, candidatas, a prueba) quedan en `.neurodanza/constructos/` (local). Las lecciones **aprobadas** se escriben en `<repo>/.neurodanza/aprendido/<constructo>.md`, versionado: aparecen en el PR como una línea nueva que se revisa como cualquier cambio, y borrar una línea la retira (lo compartido manda). `constructos.compartido: "auto"`: la raíz si es un repo, si no el repo de docs.
- El `.gitignore` automático versiona `!.neurodanza/aprendido/` en vez de todos los datos de los constructos (y actualiza el bloque de la 0.5.0).

### Agregado
- Si Claude se abre **dentro de un componente** (p. ej. `frontend/`), al iniciar la sesión el agente pide una vez `/add-dir` de la raíz del proyecto, donde viven el plan, los worktrees y los demás repos.

## 0.5.0 · 2026-11-18

### Agregado
- **Constructos** (`lib/constructos.mjs`, `docs/14-constructos.md`): cada agente con nombre acumula lecciones en el proyecto. La **reflexión al cerrar** de `/neurodanza-feature` anota los problemas de los jueces (con etiqueta estable) al constructo que los causó. Una lección pasa de candidata a **a prueba** con 2 evidencias, viaja en el contrato o el mensaje del agente, y tras 3 ciclos se **aprueba** solo si el problema aparece menos por ciclo; si no, se **descarta**. Para revisores y personas también exige evals posteriores que no empeoren. Tope de 30 lecciones activas. `playbook.md` y `CHANGELOG.md` legibles por constructo.
- `director.mjs preparar --constructo <nombre>`: el contrato incluye las lecciones del constructo.
- `evals.mjs prompt` incluye las lecciones del revisor, para medirlo tal como trabaja.

- **Autoconfiguración al iniciar la sesión** (`autoconfigurar`, `lib/autoconfig.mjs`): agrega el bloque de `.neurodanza/` al `.gitignore` de la raíz si es un repo, y avisa (sin darse permisos) si los worktrees quedan fuera del proyecto.

### Cambiado
- `director.worktrees: "auto"`: si la raíz no es un repo, los worktrees van en `.neurodanza/wt` (sin permisos); si lo es, al lado del proyecto. El director tampoco puede editar `.neurodanza/wt`.
- CI con Node 22 y 24 (Node 20 ya no tiene soporte); `engines` pide Node 22 o superior.
- Ventana Role Agents: «los agents están probando la app».

## 0.4.0 · 2026-11-18

### Cambiado
- Ventana en vivo del panel rediseñada como **Role Agents**: lista de personas a la izquierda con scroll (foto, nombre tal cual, cargo, estado y nota; resalta a quien habla) y conversación vertical a la derecha con la foto de cada persona. Al cerrar, la lista se ordena por nota y el pie muestra el veredicto. Oscura y minimalista, con barra de scroll propia.
- **Estados concretos** de las personas, sin emociones. Mientras prueban: `Ingresando`, `Probando`, `Verificando`, `Con observación`, `Con error`, `Bloqueado`. Estado final atado a la nota: `Sin observaciones` (10), `Observaciones menores` (9), `Funciona con dificultad` (7–8), `Requiere ayuda` (5–6), `No funciona` (≤ 4). `decir` rechaza cualquier otro, y `cerrar` y `ventana` calculan el final desde la nota para que nunca se contradigan. Notas bajo 7 en rojo.
- La ventana **no queda abierta**: `calificar` cierra la ronda activa con las notas, `en-vivo` cierra la anterior, el hook `Stop` cierra la que quede abierta y sin mensajes en 20 minutos (antes 45) se cierra sola. **Más angosta** (760 px; el estado va bajo el cargo) y **sin consola**: el lanzador usa `conhost --headless`.

## 0.3.0 · 2026-11-18

### Agregado
- **Modo director** (`lib/director.mjs`, `docs/13-director.md`): el agente principal dirige y no edita; cada tarea la hace un `implementador` en su propio worktree, creado desde una foto del estado actual (incluye lo que no está en commit) y con los `node_modules` del repo real enlazados. `integrar` revisa que lo cambiado esté dentro del contrato, aplica el diff (con 3 vías si hace falta) y borra el worktree sin tocar las dependencias reales.
- Agente `implementador`: cumple un contrato (objetivo, archivos, condición de terminado, presupuesto de 60 pasos) y responde un JSON.
- Barreras del modo director: el principal no edita ni corre comandos que modifiquen archivos; cada subagente edita solo en su worktree y dentro de su contrato. Rutas protegidas y migraciones inmutables valen también en los worktrees. Lint al editar dentro de los worktrees.
- Configuración `director` (`worktrees`, `enlazar`) y `ciclo.maxPasos.implementador`.
- Mapa 0.2.0: `◆ modo director`, implementadores como nodos de la fase 1 con el nombre de su tarea y su presupuesto.

## 0.2.0 · 2026-11-18

### Agregado
- **Mapa en vivo** (plugin nuevo `neurodanza-mapa`, carpeta `mapa/`): panel con scroll al lado del chat con la fase del ciclo (deducida de lo que hace el agente, con vueltas), cada subagente como nodo (pasos, última herramienta, tiempo, veredicto; clic para ver su conversación), la última verificación del hook `Stop` y el plan. Línea de estado con el resumen. Comando `/neurodanza-mapa`.
- **Presupuesto de pasos por subagente** (`ciclo.maxPasos`: revisores 25, personas 40): el mapa le avisa al subagente al 80 %, al tope y si repite la misma llamada 3 veces.
- **Planificador + ejecutor**: el paso 0 de `/neurodanza-feature` escribe `.neurodanza/plan.md` con pasos y condiciones de terminado; el agente lo marca y lo relee si se pierde.
- **Errores conocidos** (`lib/errores.mjs`, `errores.*`): cada problema de los hooks se guarda con una firma estable y un contador por sesión; si vuelve, el mensaje trae la solución anotada. Hook `SessionStart` que carga los más útiles como contexto. Comandos `listar`, `resolver` y `buscar`.
- `lib/ciclo.mjs revisores`: qué revisores aplican al diff de la rama y por qué (`ciclo.revisores`: `"segun-cambio"` o `"todos"`).

### Cambiado
- **Hook `Stop` más rápido**: lint, tipos y pruebas corren en paralelo (y los repos también), y un repo cuyo cambio no se movió reutiliza el resultado anterior (`retroalimentacion.cache`). Escribe tiempos y resultado en `.neurodanza/estado.json`.
- Los 4 revisores corren con `model: sonnet` y entregan lo que tienen al llegar a su presupuesto.
- Panel de personas: en la ronda siguiente solo se vuelve a evaluar a quien reprobó o usa una ruta que tocó el arreglo.
- `/neurodanza-init` agrega `.neurodanza/*` y `!.neurodanza/errores.json` a `.gitignore` y sugiere instalar el mapa.

## 0.1.2 · 2026-11-18

- El hook Stop ya no bloquea en ciclo: tras `maxBloqueos` intentos con los mismos problemas deja terminar (avisa una vez) hasta que los problemas cambien. Antes reiniciaba el contador y volvía a bloquear sin fin (por ejemplo, esperando un panel que depende de algo externo).

## 0.1.1 · 2026-11-18

- El recordatorio de docs solo cuenta cambios de código (`repos[].codigo`) y acepta los docs ya commiteados en la rama: antes avisaba por un `AGENTS.md` o con los docs ya en un commit.

## [0.1.0] - 2026-11-18

Primera versión pública.

### Agregado
- **Configuración** por proyecto en `neurodanza.config.json` (`lib/config.mjs`): búsqueda hacia arriba desde la carpeta actual, valores por defecto, validación y globs `repo:glob`. Sin el archivo, el plugin no hace nada.
- **Barreras** (hook `PreToolUse`, `hooks/guardrails.mjs`): secretos `.env`, firmas de IA en commits y código, borrados de rutas raíz, rutas protegidas, migraciones inmutables y comandos prohibidos propios del proyecto (con alcance `bare` o `raw`).
- **Retroalimentación** (`hooks/feedback.mjs`): lint del archivo al editar (`PostToolUse`) y, al terminar (`Stop`), lint, tipos, pruebas relacionadas, generadores y definición de terminado (versión, bitácora, migraciones, pantallas con panel aprobado, guías, evals y docs), con un tope de bloqueos (`retroalimentacion.maxBloqueos`).
- **4 revisores** (`agents/revisor-coherencia`, `revisor-permisos`, `revisor-ui`, `revisor-docs`) que leen las reglas de `reglas.*` y responden un JSON con hallazgos.
- **Panel de personas** (`panel/panel.mjs`, agente `persona-evaluadora`): elegir de `panel.min` a `panel.max` personas según los roles que modifican las rutas cambiadas, crear sus usuarios por HTTP, navegar con Playwright (con acciones `click`, `elegir`+`opcion`, `llenar`+`valor`, `tecla`, `esperar`, `captura`), calificar contra `panel.umbral` (8.99 por defecto) y hasta `panel.maxRondas` rondas.
- **Ventana en vivo** (solo Windows, `panel.ventana: "windows"`): avatares que conversan con `decir`/`oir` y que se cierra sola al `cerrar` la ronda. Ventana de resumen con `ventana`.
- Fotos locales fuera de git recortadas al rostro (`panel/recortar-fotos.mjs` + `fotos.json`), avatares dibujados de respaldo (`panel/avatares.mjs`) y creación de personas para roles sin persona con número (`crear`, p. ej. Ana2).
- **Evals** (`evals/evals.mjs`, `/neurodanza-evals`): detección de errores sembrados, falsos positivos en el control limpio y calibración del panel.
- Regla ESLint `neurodanza/no-junk-comments`: código comentado, TODO sin ticket y atribuciones de IA.
- Skills `/neurodanza-init`, `/neurodanza-feature` y `/neurodanza-evals`.
- Plantillas (`plantillas/`) y ejemplo real de un proyecto NestJS + Next con 3 repos (`ejemplos/nest-next/`).
- Pruebas con `node --test` (`tests/`).
