# 15. Velocidad: que el harness nunca se quede colgado

Cinco piezas para que un ciclo de `/neurodanza-feature` no se quede esperando algo que no va a llegar, y un banco de pruebas que mide cuánto mejora (`bench/`).

| Pieza | Qué evita | Dónde |
|---|---|---|
| **Stop en dos velocidades** | Que el hook `Stop` espere minutos por una suite lenta o un comando colgado | `hooks/feedback.mjs`, `lib/fondo.mjs`, `lib/procesos.mjs` |
| **Timeout obligatorio en comandos** | Que un agente se quede mirando `npm run dev` o un `vitest` en modo watch | `hooks/guardrails.mjs` |
| **Corte por tiempo** | Que un subagente siga 40 minutos dando vueltas | `lib/agentes.mjs`, `hooks/guardrails.mjs`, mapa |
| **Fusible** | Reintentar sin fin algo externo que no responde (la app, Chromium, la base de datos) | `lib/fusible.mjs`, `panel/panel.mjs` |
| **Revisores y panel en paralelo** | Esperar a los revisores para recién empezar el panel | `skills/neurodanza-feature/SKILL.md` |

## 1. Stop en dos velocidades

Antes, el hook `Stop` corría lint, tipos y pruebas relacionadas con hasta 240–300 s por comando, y tenía 600 s de tope en `hooks.json`. Un comando colgado lo dejaba esperando 5 minutos; y en Windows, al vencer el tiempo, `exec` mataba solo el shell y el proceso real quedaba **huérfano**.

Ahora:

- **Parte que bloquea**, con hora límite (`retroalimentacion.topeStopSeg`, 90 s por defecto): generadores, lint de los archivos cambiados, tipos y pruebas relacionadas, en paralelo por repo y con la caché por firma de siempre.
- **Lo que no alcanza** se corta (se mata el **árbol completo** de procesos: `taskkill /T /F` en Windows, el grupo en macOS y Linux), se marca «no alcanzó a correr» y **pasa al fondo**. Nunca cuenta como bien.
- **El fondo** (`lib/fondo.mjs`) es un proceso desacoplado (`spawn` con `detached`, `unref`, `windowsHide`) que corre la **suite completa** de cada repo tocado (`repos[].suite`) y lo que no alcanzó. Escribe su avance en `.neurodanza/fondo.json` junto con la **firma del cambio** que verifica. Cada tarea tiene su propio tope (`retroalimentacion.topeFondoSeg`, 30 min).
- **Un cambio nuevo cancela el fondo anterior** (mata su árbol por PID) y empieza otro con la firma nueva.
- **El resultado se informa** en el siguiente `Stop` o al iniciar la sesión:

  | Estado del fondo para el cambio actual | Qué hace el Stop |
  |---|---|
  | falló | **bloquea**, con el detalle |
  | sigue corriendo | lo dice, **sin bloquear** |
  | es de otro cambio | lo descarta |
  | pasó | lo usa: no repite esa comprobación |

- **El cierre del ciclo sí exige la suite completa** para la firma actual: el paso 5 del skill corre `node <plugin>/lib/fondo.mjs esperar` (sale con 0 si pasó, 1 si falló, 2 si sigue corriendo o es de otro cambio). Los `Stop` intermedios no bloquean por eso.
- **Timeouts de los hooks:** `Stop` 120 s (= `topeStopSeg` + margen; por eso `topeStopSeg` va de 10 a 110), lint al editar 60 s (el lint de un archivo se corta a los 50 s), el resto 10 s.

```
node <plugin>/lib/fondo.mjs estado      qué corre en segundo plano y para qué cambio
node <plugin>/lib/fondo.mjs esperar     espera la suite completa del cambio actual (--tope <seg>, 900 por defecto)
node <plugin>/lib/fondo.mjs cancelar    mata lo que esté corriendo
```

Los **generadores** (`retroalimentacion.regenerar`) siguen en la parte que bloquea: cambian archivos, y correrlos en segundo plano mientras el agente edita sería una carrera. Si no caben en el tope, pasan al fondo como lo demás.

## 2. Timeout obligatorio en cada comando

En `PreToolUse` para `Bash` y `PowerShell`, un comando que coincide con un patrón de `barreras.timeoutComandos.largos` **se rechaza** si la llamada no trae un límite:

- `timeout` de la herramienta (milisegundos) de hasta `maxSeg` × 1000, o
- `run_in_background: true`, o
- el comando envuelto en `timeout`/`gtimeout` (o `-Timeout` en PowerShell).

El mensaje dice exactamente cómo correrlo:

| Tipo | Patrones por defecto | Qué propone |
|---|---|---|
| `servidor` | `npm run dev`/`start`/`serve`, `next dev`, `nest start`, `vite`, `nodemon`, `webpack serve` | La app la levanta el ciclo una sola vez (`app.levantar`); si hace falta otro servidor, `run_in_background: true` |
| `watch` | `--watch`, `-w` en tsc/vitest/jest/node/webpack… | Sin modo watch (`vitest run`, `tsc --noEmit`) o en segundo plano |
| `suite` | `npm test` sin filtro, `vitest` sin `run`, `jest` sin `--ci` ni archivo, `playwright test` sin `--timeout` | Las pruebas relacionadas con filtro de archivos, o la suite con `timeout` |

Claude Code ya pone 120 s por defecto a un comando sin `timeout`; la barrera evita que un agente se quede esos minutos mirando un servidor o un modo watch que nunca termina, y le dice la forma correcta. Se apaga con `"timeoutComandos": { "activo": false }`.

## 3. Corte por tiempo, no solo por pasos

En cada evento de hook con `agent_id`, `guardrails.mjs` actualiza `.neurodanza/agentes/<agent_id>.json`: cuándo empezó, su tipo, su último paso y cuántos pasos lleva. Es **un archivo por agente**, con escritura atómica (temporal + rename): varios agentes a la vez no se pisan ni pierden actualizaciones, sin bloqueos.

| Momento | Qué pasa |
|---|---|
| 80 % de `ciclo.maxSegundos` | Aviso al subagente, una vez, como contexto junto al resultado de su herramienta (sin decidir permisos) |
| 100 % | La barrera **rechaza toda herramienta nueva** de ese agente: «neurodanza: se acabó tu tiempo. Entrega YA tu respuesta…». Funciona sin el mapa |
| `ciclo.latidoSeg` sin un paso | Queda marcado **sin latido** (en su archivo y en el mapa) para que el director decida relanzarlo |

Topes por defecto: revisores 300 s, personas 420 s, implementadores 900 s, otros 420 s; latido 90 s. **El agente principal nunca queda bloqueado** por este corte. Al terminar un subagente (`SubagentStop`), su registro se marca terminado.

Límites de lo que un hook puede hacer: Claude Code no deja a un hook matar a un subagente en medio de una herramienta. Si lo que traba al agente es un comando, lo acotan los timeouts del punto 2; si deja de dar pasos, el latido lo marca en cuanto corre cualquier hook (de otro agente) o el mapa, y su siguiente herramienta se rechaza si ya agotó su tiempo.

El mapa muestra el tiempo usado / total de cada subagente y marca «⚠ sin latido» y «⚠ sin tiempo».

## 4. Fusible

`lib/fusible.mjs` cuenta los fallos de cada capa externa en el ciclo (`.neurodanza/fusible.json`, se reinicia al empezar uno nuevo con `fusible.mjs reiniciar`):

| Capa | Quién registra el fallo |
|---|---|
| `app` | `panel.mjs` cuando la app no responde (`panel.mjs app`, `usuarios`, `navegar`) o el login no avanza |
| `chromium` | `panel.mjs` cuando no hay Playwright o Chromium no abre |
| `bd` u otra | `fusible.mjs comprobar --capa <c>` con el comando de `fusible.comprobaciones`, o `fusible.mjs falla` a mano |

**Con `fusible.maxFallos` fallos (2) la capa queda fundida:** `panel.mjs` no la reintenta (sale con 3), el skill la salta, el hook `Stop` lo informa como «no se pudo verificar: <capa> (motivo)», y el panel queda **pendiente**: ni aprobado ni reprobado, lo decides tú. El mapa lo muestra.

```
node <plugin>/lib/fusible.mjs estado [--capa <c>]
node <plugin>/lib/fusible.mjs falla --capa <c> --detalle "…"
node <plugin>/lib/fusible.mjs comprobar --capa bd
node <plugin>/lib/fusible.mjs reiniciar
```

## 5. Revisores y panel en paralelo

Con el diff verificado, el skill lanza **en el mismo turno** los revisores que aplican y a las personas, sobre **una sola app** levantada antes (y comprobada con `panel.mjs app`). Las personas también corren a la vez entre ellas: cada una en su propio proceso, con su usuario y su propio navegador (no comparten sesión). La ventana Role Agents admite varias personas hablando a la vez.

Si un revisor reprueba con un hallazgo alto mientras el panel corre, el panel termina su ronda pero **esa ronda no puede aprobar el cambio** (`"revisores": "reprobados"` en el JSON del panel): se repite tras la corrección. `calificar` y el hook `Stop` lo hacen cumplir.

## Banco de pruebas

`node bench/bench.mjs` mide seis métricas sobre un proyecto de prueba (5 corridas, mediana). Resultados de esta parte, medidos en Windows 11 con Node 26:

| Métrica | Antes (0.6.1) | Ahora (0.7.0) | Mejora |
|---|---|---|---|
| Stop con un cambio normal | 1,55 s | 1,61 s | −3,7 % |
| Stop con un comando colgado | 300,4 s | 85,5 s | 71,6 % |
| Latencia de la barrera por llamada | 76,5 ms | 85,9 ms | −12,3 % |
| Subagente congelado | sin corte | cortado al vencer su tope | — |
| Del diff al veredicto (revisores + panel) | 50,4 s | 30,4 s | 39,6 % |
| App que no arranca | 28,5 s · 12 intentos | 3,8 s · 2 intentos | 86,7 % |

Cómo se mide y por qué empeoraron dos métricas: [`bench/README.md`](../bench/README.md).
