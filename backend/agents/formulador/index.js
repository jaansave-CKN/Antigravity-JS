/**
 * Coordinador B — Formulador (Nivel 2, Fase 4, dictamen architect 2026-09-28).
 *
 * Fachada: expone SOLO las capacidades del Formulador que un flujo A↔B
 * necesita, para que el Gerente de Proyecto nunca toque una función hoja.
 * Las rutas existentes del Formulador no pasan por aquí.
 *
 * Todo dato de proyecto es del TENANT: cada consulta va por withTenant*
 * (RLS real con rf360_rls_scoped) y con org_id explícito.
 */
import crypto from 'crypto';
import { withTenantRow, withTenantRun } from '../../config/database.config.js';
import { textToEmbedding, serializeEmbedding } from '../../services/embeddingsService.js';
import { FUNCIONES as TODAS } from '../modulos.map.js';

export const MODULO = 'B_FORMULADOR';
export const FUNCIONES = TODAS.filter(f => f.modulo === MODULO);

const MAX_TEXTO_VECTOR = 6000;
const MIN_TEXTO_VECTOR = 40;

/** Plan Formulador activo (el admin pasa siempre — mismo bypass que tenía el puente). */
export async function tieneAccesoFormulador(userId, rol) {
  if (rol === 'admin') return true;
  const sub = await withTenantRow(userId, 'SELECT access_formulador FROM user_subscriptions WHERE user_id = ?', [userId]);
  return !!sub?.access_formulador;
}

/**
 * Crea un proyecto 'Borrador' a partir de una convocatoria YA LEÍDA DEL
 * CATÁLOGO por el coordinador A (nunca de campos enviados por el cliente) y
 * guarda su origen en ficha_tecnica.origen_radar. Una sola sentencia: atómica.
 */
export async function crearProyectoBorradorDesdeConvocatoria(userId, conv) {
  const proyectoId = crypto.randomUUID();
  const nombre = `Formulación: ${String(conv.titulo || 'Sin título').substring(0, 80)}`;
  const ficha = {
    origen_radar: {
      convocatoria_id: conv.id,
      externo_id: conv.externo_id || null,
      titulo: conv.titulo || '',
      donante: conv.donante || '',
      url_convocatoria: conv.url_convocatoria || '',
      fecha_limite: conv.fecha_limite || '',
      importado_at: new Date().toISOString(),
    },
  };
  await withTenantRun(userId,
    `INSERT INTO proyectos (id, user_id, org_id, nombre, estado, problem_statement, ficha_tecnica)
     VALUES (?, ?, ?, ?, 'Borrador', ?, ?)`,
    [proyectoId, userId, userId, nombre, conv.descripcion || '', JSON.stringify(ficha)]
  );
  return { proyecto_id: proyectoId, nombre };
}

const aTexto = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter(x => typeof x === 'string').join(', ') : '');

/** Texto real del proyecto para vectorizar (nombre, ubicación, problema, contexto de Entrada). Exportada para test. */
export function textoProyecto(p) {
  const ficha = (p?.ficha_tecnica && typeof p.ficha_tecnica === 'object') ? p.ficha_tecnica
    : (() => { try { return JSON.parse(p?.ficha_tecnica || '{}'); } catch { return {}; } })();
  const contexto = ficha?.entrada_completa?.contexto || {};
  const partes = [
    p?.nombre && `Proyecto: ${p.nombre}`,
    p?.location && `Ubicación: ${p.location}`,
    p?.problem_statement && `Problema: ${p.problem_statement}`,
    ...Object.entries(contexto).map(([k, v]) => { const t = aTexto(v).trim(); return t ? `${k}: ${t}` : null; }),
  ].filter(Boolean);
  return partes.join('. ').slice(0, MAX_TEXTO_VECTOR);
}

/**
 * Vector del proyecto, RECALCULADO desde sus datos actuales y persistido en
 * proyectos.embedding / embedding_vec. Reparación Fase 4: antes nadie
 * escribía esas columnas, así que el barrido por proyecto nunca funcionó.
 * Se recalcula en cada llamada (1 embedding, acción explícita del usuario)
 * para no buscar con un vector viejo si la formulación cambió.
 * @returns {Promise<number[] | 'NO_ENCONTRADO' | 'SIN_TEXTO'>}
 */
export async function obtenerVectorProyecto(userId, proyectoId) {
  const p = await withTenantRow(userId,
    'SELECT id, nombre, location, problem_statement, ficha_tecnica FROM proyectos WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [proyectoId, userId]
  );
  if (!p) return 'NO_ENCONTRADO';
  const texto = textoProyecto(p);
  if (texto.length < MIN_TEXTO_VECTOR) return 'SIN_TEXTO';
  const vector = await textToEmbedding(texto);
  const serializado = serializeEmbedding(vector);
  await withTenantRun(userId,
    process.env.DATABASE_URL
      ? 'UPDATE proyectos SET embedding = ?, embedding_vec = ?::vector WHERE id = ? AND org_id = ?'
      : 'UPDATE proyectos SET embedding = ? WHERE id = ? AND org_id = ?',
    process.env.DATABASE_URL ? [serializado, serializado, proyectoId, userId] : [serializado, proyectoId, userId]
  );
  return vector;
}
