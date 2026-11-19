# Banco de pruebas de velocidad

`bench.mjs` (sin dependencias) mide cuánto tarda el harness en las situaciones que lo dejaban colgado. Arma un proyecto de prueba a partir de `fixture/` en una carpeta temporal —una raíz con `neurodanza.config.json` y dos repos git, `api/` y `web/`— y corre los hooks reales del plugin que se le indique.

```
node bench/bench.mjs --plugin <carpeta del plugin> --salida bench/base.json     # 5 corridas por métrica (mediana)
node bench/bench.mjs --solo stop_normal,guardrails_ms --corridas 1             # rápido, para probar
node bench/bench.mjs --comparar bench/base.json,bench/parte1.json              # tabla base vs. ahora
```

La base se midió contra una copia intacta de `main` (0.6.1) mientras se escribía el código nuevo, para que los cambios no la contaminaran.

## El proyecto de prueba (`fixture/`)

| Pieza | Qué simula |
|---|---|
| `herramientas/tarea.mjs` | Lint, tipos y pruebas: scripts Node con una duración fija (sin ESLint ni TypeScript reales). Con `--colgable` y `BENCH_COLGADO=1` no termina nunca; con `BENCH_FALLA=<nombre>` falla. |
| `api/` | lint 0,4 s · tipos 0,9 s · pruebas relacionadas 1 s (colgables) · **suite completa 30 s** (`repos[].suite`) |
| `web/` | lint 0,3 s · tipos 0,7 s · pruebas relacionadas 0,6 s |
| `servidor.mjs` | La app. `BENCH_APP=caido`: no arranca. `BENCH_APP=500`: responde 500. |
| `neurodanza.config.json` | Configuración del proyecto. Para medir rápido el corte por tiempo usa topes cortos: `ciclo.maxSegundos.revisor: 20`, `ciclo.latidoSeg: 8` (los valores por defecto son 300 y 90). |

## Las métricas

| Métrica | Cómo se mide |
|---|---|
| `stop_normal` | Tiempo de pared del hook `Stop` con un cambio en ambos repos (contenido nuevo cada corrida: sin caché). |
| `stop_colgado` | Igual, con las pruebas relacionadas de `api` colgadas (`BENCH_COLGADO=1`). Tope de medición: 330 s. También cuenta procesos huérfanos que queden vivos. |
| `guardrails_ms` | Latencia media por llamada de `hooks/guardrails.mjs`: 1000 eventos variados por stdin (Read, Edit, Write, Bash, PowerShell, Grep; un tercio de subagentes). Incluye el arranque de Node, que es lo que paga cada llamada real. |
| `subagente_congelado` | Un subagente falso (revisor) da 3 pasos y se congela; otro sigue dando pasos (así corren los hooks). Se mide cuándo el harness lo marca «sin latido» y cuándo lo da por agotado (corte), y si al volver se le rechaza la herramienta. Sin corte se informa el tope de medición (45 s). |
| `revision_y_panel` | Ciclo simulado desde «diff listo» hasta «veredicto»: revisores falsos 4 × 20 s (en paralelo entre ellos) y personas falsas 3 × 30 s, más levantar la app real del proyecto de prueba. El orden lo lee del `SKILL.md` del plugin medido: si dice que revisores y panel van **en el mismo turno**, corren a la vez; si no, uno después del otro. |
| `fallo_externo` | La app no arranca. Se siguen las reglas del skill: hasta `panel.maxRondas` (3) rondas, en cada una se levanta la app y cada una de las 3 personas intenta entrar (3 s simulados por intento de persona + una petición HTTP real). Con `lib/fusible.mjs` en el plugin, cada fallo se registra y, con la capa fundida, el ciclo avanza con el panel pendiente. Se informan intentos y tiempo. |

Los subagentes, revisores y personas son simulados (procesos con demoras controladas y eventos de hook reales): miden la orquestación y los hooks, no la velocidad de un modelo.

## Resultados

### Base (0.6.1, Windows 11, Node 26, 5 corridas, mediana)

| Métrica | Base |
|---|---|
| `stop_normal` | 1,5 s |
| `stop_colgado` | 300,4 s (esperó el tope interno de las pruebas relacionadas; 0 huérfanos) |
| `guardrails_ms` | 76,5 ms |
| `subagente_congelado` | sin corte (tope de medición 45 s); al volver, la herramienta se permitió (re-medido con el banco corregido: mismo resultado) |
| `revision_y_panel` | 50,4 s (revisores, después panel) |
| `fallo_externo` | 28,5 s · 12 intentos · se rinde (informa al usuario) |

Datos completos: [`base.json`](base.json).

### Parte 1 (0.7.0, mismas condiciones)

| Métrica | Base | Ahora | Mejora |
|---|---|---|---|
| `stop_normal` | 1,55 s | 1,61 s | −3,7 % (empeoró) |
| `stop_colgado` | 300,4 s | 85,5 s | 71,6 % |
| `guardrails_ms` | 76,5 ms | 85,9 ms | −12,3 % (empeoró; límite: 25 %) |
| `subagente_congelado` | sin corte (tope de medición 45 s) | corte a los 20,9 s; «sin latido» a los 10,5 s; al volver, rechazado | antes no se cortaba |
| `revision_y_panel` | 50,4 s | 30,4 s | 39,6 % |
| `fallo_externo` | 28,5 s · 12 intentos · se rinde | 3,8 s · 2 intentos · avanza con el panel pendiente | 86,7 % |

Mejora = (base − ahora) / base × 100. Datos completos: [`parte1.json`](parte1.json).

Lo que empeoró y por qué:

- **`stop_normal` (+3,7 %, +60 ms):** el Stop ahora decide qué pasa al fondo, lo lanza (un proceso desacoplado, ~10 ms), revisa el fusible y registra más estado. Una primera versión quedaba en +20 %: las firmas de cada repo se calculaban una tras otra antes de empezar las comprobaciones (~300 ms) y la cancelación del fondo anterior esperaba a `taskkill` (~600 ms en Windows). Ahora las firmas corren en paralelo y la cancelación no espera.
- **`guardrails_ms` (+12,3 %):** cada llamada de un subagente registra su paso (`.neurodanza/agentes/<id>.json`) y revisa el latido de los demás. La medida tiene ruido: con el mismo código, otra corrida dio 79,2 ms (+3,6 %), y en esta las dos últimas pasadas dieron 91,9 y 126,2 ms. En ambas queda bajo el límite del 25 %.

Notas para leer los números:

- `subagente_congelado` usa los topes cortos del proyecto de prueba (revisor 20 s, latido 8 s): el corte llega cuando vence el tope configurado. Con los valores por defecto sería a los 300 s (revisor) y el latido a los 90 s.
- `stop_colgado` ahora corta a los 85 s (tope de 90 s menos el margen 5 s): la prueba colgada se corta, se informa «no alcanzó a correr» y pasa al fondo. 0 huérfanos en ambas versiones.
- `revision_y_panel` y `fallo_externo` miden la orquestación que indica el skill con agentes simulados: el ahorro real depende de cuánto tarden los revisores y las personas de verdad.
