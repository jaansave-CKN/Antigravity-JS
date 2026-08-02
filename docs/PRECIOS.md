# Precios — RadFor-360 (2026-08-02)

Precios propuestos para el mercado B2B institucional colombiano (consultores,
ONG, entidades territoriales que formulan proyectos de inversión/cooperación
— MGA, Obras por Impuestos, cooperación internacional). Son un punto de
partida razonado, no el resultado de investigación de mercado empírica —
ajustar con datos reales de willingness-to-pay antes de un lanzamiento formal.

| Plan | Precio/mes (COP) | Razonamiento |
|---|---|---|
| Radar | $149.000 | Entrada accesible para monitoreo continuo de convocatorias — valor recurrente pero no reemplaza trabajo especializado. |
| Formulador | $399.000 | Motor de valor principal: reemplaza horas de consultor especializado en formulación de proyectos (M3–M12). Precio ancla a lo que costaría delegar esa labor externamente. |
| Suite | $499.000 | Combo Radar + Formulador con ~9% de descuento sobre la suma (149k+399k=548k) — patrón estándar de bundling SaaS. |

Fuente única de verdad: `backend/routes/subscriptions.routes.js` (`PLANES`).
El frontend (`PlanesPage.tsx`) consume `GET /api/plans` — no mantener una
copia separada de estos números ahí.
