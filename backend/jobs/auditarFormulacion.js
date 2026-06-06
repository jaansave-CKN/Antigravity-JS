/**
 * auditarFormulacion.js — Inngest Job: Auditoría M9 + Circuit Breaker M6↔M9
 *
 * PROBLEMA QUE RESUELVE:
 *   Sin control, el ciclo M6 (Formulación) → M9 (Auditoría de Calidad) puede
 *   convertirse en un bucle infinito si el pliego tiene requisitos contradictorios
 *   o el modelo de IA genera respuestas inconsistentes entre iteraciones.
 *   Cada ciclo consume tokens de la API de Gemini/Groq (costo real).
 *
 * GARANTÍAS:
 *   · MAX_CORRECTION_CYCLES = 3: máximo 3 ciclos de auto-corrección.
 *   · Si el ciclo 4 se intenta → CIRCUIT BREAKER: el proyecto pasa a
 *     'needs_human_review' y se dispara una alerta. STOP absoluto.
 *   · Cada llamada a IA es un `step` independiente con ID de idempotencia.
 *     Si Inngest reintenta, no duplica la llamada a Gemini.
 *   · concurrency: máx 5 auditorías simultáneas para no saturar la API.
 *
 * FLUJO DE EVENTOS:
 *   formulador/proyecto.iniciado
 *     → formularProyectoInversion (M6: genera payload)
 *       → formulador/auditoria.solicitada  (con cycleCount: 0)
 *         → auditarFormulacion (M9: evalúa calidad)
 *           Si score < threshold AND cycleCount < MAX:
 *             → formulador/correccion.solicitada
 *               → corregirFormulacion (M6 correctivo, con cycleCount+1)
 *                 → formulador/auditoria.solicitada  (con cycleCount: 1)
 *                   → ... (máx 2 ciclos más antes del CIRCUIT BREAKER)
 *           Si score >= threshold:
 *             → proyecto status = 'formulado' ✅
 *           Si cycleCount >= MAX:
 *             → proyecto status = 'needs_human_review' 🛑
 */

import { inngest } from './inngest.instance.js';

// ── CONSTANTE CRÍTICA — NO CAMBIAR SIN REVISAR IMPACTO EN COSTOS DE API ──────
const MAX_CORRECTION_CYCLES = 3;

// Umbral de calidad para aprobar formulación (0-100)
const QUALITY_THRESHOLD = 72;

// ── Job: Auditoría M9 + Circuit Breaker ──────────────────────────────────────
export const auditarFormulacion = inngest.createFunction(
  {
    id:   'auditar-formulacion-m9',
    name: 'Quality Audit M9 — Circuit Breaker M6↔M9',
    retries: 1,
    concurrency: {
      limit: 5,
      key:   'event.data.tenantId',
    },
    // Previene que un pliego con requisitos contradictorios genere ciclos rápidos
    rateLimit: {
      limit:  10,
      period: '1h',
      key:    'event.data.proyectoId',
    },
  },
  { event: 'formulador/auditoria.solicitada' },

  async ({ event, step, logger }) => {
    const {
      proyectoId,
      tenantId,
      userId,
      googleApiKey,
      cycleCount = 0,
    } = event.data;

    logger.info(`[M9-audit] Iniciando auditoría — proyecto ${proyectoId} | ciclo ${cycleCount}/${MAX_CORRECTION_CYCLES}`);

    // ══════════════════════════════════════════════════════════════════════════
    // CIRCUIT BREAKER: verificación ANTES de cualquier llamada a IA
    // ══════════════════════════════════════════════════════════════════════════
    if (cycleCount >= MAX_CORRECTION_CYCLES) {
      await step.run('circuit-breaker-halt', async () => {
        const { runSql, getRow } = await import('../config/database.config.js');
        const { sendEmail, APP_URL } = await import('../config/resend.config.js');

        logger.warn(`[M9-audit] CIRCUIT BREAKER ACTIVADO — proyecto ${proyectoId} alcanzó ${MAX_CORRECTION_CYCLES} ciclos`);

        // Marcar para revisión humana — estado visible en el dashboard
        await runSql(
          `UPDATE projects
           SET status = 'needs_human_review',
               audit_cycles = $1,
               audit_blocked_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [cycleCount, proyectoId]
        );

        // Notificar al formulador
        const user = await getRow(
          'SELECT email, full_name AS nombre FROM users WHERE id = $1',
          [userId]
        ).catch(() => null);

        if (user?.email) {
          await sendEmail({
            to:      user.email,
            subject: `⚠️ Proyecto requiere revisión manual — ${proyectoId}`,
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
                <h2 style="color:#b91c1c;">Revisión manual requerida</h2>
                <p>El sistema de auditoría automática (M9) alcanzó el límite máximo de
                   <strong>${MAX_CORRECTION_CYCLES} ciclos de corrección</strong> sin alcanzar
                   el umbral de calidad requerido (${QUALITY_THRESHOLD}/100).</p>
                <p>Posibles causas:</p>
                <ul>
                  <li>Requisitos contradictorios en el pliego de condiciones</li>
                  <li>Información insuficiente en la ficha técnica del proyecto</li>
                  <li>Convocatoria con criterios atípicos que el modelo no puede reconciliar</li>
                </ul>
                <p>Un especialista debe revisar y aprobar manualmente la formulación.</p>
                <a href="${APP_URL}/formulador/${proyectoId}"
                   style="display:inline-block;padding:12px 24px;background:#b91c1c;color:#fff;
                          text-decoration:none;border-radius:8px;font-weight:700;">
                  Ver proyecto bloqueado
                </a>
              </div>
            `,
          }).catch(e => logger.warn('[M9-audit] Error email circuit breaker:', e.message));
        }

        return {
          circuit_breaker: true,
          cycles_reached:  cycleCount,
          project_status:  'needs_human_review',
        };
      });

      logger.warn(`[M9-audit] Pipeline detenido por circuit breaker — proyecto ${proyectoId}`);
      return { circuit_breaker: true, proyectoId, cycleCount };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PASO M9-A: Cargar payload formulado para auditar
    // Step ID incluye cycleCount → idempotente por ciclo (no reprocesa si Inngest reintenta)
    // ══════════════════════════════════════════════════════════════════════════
    const payload = await step.run(`m9-load-payload-cycle-${cycleCount}`, async () => {
      const { getRow } = await import('../config/database.config.js');
      const row = await getRow(
        'SELECT id, status, payload_es, audit_cycles FROM projects WHERE id = $1 AND tenant_id = $2',
        [proyectoId, tenantId]
      );
      if (!row) throw new Error(`M9_PROJECT_NOT_FOUND: ${proyectoId}`);
      return row;
    });

    // ══════════════════════════════════════════════════════════════════════════
    // PASO M9-B: Evaluación de calidad con IA (step independiente)
    // ══════════════════════════════════════════════════════════════════════════
    const auditResult = await step.run(`m9-quality-eval-cycle-${cycleCount}`, async () => {
      const apiKey = googleApiKey || process.env.GOOGLE_API_KEY;

      if (!apiKey) {
        logger.warn('[M9-audit] Sin API key — usando auditoría heurística básica');
        return _heuristicAudit(payload.payload_es);
      }

      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',   // Modelo ligero para auditoría (menor costo)
          generationConfig: {
            temperature:      0.1,
            maxOutputTokens:  2048,
            responseMimeType: 'application/json',
          },
        });

        const payloadEs = typeof payload.payload_es === 'string'
          ? JSON.parse(payload.payload_es)
          : payload.payload_es;

        const prompt = `Eres un auditor experto en formulación de proyectos de inversión pública colombiana (metodología MGA/BPIN).

Evalúa la calidad de la siguiente formulación de proyecto. Responde SOLO con JSON válido.

CRITERIOS DE EVALUACIÓN (puntaje 0-100 por criterio):
1. coherencia_objetivos: ¿El árbol de objetivos es coherente y jerarquizado?
2. suficiencia_presupuesto: ¿El presupuesto tiene suficiente detalle APU?
3. pertinencia_normativa: ¿El marco normativo aplica al sector y municipio?
4. viabilidad_tecnica: ¿Los indicadores y metas son medibles y alcanzables?

FORMATO DE RESPUESTA REQUERIDO:
{
  "scores": {
    "coherencia_objetivos": <0-100>,
    "suficiencia_presupuesto": <0-100>,
    "pertinencia_normativa": <0-100>,
    "viabilidad_tecnica": <0-100>
  },
  "score_total": <promedio ponderado 0-100>,
  "observaciones": ["observación 1", "observación 2"],
  "correcciones_sugeridas": ["corrección específica 1", "corrección específica 2"],
  "aprobado": <true si score_total >= ${QUALITY_THRESHOLD}>
}

FORMULACIÓN A AUDITAR:
${JSON.stringify(payloadEs?.proyecto || payloadEs, null, 2).slice(0, 8000)}`;

        const result       = await model.generateContent(prompt);
        const responseText = result.response.text();
        const auditData    = JSON.parse(responseText);

        return {
          score:                  auditData.score_total || 0,
          scores:                 auditData.scores || {},
          aprobado:               auditData.aprobado || false,
          observaciones:          auditData.observaciones || [],
          correcciones_sugeridas: auditData.correcciones_sugeridas || [],
          model:                  'gemini-1.5-flash',
        };
      } catch (err) {
        logger.error('[M9-audit] Error en evaluación IA:', err.message);
        // Fallback heurístico para no bloquear el pipeline si Gemini falla
        return _heuristicAudit(payload.payload_es);
      }
    });

    logger.info(`[M9-audit] Score: ${auditResult.score}/${QUALITY_THRESHOLD} | Aprobado: ${auditResult.aprobado} | Ciclo: ${cycleCount}`);

    // ══════════════════════════════════════════════════════════════════════════
    // PASO M9-C: Persistir resultado de auditoría
    // ══════════════════════════════════════════════════════════════════════════
    await step.run(`m9-persist-audit-cycle-${cycleCount}`, async () => {
      const { runSql } = await import('../config/database.config.js');
      await runSql(
        `UPDATE projects
         SET audit_score    = $1,
             audit_cycles   = $2,
             audit_result   = $3,
             updated_at     = NOW()
         WHERE id = $4`,
        [auditResult.score, cycleCount, JSON.stringify(auditResult), proyectoId]
      );
    });

    // ══════════════════════════════════════════════════════════════════════════
    // DECISIÓN: aprobar o solicitar corrección
    // ══════════════════════════════════════════════════════════════════════════
    if (auditResult.aprobado || auditResult.score >= QUALITY_THRESHOLD) {
      // ── APROBADO: finalizar formulación ────────────────────────────────────
      await step.run(`m9-approve-cycle-${cycleCount}`, async () => {
        const { runSql, getRow } = await import('../config/database.config.js');
        const { sendEmail, APP_URL } = await import('../config/resend.config.js');

        await runSql(
          `UPDATE projects SET status = 'formulado', audit_approved_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [proyectoId]
        );

        const user = await getRow(
          'SELECT email, full_name AS nombre FROM users WHERE id = $1',
          [userId]
        ).catch(() => null);

        if (user?.email) {
          await sendEmail({
            to:      user.email,
            subject: `✅ Formulación aprobada — Puntuación M9: ${auditResult.score}/100`,
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
                <h2 style="color:#15803d;">Formulación aprobada por auditoría M9</h2>
                <p>Tu proyecto superó el umbral de calidad con una puntuación de
                   <strong>${auditResult.score}/100</strong> (umbral: ${QUALITY_THRESHOLD}).</p>
                ${auditResult.observaciones.length > 0 ? `
                <p><strong>Observaciones finales:</strong></p>
                <ul>${auditResult.observaciones.map(o => `<li>${o}</li>`).join('')}</ul>` : ''}
                <a href="${APP_URL}/formulador/${proyectoId}"
                   style="display:inline-block;padding:12px 24px;background:#15803d;color:#fff;
                          text-decoration:none;border-radius:8px;font-weight:700;">
                  Ver formulación final
                </a>
              </div>
            `,
          }).catch(() => {});
        }
      });

      logger.info(`[M9-audit] Proyecto APROBADO — score ${auditResult.score} en ciclo ${cycleCount}`);
      return { aprobado: true, score: auditResult.score, cycleCount, proyectoId };

    } else {
      // ── RECHAZADO: solicitar corrección al M6 (si no hemos alcanzado el límite)
      // El cycleCount se incrementa AQUÍ, antes de reenviar el evento.
      // El siguiente ciclo entrará con cycleCount+1.
      const nextCycle = cycleCount + 1;

      logger.warn(`[M9-audit] Score insuficiente (${auditResult.score}/${QUALITY_THRESHOLD}) — solicitando corrección ciclo ${nextCycle}`);

      await step.sendEvent(`m9-request-correction-cycle-${cycleCount}`, {
        name: 'formulador/correccion.solicitada',
        data: {
          proyectoId,
          tenantId,
          userId,
          googleApiKey,
          cycleCount:             nextCycle,
          correcciones_sugeridas: auditResult.correcciones_sugeridas,
          audit_score:            auditResult.score,
          audit_threshold:        QUALITY_THRESHOLD,
        },
      });

      return {
        aprobado:   false,
        score:      auditResult.score,
        cycleCount,
        nextCycle,
        correction_requested: true,
      };
    }
  }
);

// ── Job secundario: Corrección guiada M6 (disparado por M9 cuando score < threshold) ─
export const corregirFormulacion = inngest.createFunction(
  {
    id:      'corregir-formulacion-m6',
    name:    'Guided Correction M6 — AI-directed refinement',
    retries: 1,
    concurrency: { limit: 3, key: 'event.data.tenantId' },
  },
  { event: 'formulador/correccion.solicitada' },

  async ({ event, step, logger }) => {
    const {
      proyectoId,
      tenantId,
      userId,
      googleApiKey,
      cycleCount,
      correcciones_sugeridas = [],
      audit_score,
    } = event.data;

    logger.info(`[M6-correction] Corrección guiada — proyecto ${proyectoId} | ciclo ${cycleCount} | score previo: ${audit_score}`);

    // Aplicar correcciones sugeridas por M9 al payload
    const correctedPayload = await step.run(`m6-apply-corrections-cycle-${cycleCount}`, async () => {
      const { getRow, runSql } = await import('../config/database.config.js');
      const apiKey = googleApiKey || process.env.GOOGLE_API_KEY;

      const project = await getRow(
        'SELECT id, payload_es FROM projects WHERE id = $1 AND tenant_id = $2',
        [proyectoId, tenantId]
      );
      if (!project) throw new Error(`M6_CORRECTION_PROJECT_NOT_FOUND: ${proyectoId}`);

      if (!apiKey || correcciones_sugeridas.length === 0) {
        logger.warn('[M6-correction] Sin correcciones o API key — saltando corrección IA');
        return { skipped: true };
      }

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      });

      const payloadEs = typeof project.payload_es === 'string'
        ? JSON.parse(project.payload_es)
        : project.payload_es;

      const prompt = `Eres un formulador experto en proyectos MGA/BPIN. Aplica las siguientes correcciones al payload del proyecto y devuelve el payload corregido en JSON.

CORRECCIONES A APLICAR:
${correcciones_sugeridas.map((c, i) => `${i + 1}. ${c}`).join('\n')}

PAYLOAD ACTUAL:
${JSON.stringify(payloadEs, null, 2).slice(0, 6000)}

Devuelve SOLO el payload corregido en JSON, manteniendo la misma estructura.`;

      try {
        const result   = await model.generateContent(prompt);
        const corrected = JSON.parse(result.response.text());

        await runSql(
          `UPDATE projects SET payload_es = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ ...payloadEs, ...corrected, _correction_cycle: cycleCount }), proyectoId]
        );

        return { applied: true, corrections: correcciones_sugeridas.length };
      } catch (err) {
        logger.error('[M6-correction] Error aplicando correcciones:', err.message);
        return { skipped: true, error: err.message };
      }
    });

    // Re-disparar auditoría M9 con el nuevo cycleCount
    await step.sendEvent(`m6-request-reaudit-cycle-${cycleCount}`, {
      name: 'formulador/auditoria.solicitada',
      data: {
        proyectoId,
        tenantId,
        userId,
        googleApiKey,
        cycleCount,   // Este mismo valor — M9 evaluará si cycleCount >= MAX_CORRECTION_CYCLES
      },
    });

    return { correctedPayload, cycleCount, proyectoId };
  }
);

// ── Auditoría heurística sin IA (fallback cuando no hay API key) ─────────────
function _heuristicAudit(payloadEs) {
  const payload = typeof payloadEs === 'string' ? JSON.parse(payloadEs || '{}') : (payloadEs || {});
  let score = 0;

  if (payload?.proyecto?.nombre)               score += 20;
  if (payload?.arbol_objetivos?.length > 0)    score += 25;
  if (payload?.presupuesto?.items_apu?.length > 0) score += 25;
  if (payload?.marco_normativo?.normas?.length > 0) score += 15;
  if (payload?.cronograma)                     score += 15;

  return {
    score,
    aprobado:               score >= QUALITY_THRESHOLD,
    observaciones:          ['Auditoría heurística básica (sin IA) — configurar GOOGLE_API_KEY para auditoría completa'],
    correcciones_sugeridas: score < QUALITY_THRESHOLD
      ? ['Completar árbol de objetivos', 'Agregar items APU al presupuesto', 'Definir cronograma del proyecto']
      : [],
    model: 'heuristic-fallback',
  };
}

export { MAX_CORRECTION_CYCLES, QUALITY_THRESHOLD };
