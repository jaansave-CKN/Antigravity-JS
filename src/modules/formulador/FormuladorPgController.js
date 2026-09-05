import crypto from 'crypto';
import sb from './supabaseClient.js';
import { Orchestrator000 } from '../../orchestrator-engine.js';
import occGuard from './occGuard.js';

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
// - req.user.uid (Firebase, verificado por verifyFirebaseAuth antes de llegar
//   aquí) siempre es la única fuente de verdad -> se deriva de forma determinista.
// - Eliminado 2026-09-04 (auditoría PROTOCOLO 5x5 ∞, VECTOR 2): existía un
//   fallback a `req.headers['x-tenant-id']` para cuando req.user.uid faltaba.
//   Hoy es inalcanzable (el gate global de auth en server.js garantiza
//   req.user.uid en todo /api/formulador/*, y ningún caller real —
//   confirmado por grep en todo el repo— envía ese header), pero dependía
//   por completo de que el orden de middlewares en server.js nunca cambiara:
//   un solo `app.use()` reordenado convertía este header, controlado 100%
//   por el cliente, en un IDOR trivial de un tenant a otro (RLS-por-rol está
//   inactivo hoy — ver supabaseClient.js:sbFetch — así que nada en Postgres
//   lo habría detenido). Sin caller legítimo, la superficie se cierra del
//   todo en vez de parchearse: sin req.user.uid, la petición se rechaza.
function getTenant(req) {
  if (req.user?.uid) return deriveUuidFromString(req.user.uid);
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

  // Idempotencia (auditoría PROTOCOLO TITÁN 2026-08-12, Capa 9): el cliente
  // genera un ID estable por intento de guardado y lo reenvía si reintenta la
  // MISMA petición (reconexión de red, doble-click). Opcional — sin header,
  // el comportamiento es el mismo de siempre (sin dedup). Ver migración 009.
  const idempotencyKey = req.headers['x-idempotency-key'] || null;

  try {
    const userJwt = getUserJwt(req);
    await sb.setTenantContext(tenant, userJwt);
    const result = await sb.rpc('insertar_fase1', {
      p_tenant_id: tenant,
      p_ficha:     ficha_fase1,
      p_modulo_7:  modulo_7,
      p_modulo_8:  modulo_8,
      p_modulo_9:  modulo_9,
      p_idempotency_key: idempotencyKey,
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
 *
 * Único endpoint de este controller que reemplaza un recurso ya existente
 * (los demás son inserción o lectura) — por eso es donde se ancla OCC
 * (ADR-0001, Migración A): sin verbo PUT/PATCH propio en este router, este
 * POST cumple ese rol semántico.
 */
export async function guardarModulo10(req, res) {
  const tenant = getTenant(req);
  if (!tenant) return res.status(400).json({ error: 'Identificador de tenant inválido (se requiere UUID).' });
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Identificador de proyecto inválido (se requiere UUID).' });
  const userJwt = getUserJwt(req);
  const proyectoId = req.params.id;
  const indicadores = req.body.indicadores || [];
  const { hash: newHash } = occGuard.computeHash(indicadores);

  try {
    // OCC atómico: lock+check+escritura+hash en UNA sola transacción dentro
    // de la RPC (008_occ_atomic_guardar_modulo10.sql) — no en 2 llamadas
    // separadas. Corregido en auditoría 008_AUDITOR_DE_CODIGO (2026-08-11):
    // el diseño original comparaba el hash antes de llamar a esta RPC, en
    // otra transacción, dejando una ventana real de carrera entre 2 requests
    // concurrentes sobre el mismo proyecto.
    const result = await sb.rpc('guardar_modulo10', {
      p_tenant_id: tenant, p_proyecto_id: proyectoId, p_indicadores: indicadores,
      p_expected_hash: req.body.version_hash || null, p_new_hash: newHash,
    }, userJwt);

    return res.status(201).json(result);
  } catch (err) {
    if (typeof err.message === 'string' && err.message.startsWith('OCC_CONFLICT')) {
      return res.status(409).json({ error: err.message });
    }
    // guardar_modulo10 (RPC) rechaza si el proyecto no pertenece al tenant —
    // eso es un intento de escritura cruzada de tenant, no un simple 404:
    // se registra en el Shadow Ledger (Fase 4.2) antes de responder.
    if (typeof err.message === 'string' && err.message.includes('no pertenece al tenant')) {
      await occGuard.registrarViolacionSeguridad({
        tenantId: tenant, ip: req.ip, jwtSub: req.user?.uid, endpoint: req.originalUrl,
        tipo: 'tenant_mismatch', detalle: err.message, payload: { proyecto_id: proyectoId }, userJwt,
      });
    }
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
    // userJwt viaja como parámetro explícito de esta llamada, no como estado
    // global mutable — cierra la race condition de identidad cruzada bajo
    // concurrencia real (PROTOCOLO TITÁN ∞, segunda ronda, 2026-08-14).
    const result = await orchestrator.run(ficha, disenoAprobado, userJwt);
    if (!result.success) return res.status(500).json({ error: result.error });
    return res.json(result);
  } catch (err) {
    console.error('[FormuladorController] generarFichaTecnica:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
