---
name: neurodanza-feature
description: Ciclo automático para cada funcionalidad o corrección en un proyecto con neurodanza - entender, implementar, verificar, 4 revisores, panel de personas simuladas con la app corriendo y ventana en vivo (aprueba si el promedio supera el umbral) y cerrar. Úsalo siempre que se agregue o corrija algo en un proyecto con neurodanza.config.json.
---

# /neurodanza-feature: ciclo automático de una funcionalidad

Configuración: `neurodanza.config.json` en la raíz del proyecto (si no existe, corre `/neurodanza-init`).
Panel: `<panel>` = `node "<carpeta de este skill>/../../panel/panel.mjs"` (la carpeta del skill aparece arriba como «Base directory»). En Git Bash de Windows antepone `MSYS_NO_PATHCONV=1`.
Nunca agregues coautoría ni firmas de IA en commits, PR o código.

## 0. Entender (obligatorio)
Resume en pocas líneas qué entendiste (qué cambia, pantallas y roles afectados) y **espera el visto bueno del usuario** antes de tocar código. Pregunta solo lo que cambia el resultado.

## 1. Implementar
- Rama de trabajo en cada repo tocado (no trabajes directo en la rama principal).
- Código + pruebas + documentación según la definición de terminado (`reglas.docs` y `retroalimentacion` de la configuración).
- Las barreras y el ciclo de retroalimentación (hooks del plugin) corren solos; corrige lo que marquen.

## 2. Verificar
Corre lint, tipos y pruebas de cada repo tocado (los comandos están en `repos[]` de la configuración). Todo en verde antes de seguir.

## 3. Revisión técnica (4 agentes en paralelo)
Lanza en un solo mensaje `revisor-coherencia`, `revisor-permisos`, `revisor-ui` y `revisor-docs`. A cada uno dale **solo**: qué se pidió (una línea), los repos tocados, la rama y contra qué rama comparar. **No** le pases tu razonamiento ni tus conclusiones.
- Si alguno devuelve `aprobado: false`, corrige los hallazgos altos y medios, vuelve al paso 2 y relanza solo los que reprobaron. Máximo 2 vueltas; si sigue reprobando, informa al usuario.

## 4. Panel de personas (aprueba si el promedio supera `panel.umbral`)
1. **App corriendo con el código nuevo** (`app.levantar` de la configuración). Si depende de algo que solo el usuario puede abrir (Docker Desktop, una VPN…), pídeselo; no lo arranques tú.
2. Usuarios de prueba: `<panel> usuarios`. Si el proyecto tiene un rol sin persona: `<panel> crear --rol <ROL>` y otra vez `<panel> usuarios`.
3. Personas: `<panel> elegir --rutas <rutas afectadas>` (de `panel.min` a `panel.max`, una por rol que puede modificar lo cambiado).
4. **Ventana en vivo** (Windows, si `panel.ventana` es `"windows"`): `<panel> en-vivo --ronda <scratchpad>/panel-<versión>-r<n> --personas <ids> --titulo "Panel de personas · v<versión> · ronda <n>" --cambio "<qué cambió, en lenguaje de usuario>"`.
   Luego lanza en un solo mensaje un agente `persona-evaluadora` por persona, con: su `id`, el comando `<panel>` con ruta absoluta, la carpeta `--ronda`, qué cambió **en lenguaje de usuario**, las rutas, los pasos a intentar y una carpeta de salida en el scratchpad.
   **Antes de anunciar un arreglo en «qué cambió», compruébalo en la pantalla real** (`<panel> navegar`): si lo prometido no aparece, la persona baja la nota con razón.
5. Guarda el resultado en `<panel.evaluaciones>/v<versión>-<tema>.json`:
   ```json
   { "version": "1.4.0", "cambio": "…", "rutas": ["…"], "ronda": 1, "evaluaciones": [ <las respuestas> ] }
   ```
   y ejecuta `<panel> calificar --resultado <ese json>`. Después **cierra la ronda en la ventana**: `<panel> cerrar --ronda <carpeta> --resultado <ese json>` (muestra notas y veredicto y se cierra sola). Hazlo también si no aprobó.
6. **Si no aprobó**: corrige con los hallazgos y sugerencias, vuelve al paso 2, levanta la app de nuevo y evalúa con las mismas personas (`ronda` + 1; conserva las rondas anteriores en `"historial"`). Máximo `panel.maxRondas`; si no llega, informa al usuario con los hallazgos y pregunta si autoriza otra ronda.
7. **Si aprobó**: el cambio cuenta como realizado. El hook de Stop no deja terminar un cambio de pantallas sin una evaluación aprobada de la versión actual.

## 5. Cerrar
- Agrega a la bitácora de la versión la sección «Panel de personas» (personas, notas, promedio, rondas, pendientes).
- Commit y push **solo si el usuario lo pidió**; PR hacia la rama principal, sin merge. Si encadenas PR, recuerda que fusionar un PR apilado no llega a la rama principal: apunta el último a ella.
- Informe final corto: qué cambió, revisores, notas de las personas, promedio, PR.
