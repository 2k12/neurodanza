---
name: neurodanza-evals
description: Evals de neurodanza - mide con casos de respuesta conocida si los 4 revisores detectan errores sembrados sin reprobar cambios limpios, y si el panel de personas califica calibrado y estable. Úsalo después de cambiar agentes, personas, umbrales o skills, y una vez por versión.
---

# /neurodanza-evals: evaluar a los evaluadores

Casos y umbrales: `neurodanza.config.json → evals.casos`. Herramientas: `<evals>` = `node "<carpeta de este skill>/../../evals/evals.mjs"` y `<panel>` = `node "<carpeta de este skill>/../../panel/panel.mjs"` (en Git Bash de Windows antepone `MSYS_NO_PATHCONV=1`).

## 1. Revisores (4 agentes en paralelo, un solo mensaje)
Para cada revisor (`revisor-coherencia`, `revisor-permisos`, `revisor-ui`, `revisor-docs`):
- Genera sus instrucciones: `<evals> prompt --revisor <revisor> > <scratchpad>/evals/<revisor>.txt` (sus casos con errores sembrados + el control limpio).
- Lánzalo con el agente de ese tipo pidiéndole que lea **ese archivo** y siga sus instrucciones exactamente. No le digas qué casos tienen errores.
- Guarda su arreglo JSON tal cual en `resultados.revisores["<revisor>"]`.

## 2. Panel de personas (calibración)
Requiere la app corriendo. `<evals> personas` lista los casos. Por cada uno, lanza un agente `persona-evaluadora` con la persona, el comando `<panel>`, las rutas y el «cambio» del caso (sin ventana en vivo; carpeta de salida en el scratchpad). No le digas qué nota se espera.
- `persona-consistencia` es una corrida independiente del mismo caso que `persona-buena`.
- Guarda cada respuesta en `resultados.personas["<idCaso>"]`.

## 3. Calificar
1. Escribe `<evals.informes>/<AAAA-MM-DD>-v<versión>.json` con `{ "version": "<versión>", "revisores": {…}, "personas": {…} }`.
2. `<evals> calificar --resultados <ese json>`: agrega el `informe` (detección, falsos positivos, calibración) y sale con 1 si no pasa los umbrales.
3. Si no pasa: si el **caso** estaba mal planteado (el revisor o la persona tenía razón), corrígelo y déjalo anotado en el caso (`nota`); si el **agente** falló, ajusta sus instrucciones. Nunca ajustes un caso solo para que pase. Vuelve a correr solo lo que falló.
4. Registra el resultado en la bitácora de la versión e informa al usuario en pocas líneas.
