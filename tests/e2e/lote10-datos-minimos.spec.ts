import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * lote10-datos-minimos.spec.ts — Lote 10 (2026-09-25) contra el backend real:
 * MIROFISH y Viabilidad IA responden 422 con la lista exacta de faltantes
 * cuando el proyecto no tiene los datos mínimos — ANTES de llamar a Gemini
 * y sin escribir nada. Usa un proyecto vacío propio que se borra al final
 * (el proyecto compartido de la suite no se toca).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');
const leerEstado = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as { userId: string; token: string; proyectoId: string; email: string; password: string };
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

async function iniciarSesion(page: import('@playwright/test').Page, e: ReturnType<typeof leerEstado>) {
  await page.goto('/login');
  await page.getByPlaceholder('operador@institucion.gov').fill(e.email);
  await page.getByPlaceholder('••••••••••••').fill(e.password);
  await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
  await expect(page).toHaveURL(/\/checklist/, { timeout: 15_000 });
  await page.evaluate(({ key, id }) => localStorage.setItem(key, id), { key: ACTIVE_PROJECT_KEY, id: e.proyectoId });
}

test('autoguardado Dialéctica: 3 clics seguidos + salir antes de 1,5 s → el ÚLTIMO valor llega al servidor', async ({ page }) => {
  const e = leerEstado();
  await iniciarSesion(page, e);
  const posts: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes(`/api/m4/config/${e.proyectoId}`)) posts.push(r.postData() || ''); });

  const hidratada = page.waitForResponse(r => r.url().includes(`/api/m4/config/${e.proyectoId}`) && r.request().method() === 'GET');
  await page.goto('/dialectica');
  await hidratada;
  await page.getByRole('button', { name: 'Diplomatico', exact: true }).click();
  await page.getByRole('button', { name: 'Tecnico', exact: true }).click();
  await page.getByRole('button', { name: 'Ejecutivo', exact: true }).click();
  // Navegación DENTRO de la SPA (como un clic del menú) antes de la espera de
  // 1,5 s: desmonta DialecticaPage. page.goto sería una recarga completa, donde
  // React no ejecuta el desmontaje (ese caso queda fuera de alcance del hook).
  await page.evaluate(() => { window.history.pushState({}, '', '/viabilidad'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page).toHaveURL(/\/viabilidad$/);

  const api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
  await expect.poll(async () => (await (await api.get(`/api/m4/config/${e.proyectoId}`)).json()).data?.tono, { timeout: 10_000 }).toBe('Ejecutivo');
  await api.dispose();
  expect(posts.length, 'los 3 clics se agrupan en un solo envío').toBe(1);
  expect(JSON.parse(posts[0]).tono).toBe('Ejecutivo');
});

test('autoguardado Entrada: escribir el pitch lo sube al servidor sin pulsar SAVE', async ({ page }) => {
  const e = leerEstado();
  await iniciarSesion(page, e);
  const hidratada = page.waitForResponse(r => r.url().endsWith(`/api/proyectos/${e.proyectoId}`) && r.request().method() === 'GET');
  await page.goto('/entrada');
  await hidratada;
  const pitch = `Pitch E2E lote 10 ${Date.now()}`;
  await page.getByPlaceholder('Escriba el pitch del proyecto...').fill(pitch);

  const api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
  await expect.poll(async () => (await (await api.get(`/api/proyectos/${e.proyectoId}`)).json()).data?.ficha_tecnica?.entrada_completa?.pitch, { timeout: 10_000 }).toBe(pitch);
  await api.dispose();
});

test('422 DATOS_MINIMOS_INSUFICIENTES en MIROFISH y Viabilidad, sin escribir nada', async () => {
  const e = leerEstado();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  // Este archivo corre antes que lote3 (orden alfabético): el usuario E2E aún
  // no es exento y byokGate respondería 428 antes de llegar a la verificación.
  await db.query('UPDATE usuarios SET byok_exento = true WHERE id = $1', [e.userId]);
  const api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
  let proyectoVacio: string | null = null;
  try {
    const creado = await api.post('/api/proyectos', { data: { nombre: 'E2E Lote 10 — proyecto sin datos' } });
    expect(creado.ok(), await creado.text()).toBeTruthy();
    const cuerpo = await creado.json();
    proyectoVacio = cuerpo.id ?? cuerpo.proyectoId;
    expect(proyectoVacio).toBeTruthy();

    const m = await api.post(`/api/proyectos/${proyectoVacio}/mirofish`, { data: {} });
    expect(m.status(), await m.text()).toBe(422);
    const mj = await m.json();
    expect(mj.code).toBe('DATOS_MINIMOS_INSUFICIENTES');
    expect(mj.faltantes.map((f: { campo: string }) => f.campo)).toEqual(['ubicacion', 'presupuesto']);
    expect(mj.message).toMatch(/sin gastar cuota de IA/);

    const v = await api.post(`/api/proyectos/${proyectoVacio}/viabilidad-ia`, { data: {} });
    expect(v.status(), await v.text()).toBe(422);
    const vj = await v.json();
    expect(vj.code).toBe('DATOS_MINIMOS_INSUFICIENTES');
    expect(vj.faltantes.map((f: { campo: string }) => f.campo)).toEqual(['problema', 'alcance']);

    // Nada escrito: ni evaluación MIROFISH ni dictamen en ficha_tecnica.
    const evals = await db.query('SELECT count(*)::int n FROM project_mirofish_evaluaciones WHERE project_id = $1', [proyectoVacio]);
    expect(evals.rows[0].n).toBe(0);
    const ficha = await db.query("SELECT COALESCE(ficha_tecnica ? 'viabilidad_ia', false) AS tiene FROM proyectos WHERE id = $1", [proyectoVacio]);
    expect(ficha.rows[0].tiene).toBe(false);
  } finally {
    if (proyectoVacio) await db.query('DELETE FROM proyectos WHERE id = $1', [proyectoVacio]);
    await db.end();
    await api.dispose();
  }
});
