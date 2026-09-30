import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * expediente-financiador.spec.ts — Fase C (2026-09-30) contra el backend real,
 * SIN IA (determinista en CI):
 *   - GET devuelve los ejes de Entrada y SOLO las secciones que exigen.
 *   - 409 SECCION_NO_APLICA, 400 sección inválida, 404 proyecto ajeno.
 *   - 422 con la lista de faltantes ANTES de llamar a la IA (sin anexos).
 *   - La tarjeta de Viabilidad muestra el régimen, las secciones y el 422 legible.
 *   - Nada se escribe en project_expediente_financiador (migración 078).
 * Usa un proyecto TEMPORAL propio (no toca el proyecto compartido de la suite).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');
const leerEstado = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as { userId: string; token: string; proyectoId: string; email: string; password: string };
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

const ENTRADA_INTERNACIONAL = {
  nombre: 'E2E Expediente', enfoque: 'SOCIAL', tipoConvocatoria: 'Banca multilateral', nivelProyecto: 'Perfil',
  metodologias: ['Marco Lógico', 'Teoría del Cambio'], formatoFinanciador: 'ONU / BID / UE',
};

test.describe.serial('Expediente del Financiador (Viabilidad)', () => {
  let proyectoTemporal: string | null = null;

  test.afterAll(async () => {
    if (!proyectoTemporal) return;
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('DELETE FROM proyectos WHERE id = $1', [proyectoTemporal]);
    await db.end();
  });

  test('API: secciones según los ejes, 409/400/404, 422 sin gastar IA y nada escrito', async () => {
    const e = leerEstado();
    const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
    const creado = await api.post('/api/proyectos', { data: { nombre: 'E2E Expediente del Financiador' } });
    expect(creado.ok(), await creado.text()).toBeTruthy();
    const cuerpo = await creado.json();
    proyectoTemporal = cuerpo.id ?? cuerpo.proyectoId;
    const url = `/api/proyectos/${proyectoTemporal}/expediente`;

    // Sin ejes: solo la cadena de valor y el checklist jurídico aplican; régimen sin definir.
    let g = (await (await api.get(url)).json()).data;
    expect(g.directivas.esquema).toBe('sin_definir');
    expect(g.secciones.filter((s: { aplica: boolean }) => s.aplica).map((s: { id: string }) => s.id)).toEqual(['cadena_valor', 'checklist_juridico']);
    let r = await api.post(`${url}/teoria_cambio`, { data: {} });
    expect(r.status(), await r.text()).toBe(409);
    expect((await r.json()).code).toBe('SECCION_NO_APLICA');

    // Ejes de un financiador internacional con Teoría del Cambio.
    const merge = await api.patch(`/api/proyectos/${proyectoTemporal}/ficha-tecnica-merge`, { data: { key: 'entrada_completa', value: ENTRADA_INTERNACIONAL } });
    expect(merge.status(), await merge.text()).toBe(200);
    g = (await (await api.get(url)).json()).data;
    expect(g.directivas.esquema).toBe('internacional');
    expect(g.directivas.conflictos).toEqual([]);
    expect(g.secciones.filter((s: { aplica: boolean }) => s.aplica).map((s: { id: string }) => s.id)).toEqual(['marco_logico', 'teoria_cambio', 'cadena_valor', 'salvaguardas', 'checklist_juridico']);
    expect(g.secciones.every((s: { ultima: unknown }) => s.ultima === null)).toBe(true);

    // Sin anexos con texto: 422 con la lista exacta, sin llamar a la IA.
    r = await api.post(`${url}/checklist_juridico`, { data: {} });
    expect(r.status(), await r.text()).toBe(422);
    const j = await r.json();
    expect(j.code).toBe('DATOS_MINIMOS_INSUFICIENTES');
    expect(j.faltantes.map((f: { campo: string }) => f.campo)).toEqual(['anexos']);
    expect(j.message).toMatch(/sin gastar cuota de IA/);

    expect((await api.post(`${url}/inventada`, { data: {} })).status()).toBe(400);
    expect((await api.get('/api/proyectos/no-existe-e2e/expediente')).status()).toBe(404);
    expect((await api.post('/api/proyectos/no-existe-e2e/expediente/checklist_juridico', { data: {} })).status()).toBe(404);

    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const filas = await db.query('SELECT count(*)::int n FROM project_expediente_financiador WHERE project_id = $1', [proyectoTemporal]);
    await db.end();
    expect(filas.rows[0].n).toBe(0);
    await api.dispose();
  });

  test('UI: Viabilidad muestra el régimen, las secciones exigidas y el 422 legible', async ({ page }) => {
    const e = leerEstado();
    expect(proyectoTemporal).toBeTruthy();
    await page.goto('/login');
    await page.getByPlaceholder('operador@institucion.gov').fill(e.email);
    await page.getByPlaceholder('••••••••••••').fill(e.password);
    await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
    await expect(page).toHaveURL(/\/checklist/, { timeout: 15_000 });
    await page.evaluate(({ key, id }) => localStorage.setItem(key, id as string), { key: ACTIVE_PROJECT_KEY, id: proyectoTemporal });

    await page.goto('/viabilidad');
    const tarjeta = page.locator('.viab__card', { hasText: 'Expediente del Financiador' });
    await expect(tarjeta.getByText('Régimen internacional')).toBeVisible({ timeout: 15_000 });
    await expect(tarjeta.getByText('Teoría del Cambio — ruta causal')).toBeVisible();
    await expect(tarjeta.getByText('Salvaguardas ambientales y sociales')).toBeVisible();
    await expect(tarjeta.getByText(/No exigidas por los ejes elegidos: .*Plan MEL/)).toBeVisible();

    const checklist = tarjeta.getByTestId('expediente-checklist_juridico');
    await checklist.getByRole('button', { name: 'Generar sección' }).click();
    await expect(checklist.getByRole('alert')).toContainText('faltan datos del proyecto', { timeout: 15_000 });
    await page.screenshot({ path: 'test-results/expediente-financiador.png', fullPage: true });
  });
});
