# 5. Retroalimentación y definición de terminado

`hooks/feedback.mjs` tiene tres modos, registrados en `hooks/hooks.json`:

| Modo | Hook | Tiempo máximo | Qué hace |
|---|---|---|---|
| `inicio` | `SessionStart` | 10 s | Carga como contexto los errores conocidos del proyecto ([12-errores-conocidos.md](12-errores-conocidos.md)). |
| `post` | `PostToolUse` de `Edit`, `Write`, `MultiEdit` | 90 s | Lint del archivo recién editado. |
| `fin` | `SessionEnd` | 10 s | Cierra la ronda del panel que haya quedado abierta (la ventana se cierra sola). |
| `stop` | `Stop` | 600 s | No deja terminar si lo cambiado no pasa lint, tipos, pruebas relacionadas o la definición de terminado. |

Todo sale de `neurodanza.config.json` (`repos` y `retroalimentacion`); sin ese archivo no hace nada.

## Lint al editar (`post`)

Después de cada edición:

1. Busca a qué repo de `repos` pertenece el archivo.
2. Si el repo tiene `lint`, el archivo coincide con `codigo`, no con `ignorar`, y (si existe) con `lintGlobs`, corre el `lint` con `{archivos}` = ese archivo.
3. Si el lint falla, le muestra al agente las últimas 25 líneas de la salida para que lo corrija en el momento.

Se apaga con `"lintAlEditar": false`.

## Al terminar (`stop`)

Cuando Claude va a terminar su turno:

1. Lee `git status --porcelain --untracked-files=all` de cada repo con `.git` (cambios sin commit y archivos nuevos; no cuenta los borrados).
2. Si no hay cambios en ningún repo, termina sin revisar nada.
3. Corre los **generadores** de `regenerar` cuyas condiciones se cumplen.
4. En cada repo con cambios, corre sobre los archivos de `codigo` (menos `ignorar`):
   - `lint` con `{archivos}` (filtrados por `lintGlobs` si existe),
   - `tipos`,
   - `relacionadas` con `{archivos}` (si la salida coincide con `sinPruebas`, no es un fallo).

   Los tres corren **a la vez**, y los repos también. Si el cambio de un repo es idéntico al de la última vez (misma firma: commit, `git diff HEAD` y tamaño y fecha de cada archivo cambiado), reutiliza el resultado anterior en vez de repetirlo (`retroalimentacion.cache`). Tiempos y resultado quedan en `.neurodanza/estado.json`, que lee el mapa en vivo.
5. Revisa la **definición de terminado** (abajo).
6. Si hay algo, bloquea el final y le devuelve al agente la lista:

```
Antes de terminar, corrige esto (neurodanza):

✖ frontend · lint:
…

✖ frontend: hay cambios de código y la versión sigue en 1.2.0 (igual que main). Sube package.json (feat → minor, fix → patch).

• cambiaste pantallas (frontend/app/app/pedidos/page.tsx) sin tocar su guía de usuario. Si cambió lo que ve o hace el usuario, actualízala; si no, ignora este aviso.
```

Cada `✖` se registra en el catálogo de errores conocidos: si ya pasó en otra sesión, el mensaje trae `↳ se repite [firma]` o, si alguien anotó la solución, `↳ error conocido [firma]… Se resolvió así: …`.

`✖` son problemas **graves** (bloquean siempre); `•` son **avisos** (se muestran una sola vez: si el agente ya está continuando por un bloqueo anterior, los avisos no vuelven a bloquear).

### Tope de bloqueos

Para no quedar en un bucle, el hook cuenta los bloqueos graves seguidos de la sesión. Al llegar a `maxBloqueos` (3 por defecto) deja terminar y muestra:

```
neurodanza: siguen 2 problema(s) tras 3 intentos; revisa a mano.
```

## Definición de terminado

| Regla | Clave | Tipo | Cuándo salta |
|---|---|---|---|
| Versión | `version` | grave | Hay cambios en `version.cambios` y la versión de `version.archivo` (campo `version` del JSON) es igual a la de `ramaBase` (`git show main:package.json`). |
| Bitácora | `bitacora` | grave | La versión subió y no existe `bitacora.ruta/bitacora.archivo` (con `{minor}` o `{version}` reemplazados). |
| Migración | `migraciones` | grave | Cambió `migraciones.schema` en su repo y no hay ningún archivo nuevo o cambiado que coincida con `migraciones.nuevas`. |
| Panel aprobado | `pantallas` | grave | Cambiaron pantallas y en `panel.evaluaciones` no hay un JSON de la versión actual con `aprobado: true` y `promedio` mayor que `panel.umbral`. |
| Generador con error | `regenerar[].error` | grave | Un generador marcado con `"error": true` falló. Los demás pueden fallar sin bloquear. |
| Guía de usuario | `guias` | aviso | Cambiaron pantallas y ningún archivo de `guias`. |
| Evals | `evals.vigilar` | aviso | Cambiaron agentes, personas o skills y en `evals.informes` no hay un informe de la versión actual con `informe.aprobado: true`. |
| Docs | `docs` | aviso | Hubo cambios en algún repo y ninguno en el repo de documentación. |

Las reglas de versión, bitácora, panel y evals usan la versión actual: **si no configuras `version`, esas cuatro no se comprueban**.

### Generadores (`regenerar`)

```json
"regenerar": [
  { "nombre": "guías de usuario", "cuando": ["frontend:content/guias/**"], "comando": "node scripts/build-guides.mjs", "en": "frontend" },
  { "nombre": "índice de vistas", "cuando": ["docs:**", "frontend:content/guias/**"], "comando": "node docs/vistas/build-index.mjs", "error": true }
]
```

- `cuando`: `repo:glob`; el generador corre si alguno coincide con lo cambiado.
- `en`: repo donde se ejecuta; sin `en`, en la raíz del proyecto.
- `error`: si es `true`, un fallo bloquea.

## Tiempos

- Cada comando de lint, tipos o generador tiene hasta 240 s; las pruebas relacionadas, hasta 300 s.
- Todo el hook `Stop` tiene hasta 600 s (lo fija `hooks.json`). En proyectos grandes, prefiere `relacionadas` (solo las pruebas de lo cambiado) a correr toda la suite.
