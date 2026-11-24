## Ciclo de calidad (neurodanza)

Este proyecto usa el plugin [neurodanza](https://github.com/2k12/neurodanza). Configuración: `neurodanza.config.json`.

- **Barreras (automáticas):** antes de cada herramienta se bloquean secretos (`.env`), firmas de IA en commits y código, borrados de rutas raíz y las reglas propias del proyecto. Si algo se bloquea, corrige la causa; no te saltes la barrera.
- **Retroalimentación (automática):** lint del archivo al editar; al terminar, lint, tipos y pruebas relacionadas de lo cambiado y la definición de terminado (versión, bitácora, migraciones, guías, panel aprobado).
- **Cada funcionalidad o corrección:** `/neurodanza-feature` (entender → implementar → verificar → revisores y panel de personas con la app corriendo, según el riesgo → cerrar).
- **Evaluadores:** `/neurodanza-evals` al cambiar agentes, personas o umbrales, y una vez por versión.
- Nunca coautoría ni firmas de IA en commits, PR o código.
