---
name: neurodanza-feature
description: Ciclo automático para cada funcionalidad o corrección en un proyecto con neurodanza - entender, implementar, verificar, revisores según el riesgo del cambio, panel de personas simuladas con la app corriendo y ventana en vivo (aprueba si el promedio supera el umbral) y cerrar. Úsalo siempre que se agregue o corrija algo en un proyecto con neurodanza.config.json.
---

# /neurodanza-feature: ciclo automático de una funcionalidad

Configuración: `neurodanza.config.json` en la raíz del proyecto (si no existe, corre `/neurodanza-init`).
Panel: `<panel>` = `node "<carpeta de este skill>/../../panel/panel.mjs"` (la carpeta del skill aparece arriba como «Base directory»). Ciclo: `<ciclo>` = `node "<carpeta de este skill>/../../lib/ciclo.mjs"`. Errores: `<errores>` = `node "<carpeta de este skill>/../../lib/errores.mjs"`. Constructos: `<constructos>` = `node "<carpeta de este skill>/../../lib/constructos.mjs"`. Fusible: `<fusible>` = `node "<carpeta de este skill>/../../lib/fusible.mjs"`. Fondo: `<fondo>` = `node "<carpeta de este skill>/../../lib/fondo.mjs"`. Pilas: `<pilas>` = `node "<carpeta de este skill>/../../lib/pilas.mjs"`. Fantasmas: `<fantasmas>` = `node "<carpeta de este skill>/../../lib/fantasmas.mjs"`. Agentes: `<agentes>` = `node "<carpeta de este skill>/../../lib/agentes.mjs"`. Recorridos: `<recorridos>` = `node "<carpeta de este skill>/../../lib/recorridos.mjs"`. Índice: `<indice>` = `node "<carpeta de este skill>/../../lib/indice.mjs"`. Hotel: `<hotel>` = `node "<carpeta de este skill>/../../lib/hotel.mjs"`. App: `<app>` = `node "<carpeta de este skill>/../../lib/app.mjs"`. En Git Bash de Windows antepone `MSYS_NO_PATHCONV=1`.
Nunca agregues coautoría ni firmas de IA en commits, PR o código.
Si está instalado `neurodanza-mapa`, el usuario ve en un panel la fase y cada subagente en vivo; se abre solo (o con `/neurodanza-mapa`).

## Planificador + ejecutor
Trabajas en dos papeles: **planificas** (paso 0) y **ejecutas** el plan paso por paso. El plan vive en un archivo (`ciclo.plan`, por defecto `.neurodanza/plan.md`), no solo en tu contexto: si la conversación se compacta o te pierdes, **vuelve a leerlo** y sigue por el primer paso sin marcar.
```md
# Plan · <qué se pidió, en una línea>
- [ ] 1. <paso concreto> → hecho cuando: <comprobación verificable>
- [ ] 2. …
```
- De 3 a 8 pasos, cada uno pequeño y con su condición de terminado. Márcalo `[x]` apenas se cumpla (no al final).
- Si el plan cambia (un revisor encontró algo), agrega o edita pasos en el archivo; no improvises fuera de él.
- Delega solo tareas acotadas. Cada subagente tiene un presupuesto de pasos (`<ciclo> presupuesto`; revisores 25, personas 20, implementadores 60) y el mapa le avisa al 80 % y al llegar al tope. Díselo en el mensaje: «Presupuesto: N pasos; si llegas, entrega lo que tengas».

## 0. Entender y planificar (obligatorio)
Empieza el ciclo con `<fusible> reiniciar` y `<agentes> reiniciar` (capas externas, tiempos, rechazos y cuarentenas en cero).
Si el contexto de inicio dice que la sesión está **dentro de un componente** (p. ej. `frontend/`), pídele al usuario `/add-dir` de la raíz antes de seguir (no lo hagas tú).
**Riesgo (proporcionalidad).** Antes de planificar, prevé el nivel con los archivos que vas a tocar: `<riesgo> --archivos "<repo:glob,…>"` (`<riesgo>` = `node "<carpeta de este skill>/../../lib/riesgo.mjs"`). Responde `nivel`, `motivos` y `plan` (qué corre). El nivel real se confirma con el diff en el paso 3 (`<ciclo> revisores` lo trae en `riesgo`); si sube, sigue el plan del nivel nuevo.
- **Bajo** (solo docs o pruebas, o hasta `ciclo.riesgo.lineasBajo` líneas en un repo sin contratos ni archivos sensibles): sin plan en archivo, recorridos, especialistas, revisores ni panel. Si el pedido es claro y pide el cambio, di en una línea qué vas a hacer y hazlo: pasos 1 (directo), 2 y 5.
- **Medio:** plan corto; un solo revisor y, si hay pantallas, una persona (con su recorrido).
- **Alto** (archivos de `ciclo.riesgo.altos` o migraciones, código en 2 repos, o más de `ciclo.riesgo.lineasAlto` líneas): el ciclo completo, como sigue.

**Documento de la funcionalidad (riesgo alto, o medio con modo director).** Antes de escribir código: guarda el pedido del usuario **tal cual** en `<scratchpad>/pedido.txt` y `<funcionalidad> crear --tema <tema> --pedido <scratchpad>/pedido.txt` (`<funcionalidad>` = `node "<carpeta de este skill>/../../lib/funcionalidad.mjs"`). Queda en `.neurodanza/funcionalidades/<tema>.md` con el pedido textual en L1 y una spec `S#` por cada frase entre comillas. Agrega los criterios de aceptación con `<funcionalidad> spec --tema <tema> --texto "…"` y una tarea por paso del plan (`<funcionalidad> tarea --tema <tema> --id T1 --specs S1,S2 --texto "…"`). Dile al usuario en una línea qué documento creaste y cuántas tareas tiene.
- Los subagentes reciben **referencias**, no tu resumen: el contrato del implementador lleva el pedido textual y sus specs (`preparar … --funcionalidad <tema> --specs S1,S2`); a revisores y personas pásales `<funcionalidad> leer --tema <tema>`.
- Una tarea se marca hecha **solo con evidencia observada**: `<funcionalidad> hecha --tema <tema> --id T1 --evidencia "<comando y resultado>" [--commit <sha>]`.
- Si el usuario corrige o cambia algo, `<funcionalidad> registrar --tema <tema> --texto "…"` y reescribe solo la spec afectada (`spec` agrega; si cambia una, regístralo y agrega la nueva).
- Al retomar tras un corte, lee el documento antes que el código.

Resume en pocas líneas qué entendiste (qué cambia, pantallas y roles afectados) y el riesgo previsto (`texto` de `<riesgo>`), escribe el plan en el archivo y **espera el visto bueno del usuario** antes de tocar código (salvo riesgo bajo). Pregunta solo lo que cambia el resultado.

**Recorridos acordados (si el cambio toca pantallas y el riesgo no es bajo), antes del visto bueno:**
1. `<panel> elegir --rutas <rutas afectadas>` y lanza en **un solo mensaje** un `persona-evaluadora` por persona elegida, **en modo recorrido**: su `id`, qué se va a construir (en lenguaje de usuario), las rutas, el ciclo (`<tema>-v<versión>`) y el comando `<recorridos>` con ruta absoluta. Cada una escribe su **recorrido futuro** (pasos verificables con lo que espera ver, `maxClics`, `maxSegundos` y `porQue`) y lo guarda en `.neurodanza/recorridos/<ciclo>/<persona>.json`. Presupuesto: 8 pasos.
2. `<recorridos> plan --ciclo <ciclo>` y pega el texto en el plan, junto con lo demás: el usuario aprueba **plan y recorridos juntos**, y puede editarlos (`<recorridos> guardar` con el archivo corregido). Pregúntale si alguno debe ser **permanente** (se repite entre versiones: se compara con las anteriores).
3. Con el visto bueno: `<recorridos> aprobar --ciclo <ciclo> [--permanentes id1,id2]`. Lo aprobado queda congelado con su hash; los permanentes se copian a `panel.recorridos` (en git) con su id.
Si el contexto de inicio trae **errores conocidos** del proyecto, tenlos presentes en el plan.
**Índice pre-cocido:** antes de explorar el código, `<indice> resumen --repo <r> --foco <tema, ruta o glob>` (y `<indice> buscar --que <texto>`) te dice dónde está cada cosa sin leer el repo; se genera solo y se reutiliza mientras el commit y los cambios no cambien.

## 1. Implementar
**¿Directo o dirigiendo?** Usa el **modo director** si el cambio toca 2 áreas o repos, más de ~8 archivos o tiene partes que se pueden hacer a la vez, o si el usuario lo pide. Con riesgo bajo o medio, o un cambio chico, implementa directo (es más rápido y no pierde contexto en traspasos).

### Modo director (`<director>` = `node "<carpeta de este skill>/../../lib/director.mjs"`)
Tú diriges: planificas, delegas, integras y verificas. **No editas código** (la barrera lo impide mientras el modo está activo).
1. `<director> activar`.
2. Divide el plan en **tareas con dueños de archivos que no se pisan** (globs por repo). Las que dependen de otra van después de integrar esa. Anota en el plan qué tarea es cada paso.
3. **Especialistas antes de delegar** (`hotel.activo`, solo con riesgo alto): por tarea, `<hotel> preguntas --archivos "<repo:glob,…>"` (los mismos globs que le darás a `preparar`) dice qué especialistas aplican (datos si toca modelos o migraciones, a11y si toca pantallas, permisos si toca roles o endpoints, rendimiento si toca servicios o listados), sus preguntas **pendientes** y su contexto pre-cocido; las que ya están en caché no se vuelven a preguntar. Lanza en **un solo mensaje** un `especialista-<área>` por cada uno con `lanzar: true` (sus preguntas pendientes, su contexto y las rutas de los repos; presupuesto `hotel.maxPasos` pasos y `hotel.maxSegundos` s) y guarda cada respuesta con `<hotel> guardar --respuesta <json>`. Solo tú consultas: si después un implementador necesita algo que no está en su contrato, lo pide en `pendiente` y tú decides.
4. Por tarea: `<director> preparar --tarea <id> --repos <repos> --archivos "<repo:glob,…>" --objetivo "<una línea>" --terminado "<comprobación>" --constructo <implementador-área> [--funcionalidad <tema> --specs <S#,…>] [--recorridos <ciclo> --personas <ids>]` (con recorridos acordados, las de las pantallas de esa tarea: entran en el contrato como criterio de terminado). Responde las rutas de sus worktrees y el **contrato** listo para pegar, con las **lecciones** que ese constructo aprendió en el proyecto el **resumen del índice** enfocado en sus archivos («los archivos de esta tarea probablemente son…») y lo que respondieron los especialistas («Lo que ya sabemos de este proyecto»). Usa siempre el mismo nombre de constructo para la misma área (`implementador-backend`, `implementador-frontend`, `implementador-migraciones`…): así acumula experiencia.
5. Lanza en **un solo mensaje** un `implementador` por tarea independiente, con el contrato y solo el contexto que necesita (reglas que aplican, errores conocidos relevantes, archivos de referencia). No le pases tu razonamiento completo.
6. Al volver cada uno, lee su JSON. Si `terminado` es `true`: `<director> integrar --tarea <id>`. Si responde `fuera del contrato`, decide si el archivo era necesario (`--forzar`) o si va en otra tarea; si responde `conflicto al aplicar`, crea una tarea de corrección sobre el estado actual. Si `terminado` es `false`, relánzalo con lo pendiente o divide la tarea.
7. Integradas todas, sigue con el paso 2 (verificar) como siempre. Para corregir hallazgos de revisores, personas o fantasmas, decide primero cómo:
   - `<director> decidir --tarea <id> --hallazgos <json>` (los hallazgos de esa tarea, con `gravedad`, `archivo`, `problema` y, si sabes, `lineas`) responde **corregir** (algo puntual: crea una tarea de corrección encima) o **rebobinar** (hallazgos altos, de diseño, o una corrección que supera `director.rebobinar.umbralCorreccion` del diff).
   - **Rebobinar con memoria:** `<director> rebobinar --tarea <id> --memoria <json>` (`{ "motivo", "hallazgos", "notas": [notas de personas], "constructo" }`). Guarda el intento fallido como muerte, vuelve el worktree a la **misma foto original** y deja un contrato con «Intentos anteriores y por qué fallaron». Lanza un implementador nuevo con ese contrato (descripción `<tarea> ✝ <n>`). Si responde con tope (`director.rebobinar.maxMuertes`), no rebobines más: informa al usuario con los intentos y sus hallazgos.
8. Al cerrar el ciclo: `<director> desactivar` (y `<director> tareas` debe quedar vacío; descarta lo que sobre con `<director> descartar --tarea <id>`).

### Directo
- Rama de trabajo en cada repo tocado (no trabajes directo en la rama principal).
- Código + pruebas + documentación según la definición de terminado (`reglas.docs` y `retroalimentacion` de la configuración). Con recorridos acordados, también son criterio de terminado: `<recorridos> contrato --ciclo <ciclo>` dice qué pasos deben poder hacerse.
- Las barreras y el ciclo de retroalimentación (hooks del plugin) corren solos; corrige lo que marquen.
- **Errores conocidos:** si un hook trae `↳ error conocido [firma]… Se resolvió así: …`, aplica esa solución primero. Si dice `↳ se repite [firma]` y lo resuelves, anota cómo: `<errores> resolver --firma <firma> --solucion "<qué hiciste, en una línea>"`. Para buscar uno: `<errores> listar`.
- **La app por comandos (`<app>`), en vez de escribir scripts a mano:** `<app> api <METODO> <ruta> --como <persona|ROL|admin> [--cuerpo '<json>']` entra con la sesión de esa persona (en caché) y muestra la respuesta compacta; `<app> estado` dice si la app responde; `<app> abrir <ruta> --como <persona>` deja una captura. Las tareas propias del proyecto son **macros**: `<app> macros` las lista y `<app> macro <nombre> --<variable> <valor>` corre una. Si la barrera avisa que un comando largo ya se repitió, propónle al usuario guardarlo (`<app> sugeridas`; con su visto bueno, `<app> aceptar --id <id> --nombre <nombre> [--comando "<con {variables}>"]`, que también le pide aprobación en la ventana de permisos). Al cerrar, si `<app> podar` lista macros sin uso, propónle borrarlas.

## 2. Verificar
Corre lint, tipos y pruebas **relacionadas** de cada repo tocado **en paralelo**: `<app> verificar --repo <repo> --archivos <a,b>` (uno por repo, en un solo mensaje) los corre a la vez con los comandos de `repos[]` y solo muestra el final de lo que falla. Todo en verde antes de seguir. El hook `Stop` no repite lo que ya pasó con el mismo código (caché) y corre la **suite completa en segundo plano** (`repos[].suite`): no la corras tú. Comandos que pueden no terminar (servidores, modo watch, suites completas) llevan `timeout` o van en segundo plano: la barrera rechaza los que no y te dice cómo correrlos.

## 3. Revisión técnica y panel de personas, en el mismo turno
Con el diff verificado, lanza **en el mismo turno** los revisores que aplican y el panel de personas: corren **a la vez**, sobre **una única app levantada** antes de lanzar.

**Preparar (antes de lanzar nada):**
1. Revisores: `<ciclo> revisores` responde cuáles lanzar y por qué (`lanzar`, `motivos`, `omitir`) **según el riesgo del diff** (`riesgo.nivel`, `riesgo.texto`, `riesgo.plan`): de los que aplican (`docs` siempre; `ui` y `permisos` si hay pantallas, interfaz, rutas o accesos; `coherencia` si cambió código en 2 repos o un contrato), con riesgo bajo no corre ninguno, con medio el de más prioridad (permisos, coherencia, ui, docs) y con alto todos. Lanza exactamente `lanzar`. Con `ciclo.revisores: "todos"` van siempre los 4. Si `riesgo.plan.personas` es 0, no hay panel en este ciclo (el hook `Stop` no lo exige) y `fantasmas.lanzar` dice si van fantasmas (`fantasmas.cantidad`).
2. Si el cambio toca pantallas: **app corriendo con el código nuevo**, una sola vez (`app.levantar`, en segundo plano). Si depende de algo que solo el usuario puede abrir (Docker Desktop, una VPN…), pídeselo; no lo arranques tú. Comprueba que responde: `<panel> app`.
   - **Fusible:** si `<panel> app` falla, revisa la causa una vez y vuelve a probar. Al **segundo fallo** la capa queda fundida (`<panel> app` sale con 3): **no reintentes más** en este ciclo, lanza solo a los revisores y el panel queda **pendiente** (ni aprobado ni reprobado): díselo al usuario al cerrar y que él decida. Lo mismo con Chromium o el login (`panel.mjs` los registra solo). `<fusible> estado` muestra cómo está cada capa.
3. Personas: `<panel> usuarios` (si el proyecto tiene un rol sin persona: `<panel> crear --rol <ROL>` y otra vez `<panel> usuarios`) y `<panel> elegir --rutas <rutas afectadas> --n <riesgo.plan.personas>` (con riesgo alto, de `panel.min` a `panel.max`, una por rol que puede modificar lo cambiado; con medio, una).
4. **Ventana en vivo** (Windows, si `panel.ventana` es `"windows"`): `<panel> en-vivo --ronda <scratchpad>/panel-<versión>-r<n> --personas <ids> --titulo "Panel de personas · v<versión> · ronda <n>" --cambio "<qué cambió, en lenguaje de usuario>"`. **Antes de anunciar un arreglo en «qué cambió», compruébalo en la pantalla real** (`<panel> navegar`): si lo prometido no aparece, la persona baja la nota con razón.

**Fantasmas** (si `<ciclo> revisores` dice `fantasmas.lanzar: true`: el diff toca endpoints, permisos, roles, consultas o pantallas que escriben): `<fantasmas> hipotesis` genera hasta `fantasmas.max` hipótesis concretas (rol atacante, recurso, técnica). Requieren la app levantada.

**Lanzar, en UN SOLO mensaje:** los revisores de `lanzar`, un agente `persona-evaluadora` por persona y un `fantasma` por hipótesis (si hay).
- A cada fantasma: su hipótesis (el JSON), el comando `<fantasmas>` con ruta absoluta, qué personas usar (dueño del recurso y `rolAtacante`) y el framework de pruebas del repo. No edita nada: deja su resultado con `<fantasmas> resultado`.
- A cada revisor: **solo** qué se pidió (una línea), los repos tocados, la rama, contra qué rama comparar, su presupuesto de pasos y de tiempo, el resumen del índice enfocado en los archivos del diff (`<indice> resumen --repo <r> --foco <archivos del diff>`) y sus lecciones (`<constructos> playbook --constructo <revisor>`, si tiene). **No** le pases tu razonamiento ni tus conclusiones.
- A cada persona: su `id`, el comando `<panel>` con ruta absoluta, la carpeta `--ronda`, qué cambió **en lenguaje de usuario**, las rutas, **su recorrido aprobado** (archivo de `.neurodanza/recorridos/<ciclo>/`, si hay), una carpeta de salida en el scratchpad, las pantallas del índice que tocó el diff (`<indice> resumen --foco <rutas>`) y su presupuesto de pasos y de tiempo. Lo ejecuta primero (`navegar --recorrido`) y califica paso por paso contra lo que predijo. Si el recorrido es permanente, antes de calificar corre `<panel> comparar` y dice en la ventana las **regresiones de experiencia** frente a la última versión aprobada (más clics, más tiempo, un paso que ya no cumple, errores nuevos). Cada una corre con su usuario y su propio navegador (no comparten sesión), a la vez que las demás.

**Juntar los resultados:**
0. Fantasmas: `<fantasmas> veredicto` lista los confirmados. **Un confirmado de gravedad alta cuenta como un hallazgo alto de revisor** (aplica la regla siguiente): crea una tarea para que el implementador corrija **e integre la prueba propuesta** (`prueba.propuesta` del resultado). Los no confirmados se descartan sin más.
1. Revisores: si alguno devuelve `aprobado: false` con un hallazgo **alto**, el panel termina su ronda, pero **esa ronda no puede aprobar el cambio**: anótalo en el JSON del panel (`"revisores": "reprobados"`; si todos aprobaron, `"revisores": "aprobados"`). Corrige los hallazgos altos y medios, vuelve al paso 2 y relanza solo los revisores que reprobaron (máximo 2 vueltas; si sigue reprobando, informa al usuario) y una ronda nueva del panel.
2. Panel: guarda el resultado en `<panel.evaluaciones>/v<versión>-<tema>.json`:
   ```json
   { "version": "1.4.0", "cambio": "…", "rutas": ["…"], "ronda": 1, "revisores": "aprobados", "evaluaciones": [ <las respuestas> ] }
   ```
   y ejecuta `<panel> calificar --resultado <ese json>` (un paso crítico del recorrido que no cumple limita la nota de esa persona a `panel.notaMaxSiFalla`; las regresiones de experiencia la bajan según la regla de docs/18 y se muestran en el chat; los recorridos permanentes guardan esta versión en su memoria, `panel.memoria`; con `"revisores": "reprobados"` la ronda no aprueba aunque el promedio alcance; con la app o Chromium fundidos y notas faltantes, queda `pendiente`). Después **cierra la ronda en la ventana**: `<panel> cerrar --ronda <carpeta> --resultado <ese json>` (muestra notas y veredicto y se cierra sola). Hazlo también si no aprobó. Si lo olvidas, `calificar` la cierra con las notas. No la cierres antes de tener todas las evaluaciones: las personas corren en segundo plano y siguen probando aunque tu turno termine.
3. **Si el panel no aprobó**: corrige con los hallazgos y sugerencias, vuelve al paso 2 y, si la app no recarga sola, levántala de nuevo. En la ronda siguiente (`ronda` + 1; conserva las anteriores en `"historial"`) **vuelve a evaluar solo a las personas con nota ≤ `panel.umbral`** y a las que usan una ruta que tocaste al corregir; las demás conservan su evaluación anterior (cópiala al JSON de la ronda nueva con `"reutilizada": true`). Máximo `panel.maxRondas`; si no llega, informa al usuario con los hallazgos y pregunta si autoriza otra ronda.
4. **Si aprobó** (y los revisores también): el cambio cuenta como realizado. El hook de Stop no deja terminar un cambio de pantallas sin una evaluación aprobada de la versión actual, salvo que el panel haya quedado pendiente por el fusible (entonces lo informa y decide el usuario).

## 4. Subagentes lentos, trabados o en cuarentena: re-enfundar una sola vez
Cada subagente tiene un tope de tiempo (`ciclo.maxSegundos`: revisores 5 min, personas 3,5 min, implementadores 15 min). Al 80 % recibe un aviso; al 100 % la barrera le rechaza toda herramienta y solo puede entregar su respuesta. Los hooks guardan su pila (qué leyó, editó y corrió) y cada 10 pasos él anota una línea de avance.

**Re-enfundar** cuando un subagente vuelve cortado por tiempo o pasos, aparece **sin latido** en el mapa (o en `.neurodanza/agentes/`) sin un comando largo en curso, entrega con pendientes críticos, o cae en **cuarentena**:
1. `<pilas> reenfundar --agente <agent_id>` genera el mensaje completo: el contrato, lo que ya hizo, qué archivos leyó y siguen iguales (que no relea) y cuáles cambiaron, los comandos que fallaron, lo que falta y el presupuesto **restante**. En el modo director, el reemplazo trabaja en el **mismo worktree**.
2. Lanza un agente nuevo del mismo tipo con ese mensaje y la descripción que sugiere (`<tarea> ↻ 2`).
3. **En cuarentena** (`⛔`, tras `figuras.cuarentena` rechazos): en el mensaje, quita la acción que causó los bloqueos (los motivos están en su registro, `<agentes> ver`) y agrega una advertencia: «tu antecesor fue bloqueado por …; no lo intentes, entrega o pide al director».
4. **Una sola vez por tarea** (`reenfundar` lo hace cumplir). Si el reemplazo también se corta o cae en cuarentena, no relances: informa al usuario con `<pilas> resumen --agente <id>`.

Solo tú (el agente principal) lanzas subagentes: con las figuras activas, la barrera se lo rechaza a cualquier subagente.

## 5. Cerrar
- **Pilas:** `<pilas> limpiar` al cerrar el ciclo (no van a git).
- **Reflexión con las muertes:** cada rebobinado ya pasó como evidencia a los constructos; inclúyelo en el informe.
- **Suite completa:** `<fondo> esperar` debe salir con 0 (la suite completa pasó para el cambio actual). Si sale con 1, corrige; si sale con 2 (sigue corriendo o es de otro cambio), espera o díselo al usuario. Los `Stop` intermedios no bloquean por esto; el cierre sí.
- **Fusible:** si alguna capa quedó fundida (`<fusible> estado`), el informe dice «no se pudo verificar: <capa> (motivo)» y el panel queda pendiente: pregúntale al usuario cómo sigue.
- **Reflexión (constructos).** Escribe `<scratchpad>/reflexion.json` con lo que encontraron los jueces en este ciclo y regístralo con `<constructos> reflexion --archivo <ese json>`:
  ```json
  { "ciclo": "<tema>-v<versión>", "version": "<versión>",
    "agentes": [{ "constructo": "implementador-frontend", "pasos": 34, "terminado": true }, { "constructo": "revisor-ui" }],
    "problemas": [{ "constructo": "implementador-frontend", "etiqueta": "ui:aria-label-icono", "fuente": "revisor-ui",
                    "detalle": "botón de solo icono sin aria-label en pedidos/filtros.tsx",
                    "leccion": "Todo botón de solo icono lleva aria-label en el idioma del producto.",
                    "activadores": { "archivos": ["**/*.tsx"], "texto": ["<button"] } }] }
  ```
  - Un problema por cada hallazgo **alto o medio** de un revisor, cada queja de una persona que bajó su nota y cada error que se repitió (`<errores> listar`). Anótalo al constructo que lo **causó** (el implementador de esa área, o tú como `implementador` si trabajaste directo); si un revisor dejó pasar algo que encontró otro juez, anótale el problema también al revisor.
  - `activadores` (opcional): globs de archivos y patrones de texto (`/regex/` o literal) que indican cuándo hace falta la lección. Cuando un subagente de ese constructo lee o edita un archivo que coincide, la barrera le recuerda la lección una sola vez. Si no los pones, se sugieren desde los archivos del `detalle` (por extensión) y quedan a la vista en `aprendido/<constructo>.md` del PR, donde se pueden corregir.
  - `etiqueta` = `area:tema` en minúsculas, **estable**: reutiliza la misma para el mismo problema (`<constructos> estado` muestra las que existen). `leccion` = una regla accionable, no un relato.
  - Si no hubo problemas, regístralo igual con `"problemas": []`: los ciclos limpios también cuentan para medir.
  - La respuesta dice qué lecciones pasaron a prueba, se aprobaron o se descartaron. Inclúyelo en el informe. Una aprobada aparece como línea nueva en `<repo>/.neurodanza/aprendido/<constructo>.md` (lo versionado): inclúyela en el commit si el usuario pidió commit. Si alguna lección de un revisor está a prueba, recomienda correr `/neurodanza-evals`.
- Agrega a la bitácora de la versión la sección «Panel de personas» (personas, notas, promedio, rondas, pendientes).
- Errores del ciclo: si resolviste algo que un hook marcó como `se repite`, verifica que quedó anotado (`<errores> listar`). El catálogo (`errores.archivo`) se versiona con el proyecto.
- Marca el plan completo y bórralo (o déjalo, si el usuario quiere conservarlo); `.neurodanza/plan.md` y `.neurodanza/estado.json` no van a git.
- Commit y push **solo si el usuario lo pidió**; PR hacia la rama principal, sin merge. Si encadenas PR, recuerda que fusionar un PR apilado no llega a la rama principal: apunta el último a ella.
- Informe final corto: qué cambió, revisores (lanzados y omitidos), notas de las personas, promedio, errores nuevos o resueltos, lecciones (a prueba, aprobadas, descartadas), PR.
