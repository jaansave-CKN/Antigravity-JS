/**
 * escuadron.registry.js — índice de documentación de los agentes de IA
 * (llamadores de Gemini) reales del backend de RadFor-360.
 *
 * ⚠️ ESTE ARCHIVO ES SOLO UN ÍNDICE DE DOCUMENTACIÓN/TAXONOMÍA.
 * NO orquesta nada. NO despacha tareas entre agentes. NO cambia ni
 * reemplaza ningún import ya existente en las rutas. Cada agente sigue
 * siendo invocado directamente por su propio handler HTTP, exactamente
 * igual que antes de que este archivo existiera — este registro solo
 * REEXPORTA las funciones reales para tener un único punto de lectura
 * de "qué agentes de IA existen y dónde", sin envolverlas en clases ni
 * simular un orquestador que no existe.
 *
 * Origen (2026-08-19, mandato del usuario, revisado por el agente
 * `architect` antes de escribirse — ver decisiones abajo):
 *
 *   - GP (Gerente de Proyecto): hasta la Fase 4 ningún archivo cumplía esa
 *     función y quedó vacío a propósito. Desde 2026-09-28 existe
 *     agents/gp/gerenteProyecto.js (versión mínima: solo los 2 flujos A↔B).
 *     formulacionIntegral sigue siendo una secuencia FIJA del Formulador
 *     (Entrada→Árbol→Viabilidad) — no enruta, no es GP.
 *   - CopilotoService.js NO es "GP": es un chat de solo lectura (arma un
 *     snapshot de datos ya calculados y responde preguntas) — no despacha
 *     trabajo hacia A/B/C. Se lista aparte, como TRANSVERSAL.
 *   - Alcance: SOLO los componentes que llaman realmente a un LLM —
 *     deja fuera EntityScraper.js (scraping puro, sin LLM) y
 *     normativoAgent.js (M8, tabla estática de normas, sin LLM) a
 *     propósito, por honestidad con el nombre "agentes de IA".
 *   - markitdownService.js: su única función que llama a Gemini
 *     (extractConvocatoriaFields) la usa exclusivamente EntityScraper.js
 *     (Radar). convertBufferToMarkdown (usada por Anexos/Entrada) se movió
 *     a utils/fileConverters.js el 2026-09-28 — conversión sin IA, neutral
 *     entre Radar y Formulador, fuera de este registro.
 *
 * Sincronizado 2026-09-28 con scripts/agentes.mjs (CATALOGO, fuente de
 * verdad con estado en vivo): se agregaron los 4 que faltaban —
 * lookupEntidad, busquedaSemantica, mirofishComite y formulacionIntegral.
 *
 * Mantenimiento: si agregas otro componente que llame a un LLM, agrégalo
 * aquí Y en el CATALOGO de scripts/agentes.mjs — no hay ningún test/lint
 * que lo fuerce automáticamente.
 */

import { generarArbolConIA } from './arbolObjetivosAgent.js';
import { generarEntradaDesdeInvestigacion } from '../services/EntradaIAService.js';
import { calcularViabilidadIA, recolectarContextoViabilidad, calcularPuntoEquilibrio } from '../services/viabilidadAgent.js';
import { classifySectors } from '../services/sectorClassifier.js';
import { extractConvocatoriaFields } from '../services/markitdownService.js';
import { chatConCopiloto, obtenerHistorial as obtenerHistorialCopiloto } from '../services/CopilotoService.js';
import { consolidarMGA } from '../services/formuladorMga.js';
import { generarSeccion } from '../services/expedienteFinanciador.js';
import { evaluarComiteIA } from '../services/mirofishComite.js';
import { textToEmbedding } from '../services/embeddingsService.js';
import { registerFormulacionIntegralRoutes } from '../routes/formulacionIntegral.routes.js';
import { formularConvocatoria, convocatoriasParaProyecto } from './gp/gerenteProyecto.js';

export const ESCUADRON = {
  // Fase 4 (2026-09-28, dictamen architect + aprobación del dueño): el GP
  // existe en código, en su versión MÍNIMA — despacha solo los 2 flujos
  // reales Radar↔Formulador vía los coordinadores (agents/radar/index.js y
  // agents/formulador/index.js). No es un enrutador por intención (rechazado).
  // La jerarquía completa y la regla de aislamiento: agents/modulos.map.js.
  GP: [
    {
      nombre: 'gerenteProyecto',
      descripcion: 'Gerente de Proyecto mínimo: formularConvocatoria (Radar→Formulador, crea el proyecto desde el catálogo) y convocatoriasParaProyecto (Formulador→Radar, búsqueda semántica con el vector real del proyecto).',
      llamaLLM: false,
      invocadoDesde: ['backend/routes/subscriptions.routes.js (POST /api/bridge/transfer)', 'server.js (POST /api/radar/barrido[-masivo])'],
      exporta: { formularConvocatoria, convocatoriasParaProyecto },
    },
  ],

  TRANSVERSAL: [
    {
      nombre: 'CopilotoService',
      descripcion: 'Chat conversacional del panel derecho del Formulador — lee datos ya calculados y responde preguntas, no despacha trabajo a otros agentes.',
      llamaLLM: true,
      invocadoDesde: 'backend/routes/copiloto.routes.js',
      exporta: { chatConCopiloto, obtenerHistorial: obtenerHistorialCopiloto },
    },
  ],

  A_RADAR: [
    {
      nombre: 'sectorClassifier',
      descripcion: 'Clasifica convocatorias por sector vía llmProveedor (soloServidor: pool Gemini, tope diario del sistema); fallback a palabras clave si la IA no está disponible.',
      llamaLLM: true,
      invocadoDesde: ['backend/pipeline/DataIngestor.js', 'backend/pipeline/EntityScraper.js', 'server.js'],
      exporta: { classifySectors },
    },
    {
      nombre: 'markitdownService (extractConvocatoriaFields)',
      descripcion: 'Extrae campos estructurados de una convocatoria ya convertida a Markdown. Único export de este archivo que llama a Gemini — convertBufferToMarkdown (usado por Anexos/Entrada) vive ahora en utils/fileConverters.js, sin IA, fuera de este registro.',
      llamaLLM: true,
      invocadoDesde: 'backend/pipeline/EntityScraper.js',
      exporta: { extractConvocatoriaFields },
    },
    {
      nombre: 'lookupEntidad',
      descripcion: 'Búsqueda de entidades del Directorio — analiza una URL vía llmProveedor (soloServidor: pool Gemini, tope diario del sistema; búsqueda profunda con Search Grounding en buscarConGroundingServidor) y valida si aplica a Colombia (POST /api/entidades/lookup).',
      llamaLLM: true,
      invocadoDesde: 'server.js (handler inline de POST /api/entidades/lookup, llamado desde DirectoryPage.tsx)',
      // Sin función exportable: la lógica vive dentro del handler en
      // server.js, que no se puede importar sin arrancar el servidor.
      exporta: null,
    },
    {
      nombre: 'busquedaSemantica (embeddingsService)',
      descripcion: 'Embeddings vector(768) para búsqueda semántica. Pantalla de producción /busqueda-semantica (2026-09-29) → POST /api/radar/buscar-masivo vía el coordinador A (buscarPorTexto); el catálogo abierto lo vectoriza el lote nocturno EmbeddingsBatch (03:45 COT, encendido por defecto).',
      llamaLLM: true,
      invocadoDesde: ['server.js', 'backend/routes/anexos.routes.js'],
      exporta: { textToEmbedding },
    },
  ],

  B_FORMULADOR: [
    {
      nombre: 'arbolObjetivosAgent',
      descripcion: 'Módulo 3 — genera el árbol de objetivos (causas→problema→efectos invertido a medios→objetivo→fines).',
      llamaLLM: true,
      invocadoDesde: 'server.js',
      exporta: { generarArbolConIA },
    },
    {
      nombre: 'EntradaIAService',
      descripcion: '"Generar con AI" del módulo 11 de Entrada (Contexto del Problema) — lee la carpeta "Investigación" de Anexos.',
      llamaLLM: true,
      invocadoDesde: 'backend/routes/entradaIA.routes.js',
      exporta: { generarEntradaDesdeInvestigacion },
    },
    {
      nombre: 'formuladorMga',
      descripcion: 'Fase 3 — CONSOLIDA (no redacta desde cero) lo generado por Entrada/EntradaIA, Viabilidad y MIROFISH en los 4 bloques MGA; cifras deterministas de Node; cada párrafo validado contra sus fuentes. Modelo: deepseek-ai/deepseek-v4.1-flash vía NVIDIA NIM (llave del servidor).',
      llamaLLM: true,
      invocadoDesde: 'backend/routes/formuladorMga.routes.js',
      exporta: { consolidarMGA },
    },
    {
      nombre: 'expedienteFinanciador',
      descripcion: 'Expediente del Financiador (Viabilidad, 2026-09-30) — rol CREADOR: arma por secciones independientes, solo si los ejes de Entrada lo exigen, Marco Lógico (árbol + matriz 4×4), Teoría del Cambio, cadena de valor sin montos, salvaguardas ESS, matriz HSEQ, plan MEL, registro de riesgos PMI, operación y mantenimiento y checklist jurídico; cada ítem validado contra sus fuentes (mismo contrato que formuladorMga) y el checklist nunca da por soportado un documento sin anexo real.',
      llamaLLM: true,
      invocadoDesde: 'backend/routes/expediente.routes.js',
      exporta: { generarSeccion },
    },
    {
      nombre: 'formulacionIntegral',
      descripcion: 'Secuencia FIJA Entrada→Árbol→Viabilidad sobre un proyecto (POST /api/formulacion/integral/:proyectoId) — encadena agentes del Formulador, no enruta ni decide: no es un GP.',
      llamaLLM: true,
      invocadoDesde: 'server.js (registerFormulacionIntegralRoutes)',
      exporta: { registerFormulacionIntegralRoutes },
    },
  ],

  C_VALIDADOR: [
    {
      nombre: 'viabilidadAgent',
      descripcion: 'Auditoría de viabilidad financiera/técnica del proyecto (punto de equilibrio, scoring).',
      llamaLLM: true,
      invocadoDesde: ['backend/routes/proyectos.routes.js', 'server.js'],
      exporta: { calcularViabilidadIA, recolectarContextoViabilidad, calcularPuntoEquilibrio },
    },
    {
      nombre: 'mirofishComite',
      descripcion: 'Comité Hostil MIROFISH — panel de evaluadores escépticos que ataca la formulación buscando vacíos reales antes que el financiador.',
      llamaLLM: true,
      invocadoDesde: 'backend/routes/mirofish.routes.js',
      exporta: { evaluarComiteIA },
    },
  ],
};

export default ESCUADRON;
