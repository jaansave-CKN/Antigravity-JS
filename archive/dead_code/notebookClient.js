import { fetchResiliente } from '../utils/resilientFetch.js';
import { logger } from '../utils/logger.js';
import HttpError from '../utils/httpError.js';

/**
 * Invoca la API de Notebook LM.
 *
 * @param {string} notebookKey  Clave desencriptada del usuario (Bearer token).
 * @param {object} payload      Cuerpo JSON que la API espera.
 * @returns {Promise<object>}   Respuesta JSON de Notebook LM.
 * @throws {HttpError}          Si la llamada HTTP falla o la respuesta no es JSON.
 */
export async function invocarNotebookLM(notebookKey, payload) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

  const response = await fetchResiliente(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notebookKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000), // 12 s timeout
  });

  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    logger.error('[NotebookLM] HTTP error', { status: response.status, body: txt.slice(0, 500) });
    throw new HttpError(`NotebookLM error ${response.status}`, response.status);
  }

  try {
    const data = await response.json();
    return data;
  } catch (e) {
    logger.error('[NotebookLM] JSON parse error', { err: e.message });
    throw new HttpError('Respuesta de NotebookLM no es JSON válida', 502);
  }
}
