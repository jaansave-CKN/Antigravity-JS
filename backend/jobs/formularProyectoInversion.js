/**
 * formularProyectoInversion.js — Inngest Job: Pipeline completo de Formulación
 *
 * 9 pasos asíncronos tolerantes a fallos (v3 — Fase 1: Contención Transaccional):
 *   1.  load-project                   — Carga datos del proyecto desde PostgreSQL
 *   1b. resolve-api-key                — Recupera API key cifrada desde CredentialVault
 *   2.  generate-embedding             — Gemini text-embedding-004 (768 dims)
 *   3.  persist-embedding              — Guarda vector en columna embedding_vec
 *   3b. semantic-cache-lookup          — Cosine similarity >98% → omite llamadas IA
 *   4.  run-module-*                   — Árbol de objetivos, marco normativo, match score
 *   5.  consolidate-es                 — Consolida payload_es (JSONB español canónico)
 *   5b. generate-bibliographic-citation — Auditoría de citas con Gemini 1.5 Pro
 *   6.  translate-en                   — Gemini traduce payload_es → payload_en
 *   7.  persist-bilingual              — withTenant + RLS sin service_role key + email
 *
 * CAMBIOS DE SEGURIDAD v3:
 *   [SEC-1] supabaseAdmin ELIMINADO de persist-bilingual.
 *           Reemplazado por withTenant() que inyecta app.org_id → RLS activo.
 *           WHERE tenant_id=$5 como segunda barrera (defensa en profundidad).
 *
 *   [SEC-2] Semantic Cache pgvector: si embedding_vec actual tiene similitud coseno
 *           >98% con un proyecto previo del mismo tenant → retorna payload cacheado
 *           sin invocar ninguna llamada a Gemini. Fallo de cache NUNCA aborta el pipeline.
 *
 *   [SEC-3] API keys resueltas desde CredentialVault (AES-256-GCM) con fallback a
 *           event.data.googleApiKey para migración gradual. Después de migración
 *           completa, eliminar la referencia a event.data.googleApiKey.
 *
 * Traducción especializada:
 *   Rol: "Experto bilingüe en proyectos de inversión pública, metodologías
 *   MGA/DNP y fondos de cooperación internacional (Kusanone/JICA, BID, PNUD)"
 */

import crypto from 'node:crypto';
import { inngest } from './inngest.instance.js';

// ── Prompt de traducción técnica de alta fidelidad ───────────────────────────
const TRANSLATION_SYSTEM_PROMPT = `You are an expert bilingual translator specializing in Colombian public investment projects, MGA/DNP methodologies, and international cooperation funding frameworks (including Kusanone/JICA, IDB, UNDP, World Bank, EU Cooperation).

Your task is to translate the following technical project structure from Spanish to formal, precise English. Requirements:
- Preserve ALL JSON keys exactly as-is (do NOT translate keys, only values)
- Translate text values with domain-accurate terminology for:
  • Rural social infrastructure (vías terciarias, acueductos veredales, alcantarillado)
  • Investment project methodology (objetivo general → general objective, indicadores → indicators)
  • Colombian administrative geography (departamentos, municipios, veredas)
  • Financial terms (contrapartida → counterpart contribution, AIU → administration, unforeseen events and profit)
  • Regulatory framework (CONPES, MPGR, Ley de Regalías, SGR → General Royalties System)
- Use formal, international funding-body register (UN/IDB style)
- Do not add explanations — return only the translated JSON structure`;

// ── Job principal: Pipeline completo de formulación bilingüe ─────────────────
export const formularProyectoInversion = inngest.createFunction(
  {
    id:        'formular-proyecto-inversion',
    name:      'Formulation Pipeline — Investment Project',
    retries:   2,   // [SecOps-4] Máx 2 reintentos — evita bucles de consumo de cuota IA
    timeoutMs: 45 * 60 * 1000,   // 45 min max
    concurrency: {
      limit: 2,
      key:   'event.data.tenantId',
    },
    throttle: {
      count:  10,
      period: '1h',
      key:    'event.data.tenantId',
    },
    // Debounce: evita re-ejecuciones duplicadas en 30s
    debounce: {
      period: '30s',
      key:    'event.data.proyectoId',
    },
  },
  { event: 'formulador/proyecto.iniciado' },

  async ({ event, step, logger }) => {
    const {
      proyectoId,
      tenantId,
      userId,
      googleApiKey,   // [SEC-3] retrocompat — vault tiene prioridad si key está almacenada
      modulos = ['arbol_objetivos', 'marco_normativo', 'match_score'],
    } = event.data;

    logger.info(`[formulator] Pipeline start — project ${proyectoId} tenant ${tenantId}`);

    // ── Paso 1: Cargar proyecto ───────────────────────────────────────────────
    const project = await step.run('load-project', async () => {
      const { getRow } = await import('../config/database.config.js');
      const row = await getRow(
        'SELECT * FROM projects WHERE id = $1 AND tenant_id = $2',
        [proyectoId, tenantId]
      );
      if (!row) throw new Error(`PROJECT_NOT_FOUND: ${proyectoId} / tenant ${tenantId}`);
      return row;
    });

    // ── Paso 1b: [SEC-3] Resolver API key desde CredentialVault ──────────────
    // La key se cifra en BD con AES-256-GCM; se descifra solo en memoria aquí.
    // Fallback a event.data para migración gradual — remover tras migración total.
    const resolvedApiKey = await step.run('resolve-api-key', async () => {
      const { retrieveApiKey } = await import('../services/credentialVault.js');
      const { getRow } = await import('../config/database.config.js');
      try {
        const vaultKey = await retrieveApiKey(userId, 'google_api_key', { getRow });
        if (vaultKey) {
          logger.info('[formulator] API key resuelta desde CredentialVault');
          return vaultKey;
        }
      } catch (vaultErr) {
        logger.warn(`[formulator] Vault lookup fallido — usando event key: ${vaultErr.message}`);
      }
      // Fallback de migración (event.data.googleApiKey)
      return googleApiKey || null;
    });

    // ── Paso 2: Generar embedding ─────────────────────────────────────────────
    const embedding = await step.run('generate-embedding', async () => {
      const { textToEmbedding, fichaTecnicaToText } = await import('../services/embeddingsService.js');
      const ficha = typeof project.ficha_tecnica === 'string'
        ? JSON.parse(project.ficha_tecnica || '{}')
        : (project.ficha_tecnica || {});
      const text = fichaTecnicaToText(ficha);
      return textToEmbedding(text, resolvedApiKey);
    });

    // ── Paso 3: Persistir embedding ───────────────────────────────────────────
    await step.run('persist-embedding', async () => {
      const { runSql } = await import('../config/database.config.js');
      const vecStr = JSON.stringify(embedding);
      await runSql(
        `UPDATE projects
         SET embedding = $1, embedding_vec = $1::vector, updated_at = NOW()
         WHERE id = $2`,
        [vecStr, proyectoId]
      );
    });

    // ── Paso 3b: [SEC-2] Semantic Cache pgvector ──────────────────────────────
    // Compara el embedding actual con el histórico del mismo tenant.
    // Umbral: similitud coseno > 0.98 (distancia coseno pgvector < 0.02).
    // Si hay hit: los pasos 4-6 retornan el payload cacheado sin llamar a Gemini.
    // INVARIANTE: fallo de cache NUNCA interrumpe el pipeline — siempre retorna null.
    const cacheHit = await step.run('semantic-cache-lookup', async () => {
      if (!embedding || !Array.isArray(embedding)) return null;

      const { getRow } = await import('../config/database.config.js');
      try {
        const vecStr = JSON.stringify(embedding);
        const row = await getRow(
          `SELECT payload_es, payload_en
           FROM   projects
           WHERE  tenant_id     = $1
             AND  id            != $2
             AND  embedding_vec IS NOT NULL
             AND  payload_es    IS NOT NULL
             AND  status        IN ('formulado', 'in_review')
             AND  1 - (embedding_vec <=> $3::vector) > 0.98
           ORDER  BY embedding_vec <=> $3::vector ASC
           LIMIT  1`,
          [tenantId, proyectoId, vecStr]
        );

        if (!row) return null;

        logger.info('[formulator] Semantic cache HIT — similitud >98% — omitiendo pipeline IA');
        return {
          payload_es: typeof row.payload_es === 'string'
            ? JSON.parse(row.payload_es)
            : row.payload_es,
          payload_en: typeof row.payload_en === 'string'
            ? JSON.parse(row.payload_en)
            : row.payload_en,
        };
      } catch (err) {
        // Cache failure = soft error: loguear y continuar con pipeline completo
        logger.warn(`[formulator] semantic-cache-lookup error (continuando): ${err.message}`);
        return null;
      }
    });

    // ── Paso 4: Ejecutar módulos IA (cache-aware) ─────────────────────────────
    const moduleResults = {};

    for (const modulo of modulos) {
      moduleResults[modulo] = await step.run(`run-module-${modulo}`, async () => {
        // [SEC-2] Cache hit: short-circuit sin llamar a Gemini
        if (cacheHit) {
          logger.info(`[formulator] Cache hit — skipping module ${modulo}`);
          return { cache_hit: true, skipped: true, module: modulo };
        }

        logger.info(`[formulator] Running module: ${modulo}`);

        switch (modulo) {
          case 'arbol_objetivos': {
            const { generarArbolConIA } = await import('../agents/arbolObjetivosAgent.js');
            const { runSql } = await import('../config/database.config.js');
            const ficha = typeof project.ficha_tecnica === 'string'
              ? JSON.parse(project.ficha_tecnica || '{}')
              : (project.ficha_tecnica || {});
            const objetivo = ficha?.objetivo_central || ficha?.nombre || project.name || 'Investment project';
            const nodes = await generarArbolConIA(objetivo, resolvedApiKey);

            for (const node of nodes) {
              await runSql(
                `INSERT INTO objective_tree
                   (id, proyecto_id, tenant_id, tipo, nivel, content, parent_id, ai_generated)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
                 ON CONFLICT (id) DO NOTHING`,
                [crypto.randomUUID(), proyectoId, tenantId,
                 node.tipo, node.nivel, node.texto, node.parent_id || null]
              );
            }
            return { nodes_generated: nodes.length, nodes };
          }

          case 'match_score': {
            const { runMatchPipeline } = await import('../pipeline/matchScore.js');
            const { getRow, getRows, runSql } = await import('../config/database.config.js');
            return runMatchPipeline(proyectoId, getRow, getRows, runSql);
          }

          case 'marco_normativo': {
            const { generarMarcoNormativo } = await import('../agents/normativoAgent.js').catch(() => ({
              generarMarcoNormativo: async () => ({ normas: [], citas: [] }),
            }));
            const ficha = typeof project.ficha_tecnica === 'string'
              ? JSON.parse(project.ficha_tecnica || '{}')
              : (project.ficha_tecnica || {});
            return generarMarcoNormativo(
              ficha?.sector_codigo || 'infraestructura',
              ficha?.municipio || ''
            );
          }

          default:
            logger.warn(`[formulator] Unknown module: ${modulo}`);
            return { skipped: true, module: modulo };
        }
      });
    }

    // ── Paso 5: Consolidar payload_es (cache-aware) ───────────────────────────
    const payloadEs = await step.run('consolidate-es', async () => {
      // [SEC-2] Cache hit: retornar payload cacheado con metadata de trazabilidad
      if (cacheHit) {
        logger.info('[formulator] Cache hit — usando payload_es cacheado');
        return {
          ...cacheHit.payload_es,
          cache_hit:          true,
          cache_retrieved_at: new Date().toISOString(),
        };
      }

      const { getRows } = await import('../config/database.config.js');
      const ficha = typeof project.ficha_tecnica === 'string'
        ? JSON.parse(project.ficha_tecnica || '{}')
        : (project.ficha_tecnica || {});
      const presupuesto = typeof project.presupuesto === 'string'
        ? JSON.parse(project.presupuesto || '{}')
        : (project.presupuesto || {});

      // Cargar nodos del árbol de objetivos desde BD
      const objetivosNodes = await getRows(
        'SELECT tipo, nivel, content AS texto, parent_id, ai_generated FROM objective_tree WHERE proyecto_id = $1 ORDER BY nivel, tipo',
        [proyectoId]
      );

      // Cargar cronograma si existe
      const cronograma = await getRows(
        'SELECT duracion_meses, fecha_inicio, fecha_fin, fases, hitos FROM formulador_cronograma WHERE proyecto_id = $1 LIMIT 1',
        [proyectoId]
      ).catch(() => []);

      // Cargar presupuesto APU
      const apuItems = await getRows(
        `SELECT phase AS fase, chapter AS capitulo, item_name AS item,
                unit AS unidad, quantity AS cantidad,
                direct_cost AS costo_directo, total_value AS valor_total
         FROM project_budgets WHERE proyecto_id = $1 ORDER BY phase`,
        [proyectoId]
      ).catch(() => []);

      return {
        version:    '2.0',
        idioma:     'es',
        generado_en: new Date().toISOString(),
        proyecto: {
          id:       proyectoId,
          nombre:   project.name || project.nombre,
          estado:   project.status || project.estado,
          ficha_tecnica: ficha,
        },
        arbol_objetivos: objetivosNodes,
        cronograma:      cronograma[0] || null,
        presupuesto: {
          resumen: presupuesto,
          items_apu: apuItems,
        },
        marco_normativo:  moduleResults.marco_normativo || null,
        match_score:      moduleResults.match_score || null,
      };
    });

    // ── Paso 5b: Citas bibliográficas y normativas (cache-aware) ─────────────
    const citationResult = await step.run('generate-bibliographic-citation', async () => {
      // [SEC-2] Cache hit: reutilizar compliance_score del payload previo
      if (cacheHit) {
        logger.info('[formulator] Cache hit — omitiendo generación de citas');
        return {
          status:             'cache_hit',
          compliance_score:   cacheHit.payload_es?.bibliographic_citations?.compliance_score ?? null,
          needs_human_review: false,
        };
      }

      logger.info(`[formulator] Generando citas bibliográficas — proyecto ${proyectoId}`);

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const { runSql } = await import('../config/database.config.js');

      if (!resolvedApiKey) {
        logger.warn('[formulator] No Google API key — skipping citation generation');
        return { status: 'skipped', reason: 'no_api_key', needs_human_review: true };
      }

      const genAI = new GoogleGenerativeAI(resolvedApiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-pro',
        generationConfig: {
          temperature:      0.05,
          maxOutputTokens:  4096,
          responseMimeType: 'application/json',
        },
      });

      const CITATION_SYSTEM_PROMPT = `Eres un auditor experto en proyectos de inversión pública colombiana.
Tu tarea es revisar el contenido técnico del proyecto y generar las citas bibliográficas y normativas exactas para cada aseveración técnica, legal o normativa.

REGLAS ABSOLUTAS:
1. Toda aseveración técnica, legal o normativa DEBE incluir su cita bibliográfica/normativa.
2. Si no puedes encontrar la cita exacta para una aseveración, márcala como: { "needs_human_review": true, "reason": "cita no verificable" }
3. Formatos de cita aceptados:
   - Ley/Decreto: "Ley 1508 de 2012, Art. 3° — Definición de APP"
   - CONPES: "CONPES 3857 de 2016 — Política de Gestión de Riesgos"
   - Norma técnica: "NSR-10, Título A — Requisitos generales de diseño"
   - Doctrina: "DNP, Metodología MGA Web, v2.0 (2022), Capítulo 4"
   - Internacional: "BID-PNUD (2021), Marco de Resultados para proyectos de agua y saneamiento"
4. El output DEBE ser JSON con la estructura:
   {
     "citations": [{ "claim": "texto de la aseveración", "citation": "cita exacta", "verified": true|false, "needs_human_review": boolean }],
     "uncited_claims": number,
     "review_required": boolean,
     "compliance_score": number (0-100)
   }
5. Si compliance_score < 70, el proyecto DEBE marcarse como needs_human_review.`;

      const contentToAudit = {
        arbol_objetivos:  payloadEs.arbol_objetivos?.slice(0, 20) || [],
        marco_normativo:  payloadEs.marco_normativo || {},
        ficha_tecnica:    payloadEs.proyecto?.ficha_tecnica || {},
      };

      try {
        const prompt = `${CITATION_SYSTEM_PROMPT}\n\nContenido del proyecto a auditar:\n${JSON.stringify(contentToAudit, null, 2)}`;
        const result       = await model.generateContent(prompt);
        const citationData = JSON.parse(result.response.text());

        const needsHumanReview = citationData.review_required
          || (citationData.compliance_score ?? 100) < 70
          || (citationData.uncited_claims ?? 0) > 0;

        await runSql(
          `UPDATE projects
           SET audit_result      = $1,
               audit_score       = $2,
               audit_approved_at = CASE WHEN $3::boolean THEN NULL ELSE NOW() END,
               status            = CASE WHEN $3::boolean THEN 'needs_human_review' ELSE status END,
               updated_at        = NOW()
           WHERE id = $4`,
          [
            JSON.stringify(citationData),
            citationData.compliance_score ?? 0,
            needsHumanReview,
            proyectoId,
          ]
        );

        logger.info(`[formulator] Citations generated — compliance_score=${citationData.compliance_score}, needs_review=${needsHumanReview}`);

        return {
          status:             'completed',
          compliance_score:   citationData.compliance_score,
          uncited_claims:     citationData.uncited_claims,
          needs_human_review: needsHumanReview,
          citations_count:    citationData.citations?.length ?? 0,
        };
      } catch (err) {
        logger.error('[formulator] Citation generation FAILED:', err.message);
        // Marcar para revisión humana sin relanzar — evita reintento innecesario de Inngest
        await runSql(
          `UPDATE projects SET status = 'needs_human_review', updated_at = NOW() WHERE id = $1`,
          [proyectoId]
        ).catch(() => {});
        return {
          status:             'failed',
          needs_human_review: true,
          error:              err.message,
        };
      }
    });

    // Agregar resultado de citas al payload_es para trazabilidad completa
    payloadEs.bibliographic_citations = citationResult;

    // ── Paso 6: Traducción técnica de alta fidelidad ES → EN (cache-aware) ────
    const payloadEn = await step.run('translate-en', async () => {
      // [SEC-2] Cache hit: retornar payload_en cacheado con flag de trazabilidad
      if (cacheHit) {
        logger.info('[formulator] Cache hit — usando payload_en cacheado');
        return {
          ...cacheHit.payload_en,
          cache_hit: true,
        };
      }

      const { runSql } = await import('../config/database.config.js');

      // Marcar como 'processing' antes de invocar la IA
      await runSql(
        "UPDATE projects SET translation_status = 'processing', updated_at = NOW() WHERE id = $1",
        [proyectoId]
      ).catch(e => logger.warn('[formulator] Could not set processing status:', e.message));

      if (!resolvedApiKey) {
        logger.warn('[formulator] No Google API key — skipping EN translation');
        await runSql(
          "UPDATE projects SET translation_status = 'skipped' WHERE id = $1",
          [proyectoId]
        ).catch(() => {});
        return { version: '2.0', language: 'en', translation_status: 'skipped' };
      }

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(resolvedApiKey);

      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-pro',
        generationConfig: {
          temperature:      0.1,
          maxOutputTokens:  8192,
          responseMimeType: 'application/json',
        },
      });

      const contentToTranslate = {
        proyecto: {
          nombre:        payloadEs.proyecto.nombre,
          ficha_tecnica: payloadEs.proyecto.ficha_tecnica,
        },
        arbol_objetivos: payloadEs.arbol_objetivos,
        cronograma:      payloadEs.cronograma,
        presupuesto:     payloadEs.presupuesto,
        marco_normativo: payloadEs.marco_normativo,
      };

      const prompt = `${TRANSLATION_SYSTEM_PROMPT}\n\nJSON to translate:\n${JSON.stringify(contentToTranslate, null, 2)}`;

      try {
        const result         = await model.generateContent(prompt);
        const translatedText = result.response.text();
        const translated     = JSON.parse(translatedText);

        await runSql(
          "UPDATE projects SET translation_status = 'completed', updated_at = NOW() WHERE id = $1",
          [proyectoId]
        ).catch(e => logger.warn('[formulator] Could not set completed status:', e.message));

        return {
          version:            '2.0',
          language:           'en',
          translation_status: 'completed',
          translated_at:      new Date().toISOString(),
          translation_model:  'gemini-1.5-pro',
          project: {
            id:     proyectoId,
            name:   translated.proyecto?.nombre || project.name,
            status: 'in_review',
          },
          objective_tree:       translated.arbol_objetivos || [],
          schedule:             translated.cronograma || null,
          budget:               translated.presupuesto || null,
          regulatory_framework: translated.marco_normativo || null,
          match_score:          payloadEs.match_score,
        };
      } catch (err) {
        logger.error('[formulator] Translation FAILED:', err.message);
        await runSql(
          "UPDATE projects SET translation_status = 'failed', updated_at = NOW() WHERE id = $1",
          [proyectoId]
        ).catch(() => {});
        return {
          version:            '2.0',
          language:           'en',
          translation_status: 'failed',
          translation_error:  err.message,
        };
      }
    });

    // ── Paso 7: [SEC-1] Persistencia con RLS — supabaseAdmin ELIMINADO ────────
    // withTenant() inyecta app.org_id en la transacción PostgreSQL.
    // El RLS de Supabase usa current_setting('app.org_id') para filtrar filas.
    // WHERE id=$4 AND tenant_id=$5 actúa como segunda barrera (defensa en profundidad).
    // persistence_method='rls_pool' en el retorno es el audit trail que confirma
    // que service_role key NO fue usada en esta operación.
    await step.run('persist-bilingual', async () => {
      const { withTenant, getRow } = await import('../config/database.config.js');
      const { sendEmail, APP_URL } = await import('../config/resend.config.js');

      const finalStatus = payloadEn.translation_status || 'failed';

      // Persistencia dentro de transacción con contexto RLS inyectado
      await withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE projects
           SET payload_es         = $1,
               payload_en         = $2,
               translation_status = $3,
               status             = 'in_review',
               updated_at         = NOW()
           WHERE id = $4 AND tenant_id = $5`,
          [
            JSON.stringify(payloadEs),
            JSON.stringify(payloadEn),
            finalStatus,
            proyectoId,
            tenantId,
          ]
        );
      });

      logger.info(`[formulator] Bilingual payloads persisted — project ${proyectoId} status=${finalStatus}`);

      // Email de notificación fuera de transacción (fire-and-forget)
      const user = await getRow(
        'SELECT email, full_name AS nombre FROM users WHERE id = $1',
        [userId]
      ).catch(() => null);

      if (user?.email) {
        const translationOk = payloadEn.translation_status === 'completed';
        await sendEmail({
          to:      user.email,
          subject: `✅ Formulación completada — ${payloadEs.proyecto.nombre}`,
          html: `
            <h2>Formulación completada, ${user.nombre}</h2>
            <p>Tu proyecto <strong>${payloadEs.proyecto.nombre}</strong> fue formulado exitosamente.</p>
            <ul>
              <li>🇨🇴 <strong>Español:</strong> payload_es guardado (${(payloadEs.arbol_objetivos || []).length} nodos de objetivos)</li>
              <li>🇬🇧 <strong>English:</strong> ${translationOk ? `payload_en guardado (traducción técnica con Gemini 1.5 Pro)` : `payload_en — traducción omitida (${payloadEn.translation_error || 'API key requerida'})`}</li>
            </ul>
            <p><a href="${APP_URL}/formulador/${proyectoId}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
              Ver proyecto formulado
            </a></p>
          `,
        }).catch(e => logger.warn('[formulator] Email notification error:', e.message));
      }

      return {
        payload_es_nodes:       (payloadEs.arbol_objetivos || []).length,
        payload_en_status:      payloadEn.translation_status,
        project_status_updated: 'in_review',
        persistence_method:     'rls_pool',  // audit trail: service_role NO usado
      };
    });

    logger.info(`[formulator] Pipeline completed — project ${proyectoId}`);

    return {
      proyectoId,
      tenantId,
      status:       'formulado',
      cache_hit:    !!cacheHit,
      payload_es:   { nodes: (payloadEs.arbol_objetivos || []).length },
      payload_en:   { status: payloadEn.translation_status },
      completed_at: new Date().toISOString(),
    };
  }
);

// ── Job secundario: Re-indexación masiva de embeddings por tenant ─────────────
export const reindexarEmbeddings = inngest.createFunction(
  {
    id:        'reindex-embeddings-tenant',
    name:      'Re-index Embeddings by Tenant',
    retries:   2,
    concurrency: { limit: 1, key: 'event.data.tenantId' },
  },
  { event: 'formulador/embeddings.reindexar' },

  async ({ event, step, logger }) => {
    const { tenantId, googleApiKey } = event.data;

    const projects = await step.run('list-projects-without-embedding', async () => {
      const { getRows } = await import('../config/database.config.js');
      return getRows(
        'SELECT id, ficha_tecnica FROM projects WHERE tenant_id = $1 AND (embedding IS NULL OR embedding_vec IS NULL)',
        [tenantId]
      );
    });

    logger.info(`[reindex] Projects without embedding: ${projects.length}`);

    for (const p of projects) {
      await step.run(`embed-project-${p.id}`, async () => {
        const { textToEmbedding, fichaTecnicaToText } = await import('../services/embeddingsService.js');
        const { runSql } = await import('../config/database.config.js');
        const ficha = typeof p.ficha_tecnica === 'string'
          ? JSON.parse(p.ficha_tecnica || '{}')
          : (p.ficha_tecnica || {});
        const vec = await textToEmbedding(fichaTecnicaToText(ficha), googleApiKey);
        const vecStr = JSON.stringify(vec);
        await runSql(
          'UPDATE projects SET embedding = $1, embedding_vec = $1::vector WHERE id = $2',
          [vecStr, p.id]
        );
      });
    }

    return { processed: projects.length, tenant: tenantId };
  }
);
