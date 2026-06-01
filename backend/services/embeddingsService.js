/**
 * Servicio de Embeddings — Google Gemini text-embedding-004 (768 dims)
 * Usado por el pipeline M7 para convertir Ficha Tecnica a vector.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIM   = 768;

function getClient() {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('EMBEDDINGS_ERROR: GOOGLE_API_KEY no configurado');
  return new GoogleGenerativeAI(key);
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
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text: text.trim() }] },
    taskType: 'SEMANTIC_SIMILARITY',
  });
  const values = result.embedding?.values;
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
