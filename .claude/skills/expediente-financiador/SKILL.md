---
name: expediente-financiador
description: Opera, audita o extiende el Expediente del Financiador de RadFor-360 (Viabilidad) — agente creador que arma, por secciones independientes, Marco Lógico (árbol de problemas + matriz 4×4), Teoría del Cambio, cadena de valor/EDT sin montos, salvaguardas ESS, matriz HSEQ (ISO 9001/14001/45001), plan MEL, registro de riesgos PMI, operación y mantenimiento y checklist jurídico según los 5 ejes de Entrada, y las reglas V0–V9 del Comité MIROFISH. Úsalo cuando el usuario pida revisar, depurar, generar o ampliar el expediente, las exigencias por financiador (MGA/SGR, OXI, BID/UE/ONU, banca multilateral) o el auditor por ejes.
---

# Expediente del Financiador — guía operativa

## Piezas (fuente de verdad: el código, no este archivo)
| Pieza | Archivo |
|---|---|
| Ejes de Entrada → exigencias (puro) | `backend/services/directivasFormulacion.js` |
| Reglas deterministas V0–V9 (puro) | `backend/services/auditoriaVectores.js` |
| Agente creador + validación anti-invención | `backend/services/expedienteFinanciador.js` |
| Rutas GET/POST `/api/proyectos/:id/expediente[/:seccion]` | `backend/routes/expediente.routes.js` |
| Historial (solo INSERT, RLS) | `backend/migrations/078_project_expediente_financiador.sql` + `079_expediente_secciones_fase_e.sql` (9 secciones) |
| UI (tarjeta en Viabilidad) | `client/src/components/viabilidad/ExpedienteFinanciadorCard.tsx` |
| Reglas V en el comité | `backend/routes/mirofish.routes.js` |

## Reglas que no se negocian (decisiones del dueño, 2026-09-30)
1. **Nada financiero calculado**: AIU, presupuesto y presupuesto de interventoría los aporta el usuario en su documento externo. Nunca tasas de cambio ni porcentajes en código.
2. **Alcance jurídico**: el checklist NUNCA declara un documento "soportado" por decisión de la IA. Solo el sistema: la regla determinista V6 (soporte predial) puede marcar `soportado_por_anexo`; lo que la IA propone queda `anexo_propuesto_verificar`; el anexo que EXIGE un requisito no lo prueba.
3. **Anti-invención**: cada ítem cita `fuentes` (ids exactos: `entrada.*` o `anexo:<nombre>`); se descarta si no tiene fuente, si la fuente no existe o si trae una cifra que no está en sus fuentes (`cifrasNoTrazables`). Las normas del checklist deben aparecer LITERAL en sus fuentes.
4. **Regla monetaria**: régimen nacional o sin definir = texto COP de siempre, byte a byte. Solo el régimen internacional la cambia.
5. **Generación modular**: cada sección es una llamada independiente — nunca un JSON único con todo (límites por minuto de Groq/Gemini; si una sección falla, no se pierde el resto).
6. **Cadena de valor sin montos**: se descarta cualquier ítem con montos; los costos por actividad están en el presupuesto del documento externo (la sección lista los anexos Financiero).
7. **Nada pre-aprobado**: ninguna plantilla trae estados de aprobación (elegible, otorgado, VIABLE, score 100); la auditoría la hacen las reglas V y el Comité MIROFISH con otro modelo.
8. **Normas verificadas**: Ley 1551/2012 art. 48 (modificado por la Ley 2140/2021); Res. 0661/2019 MinVivienda para agua y saneamiento (ítem base determinista del checklist en régimen nacional). La Res. 1063/2016 está DEROGADA: cualquier ítem que la cite se descarta (`norma_derogada`).

## Cómo verificar (siempre con evidencia)
- Unitarias: `node --experimental-test-module-mocks --test tests/unit/vectoresFinanciador.test.mjs tests/unit/expedienteFinanciador.test.mjs`
- E2E determinista (sin IA): `tests/e2e/expediente-financiador.spec.ts` (409 `SECCION_NO_APLICA`, 422 sin anexos, UI).
- Generación real: sin `GROQ_API_KEY` el rol creador cae a OpenRouter/Gemini; si nadie responde, 503 honesto y nada se guarda.

## Extender
- **Nueva sección**: agrégala a `SECCIONES` (grupos, tipos de campo, `aplica(d)`), a `GRUPOS_MINIMOS`, al CHECK de la tabla (nueva migración), a `GRUPO_TITULO` de la UI y a sus tests. Si soporta una regla V, conéctala en `auditoriaVectores.js` vía el parámetro `expediente`.
- **Nuevo eje o etiqueta de la UI**: actualiza `resolverDirectivas` comparando contra la etiqueta REAL de `client/src/components/entrada/entradaModelo.ts` (normalizada), nunca contra mayúsculas inventadas.
- Cualquier cambio estructural pasa antes por el agente `architect`.
