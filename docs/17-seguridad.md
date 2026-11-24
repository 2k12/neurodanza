# 17. Seguridad práctica: figuras, cuarentena y fantasmas

Tres piezas para que un agente no haga lo que no le toca, y para encontrar agujeros de seguridad del propio cambio antes que un usuario:

| Pieza | Qué evita | Dónde |
|---|---|---|
| **Figuras** | Que un revisor edite, que un implementador instale o borre sin que lo sepas | `lib/figuras.mjs`, `hooks/guardrails.mjs` |
| **Cuarentena** | Que un agente insista contra la barrera una y otra vez | `lib/agentes.mjs`, `hooks/guardrails.mjs` |
| **Fantasmas** | Una fuga entre clientes o una escalada de rol que nadie probó | `lib/fantasmas.mjs`, `agents/fantasma.md` |

## 1. Figuras

Cada llamada de herramienta se clasifica en una figura:

| Figura | Clave | Qué es |
|---|---|---|
| ◯ | `leer` | `Read`, `Glob`, `Grep`, comandos de solo lectura (`git status/diff/log/show`, `ls`, `cat`…) |
| △ | `editar` | Editar archivos, redirigir a un archivo, `cp`/`mv`, `git add/commit`… (dentro del contrato en el modo director) |
| □ | `verificar` | Lint, tipos, pruebas, herramientas del plugin (`node lib/*.mjs`, `panel.mjs`) |
| ◇ | `externo` | Red, base de datos, migraciones, instalar o quitar dependencias, `git push`, `docker` |
| ✕ | `destructivo` | Borrar archivos o carpetas, `git reset --hard`, `git clean`, `git push --force`, `drop`/`truncate` |

Cada tipo de agente tiene una **mano** (las figuras que usa sin preguntar):

| Tipo | Mano por defecto |
|---|---|
| revisor | ◯ □ |
| persona | ◯ □ |
| implementador | ◯ △ □ |
| fantasma | ◯ □ + red solo a los hosts de la app |
| agente principal | ◯ △ □ (en modo director, sin △, como ya hacía la barrera) |
| otro (Explore, etc.) | ◯ □ |

Se cambian en `figuras.manos`; una tarea del modo director puede tener la suya (`director.mjs preparar --mano leer,editar,verificar`).

**Decisión**, antes de las reglas de siempre (que se mantienen todas: secretos, rutas protegidas, migraciones, comandos largos, contrato del director…):

| La figura… | Respuesta |
|---|---|
| está en la mano | sigue con las reglas de siempre |
| es ◇ o ✕ y no está en la mano | **`ask`**: el usuario decide en la ventana de permisos de Claude Code (quién, qué y por qué). Es la **segunda llave** |
| es otra y no está en la mano | **`deny`**, con el motivo y qué hacer en su lugar |

Si varias reglas aplican, gana la más estricta: `deny` > `ask` > seguir.

**Clasificación conservadora.** Un comando se parte en sus segmentos (`;`, `&&`, `||`, `|`, `&`, paréntesis, saltos de línea), se miran por dentro `bash -c`, `powershell -Command`, `$(…)`, ``…`` y `eval`, y el código de `node -e`/`python -c` se lee para ver si escribe, borra o usa la red. El comando vale lo que su parte más peligrosa. **Lo que no se puede clasificar con seguridad cuenta como ◇** (por ejemplo `node scripts/seed.mjs`: no se sabe qué hace); con `figuras.sinClasificar: "permisos"`, para el agente principal eso lo deciden los permisos de Claude Code.

No se pregunta por las variables de entorno (`export A=1`, `A=1 cmd`, `$env:A = 'x'`, `source .env`), las palabras de control, las redirecciones ni las banderas de git y npm (`git -C`, `npm run -s`): se clasifica el comando que de verdad corre. **Sí se pregunta** por las variables que deciden qué programa corre o le inyectan código (`PATH`, `NODE_OPTIONS`, `LD_PRELOAD`, `GIT_SSH_COMMAND`…).

**La tabla vive donde ningún agente puede escribir:** `.neurodanza/figuras.json` (y el registro `.neurodanza/agentes/`). La barrera rechaza cualquier `Edit`/`Write` o comando que los toque (redirecciones, `cp`, `mv`, `node -e`…); leerlos sí se puede. La escriben solo `director.mjs preparar` (la mano de cada tarea) y la propia barrera (al asociar el `agent_id` del implementador con su tarea en cuanto aparece en su worktree).

**Solo el agente principal lanza subagentes:** con las figuras activas, la herramienta `Agent` se le rechaza a cualquier subagente. (Claude Code sí deja que un subagente lance otros, hasta 3 niveles; además, los agentes del plugin no tienen `Agent` en sus herramientas. Para cortarlo del todo: `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` en la configuración de Claude Code.)

**Activación:** `figuras.activo` es `true` en los proyectos que crea `/neurodanza-init` y `false` en las configuraciones que ya existían, para no cambiar flujos sin avisar.

## 2. Cuarentena

- Cada `deny` de la barrera a un subagente suma en su registro (`.neurodanza/agentes/<id>.json`). Los `ask` no cuentan, se aprueben o no.
- Al llegar a `figuras.cuarentena` (3) rechazos en el ciclo, su mano queda vacía: toda herramienta nueva se rechaza con «neurodanza: estás en cuarentena por N bloqueos (<motivos>). Entrega tu respuesta con lo que tienes.» El mapa lo marca (`⛔`).
- Cada cuarentena se registra en **errores conocidos**: la próxima vez, el mensaje trae la solución anotada.
- El director lo reemplaza re-enfundándolo ([16-no-perder-trabajo.md](16-no-perder-trabajo.md#2-re-enfundar-guiado)) **sin** la acción que causó los bloqueos y con una advertencia en el contrato. Si el reemplazo también cae, se informa al usuario.
- Se reinicia al empezar un ciclo: `node <plugin>/lib/agentes.mjs reiniciar` (lo hace el paso 0 del skill). El agente principal nunca entra en cuarentena.

## 3. Fantasmas en modo propuesta

**Cuándo:** en el paso 3 del skill, en paralelo con revisores y panel, si el diff toca endpoints, permisos, roles, consultas a la base o pantallas con acciones de escritura (`lib/ciclo.mjs revisores` lo dice en `fantasmas`).

**Hipótesis:** `node <plugin>/lib/fantasmas.mjs hipotesis` lee el diff y los roles y genera hasta `fantasmas.max` (3), cada una con rol atacante, recurso (método y ruta) y técnica:

| Técnica | Qué prueba |
|---|---|
| `recurso-ajeno` | Pedir un recurso de otro usuario o cliente cambiando un id |
| `escalada-de-rol` | Que un rol de solo lectura llame a un endpoint de escritura |
| `fuga-entre-clientes` | Que un listado o filtro devuelva registros de otra empresa |
| `accion-oculta` | Que la pantalla oculte o deshabilite una acción que la API sí permite |
| `entrada-no-validada` | Campos nuevos vacíos, largos o de otro tipo (sin cargas destructivas) |

**Ataque:** cada fantasma (`agents/fantasma.md`) prueba una hipótesis contra la app local ya levantada, con los usuarios de prueba de las personas: `fantasmas.mjs request --usuario <persona> --metodo M --ruta R`. Solo métodos y rutas del diff; nunca borra datos que no haya creado.

**Límite duro:** la barrera rechaza cualquier petición de red de un fantasma a un host fuera de `fantasmas.hosts` (más los de `app.urls`), y `fantasmas.mjs request` lo vuelve a comprobar. Nunca producción.

**Resultado (modo propuesta):** el fantasma **no edita ningún repo** (no tiene la figura △ ni herramientas de escritura). `fantasmas.mjs resultado` guarda en `.neurodanza/fantasmas/<ciclo>/<id>.json`: hipótesis, confirmado sí/no, la request exacta (método, ruta, usuario, cuerpo), respuesta esperada y obtenida, gravedad, y `prueba.propuesta` con una prueba de regresión para el framework del repo.

**Integración:** `fantasmas.mjs veredicto` lista los confirmados (sale con 1 si hay alguno alto). Un confirmado alto cuenta como un hallazgo alto de revisor (bloquea el aprobado de esa ronda); el director crea una tarea para que el implementador corrija **e integre la prueba propuesta**. Los no confirmados se descartan sin ruido. En el mapa, cada fantasma es un nodo tenue que solo se resalta si confirma algo (`👻 … ✔ alta`).

**Evals:** `plantillas/casos-base.json` trae un diff con una fuga entre empresas sembrada (el fantasma debe confirmarla) y uno limpio (no debe haber confirmados). `evals.mjs fantasmas` muestra las hipótesis que genera neurodanza para cada uno.

## Límites honestos

- **Las barreras sobre comandos son una red de seguridad, no un aislamiento.** Un comando puede esconder lo que hace (un script propio, un binario, una variable de entorno). Por eso lo que no se entiende cuenta como ◇ y se pregunta, pero un agente decidido a esquivar la clasificación podría lograrlo. El aislamiento real lo dan los permisos de Claude Code y el sistema operativo.
- **`ask` depende del modo de permisos:** en `dontAsk` (y en algunos casos de `plan`), Claude Code rechaza en vez de preguntar. Los subagentes en segundo plano muestran la pregunta en la sesión principal, indicando quién pide.
- **Los fantasmas prueban hipótesis, no auditan:** encuentran lo que se les ocurre probar a partir del diff. Que no confirmen nada no prueba que el cambio sea seguro.
- **El login de una persona por API** se deduce de `panel.usuarios.login` (o de `fantasmas.login`). Si la app entra de otra forma, configura `fantasmas.login`.
