/**
 * Gerente de Proyecto (Nivel 1, Fase 4) — versión MÍNIMA aprobada por
 * architect (2026-09-28) y por el dueño.
 *
 * Gobierna SOLO los dos flujos reales que cruzan Radar (A) ↔ Formulador (B):
 *   1. formularConvocatoria      A→B  (POST /api/bridge/transfer)
 *   2. convocatoriasParaProyecto B→A  (POST /api/radar/barrido[-masivo])
 *
 * Qué NO es (rechazado en el dictamen): un enrutador "por intención" con un
 * LLM, ni un proxy único delante de las 13 rutas — cada pantalla ya sabe qué
 * endpoint llamar, y eso solo añadiría latencia, costo y un punto de fallo.
 * Ninguna de estas dos operaciones llama a un LLM de texto.
 *
 * Solo importa los coordinadores (y NEUTRAL): nunca una función hoja. Lo
 * verifica tests/unit/aislamientoModulos.test.mjs. Devuelve {ok:false,
 * status, code} en los casos de negocio; el handler HTTP mapea el status.
 */
import * as radar from '../radar/index.js';
import * as formulador from '../formulador/index.js';
import { textToEmbedding } from '../../services/embeddingsService.js';

export const OPERACIONES = ['formularConvocatoria', 'convocatoriasParaProyecto'];

/**
 * A→B: crea un proyecto Borrador del Formulador desde una convocatoria del
 * Radar. Los datos salen del CATÁLOGO (coordinador A), nunca del cliente.
 */
export async function formularConvocatoria({ userId, userRole, convocatoriaId }) {
  if (!(await formulador.tieneAccesoFormulador(userId, userRole))) {
    return { ok: false, status: 403, code: 'NO_ACCESS_FORMULADOR', message: 'Activa el plan Formulador para formular esta oportunidad', upgrade_required: true, redirect_to: '/planes' };
  }
  const conv = await radar.obtenerConvocatoria(convocatoriaId);
  if (!conv) {
    return { ok: false, status: 404, code: 'CONVOCATORIA_NO_ENCONTRADA', message: 'La convocatoria no existe en el catálogo del Radar (o fue eliminada).' };
  }
  const { proyecto_id, nombre } = await formulador.crearProyectoBorradorDesdeConvocatoria(userId, conv);
  // /checklist es la entrada real del Formulador (client/src/main.tsx); la
  // ruta /formulador que devolvía el puente no existe y caía al catch-all.
  return { ok: true, proyecto_id, nombre, convocatoria_id: conv.id, redirect_to: '/checklist' };
}

/**
 * B→A: convocatorias abiertas más afines a un proyecto (vector recalculado
 * desde sus datos reales) o a un texto libre.
 */
export async function convocatoriasParaProyecto({ userId, proyectoId, texto, limit, threshold }) {
  // Primero el catálogo: si no tiene vectores, no se gasta ningún embedding.
  const catalogo = await radar.estadoEmbeddings();
  if (!catalogo.con) {
    return { ok: false, status: 503, code: 'CATALOGO_SIN_EMBEDDINGS', message: `El catálogo del Radar todavía no tiene vectores semánticos (0 de ${catalogo.total} convocatorias abiertas) — el proceso por lotes aún no ha corrido.` };
  }
  let vec = null;
  if (proyectoId) {
    const r = await formulador.obtenerVectorProyecto(userId, proyectoId);
    if (r === 'NO_ENCONTRADO') return { ok: false, status: 404, code: 'PROYECTO_NO_ENCONTRADO', message: 'Proyecto no encontrado' };
    if (Array.isArray(r)) vec = r;
  }
  if (!vec) {
    if (!texto?.trim()) return { ok: false, status: 400, code: 'SIN_VECTOR_NI_TEXTO', message: 'El proyecto aún no tiene información suficiente para buscar — provee un texto de búsqueda.' };
    vec = await textToEmbedding(texto.trim());
  }
  const { resultados, motor } = await radar.buscarConvocatoriasPorVector(vec, { limit, threshold });
  return { ok: true, resultados, total: resultados.length, motor, cobertura: catalogo };
}
