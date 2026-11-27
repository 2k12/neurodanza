# 29. Revisión en el Stop

El hook `Stop` corre él mismo los revisores que pide el riesgo del cambio. Antes se esperaba que el agente los lanzara siguiendo el skill, y casi nunca lo hacía (docs/27: en la tarea grande correspondían revisores y ninguna corrida los lanzó). Es el segundo paso de la 2.0, después del [portero](28-portero.md).

Viene **apagado**. Se prende con `"ciclo": { "revisionEnStop": { "activo": true } }` (opciones en [03](03-configuracion.md)).

## Cómo corre

1. El `Stop` verifica lint, tipos y pruebas, como siempre. Si algo falla, no revisa todavía.
2. Si todo pasa y quedan más de 15 s del tope, calcula el riesgo del diff de la rama. Con el portero prendido, le pregunta primero si el revisor de un cambio medio hace falta.
3. Lanza en segundo plano los revisores que quedan en el plan (`riesgo.plan.lanzar`). Cada uno es un `claude -p` con el modelo y el esfuerzo de su `.md` en `agents/`. Recibe el diff y, con `lectura` (por defecto), puede leer el proyecto con `Read`, `Grep` y `Glob`: no edita ni corre comandos, y no puede leer `.env`.
4. Los espera mientras le quede tiempo:
   - Si un revisor encuentra algo alto o medio, el `Stop` **bloquea** con el hallazgo y su arreglo. El agente lo corrige, el diff cambia y se revisa otra vez, hasta `maxBloqueos`.
   - Si un revisor no terminó a tiempo, el `Stop` lo dice en una nota y el resultado llega en el siguiente `Stop`.
   - Si un revisor no pudo revisar (error, tiempo agotado), se dice una vez y no bloquea.

El mismo diff no se revisa dos veces con el mismo revisor (`.neurodanza/revision.json`). Un hallazgo de un diff anterior se informa una vez, con «corrígelo si sigue en el código».

Lo que cambia para el agente:
- `ciclo.mjs revisores` saca esos revisores de `lanzar` y los pone en `enStop`. El skill le dice que no los lance.
- `ciclo.mjs cerrar` cuenta como hechos los que aprobaron este diff en el `Stop`.
- Con un diff de más de `maxLineas` (1500) líneas cambiadas, el `Stop` no revisa y los revisores los lanza el agente, como antes.

## Medido de punta a punta

Un proyecto temporal de un repo, con Claude Code 2.1.332 y los modelos de cada revisor:

| Cambio | Resultado |
|---|---|
| Quitar el filtro de empresa en 15 consultas (30 líneas) | Riesgo medio por el campo `empresaId` (antes era bajo). `revisor-permisos` **bloqueó**: «fuga de datos entre empresas», con el arreglo. 7 s el `Stop` completo, 0,018 USD |
| Renombre local en 15 funciones (90 líneas), con portero | El portero quitó el revisor: 5 s. El segundo `Stop` con el mismo diff, 1 s |
| El mismo renombre, sin portero | `revisor-coherencia` aprobó en 4 s, por 0,008 USD. `cerrar`: «listo para informar» |

## ¿Solo el diff o leer el proyecto?

`node evals/revision.mjs --veces 3`: 13 casos en un proyecto de dos repos (`evals/revision-casos.mjs`). En 8 el error solo se ve fuera del diff: el otro lado del contrato, la función que se llama, la guardia que se usa. Los otros 5 son limpios parecidos. Sonnet, cada caso 3 veces con cada modo.

| | Solo el diff | Con lectura |
|---|---|---|
| Errores detectados | 21 de 24 | **24 de 24** |
| Limpios aprobados | 13 de 15 | **15 de 15** |
| USD por revisión (mediana) | 0,007–0,009 | 0,031–0,036 |
| Segundos (mediana) | 7–8 | 10–11 |

- Cuando el nombre delata el error (`porEstadoGlobal`, un 404 que pasa a 410, un campo renombrado), el diff basta: el revisor sospecha del cambio que rompe el contrato. Con lectura, además cita el archivo y la línea del otro lado.
- Cuando el nombre no delata nada, solo con el diff falla:
  - **Aprobó las 3 veces** una ruta de borrar con la guardia `operador`, que deja pasar a cualquier rol.
  - **Reprobó 2 de 3 veces** un cambio limpio a `consultas.vigentes`, que sí filtra por empresa, porque no podía comprobarlo. Eso le da al agente una vuelta de más.
- Con lectura cuesta unas 4 veces más por revisión y tarda 3 s más.

Por eso `lectura` viene en `true`. Con `false`, el revisor ve solo el diff.

## En el ciclo

`evals/costo.mjs --tareas medio,permisos --modos ciclo --veces 5`, Sonnet, sin la revisión en el Stop, con ella y solo el diff, y con ella y `lectura` (`--config '{"ciclo":{"revisionEnStop":{"activo":true,"lectura":true}}}'`). USD por corrida, mediana (mínimo–máximo), sumando lo que gastan los revisores del `Stop` (`usdTotal`). Las 20 corridas pasaron las pruebas ocultas.

| Tarea | Sin revisión en el Stop | Con revisión, solo el diff | Con revisión y lectura | Revisado |
|---|---|---|---|---|
| Media | 0,109 (0,105–0,226) | 0,122 (0,120–0,124) | 0,148 (0,138–0,188) | 2 de 5 → **5 de 5** |
| Permisos (alto) | 0,205 (0,196–0,220) | **0,176** (0,174–0,213), −14 % | 0,201 (0,197–0,220), −2 % | 5 de 5 → 5 de 5 |

- **Permisos:** sin la revisión en el Stop, el agente lanzó `revisor-permisos` como subagente en las 5 corridas. Con ella, en ninguna: lo corrió el `Stop` por 0,012–0,014 USD. Baja 14 %, no el 20 % de la meta.
- **Media:** sin ella, el agente lanzó el revisor en 2 de 5 corridas, y esas costaron el doble (hasta 0,226). Con ella, se revisan las 5 y el costo casi no varía. La mediana sube 12 % porque antes la mayoría no se revisaba.
- Ningún revisor encontró problemas: las tareas no tienen errores sembrados. Que detecta, se ve arriba (la fuga de empresa).

- **Con lectura**, cada revisión cuesta 0,030–0,045 USD en vez de 0,010–0,014: en permisos el ciclo queda casi igual que cuando el agente lanzaba el revisor (−2 %), y en la media sube a 0,148. Lo que se gana es detección (la tabla de arriba), no costo.

Queda **apagada por defecto** hasta medirla en más tareas: no baja el costo (con lectura, casi igual en permisos y más en la media), pero revisa siempre lo que el riesgo pide y detecta lo que el diff no muestra.

## Lo que no hace

- **El revisor no corre la app ni las pruebas:** lee código. Lo compensa en parte que el `Stop` solo revisa un cambio que ya pasó lint, tipos y pruebas.
- Con `lectura: false`, lo que el diff no muestra no lo ve.
- **No reemplaza al panel ni a los fantasmas:** necesitan la app levantada, y los sigue lanzando el agente.
- Si el turno termina y no hay otro `Stop`, un hallazgo que llegó tarde queda en `revision.mjs estado` hasta el siguiente.
