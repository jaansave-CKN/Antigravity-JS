import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * lote11-formulador-mga.spec.ts — Fase 3 (2026-09-26) contra el backend real:
 *   - 422 con la lista completa de faltantes ANTES de llamar a NVIDIA, sin
 *     escribir nada (tabla project_formulador_mga, migración 072).
 *   - 404 para un proyecto ajeno o inexistente (B6).
 *   - La sección "Redacción MGA consolidada" se ve en Exportación y muestra el
 *     422 legible; el PDF MGA se sigue generando.
 * En CI no hay NVIDIA_API_KEY: la ruta con IA real no se ejerce aquí (la
 * cubren las pruebas unitarias con NIM simulado).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');
const leerEstado = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as { userId: string; token: string; proyectoId: string; email: string; password: string };
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

test('API: 422 con todos los faltantes, 404 para proyecto ajeno, y nada escrito', async () => {
  const e = leerEstado();
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let vacio: string | null = null;
  try {
    const creado = await api.post('/api/proyectos', { data: { nombre: 'E2E Fase 3 — proyecto sin datos' } });
    expect(creado.ok(), await creado.text()).toBeTruthy();
    const cuerpo = await creado.json();
    vacio = cuerpo.id ?? cuerpo.proyectoId;

    const r = await api.post(`/api/proyectos/${vacio}/formulador-mga`, { data: {} });
    expect(r.status(), await r.text()).toBe(422);
    const j = await r.json();
    expect(j.code).toBe('DATOS_MINIMOS_INSUFICIENTES');
    expect(j.faltantes.map((f: { campo: string }) => f.campo)).toEqual(
      ['sectores', 'nivelProyecto', 'ubicacion', 'poblacion', 'viabilidad', 'mirofish', 'presupuesto', 'montecarlo']);
    expect(j.message).toMatch(/sin gastar cuota de IA/);

    const g = await (await api.get(`/api/proyectos/${vacio}/formulador-mga`)).json();
    expect(g.data).toEqual({ ultima_ok: null, ultimo_intento: null, desactualizada: false });

    expect((await api.post('/api/proyectos/no-existe-e2e/formulador-mga', { data: {} })).status()).toBe(404);
    expect((await api.get('/api/proyectos/no-existe-e2e/formulador-mga')).status()).toBe(404);

    const filas = await db.query('SELECT count(*)::int n FROM project_formulador_mga WHERE project_id = $1', [vacio]);
    expect(filas.rows[0].n).toBe(0);
  } finally {
    if (vacio) await db.query('DELETE FROM proyectos WHERE id = $1', [vacio]);
    await db.end();
    await api.dispose();
  }
});

test('UI: Exportación muestra la sección y el 422 legible; el PDF MGA se sigue generando', async ({ page }) => {
  const e = leerEstado();
  await page.goto('/login');
  await page.getByPlaceholder('operador@institucion.gov').fill(e.email);
  await page.getByPlaceholder('••••••••••••').fill(e.password);
  await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
  await expect(page).toHaveURL(/\/checklist/, { timeout: 15_000 });
  await page.evaluate(({ key, id }) => localStorage.setItem(key, id), { key: ACTIVE_PROJECT_KEY, id: e.proyectoId });

  await page.goto('/exportacion');
  const panel = page.getByTestId('formulador-mga');
  await expect(panel.getByText('Redacción MGA consolidada (IA)')).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: /consolidar con ia/i }).click();
  // En este punto de la suite el proyecto compartido aún no tiene viabilidad,
  // MIROFISH ni Montecarlo: la verificación previa responde 422 sin llamar a NVIDIA.
  await expect(panel.getByRole('alert')).toContainText('faltan datos del proyecto', { timeout: 15_000 });
  await page.screenshot({ path: 'test-results/lote11-formulador-mga.png', fullPage: true });

  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
  const pdf = await api.get(`/api/proyectos/${e.proyectoId}/exportar/mga`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  await api.dispose();
});
