# 13. Modo director

En un cambio grande, un solo agente que planifica **y** programa se satura: pierde el hilo, mezcla tareas y avanza de a una. En el **modo director**, el agente principal solo **dirige** (planifica, delega, integra y verifica) y cada parte del trabajo la hace un **implementador** especialista en su propio worktree, con un contrato.

```
                 ┌────────────────── DIRECTOR ──────────────────┐
                 │ no edita · divide · delega · integra · verifica│
                 └──┬───────────────┬───────────────┬────────────┘
         contrato → │               │               │
             implementador     implementador     implementador
             tarea api         tarea pantalla    tarea migración
             (worktree)        (worktree)        (worktree)
                 └───────── director.mjs integrar ──────────┘
                                    │
                    verificar → revisores → personas → cerrar
```

## Cuándo usarlo

| Situación | Modo |
|---|---|
| Toca 2 áreas o repos, más de ~8 archivos, o tiene partes que se pueden hacer a la vez | **director** |
| Cambio chico o muy acoplado (todo en los mismos archivos) | **directo** |

Más agentes no siempre es mejor: cada traspaso pierde contexto y cuesta tokens. El director rinde cuando el trabajo se divide limpiamente por **dueños de archivos**.

## Cómo funciona

`lib/director.mjs`:

| Comando | Qué hace |
|---|---|
| `activar` / `desactivar` | Prende o apaga el modo (`.neurodanza/director/modo.json`). |
| `preparar --tarea <id> --repos a,b --archivos "a:glob,b:glob" --objetivo "…" --terminado "…"` | Por cada repo: toma una **foto** del estado actual (commit + cambios sin commit + archivos nuevos, sin tocar tu rama ni tu índice), crea un worktree desde esa foto y **enlaza los `node_modules`** del repo real, para que el implementador pueda correr lint y pruebas sin instalar nada. Responde las rutas y el **contrato** listo para el implementador. |
| `integrar --tarea <id> [--forzar]` | Revisa que lo cambiado esté dentro del contrato. Si lo está, aplica el diff al repo real (con fusión de 3 vías si hace falta) y borra el worktree. Si hay archivos fuera del contrato o un conflicto, no aplica nada y lo dice. |
| `descartar --tarea <id>` | Borra el worktree sin integrar. |
| `estado` / `tareas` | Modo actual y tareas abiertas. |

Los worktrees viven **fuera del proyecto** (`director.worktrees`, por defecto `../.neurodanza-wt/<proyecto>`), para que ni el lint ni las pruebas del repo real encuentren copias. Al integrar o descartar, los enlaces a `node_modules` se quitan antes de borrar el worktree: las dependencias reales no se tocan.

## El contrato

```
## Contrato · tarea pedidos-api
Objetivo: filtro por fecha en GET /pedidos
Trabaja SOLO en estas carpetas (son worktrees; el repo real no se toca):
- backend: C:/…/.neurodanza-wt/mi-app/pedidos-api/backend
Archivos que te pertenecen (fuera de ellos, la barrera te bloquea):
- backend: src/pedidos/**
Terminado cuando: prueba del servicio con rango de fechas en verde
Presupuesto: 60 pasos; si llegas, entrega lo que tengas.
No hagas commit ni cambies de rama: el director integra tu diff.
```

El implementador (`agents/implementador.md`) responde un JSON: `terminado`, `archivos`, `verificado`, `pendiente`, `notas`.

## Barreras del modo director

Con el modo activo, las barreras ([04-barreras.md](04-barreras.md)) distinguen al agente principal de los subagentes (por el `agent_id` del hook):

| Quién | Qué se bloquea |
|---|---|
| Agente principal | Editar cualquier archivo salvo `.neurodanza/` (el plan). Comandos que modifican archivos (`sed -i`, redirecciones `>`, `rm`, `mv`, `cp`, `git checkout/reset/merge/apply…`, instalar paquetes, `--fix`/`--write`). Sí puede: lint, tipos, pruebas, `git status/diff/log/add/commit`, y `director.mjs`, `ciclo.mjs`, `errores.mjs`, `panel.mjs`. |
| Subagente en un worktree | Editar fuera de los archivos de su contrato. |
| Subagente fuera de un worktree | Editar el repo real mientras hay tareas abiertas. |

Además, las rutas protegidas y las migraciones inmutables valen **también dentro del worktree** (se juzga cada archivo como su par en el repo real), y el lint al editar corre en el worktree con la configuración de su repo.

## Permisos de Claude Code

Los worktrees están fuera de la carpeta del proyecto. Para que los implementadores editen ahí sin pedir permiso en cada archivo, agrega la carpeta a los directorios permitidos del proyecto (`.claude/settings.json`):

```json
{ "permissions": { "additionalDirectories": ["../.neurodanza-wt"] } }
```

`/neurodanza-init` lo propone.

## En el mapa

Con `neurodanza-mapa`, el modo director se ve como `◆ modo director` arriba del mapa, y cada implementador aparece como un nodo de la fase 1 con el nombre de su tarea, sus pasos (presupuesto 60) y su veredicto. Si un revisor reprueba y el director lanza una tarea de corrección, el mapa marca la vuelta.

## Lo que sigue

Cada implementador se lanza como un **constructo** (`--constructo implementador-frontend`): su contrato trae las lecciones que aprendió en el proyecto, y la reflexión al cerrar le anota los problemas que causó. Ver [14-constructos.md](14-constructos.md).
