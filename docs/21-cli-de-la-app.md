# 21. La CLI de la app, macros y comentarios

Dos fuentes de tokens que no aportan nada: el agente que escribe una y otra vez el mismo script para entrar a la app y pedirle algo, y el que escribe comentarios que repiten lo que dice el código. Esta parte las ataca con una CLI que funciona en cualquier proyecto con `neurodanza.config.json` y con una barrera.

## Cuánto se escribía a mano

En las sesiones de Claude Code de un proyecto real (NestJS + Next, 9 sesiones, 3170 comandos de terminal) se contaron los comandos repetitivos que escribió el agente (las categorías se solapan):

| Actividad | Comandos | Caracteres | Promedio |
|---|---|---|---|
| Base de datos (scripts de Prisma) | 388 | 438.762 | 1.131 |
| Login o token | 148 | 176.272 | 1.191 |
| Playwright y capturas | 112 | 91.493 | 817 |
| `curl` o `fetch` a la API | 75 | 54.894 | 732 |
| Lint y tipos | 472 | 555.109 | 1.176 |
| Pruebas | 468 | 284.939 | 609 |

Cada uno de esos caracteres es un token de salida que paga el agente, y cada script hecho a mano puede fallar y repetirse.

## Comandos

```bash
node lib/app.mjs estado                                         # ¿la app responde? (app.urls)
node lib/app.mjs login --como <persona|ROL|admin>               # entra y guarda la sesión (no muestra el token)
node lib/app.mjs api GET /api/pedidos --como vendedor           # HTTP 200 + respuesta compacta
node lib/app.mjs api POST /api/pedidos --como vendedor --cuerpo '{"cliente":"Ana"}'
node lib/app.mjs abrir /pedidos --como ana                      # captura (panel.mjs navegar)
node lib/app.mjs verificar --repo backend --archivos src/a.ts   # lint, tipos y pruebas relacionadas en paralelo
node lib/app.mjs macros | macro <nombre> --<variable> <valor>
node lib/app.mjs sugeridas | aceptar --id <id> --nombre <n> [--comando "…{variable}…"] | descartar --id <id>
node lib/app.mjs podar | borrar --nombre <n>
```

- **Funciona en cualquier proyecto** porque sale de la configuración: `app.urls`, `panel.usuarios` (cómo se entra: `--como admin` usa `panel.usuarios.login` tal cual; `--como <persona o ROL>`, el correo y la clave de esa persona del elenco), `fantasmas.login` si existe, y `repos[]` (`lint`, `tipos`, `relacionadas`).
- **Sesión en caché** (`.neurodanza/app/sesiones.json`, local) por `cli.sesionMin` minutos (10). Si la app la rechaza antes (401), entra de nuevo una sola vez.
- **Solo hosts de la app**: localhost y los de `app.urls`, como los fantasmas.
- **Salida compacta**: `HTTP <status>`, una línea por elemento si es una lista, recortada a `--max` (2000) caracteres.
- `verificar` corre los tres comandos a la vez con el tope de `barreras.timeoutComandos.maxSeg` (mata el árbol si se pasa) y solo muestra las últimas 30 líneas de lo que falla.

**Medido** (`comandos_app`, tres tareas contra la app simulada del banco): listar pedidos como una persona, crear un pedido y verificar un repo. A mano, **1121 caracteres** (≈ 280 tokens); con la CLI, **327** (≈ 82 tokens): **−70,8 %**, y las tres funcionan en ambos casos. Los comandos a mano del banco son cortos comparados con los del proyecto real (412 y 499 caracteres frente a promedios de 1131 y 1191), así que en un proyecto real el ahorro por comando debería ser mayor; el banco no lo mide.

## Macros que nacen del uso

Lo propio de cada proyecto (una consulta a la base, sembrar datos, crear una empresa de prueba) no se puede adivinar, así que la CLI no lo trae: **nace de lo que se repite**.

1. La barrera cuenta cada comando de terminal de `cli.repetidoMin` (200) caracteres o más, normalizado (números y rutas temporales no lo hacen distinto). A la `cli.repetidoVeces` (3) vez, avisa al agente una sola vez: «este comando ya se escribió 3 veces; propónle al usuario guardarlo como macro».
2. `app.mjs sugeridas` los lista. Con el visto bueno del usuario, `app.mjs aceptar --id <id> --nombre <n>` lo guarda en `cli.macros` (`.claude/neurodanza-macros.json`, **en git**: lo usa todo el equipo). Con `--comando` se guarda con variables: `psql -c "select * from pedidos where id = {id}"` se corre con `app.mjs macro pedido --id 7`.
3. `app.mjs podar` lista las macros sin uso en `cli.podarDias` (30) días para proponer borrarlas (`borrar`). Crecer solo también llena la CLI de macros inútiles: se podan como se juzgan las lecciones.

**Seguridad.** Una macro es un comando guardado, así que:
- La barrera juzga `app.mjs macro <nombre>` por **el comando que corre** (barreras y figuras): una macro con `rm -rf /` se rechaza igual que el comando a mano.
- `aceptar` y `borrar` cambian lo que todo el equipo puede correr: la barrera **le pregunta al usuario** (ventana de permisos), aunque las figuras estén apagadas.

Además, si el agente escribe a mano un login, un token o un `Bearer` contra un host de la app, la barrera le recuerda la CLI una vez por agente y sesión.

## La barrera de comentarios

Con `barreras.comentarios: "estricto"`, la barrera rechaza al editar los comentarios **nuevos** en JS/TS que no van: solo pasan directivas, JSDoc **con etiquetas de API** de lo exportado y `// POR QUÉ: …`. Los que ya estaban no cuentan. Detalle y modos en [04-barreras.md](04-barreras.md#comentarios).

**Medido:**
- En el banco (`comentarios_barrera`), 20 escrituras: **12 de 12** con comentarios que no van rechazadas y **0 de 8** buenas rechazadas por error (directivas, JSDoc con etiquetas, `POR QUÉ`, y `//` dentro de textos, URLs y expresiones regulares). En la 1.0.0, 0 de 12.
- Sobre el código real del proyecto (1123 archivos, tomados como nuevos): **99,1 %** de los comentarios del backend y **99,5 %** del frontend se rechazarían. Por qué tanto: casi todo lo que quedaba era JSDoc en prosa sobre lo exportado (1377 de 1407 comentarios permitidos), que repite el nombre de la función; con esa prosa permitida, la barrera solo llegaba al 74,1 % y al 55,4 %.
- Los comentarios eran el 3,4 % de las líneas que el agente agregó en los últimos 150 commits de ese proyecto (6262 de 181.858): ese es el techo del ahorro en tokens. La ganancia mayor es el código limpio.

## Configuración

`cli` y `barreras.comentarios`: ver [03-configuracion.md](03-configuracion.md#cli).
