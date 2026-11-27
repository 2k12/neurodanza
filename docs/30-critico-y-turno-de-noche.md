# 30. Crítico del pedido y turno de noche

Dos piezas para que el agente no se apruebe a sí mismo y para que tu tiempo pase de corregir a revisar.

## Crítico del pedido, a ciegas

Antes de planificar un cambio de riesgo medio o alto, un modelo recibe **solo el pedido tal cual** y puede leer el proyecto (`Read`, `Grep`, `Glob`; sin `.env`). **No ve la conversación**, así que no sabe qué se quiere oír. Su trabajo es el caso más fuerte **en contra**:

| Tipo | Ejemplo |
|---|---|
| Rompe una regla | «Guarda el total como float» con `AGENTS.md`: «Los montos se guardan en centavos» |
| Ya existe | «Agrega un filtro por estado» cuando la lista ya tiene uno |
| Es inseguro | «Que el frontend mande el `empresaId`» cuando la regla es tomarlo de la sesión |
| Contradice una decisión | «Vuelve a habilitar el login con Google», quitado por una auditoría |
| Parte de una premisa falsa | «Como el límite es 500, súbelo a 1000» cuando es 100 |

- **Evidencia obligatoria:** cada objeción cita un archivo y un texto. Si el texto no está en ese archivo, la objeción se descarta, igual que las líneas inventadas del portero.
- **No se suaviza:** el skill pone las objeciones en el plan tal cual y las decide el usuario.
- **Cómo se usa:** `critico.mjs --pedido "<pedido>" --tema <tema>`. Con `--tema`, la objeción queda en el registro del documento de la funcionalidad.
- **Viene prendido** (`ciclo.critico.activo`). Lo corre el agente en el paso 0 del skill, y el turno de noche con cada ficha.

### Medido

`node evals/critico.mjs --veces 2`: un proyecto con reglas (`AGENTS.md`), decisiones (`docs/decisiones.md`) y funciones que ya existen. Tiene 20 pedidos que deberían objetarse (4 por tipo) y 20 que están bien. Sonnet, Claude Code 2.1.332.

| | Resultado |
|---|---|
| Pedidos malos objetados | **40 de 40** (8 de 8 en cada tipo) |
| Pedidos buenos objetados por error | 6 de 40 en la primera corrida; **0 de 40** con el banco corregido (ver abajo) |
| Objeciones descartadas por evidencia falsa | 0 |
| USD por pedido (mediana) | 0,023 |
| Segundos (mediana) | 10 |

En la primera corrida objetó 3 pedidos «buenos», las dos veces cada uno, y **tenía razón**: eran errores del banco que no se habían visto.
- «Usa el parámetro `pagina`»: `listar` lo descarta.
- «Muestra el botón Cancelar solo a admin y editor»: ese botón no existe.
- «Muestra la cantidad de pedidos»: la API devuelve la lista recortada y sin total.

Se reescribieron para que de verdad estén bien, y con eso objetó 0 de 6.

Límite: el banco lo escribió quien escribió el crítico. Los casos son claros y de un solo tipo. En un proyecto real habrá pedidos ambiguos.

## Turno de noche

Corrige un lote de incidencias sin nadie mirando. Por la mañana deja **ramas locales con su evidencia** y un resumen que muestra primero lo que te toca decidir. No hace push, no fusiona y no toca ninguna rama compartida.

Viene **apagado**. Se prende con `"noche": { "activo": true }` (opciones en [03](03-configuracion.md)).

### Qué hace con cada incidencia

1. **Elige:** fichas en `Priorizada` o `Abierta` (`noche.estados`), por prioridad, que no haya tomado antes. Nunca toma una ficha cerrada, verificada ni descartada.
2. **Crítico:** lee la ficha a ciegas. Si objeta con evidencia, no la corrige: queda como excepción.
3. **Worktree:** uno nuevo, en la rama `noche/<fecha>-<id>`, desde la rama de desarrollo del repo (`incidencias.mjs guardar --rama`) o la base. Lo acompaña una config de neurodanza solo para ese repo y las reglas del proyecto (`AGENTS.md`, `CLAUDE.md`).
4. **Agente:** `claude -p` con el plugin, así que las barreras y el `Stop` (lint, tipos, pruebas) corren igual que de día. Tiene tope de USD (`topeUSD`) y de minutos.
   - El encargo pide una prueba en rojo antes de corregir y en verde después.
   - No hace commit ni push, ni toca la ficha.
   - Si no se puede corregir con seguridad, deja el motivo en `NOCHE.md` en vez de inventar.
5. **Verificación aparte:** lint, tipos y pruebas; el riesgo del diff; los revisores que pide ese riesgo, leyendo el proyecto (docs/29); y si la prueba se vio en rojo.
6. **Política:**
   - **«Lista»:** todo pasó, el riesgo no supera `riesgoMax` (medio) y nadie objetó.
   - **«Excepción»:** cualquier otra cosa, con sus motivos.
7. **Commit en su rama:** lo hace el script, no el agente, con tu identidad de git y sin firmas de IA. La ficha pasa a `En rama`, con una nota que dice la rama.

El turno corre las incidencias de a una, para que el gasto quede acotado. Se corta al llegar a `topeTurnoUSD` (10). Dos turnos no pueden correr a la vez (candado).

### Por la mañana

- La primera sesión del día dice en una línea cuántas quedaron listas, cuántas son excepciones y cuánto costó.
- `noche.mjs resumen` muestra el detalle: primero **Te toca decidir**, después **Listas para revisar y abrir PR**.
- Cada incidencia trae su rama, el commit, el riesgo, los archivos, la verificación, los revisores, el costo y el tiempo.
- `noche.mjs limpiar --fecha <f>` quita los worktrees. Las ramas quedan.

### Programarlo

`noche.mjs programar --hora 02:00` muestra la tarea del sistema sin crearla: en Windows, `schtasks`; en Linux y macOS, una línea de `crontab`. Con `--crear`, en Windows, la crea.

### Medido de punta a punta

Un proyecto temporal con una incidencia real (`BE-CAR-001`): el total del carrito falla con el carrito vacío y suma mal. Claude Code 2.1.332, Sonnet, `noche.mjs correr`:

| | Resultado |
|---|---|
| Estado | **Lista**, en la rama `noche/2026-11-27-BE-CAR-001`, con `main` intacta |
| Cambio | El `reduce` con valor inicial 0, y una prueba nueva con los 3 casos de la ficha |
| Prueba | Vista en rojo y después en verde (`pruebas.mjs`) |
| Verificación aparte | Pasa. Riesgo bajo: sin revisores |
| Ficha | Pasa a `En rama`, con la rama en la nota |
| Costo | 0,116 USD: crítico 0,010 y agente 0,106. 27 s |

La primera corrida falló por un error del script: en Windows, la ruta del plugin terminaba en barra, se comía la comilla de cierre y el agente arrancó sin permisos de escritura. El agente **no intentó saltarse los permisos**: explicó el arreglo y paró. Por esa corrida, el resumen ahora muestra lo último que dijo el agente cuando una incidencia no queda lista.

Falta medirlo en un lote real de incidencias tuyas: una sola ficha clara no dice cuántas quedan listas en un proyecto de verdad.

### Lo que no hace

- No sube nada ni abre PR: las ramas son locales y el PR lo decides tú.
- No corre el panel de personas ni los fantasmas, porque necesitan la app levantada. Si la incidencia cambia pantallas, el `Stop` lo dice como aviso.
- Con `permisos: "auto"`, el agente pide permiso al clasificador de Claude Code. Una acción que el clasificador frena queda sin hacer y la incidencia puede quedar como excepción.
