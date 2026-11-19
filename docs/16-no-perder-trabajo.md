# 16. No perder trabajo: pilas, re-enfundar y rebobinar

Un subagente que se corta a mitad de camino (por tiempo, por pasos, sin latido o en cuarentena) no debería obligar a empezar de cero. Y una tarea que salió mal por diseño no debería corregirse encima, sumando parches. Tres piezas:

| Pieza | Qué evita | Dónde |
|---|---|---|
| **Pilas** | Que el reemplazo de un agente cortado relea y rehaga todo | `lib/pilas.mjs`, `hooks/pilas.mjs` |
| **Re-enfundar** | Lanzar el reemplazo sin contexto, o relanzarlo una y otra vez | `pilas.mjs reenfundar`, paso 4 del skill |
| **Rebobinar con memoria** | Corregir encima un intento equivocado, o repetir el mismo error | `director.mjs decidir` / `rebobinar` |

## 1. Pilas mecánicas

Cada subagente tiene una pila en `.neurodanza/pilas/` (no va a git):

| Campo | Qué guarda | Quién |
|---|---|---|
| `tipo`, `tarea`, `inicio`, `pasos`, `ultimaHerramienta` | Quién es y cuánto lleva | el hook |
| `leidos` | Archivo + hash del contenido cuando lo leyó (para saber si sigue igual) | el hook |
| `editados` | Archivo + líneas `+`/`−` | el hook |
| `comandos` | Comando, código de salida (si Claude Code lo informa), duración y las últimas 20 líneas si falló | el hook |
| `avance` | Líneas «qué hice, qué falta» | el propio agente |

- **Lo mecánico lo guardan los hooks solos:** un `PostToolUse` para `Read`, `Edit`, `Write`, `MultiEdit`, `Bash` y `PowerShell` cuando hay `agent_id`. Corre con `async: true`: el subagente no lo espera. El lint al editar sigue igual.
- **Cada paso es un archivo atómico propio** (`.neurodanza/pilas/<agent_id>/<hora>-<azar>.json`): varios pasos del mismo agente a la vez (lecturas en paralelo) o de varios agentes no se pisan ni se pierden. La pila se compacta en `<agent_id>.json` cuando se lee.
- **Línea de avance:** cada `pilas.avanceCada` pasos (10), la barrera le pide al subagente —en el siguiente paso, con un aviso, sin bloquear— que corra `node <plugin>/lib/pilas.mjs avance --texto "<qué hice, qué falta>"`. El hook guarda el texto en su pila. Los agentes del plugin traen la instrucción.
- **Código de salida:** Claude Code no siempre lo informa en la respuesta de `Bash`. Si no viene, queda como desconocido (`null`) y la falla se infiere de la salida de error; nunca se inventa.

```
node <plugin>/lib/pilas.mjs ver --agente <id>          la pila completa (JSON)
node <plugin>/lib/pilas.mjs resumen --agente <id>      texto corto (≤ 60 líneas) para un prompt
node <plugin>/lib/pilas.mjs limpiar                    al cerrar el ciclo
```

## 2. Re-enfundar guiado

Cuando un subagente vuelve cortado por tiempo o pasos, aparece sin latido, entrega con pendientes críticos o cae en cuarentena, el director **re-enfunda una sola vez**:

```
node <plugin>/lib/pilas.mjs reenfundar --agente <id>
```

genera el mensaje completo para lanzar un subagente nuevo del mismo tipo:

1. el contrato original (en el modo director lo guarda `director.mjs preparar` en la tarea);
2. «Retomas el trabajo de un agente anterior que se cortó»;
3. lo que ya hizo: avance y editados;
4. los archivos que ya leyó **y siguen iguales** («no los releas salvo que necesites un detalle») y los que **cambiaron** desde entonces (por hash);
5. los comandos que fallaron, con su salida;
6. lo que falta (su última línea de avance);
7. el presupuesto de pasos y de tiempo **restante**, no el completo.

En el modo director el reemplazo trabaja en el **mismo worktree**: no se pierde lo editado. `reenfundar` se niega a hacerlo dos veces para la misma tarea (o agente): si el reemplazo también se corta, se informa al usuario con `pilas.mjs resumen`. El mapa muestra el reemplazo como continuación del nodo original (`pedidos-api ↻ 2`).

## 3. Rebobinar con memoria

Cuando revisores, personas o fantasmas reprueban una tarea del modo director, el director decide:

```
node <plugin>/lib/director.mjs decidir --tarea <id> --hallazgos <json>
```

| Situación | Decisión |
|---|---|
| Pocos hallazgos bajos o medios, en pocos archivos | **corregir encima** (una tarea de corrección) |
| Algún hallazgo alto, un problema de diseño, más de 5 hallazgos o de 3 archivos, o una corrección estimada (`lineas` de cada hallazgo, 10 si no dice) mayor que `director.rebobinar.umbralCorreccion` (50 %) del diff original | **rebobinar** |

```
node <plugin>/lib/director.mjs rebobinar --tarea <id> --memoria '{ "motivo", "hallazgos", "notas", "constructo" }'
```

1. Guarda el diff fallido en `.neurodanza/muertes/<tarea>-<n>.patch` y registra la muerte en `.neurodanza/muertes.json` (motivo, hallazgos, notas de personas, archivos, constructo).
2. La pasa a los **constructos** como evidencia contra el constructo que la causó (formato de la reflexión, etiqueta `muerte:<problema>`).
3. Descarta el worktree y lo vuelve a crear **desde la misma foto original** (la del `preparar`).
4. El contrato nuevo trae la sección «Intentos anteriores y por qué fallaron»: un resumen corto, sin el diff completo, que queda disponible por ruta si el implementador lo necesita.

Al llegar a `director.rebobinar.maxMuertes` (2) no rebobina: hay que informar al usuario con los intentos y sus hallazgos. El mapa muestra las muertes de cada tarea (`✝ 1`).

## Medido

Del banco de pruebas (`bench/`, agentes simulados): ver la tabla en [`bench/README.md`](../bench/README.md#parte-2).
