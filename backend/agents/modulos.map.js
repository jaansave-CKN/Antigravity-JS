/**
 * modulos.map.js — ÚNICA fuente de verdad de la jerarquía de agentes de la
 * Fase 4 (dictamen architect 2026-09-28, aprobado por el dueño):
 *
 *   Nivel 1  GP (Gerente de Proyecto)  backend/agents/gp/
 *   Nivel 2  Coordinador A (Radar)      backend/agents/radar/
 *            Coordinador B (Formulador) backend/agents/formulador/
 *   Nivel 3  las 13 funciones reales (FUNCIONES, mismos ids que el
 *            CATALOGO de scripts/agentes.mjs)
 *
 * DATOS PUROS, sin imports: lo leen scripts/aislamiento.mjs (test de
 * aislamiento por grafo de imports), los coordinadores y
 * escuadron.registry.js sin cargar el backend.
 *
 * Regla: ningún archivo de A alcanza uno de B (ni al revés); el intercambio
 * A↔B pasa por el GP. NEUTRAL = infraestructura compartida (no importa A ni
 * B). COMPOSICION = raíces que cablean todo (server.js y el puente).
 * Un archivo nuevo en backend/{services,agents,pipeline,routes} sin
 * clasificar aquí hace fallar tests/unit/aislamientoModulos.test.mjs.
 */

export const MODULOS = {
  A_RADAR: { rutas: [
    'backend/agents/radar/**',
    'backend/services/sectorClassifier.js',
    'backend/services/markitdownService.js',
    'backend/services/sweepService.js',
    'backend/services/purgaCatalogo.js',
    'backend/pipeline/EntityScraper.js',
    'backend/pipeline/DataIngestor.js',
    'backend/pipeline/CronScheduler.js',
    'backend/pipeline/EmbeddingsBatch.js',
    'backend/pipeline/FileImporter.js',
    'backend/routes/scraper.routes.js',
  ] },
  B_FORMULADOR: { rutas: [
    'backend/agents/formulador/**',
    'backend/agents/arbolObjetivosAgent.js',
    'backend/agents/normativoAgent.js',
    'backend/services/EntradaIAService.js',
    'backend/services/CopilotoService.js',
    'backend/services/viabilidadAgent.js',
    'backend/services/mirofishComite.js',
    'backend/services/mirofishReglas.js',
    'backend/services/directivasFormulacion.js',
    'backend/services/auditoriaVectores.js',
    'backend/services/formuladorMga.js',
    'backend/services/datosMinimosIA.js',
    'backend/services/scoringDinamico.js',
    'backend/services/AuditorForenseService.js',
    'backend/services/ExtractorService.js',
    'backend/services/EstresadoFinancieroService.js',
    'backend/services/ValorExponencialService.js',
    'backend/services/montecarloFinanciero.js',
    'backend/services/exportGenerator.js',
    'backend/services/pdfGenerator.js',
    'backend/services/svgEmbed.js',
    'backend/services/raciService.js',
    'backend/services/vigenciaDocumental.js',
    'backend/pipeline/apuEngine.js',
    'backend/routes/anexos.routes.js',
    'backend/routes/biblioteca.routes.js',
    'backend/routes/configLogistica.routes.js',
    'backend/routes/copiloto.routes.js',
    'backend/routes/entradaIA.routes.js',
    'backend/routes/estresFinanciero.routes.js',
    'backend/routes/evaluacionFinanciera.routes.js',
    'backend/routes/exportacion.routes.js',
    'backend/routes/formulacionIntegral.routes.js',
    'backend/routes/formuladorMga.routes.js',
    'backend/routes/marcoNormativo.routes.js',
    'backend/routes/matrizRaci.routes.js',
    'backend/routes/mirofish.routes.js',
    'backend/routes/motorDialectico.routes.js',
    'backend/routes/presupuesto.routes.js',
    'backend/routes/proyectos.routes.js',
    'backend/routes/radicacion.routes.js',
    'backend/routes/reporte.routes.js',
    'backend/routes/valorExponencial.routes.js',
  ] },
  // embeddingsService es la PRIMITIVA de vectorizar (la usan Radar y Anexos):
  // neutral. Lo que es del Radar es la búsqueda sobre convocatorias.
  NEUTRAL: { rutas: [
    'backend/utils/**', 'backend/config/**', 'backend/middlewares/**', 'backend/validators/**',
    'backend/notifications/**', 'backend/payments/**', 'backend/db.js', 'backend/env-loader.js',
    'backend/agents/modulos.map.js',
    'backend/services/geminiCircuitBreaker.js', 'backend/services/geminiReintento.js',
    'backend/services/aiTokenLogger.js', 'backend/services/byokService.js',
    'backend/services/embeddingsService.js', 'backend/services/nimCliente.js',
    'backend/services/llmProveedor.js', 'backend/services/openRouterCliente.js', 'backend/services/groqCliente.js',
    'backend/services/iaPresupuesto.js', 'backend/services/iaTopeSistema.js', 'backend/services/iaFlags.js', 'backend/services/apisEstado.js',
    'backend/services/logService.js', 'backend/services/alertaErrores.js', 'backend/services/emailService.js',
    'backend/pipeline/CryptoHelper.js', 'backend/pipeline/seed-predios.js',
    'backend/routes/authGoogle.controller.js', 'backend/routes/byokCredentials.routes.js',
    'backend/routes/compliance.routes.js', 'backend/routes/stripe.webhook.js', 'backend/routes/wompi.webhook.js',
  ] },
  GP: { rutas: ['backend/agents/gp/**'] },
  COMPOSICION: { rutas: [
    'server.js',
    'backend/routes/subscriptions.routes.js',   // /api/bridge/transfer delega en el GP
    'backend/agents/escuadron.registry.js',     // índice que reexporta agentes de A y B
  ] },
};

/** Las 13 funciones reales (Nivel 3). ids = CATALOGO de scripts/agentes.mjs. */
export const FUNCIONES = [
  { id: 'sectorClassifier',    modulo: 'A_RADAR',      archivo: 'backend/services/sectorClassifier.js',            llamaLLM: true },
  { id: 'EntityScraper',       modulo: 'A_RADAR',      archivo: 'backend/pipeline/EntityScraper.js',               llamaLLM: false },
  { id: 'markitdown',          modulo: 'A_RADAR',      archivo: 'backend/services/markitdownService.js',           llamaLLM: true },
  { id: 'busquedaSemantica',   modulo: 'A_RADAR',      archivo: 'backend/agents/radar/index.js',                   llamaLLM: true },
  { id: 'lookupEntidad',       modulo: 'A_RADAR',      archivo: 'server.js',                                       llamaLLM: true },
  { id: 'EntradaIA',           modulo: 'B_FORMULADOR', archivo: 'backend/services/EntradaIAService.js',            llamaLLM: true },
  { id: 'arbolObjetivos',      modulo: 'B_FORMULADOR', archivo: 'backend/agents/arbolObjetivosAgent.js',           llamaLLM: true },
  { id: 'viabilidad',          modulo: 'B_FORMULADOR', archivo: 'backend/services/viabilidadAgent.js',             llamaLLM: true },
  { id: 'mirofish',            modulo: 'B_FORMULADOR', archivo: 'backend/services/mirofishComite.js',              llamaLLM: true },
  { id: 'copiloto',            modulo: 'B_FORMULADOR', archivo: 'backend/services/CopilotoService.js',             llamaLLM: true },
  { id: 'formulacionIntegral', modulo: 'B_FORMULADOR', archivo: 'backend/routes/formulacionIntegral.routes.js',    llamaLLM: true },
  { id: 'formuladorMga',       modulo: 'B_FORMULADOR', archivo: 'backend/services/formuladorMga.js',               llamaLLM: true },
  { id: 'normativo',           modulo: 'B_FORMULADOR', archivo: 'backend/agents/normativoAgent.js',                llamaLLM: false },
];
