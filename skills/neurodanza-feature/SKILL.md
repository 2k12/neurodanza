---
name: neurodanza-feature
description: Ciclo automático para cada funcionalidad o corrección en un proyecto con neurodanza - entender, implementar, verificar, revisores según el riesgo del cambio, panel de personas simuladas con la app corriendo y ventana en vivo (aprueba si el promedio supera el umbral) y cerrar. Úsalo en un proyecto con neurodanza.config.json cuando el cambio toca varios archivos o repos, contratos, permisos o migraciones, o cuando el usuario lo pida. Un cambio chico (un repo, hasta unas 40 líneas, nada sensible) se hace directo, sin este skill - los hooks ya verifican.
---

# /neurodanza-feature: ciclo automático de una funcionalidad

Configuración: `neurodanza.config.json` en la raíz del proyecto (si no existe, corre `/neurodanza-init`).
Comandos: `<x>` = `node "<carpeta de este skill>/../../lib/x.mjs"` (la carpeta aparece arriba como «Base directory»); por ejemplo `<riesgo>` es `lib/riesgo.mjs`. `<panel>` = `node "<carpeta de este skill>/../../panel/panel.mjs"`. No los busques en el disco. En Git Bash de Windows antepone `MSYS_NO_PATHCONV=1`.
Referencias: `<carpeta de este skill>/referencias/<nombre>.md`. **Lee solo las que pida tu nivel de riesgo, y solo al llegar a ese paso.**
Nunca agregues coautoría ni firmas de IA en commits, PR o código.
Si el contexto de inicio trae **propuestas del autoajuste** (`neurodanza (autoajuste): …`), díselas al usuario en una línea al empezar (`<autoajuste> propuestas`) y aplícalas solo con su visto bueno (`<autoajuste> aplicar --id <id>`; la ventana de permisos también se lo pregunta). Las **lecciones de este proyecto** del contexto de inicio salen de sesiones anteriores: síguelas.

## 0. Riesgo
Prevé el nivel con los archivos que vas a tocar: `<riesgo> --archivos "<repo:archivo,…>" --lineas <líneas de código que estimas>`. Responde `nivel`, `motivos` y `plan` (qué corre). El real se confirma con el diff (`<ciclo> revisores`); si sube, sigue el plan del nivel nuevo.

| Nivel | Qué haces |
|---|---|
| **Bajo** | Di en una línea qué vas a hacer y hazlo: pasos 1 y 2, y cierra. Sin plan en archivo, subagentes ni más referencias. |
| **Medio** | `planificar` (plan corto; recorridos solo si hay pantallas) → 1 → 2 → `revision` (un revisor) y, si `plan.personas` > 0, `panel` → `cerrar`. |
| **Alto** | `planificar` completo → 1 → 2 → `revision` y, si `plan.personas` > 0, `panel` → `cerrar`. `director` solo si `plan.director` es true o el usuario lo pide. |

Con riesgo medio o alto, espera el visto bueno del usuario antes de tocar código. Pregunta solo lo que cambia el resultado.
- Para ubicarte sin leer el repo: `<indice> resumen --repo <r> --foco <tema, ruta o glob>` y `<indice> buscar --que <texto>`. Si ya sabes qué archivo es, ve directo.
- Si un subagente se corta, queda sin latido o en cuarentena: `reenfundar`.
- Si la barrera dice que el ciclo llegó a su tope de gasto, no insistas: di qué falta y pregúntale al usuario.
- Lanza subagentes solo si `plan` lo dice: cada uno cuesta tokens.

## 1. Implementar
- Rama de trabajo en cada repo tocado (no trabajes directo en la rama principal).
- Código + pruebas + documentación según la definición de terminado (`reglas.docs` y `retroalimentacion` de la configuración). Con recorridos acordados, también son criterio de terminado: `<recorridos> contrato --ciclo <ciclo>` dice qué pasos deben poder hacerse.
- **Prueba primero**, cuando hay una prueba determinista posible y un resultado claro: escribe la prueba, `<pruebas> rojo --repo <repo> --archivo <prueba>` (debe fallar: si pasa, no prueba lo nuevo), implementa y `<pruebas> verde --repo <repo> --archivo <prueba>`. Una prueba por cada regla pedida (una por spec `S#` si hay documento) y una por cada comando u opción existente que el cambio toca, que demuestre que lo de antes sigue igual; ninguna más. Si no aplica, explica por qué en el informe. El hook `Stop` avisa (`ciclo.pruebaPrimero: "avisar"`) si una prueba nueva o cambiada no se vio en rojo.
- Las barreras y el ciclo de retroalimentación (hooks del plugin) corren solos; corrige lo que marquen.
- **Errores conocidos:** si un hook trae `↳ error conocido [firma]… Se resolvió así: …`, aplica esa solución primero. Si dice `↳ se repite [firma]` y lo resuelves, anota cómo: `<errores> resolver --firma <firma> --solucion "<qué hiciste, en una línea>"`. Para buscar uno: `<errores> listar`.
- **La app por comandos (`<app>`), en vez de escribir scripts a mano:** `<app> api <METODO> <ruta> --como <persona|ROL|admin> [--cuerpo '<json>']` entra con la sesión de esa persona (en caché) y muestra la respuesta compacta; `<app> estado` dice si la app responde; `<app> abrir <ruta> --como <persona>` deja una captura. Las tareas propias del proyecto son **macros**: `<app> macros` las lista y `<app> macro <nombre> --<variable> <valor>` corre una. Si la barrera avisa que un comando largo ya se repitió, propónle al usuario guardarlo (`<app> sugeridas`; con su visto bueno, `<app> aceptar --id <id> --nombre <nombre> [--comando "<con {variables}>"]`, que también le pide aprobación en la ventana de permisos). Al cerrar, si `<app> podar` lista macros sin uso, propónle borrarlas.

## 2. Verificar
Corre lint, tipos y pruebas **relacionadas** de cada repo tocado **en paralelo**: `<app> verificar --repo <repo> --archivos <a,b>` (uno por repo, en un solo mensaje) los corre a la vez con los comandos de `repos[]` y solo muestra el final de lo que falla. Todo en verde antes de seguir. El hook `Stop` no repite lo que ya pasó con el mismo código (caché) y corre la **suite completa en segundo plano** (`repos[].suite`): no la corras tú. Comandos que pueden no terminar (servidores, modo watch, suites completas) llevan `timeout` o van en segundo plano: la barrera rechaza los que no y te dice cómo correrlos.

Si un paso no trae nada nuevo (la misma prueba, el mismo archivo ya leído), no lo repitas.

## 3. Cerrar con riesgo bajo
`<fondo> esperar` solo si el repo tiene `suite`. Informe de pocas líneas. Commit y push **solo si el usuario lo pidió**.
