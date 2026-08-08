import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * global-teardown.ts — borra el usuario/proyecto E2E creados en
 * global-setup.ts. Este Postgres es compartido con otros proyectos hermanos
 * (ver docs/ARQUITECTURA_RADFOR360_2026-08-08.md §11) — dejar basura de test
 * acumulándose ahí en cada corrida de CI no es aceptable a mediano plazo.
 */
const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');

export default async function globalTeardown() {
  if (!fs.existsSync(STATE_FILE)) return;
  const { userId, proyectoId } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  if (!process.env.DATABASE_URL || !userId) return;

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Hijos primero — sin asumir ON DELETE CASCADE en las FKs de project_id.
    if (proyectoId) {
      await client.query('DELETE FROM project_apu_lineas WHERE project_id = $1', [proyectoId]).catch(() => {});
      await client.query('DELETE FROM project_anexos WHERE project_id = $1', [proyectoId]).catch(() => {});
      await client.query('DELETE FROM project_hallazgos WHERE project_id = $1', [proyectoId]).catch(() => {});
      await client.query('DELETE FROM proyectos WHERE id = $1', [proyectoId]);
    }
    await client.query('DELETE FROM user_subscriptions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM usuarios WHERE id = $1', [userId]);
  } catch (e) {
    console.warn('[e2e teardown] No se pudo limpiar completamente:', (e as Error).message);
  } finally {
    await client.end();
    fs.rmSync(STATE_FILE, { force: true });
  }
}
