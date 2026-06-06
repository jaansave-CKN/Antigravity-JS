/**
 * inngest.client.js — Cliente Inngest compartido + registro de todos los jobs
 *
 * Jobs registrados:
 *   · formularProyectoInversion  — Pipeline M6: formulación bilingüe (7 pasos)
 *   · reindexarEmbeddings        — Re-indexación masiva de embeddings por tenant
 *   · auditarFormulacion         — M9: Auditoría de calidad + Circuit Breaker (MAX_CYCLES=3)
 *   · corregirFormulacion        — M6 correctivo: aplica sugerencias de M9 y re-audita
 *
 * Uso en server.js:
 *   import { serve } from 'inngest/express';
 *   import { inngest, allFunctions } from './backend/jobs/inngest.client.js';
 *   app.use('/api/inngest', serve({ client: inngest, functions: allFunctions }));
 */

import { inngest } from './inngest.instance.js';
import {
  formularProyectoInversion,
  reindexarEmbeddings,
} from './formularProyectoInversion.js';
import {
  auditarFormulacion,
  corregirFormulacion,
} from './auditarFormulacion.js';

export { inngest };

export const allFunctions = [
  // Bloque B — Formulador (M6)
  formularProyectoInversion,
  reindexarEmbeddings,
  // Bloque B — Auditoría y Circuit Breaker (M9)
  auditarFormulacion,
  corregirFormulacion,
];
