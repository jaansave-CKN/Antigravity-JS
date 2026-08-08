import crypto from 'crypto';
import sb from './supabaseClient.js';
import { Orchestrator000, setServerAuthToken } from '../../orchestrator-engine.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deriva un UUID v4 determinista a partir de un identificador arbitrario (UID de
// Firebase). El mismo UID siempre produce el mismo UUID, así que el tenant_id
// queda estable por usuario sin necesitar una tabla de mapeo adicional, y ya es
// un valor que Postgres acepta en una columna UUID.
function deriveUuidFromString(value) {
  const hash  = crypto.createHash('sha256').update(String(value)).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Resuelve el tenant_id como UUID válido para Postgres.
// - req.user.uid (Firebase) nunca es un UUID -> se deriva de forma determinista.
// - x-tenant-id explícito debe venir ya como UUID; si no lo es, se rechaza
//   (ver los checks en guardarFase1/obtenerFase1) en vez de pasarlo tal cual a la RPC.
// - Sin ninguno de los dos, cae al tenant por defecto.
function getTenant(req) {
  if (req.user?.uid) return deriveUuidFromString(req.user.uid);
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant) return UUID_RE.test(headerTenant) ? headerTenant : null;
  // Antes: fallback silencioso a un tenant compartido (DEFAULT_TENANT) cuando no
  // había req.user ni header — landmine de aislamiento si el gate global alguna
  // vez deja pasar una request sin autenticar (guardrail RLS, 2026-08-07 §FASE 2).
  // Eliminado: sin tenant identificable, la petición se rechaza (null → 400 abajo).
  return null;
}

// JWT crudo del usuario (el mismo que verificó verifyFirebaseAuth) para que
// supabaseClient lo reenvíe como Authorization Bearer y Postgres aplique RLS
// en vez de operar siempre con la service key.
function getUserJwt(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * POST /api/formulador/fase1
 * Body: { ficha_fase1, modulo_7, modulo_8, modulo_9 }
 * Llama a la función RPC insertar_fase1 (transacción atómica en Supabase).
 */
export async function guardarFase1(req, res) {
  const { ficha_fase1 = {}, modulo_7 = {}, modulo_8 = {}, modulo_9 = {} } = req.body;

  if (!ficha_fase1.nombre && !ficha_fase1.nombre_proyecto) {
    return res.status(400).json({ error: 'nombre del proyecto es requerido en ficha_fase1' });
  }

  const tenant = getTenant(req);
  if (!tenant) {
    return res.status(400).json({ error: 'Identificador de tenant inválido (se requiere UUID).' });
  }

  try {
    const userJwt = getUserJwt(req);
    await sb.setTenantContext(tenant, userJwt);
    const result = await sb.rpc('insertar_fase1', {
      p_tenant_id: tenant,
      p_ficha:     ficha_fase1,
      p_modulo_7:  modulo_7,
      p_modulo_8:  modulo_8,
      p_modulo_9:  modulo_9,
    }, userJwt);

    return res.status(201).json({
      ok:                       true,
      proyecto_id:              result.proyecto_id,
      estado_validacion:        result.estado_validacion,
      porcentaje_contrapartida: result.porcentaje_contrapartida,
      message:                  'Fase 1 guardada correctamente en Supabase.',
    });
  } catch (err) {
    console.error('[FormuladorController] guardarFase1:', err.message, err.data ?? '');
    return res.status(err.status ?? 500).json({ error: err.message, detail: err.data });
  }
}

/**
 * GET /api/formulador/fase1/:id
 * Recupera el proyecto completo con módulos 7-8-9 desde Supabase REST.
 */
export async function obtenerFase1(req, res) {
  const { id } = req.params;

  const tenant = getTenant(req);
  if (!tenant) {
    return res.status(400).json({ error: 'Identificador de tenant inválido (se requiere UUID).' });
  }
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ error: 'Identificador de proyecto inválido (se requiere UUID).' });
  }
  const userJwt = getUserJwt(req);

  try {
    const data = await sb.rpc('obtener_fase1', { p_tenant_id: tenant, p_proyecto_id: id }, userJwt);
    if (!data || !data.proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

    return res.json({
      proyecto: data.proyecto,
      modulo_7: { ...data.objetivos, objetivos_especificos: data.oe ?? [] },
      modulo_8: data.cronograma ?? {},
      modulo_9: { ...data.presupuesto, validacion_cofinanciacion: data.validacion ?? null },
    });
  } catch (err) {
    console.error('[FormuladorController] obtenerFase1:', err.message);
    return res.status(err.status ?? 500).json({ error: err.message });
  }
}

/**
 * GET /api/formulador/proyectos — lista los proyectos del tenant actual.
 * Oleada 3, Grupo Elite (2026-08-06) — requerido por el selector de proyecto
 * en Módulo 10/Anexos/Logística/Dialéctica (antes no existía forma de listar
 * los proyectos ya guardados; solo GET /fase1/:id, que exige conocer el UUID).
 */
export async function listarProyectos(req, res) {
  const tenant = getTenant(req);
  if (!tenant) return res.status(400).json({ error: 'Identificador de tenant inválido (se requiere UUID).' });
  const userJwt = getUserJwt(req);
  try {
    const proyectos = await sb.rpc('listar_proyectos', { p_tenant_id: tenant }, userJwt);
    return res.json({ proyectos });
  } catch (err) {
    console.error('[FormuladorController] listarProyectos:', err.message);
    return res.status(err.status ?? 500).json({ error: err.message });
  }
}

/**
 * POST /api/formulador/:id/modulo10 — reemplaza los indicadores del proyecto.
 * GET  /api/formulador/:id/modulo10 — recupera los indicadores del proyecto.
 */
export async function guardarModulo10(req, res) {
  const tenant = getTenant(req);
  if (!tenant) return res.status(400).json({ error: 'Identificador de tenant inválido (se requiere UUID).' });
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identificador de proyecto inválido (se requiere UUID).' });
  const userJwt = getUserJwt(req);
  try {
    const result = await sb.rpc('guardar_modulo10', {
      p_tenant_id: tenant, p_proyecto_id: req.params.id, p_indicadores: req.body.indicadores || [],
    }, userJwt);
    return res.status(201).json(result);
  } catch (err) {
    console.error('[FormuladorController] guardarModulo10:', err.message, err.data ?? '');
    return res.status(err.status ?? 500).json({ error: err.message, detail: err.data });
  }
}

export async function obtenerModulo10(req, res) {
  const tenant = getTenant(req);
  if (!tenant) return res.status(400).json({ error: 'Identificador de tenant inválido (se requiere UUID).' });
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identificador de proyecto inválido (se requiere UUID).' });
  const userJwt = getUserJwt(req);
  try {
    const data = await sb.rpc('obtener_modulo10', { p_tenant_id: tenant, p_proyecto_id: req.params.id }, userJwt);
    return res.json(data);
  } catch (err) {
    console.error('[FormuladorController] obtenerModulo10:', err.message);
    return res.status(err.status ?? 500).json({ error: err.message });
  }
}

/**
 * POST /api/formulador/ficha-tecnica
 * Body: { ficha } — mismo shape que espera Orchestrator000 (metadata/geography/
 * population/technical_core/attachments), no el shape de insertar_fase1().
 * Corre AGT-052/053/054/056 (src/orchestrator-engine.js) del lado del servidor —
 * antes solo se importaba desde el navegador con una ruta que 404 en producción
 * (ver docs/RADIOGRAFIA_FORENSE_360_2026-08-06.md §4, Oleada 1 Grupo Elite).
 * Sin persistencia propia: es un borrador ejecutado sobre la ficha recibida,
 * desacoplado de si esa ficha ya se guardó en Supabase o no.
 */
export async function generarFichaTecnica(req, res) {
  const { ficha } = req.body || {};
  if (!ficha || typeof ficha !== 'object') {
    return res.status(400).json({ error: 'Se requiere "ficha" (objeto) en el body.' });
  }

  const userJwt = getUserJwt(req);
  if (userJwt) setServerAuthToken(userJwt);

  try {
    const orchestrator = new Orchestrator000();
    const disenoAprobado = await orchestrator.validarDiseno(ficha);
    if (!disenoAprobado.aprobado) {
      return res.status(422).json({
        success: false,
        error: 'GATE_ARQUITECTURA: la ficha no pasó la evaluación de completitud.',
        evaluation: disenoAprobado,
      });
    }
    const result = await orchestrator.run(ficha, disenoAprobado);
    if (!result.success) return res.status(500).json({ error: result.error });
    return res.json(result);
  } catch (err) {
    console.error('[FormuladorController] generarFichaTecnica:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
