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

- Si la raíz es un repo, agrega una vez a su `.gitignore` el bloque de neurodanza (`.neurodanza/*` local; `!.neurodanza/errores.json` y `!.neurodanza/constructos/` versionados) y te lo avisa.
- Si los worktrees del modo director quedan fuera del proyecto y no están permitidos, le pide al agente que te diga cómo permitirlos (una línea en `.claude/settings.json` o `/add-dir`). El plugin **no** se da permisos solo.

Con `false` no toca nada.

> En un proyecto de varios repos cuya raíz no es un repo (`backend/`, `frontend/`, `docs/` sueltos), `.neurodanza/` vive en la raíz y no entra en ningún repo: los errores conocidos y los constructos quedan locales. Para compartirlos con el equipo, apunta `errores.archivo` y `constructos.carpeta` a una carpeta dentro de un repo (por ejemplo `docs/.neurodanza/…`).

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
| `revisores` | `"segun-cambio"` | `"segun-cambio"`: solo los revisores que aplican al diff (`lib/ciclo.mjs revisores`); `"todos"`: siempre los 4. |

## `director`

Modo director: el agente principal dirige y los implementadores trabajan en worktrees. Ver [13-director.md](13-director.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `worktrees` | `"auto"` | Dónde se crean los worktrees de las tareas. `"auto"`: si la raíz **no** es un repo (proyecto de varios repos), en `.neurodanza/wt` dentro del proyecto (ningún repo la ve y no pide permisos); si la raíz **es** un repo, en `../.neurodanza-wt/<proyecto>`, para que el lint y las pruebas del repo no los recorran. También acepta una ruta relativa a la raíz con `{proyecto}`. |
| `enlazar` | `["node_modules"]` | Qué se enlaza del repo real en cada worktree (las dependencias, para no instalarlas). `[]` no enlaza nada. |

## `constructos`

Agentes que acumulan experiencia en el proyecto. Ver [14-constructos.md](14-constructos.md).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `carpeta` | `".neurodanza/constructos"` | Dónde viven las lecciones, el historial, el playbook y el CHANGELOG de cada constructo. **Se versiona.** |
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
