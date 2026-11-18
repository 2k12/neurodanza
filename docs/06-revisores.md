# 6. Revisores

Cuatro agentes (`agents/revisor-*.md`) revisan cada cambio en el paso 3 de `/neurodanza-feature`. Se lanzan **en paralelo, en un solo mensaje**, y cada uno recibe **solo**: qué se pidió (una línea), los repos tocados, la rama, contra qué rama comparar y su presupuesto de pasos.

## Cuáles se lanzan

No siempre hacen falta los cuatro. `node <plugin>/lib/ciclo.mjs revisores` mira lo cambiado en la rama (commits contra la base y lo que no está en commit) y responde cuáles lanzar y por qué:

| Revisor | Se lanza si… |
|---|---|
| `revisor-docs` | hay cualquier cambio. |
| `revisor-ui` | cambiaron pantallas (`retroalimentacion.pantallas`) o archivos de interfaz (`.tsx`, `.jsx`, `.vue`, `.svelte`, estilos). |
| `revisor-permisos` | cambiaron pantallas, o archivos de rutas, controladores, guardias, roles, auth o middleware. |
| `revisor-coherencia` | cambió código en 2 repos o más, o un contrato (DTO, esquemas, validaciones, tipos, API, servicios). |

Con `"ciclo": { "revisores": "todos" }` se lanzan siempre los cuatro.

## Modelo y presupuesto

Los revisores corren con `model: sonnet`: leen un diff contra reglas escritas y no necesitan el modelo más grande, así que terminan antes y cuestan menos. Cada uno tiene un presupuesto de pasos (`ciclo.maxPasos.revisor`, 25 por defecto). Con el mapa instalado ([11-mapa-y-ciclo.md](11-mapa-y-ciclo.md)), recibe un aviso al 80 % y otro al llegar al tope; entonces entrega su JSON con lo que tiene y un hallazgo `baja` con lo que no alcanzó a revisar. Después de cambiar el modelo o el presupuesto, corre `/neurodanza-evals`.

## Qué reciben

**No** reciben el razonamiento ni las conclusiones de quien implementó: así juzgan el diff y no la explicación.

Cada revisor lee el diff por su cuenta (por defecto `git diff <rama base>` en cada repo de `repos`, más `git status` para archivos nuevos), puede leer archivos del repo para tener contexto y **no corrige nada**.

## Los cuatro

| Agente | Reglas del proyecto | Qué busca además |
|---|---|---|
| `revisor-coherencia` | `reglas.coherencia` | Que pantalla y servidor digan lo mismo: límites y validaciones (largos, formatos, decimales), códigos de error mostrados con un mensaje claro en el idioma del producto, estados y transiciones (la UI no ofrece lo que el servidor rechaza), contrato (DTOs, respuestas, códigos HTTP, mocks), datos aislados por cliente o empresa. |
| `revisor-permisos` | `reglas.permisos` | Cada endpoint nuevo o cambiado exige el permiso correcto (y el módulo o plan, si aplica); la pantalla oculta o deshabilita la escritura a quien solo lee; menú y guías coinciden con los permisos reales; ningún dato de otro cliente se filtra. |
| `revisor-ui` | `reglas.ui` | Componentes del sistema de diseño antes que HTML suelto; tema claro y oscuro con tokens; textos en el idioma del producto y errores que dicen qué hacer; accesibilidad (nombre accesible en botones de solo icono, `label`, foco visible, roles); estados de carga, vacío y error, y pruebas del comportamiento nuevo. |
| `revisor-docs` | `reglas.docs` y `retroalimentacion` | Guía de usuario actualizada (y regenerada si se compila), fichas y diagramas al día y válidos, bitácora de la versión (qué se agregó, cambios técnicos, decisiones, pantallas afectadas, despliegue), versión subida y guías escritas para el usuario. |

Las `reglas` del proyecto son la fuente de verdad y complementan las de cada agente. Ejemplo:

```json
"reglas": {
  "coherencia": ["Límites y validaciones iguales en pantalla y servidor (maxLength ↔ @MaxLength).", "Toda consulta Prisma filtrada por tenantId (multiempresa)."],
  "permisos": ["VIEWER nunca ve acciones de escritura."],
  "ui": ["Solo iconos de @phosphor-icons/react.", "UI densa (12–13.5 px, controles h-8)."],
  "docs": ["Versión del frontend subida (feat → minor, fix → patch)."]
}
```

## Respuesta

Cada revisor responde solo un JSON:

```json
{ "revisor": "ui", "aprobado": false, "hallazgos": [{ "gravedad": "media", "archivo": "features/crop/components/bed-row.tsx:43", "problema": "Botón de solo icono sin aria-label.", "arreglo": "Agregar aria-label=\"Eliminar cama\"." }] }
```

`aprobado` es `false` si hay algún hallazgo de gravedad **alta o media**. Los de gravedad baja no reprueban.

## Si alguno reprueba

1. Se corrigen los hallazgos altos y medios.
2. Se vuelve a verificar (lint, tipos, pruebas).
3. Se relanzan **solo** los revisores que reprobaron.

Máximo 2 vueltas. Si sigue reprobando, se te informa con los hallazgos.

## ¿Revisan bien?

Para saberlo están los evals: casos con errores sembrados y un control limpio. Ver [08-evals.md](08-evals.md).
