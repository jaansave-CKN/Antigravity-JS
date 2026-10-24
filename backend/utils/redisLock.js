/**
 * redisLock.js — lock distribuido sobre Upstash Redis (API REST).
 *
 * POR QUÉ EXISTE
 * --------------
 * Los 4 trabajos programados (CronScheduler.js) viven DENTRO del proceso web.
 * Con una sola instancia eso funciona; con dos, cada réplica corre su propio
 * cron a la misma hora y el resultado es: dos rastreos simultáneos sobre las
 * mismas fuentes (riesgo de bloqueo por el sitio origen), convocatorias
 * duplicadas y el costo de embeddings multiplicado por el número de réplicas.
 * Es uno de los dos bloqueos de escalado horizontal del diagnóstico técnico.
 *
 * POR QUÉ REDIS Y NO UN ADVISORY LOCK DE POSTGRES
 * -----------------------------------------------
 * `DATABASE_URL` apunta al pooler de Supabase en modo TRANSACCIÓN (:6543). Ahí
 * un `pg_advisory_lock` de SESIÓN no sirve: la conexión vuelve al pool y el
 * lock se pierde o queda colgado en una sesión ajena (regla ya documentada en
 * este repo: nunca SET ni locks de sesión sobre el pooler). La variante de
 * transacción (`pg_advisory_xact_lock`) solo dura mientras la transacción esté
 * abierta, y estos trabajos corren hasta 60 minutos: mantener una transacción
 * abierta una hora es inaceptable.
 *
 * Redis resuelve exactamente esto con `SET key val NX EX ttl`, que es atómico.
 * UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN ya existen en el entorno de
 * producción (verificado 2026-10-24 en la lista real de variables de Render),
 * pero NINGÚN archivo del proyecto los usaba — era configuración provisionada
 * y muerta. Este módulo le da su primer uso real.
 *
 * DEGRADACIÓN: SIN Redis configurado, `adquirirLock()` devuelve null y el
 * llamador decide. Los crons tratan null como "corre igual", que es el
 * comportamiento actual con una sola instancia — nunca peor que hoy. Fallar
 * cerrado aquí dejaría el catálogo sin actualizarse por un hipo de Redis, y
 * los duplicados ya están acotados por el índice único de deduplicación
 * (migración 076).
 *
 * Sin dependencias nuevas: Upstash expone una API REST y se usa fetch global.
 */
import { logger } from './logger.js';

const TIMEOUT_MS = 8_000;
const PREFIJO = 'radfor360:lock:';

function configuracion() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}

/** true si hay un Redis configurado para locks distribuidos. */
export function lockDisponible() {
  return configuracion() !== null;
}

/** Ejecuta un comando de Redis por la API REST de Upstash. Devuelve `result` o lanza. */
async function comando(args) {
  const cfg = configuracion();
  if (!cfg) throw new Error('Redis no configurado');
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(String(data.error).slice(0, 200));
  return data?.result ?? null;
}

/**
 * Intenta tomar el lock `nombre` por `ttlSegundos`.
 * @returns {Promise<true|false|null>} true = lo tomé y debo ejecutar;
 *   false = otra instancia lo tiene, debo saltar; null = sin Redis (el
 *   llamador decide; los crons ejecutan, igual que hoy).
 *
 * El TTL es obligatorio y actúa como red de seguridad: si la instancia que
 * tiene el lock muere a mitad del trabajo, el lock expira solo y la próxima
 * corrida no queda bloqueada para siempre. Por eso el TTL debe ser MAYOR que
 * la duración máxima esperada del trabajo.
 */
export async function adquirirLock(nombre, ttlSegundos) {
  if (!configuracion()) return null;
  const clave = PREFIJO + nombre;
  const dueño = `${process.env.RENDER_INSTANCE_ID || process.pid}@${Date.now()}`;
  try {
    const r = await comando(['SET', clave, dueño, 'NX', 'EX', String(ttlSegundos)]);
    if (r === 'OK') return true;
    logger.info?.('[lock] Otra instancia ya tiene el lock — este trabajo se salta', { nombre });
    return false;
  } catch (err) {
    // Un fallo de Redis no debe impedir que el catálogo se actualice.
    logger.warn('[lock] No se pudo consultar Redis — el trabajo corre sin lock', { nombre, err: err.message });
    return null;
  }
}

/** Libera el lock al terminar, para que un reintento manual no tenga que esperar el TTL. */
export async function liberarLock(nombre) {
  if (!configuracion()) return;
  try { await comando(['DEL', PREFIJO + nombre]); }
  catch (err) { logger.warn('[lock] No se pudo liberar el lock (expirará por TTL)', { nombre, err: err.message }); }
}

/**
 * Envuelve el cuerpo de un trabajo programado: lo ejecuta solo si esta
 * instancia gana el lock (o si no hay Redis configurado).
 */
export async function conLockDeTrabajo(nombre, ttlSegundos, fn) {
  const tengo = await adquirirLock(nombre, ttlSegundos);
  if (tengo === false) {
    console.log(`[Cron] ⊘ ${nombre} omitido — otra instancia lo está ejecutando.`);
    return { omitido: true };
  }
  if (tengo === null && !lockDisponible()) {
    console.log(`[Cron] ⚠ ${nombre} corre SIN lock distribuido (Upstash no configurado). Con más de una instancia se duplicaría.`);
  }
  try {
    return await fn();
  } finally {
    if (tengo === true) await liberarLock(nombre);
  }
}
