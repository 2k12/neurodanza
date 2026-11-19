# 3. Configuración: `neurodanza.config.json`

Un solo archivo en la raíz del proyecto. Lo carga `lib/config.mjs`:

1. Lo busca **subiendo** desde la carpeta de trabajo (hasta 8 niveles), así que funciona desde cualquier subcarpeta.
2. Mezcla lo que definas sobre los valores por defecto (`DEFAULTS`). Los objetos se mezclan en profundidad; **los arreglos se reemplazan** enteros.
3. Valida lo mínimo (ver [Validación](#validación)).
4. Las **rutas relativas** se resuelven contra la carpeta donde está el archivo.

Para el autocompletado en el editor, apunta a la plantilla de esquema (copiada a tu proyecto o dentro del plugin):

```json
{ "$schema": "./neurodanza.schema.json" }
```

Plantilla: [`plantillas/neurodanza.config.json`](../plantillas/neurodanza.config.json). Ejemplo completo: [`ejemplos/nest-next/neurodanza.config.json`](../ejemplos/nest-next/neurodanza.config.json).

## Tres convenciones

### `repo:glob`

Muchas claves de `retroalimentacion` y `evals` reciben patrones con la forma `repo:glob`:

- `repo` es el `nombre` de uno de los `repos`; `glob` es relativo a la carpeta de ese repo.
- Sin `repo:` el glob se aplica a **cualquier** repo.
- Comodines: `*` (dentro de una carpeta), `**` (cualquier profundidad), `?` (un carácter), `{a,b}` (alternativas). No distingue mayúsculas.

```json
"pantallas": ["frontend:app/**/page.tsx", "frontend:features/**/*.tsx"]
```

Los globs de `barreras` (`rutasProtegidas`, `migracionesInmutables`, `exentos`) **no** llevan `repo:`: son relativos a la raíz del proyecto (donde está `neurodanza.config.json`), p. ej. `backend/prisma/migrations/*/migration.sql`.

### `{archivos}`

En los comandos `lint` y `relacionadas` de cada repo, `{archivos}` se reemplaza por la lista de archivos cambiados, entre comillas y relativos al repo:

```json
"lint": "npx eslint --no-error-on-unmatched-pattern {archivos}"
```

### `${VAR:-defecto}`

En `panel.usuarios` los valores pueden leer variables de entorno: `${VAR}` (vacío si no existe) o `${VAR:-defecto}`. Así no hace falta escribir correos ni contraseñas en el archivo:

```json
"clave": "${ND_PERSONA_PASSWORD}"
```

Además, `{id}`, `{nombre}`, `{rol}`, `{email}` y `{clave}` se reemplazan por los datos de cada persona (ver [09-adaptadores.md](09-adaptadores.md)).

## `autoconfigurar`

`true` por defecto. Al iniciar cada sesión (hook `SessionStart`) el plugin deja el proyecto listo sin pasos a mano:

- Si la raíz es un repo, agrega una vez a su `.gitignore` el bloque de neurodanza (`.neurodanza/*` local; `!.neurodanza/errores.json` y `!.neurodanza/aprendido/` versionados) y te lo avisa. Si tenía el bloque de la 0.5.0 (que versionaba todos los datos de los constructos), lo actualiza.
- Si los worktrees del modo director quedan fuera del proyecto y no están permitidos, le pide al agente que te diga cómo permitirlos (una línea en `.claude/settings.json` o `/add-dir`). El plugin **no** se da permisos solo.

Con `false` no toca nada.

- Si abres Claude **dentro de un componente** (por ejemplo `frontend/`), el plan, los worktrees y los demás repos quedan fuera de la carpeta de la sesión: el agente te pide una vez `/add-dir ..` (la raíz del proyecto). Si la raíz ya está permitida en `.claude/settings.json` de la raíz o del componente, no avisa.

> En un proyecto de varios repos cuya raíz no es un repo (`backend/`, `frontend/`, `docs/` sueltos), `.neurodanza/` vive en la raíz y no entra en ningún repo: el plan, el estado y los datos de los constructos quedan locales (está bien) y lo aprendido se versiona en el repo de documentación (`constructos.compartido: "auto"`). Los errores conocidos quedan locales; para compartirlos, apunta `errores.archivo` a una carpeta dentro de un repo.

## `repos`

Lista de repos del proyecto (por defecto `[]`). Cada uno:

| Clave | Obligatoria | Qué es |
|---|---|---|
| `nombre` | sí | Nombre corto; es el `repo` de `repo:glob`. |
| `ruta` | sí | Carpeta del repo, relativa a la raíz (`"."` si es uno solo). |
| `codigo` | no | Globs de código. Solo se revisan (lint, pruebas) los archivos que coinciden. **Sin `codigo` no se revisa nada en ese repo.** |
| `ignorar` | no | Globs que se excluyen del código (p. ej. generados). |
| `lintGlobs` | no | Si existe, el lint solo corre sobre estos globs (dentro de `codigo`). |
| `lint` | no | Comando de lint, con `{archivos}`. |
| `tipos` | no | Comando de tipos (corre sobre todo el repo). |
| `relacionadas` | no | Pruebas relacionadas con lo cambiado, con `{archivos}`. |
| `suite` | no | Suite completa del repo. Corre **en segundo plano** después del hook `Stop` (lib/fondo.mjs), atada a la firma del cambio; sus fallas bloquean el `Stop` siguiente y el cierre del ciclo la exige. Sin `suite`, no hay fondo para ese repo. Ver [15-velocidad.md](15-velocidad.md). |
| `sinPruebas` | no | Expresión regular de la salida que significa «no hay pruebas» (no es un fallo). Por defecto `No tests found\|No test files found`. |

```json
"repos": [
  {
    "nombre": "backend",
    "ruta": "backend",
    "codigo": ["src/**/*.ts", "test/**/*.ts", "prisma/**/*.ts"],
    "ignorar": ["**/*.generated.ts"],
    "lint": "npx eslint --no-error-on-unmatched-pattern {archivos}",
    "tipos": "pnpm -s typecheck",
    "relacionadas": "npx jest --bail --findRelatedTests {archivos}"
  },
  { "nombre": "docs", "ruta": "docs" }
]
```

Solo se leen los cambios de los repos cuya carpeta tiene `.git`.

## `barreras`

Ver [04-barreras.md](04-barreras.md).

| Clave | Por defecto | Qué es |
|---|---|---|
| `secretos` | `true` | Bloquea leer y editar `.env` y `.env.*`. |
| `secretosPermitidos` | `[".env.example", ".env.test", ".env.sample"]` | Nombres de archivo que sí se pueden leer y editar. |
| `firmasIA` | `true` | Bloquea la línea de coautoría de git y las firmas automáticas de Claude Code en commits y en lo que se escribe. |
| `borradosRaiz` | `true` | Bloquea `rm -rf` y `Remove-Item -Recurse` sobre rutas raíz. |
| `rutasProtegidas` | `[]` | Globs (texto o `{ "glob", "motivo" }`) que no se editan. |
| `migracionesInmutables` | `null` | Glob de migraciones: si el archivo ya existe, no se edita. |
| `comandosProhibidos` | `[]` | `{ "patron", "motivo", "alcance" }`; `patron` es una expresión regular; `alcance` `"bare"` (por defecto) o `"raw"`. |
| `timeoutComandos` | `{ "activo": true, "maxSeg": 120, "largos": [ … ] }` | Comandos que pueden no terminar (servidores, modo watch, suites completas): sin `timeout` de hasta `maxSeg` × 1000 ms, sin `run_in_background` y sin envolverlos en `timeout`, se rechazan con la forma de correrlos. `largos`: `{ "tipo": "servidor"\|"watch"\|"suite", "patron": "<regex>" }`. Ver [15-velocidad.md](15-velocidad.md#2-timeout-obligatorio-en-cada-comando). |
| `exentos` | `[]` | Globs donde no se aplica `firmasIA` al editar (los propios archivos de reglas). |

```json
"barreras": {
  "rutasProtegidas": [{ "glob": "backend/src/modules/einvoice/legacy-*", "motivo": "Módulo congelado: no se tocan sus archivos." }],
  "migracionesInmutables": "backend/prisma/migrations/*/migration.sql",
  "comandosProhibidos": [
    { "patron": "prisma\\s+migrate\\s+reset", "motivo": "`prisma migrate reset` borra la base de datos. Pídeselo al usuario si de verdad hace falta." }
  ],
  "exentos": ["**/guardrails*.{mjs,ts}", "**/no-junk-comments*"]
}
```

## `retroalimentacion`

Ver [05-retroalimentacion.md](05-retroalimentacion.md).

| Clave | Por defecto | Qué es |
|---|---|---|
| `lintAlEditar` | `true` | Lint del archivo justo después de cada edición. |
| `maxBloqueos` | `3` | Veces seguidas que el hook `Stop` puede bloquear por problemas graves antes de rendirse y pedirte revisión a mano. |
| `topeStopSeg` | `90` | Tope (s) de la parte que bloquea del hook `Stop` (lint, tipos, pruebas relacionadas, generadores). Lo que no alcanza se corta y pasa al fondo. Entre 10 y 110 (el hook tiene 120 s). |
| `topeFondoSeg` | `1800` | Tope (s) de cada tarea en segundo plano (suite completa y lo que no alcanzó). |
| `cache` | `true` | El hook `Stop` no repite lint, tipos y pruebas de un repo cuyo cambio es idéntico al de la última vez (misma firma de commit, diff y archivos nuevos); reutiliza el resultado. `false` lo corre siempre. |
| `version` | `null` | `{ "repo", "archivo", "ramaBase", "cambios" }`: exige subir la versión si cambió código. `ramaBase` por defecto `"main"`; `cambios` son `repo:glob`. |
| `bitacora` | `null` | `{ "ruta", "archivo" }`: exige la bitácora de la versión. `archivo` admite `{minor}` (p. ej. `1.4`) y `{version}` (`1.4.0`). |
| `migraciones` | `null` | `{ "repo", "schema", "nuevas" }`: si cambió el esquema, exige una migración nueva que coincida con `nuevas`. |
| `pantallas` | `[]` | `repo:glob` de pantallas: si cambian, exige panel aprobado y avisa si no tocaste la guía. |
| `guias` | `null` | `repo:glob` de las guías de usuario. |
| `regenerar` | `[]` | Generadores: `{ "nombre", "cuando", "comando", "en", "error" }`. |
| `docs` | `null` | Nombre del repo de documentación: avisa si hubo cambios de código sin tocar docs. |

```json
"retroalimentacion": {
  "version": { "repo": "frontend", "archivo": "package.json", "ramaBase": "main", "cambios": ["frontend:app/**", "frontend:features/**"] },
  "bitacora": { "ruta": "docs/bitacora", "archivo": "v{minor}.md" },
  "migraciones": { "repo": "backend", "schema": "prisma/schema.prisma", "nuevas": "prisma/migrations/*/migration.sql" },
  "pantallas": ["frontend:app/**/page.tsx", "frontend:features/**/*.tsx"],
  "guias": "frontend:content/guias/**",
  "docs": "docs",
  "regenerar": [
    { "nombre": "guías de usuario", "cuando": ["frontend:content/guias/**"], "comando": "node scripts/build-guides.mjs", "en": "frontend" },
    { "nombre": "índice de vistas", "cuando": ["docs:**"], "comando": "node docs/vistas/build-index.mjs", "error": true }
  ]
}
```

## `reglas`

Por defecto `{ "coherencia": [], "permisos": [], "ui": [], "docs": [] }`. Texto libre, una regla por línea, que lee cada revisor (ver [06-revisores.md](06-revisores.md)).

```json
"reglas": {
  "ui": ["Solo iconos de @phosphor-icons/react.", "Tema claro y oscuro con tokens (bg-muted, text-muted-foreground…), sin colores fijos."],
  "permisos": ["VIEWER nunca ve acciones de escritura."]
}
```

## `app`

Ver [09-adaptadores.md](09-adaptadores.md).

| Clave | Por defecto | Qué es |
|---|---|---|
| `urls` | `["http://localhost:3000"]` | URLs candidatas de la app; se usa la primera que responde en la ruta de login. |
| `levantar` | `null` | Comando para levantar la app (lo usa `/neurodanza-feature`). |
| `login.ruta` | `"/login"` | Ruta de la pantalla de ingreso. |
| `login.usuario` | `"Correo"` | Etiqueta exacta del campo de usuario. |
| `login.clave` | `"Contraseña"` | Etiqueta exacta del campo de contraseña. |
| `login.boton` | `"ingresar\|entrar\|iniciar\|login\|sign in"` | Expresión regular del nombre del botón. |
| `login.espera` | `"/"` | Texto que debe aparecer en la URL tras ingresar. |
| `idioma` | `"es-EC"` (no está en `DEFAULTS`; lo aplica `panel.mjs`) | Idioma del navegador de las personas. |
| `ignorarConsola` | `["status of 401"]` (no está en `DEFAULTS`; lo aplica `panel.mjs`) | Expresiones regulares de errores de consola que no cuentan como problema. |

```json
"app": {
  "urls": ["http://localhost:3010", "http://localhost:3000"],
  "levantar": "docker compose up -d --build api web",
  "login": { "ruta": "/login?empresa=demo", "usuario": "Correo", "clave": "Contraseña", "boton": "ingresar|entrar|iniciar", "espera": "/app" }
}
```

## `roles`

| Clave | Por defecto | Qué es |
|---|---|---|
| `adaptador` | `"json"` | `"json"` o `"markdown"`. |
| `fuente` | `null` | Archivo JSON de roles, o plantilla de ruta a los Markdown por rol con `{rolDoc}` o `{rol}`. |

```json
"roles": { "adaptador": "markdown", "fuente": "docs/roles/{rolDoc}.md" }
```

Ver [09-adaptadores.md](09-adaptadores.md).

## `panel`

Ver [07-panel-personas.md](07-panel-personas.md).

| Clave | Por defecto | Qué es |
|---|---|---|
| `min` | `3` | Mínimo de personas por ronda. |
| `max` | `5` | Máximo de personas por ronda. |
| `umbral` | `8.99` | Se aprueba si el promedio de las notas (1 a 10) es **mayor** que este valor. |
| `maxRondas` | `3` | Rondas máximas antes de pedirte permiso para otra. |
| `ventana` | `"windows"` | `"windows"`: ventana en vivo (solo en Windows); `"ninguna"`: solo el chat. |
| `ignorarRutas` | `[]` (no está en `DEFAULTS`; lo aplica `panel.mjs`) | Pantallas que no cuentan al elegir personas (p. ej. el inicio `/app`, que todos ven). |
| `elenco` | `".claude/personas/personas.json"` | Archivo del elenco. |
| `fotos` | `".claude/personas/fotos"` | Carpeta de fotos recortadas (fuera de git). |
| `evaluaciones` | `"docs/evaluaciones"` | Carpeta de los resultados del panel (los lee el hook `Stop`). |
| `usuarios` | `null` | Cómo se crean y cómo entran los usuarios de las personas. |
| `recorridos` | `".claude/personas/recorridos"` | Carpeta de los recorridos **permanentes** (en git, con id estable), los que se comparan entre versiones. Ver [18-panel-con-recorridos.md](18-panel-con-recorridos.md). |
| `notaMaxSiFalla` | `6` | Nota máxima de una persona si un paso **crítico** de su recorrido no cumple (según ella o según la ejecución). |

```json
"panel": {
  "umbral": 8.99,
  "maxRondas": 3,
  "ventana": "windows",
  "ignorarRutas": ["/app"],
  "elenco": "frontend/.claude/personas/personas.json",
  "fotos": "frontend/.claude/personas/fotos",
  "usuarios": {
    "login": { "url": "/api/v1/auth/login", "cuerpo": { "email": "${ND_ADMIN_EMAIL}", "password": "${ND_ADMIN_PASSWORD}" }, "token": "accessToken" },
    "crear": { "url": "/api/v1/tenant/users", "cuerpo": { "email": "{email}", "fullName": "{nombre}", "password": "{clave}", "role": "{rol}" } },
    "email": "persona.{id}@${ND_DOMINIO:-ejemplo.com}",
    "clave": "${ND_PERSONA_PASSWORD}",
    "propietario": { "rol": "OWNER", "email": "${ND_ADMIN_EMAIL}", "clave": "${ND_ADMIN_PASSWORD}" }
  }
}
```

## `evals`

Ver [08-evals.md](08-evals.md).

| Clave | Por defecto | Qué es |
|---|---|---|
| `casos` | `".claude/evals/casos.json"` | Casos de evals del proyecto. |
| `informes` | `"docs/evaluaciones/evals"` | Carpeta de los informes (los lee el hook `Stop`). |
| `vigilar` | `[]` | `repo:glob` de agentes, personas y skills: si cambian, avisa que corras `/neurodanza-evals`. |

```json
"evals": {
  "casos": "frontend/.claude/evals/casos.json",
  "informes": "docs/evaluaciones/evals",
  "vigilar": ["frontend:.claude/agents/**", "frontend:.claude/personas/**", "frontend:.claude/skills/**", "frontend:.claude/evals/**"]
}
```

## `errores`

Catálogo de errores conocidos del proyecto. Ver [12-errores-conocidos.md](12-errores-conocidos.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `activo` | `true` | Registra los problemas de los hooks y anota la solución conocida junto al error. |
| `archivo` | `".neurodanza/errores.json"` | Dónde se guarda. **Se versiona** para que todo el equipo lo aproveche. |
| `alIniciar` | `5` | Cuántos errores (con solución primero, luego los más repetidos) se cargan como contexto al iniciar la sesión. `0` no carga ninguno. |

## `ciclo`

Planificador + ejecutor de `/neurodanza-feature`. Ver [11-mapa-y-ciclo.md](11-mapa-y-ciclo.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `plan` | `".neurodanza/plan.md"` | Archivo del plan del ciclo (local, fuera de git). El mapa lo muestra. |
| `maxPasos` | `{ "revisor": 25, "persona": 40, "implementador": 60, "otro": 40 }` | Presupuesto de pasos por subagente. El mapa le avisa al 80 % y al tope. |
| `maxSegundos` | `{ "revisor": 300, "persona": 420, "implementador": 900, "otro": 420 }` | Tope de tiempo por subagente: aviso al 80 % y rechazo de toda herramienta al 100 %. El agente principal no tiene tope. |
| `latidoSeg` | `90` | Segundos sin un paso para marcar a un subagente «sin latido». |
| `revisores` | `"segun-cambio"` | `"segun-cambio"`: solo los revisores que aplican al diff (`lib/ciclo.mjs revisores`); `"todos"`: siempre los 4. |

## `pilas`

Lo que hizo cada subagente, para retomar si se corta. Ver [16-no-perder-trabajo.md](16-no-perder-trabajo.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `activo` | `true` | Los hooks guardan la pila de cada subagente en `.neurodanza/pilas/` (no va a git). |
| `avanceCada` | `10` | Cada cuántos pasos se le pide al subagente su línea de avance (sin bloquear). `0` = nunca. |

## `figuras`

Qué puede hacer cada tipo de agente: ◯ leer · △ editar · □ verificar · ◇ externo · ✕ destructivo. Ver [17-seguridad.md](17-seguridad.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `activo` | `false` (**`true`** en los proyectos que crea `/neurodanza-init`) | Prende la clasificación por figuras, la segunda llave (`ask`) y la cuarentena. Apagado en configuraciones existentes para no cambiar flujos. |
| `manos` | `{}` | Manos por tipo (`revisor`, `persona`, `implementador`, `fantasma`, `principal`, `otro`): lista de `leer`, `editar`, `verificar`, `externo`, `destructivo`, `red-app`. Lo que no se ponga usa los valores por defecto. |
| `cuarentena` | `3` | Rechazos de un subagente en el ciclo para dejarlo en cuarentena (mano vacía). |

## `fantasmas`

Ataques acotados contra la app local, en modo propuesta. Ver [17-seguridad.md](17-seguridad.md#3-fantasmas-en-modo-propuesta).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `activo` | `true` | Si el cambio toca endpoints, permisos, roles, consultas o pantallas que escriben, el skill lanza fantasmas en paralelo con revisores y panel. |
| `hosts` | `["localhost", "127.0.0.1"]` | Únicos hosts a los que un fantasma puede pedir algo. Los de `app.urls` se agregan solos. |
| `max` | `3` | Hipótesis (y fantasmas) por ciclo. |
| `maxPasos` · `maxSegundos` | `15` · `180` | Presupuesto de cada fantasma. |
| `login` | — | Opcional: cómo entra una persona por API (`{ "url", "cuerpo": { …"{email}"…"{clave}" }, "token" }`). Si no está, se usa el de `panel.usuarios.login` con las credenciales de la persona. |

## `fusible`

Nada de reintentos infinitos contra algo externo. Ver [15-velocidad.md](15-velocidad.md#4-fusible).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `maxFallos` | `2` | Fallos de una capa (app, chromium, bd…) en el ciclo para fundirla: no se reintenta y el panel queda pendiente. |
| `comprobaciones` | `{}` | `{ "capa": "comando" }` que dice si una capa responde (p. ej. `{ "bd": "pnpm prisma db execute --stdin < /dev/null" }`); lo corre `fusible.mjs comprobar --capa <c>`. |

## `director`

Modo director: el agente principal dirige y los implementadores trabajan en worktrees. Ver [13-director.md](13-director.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `worktrees` | `"auto"` | Dónde se crean los worktrees de las tareas. `"auto"`: si la raíz **no** es un repo (proyecto de varios repos), en `.neurodanza/wt` dentro del proyecto (ningún repo la ve y no pide permisos); si la raíz **es** un repo, en `../.neurodanza-wt/<proyecto>`, para que el lint y las pruebas del repo no los recorran. También acepta una ruta relativa a la raíz con `{proyecto}`. |
| `rebobinar` | `{ "activo": true, "umbralCorreccion": 0.5, "maxMuertes": 2 }` | Rebobinar con memoria: cuándo conviene volver a la foto original en vez de corregir encima (`umbralCorreccion` = fracción del diff original), y cuántas veces como máximo por tarea antes de informar al usuario. Ver [16-no-perder-trabajo.md](16-no-perder-trabajo.md#3-rebobinar-con-memoria). |
| `enlazar` | `["node_modules"]` | Qué se enlaza del repo real en cada worktree (las dependencias, para no instalarlas). `[]` no enlaza nada. |

## `constructos`

Agentes que acumulan experiencia en el proyecto. Ver [14-constructos.md](14-constructos.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `carpeta` | `".neurodanza/constructos"` | Datos locales de los constructos: ciclos, evidencias, lecciones en todos sus estados, `playbook.md` y `CHANGELOG.md`. **No se versiona.** |
| `compartido` | `"auto"` | Dónde se versionan las lecciones **aprobadas** (`aprendido/<constructo>.md`). `"auto"`: la raíz si es un repo; si no, el repo de `retroalimentacion.docs`; si no hay, todo local. `"local"`: no compartir. Otra cadena: carpeta relativa a la raíz. |
| `minEvidencias` | `2` | Evidencias para que una lección candidata pase a prueba. |
| `ciclosPrueba` | `3` | Ciclos a prueba antes de juzgarla (aprobar si el problema bajó, descartar si no). |
| `maxLecciones` | `30` | Tope de lecciones activas por constructo; al pasarlo se archivan las aprobadas con menos evidencias. |
| `automatico` | `true` | Pasar a prueba solo al llegar a `minEvidencias`. Con `false`, solo a mano (`constructos.mjs probar`). |

## Validación

`validate()` revisa:

- `repos` es una lista, y cada repo tiene `nombre` y `ruta`.
- `1 ≤ panel.min ≤ panel.max`.
- `panel.ventana` es `"windows"` o `"ninguna"`.
- `roles.adaptador` es `"json"` o `"markdown"`.

Si el JSON no se puede leer o no pasa la validación, los hooks escriben el error (`neurodanza: …`) y no bloquean nada; el panel y los evals sí se detienen con el error. Para comprobarlo a mano:

```
node -e "import('<plugin>/lib/config.mjs').then(m=>m.loadConfig())"
```
