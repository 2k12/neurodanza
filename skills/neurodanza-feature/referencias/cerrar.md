# Cerrar (riesgo medio o alto)

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
