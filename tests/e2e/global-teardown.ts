import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
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
      // Archivos del bucket ANTES de borrar las filas (después ya no habría
      // forma de saber qué rutas subió la suite). Sin esto cada corrida de CI
      // dejaba el Excel de prueba huérfano en el Storage de producción.
      const { rows } = await client.query('SELECT ruta_storage FROM project_anexos WHERE project_id = $1 AND ruta_storage IS NOT NULL', [proyectoId]).catch(() => ({ rows: [] as Array<{ ruta_storage: string }> }));
      const rutas = rows.map(r => r.ruta_storage).filter(Boolean);
      const sbUrl = process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_STORAGE_KEY || process.env.SUPABASE_SERVICE_KEY;
      if (rutas.length && sbUrl && sbKey) {
        const storage = createClient(sbUrl, sbKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
        const { error } = await storage.from('anexos').remove(rutas);
        if (error) console.warn('[e2e teardown] No se pudieron borrar archivos del bucket:', error.message);
      }
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
