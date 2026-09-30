/**
 * expediente.routes.js — Expediente del Financiador (Viabilidad), Fase C de
 * la directiva "Audit de Impacto Integral" (dueño 2026-09-30).
 *
 * GET  /api/proyectos/:id/expediente           — ejes, secciones que aplican y última generación de cada una
 * POST /api/proyectos/:id/expediente/:seccion  — genera UNA sección con el agente (backend/services/expedienteFinanciador.js)
 *
 * Misma cadena de middlewares que MIROFISH (authenticateToken,
 * requireAccess('formulador'), aiLimiter en el POST). Si la IA no responde:
 * 503/429 honestos y NADA se persiste. Historial en
 * project_expediente_financiador (migración 078, solo INSERT).
 */
import { withTenantRow, withTenantRows, withTenantRun } from '../config/database.config.js';
import { captureError } from '../config/sentry.config.js';
import { resolverDirectivas } from '../services/directivasFormulacion.js';
import {
  SECCIONES, SECCIONES_IDS, SQL_ANEXOS_META, seccionesAplicables, construirFuentes, huellaMetadatos, generarSeccion,
  IaNoDisponibleError, IaTopeAgotadoError, LlmLoopGuardError,
} from '../services/expedienteFinanciador.js';
import { compilarAnexosProyecto } from '../services/EntradaIAService.js';
import { soportePredial, referenciaPredial } from '../services/auditoriaVectores.js';
import { hoyBogota } from '../services/vigenciaDocumental.js';
import { respuesta422 } from '../services/datosMinimosIA.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[expediente]', err.message);
      captureError(err, { route: 'expediente', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

function parseJson(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}') || {}; } catch { return {}; }
}

const resumenDirectivas = (d) => ({ vectores: d.vectores, esquema: d.esquema, conflictos: d.conflictos, exige: d.exige });

export function registerExpedienteRoutes(app, { authenticateToken, requireAccess, aiLimiter }) {
  async function cargarProyecto(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id, ficha_tecnica FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.get('/api/proyectos/:id/expediente', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyecto = await cargarProyecto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const entrada = parseJson(proyecto.ficha_tecnica).entrada_completa || {};
    const directivas = resolverDirectivas(entrada);
    const [anexosMeta, filas] = await Promise.all([
      withTenantRows(req.userId, SQL_ANEXOS_META, [req.params.id]),
      withTenantRows(req.userId, 'SELECT seccion, estado, contenido, descartados, huella, modelo, proveedor, created_at FROM project_expediente_financiador WHERE project_id = ? ORDER BY created_at DESC LIMIT 100', [req.params.id]),
    ]);
    const huella = huellaMetadatos(entrada, anexosMeta);
    const ultimas = {};
    for (const f of filas) if (!ultimas[f.seccion]) ultimas[f.seccion] = f;
    const aplican = new Set(seccionesAplicables(directivas));
    res.json({
      success: true,
      data: {
        directivas: resumenDirectivas(directivas),
        secciones: SECCIONES_IDS.map(id => {
          const f = ultimas[id];
          return {
            id, titulo: SECCIONES[id].titulo, aplica: aplican.has(id),
            ultima: f ? { estado: f.estado, contenido: parseJson(f.contenido), descartados: Array.isArray(f.descartados) ? f.descartados : parseJson(f.descartados), modelo: f.modelo, proveedor: f.proveedor, created_at: f.created_at, desactualizada: f.huella !== huella } : null,
          };
        }),
      },
    });
  }));

  app.post('/api/proyectos/:id/expediente/:seccion', authenticateToken, requireAccess('formulador'), aiLimiter, wrap(async (req, res) => {
    const { seccion } = req.params;
    if (!SECCIONES_IDS.includes(seccion)) return res.status(400).json({ success: false, message: `Sección inválida. Opciones: ${SECCIONES_IDS.join(', ')}` });
    const proyecto = await cargarProyecto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const entrada = parseJson(proyecto.ficha_tecnica).entrada_completa || {};
    const directivas = resolverDirectivas(entrada);
    if (!SECCIONES[seccion].aplica(directivas)) {
      return res.status(409).json({ success: false, code: 'SECCION_NO_APLICA', message: `"${SECCIONES[seccion].titulo}" no aplica a los ejes elegidos en Entrada (fuente: ${directivas.vectores.fuente || 'sin definir'}; metodologías: ${directivas.vectores.metodologias.join(', ') || 'sin definir'}).` });
    }

    const scoped = {
      getRows: (sql, params) => withTenantRows(req.userId, sql, params),
      runSql: (sql, params) => withTenantRun(req.userId, sql, params),
    };
    const [anexosMeta, anexos] = await Promise.all([
      withTenantRows(req.userId, SQL_ANEXOS_META, [req.params.id]),
      compilarAnexosProyecto(req.params.id, scoped),
    ]);
    const { datos, anexosIds, omitidos } = construirFuentes(entrada, anexos);

    // Sin gastar cuota de IA si no hay material (mismo contrato 422 que LOTE 10).
    const faltantes = [];
    if (!Object.keys(anexosIds).length) faltantes.push({ campo: 'anexos', donde: 'Anexos con texto legible (términos de referencia de la convocatoria, estudios, diagnóstico)' });
    if (seccion !== 'checklist_juridico' && !Object.keys(datos).some(k => k.startsWith('entrada.'))) faltantes.push({ campo: 'entrada', donde: 'Entrada (problema, contexto y solución elegida)' });
    if (faltantes.length) return res.status(422).json(respuesta422('el Expediente del Financiador', faltantes));

    let r;
    try {
      r = await generarSeccion({ seccionId: seccion, directivas, datos, anexosIds, userId: req.userId });
    } catch (err) {
      if (err instanceof IaTopeAgotadoError) return res.status(429).json({ success: false, code: err.code, message: err.message, retryAt: err.retryAt });
      if (err instanceof IaNoDisponibleError) { res.set('X-RF-No-Retry', '1'); return res.status(503).json({ success: false, code: 'IA_NO_DISPONIBLE', message: err.message }); }
      if (err instanceof LlmLoopGuardError) return res.status(429).json({ success: false, code: err.code, message: err.message });
      throw err;
    }

    const contenido = { grupos: r.grupos, fuentes_omitidas: omitidos };
    if (seccion === 'checklist_juridico' && directivas.exige.saneamientoPredial) {
      // Documento base de la regla V6 (determinista, no de la IA).
      const soporte = soportePredial(anexosMeta, hoyBogota());
      contenido.grupos.documentos = [{
        documento: 'Soporte predial del predio a intervenir (propiedad o posesión acreditada)', obligatorio: true,
        referencia: referenciaPredial(directivas.sectorAgua), anexo: soporte.anexo && !soporte.vencido ? soporte.anexo : '',
        estado: soporte.anexo && !soporte.vencido ? 'soportado_por_anexo' : 'no_detectado', origen: 'regla_V6', fuentes: [],
        ...(soporte.vencido ? { nota: `Certificado de libertad y tradición vencido (${soporte.anexo}).` } : {}),
      }, ...(contenido.grupos.documentos || [])];
    }

    const fila = await withTenantRow(req.userId,
      `INSERT INTO project_expediente_financiador (project_id, org_id, seccion, estado, contenido, descartados, directivas, huella, modelo, proveedor, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seccion, estado, contenido, descartados, modelo, proveedor, created_at`,
      [req.params.id, req.userId, seccion, r.estado, JSON.stringify(contenido), JSON.stringify(r.descartados),
        JSON.stringify(resumenDirectivas(directivas)), huellaMetadatos(entrada, anexosMeta), r.modelo, r.proveedor, req.userId]);
    res.status(201).json({ success: true, data: { ...fila, contenido: parseJson(fila.contenido), descartados: parseJson(fila.descartados), desactualizada: false } });
  }));
}
