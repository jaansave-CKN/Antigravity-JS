# Diseño — Formulador MGA (consolidador) · 2026-09-26

## Decisiones del usuario (fijas)
- **(a) Tipo de obra** = combinación estricta de `entrada_completa.sectores` (≥1) + `entrada_completa.nivelProyecto`. Ambos obligatorios.
- **(b) El Formulador CONSOLIDA, prohibido redactar desde cero.** Ingiere lo ya generado por EntradaIA, Viabilidad y MIROFISH (+ cifras deterministas de Node) y lo ordena en los 4 bloques MGA:
  (1) Identificación del Problema, (2) Población Beneficiaria, (3) Justificación Técnica, (4) Análisis de Riesgos.
- **Sin endpoint huérfano:** se consume desde la pantalla de Exportación existente y el PDF MGA existente lo incluye.
- **Regla de oro numérica:** el LLM nunca calcula ni altera cifras; las recibe como datos inmutables de Node.

## Contexto existente (verificado)
- Cortafuegos de datos mínimos: `backend/services/datosMinimosIA.js` (Lote 10, 422 `DATOS_MINIMOS_INSUFICIENTES`).
- Exportación MGA existente: `GET /api/proyectos/:id/exportar/mga` → `exportGenerator.generarMGA()` (PDF pdfkit que copia campos tal cual), botón en `client/src/pages/ExportacionPage.tsx`.
- Fuentes a consolidar:
  - `proyectos.ficha_tecnica.entrada_completa` (EntradaIA/Entrada) y `.contexto_narrativo` (A_diagnostico, C_meta).
  - `proyectos.ficha_tecnica.viabilidad_ia` (dictamen: estado_auditoria, score, analisis_escala_poblacion, cruce_anexos.brechas, teoria_del_cambio.supuestos/resultados; `fuente` = 'gemini-3.6-flash' | 'heuristica').
  - Última fila de `project_mirofish_evaluaciones` (reglas.hallazgos + ia.hallazgos ya validados contra evidencia).
  - Cifras (Node, deterministas): última fila de `project_montecarlo_runs` (inversión, VAN p10/p50/p90, TIR p50, prob. VAN>0) y total/cuenta de `project_apu_lineas`.

## Diseño propuesto
1. **Servicio** `backend/services/ai/formuladorService.js`:
   - `recolectarFuentes(proyecto, userId, deps)` → objeto plano `datos` { id_campo → valor texto } con ids estables
     (`entrada.sectores`, `entrada.nivelProyecto`, `contexto.A_diagnostico`, `viabilidad.brechas[2]`, `mirofish.R1.titulo`,
     `finanzas.van_p50_cop`, `finanzas.apu_total_cop`…). Las cifras se formatean UNA vez en Node (COP sin decimales, % con 1 decimal).
   - `faltantesFormulador(fuentes)` (en `datosMinimosIA.js`): exige sectores, nivelProyecto, municipio, población
     (numeroBeneficiarios | detallePoblacion | categoriaPoblacion), dictamen de viabilidad, ≥1 evaluación MIROFISH,
     ≥1 línea APU y ≥1 corrida Montecarlo. Si falta algo → 422 con la lista y el módulo a ejecutar primero, SIN llamar a Gemini.
   - `consolidarMGA(datos, { userGeminiKeys, userId })` → Gemini `gemini-3.6-flash` vía `fetchGeminiConReintento`, `withUserKeyRotation`/`withKeyRotation`,
     `max_tokens 8192`, `reasoning_effort 'low'`, `response_format: json_schema` estricto:
     `{ identificacion_problema: { parrafos: [{ texto, fuentes: [id] }] }, poblacion_beneficiaria: {...}, justificacion_tecnica: {...}, analisis_riesgos: {...} }`.
     System prompt: usar SOLO `datos`; cada párrafo cita ≥1 id; toda cifra se copia literal de los datos; prohibido calcular, redondear, estimar o inventar.
   - **Validación posterior determinista (anti-alucinación):**
     a) cada id citado debe existir en `datos`; b) cada número del texto debe aparecer literal en los valores de `datos`
     (normalizando separadores); c) párrafo que falle → descartado con motivo (`fuente_inexistente` | `cifra_no_trazable`);
     d) bloque vacío tras validar → `sin_contenido_verificable`. Nunca se rellena con heurística.
   - IA no disponible (sin llaves, cuota, 503 persistente, truncada, esquema inválido) → `{ estado: 'no_disponible', motivo }`, sin texto inventado (patrón MIROFISH).
   - FinOps: `logTokenUsage({ agentName: 'formulador_mga' })`.
2. **Rutas** `backend/routes/formuladorMga.routes.js`:
   - `POST /api/proyectos/:id/formulador-mga` — authenticateToken, requireAccess('formulador'), aiLimiter, byokGate.
   - `GET  /api/proyectos/:id/formulador-mga` — última consolidación (lectura).
3. **Persistencia (sin migración):** `jsonb_set(ficha_tecnica, '{formulador_mga}', …)` atómico, con `bloques`, `descartados`,
   `huella_fuentes` (hash de `datos`) y `generado_en`. La UI marca "desactualizado" si la huella actual difiere.
   ⚠ Riesgo conocido: `POST /viabilidad-ia` y la formulación integral reescriben `ficha_tecnica` completa desde una lectura previa;
   una ejecución concurrente podría perder `formulador_mga`. Alternativa: tabla propia `project_formulador_mga` (requiere migración aprobada).
4. **Frontend:** sección nueva "Redacción MGA consolidada" en `ExportacionPage.tsx`: botón Consolidar, los 4 bloques con chips de fuente,
   aviso de párrafos descartados, lista del 422 tal cual, aviso "desactualizado".
5. **PDF MGA existente:** `generarMGA()` añade, si existe `formulador_mga`, la sección "Redacción consolidada (IA, a partir de Entrada, Viabilidad y MIROFISH)" con fecha.
6. **Pruebas:** unitarias (recolección, faltantes, validación de ids/cifras, esquema); E2E (422 en proyecto vacío; con datos completos en CI sin llaves → `no_disponible` sin texto).
7. **Registro:** añadir a `scripts/agentes.mjs` (dominio Formulador) y a `backend/agents/escuadron.registry.js`.

---

## Revisión del subagente `architect` (2026-09-26): APROBADO CON CAMBIOS

Cada hallazgo se re-verificó contra el código antes de incorporarlo (protocolo de CLAUDE.md).

- **B1: persistencia (PENDIENTE DE DECISIÓN DEL USUARIO).** La carrera es real: `server.js` POST `/viabilidad-ia`, `formulacionIntegral.routes.js` y `radicacion.routes.js` reescriben `ficha_tecnica` completa desde una lectura previa. Además, `PUT /api/proyectos/:id` (`proyectos.routes.js`) acepta `ficha_tecnica` completa del cliente, así que **cualquiera podría escribir un `formulador_mga` falso** que el PDF imprimiría como redacción de IA.
  - **Opción 1 (recomendada por architect):** migración `072_project_formulador_mga` con la plantilla de la 071 (FK `ON DELETE CASCADE`, RLS `tenant_isolation`, `GRANT SELECT, INSERT` a `rf360_rls_scoped` y verificación). Requiere "apruebo la migración 072".
  - **Opción 2 (sin migración):** `jsonb_set` para `{formulador_mga}` más cambiar la escritura de `/viabilidad-ia` a `jsonb_set '{viabilidad_ia}'`. Riesgos que quedan: la formulación integral y `radicacion` pueden borrarlo, y el cliente puede falsificarlo, por lo que el PDF no podrá decir "validado".
- **B2: dictamen heurístico.** Si `viabilidad_ia.fuente === 'heuristica'`, excluir `analisis_escala_poblacion` (es relleno) y marcar `score_viabilidad` como heurístico. Los nombres correctos de los campos son `cruce_anexos.brechas_detectadas`, `teoria_del_cambio_generada.supuestos`/`.resultados_esperados` y `score_viabilidad`.
- **B3: Montecarlo.** Una corrida obsoleta (`|inversion_cop − inversión actual APU| > 0.005`, misma regla que `evaluacionFinanciera.routes.js`) cuenta como faltante. Si `tir.p50` es `null`, se omite (nunca "0 %"). Las fracciones (`pct4`) se multiplican por 100 antes de formatear.
- **B4: validación numérica por párrafo** contra los valores de SUS fuentes citadas, no contra todo `datos`:
  - Formato único en Node: `$ 1.234.567` y `-$ …`, `81,2 %`, `72/100`, fechas en forma larga (nunca ISO).
  - Antes de validar, el texto se limpia de ids de `datos` y de ordinales.
  - Un solo tokenizador, igual para el texto y para los valores. Un `%` solo coincide con otro `%`.
  - Años y normas sin excepción: si no están en las fuentes, el párrafo se descarta.
  - "negativo" en el texto permite el valor absoluto de un valor que en la fuente es negativo.
  - El prompt prohíbe abreviar cifras ("millones") y escribir números en palabras.
- **B5: el PDF** recalcula la huella con `recolectarFuentes`. Si difiere, marca la sección "DESACTUALIZADA" o no la incluye. Solo imprime consolidaciones con `estado 'ok'`. `generarMGA` recibe el dato nuevo como objeto de opciones, actualizando ambas llamadas de `exportacion.routes.js`.
- **B6: aislamiento.** POST y GET empiezan con `withTenantRow('SELECT … FROM proyectos WHERE id = ? AND org_id = ?')` y responden 404 si no hay fila. Solo después se leen las tablas hijas por `project_id`. El INSERT lleva `org_id = req.userId`. El GET lleva `authenticateToken` + `requireAccess('formulador')`.
- **B7: registro.** Se añade al catálogo de `scripts/agentes.mjs` (PR #32, aún sin fusionar) y a `backend/agents/escuadron.registry.js`.

Recomendaciones adoptadas:
- R1: el archivo va en `backend/services/formuladorMga.js`, junto a sus agentes hermanos.
- R2: el GET devuelve la última consolidación `ok` y, aparte, el último intento.
- R3: esquema acotado (`fuentes` ≥ 1, máximo 4 párrafos por bloque, `maxLength`).
- R4: resolver "Otro" con `sectorOtro`/`categoriaOtro`, y aceptar `logistica.municipio`.
- R5: hallazgos de las reglas siempre; los de la IA solo si `ia.estado === 'ok'`; sin reintento manual.
- R6: FinOps cuenta `total − prompt` como salida.
- R7: el total APU se etiqueta "según APU en Anexos".
- R8: el cliente usa `http.post` y los tokens `T` de ExportacionPage. **No hay nodo de Stitch para la sección nueva: hay que avisar al diseñador.**
- R9: las E2E siguen el patrón de lote10/lote3, y las unitarias del validador cubren años, ordinales, VAN negativo, porcentajes, cifras de otro campo y TIR nula.
