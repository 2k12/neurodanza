# Planificar (riesgo medio o alto)

Trabajas en dos papeles: **planificas** (paso 0) y **ejecutas** el plan paso por paso. El plan vive en un archivo (`ciclo.plan`, por defecto `.neurodanza/plan.md`), no solo en tu contexto: si la conversación se compacta o te pierdes, **vuelve a leerlo** y sigue por el primer paso sin marcar.
```md
# Plan · <qué se pidió, en una línea>
- [ ] 1. <paso concreto> → hecho cuando: <comprobación verificable>
- [ ] 2. …
```
- De 3 a 8 pasos, cada uno pequeño y con su condición de terminado. Márcalo `[x]` apenas se cumpla (no al final).
- Si el plan cambia (un revisor encontró algo), agrega o edita pasos en el archivo; no improvises fuera de él.
- Delega solo tareas acotadas. Cada subagente tiene un presupuesto de pasos (`<ciclo> presupuesto`; revisores 25, personas 20, implementadores 60) y el mapa le avisa al 80 % y al llegar al tope. Díselo en el mensaje: «Presupuesto: N pasos; si llegas, entrega lo que tengas».

Empieza el ciclo con `<fusible> reiniciar` y `<agentes> reiniciar` (capas externas, tiempos, rechazos y cuarentenas en cero).
Si el contexto de inicio dice que la sesión está **dentro de un componente** (p. ej. `frontend/`), pídele al usuario `/add-dir` de la raíz antes de seguir (no lo hagas tú).

**Documento de la funcionalidad (riesgo alto, o medio con modo director).** Antes de escribir código: guarda el pedido del usuario **tal cual** en `<scratchpad>/pedido.txt` y `<funcionalidad> crear --tema <tema> --pedido <scratchpad>/pedido.txt`. Queda en `.neurodanza/funcionalidades/<tema>.md` con el pedido textual en L1 y una spec `S#` por cada frase entre comillas. Agrega los criterios de aceptación con `<funcionalidad> spec --tema <tema> --texto "…"` y una tarea por paso del plan (`<funcionalidad> tarea --tema <tema> --id T1 --specs S1,S2 --texto "…"`). Dile al usuario en una línea qué documento creaste y cuántas tareas tiene.
- Los subagentes reciben **referencias**, no tu resumen: el contrato del implementador lleva el pedido textual y sus specs (`preparar … --funcionalidad <tema> --specs S1,S2`); a revisores y personas pásales `<funcionalidad> leer --tema <tema>`.
- Una tarea se marca hecha **solo con evidencia observada**: `<funcionalidad> hecha --tema <tema> --id T1 --evidencia "<comando y resultado>" [--commit <sha>]`.
- Si el usuario corrige o cambia algo, `<funcionalidad> registrar --tema <tema> --texto "…"` y reescribe solo la spec afectada (`spec` agrega; si cambia una, regístralo y agrega la nueva).
- Al retomar tras un corte, lee el documento antes que el código.

Resume en pocas líneas qué entendiste (qué cambia, pantallas y roles afectados) y el riesgo previsto (`texto` de `<riesgo>`), escribe el plan en el archivo y **espera el visto bueno del usuario** antes de tocar código (salvo riesgo bajo). Pregunta solo lo que cambia el resultado.

**Recorridos acordados (si el cambio toca pantallas y el riesgo no es bajo), antes del visto bueno:**
1. `<panel> elegir --rutas <rutas afectadas>` y lanza en **un solo mensaje** un `persona-evaluadora` por persona elegida, **en modo recorrido**: su `id`, qué se va a construir (en lenguaje de usuario), las rutas, el ciclo (`<tema>-v<versión>`) y el comando `<recorridos>` con ruta absoluta. Cada una escribe su **recorrido futuro** (pasos verificables con lo que espera ver, `maxClics`, `maxSegundos` y `porQue`) y lo guarda en `.neurodanza/recorridos/<ciclo>/<persona>.json`. Presupuesto: 8 pasos.
2. `<recorridos> plan --ciclo <ciclo>` y pega el texto en el plan, junto con lo demás: el usuario aprueba **plan y recorridos juntos**, y puede editarlos (`<recorridos> guardar` con el archivo corregido). Pregúntale si alguno debe ser **permanente** (se repite entre versiones: se compara con las anteriores).
3. Con el visto bueno: `<recorridos> aprobar --ciclo <ciclo> [--permanentes id1,id2]`. Lo aprobado queda congelado con su hash; los permanentes se copian a `panel.recorridos` (en git) con su id.
