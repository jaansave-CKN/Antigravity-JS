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
 *   - GP (Gerente de Proyecto): NINGÚN archivo del repo cumple hoy esa
 *     función. Verificado por grep: cero llamadas cruzadas entre estos 7
 *     agentes — ninguno decide "esto va a A, esto va a B". No se fuerza
 *     ninguna etiqueta "GP" sobre un archivo que no orquesta, para no
 *     fingir una infraestructura que no existe. Queda vacío a propósito.
 *   - CopilotoService.js NO es "GP": es un chat de solo lectura (arma un
 *     snapshot de datos ya calculados y responde preguntas) — no despacha
 *     trabajo hacia A/B/C. Se lista aparte, como TRANSVERSAL.
 *   - Alcance: SOLO los 7 archivos que llaman realmente a Gemini —
 *     deja fuera EntityScraper.js (scraping puro, sin LLM) y
 *     normativoAgent.js (M8, tabla estática de normas, sin LLM) a
 *     propósito, por honestidad con el nombre "agentes de IA".
 *   - markitdownService.js: su única función que llama a Gemini
 *     (extractConvocatoriaFields) la usa exclusivamente EntityScraper.js
 *     (Radar) — la otra función del mismo archivo (convertBufferToMarkdown,
 *     usada por Anexos/Entrada) es conversión de archivo sin IA (CLI de
 *     MarkItDown), fuera del alcance de este registro. No hay ambigüedad
 *     real una vez que se mira la función exacta, no el archivo completo.
 *
 * Mantenimiento: si agregas un noveno agente que llame a un LLM, agrégalo
 * aquí también — no hay ningún test/lint que lo fuerce automáticamente.
 */

import { generarArbolConIA } from './arbolObjetivosAgent.js';
import { generarEnfoqueEntidad } from '../services/enfoqueEntidadAgent.js';
import { generarEntradaDesdeInvestigacion } from '../services/EntradaIAService.js';
import { calcularViabilidadIA, recolectarContextoViabilidad, calcularPuntoEquilibrio } from '../services/viabilidadAgent.js';
import { classifySectors } from '../services/sectorClassifier.js';
import { extractConvocatoriaFields } from '../services/markitdownService.js';
import { chatConCopiloto, obtenerHistorial as obtenerHistorialCopiloto } from '../services/CopilotoService.js';

export const ESCUADRON = {
  // Ningún archivo del repo orquesta hoy a los demás — ver nota de cabecera.
  // No agregar nada aquí sin que exista lógica de despacho real primero.
  GP: [],

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
      descripcion: 'Clasifica convocatorias por sector (con fallback a palabras clave si Gemini no está disponible).',
      llamaLLM: true,
      invocadoDesde: ['backend/pipeline/DataIngestor.js', 'backend/pipeline/EntityScraper.js', 'server.js'],
      exporta: { classifySectors },
    },
    {
      nombre: 'markitdownService (extractConvocatoriaFields)',
      descripcion: 'Extrae campos estructurados de una convocatoria ya convertida a Markdown. Único export de este archivo que llama a Gemini — convertBufferToMarkdown (usado por Anexos/Entrada) es conversión de archivo sin IA, fuera de este registro.',
      llamaLLM: true,
      invocadoDesde: 'backend/pipeline/EntityScraper.js',
      exporta: { extractConvocatoriaFields },
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
      nombre: 'enfoqueEntidadAgent',
      descripcion: 'Adapta la narrativa del proyecto matriz al lenguaje/prioridades de la entidad a la que se postula.',
      llamaLLM: true,
      invocadoDesde: 'server.js',
      exporta: { generarEnfoqueEntidad },
    },
    {
      nombre: 'EntradaIAService',
      descripcion: '"Generar con AI" del módulo 11 de Entrada (Contexto del Problema) — lee la carpeta "Investigación" de Anexos.',
      llamaLLM: true,
      invocadoDesde: 'backend/routes/entradaIA.routes.js',
      exporta: { generarEntradaDesdeInvestigacion },
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
  ],
};

export default ESCUADRON;
