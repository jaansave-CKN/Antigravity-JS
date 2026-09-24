/**
 * S3 Backup — copia de seguridad de la BD a AWS S3.
 * Requiere: @aws-sdk/client-s3 + variables de entorno AWS_* + pg_dump >= versión
 * del servidor (producción: PostgreSQL 17.6).
 *
 * LOTE 5 T3 (2026-09-24) — falso verde corregido. Antes el job de CI salía en
 * verde aunque: (a) faltaran las credenciales AWS ({skipped}), (b) pg_dump
 * fallara ({error}), (c) el pg_dump del runner fuera de una versión menor que
 * el servidor (se niega a volcar) o (d) la URL fuera la del pooler en modo
 * transacción (:6543, incompatible con pg_dump). Ahora:
 *  - TODA salida lleva `success` (aditivo: skipped/reason/error/key siguen);
 *    el workflow sale con código 1 si success !== true.
 *  - pg_dump corre con spawn asíncrono y argumentos en array; la contraseña
 *    viaja por PGPASSWORD, NUNCA en la línea de comandos (fiscalización
 *    architect T3-B1: con execSync la URL completa quedaba en e.message y, al
 *    reescribir el puerto, GitHub ya no la enmascaraba — repo público).
 *  - validarVolcado(): tamaño mínimo, cabecera, pie "dump complete" (detecta
 *    volcados truncados), CREATE TABLE y un mínimo de filas en usuarios.
 *  - Subida con cifrado AES256 + ContentMD5 (S3 rechaza bytes corruptos) y
 *    verificación ETag == MD5 (con SSE-S3 y PutObject simple coinciden).
 *  - BACKUP_DRY_RUN=1: vuelca y valida sin subir (verificación en CI).
 *
 * RESTAURAR (volcado --schema=public): antes de aplicar el .sql, crear el rol
 * rf360_rls_scoped y las extensiones vector y unaccent en el esquema public
 * (mismo orden que .github/workflows/playwright.yml). Los ARCHIVOS de Storage
 * (anexos/biblioteca) no están en la BD: no forman parte de este respaldo.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { logCriticalError } from '../services/logService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, '..', 'radar.db');

export const TAMANO_MINIMO_BYTES = 10 * 1024;

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Separa credenciales de la URL y, si es el pooler de Supabase en modo
 * transacción (:6543), la pasa a modo sesión (:5432). Cualquier otra URL
 * (p. ej. la réplica local de CI, :54322) queda intacta.
 * @returns {{ url: string, password: string }} url SIN contraseña
 */
export function urlParaPgDump(databaseUrl) {
  const u = new URL(databaseUrl);
  if (u.hostname.endsWith('.pooler.supabase.com') && u.port === '6543') u.port = '5432';
  const password = decodeURIComponent(u.password || '');
  u.password = '';
  return { url: u.toString(), password };
}

/** Quita credenciales de cualquier texto antes de loguearlo. */
export function sanitizar(texto, secretos = []) {
  let t = String(texto ?? '');
  for (const s of secretos.filter(Boolean)) t = t.split(s).join('***');
  return t.replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^@\s]+@/gi, '$1:***@');
}

/**
 * Valida que un volcado de pg_dump (texto plano) sea completo y real.
 * @returns {{ ok: boolean, motivo?: string, filasUsuarios?: number }}
 */
export function validarVolcado(texto, { minFilasUsuarios = 1, tamanoMinimo = TAMANO_MINIMO_BYTES } = {}) {
  const bytes = Buffer.byteLength(texto || '', 'utf8');
  if (bytes < tamanoMinimo) return { ok: false, motivo: `volcado demasiado pequeño (${bytes} bytes < ${tamanoMinimo})` };
  if (!texto.includes('-- PostgreSQL database dump')) return { ok: false, motivo: 'falta la cabecera de pg_dump' };
  if (!texto.includes('-- PostgreSQL database dump complete')) return { ok: false, motivo: 'volcado truncado (falta el pie "dump complete")' };
  if (!/^CREATE TABLE /m.test(texto)) return { ok: false, motivo: 'el volcado no contiene ninguna tabla' };
  // Filas de datos de usuarios: líneas entre "COPY public.usuarios ..." y "\.".
  const m = texto.match(/^COPY public\.usuarios \([^)]*\) FROM stdin;\n([\s\S]*?)^\\\.$/m);
  const filasUsuarios = m ? m[1].split('\n').filter(Boolean).length : 0;
  if (filasUsuarios < minFilasUsuarios) {
    return { ok: false, motivo: `usuarios con ${filasUsuarios} fila(s) (< ${minFilasUsuarios}): el volcado no trae datos reales`, filasUsuarios };
  }
  return { ok: true, filasUsuarios };
}

function ejecutarPgDump(databaseUrl, destino) {
  const { url, password } = urlParaPgDump(databaseUrl);
  const bin = process.env.PG_DUMP_BIN || 'pg_dump';
  return new Promise((resolve, reject) => {
    const hijo = spawn(bin, ['--schema=public', '--no-owner', '--file', destino, '--dbname', url], {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    hijo.stderr.on('data', d => { stderr += d; });
    hijo.on('error', e => reject(new Error(`no se pudo ejecutar ${bin}: ${e.message}`)));
    hijo.on('close', code => (code === 0 ? resolve() : reject(new Error(`pg_dump salió con código ${code}: ${stderr.slice(0, 600)}`))));
  });
}

async function fallo(resultado, secretos) {
  const limpio = { ...resultado, error: resultado.error ? sanitizar(resultado.error, secretos) : undefined };
  await logCriticalError('S3Backup', `Backup falló — ${limpio.error || limpio.reason}`, limpio).catch(() => {});
  console.error('[S3Backup] ✗', limpio.error || limpio.reason);
  return { success: false, ...limpio };
}

export async function runS3Backup({ dryRun = process.env.BACKUP_DRY_RUN === '1' } = {}) {
  const {
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION = 'us-east-1', AWS_S3_BUCKET, DATABASE_URL,
  } = process.env;
  const secretos = [AWS_SECRET_ACCESS_KEY, DATABASE_URL ? decodeURIComponent(new URL(DATABASE_URL).password || '') : ''];
  const minFilasUsuarios = Number.parseInt(process.env.BACKUP_MIN_FILAS_USUARIOS ?? '1', 10);

  if (!dryRun && (!AWS_S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY)) {
    // FIX (DIRECTIVA REMEDIACIÓN TOTAL, 2026-09-06): el skip deja alerta
    // persistida en system_logs. Lote 5: y además success=false → CI en rojo.
    return fallo({ skipped: true, reason: 'AWS_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY no configuradas' }, secretos);
  }

  const timestamp = ts();
  let body, key, contentType, detalle = {};

  if (DATABASE_URL) {
    const dumpPath = path.join(os.tmpdir(), `radar_pg_${timestamp}.sql`);
    try {
      await ejecutarPgDump(DATABASE_URL, dumpPath);
      const texto = fs.readFileSync(dumpPath, 'utf8');
      const v = validarVolcado(texto, { minFilasUsuarios });
      if (!v.ok) return fallo({ error: `volcado inválido: ${v.motivo}` }, secretos);
      body = zlib.gzipSync(Buffer.from(texto, 'utf8'));
      key = `backups/postgres/radar_${timestamp}.sql.gz`;
      contentType = 'application/gzip';
      detalle = { bytes_sql: Buffer.byteLength(texto, 'utf8'), bytes_gzip: body.length, filas_usuarios: v.filasUsuarios };
    } catch (e) {
      return fallo({ error: `pg_dump falló: ${e.message}` }, secretos);
    } finally {
      fs.rmSync(dumpPath, { force: true });
    }
  } else {
    // SQLite (heredado): copia directa del archivo.
    if (!fs.existsSync(DB_PATH)) return fallo({ skipped: true, reason: 'radar.db not found' }, secretos);
    body        = fs.readFileSync(DB_PATH);
    key         = `backups/sqlite/radar_${timestamp}.db`;
    contentType = 'application/octet-stream';
  }

  if (dryRun) {
    console.log('[S3Backup] DRY-RUN ✓ volcado válido (no se sube):', JSON.stringify(detalle));
    return { success: true, dryRun: true, ...detalle };
  }

  let S3Client, PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3'));
  } catch {
    return fallo({ skipped: true, reason: '@aws-sdk/client-s3 not installed' }, secretos);
  }

  const md5 = crypto.createHash('md5').update(body);
  const md5Hex = md5.copy().digest('hex');
  const md5B64 = md5.digest('base64');
  try {
    const client = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } });
    const r = await client.send(new PutObjectCommand({
      Bucket: AWS_S3_BUCKET, Key: key, Body: body, ContentType: contentType,
      ContentMD5: md5B64,             // S3 rechaza la subida (BadDigest) si los bytes llegan distintos
      ServerSideEncryption: 'AES256', // exigido también por la política IAM (docs/infra/iam-politica-backup-s3.json)
      // Retención: el bucket debe tener lifecycle policy de 30 días configurado en AWS Console
      Metadata: { 'backup-date': timestamp, 'app-version': '8.0', 'source': DATABASE_URL ? 'postgresql' : 'sqlite' },
    }));
    const etag = String(r.ETag || '').replace(/"/g, '');
    if (etag !== md5Hex) return fallo({ error: `verificación fallida: ETag ${etag || '(vacío)'} ≠ MD5 ${md5Hex}`, key }, secretos);
  } catch (e) {
    return fallo({ error: `subida a S3 falló: ${e.name}: ${e.message}`, key }, secretos);
  }

  console.log(`[S3Backup] ✓ Backup subido y verificado: s3://${AWS_S3_BUCKET}/${key}`, JSON.stringify(detalle));
  return { success: true, key, timestamp, ...detalle };
}
