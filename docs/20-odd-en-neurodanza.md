# 20. ODD en neurodanza: proporcionalidad, pedido textual y pruebas primero

[Organic Driven Development (ODD)](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/usage.md#organic-driven-development-odd) es el flujo de trabajo de gentle-ai: explorar lo justo, clasificar el cambio por tamaño, un documento por funcionalidad grande con el pedido del usuario textual, pruebas primero y revisión según el riesgo. En gentle-ai son **instrucciones** para el agente (su documentación aclara que sus pruebas establecen que la instrucción llega, no que el agente la cumpla). neurodanza toma esas ideas y las hace cumplir con **hooks y scripts**, donde se puede.

No hace falta instalar gentle-ai: los dos configuran Claude Code con su propio flujo y el agente recibiría instrucciones que compiten.

| Idea de ODD | En neurodanza | Quién lo hace cumplir |
|---|---|---|
| Clasificar el cambio; lo chico no paga ceremonia | Riesgo bajo, medio o alto (`lib/riesgo.mjs`) | `ciclo.mjs revisores` decide qué corre; el hook `Stop` no exige el panel con riesgo bajo |
| Revisión según el riesgo (bajo: nada; medio: un lente; alto: cuatro) | Bajo: sin revisores; medio: 1 revisor y 1 persona; alto: el ciclo completo | Ídem |
| Un documento por funcionalidad grande, con el pedido textual | `.neurodanza/funcionalidades/<tema>.md` (`lib/funcionalidad.mjs`) | El contrato del implementador lo trae (`preparar --funcionalidad`) |
| Los subagentes reciben referencias, no un resumen | Pedido textual y specs `S#` en el contrato | Ídem |
| Tareas marcadas solo con evidencia observada | `funcionalidad.mjs hecha --evidencia` (obligatoria) | El script no marca sin evidencia |
| Pruebas primero: rojo antes, verde después | `pruebas.mjs rojo` / `verde` (`lib/pruebas.mjs`) | El hook `Stop` avisa o bloquea (`ciclo.pruebaPrimero`) |
| Explorar lo justo | Índice por commit, especialistas en caché (ya existía: [19](19-menos-exploracion.md)) | — |
| Retomar tras un corte | Pilas y rebobinar (ya existía: [16](16-no-perder-trabajo.md)) | — |

Lo que **no** se tomó de ODD: los commits automáticos por unidad de ~400 líneas y los PR encadenados (en neurodanza el commit y el PR son del usuario), y la memoria externa (Engram): el estado vive en `.neurodanza/`.

## 1. Proporcionalidad: riesgo bajo, medio o alto

```bash
node lib/riesgo.mjs --archivos "backend:src/pedidos/**,frontend:app/pedidos/page.tsx"   # previsto, antes de implementar
node lib/riesgo.mjs                                                                       # con el diff de la rama
```

| Nivel | Cuándo | Qué corre |
|---|---|---|
| **Bajo** | Solo docs o pruebas, o hasta `ciclo.riesgo.lineasBajo` (40) líneas **de código** en un repo, sin contratos (DTO, esquemas, validaciones, entidades), sin archivos sensibles y sin tocar permisos en las líneas cambiadas (`ciclo.riesgo.permisosEnCodigo`: `useCan`, `hasRole`, `permission`…) | Lint, tipos y pruebas. Sin plan en archivo, recorridos, especialistas, revisores, panel ni fantasmas. Si el pedido es claro, el agente lo dice en una línea y lo hace |
| **Medio** | Lo demás | Plan corto; **un** revisor (el de más prioridad que aplica: permisos, coherencia, ui, docs); **una** persona si hay pantallas, con su recorrido; un fantasma si aplica |
| **Alto** | Un archivo de `ciclo.riesgo.altos` (migraciones, `*.sql`, `*auth*`, `*guard*`, `*polic*`, `*permis*`, `*acl*`, `*casl*`, `middleware*`), migraciones de `retroalimentacion.migraciones`, código en 2 repos o más de `ciclo.riesgo.lineasAlto` (400) líneas | El ciclo completo: todos los revisores que aplican, de `panel.min` a `panel.max` personas, fantasmas, especialistas, documento de la funcionalidad |

Las líneas que cuentan son las de **código**: no las de documentación, pruebas, archivos fuera de `repos[].codigo` ni las del repo de docs (que puede estar en una rama larga con cambios de varias versiones). Los globs sensibles tampoco aplican ahí: una evaluación `v1-permisos.json` en el repo de docs no es un cambio de permisos.

El nivel previsto (con los archivos del plan) guía el paso 0; el real sale del diff en el paso 3 (`ciclo.mjs revisores` lo devuelve en `riesgo`) y, si sube, manda el plan del nivel nuevo. Con `ciclo.revisores: "todos"` corren siempre los 4 revisores; con `ciclo.riesgo.activo: false`, todo cambio es alto (el ciclo de antes).

**Medido** (`ciclo_por_riesgo`, pasos de subagentes que lanza el harness; proxy de tokens):

| Cambio | 1.0.0 | 1.1.0 |
|---|---|---|
| Chico: un texto en una pantalla | 3 revisores + 3 personas con recorrido = 102 pasos | riesgo bajo: 0 |
| Medio: 12 reglas en un módulo de la API | 2 revisores = 24 pasos | riesgo medio: 1 revisor = 12 |
| Alto: guard de permisos + migración + pantalla | 150 pasos | riesgo alto: 150 (igual) |

Lo alto no se abarata a propósito: la proporcionalidad saca ceremonia de lo chico, no de lo peligroso.

## 2. Documento de la funcionalidad: el pedido textual

```bash
node lib/funcionalidad.mjs crear --tema filtro-estado --pedido <archivo con el pedido tal cual>
node lib/funcionalidad.mjs spec  --tema filtro-estado --texto "El filtro se recuerda al volver a la pantalla."
node lib/funcionalidad.mjs tarea --tema filtro-estado --id T1 --specs S1,S4 --texto "Botón y estado del filtro"
node lib/funcionalidad.mjs hecha --tema filtro-estado --id T1 --evidencia "vitest run filtro.test.ts: 3 pasan" --commit abc123
node lib/funcionalidad.mjs registrar --tema filtro-estado --texto "El usuario pidió un menú en vez de botones."
node lib/funcionalidad.mjs leer  --tema filtro-estado [--specs S1,S2]
```

`.neurodanza/funcionalidades/<tema>.md` tiene, en este orden: cabecera, `## Specs` (una `S#` por cada frase entre «», “”, "" o `` ` `` del pedido, más las que se agreguen), `## Tareas` (con sus specs y la evidencia) y `## Registro`, cuya `L1` es el pedido del usuario **tal cual**. Al implementador le llega con `director.mjs preparar … --funcionalidad <tema> --specs S1,S2`: el pedido textual y sus specs, en vez de la línea de objetivo que escribió el director.

**Medido** (`pedido_textual`): un pedido con 3 frases exactas y un objetivo resumido por el director. En la 1.0.0 llegaban al contrato **0 de 3**; con el documento, **3 de 3**. El banco no mide si eso evita una ronda de corrección: eso depende del modelo.

## 3. Pruebas primero

```bash
node lib/pruebas.mjs rojo  --repo api --archivo src/pedidos/filtro.test.ts   # antes de implementar: debe fallar
node lib/pruebas.mjs verde --repo api --archivo src/pedidos/filtro.test.ts   # con el cambio: debe pasar
```

`rojo` corre la prueba con `repos[].relacionadas` (necesita `{archivos}`) y la registra solo si **falla**: una prueba que ya pasa sin el cambio no prueba la regla nueva, y lo dice. En el modo director, el contrato trae el comando con `--proyecto` y `--dir` (la carpeta del repo en el worktree de la tarea).

El hook `Stop` mira los repos donde cambió código: si una prueba nueva o cambiada no tiene rojo registrado, **avisa** (`ciclo.pruebaPrimero: "avisar"`, por defecto) o **bloquea** (`"exigir"`). Con `false`, no mira.

La regla de cuántas pruebas es la de ODD: una por cada regla pedida (una por spec `S#`) y una por cada comando u opción existente que el cambio toca, que demuestre que lo de antes sigue igual; ninguna más.

**Medido** (`prueba_primero`): dos implementaciones de la misma función, una sin ver la prueba en rojo y otra con rojo antes. La 1.0.0 no distinguía ninguna (0 de 2); la 1.1.0 avisa en la primera y registra la segunda (2 de 2).

## Configuración

`ciclo.riesgo` (`activo`, `lineasBajo`, `lineasAlto`, `altos`, `permisosEnCodigo`) y `ciclo.pruebaPrimero`: ver [03-configuracion.md](03-configuracion.md#ciclo).
