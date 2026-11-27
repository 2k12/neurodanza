# 29. Revisión en el Stop

El hook `Stop` corre él mismo los revisores que pide el riesgo del cambio. Antes se esperaba que el agente los lanzara siguiendo el skill, y casi nunca lo hacía (docs/27: en la tarea grande correspondían revisores y ninguna corrida los lanzó). Es el segundo paso de la 2.0, después del [portero](28-portero.md).

Viene **apagado**. Se prende con `"ciclo": { "revisionEnStop": { "activo": true } }` (opciones en [03](03-configuracion.md)).

## Cómo corre

1. El `Stop` verifica lint, tipos y pruebas, como siempre. Si algo falla, no revisa todavía.
2. Si todo pasa y quedan más de 15 s del tope, calcula el riesgo del diff de la rama. Con el portero prendido, le pregunta primero si el revisor de un cambio medio hace falta.
3. Lanza en segundo plano los revisores que quedan en el plan (`riesgo.plan.lanzar`). Cada uno es un `claude -p` sin herramientas que solo ve el diff, con el modelo y el esfuerzo de su `.md` en `agents/`.
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

## En el ciclo

`evals/costo.mjs --tareas medio,permisos --modos ciclo --veces 5`, Sonnet, con y sin `--config '{"ciclo":{"revisionEnStop":{"activo":true}}}'`. USD por corrida, mediana (mínimo–máximo), sumando lo que gastan los revisores del `Stop` (`usdTotal`). Las 20 corridas pasaron las pruebas ocultas.

| Tarea | Sin revisión en el Stop | Con revisión en el Stop | Revisado |
|---|---|---|---|
| Media | 0,109 (0,105–0,226) | 0,122 (0,120–0,124) | 2 de 5 → **5 de 5** |
| Permisos (alto) | 0,205 (0,196–0,220) | **0,176** (0,174–0,213), −14 % | 5 de 5 → 5 de 5 |

- **Permisos:** sin la revisión en el Stop, el agente lanzó `revisor-permisos` como subagente en las 5 corridas. Con ella, en ninguna: lo corrió el `Stop` por 0,012–0,014 USD. Baja 14 %, no el 20 % de la meta.
- **Media:** sin ella, el agente lanzó el revisor en 2 de 5 corridas, y esas costaron el doble (hasta 0,226). Con ella, se revisan las 5 y el costo casi no varía. La mediana sube 12 % porque antes la mayoría no se revisaba.
- Ningún revisor encontró problemas: las tareas no tienen errores sembrados. Que detecta, se ve arriba (la fuga de empresa).

Queda **apagada por defecto** hasta medirla en más tareas: no cumplió −20 % en costo, pero sí revisa siempre lo que el riesgo pide, con menos variación.

## Lo que no hace

- **El revisor no tiene herramientas:** no puede abrir otros archivos para ver el contexto del cambio. Lo que el diff no muestra, no lo ve. Lo compensa en parte que el `Stop` solo revisa un cambio que ya pasó lint, tipos y pruebas.
- **No reemplaza al panel ni a los fantasmas:** necesitan la app levantada, y los sigue lanzando el agente.
- Si el turno termina y no hay otro `Stop`, un hallazgo que llegó tarde queda en `revision.mjs estado` hasta el siguiente.
