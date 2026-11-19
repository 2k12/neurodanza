# 22. Autoajuste: el harness se mide y se ajusta solo

Hasta la 1.1.2, cada mejora del plugin dependía de que alguien notara el problema: el conteo de líneas del riesgo, por ejemplo, se arregló porque una sesión lo anotó en la bitácora. El plugin ya tenía tres formas de aprender (errores conocidos, lecciones de los constructos y macros sugeridas), pero cada una solo veía lo que pasaba por su hook, dentro de una sesión. Nada miraba **entre sesiones**.

El autoajuste lee lo que pasó en todas las sesiones del proyecto y alimenta esas tres formas, con el mismo freno que ya tenían. Lo que cambia la configuración del equipo lo propone y lo aplica el usuario, y después se mide si sirvió.

## De dónde sale: la telemetría

`lib/telemetria.mjs` lee los transcripts de Claude Code del proyecto (`~/.claude/projects/<carpeta>/`, con los de los subagentes en `<sesión>/subagents/` y su tipo en `.meta.json`). Toma la carpeta principal **y la de cada repo**: una sesión abierta dentro de `frontend/` también cuenta. **No agrega hooks**, así que no suma latencia a ninguna herramienta.

Por sesión guarda un resumen, no el contenido:
- tokens (una vez por mensaje);
- herramientas;
- comandos normalizados y los que fallan, con la firma de su error;
- rechazos de las barreras (`PreToolUse:<herramienta> hook error: …`), sin contar el «no» del usuario a un permiso;
- cortes por tiempo o cuarentena;
- subagentes lanzados.

Es incremental: solo relee lo que cambió.

```bash
node lib/telemetria.mjs recolectar     # .neurodanza/telemetria/resumen.json
node lib/telemetria.mjs semanas        # tokens, sesiones, rechazos, cortes y fallos por semana
```

## Qué aprende y qué propone

Una vez al día, la primera sesión lanza `autoajuste.mjs diario` **en segundo plano** (no demora el inicio) y deja el resultado para la sesión siguiente.

| Lo que se repite | Qué hace | Con qué freno |
|---|---|---|
| El mismo rechazo de una barrera (≥ 3 veces) | Lección del agente que lo provoca (`principal` o el tipo de subagente), con el texto del rechazo | La de siempre de los constructos: candidata → a prueba → **aprobada solo si el rechazo baja por día**, si no se descarta sola. Cada día de telemetría cuenta como un ciclo, con todos los agentes que trabajaron (también los que no tuvieron problemas) |
| El mismo error de comando (≥ 3 veces, aunque el comando cambie) | Entra al catálogo de **errores conocidos**, que se muestra al iniciar; con `errores.mjs resolver` se le anota la solución | Una vez por sesión, como los que marcan los hooks |
| Un comando largo (≥ `cli.repetidoMin`) repetido en ≥ 2 sesiones | Sugerencia de macro (`app.mjs sugeridas`) | La macro la acepta el usuario |
| Un tipo de subagente cortado por tiempo (≥ 3 veces en ≥ 2 sesiones) | **Propuesta**: subir su tope (`ciclo.maxSegundos.<clase>` ×1,5) | La aplica el usuario. Después, con 5 sesiones de esa clase, **mantener** si los cortes por sesión bajaron al menos 30 %, si no, **revertir** |
| Un comando configurado (`repos[].lint`, `tipos`…) que falla siempre | **Propuesta**: corregirlo en la configuración | Se acepta y se arregla a mano. Después se mide si dejó de fallar |
| Un script del plugin que falla (≥ 3 veces) | **Propuesta para el plugin**, con el ejemplo | Informativa |

Los cortes no cuentan como rechazos: llegan como error del hook, pero no son una regla que el agente rompió.

Las lecciones del **agente principal** aparecen al iniciar la sesión («lecciones de este proyecto»). Las de los subagentes llegan por el operador, como siempre.

```bash
node lib/autoajuste.mjs diario         # a mano: recolecta, aprende, propone y evalúa
node lib/autoajuste.mjs propuestas     # pendientes y evaluaciones
node lib/autoajuste.mjs aplicar --id presupuesto:revisor    # la barrera se lo pregunta al usuario
node lib/autoajuste.mjs revertir --id presupuesto:revisor
node lib/autoajuste.mjs descartar --id config:api.lint
node lib/autoajuste.mjs informe        # qué aprendió, qué cambió y tokens por semana
```

Los ajustes aplicados quedan en `.claude/neurodanza-ajustes.json` (en git), con el valor de antes y la fecha, para poder evaluarlos y revertirlos. Lo demás queda en `.neurodanza/` (local).

## Medido

**Banco (`autoajuste`).** Tres sesiones sembradas (`bench/transcripts.mjs`) con lo que debería aprender:
- un rechazo de la barrera 4 veces;
- el mismo error de comillas en 3 comandos distintos;
- un comando largo 3 veces;
- un revisor cortado por tiempo en 3 sesiones;
- un lint configurado que falla.

Además, ruido: un rechazo suelto, un fallo suelto y dos cortes de una persona en una sola sesión. En los dos casos, cada comando pasa primero por la barrera, como pasa hoy mientras se trabaja.

| | 1.1.2 | 1.2.0 |
|---|---|---|
| Aprendido (de 6: lección, 2 errores, macro, 2 propuestas) | 1 (la macro, que ya veía en vivo) | **6** |
| Falsos (propuestas o lecciones del ruido) | 0 | 0 |
| Evaluación de un ajuste aplicado (de 2: mantener si bajan los cortes, revertir si no) | 0 | **2** |
| Pasada diaria | — | 59 ms |

**Con las sesiones reales de un proyecto** (9 sesiones, 231 subagentes, 240 transcripts):
- La primera pasada tardó 4,1 s y las siguientes 82 ms, porque solo relee lo que cambió.
- 17 errores repetidos entraron al catálogo de errores conocidos. Los más frecuentes:
  - comillas en `bash -c` («unexpected EOF while looking for matching `''»), 16 veces;
  - 5 veces «No hay neurodanza.config.json», de la persona evaluadora corriendo el panel desde la carpeta equivocada.
- El segundo es un fallo de las **instrucciones del plugin**, y salió como propuesta del tipo «plugin». Se corrigió en `agents/persona-evaluadora.md` (paso 0 de «Cómo trabajas»).

**Lo que no mide el banco:** si las lecciones y los errores conocidos bajan los rechazos en sesiones reales. Eso lo decide el juicio de cada lección (por día) y se ve con `autoajuste.mjs informe` semana contra semana.

## Configuración

`autoajuste` (`activo`, `ajustes`, `umbrales`) y `telemetria.transcripts`: ver [03-configuracion.md](03-configuracion.md#autoajuste).
