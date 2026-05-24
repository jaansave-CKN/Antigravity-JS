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
      if (!(key in process.env)) process.env[key] = value;
    }
    console.log('[env] .env cargado');
  } catch {
    console.log('[env] .env no encontrado, usando variables del sistema');
  }
}

export { loadEnv };
