# 27. Cuánto cuesta

`evals/costo.mjs` corre las mismas tareas con Claude Code de verdad, sin el plugin, con él y con `/neurodanza-feature`, en un proyecto temporal de dos repos. Mide costo, tokens, llamadas y si el resultado pasa pruebas que el agente no ve. Gasta tokens.

```
node evals/costo.mjs --modos sin,con,ciclo --veces 3
```

## Medido (Sonnet, Claude Code 2.1.331)

USD por tarea, mediana de 3 corridas. «Plugin 1.5.1» es **una sola** corrida por tarea.

| Tarea | Sin plugin | Plugin 1.5.1 | Plugin 1.6.0 | Ciclo 1.5.1 | Ciclo 1.6.0 |
|---|---|---|---|---|---|
| Chica | 0,052 | 0,133 | **0,063** (−53 %) | 0,169 | **0,083** (−51 %) |
| Media | 0,075 | 0,137 | **0,085** (−38 %) | 0,180 | **0,102** (−43 %) |
| Grande (2 repos) | 0,089 | 0,141 | **0,102** (−28 %) | 0,171 | **0,105** (−39 %) |

Todas las corridas pasaron las pruebas ocultas, **también sin plugin**: en tareas simples el plugin cuesta más y no da un mejor resultado.

## Qué gastaba de más

| Causa | Arreglo |
|---|---|
| Los avisos del `Stop` (prueba en rojo, guía, docs, evals, «el panel no corre») salían con `decision: "block"`: otra vuelta del agente al terminar cada turno. En la tarea chica, 11 de 18 llamadas | Van al usuario (`systemMessage`), una vez por sesión |
| Los mensajes pedían un comando sin su ruta: el agente lo buscaba en todo el disco (unos 12 min por sesión) | Llevan la ruta completa |
| El skill principal pesaba 29,2 KB en cualquier cambio | 5,8 KB; el resto se lee por paso y nivel (`referencias/`) |
| Sin diff, un cambio de código nunca se preveía bajo | `riesgo.mjs --lineas N` |
| Código en 2 repos era siempre alto | Medio hasta `ciclo.riesgo.lineasDosRepos` (150) líneas, salvo lo sensible |
| Las personas heredaban el modelo de la sesión | Sonnet |

## Qué se pierde

- El agente ya no atiende los avisos por su cuenta: los ve el usuario. Para que la prueba en rojo se exija, `ciclo.pruebaPrimero: "exigir"`.
- Un cambio chico en dos repos tiene un revisor (coherencia, o permisos si toca permisos) en vez de todos. `lineasDosRepos: 0` vuelve a lo anterior.

## Ver qué gasta tu proyecto

```
node lib/telemetria.mjs gasto --dias 7
```

Una fila por tipo de agente y modelo, de mayor a menor. Lee los transcripts de tu máquina; no gasta tokens. El **peso** es entrada + 5 × salida + 2 × caché escrita + 0,1 × caché leída: sirve para comparar dentro de un modelo, no es dinero.

## Tope por ciclo

`"ciclo": { "maxTokens": N }`, en ese mismo peso (elige N a partir del reporte). Se mira solo al lanzar un subagente: si el ciclo ya llegó, la barrera lo rechaza y el agente te pregunta. `ciclo.mjs seguir` da otro tope igual; la ventana de permisos te lo pregunta también en automático, y un subagente no puede. Viene apagado: no hay datos para elegir un número por defecto.

- El gasto se cuenta desde el último `fusible.mjs reiniciar`, solo de esa sesión y sus subagentes.
- Es un freno, no un candado: un agente que corra `fusible.mjs reiniciar` empieza otro ciclo con el tope completo.
- No corta a los que ya corren: varios lanzados a la vez pueden pasarlo.

## Directo o con modo director

El modo director y sus especialistas se usan con más de `director.minArchivos` (8) archivos, o si lo pides. Antes, siempre que el cambio alto tocara dos repos.

## Sin medir

- **Panel, revisores y fantasmas:** ninguna corrida lanzó subagentes. En la grande correspondían revisores y el agente no los lanzó, ni antes ni ahora; el encargo le decía que el plan ya estaba aprobado.
- Personas en Sonnet: ni su ahorro ni si califican igual. Corre `/neurodanza-evals`.
- Tareas difíciles, proyectos grandes y otros modelos.
