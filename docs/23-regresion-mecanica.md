# 23. Regresión mecánica: primero sin modelo, la persona solo donde algo cambió

Hasta la 1.1.2, una persona del panel probaba **las pantallas del diff**, y la memoria de recorridos comparaba con la versión aprobada **solo los recorridos que las personas ejecutaban**. Un cambio en un componente compartido podía romper otra pantalla que nadie pensó revisar, y no se veía.

Ahora el ciclo repite **mecánicamente** (sin modelo) todos los recorridos permanentes que el cambio puede tocar, y solo lo que cambió va a la persona dueña de ese recorrido para que lo juzgue.

## 1. Mapa de impacto

```bash
node lib/impacto.mjs                                         # con el diff de la rama
node lib/impacto.mjs --archivos "web:src/ui/tabla.tsx"       # previsto
```

Del archivo cambiado sube por **quién importa a quién** (el índice de [19](19-menos-exploracion.md)) hasta las pantallas. Un `layout` de Next alcanzado afecta a todas las pantallas de su carpeta. De ahí saca los **recorridos permanentes** que pasan por esas pantallas: las rutas de sus pasos y las que esperan alcanzar, con segmentos dinámicos (`/pedidos/[id]` coincide con `/pedidos/7`). Devuelve:
- `pantallas`, con el camino;
- `afectados`, `noAfectados`;
- `duenos`: las personas de los afectados.

## 2. Repetir sin modelo

```bash
node panel/panel.mjs repetir --version 1.4.0 --ronda <carpeta de la ronda>
```

Cada recorrido afectado se ejecuta **como su persona**: su usuario y su propio contexto del navegador. Antes de cada paso espera a que la pantalla cargue ([1.1.1](../CHANGELOG.md)). Al final de cada paso toma la **firma de la pantalla**:
- título;
- controles y campos visibles;
- un hash del texto sin números, para que fechas y totales no cuenten como cambio.

Después compara con la última versión **aprobada** de su memoria:

| Estado | Qué significa | Quién lo mira |
|---|---|---|
| `igual` | Mismas métricas y mismas pantallas | Nadie: no gasta pasos de modelo |
| `diferencias` | Aparece o desaparece un control o campo, cambia el título o el texto | Su dueña, en **modo juzgar**: ¿es a propósito o se rompió algo? |
| `regresion` | Más clics o tiempo, un paso que dejó de cumplir, errores nuevos (las reglas de [18](18-panel-con-recorridos.md)) | Su dueña, en modo juzgar |
| `primera vez` | Sin versión aprobada | Queda como base cuando la ronda apruebe |

**La ventana en vivo se mantiene.** Las dueñas de los recorridos repetidos se suman a la ronda (evento `persona`) y cada una dice su fila:
- «✔ Repetí "Importar clientes": igual que en la v1.3.0 (1 clic, 0,8 s)»;
- «⚠ "Importar clientes" cambió frente a la v1.3.0: paso 1: ya no está "Importar"».

Las personas del panel siguen probando las pantallas del diff como antes: lo nuevo no tiene contra qué compararse, así que eso no se hace mecánico.

**Modo juzgar** (`agents/persona-evaluadora.md`). No navega desde cero: lee la entrada de su recorrido en `repeticion.json` y mira solo las capturas de los pasos que cambiaron. Decide en la ventana si el cambio es a propósito o se rompió algo, y deja su nota, que entra al resultado como las demás.

Con la ronda aprobada, `calificar` deja lo repetido en esa versión como la **nueva base**.

## Medido

**Banco (`regresion_impacto`).** El cambio toca un componente compartido y la pantalla de pedidos, que es la del diff. La pantalla de clientes usa el mismo componente pero nadie la cambió. En el caso «roto», clientes perdió «Importar». Productos no usa el componente. Hay 3 recorridos permanentes con su versión aprobada. El caso «limpio» no tiene regresión y mide los falsos positivos.

| | 1.1.2 | 1.2.0 |
|---|---|---|
| Regresión en clientes (fuera del diff) | **no detectada** | **detectada** (`regresion`: el paso crítico dejó de cumplir y «Importar» ya no está) |
| Falsos (roto + limpio) | 0 | 0 |
| Pasos de modelo, caso roto | 14 | 17 (+3: la dueña de clientes juzga) |
| Pasos de modelo, caso limpio | 14 | 14 (lo que sigue igual no cuesta) |
| Recorridos repetidos sin modelo | 0 de 3 | 2 de 3 (productos no está afectado), entre 30 y 52 ms |

**Lo que empeoró:** con una regresión, el ciclo cuesta 3 pasos de modelo más, porque ahora la ve y alguien la juzga. Sin regresión cuesta lo mismo.

**Lo que no mide el banco:** la repetición con Playwright en una app real. El banco usa la app simulada por HTTP con la misma interfaz de navegador. Con Chromium, cada recorrido tarda lo que tarde la app, más la espera de carga de cada pantalla.

## Configuración

Usa `panel.recorridos`, `panel.memoria`, `panel.regresion` y `panel.carga`: ver [03-configuracion.md](03-configuracion.md#panel).
