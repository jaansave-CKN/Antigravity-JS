/**
 * S3 Backup — copia de seguridad diaria a AWS S3
 * Requiere: @aws-sdk/client-s3 + variables de entorno AWS_*
 * Se activa automáticamente desde CronScheduler si el SDK está disponible.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, '..', 'radar.db');

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION       = 'us-east-1',
  AWS_S3_BUCKET,
  DATABASE_URL,
} = process.env;

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Ejecuta backup:
 *  - Si PostgreSQL: usa pg_dump (requiere psql tools en PATH)
 *  - Si SQLite: copia el archivo radar.db
 * Luego sube el archivo a S3.
 */
export async function runS3Backup() {
  if (!AWS_S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.log('[S3Backup] Variables AWS no configuradas — backup omitido');
    return { skipped: true, reason: 'AWS_S3_BUCKET / AWS credentials not set' };
  }

  let S3Client, PutObjectCommand;
  try {
    const sdk = await import('@aws-sdk/client-s3');
    S3Client        = sdk.S3Client;
    PutObjectCommand = sdk.PutObjectCommand;
  } catch {
    console.log('[S3Backup] @aws-sdk/client-s3 no instalado — backup omitido');
    return { skipped: true, reason: '@aws-sdk/client-s3 not installed' };
  }

  const client = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId:     AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });

  const timestamp = ts();
  let body, key, contentType;

  if (DATABASE_URL) {
    // PostgreSQL: dump usando pg_dump (debe estar en PATH)
    const { execSync } = await import('child_process');
    const dumpPath = path.join('/tmp', `radar_pg_${timestamp}.sql`);
    try {
      execSync(`pg_dump "${DATABASE_URL}" -f "${dumpPath}"`, { stdio: 'pipe' });
      body        = fs.readFileSync(dumpPath);
      key         = `backups/postgres/radar_${timestamp}.sql`;
      contentType = 'text/plain';
      fs.unlinkSync(dumpPath);
    } catch (e) {
      console.error('[S3Backup] pg_dump falló:', e.message);
      return { error: e.message };
    }
  } else {
    // SQLite: copia directa del archivo
    if (!fs.existsSync(DB_PATH)) {
      console.log('[S3Backup] radar.db no encontrado — backup omitido');
      return { skipped: true, reason: 'radar.db not found' };
    }
    body        = fs.readFileSync(DB_PATH);
    key         = `backups/sqlite/radar_${timestamp}.db`;
    contentType = 'application/octet-stream';
  }

  await client.send(new PutObjectCommand({
    Bucket:      AWS_S3_BUCKET,
    Key:         key,
    Body:        body,
    ContentType: contentType,
    // Retención: el bucket debe tener lifecycle policy de 30 días configurado en AWS Console
    Metadata: {
      'backup-date': timestamp,
      'app-version': '8.0',
      'source': DATABASE_URL ? 'postgresql' : 'sqlite',
    },
  }));

  console.log(`[S3Backup] ✓ Backup subido: s3://${AWS_S3_BUCKET}/${key}`);
  return { success: true, key, timestamp };
}
