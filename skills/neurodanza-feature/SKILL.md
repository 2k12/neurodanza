---
name: neurodanza-feature
description: Ciclo automático para cada funcionalidad o corrección en un proyecto con neurodanza - entender, implementar, verificar, 4 revisores, panel de personas simuladas con la app corriendo y ventana en vivo (aprueba si el promedio supera el umbral) y cerrar. Úsalo siempre que se agregue o corrija algo en un proyecto con neurodanza.config.json.
---

# /neurodanza-feature: ciclo automático de una funcionalidad

Configuración: `neurodanza.config.json` en la raíz del proyecto (si no existe, corre `/neurodanza-init`).
Panel: `<panel>` = `node "<carpeta de este skill>/../../panel/panel.mjs"` (la carpeta del skill aparece arriba como «Base directory»). Ciclo: `<ciclo>` = `node "<carpeta de este skill>/../../lib/ciclo.mjs"`. Errores: `<errores>` = `node "<carpeta de este skill>/../../lib/errores.mjs"`. Constructos: `<constructos>` = `node "<carpeta de este skill>/../../lib/constructos.mjs"`. En Git Bash de Windows antepone `MSYS_NO_PATHCONV=1`.
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
- Delega solo tareas acotadas. Cada subagente tiene un presupuesto de pasos (`<ciclo> presupuesto`; revisores 25, personas 40, implementadores 60) y el mapa le avisa al 80 % y al llegar al tope. Díselo en el mensaje: «Presupuesto: N pasos; si llegas, entrega lo que tengas».

## 0. Entender y planificar (obligatorio)
Resume en pocas líneas qué entendiste (qué cambia, pantallas y roles afectados), escribe el plan en el archivo y **espera el visto bueno del usuario** antes de tocar código. Pregunta solo lo que cambia el resultado.
Si el contexto de inicio trae **errores conocidos** del proyecto, tenlos presentes en el plan.

## 1. Implementar
**¿Directo o dirigiendo?** Usa el **modo director** si el cambio toca 2 áreas o repos, más de ~8 archivos o tiene partes que se pueden hacer a la vez, o si el usuario lo pide. Para un cambio chico, implementa directo (es más rápido y no pierde contexto en traspasos).

### Modo director (`<director>` = `node "<carpeta de este skill>/../../lib/director.mjs"`)
Tú diriges: planificas, delegas, integras y verificas. **No editas código** (la barrera lo impide mientras el modo está activo).
1. `<director> activar`.
2. Divide el plan en **tareas con dueños de archivos que no se pisan** (globs por repo). Las que dependen de otra van después de integrar esa. Anota en el plan qué tarea es cada paso.
3. Por tarea: `<director> preparar --tarea <id> --repos <repos> --archivos "<repo:glob,…>" --objetivo "<una línea>" --terminado "<comprobación>" --constructo <implementador-área>`. Responde las rutas de sus worktrees y el **contrato** listo para pegar, con las **lecciones** que ese constructo aprendió en el proyecto. Usa siempre el mismo nombre de constructo para la misma área (`implementador-backend`, `implementador-frontend`, `implementador-migraciones`…): así acumula experiencia.
4. Lanza en **un solo mensaje** un `implementador` por tarea independiente, con el contrato y solo el contexto que necesita (reglas que aplican, errores conocidos relevantes, archivos de referencia). No le pases tu razonamiento completo.
5. Al volver cada uno, lee su JSON. Si `terminado` es `true`: `<director> integrar --tarea <id>`. Si responde `fuera del contrato`, decide si el archivo era necesario (`--forzar`) o si va en otra tarea; si responde `conflicto al aplicar`, crea una tarea de corrección sobre el estado actual. Si `terminado` es `false`, relánzalo con lo pendiente o divide la tarea.
6. Integradas todas, sigue con el paso 2 (verificar) como siempre. Para corregir hallazgos de revisores o personas, crea tareas nuevas.
7. Al cerrar el ciclo: `<director> desactivar` (y `<director> tareas` debe quedar vacío; descarta lo que sobre con `<director> descartar --tarea <id>`).

### Directo
- Rama de trabajo en cada repo tocado (no trabajes directo en la rama principal).
- Código + pruebas + documentación según la definición de terminado (`reglas.docs` y `retroalimentacion` de la configuración).
- Las barreras y el ciclo de retroalimentación (hooks del plugin) corren solos; corrige lo que marquen.
- **Errores conocidos:** si un hook trae `↳ error conocido [firma]… Se resolvió así: …`, aplica esa solución primero. Si dice `↳ se repite [firma]` y lo resuelves, anota cómo: `<errores> resolver --firma <firma> --solucion "<qué hiciste, en una línea>"`. Para buscar uno: `<errores> listar`.

## 2. Verificar
Corre lint, tipos y pruebas de cada repo tocado (los comandos están en `repos[]` de la configuración) **en paralelo** (en un solo mensaje, o en una sola línea con `&`). Todo en verde antes de seguir. El hook `Stop` no repite lo que ya pasó con el mismo código (caché), así que no hace falta correrlo dos veces "por si acaso".

## 3. Revisión técnica (solo los revisores que aplican, en paralelo)
1. `<ciclo> revisores` responde qué revisores lanzar y por qué (`lanzar`, `motivos`, `omitir`): `docs` siempre; `ui` y `permisos` si hay pantallas, interfaz, rutas o accesos; `coherencia` si cambió código en 2 repos o un contrato. Con `ciclo.revisores: "todos"` van siempre los 4.
2. Lanza en un solo mensaje los de `lanzar`. A cada uno dale **solo**: qué se pidió (una línea), los repos tocados, la rama, contra qué rama comparar, su presupuesto de pasos y sus lecciones (`<constructos> playbook --constructo <revisor>`, si tiene). **No** le pases tu razonamiento ni tus conclusiones.
- Si alguno devuelve `aprobado: false`, corrige los hallazgos altos y medios, vuelve al paso 2 y relanza solo los que reprobaron. Máximo 2 vueltas; si sigue reprobando, informa al usuario.

## 4. Panel de personas (aprueba si el promedio supera `panel.umbral`)
1. **App corriendo con el código nuevo** (`app.levantar` de la configuración). Si depende de algo que solo el usuario puede abrir (Docker Desktop, una VPN…), pídeselo; no lo arranques tú.
2. Usuarios de prueba: `<panel> usuarios`. Si el proyecto tiene un rol sin persona: `<panel> crear --rol <ROL>` y otra vez `<panel> usuarios`.
3. Personas: `<panel> elegir --rutas <rutas afectadas>` (de `panel.min` a `panel.max`, una por rol que puede modificar lo cambiado).
4. **Ventana en vivo** (Windows, si `panel.ventana` es `"windows"`): `<panel> en-vivo --ronda <scratchpad>/panel-<versión>-r<n> --personas <ids> --titulo "Panel de personas · v<versión> · ronda <n>" --cambio "<qué cambió, en lenguaje de usuario>"`.
   Luego lanza en un solo mensaje un agente `persona-evaluadora` por persona, con: su `id`, el comando `<panel>` con ruta absoluta, la carpeta `--ronda`, qué cambió **en lenguaje de usuario**, las rutas, los pasos a intentar, una carpeta de salida en el scratchpad y su presupuesto de pasos.
   **Antes de anunciar un arreglo en «qué cambió», compruébalo en la pantalla real** (`<panel> navegar`): si lo prometido no aparece, la persona baja la nota con razón.
5. Guarda el resultado en `<panel.evaluaciones>/v<versión>-<tema>.json`:
   ```json
   { "version": "1.4.0", "cambio": "…", "rutas": ["…"], "ronda": 1, "evaluaciones": [ <las respuestas> ] }
   ```
   y ejecuta `<panel> calificar --resultado <ese json>`. Después **cierra la ronda en la ventana**: `<panel> cerrar --ronda <carpeta> --resultado <ese json>` (muestra notas y veredicto y se cierra sola). Hazlo también si no aprobó. Si lo olvidas, `calificar` la cierra con las notas, y el hook `Stop` cierra la que quede abierta.
6. **Si no aprobó**: corrige con los hallazgos y sugerencias, vuelve al paso 2 y, si la app no recarga sola, levántala de nuevo. En la ronda siguiente (`ronda` + 1; conserva las anteriores en `"historial"`) **vuelve a evaluar solo a las personas con nota ≤ `panel.umbral`** y a las que usan una ruta que tocaste al corregir; las demás conservan su evaluación anterior (cópiala al JSON de la ronda nueva con `"reutilizada": true`). Máximo `panel.maxRondas`; si no llega, informa al usuario con los hallazgos y pregunta si autoriza otra ronda.
7. **Si aprobó**: el cambio cuenta como realizado. El hook de Stop no deja terminar un cambio de pantallas sin una evaluación aprobada de la versión actual.

## 5. Cerrar
- **Reflexión (constructos).** Escribe `<scratchpad>/reflexion.json` con lo que encontraron los jueces en este ciclo y regístralo con `<constructos> reflexion --archivo <ese json>`:
  ```json
  { "ciclo": "<tema>-v<versión>", "version": "<versión>",
    "agentes": [{ "constructo": "implementador-frontend", "pasos": 34, "terminado": true }, { "constructo": "revisor-ui" }],
    "problemas": [{ "constructo": "implementador-frontend", "etiqueta": "ui:aria-label-icono", "fuente": "revisor-ui",
                    "detalle": "botón de solo icono sin aria-label en pedidos/filtros.tsx",
                    "leccion": "Todo botón de solo icono lleva aria-label en el idioma del producto." }] }
  ```
  - Un problema por cada hallazgo **alto o medio** de un revisor, cada queja de una persona que bajó su nota y cada error que se repitió (`<errores> listar`). Anótalo al constructo que lo **causó** (el implementador de esa área, o tú como `implementador` si trabajaste directo); si un revisor dejó pasar algo que encontró otro juez, anótale el problema también al revisor.
  - `etiqueta` = `area:tema` en minúsculas, **estable**: reutiliza la misma para el mismo problema (`<constructos> estado` muestra las que existen). `leccion` = una regla accionable, no un relato.
  - Si no hubo problemas, regístralo igual con `"problemas": []`: los ciclos limpios también cuentan para medir.
  - La respuesta dice qué lecciones pasaron a prueba, se aprobaron o se descartaron. Inclúyelo en el informe. Si alguna lección de un revisor está a prueba, recomienda correr `/neurodanza-evals`.
- Agrega a la bitácora de la versión la sección «Panel de personas» (personas, notas, promedio, rondas, pendientes).
- Errores del ciclo: si resolviste algo que un hook marcó como `se repite`, verifica que quedó anotado (`<errores> listar`). El catálogo (`errores.archivo`) se versiona con el proyecto.
- Marca el plan completo y bórralo (o déjalo, si el usuario quiere conservarlo); `.neurodanza/plan.md` y `.neurodanza/estado.json` no van a git.
- Commit y push **solo si el usuario lo pidió**; PR hacia la rama principal, sin merge. Si encadenas PR, recuerda que fusionar un PR apilado no llega a la rama principal: apunta el último a ella.
- Informe final corto: qué cambió, revisores (lanzados y omitidos), notas de las personas, promedio, errores nuevos o resueltos, lecciones (a prueba, aprobadas, descartadas), PR.
