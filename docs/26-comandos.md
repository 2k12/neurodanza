# 26. Qué trae y qué hace cada comando

## De qué se compone

| Pieza | Cuántas | Para qué |
|---|---|---|
| Comandos `/` | 5 | Lo que escribes tú: 4 de `neurodanza` y 1 de `neurodanza-mapa` (plugin opcional). |
| Agentes | 11 | 4 revisores, 4 especialistas, 1 persona, 1 fantasma y 1 implementador. Los lanza el ciclo. |
| Hooks | 7, en 6 eventos | Corren solos en cada proyecto con `neurodanza.config.json`. |
| CLI | 22 de uso diario y 6 de mantenimiento | Scripts de Node sin dependencias. Los usa Claude; también puedes correrlos tú. |

Todo corre en tu máquina. Sin `neurodanza.config.json` no pasa nada.

## Comandos que escribes tú

| Comando | Qué hace | Cuándo | Qué crea o cambia |
|---|---|---|---|
| `/neurodanza-init` | Detecta repos, lint, tipos, pruebas, app y roles; pregunta lo que falta. | Una vez por proyecto, o para revisar la configuración. | `neurodanza.config.json`, elenco, casos de evals, regla ESLint y sección de `AGENTS.md`. |
| `/neurodanza-feature` | Ciclo completo: entender y planificar, implementar, verificar, revisores y panel según el riesgo, y cerrar. | En cada funcionalidad o corrección. | El código del cambio, su plan y sus evaluaciones. Commit y PR solo si los pides. |
| `/neurodanza-incidencias` | Consulta la rama de desarrollo y graphify (opcional), registra fichas, guarda el antes y el después y corrige lo que pidas. | Para registrar, priorizar o corregir incidencias. | `incidencias/`. Nunca hace commit. |
| `/neurodanza-evals` | Mide a revisores, personas y fantasmas con casos de respuesta conocida. | Al cambiar agentes, personas, umbrales o skills, y una vez por versión. | Un informe en `evals.informes`. Gasta tokens. |
| `/neurodanza-mapa` | Abre el panel con la fase, los subagentes y el plan. | Cuando quieras; se abre solo al empezar un ciclo. | Nada. |

## Lo que corre solo (hooks)

| Evento | Qué hace | ¿Bloquea? |
|---|---|---|
| `SessionStart` | Autoconfiguración, errores conocidos y pasada diaria del autoajuste en segundo plano. | No |
| `PreToolUse` | Barreras, figuras, contrato del director, tiempo por subagente y lecciones. Cubre `Read`, `Grep`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash`, `PowerShell`, `Agent` y `Task`. | Sí, o pregunta |
| `PostToolUse` (editar) | Lint del archivo editado. | Devuelve el error al agente |
| `PostToolUse` (leer, editar, terminal) | Guarda la pila del subagente. | No |
| `Stop` | Lint, tipos, pruebas relacionadas y definición de terminado. | Sí |
| `SubagentStop` | Marca el fin de cada subagente. | No |
| `SessionEnd` | Cierra la ronda del panel que quedó abierta. | No |

## Agentes

| Agente | Qué hace | ¿Edita? |
|---|---|---|
| `revisor-coherencia` | Backend y frontend dicen lo mismo: límites, validaciones, errores, contrato. | No |
| `revisor-permisos` | Permisos por rol, módulo y plan. | No |
| `revisor-ui` | Iconos, temas, idioma, accesibilidad y estados. | No |
| `revisor-docs` | La documentación queda al día. | No |
| `especialista-datos` | Responde sobre modelos, migraciones y ORM. | No |
| `especialista-permisos` | Responde sobre roles y autorización. | No |
| `especialista-a11y` | Responde sobre accesibilidad. | No |
| `especialista-rendimiento` | Responde sobre consultas y pantallas lentas. | No |
| `persona-evaluadora` | Usa la app como una persona y califica de 1 a 10; también juzga recorridos que cambiaron. | No |
| `fantasma` | Prueba una hipótesis de seguridad contra la app local. | No; propone una prueba |
| `implementador` | Hace una tarea en su propio worktree según un contrato. | Sí, solo sus archivos |

Los fantasmas hacen peticiones de verdad a la app local y pueden crear datos de prueba.

## CLI

Se corren desde cualquier carpeta del proyecto: `node <plugin>/lib/<archivo>.mjs <comando>`. `panel.mjs` está en `panel/` y `evals.mjs` en `evals/`. En Git Bash de Windows antepone `MSYS_NO_PATHCONV=1` si pasas rutas como `/api/x`.

### Tu app: `lib/app.mjs`

Guía: [21](21-cli-de-la-app.md).

| Comando | Qué hace |
|---|---|
| `estado` | Dice si la app responde (`app.urls`). |
| `login --como <persona, ROL o admin>` | Entra y guarda la sesión; no muestra el token. |
| `api <METODO> <ruta> [--como …] [--cuerpo <json>] [--max 2000]` | Hace una petición con esa sesión y responde compacto. |
| `abrir <ruta> --como <persona> [--salida <carpeta>]` | Captura una pantalla. |
| `verificar --repo <repo> [--archivos a,b]` | Lint, tipos y pruebas relacionadas en paralelo. |
| `macros` | Lista las macros del proyecto. |
| `macro <nombre> [--<variable> <valor>]` | Usa una macro. |
| `sugeridas` | Comandos largos repetidos que podrían ser macros. |
| `aceptar --id <id> --nombre <n>` | Guarda una sugerida como macro. |
| `descartar --id <id>` | No la vuelve a proponer. |
| `podar` | Lista las macros sin uso. |
| `borrar --nombre <n>` | Borra una macro. |

### Seguridad: `lib/fantasmas.mjs`

Guía: [17](17-seguridad.md).

| Comando | Qué hace |
|---|---|
| `aplica [--base main]` | Dice si el cambio necesita fantasmas y por qué. |
| `hipotesis [--base main]` | Genera las hipótesis del diff. |
| `request --usuario <persona> --metodo M --ruta R [--cuerpo <json>] [--agrupar <campo o a.b>]` | Petición como una persona, solo a hosts de la app. Trae `cortada` y `resumen`. |
| `resultado --json <json>` | Guarda el resultado de una hipótesis. |
| `veredicto` | Lista los confirmados y los «sin evidencia». Sale con 1 si hay uno alto. |

### Panel de personas: `panel/panel.mjs`

Guías: [07](07-panel-personas.md), [18](18-panel-con-recorridos.md) y [23](23-regresion-mecanica.md).

| Comando | Qué hace |
|---|---|
| `elegir --rutas <r1,r2>` | Elige las personas para esas rutas. |
| `usuarios` | Crea en tu app los usuarios de prueba. |
| `navegar --persona <id> --rutas <r1,r2> --salida <carpeta> [--recorrido <id>] [--acciones <json>]` | Recorre la app como esa persona y deja capturas. |
| `repetir [--base main] [--version x] [--ronda <carpeta>]` | Repite sin modelo los recorridos que el cambio toca. |
| `comparar --recorrido <id> [--ejecucion <json>]` | Muestra las regresiones contra la versión aprobada. |
| `calificar --resultado <json>` | Calcula el promedio y si aprueba; reescribe el json. |
| `en-vivo --ronda <carpeta> --personas a,b --titulo … --cambio …` | Abre la ventana en vivo (Windows). |
| `decir --ronda <carpeta> --persona <id> --texto …` | Una persona escribe en la ventana. |
| `oir --ronda <carpeta>` | Lee la conversación de la ventana. |
| `cerrar --ronda <carpeta> --resultado <json>` | Cierra la ronda. |
| `ventana --resultado <json>` | Muestra el resumen final. |
| `crear --rol <ROL>` | Agrega al elenco una persona para un rol. |
| `capturas --id <ID> --momento antes\|despues --ruta /x [--persona <id>]` | Evidencia de una incidencia en las resoluciones configuradas. |
| `app` | Dice si la app responde; si no, cuenta para el fusible. |

### Recorridos: `lib/recorridos.mjs`

Guía: [18](18-panel-con-recorridos.md).

| Comando | Qué hace |
|---|---|
| `guardar --ciclo <c> --archivo <json>` | Valida y guarda el recorrido de una persona. |
| `plan --ciclo <c>` | Texto para que lo apruebes. |
| `aprobar --ciclo <c> [--permanentes a,b]` | Congela lo aprobado; los permanentes van a git. |
| `contrato --ciclo <c> [--personas a,b]` | Sección para el contrato del implementador. |
| `verificar --archivo <json>` | Comprueba que lo congelado no cambió. |

### Incidencias: `lib/incidencias.mjs`

Guía: [24](24-incidencias.md).

| Comando | Qué hace |
|---|---|
| `estado [--sin-red]` | Qué hay y qué falta preguntar. |
| `guardar --rama repo=<rama>` (o `--traer`, `--graphify` con `siempre`, `nunca` o `preguntar`) | Guarda una preferencia local. |
| `base` | Crea lo que falte de `incidencias/`; no sobrescribe. |
| `inventario --area <a> [--escribir]` | Vistas o rutas que no están en el inventario. |
| `traer --repo <r>` | Trae lo nuevo, solo con avance rápido. |
| `alcance --archivos "repo:ruta"` | Pantallas afectadas e incidencias relacionadas. |
| `nueva --area <a> --modulo <M> --titulo …` | Crea una ficha. |
| `evidencia --id <ID> --momento antes\|despues --ruta /api/x` | Guarda petición y respuesta de la app local. |
| `cambiar --id <ID> --estado … [--nota …] [--reabrir]` | Cambia el estado; los del responsable se preguntan. |
| `registro [--area <a>] [--escribir]` | Diferencias entre fichas y registro. |
| `revisar --repo <r> --desde <sha>` | Incidencias abiertas cuyos archivos cambiaron. |
| `reglas --repo <r>` | Cómo son los commits de ese repo. |

### Ciclo y riesgo

Guías: [11](11-mapa-y-ciclo.md), [20](20-odd-en-neurodanza.md) y [23](23-regresion-mecanica.md).

| Comando | Qué hace |
|---|---|
| `ciclo.mjs revisores [--base main]` | Qué revisores, personas y fantasmas lanzar, según el riesgo. |
| `ciclo.mjs presupuesto` | Máximo de pasos por tipo de subagente. |
| `riesgo.mjs [--base main] [--archivos "repo:glob"] [--lineas N]` | Riesgo del cambio, hecho o previsto. |
| `impacto.mjs [--base main] [--archivos "repo:ruta"]` | Pantallas y recorridos que el cambio puede tocar. |

### Documento de la funcionalidad: `lib/funcionalidad.mjs`

Guía: [20](20-odd-en-neurodanza.md).

| Comando | Qué hace |
|---|---|
| `crear --tema <t> --pedido <archivo o texto>` | Abre el documento con tu pedido textual. |
| `spec --tema <t> --texto …` | Agrega un criterio. |
| `tarea --tema <t> --id T1 --specs S1 --texto …` | Agrega una tarea. |
| `hecha --tema <t> --id T1 --evidencia …` | La marca hecha, con su evidencia. |
| `registrar --tema <t> --texto …` | Anota una corrección o decisión. |
| `leer --tema <t> [--specs S1]` | Lo que debe leer un subagente. |

### Pruebas primero: `lib/pruebas.mjs`

Guía: [20](20-odd-en-neurodanza.md).

| Comando | Qué hace |
|---|---|
| `rojo --repo <r> --archivo <prueba> [--dir <carpeta>]` | Corre la prueba; debe fallar. |
| `verde --repo <r> --archivo <prueba>` | La corre otra vez; debe pasar. |
| `estado` | Pruebas con rojo y verde registrados. |

### Modo director: `lib/director.mjs`

Guías: [13](13-director.md) y [16](16-no-perder-trabajo.md).

| Comando | Qué hace |
|---|---|
| `activar` | El agente principal pasa a dirigir y no edita. |
| `desactivar` | Vuelve al modo normal. |
| `estado` | Modo y tareas abiertas. |
| `tareas` | Detalle de las tareas. |
| `preparar --tarea <id> --repos a,b --archivos "a:glob"` | Crea el worktree y el contrato. |
| `integrar --tarea <id> [--forzar]` | Aplica el diff al repo real y borra el worktree. |
| `descartar --tarea <id>` | Borra el worktree sin integrar. |
| `decidir --tarea <id> --hallazgos <json>` | Corregir encima o rebobinar. |
| `rebobinar --tarea <id> --memoria <json>` | Vuelve a la foto original y recuerda por qué falló. |

### Subagentes: `lib/agentes.mjs` y `lib/pilas.mjs`

Guías: [15](15-velocidad.md) y [16](16-no-perder-trabajo.md).

| Comando | Qué hace |
|---|---|
| `agentes.mjs ver` | Tiempo y pasos de cada subagente. |
| `agentes.mjs reiniciar` | Empieza el registro de cero. |
| `pilas.mjs avance --texto …` | Un subagente anota qué hizo y qué falta. |
| `pilas.mjs ver --agente <id>` | Todo lo que hizo. |
| `pilas.mjs resumen --agente <id>` | Lo mismo, corto. |
| `pilas.mjs reenfundar --agente <id>` | Mensaje para lanzar su reemplazo, una sola vez. |
| `pilas.mjs limpiar` | Borra las pilas. |
| `pilas.mjs guardar` | Interno: lo usa el hook. |

### Índice y especialistas: `lib/indice.mjs` y `lib/hotel.mjs`

Guía: [19](19-menos-exploracion.md).

| Comando | Qué hace |
|---|---|
| `indice.mjs generar [--repo <r>]` | Genera o reutiliza el índice. |
| `indice.mjs resumen --repo <r> [--foco …] [--max 60]` | Texto corto para un mensaje. |
| `indice.mjs buscar --que <texto> [--repo <r>]` | Rutas, exportaciones o pantallas que coinciden. |
| `hotel.mjs elegir --tarea <id>` | Qué especialistas aplican. |
| `hotel.mjs preguntas --tarea <id>` | Preguntas pendientes y las que ya están en caché. |
| `hotel.mjs guardar --respuesta <json>` | Guarda una respuesta. |
| `hotel.mjs seccion --tarea <id>` | Lo que ya se sabe, para el contrato. |

### Fondo y fusible: `lib/fondo.mjs` y `lib/fusible.mjs`

Guía: [15](15-velocidad.md).

| Comando | Qué hace |
|---|---|
| `fondo.mjs estado` | Estado de lo que corre en segundo plano. |
| `fondo.mjs esperar [--tope <seg>]` | Espera el resultado del cambio actual. |
| `fondo.mjs cancelar` | Lo detiene. |
| `fondo.mjs trabajar` | Interno: el proceso en segundo plano. |
| `fusible.mjs estado [--capa <c>]` | Fallos de cada capa externa. |
| `fusible.mjs falla --capa <c> --detalle …` | Registra un fallo. |
| `fusible.mjs comprobar --capa <c>` | Corre la comprobación configurada. |
| `fusible.mjs reiniciar [--ciclo <id>]` | Empieza un ciclo con todo en cero. |

### Aprender: `lib/errores.mjs`, `lib/constructos.mjs`, `lib/autoajuste.mjs` y `lib/telemetria.mjs`

Guías: [12](12-errores-conocidos.md), [14](14-constructos.md) y [22](22-autoajuste.md).

| Comando | Qué hace |
|---|---|
| `errores.mjs listar [--todos]` | Errores que se repiten. |
| `errores.mjs buscar --texto …` | Dice si un error ya es conocido. |
| `errores.mjs resolver --firma <f> --solucion …` | Anota cómo se resuelve. |
| `constructos.mjs reflexion --archivo <json>` | Registra un ciclo y evalúa las lecciones. |
| `constructos.mjs playbook --constructo <n>` | Lecciones de un agente. |
| `constructos.mjs estado [--constructo <n>]` | Lecciones por estado. |
| `constructos.mjs evaluar` | Aprueba o descarta las que están a prueba. |
| `constructos.mjs probar`, `descartar` o `archivar` (`--constructo <n> --etiqueta <e>`) | Cambia una lección a mano. |
| `autoajuste.mjs diario [--silencioso]` | Pasada diaria: aprende y propone. |
| `autoajuste.mjs propuestas` | Lo que espera tu decisión. |
| `autoajuste.mjs aplicar`, `descartar` o `revertir` (`--id <id>`) | Decide sobre una propuesta. |
| `autoajuste.mjs informe` | Qué aprendió, con números. |
| `telemetria.mjs recolectar [--transcripts <carpeta>]` | Actualiza el resumen de las sesiones. |
| `telemetria.mjs semanas` | Tokens y sesiones por semana. |

### Evals: `evals/evals.mjs`

Guía: [08](08-evals.md).

| Comando | Qué hace |
|---|---|
| `prompt --revisor <revisor>` | Instrucciones y casos de ese revisor. |
| `personas` | Casos de calibración del panel. |
| `fantasmas` | Casos, hipótesis y corridas de los fantasmas. |
| `calificar --resultados <json>` | Puntúa y escribe el informe; sale con 1 si no pasa. |

## Mantenimiento del plugin

| Script | Qué hace | ¿Gasta tokens? |
|---|---|---|
| `evals/barreras.mjs` | Comprueba las barreras con Claude Code real. Ver [25](25-barreras-y-jueces.md). | Sí |
| `evals/costo.mjs` | Compara costo y resultado sin plugin, con él y con el ciclo. Ver [27](27-costo.md). | Sí |
| `evals/sesgo.mjs` | Compara revisores con un encargo neutro y uno sesgado. | Sí |
| `bench/bench.mjs` | Banco de pruebas. Ver [bench](../bench/README.md). | No |
| `panel/avatares.mjs` | Dibuja los avatares de respaldo. | No |
| `panel/recortar-fotos.mjs --origen <carpeta>` | Recorta las fotos de las personas. | No |
