---
tipo: requisitos
actualizado: 2026-08-03
---

# Requisitos — RadFor-360

Vuelve a [[00_INDEX]]. Relacionado: [[registros_arquitectura]] (cómo se implementó), [[hseq_normativa]] (obligaciones legales), [[pendientes]] (lo que aún no cumple esto).

## Usuarios objetivo

- Formuladores de proyectos de inversión pública / cooperación internacional en Colombia (municipios, entidades territoriales, consultores).
- Requieren: encontrar financiación (Radar), formular el proyecto con rigor técnico (Formulador), y radicarlo en el formato que exige cada cooperante (MGA/BID/OXI).

## Módulo 1 — Radar de convocatorias

- Dos modos de rastreo (ver [[registros_arquitectura]]):
  - **Rastreo 1**: scraping dirigido a entidades del Directorio.
  - **Rastreo 2**: fuentes generales web (Minciencias, World Bank, etc.).
- Filtros por sector, país, entidad, estado; favoritos por usuario.
- Gate de suscripción para acceso completo (ver `subscriptions.routes.js`, `stripe.webhook.js`).

## Módulo 2 — Formulador (wizards M2–M12)

Orden esperado del flujo:

1. **Contexto** (`ContextoPage.tsx`) — narrativa libre (problema, población, justificación).
2. **Ficha Técnica** (`FichaTecnicaPage.tsx` / `fichaTecnica.routes.js`) — datos duros del proyecto + sello/hash de versión.
3. **Logística** (`LogisticaPage.tsx` / `configLogistica.routes.js`) — tramos origen-destino, proponente/NIT/entidad.
4. **Anexos** (`AnexosCalcoView.tsx` / `anexos.routes.js`) — soportes documentales categorizados.
5. **Árbol de Objetivos / Teoría de Cambio** (`objetivos_arbol`, `project_change_theory`) — coherencia problema→objetivos→indicadores.
6. **Presupuesto** (`presupuesto.routes.js`) — fuentes de financiación, rubros.
7. **Viabilidad IA** (`NN_Viability_Agent.ts`, `ViabilidadPage.tsx`) — dictamen Gemini: score 0-100, VIABLE/VIABLE_CON_OBSERVACIONES/NO_VIABLE.

Requisito no negociable: cada wizard debe persistir en backend real (no solo `localStorage`) — ver estado real en [[pendientes]].

## Módulo 3 — Motor de coherencia lógica

- Debe bloquear la certificación del proyecto si:
  - No hay exactamente 1 nodo `CENTRAL` en `objetivos_arbol`.
  - Hay nodos `RESULTADO`/`ACTIVIDAD` huérfanos (sin `parent_id` válido).
  - No hay al menos 1 indicador en `project_indicators` por objetivo.
- Requisito de UX: semáforo verde/rojo con detalle de qué falta (HTTP 422 + `detail[]`), no solo un booleano.

## Módulo 4 — Exportación (MGA / BID / OXI)

Estructura oficial confirmada (investigación externa, ver [[registros_arquitectura]]):

- **MGA**: 4 módulos — Identificación, Preparación, Evaluación Ex-ante, Programación.
- **BID**: matriz de marco lógico 4×4 (Fin/Propósito/Componentes/Actividades × Resumen/Indicadores/Verificación/Supuestos).
- **OXI**: MGA + capa de viabilidad/costos adicional (Anexo 1, cantidades de obra, checklist de prefactibilidad).
- Requisito de transparencia: todo documento exportado debe declarar "generado según estructura [MGA/BID/OXI]", no presentarse como el formulario oficial descargado 1:1.

## Requisitos no funcionales

- Multitenancy real vía RLS en Postgres (ver [[hseq_normativa]]).
- Fidelidad CSS absoluta a los diseños Stitch (tolerancia cero, ver CLAUDE.md del proyecto).
- CI/CD debe bloquear despliegue si `tsc`/`build` fallan (gate ya implementado, ver [[registros_arquitectura]]).
