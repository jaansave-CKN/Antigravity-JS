/**
 * iaPresupuesto.js — tope de gasto de IA POR USUARIO, persistido en Postgres
 * (migración 073). B1, decisión del dueño 2026-09-28: el contador NO puede
 * vivir en RAM — Render reinicia la instancia y un contador en memoria se
 * reiniciaría con ella.
 *
 * Solo cuenta el gasto real de OpenRouter (proveedor pagado con la llave del
 * servidor). El pool Gemini del servidor tiene su propio disyuntor y el BYOK
 * lo paga cada usuario.
 *
 * Flujo por llamada: reservar() ANTES de llamar (con el peor caso: todo
 * max_tokens de salida) → liquidar() con el costo real, o liberar() si la
 * petición falló antes de generar. Una reserva huérfana (proceso caído a
 * mitad) sigue contando: el error siempre favorece al dinero.
 *
 * Falla CERRADO: sin tope configurado, sin conexión directa a Postgres
 * (modo REST degradado no puede serializar) o sin la tabla, reservar() lanza
 * PresupuestoNoVerificableError y llmProveedor salta OpenRouter.
 *
 * Concurrencia: pg_advisory_xact_lock (de TRANSACCIÓN, se libera al COMMIT)
 * dentro de withTenant — compatible con el pooler en modo transacción
 * (:6543). Nunca pg_advisory_lock de sesión ni SET de sesión.
 */
import { withTenant } from '../config/database.config.js';

// Precios por millón de tokens de anthropic/claude-sonnet-5 publicados en
// https://openrouter.ai/api/v1/models (verificado 2026-09-28: prompt
// 0.000002, completion 0.00001 USD/token). Solo se usan para la RESERVA y
// como respaldo si OpenRouter no devuelve usage.cost.
const PRECIO_IN_DEFECTO = 2;
const PRECIO_OUT_DEFECTO = 10;

export class IaTopeAgotadoError extends Error {
  constructor(retryAt, periodo) {
    super(periodo === 'mes'
      ? 'Alcanzaste el tope mensual de uso de IA de tu cuenta.'
      : 'Alcanzaste el tope diario de uso de IA de tu cuenta.');
    this.name = 'IaTopeAgotadoError';
    this.status = 429;
    this.code = 'IA_TOPE_AGOTADO';
    this.retryAt = retryAt;
    this.esEstimado = false;
    this.periodo = periodo;
  }
}

export class PresupuestoNoVerificableError extends Error {
  constructor(motivo) {
    super(`Presupuesto de IA no verificable: ${motivo}`);
    this.name = 'PresupuestoNoVerificableError';
    this.motivo = motivo;
  }
}

const numPositivo = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Configuración leída del entorno en cada llamada (sin caché: un cambio de env no exige redeploy de código). */
export function configPresupuesto(env = process.env) {
  const topeDia = numPositivo(env.LLM_TOPE_USD_DIA);
  const topeMes = numPositivo(env.LLM_TOPE_USD_MES);
  return {
    topeDia, topeMes,
    precioIn: numPositivo(env.OPENROUTER_PRECIO_USD_M_IN) ?? PRECIO_IN_DEFECTO,
    precioOut: numPositivo(env.OPENROUTER_PRECIO_USD_M_OUT) ?? PRECIO_OUT_DEFECTO,
    ok: topeDia !== null && topeMes !== null,
    faltante: [topeDia === null && 'LLM_TOPE_USD_DIA', topeMes === null && 'LLM_TOPE_USD_MES'].filter(Boolean),
  };
}

/** Peor caso de una llamada: entrada estimada (~3 caracteres por token) + TODO max_tokens de salida. */
export function estimarReservaUsd(messages, maxTokens, cfg = configPresupuesto()) {
  const caracteres = (messages || []).reduce((s, m) => s + String(m?.content || '').length, 0);
  const tokensIn = Math.ceil(caracteres / 3);
  return (tokensIn * cfg.precioIn + maxTokens * cfg.precioOut) / 1_000_000;
}

/** Costo real: usage.cost de OpenRouter si llegó; si no, calculado con los tokens y los precios. */
export function costoRealUsd(usage = {}, costoUsd = null, cfg = configPresupuesto()) {
  if (Number.isFinite(costoUsd)) return costoUsd;
  const tin = Number(usage.prompt_tokens) || 0;
  const tout = Number(usage.completion_tokens) || 0;
  return (tin * cfg.precioIn + tout * cfg.precioOut) / 1_000_000;
}

// Cortes de día y mes en hora de Colombia, calculados en la BD (una sola fuente de reloj).
const SQL_CORTES = `
  SELECT (date_trunc('day',   now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota') AS inicio_dia,
         (date_trunc('month', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota') AS inicio_mes`;

const SQL_GASTO = `
  SELECT COALESCE(SUM(CASE WHEN estado = 'liquidado' THEN costo_real_usd
                           WHEN estado = 'reservado' THEN costo_reservado_usd ELSE 0 END)
                  FILTER (WHERE created_at >= $2), 0)::float8 AS dia,
         COALESCE(SUM(CASE WHEN estado = 'liquidado' THEN costo_real_usd
                           WHEN estado = 'reservado' THEN costo_reservado_usd ELSE 0 END), 0)::float8 AS mes
    FROM ai_consumo_usuario
   WHERE org_id = $1 AND created_at >= $3`;

const esClienteRest = (client) => client && Object.prototype.hasOwnProperty.call(client, '_tenantId');

async function leerTopes(client, userId, cfg) {
  const { rows } = await client.query('SELECT tope_usd_dia, tope_usd_mes FROM ai_tope_usuario WHERE org_id = $1', [String(userId)]);
  const fila = rows?.[0];
  return {
    dia: numPositivo(fila?.tope_usd_dia) ?? cfg.topeDia,
    mes: numPositivo(fila?.tope_usd_mes) ?? cfg.topeMes,
  };
}

async function calcularEstado(client, userId, cfg) {
  const { rows: [cortes] } = await client.query(SQL_CORTES);
  const { rows: [gasto] } = await client.query(SQL_GASTO, [String(userId), cortes.inicio_dia, cortes.inicio_mes]);
  const topes = await leerTopes(client, userId, cfg);
  const finDia = new Date(new Date(cortes.inicio_dia).getTime() + 24 * 3600_000);
  const inicioMes = new Date(cortes.inicio_mes);
  const finMes = new Date(inicioMes); finMes.setUTCMonth(finMes.getUTCMonth() + 1);
  return { gastoDia: Number(gasto.dia), gastoMes: Number(gasto.mes), topes, finDia, finMes };
}

/**
 * Reserva el peor caso de una llamada. Lanza IaTopeAgotadoError si no cabe,
 * PresupuestoNoVerificableError si no se puede garantizar el conteo.
 * @returns {Promise<string>} id de la reserva
 */
export async function reservar({ userId, agente, modelo, reservaUsd }, cfg = configPresupuesto()) {
  if (!cfg.ok) throw new PresupuestoNoVerificableError(`falta ${cfg.faltante.join(', ')}`);
  if (!userId) throw new PresupuestoNoVerificableError('sin userId');
  try {
    return await withTenant(userId, async (client) => {
      if (esClienteRest(client)) throw new PresupuestoNoVerificableError('BD en modo REST degradado (sin conexión directa)');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ia_tope:' || $1))", [String(userId)]);
      const e = await calcularEstado(client, userId, cfg);
      if (e.gastoMes + reservaUsd > e.topes.mes) throw new IaTopeAgotadoError(e.finMes, 'mes');
      if (e.gastoDia + reservaUsd > e.topes.dia) throw new IaTopeAgotadoError(e.finDia, 'dia');
      const { rows } = await client.query(
        `INSERT INTO ai_consumo_usuario (org_id, agente, proveedor, modelo, estado, costo_reservado_usd)
         VALUES ($1, $2, 'openrouter', $3, 'reservado', $4) RETURNING id`,
        [String(userId), agente, modelo, reservaUsd]
      );
      return rows[0].id;
    });
  } catch (err) {
    if (err instanceof IaTopeAgotadoError || err instanceof PresupuestoNoVerificableError) throw err;
    // Tabla ausente (073 sin aplicar), permisos, red: no se puede contar → falla cerrado.
    throw new PresupuestoNoVerificableError(err?.message || 'error de BD');
  }
}

/** Cierra la reserva con el costo real. Nunca lanza: si falla, la reserva sigue contando (conservador). */
export async function liquidar(userId, reservaId, { costoUsd, tokensIn = 0, tokensOut = 0, modelo = null }, log = console) {
  try {
    await withTenant(userId, client => client.query(
      `UPDATE ai_consumo_usuario
          SET estado = 'liquidado', costo_real_usd = $3, tokens_in = $4, tokens_out = $5,
              modelo = COALESCE($6, modelo), liquidado_at = now()
        WHERE id = $1 AND org_id = $2 AND estado = 'reservado'`,
      [reservaId, String(userId), costoUsd, tokensIn, tokensOut, modelo]
    ));
  } catch (err) {
    log.error?.('[iaPresupuesto] No se pudo liquidar la reserva (sigue contando al costo reservado)', { reservaId, err: err.message });
  }
}

/** Anula una reserva cuando la petición falló ANTES de generar (nada cobrado). Nunca lanza. */
export async function liberar(userId, reservaId, log = console) {
  try {
    await withTenant(userId, client => client.query(
      `UPDATE ai_consumo_usuario SET estado = 'liberado', liquidado_at = now()
        WHERE id = $1 AND org_id = $2 AND estado = 'reservado'`,
      [reservaId, String(userId)]
    ));
  } catch (err) {
    log.error?.('[iaPresupuesto] No se pudo liberar la reserva (sigue contando al costo reservado)', { reservaId, err: err.message });
  }
}

/**
 * Estado de solo lectura para /api/ia/estado-cuota. `null` si no se puede
 * verificar (mismas condiciones que reservar()).
 * @returns {Promise<{agotado: boolean, retryAt: Date|null}|null>}
 */
export async function estadoPresupuesto(userId, cfg = configPresupuesto()) {
  if (!cfg.ok || !userId) return null;
  try {
    return await withTenant(userId, async (client) => {
      if (esClienteRest(client)) return null;
      const e = await calcularEstado(client, userId, cfg);
      // "Agotado" = ya no cabe ni la llamada más pequeña razonable (1024 tokens de salida).
      const minimo = (1024 * cfg.precioOut) / 1_000_000;
      if (e.gastoMes + minimo > e.topes.mes) return { agotado: true, retryAt: e.finMes };
      if (e.gastoDia + minimo > e.topes.dia) return { agotado: true, retryAt: e.finDia };
      return { agotado: false, retryAt: null };
    });
  } catch {
    return null;
  }
}
