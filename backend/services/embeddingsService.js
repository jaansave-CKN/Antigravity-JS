/**
 * Servicio de Embeddings — Google gemini-embedding-001 (768 dims)
 * Usado por el pipeline M7 para convertir Ficha Tecnica a vector.
 *
 * NOTA (2026-08-02): 'text-embedding-004' vía @google/generative-ai (paquete
 * ya deprecado por Google) empezó a devolver 404 "model not found" — no es
 * un bug de este código, es un cambio del lado de Google (confirmado en el
 * foro oficial de desarrolladores, mismo error reportado por terceros desde
 * febrero 2026). El modelo vigente es 'gemini-embedding-001', pero su salida
 * por defecto es de 3072 dims, no 768 — el paquete viejo no soporta el
 * parámetro outputDimensionality para forzar 768 y mantener compatibilidad
 * con las columnas vector(768) ya existentes. Por eso este archivo usa
 * @google/genai (el SDK actual), exclusivamente para embeddings — el resto
 * del código (generación de texto) sigue con @google/generative-ai sin tocar.
 */
import { GoogleGenAI } from '@google/genai';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM   = 768;

function getClient() {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('EMBEDDINGS_ERROR: GOOGLE_API_KEY no configurado');
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Convierte texto a vector de embeddings via Gemini.
 * @param {string} text
 * @returns {Promise<number[]>} — array de EMBEDDING_DIM floats
 */
export async function textToEmbedding(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('EMBEDDINGS_ERROR: texto vacio');
  }
  const ai = getClient();
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text.trim(),
    config: { outputDimensionality: EMBEDDING_DIM, taskType: 'SEMANTIC_SIMILARITY' },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIM) {
    throw new Error('EMBEDDINGS_ERROR: vector invalido recibido de Gemini');
  }
  return Array.from(values);
}

/**
 * Serializa un embedding para almacenamiento:
 *   - PostgreSQL: string '[0.1, 0.2, ...]' compatible con pgvector
 *   - SQLite: JSON string
 */
export function serializeEmbedding(vector) {
  return JSON.stringify(vector);
}

/**
 * Deserializa un embedding desde la BD.
 */
export function deserializeEmbedding(stored) {
  if (!stored) return null;
  if (typeof stored === 'string') return JSON.parse(stored);
  return stored;
}

/**
 * Convierte la Ficha Tecnica de un proyecto a texto enriquecido para embeddings.
 */
export function fichaTecnicaToText(fichaTecnica = {}) {
  const parts = [];
  if (fichaTecnica.nombre)        parts.push('Proyecto: ' + fichaTecnica.nombre);
  if (fichaTecnica.descripcion)   parts.push('Descripcion: ' + fichaTecnica.descripcion);
  if (fichaTecnica.sector)        parts.push('Sector: ' + fichaTecnica.sector);
  if (fichaTecnica.municipio)     parts.push('Municipio: ' + fichaTecnica.municipio);
  if (fichaTecnica.departamento)  parts.push('Departamento: ' + fichaTecnica.departamento);
  if (fichaTecnica.convocatoria)  parts.push('Convocatoria: ' + fichaTecnica.convocatoria);
  if (fichaTecnica.metaFisicaTotal) parts.push('Presupuesto: COP ' + fichaTecnica.metaFisicaTotal);
  if (fichaTecnica.objetivos)     parts.push('Objetivos: ' + fichaTecnica.objetivos);
  if (fichaTecnica.poblacion)     parts.push('Poblacion beneficiaria: ' + fichaTecnica.poblacion);
  return parts.join('. ') || 'Proyecto sin descripcion';
}

/**
 * Similitud coseno en JS (fallback cuando pgvector no esta disponible).
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} valor en [-1, 1]
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export { EMBEDDING_DIM };
