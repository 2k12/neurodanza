# Metodología · frontend

## 1. Perspectivas

| # | Rol | Pregunta que se hace |
|---|---|---|
| 1 | Product Designer (UX/UI) | ¿La vista ayuda a hacer la tarea principal, rápido y sin dudas? |
| 2 | UI / Visual Designer | ¿Se entiende de un vistazo qué es lo importante y qué va con qué? |
| 3 | Design Systems | ¿Este elemento es el mismo en todas las vistas? |
| 4 | Accesibilidad | ¿Lo usa alguien con teclado, lector de pantalla o poca visión? (WCAG 2.2 AA) |
| 5 | Contenido | ¿Los textos dicen qué hacer y qué pasó, en el idioma del usuario? |
| 6 | UX Research | ¿Qué le cuesta al usuario real? |
| 7 | Frontend | ¿Dónde nace el problema? ¿Se corrige sin tocar la lógica? |
| 8 | QA | ¿Qué podría romperse al corregirlo? |
| 9 | Product Owner | ¿Qué se corrige primero? |
| 10 | Seguridad y privacidad | ¿Muestra u ofrece más de lo que le corresponde a quien mira? |

Los roles 1 a 5 y 10 detectan, el 6 da contexto, y 7 a 9 deciden cómo y cuándo. Ocultar algo en la pantalla no es seguridad: si la API envía de más, es una incidencia de backend.

## 2. Lista por vista

En las tres resoluciones de la configuración, con datos de prueba y en los estados vacío, cargando y error:

- [ ] Espacio: el contenido útil domina la primera pantalla; márgenes de una sola escala.
- [ ] Jerarquía: un punto focal y una acción principal.
- [ ] Consistencia: mismos componentes y patrones que el resto.
- [ ] Accesibilidad: contraste, foco visible, teclado, etiquetas, tamaño de toque.
- [ ] Contenido: botones con verbo, errores que dicen cómo seguir.
- [ ] Estados: vacío, cargando, error y éxito; confirmación antes de lo irreversible.
- [ ] Responsive: sin desplazamiento horizontal en celular.
- [ ] Seguridad: revisada sin sesión y con cada rol.

## 3. Severidad, alcance y prioridad

| Nivel | Significado |
|---|---|
| S1 | Impide completar la tarea o excluye a usuarios |
| S2 | Se completa con esfuerzo o errores frecuentes |
| S3 | Molesta o se ve descuidado |
| S4 | Detalle visual sin efecto |

**Alcance:** Global · Módulo · Vista. **Esfuerzo:** Bajo (estilos) · Medio (estructura) · Alto (lógica o datos).

| Prioridad | Regla |
|---|---|
| P1 | S1, o S2 Global |
| P2 | S2 de módulo o vista, o S3 Global con esfuerzo Bajo |
| P3 | Lo demás |

## 4. Corregir sin romper

1. Auditar no es corregir: la auditoría solo registra.
2. Primero lo global (tokens y componentes compartidos).
3. Una incidencia de interfaz se corrige en estilos y marcado; si exige lógica o datos, se separa.
4. Las mismas pruebas antes y después, y capturas de ambos momentos.
5. Los hallazgos nuevos se registran, no se arreglan de paso.
6. Verifica el responsable en el navegador.
