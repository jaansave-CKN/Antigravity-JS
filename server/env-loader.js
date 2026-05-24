/**
 * server/env-loader.js
 * Carga .env en process.env para ESM (sin paquete externo requerido).
 */
import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

function loadEnv() {
  const here    = dirname(fileURLToPath(import.meta.url));
  const envFile = resolve(here, '..', '.env');
  try {
    const raw  = fs.readFileSync(envFile, 'utf-8');
    const lines = raw.split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i  = t.indexOf('=');
      if (i === -1) continue;
      const key   = t.slice(0, i).trim();
      const value = t.slice(i + 1).trim().replace(/^"|"$/g, '');
      console.log('[env] Setting:', key, '=', value ? '(loaded)' : '(empty)');
      if (!(key in process.env)) process.env[key] = value;
    }
    console.log('[env] .env cargado, envs count:', Object.keys(process.env).length);
    console.log('[env] DATABASE_URL present:', !!process.env.DATABASE_URL);
    console.log('[env] DATABASE_URL prefix:', (process.env.DATABASE_URL || '').substring(0, 15));
  } catch (e) {
    console.log('[env] .env no encontrado, usando variables del sistema');
  }
}

export { loadEnv };
