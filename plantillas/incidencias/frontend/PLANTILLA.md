# Plantilla de incidencia

Se guarda en `registradas/{prefijo}-<MÓDULO>-NNN.md`. `GEN` es el módulo de lo compartido.

```markdown
# {prefijo}-<MÓDULO>-NNN · <qué pasa, no cómo arreglarlo>

| Campo | Valor |
|---|---|
| Estado | Abierta |
| Rol | quién lo ve |
| Vista y ruta | nombre · `/ruta` |
| Resolución | las tres de la configuración |
| Perspectiva que la detectó | rol de METODOLOGIA §1 |
| Categoría | Espacio · Jerarquía · Consistencia · Accesibilidad · Contenido · Estados · Responsive · Seguridad · Funcional |
| Severidad | S1 · S2 · S3 · S4 |
| Alcance | Global · Módulo · Vista |
| Esfuerzo y riesgo | Bajo · Medio · Alto |
| Prioridad | P1 · P2 · P3 |
| Incidencia raíz | — |
| Componente o archivo probable | `src/...` |
| Fecha y quién la registró | dd/mm/aaaa · nombre |

## Qué pasa
Una o dos frases, desde lo que ve el usuario.

## Evidencia
- Capturas: `capturas/{prefijo}-<MÓDULO>-NNN/antes/`
- Para reproducir: usuario de prueba y pasos.

## Por qué importa
A quién afecta y en qué tarea.

## Propuesta
Qué debería pasar (no el código).

## Riesgo al corregir
Flujos que podrían verse afectados y pruebas que los cubren, o «sin cobertura».

## Corrección
- Rama:
- Archivos cambiados:
- Qué se hizo:
- Pruebas (antes → después):
- Capturas del después: `capturas/{prefijo}-<MÓDULO>-NNN/despues/`
- Commit / PR:

## Seguimiento
- Verificada por: (solo el responsable)
```
