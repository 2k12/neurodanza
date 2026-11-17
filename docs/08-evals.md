# 8. Evals: evaluar a los evaluadores

Los revisores y las personas son agentes: pueden dejar pasar errores, inventar problemas o poner notas infladas. Los evals lo miden con **casos de respuesta conocida**.

- Skill: `/neurodanza-evals`. Úsalo después de cambiar agentes, personas, umbrales o skills, y una vez por versión.
- Script: `evals/evals.mjs` (arma las instrucciones y califica).
- Casos: `evals.casos` (por defecto `.claude/evals/casos.json`), copiados de `plantillas/casos-base.json` por `/neurodanza-init`.
- Informes: `evals.informes` (por defecto `docs/evaluaciones/evals`).

```
node <plugin>/evals/evals.mjs prompt --revisor revisor-ui
node <plugin>/evals/evals.mjs personas
node <plugin>/evals/evals.mjs calificar --resultados <json>
```

## Los casos

```json
{
  "umbrales": { "deteccion": 0.85, "falsosPositivos": 0, "personaBuenaMin": 8, "personaRotaMax": 5, "consistenciaMax": 1.5 },
  "revisores": [ … ],
  "personas": [ … ]
}
```

### Revisores: errores sembrados y un control limpio

Cada caso es un diff con un error conocido:

```json
{
  "id": "coherencia-limite",
  "revisor": "revisor-coherencia",
  "esperado": "reprobar",
  "claves": ["160", "200"],
  "descripcion": "La pantalla acepta 200 caracteres en la razón social y el servidor solo 160.",
  "diff": "--- a/frontend/features/customers/components/customer-form.tsx\n+++ b/…"
}
```

- `esperado`: `"reprobar"` (tiene un error) o `"aprobar"` (control limpio).
- `claves`: palabras que deben aparecer en los hallazgos para contar como detectado. Reprobar sin mencionar el problema no cuenta.
- `revisor: "todos"`: el caso se le da a los cuatro revisores (lo usa el control limpio, `control-limpio`).
- `nota`: por qué se corrigió un caso (ver abajo).

Los casos base cubren: límite distinto en pantalla y servidor, consulta sin filtrar por empresa, endpoint sin permiso, botón de escritura visible para quien solo lee, icono de otra librería y colores fijos, textos en inglés y botón sin `aria-label`, pantalla nueva sin guía, versión ni bitácora, y un control limpio.

### Personas: calibración

```json
{ "id": "persona-buena", "persona": "<id>", "rutas": ["/app/pedidos"], "cambio": "Revisa la lista de pedidos: filtros, columnas y estados.", "esperado": { "notaMin": 8 } }
```

| Caso | Qué mide | Esperado |
|---|---|---|
| `persona-buena` | Una persona que usa a diario una pantalla que funciona bien no la castiga. | `notaMin: 8` |
| `persona-rota` | Una persona a la que se le pide una tarea que su rol **no** puede hacer no infla la nota. | `notaMax: 5` |
| `persona-consistencia` | Una segunda corrida independiente de `persona-buena` (`repiteDe`) da casi la misma nota. | `diferenciaMax: 1.5` |

## El proceso (`/neurodanza-evals`)

1. **Revisores**, los 4 en paralelo y en un solo mensaje. Para cada uno:
   ```
   node <plugin>/evals/evals.mjs prompt --revisor revisor-ui > <scratchpad>/evals/revisor-ui.txt
   ```
   El archivo trae sus casos más el control limpio, con la instrucción de revisar **solo** esos diffs. Se lanza el agente pidiéndole que lea ese archivo, **sin decirle qué casos tienen errores**. Su respuesta es un arreglo `[{ "caso", "aprobado", "hallazgos" }]`.
2. **Panel** (requiere la app corriendo). `evals.mjs personas` lista los casos; por cada uno se lanza una `persona-evaluadora` sin ventana en vivo y **sin decirle qué nota se espera**.
3. **Calificar.** Se escribe `<evals.informes>/<AAAA-MM-DD>-v<versión>.json`:
   ```json
   { "version": "1.4.0", "revisores": { "revisor-ui": [ … ] }, "personas": { "persona-buena": { "nota": 9 } } }
   ```
   y se corre `calificar --resultados <ese json>`. Agrega al mismo archivo el `informe`, los `umbrales` y la `fecha`, imprime el resumen y los casos que fallaron, y sale con código 1 si no pasa:
   ```
   {"aprobado":false,"deteccion":0.88,"falsosPositivos":1,"personas":"3/3"}
   ✖ control-limpio · revisor-docs: falso positivo
   ```
4. Se registra el resultado en la bitácora de la versión.

## Cuándo pasa

- `deteccion` (casos con error detectados / casos con error, contando cada revisor) ≥ `umbrales.deteccion` (0.85).
- `falsosPositivos` (veces que se reprobó el control limpio) ≤ `umbrales.falsosPositivos` (0).
- Todos los casos de personas dentro de lo esperado (`notaMin`, `notaMax`, `diferenciaMax` de cada caso).

El hook `Stop` avisa si cambiaste algo de `evals.vigilar` y no hay un informe aprobado (`informe.aprobado: true`) de la versión actual.

## Si no pasa

- Si el **caso** estaba mal planteado (el revisor o la persona tenía razón), se corrige el caso y se deja anotado en su `nota`.
- Si el **agente** falló, se ajustan sus instrucciones.
- **Nunca** se ajusta un caso solo para que pase. Se vuelve a correr solo lo que falló.

Ejemplo real de `nota`: «la primera versión usaba un pedido inexistente, pero la app lo maneja bien (aviso en español y botón para volver) y la persona puso 7 con razón. Se cambió por una tarea que el rol no puede completar».
