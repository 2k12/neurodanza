# Plantilla de incidencia

Se guarda en `registradas/{prefijo}-<MÓDULO>-NNN.md`. `GEN` es el módulo de lo compartido.

```markdown
# {prefijo}-<MÓDULO>-NNN · <qué pasa, no cómo arreglarlo>

| Campo | Valor |
|---|---|
| Estado | Abierta |
| Rol | con qué rol ocurre |
| Método y ruta | `GET /ruta` |
| Perspectiva que la detectó | rol de METODOLOGIA §1 |
| Categoría | Contrato · Validación · Permisos · Privacidad · Datos · Rendimiento · Errores · Funcional |
| Severidad | S1 · S2 · S3 · S4 |
| Alcance | Global · Módulo · Ruta |
| Esfuerzo y riesgo | Bajo · Medio · Alto |
| Prioridad | P1 · P2 · P3 |
| Incidencia raíz | — |
| Componente o archivo probable | `src/...` |
| Fecha y quién la registró | dd/mm/aaaa · nombre |

## Qué pasa
Qué responde hoy y qué debería responder.

## Evidencia
- Petición y respuesta: `capturas/{prefijo}-<MÓDULO>-NNN/antes/`
- Para reproducir: usuario de prueba y datos.

## Por qué importa
A quién afecta (qué pantallas o servicios consumen la ruta).

## Propuesta
Qué debería pasar (no el código).

## Riesgo al corregir
Consumidores y datos afectados; pruebas que los cubren, o «sin cobertura».

## Corrección
- Rama:
- Archivos cambiados:
- Qué se hizo:
- Prueba que falló antes y pasa después:
- Respuesta del después: `capturas/{prefijo}-<MÓDULO>-NNN/despues/`
- Commit / PR:

## Seguimiento
- Verificada por: (solo el responsable)
```
