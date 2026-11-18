# 11. Mapa en vivo y ciclo planificador + ejecutor

neurodanza es un **harness de calidad para agentes**: una capa sobre Claude Code que convierte "programa esto" en un ciclo repetible:

- **planificar → ejecutar → verificar → juzgar → cerrar**
- **Barreras deterministas:** los hooks.
- **Procedimiento:** los skills.
- **Jueces independientes:** los revisores y las personas.
- **Medición:** las evals.

Esta página cubre las tres piezas que lo hacen visible y controlable:

| Pieza | Qué resuelve |
|---|---|
| **Mapa en vivo** (`neurodanza-mapa`) | Ver en qué fase está el ciclo y qué hace cada subagente, sin adivinar. |
| **Plan en archivo** (`ciclo.plan`) | Que el agente no se pierda en un ciclo largo: el plan sobrevive a la compactación del contexto. |
| **Presupuesto de pasos** (`ciclo.maxPasos`) | Que un subagente no se quede dando vueltas 40 pasos: aviso al 80 %, tope al 100 % y detector de bucles. |

## Mapa en vivo

Es un segundo plugin del mismo marketplace, un *mod* de Claude Code que dibuja un panel al lado del chat (con scroll):

```
/plugin install neurodanza-mapa@neurodanza
```

```
filtro por fecha en pedidos                     ⏱ 12:41
● 0 Entender           0:40
● 1 Implementar        6:10
● 2 Verificar          1:05
   backend lint ✔ 0:03 · backend tipos ✔ 0:41 · frontend pruebas ✔(caché)
◐ 3 Revisores          2:31
   ├─ ✔ coherencia  ✔ aprobado · 18/25 pasos · 1:52
   ├─ ✔ permisos    ✔ aprobado · 9/25 pasos · 0:47
   ├─ ▶ ui          Grep lucide · 21/25 pasos · 2:31 ⚠ cerca del tope
   └─ ✔ docs        ✖ 2 hallazgos · 11/25 pasos · 1:10
○ 4 Panel de personas
○ 5 Cerrar

Plan (3/6)
 ✔ 1. Filtro en el DTO → hecho cuando: prueba del servicio en verde
 …
Agente principal
 12:30 $ pnpm --filter backend test
```

- **Se abre solo** al correr `/neurodanza-feature` o al lanzar un revisor o una persona; también con `/neurodanza-mapa`. En una terminal angosta (menos de unas 110 columnas) se ve encima del prompt, y la línea de estado resume la fase (`nd 3 Revisores · 3/4 agentes · 12:41`).
- **Clic (o Enter) en un subagente** abre su conversación; desde la lista de tareas se vuelve a la principal.
- **La fase se deduce sola** de lo que hace el agente principal, sin pasos extra:

| Señal | Fase |
|---|---|
| `Skill neurodanza-feature` | 0 Entender (empieza un ciclo nuevo) |
| Edita código (no `.neurodanza/`) | 1 Implementar; si venía de 3 o 4, suma una **vuelta** |
| Corre lint, tipos o pruebas | 2 Verificar |
| Lanza un `implementador` (modo director) | 1 Implementar; si venía de 2 a 4, suma una **vuelta** |
| `lib/ciclo.mjs revisores` o lanza un `revisor-*` | 3 Revisores |
| `panel.mjs` o lanza una `persona-evaluadora` | 4 Panel de personas |
| `git commit` o `gh pr create` | 5 Cerrar |
| Termina su turno | `⏸ esperando tu respuesta` |

- La fila de Verificar muestra la última pasada del hook `Stop` (`.neurodanza/estado.json`): cada comprobación, su tiempo y si salió de la caché.
- **Solo observa:** no cambia lo que hacen las herramientas. Lo único que hace por su cuenta es mandarle avisos a un subagente (presupuesto y bucles).

## Plan en archivo (planificador + ejecutor)

En el paso 0 de `/neurodanza-feature` el agente **planifica**: escribe `.neurodanza/plan.md` con 3 a 8 pasos, cada uno con su condición de terminado. Después **ejecuta** el plan paso por paso y marca cada uno `[x]` apenas se cumple.

```md
# Plan · filtro por fecha en pedidos
- [x] 1. Filtro en el DTO y el servicio → hecho cuando: prueba del servicio en verde
- [ ] 2. Selector de fechas en /app/pedidos → hecho cuando: lint y tipos del frontend en verde
- [ ] 3. Guía de usuario de pedidos → hecho cuando: la guía menciona el filtro
```

Si la conversación se compacta o el agente se pierde, vuelve a leer el plan y sigue por el primer paso sin marcar. Si un revisor encuentra algo, se agrega un paso al plan en vez de improvisar. El archivo es local (`.neurodanza/*` va en `.gitignore`).

## Presupuesto de pasos

| Tipo de subagente | Máximo (`ciclo.maxPasos`) |
|---|---|
| `revisor-*` | 25 |
| `persona-evaluadora` | 40 |
| `implementador` | 60 |
| otros | 40 |

El mapa cuenta cada herramienta que usa cada subagente y le escribe directamente:

- **al 80 %:** «llevas N de M pasos. Cierra: verifica solo lo que falte para decidir y entrega tu respuesta»;
- **al 100 %:** «llegaste al presupuesto… entrega YA tu respuesta con lo que tienes»;
- **misma llamada 3 veces seguidas:** «no va a dar otro resultado: cambia de enfoque o entrega lo que tienes».

Cada aviso se manda una sola vez. Los agentes saben qué hacer con ellos (sección «Presupuesto de pasos» de `agents/*.md`). Sin el mapa instalado no hay avisos, pero el skill igual les dice su presupuesto en el mensaje.

## Más rápido

| Qué | Cómo |
|---|---|
| Hook `Stop` | Lint, tipos y pruebas en paralelo, y caché por firma del cambio ([05-retroalimentacion.md](05-retroalimentacion.md)). |
| Revisores | Solo los que aplican al diff y con `model: sonnet` ([06-revisores.md](06-revisores.md)). |
| Panel | En la ronda siguiente se repite solo a las personas que reprobaron o cuyas rutas tocó el arreglo. |
| Errores repetidos | La solución conocida aparece junto al error ([12-errores-conocidos.md](12-errores-conocidos.md)). |
