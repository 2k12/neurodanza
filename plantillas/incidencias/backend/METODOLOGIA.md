# Metodología · backend

## 1. Perspectivas

| # | Rol | Pregunta que se hace |
|---|---|---|
| 1 | Arquitectura de API | ¿El contrato es claro, estable y coherente con las demás rutas? |
| 2 | Datos | ¿Los datos quedan íntegros? ¿Hay validaciones, transacciones e índices donde hacen falta? |
| 3 | Seguridad y privacidad | ¿Responde solo a quien debe, y solo lo que la tarea necesita? (OWASP ASVS) |
| 4 | Rendimiento | ¿Responde a tiempo con datos reales? ¿Pagina? ¿Repite consultas? |
| 5 | QA | ¿Qué prueba lo cubre? ¿Qué consumidores podrían romperse? |

## 2. Lista por ruta

- [ ] Contrato: métodos, códigos HTTP y errores coherentes; los campos se llaman igual que en otras rutas.
- [ ] Validación: vacíos, largos, tipos, límites y duplicados.
- [ ] Permisos: sin sesión, con cada rol y con un recurso de otro usuario o cliente.
- [ ] Privacidad: la respuesta no trae datos que nadie usa; los errores no muestran trazas.
- [ ] Datos: escrituras múltiples en una transacción; no quedan registros huérfanos.
- [ ] Rendimiento: listados con paginación; sin una consulta por fila.
- [ ] Repetición: reintentar una escritura no la duplica.
- [ ] Registro: un fallo deja rastro sin guardar datos sensibles.

## 3. Severidad, alcance y prioridad

| Nivel | Significado |
|---|---|
| S1 | Pérdida o fuga de datos, acceso indebido o servicio caído |
| S2 | Respuesta equivocada o errores frecuentes |
| S3 | Lento, incoherente o difícil de usar |
| S4 | Detalle sin efecto para quien consume |

**Alcance:** Global (código compartido) · Módulo · Ruta. **Esfuerzo:** Bajo · Medio · Alto (contrato, migración o datos).

| Prioridad | Regla |
|---|---|
| P1 | S1, o S2 Global |
| P2 | S2 de módulo o ruta, o S3 Global con esfuerzo Bajo |
| P3 | Lo demás |

## 4. Corregir sin romper

1. Auditar no es corregir: la auditoría solo registra.
2. Primero una prueba que falle por la incidencia; después, la corrección.
3. Si cambia el contrato, se avisa a sus consumidores y se registra la incidencia de frontend que corresponda.
4. Los cambios de datos van en una migración nueva.
5. La misma petición antes y después, contra la app local y con usuarios de prueba.
6. Verifica el responsable.

**Evidencia:** se guarda la petición y la respuesta. Se ocultan claves, tokens, correos y otros datos personales por el nombre del campo, pero conviene revisar el archivo antes de subirlo.
