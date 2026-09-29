import { test, expect, request as pwRequest, type Page, type Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * busqueda-semantica-puente.spec.ts — OMEGA-7 (2026-09-29).
 *   API real: /api/radar/busqueda-semantica/estado, validación de
 *   /api/radar/buscar-masivo y /api/bridge/transfer (404 real y, si el
 *   catálogo tiene convocatorias, 200 real con redirect_to /checklist).
 *   UI (/busqueda-semantica y tarjeta del Radar): cada estado del banner
 *   único (200, vacío, 503 catálogo, 503 IA, 429 con retryAt) y el modal del
 *   Puente (403 plan, 404, éxito → /checklist). En CI no hay catálogo ni
 *   llaves de IA: esas respuestas se simulan con page.route; la navegación,
 *   el modal y el guardado del proyecto activo son reales.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');
const leerEstado = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as { userId: string; token: string; proyectoId: string; email: string; password: string };
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

const RESULTADO = {
  id: 'e2e-conv-1', titulo: 'Fondo del Agua para comunidades rurales 2026', donante: 'BID',
  descripcion: 'Financiamiento para acueductos veredales con enfoque de género.',
  monto_min: 50000, monto_max: 250000, moneda: 'USD', url_convocatoria: 'https://ejemplo.org/fondo-agua',
  fecha_limite: '2099-12-15', estado: 'abierta', similitud: 0.82,
};
const COBERTURA = { total: 612, con: 612 };
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe.serial('Búsqueda semántica y Puente Radar → Formulador', () => {
  let page: Page;
  const proyectosCreados: string[] = [];
  let accesoRadarOriginal: number | null = null;

  test.beforeAll(async ({ browser }) => {
    const e = leerEstado();
    // La pantalla está detrás de requireAccess('radar'): el usuario E2E nace
    // solo con access_formulador (global-setup). Solo su propia fila.
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    // Se restaura en afterAll: los specs siguientes comparten este usuario y
    // esperan aterrizar en /checklist (sin plan Radar) tras el login.
    accesoRadarOriginal = (await db.query('SELECT access_radar FROM user_subscriptions WHERE user_id = $1', [e.userId])).rows[0]?.access_radar ?? null;
    await db.query('UPDATE user_subscriptions SET access_radar = 1 WHERE user_id = $1', [e.userId]);
    await db.end();
    page = await (await browser.newContext()).newPage();
    await page.goto('/login');
    await page.getByPlaceholder('operador@institucion.gov').fill(e.email);
    await page.getByPlaceholder('••••••••••••').fill(e.password);
    await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
    // Con access_radar el inicio es "/" (Radar); sin él, /checklist.
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15_000 });
  });

  test.afterAll(async () => {
    await page?.context().close();
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('UPDATE user_subscriptions SET access_radar = $2 WHERE user_id = $1', [leerEstado().userId, accesoRadarOriginal]);
    if (proyectosCreados.length) await db.query('DELETE FROM proyectos WHERE id::text = ANY($1::text[])', [proyectosCreados]);
    await db.end();
  });

  test('API real: estado protegido, validación y Puente (404 y 200)', async () => {
    const e = leerEstado();
    const anon = await pwRequest.newContext({ baseURL: BASE });
    expect((await anon.get('/api/radar/busqueda-semantica/estado')).status()).toBe(401);
    await anon.dispose();

    const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
    const est = await api.get('/api/radar/busqueda-semantica/estado');
    expect(est.status(), await est.text()).toBe(200);
    const cob = (await est.json()).data.cobertura;
    expect(Number.isInteger(cob.total) && Number.isInteger(cob.con) && cob.con <= cob.total).toBeTruthy();

    // Texto vacío → 400 del esquema, sin gastar embedding.
    expect((await api.post('/api/radar/buscar-masivo', { data: { texto: '   ' } })).status()).toBe(400);

    const no = await api.post('/api/bridge/transfer', { data: { convocatoria_id: 'e2e-no-existe-omega7' } });
    expect(no.status(), await no.text()).toBe(404);
    expect((await no.json()).code).toBe('CONVOCATORIA_NO_ENCONTRADA');

    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const { rows } = await db.query(`SELECT id FROM convocatorias WHERE deleted_at IS NULL AND estado != 'cerrada' LIMIT 1`);
    await db.end();
    if (rows.length) {
      const ok = await api.post('/api/bridge/transfer', { data: { convocatoria_id: rows[0].id } });
      expect(ok.status(), await ok.text()).toBe(200);
      const d = (await ok.json()).data;
      proyectosCreados.push(d.proyecto_id);
      expect(d.redirect_to).toBe('/checklist');
      expect(d.convocatoria_id).toBe(rows[0].id);
      expect(d.nombre).toBeTruthy();
    }
    await api.dispose();
  });

  test('UI: estados de la búsqueda (200, vacío, 503 catálogo, 503 IA, 429 con retryAt)', async () => {
    await page.route('**/api/radar/busqueda-semantica/estado', r => json(r, 200, { success: true, data: { cobertura: COBERTURA } }));
    const respuestas: Array<[number, unknown]> = [
      [200, { success: true, resultados: [RESULTADO], total: 1, motor: 'pgvector', cobertura: COBERTURA }],
      [200, { success: true, resultados: [], total: 0, motor: 'pgvector', cobertura: COBERTURA }],
      [503, { success: false, code: 'CATALOGO_SIN_EMBEDDINGS', message: 'x', cobertura: { total: 612, con: 0 } }],
      [503, { success: false, code: 'IA_NO_DISPONIBLE', message: 'x' }],
      [429, { success: false, error: 'Límite de IA alcanzado', retryAt: new Date(Date.now() + 30 * 60_000).toISOString() }],
    ];
    const cuerpos: unknown[] = [];
    await page.route('**/api/radar/buscar-masivo', r => { cuerpos.push(r.request().postDataJSON()); const [s, b] = respuestas.shift()!; return json(r, s, b); });

    await page.goto('/busqueda-semantica');
    await expect(page.getByTestId('cobertura')).toContainText('612 de 612 convocatorias abiertas indexadas', { timeout: 15_000 });
    const caja = page.getByPlaceholder('Ej.: acueducto veredal con enfoque de género en el Cauca…');
    const buscar = page.getByRole('button', { name: 'Buscar convocatorias' });
    await caja.fill('acueducto veredal con enfoque de género');

    await buscar.click();
    const res = page.getByRole('region', { name: 'Resultados' });
    await expect(res.getByText('1 convocatoria afín')).toBeVisible();
    await expect(res.getByText(RESULTADO.titulo)).toBeVisible();
    await expect(res.getByText('82%')).toBeVisible();
    expect(cuerpos[0]).toEqual({ texto: 'acueducto veredal con enfoque de género', limit: 25, threshold: 0.25 });

    await buscar.click();
    await expect(page.getByText('Ninguna convocatoria abierta supera la afinidad mínima.')).toBeVisible();

    await buscar.click();
    await expect(page.getByRole('status').filter({ hasText: 'El catálogo se está indexando.' })).toBeVisible();

    await buscar.click();
    const alerta = page.getByRole('alert');
    await expect(alerta).toContainText('Servicio de IA no disponible temporalmente.');
    await expect(alerta.getByRole('button', { name: 'Reintentar' })).toBeVisible();

    await buscar.click();
    await expect(page.getByRole('alert')).toContainText('Alcanzaste el límite de consultas de IA por ahora.');
    await expect(page.getByRole('alert')).toContainText(/\d\d:\d\d — se restablece a las \d\d:\d\d:\d\d/);
    await page.unrouteAll({ behavior: 'wait' });
  });

  test('UI: Puente desde la búsqueda — 403 plan, 404 y éxito con redirección a /checklist', async () => {
    await page.route('**/api/radar/busqueda-semantica/estado', r => json(r, 200, { success: true, data: { cobertura: COBERTURA } }));
    await page.route('**/api/radar/buscar-masivo', r => json(r, 200, { success: true, resultados: [RESULTADO], total: 1, motor: 'pgvector', cobertura: COBERTURA }));
    const puente: Array<[number, unknown]> = [
      [403, { success: false, code: 'NO_ACCESS_FORMULADOR', message: 'Activa el plan Formulador', upgrade_required: true, redirect_to: '/planes' }],
      [404, { success: false, code: 'CONVOCATORIA_NO_ENCONTRADA', message: 'x' }],
      [200, { success: true, data: { proyecto_id: 'e2e-proy-omega7', nombre: `Formulación: ${RESULTADO.titulo}`, convocatoria_id: RESULTADO.id, redirect_to: '/checklist' } }],
    ];
    const enviados: unknown[] = [];
    await page.route('**/api/bridge/transfer', r => { enviados.push(r.request().postDataJSON()); const [s, b] = puente.shift()!; return json(r, s, b); });

    await page.goto('/busqueda-semantica');
    await page.getByPlaceholder('Ej.: acueducto veredal con enfoque de género en el Cauca…').fill('acueducto veredal');
    await page.getByRole('button', { name: 'Buscar convocatorias' }).click();
    const abrir = () => page.getByRole('region', { name: 'Resultados' }).getByRole('button', { name: 'Formular esta convocatoria' }).click();
    const dialogo = page.getByRole('dialog');

    await abrir();
    await expect(dialogo).toContainText(RESULTADO.titulo);
    await dialogo.getByRole('button', { name: 'Crear proyecto y continuar' }).click();
    await expect(dialogo.getByRole('alert')).toContainText('Esta función requiere el plan Formulador o Suite.');
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).toHaveCount(0);

    await abrir();
    await dialogo.getByRole('button', { name: 'Crear proyecto y continuar' }).click();
    await expect(dialogo).toContainText('Esta convocatoria ya no está en el catálogo');
    await page.keyboard.press('Escape');
    await expect(dialogo).toHaveCount(0);

    await abrir();
    await dialogo.getByRole('button', { name: 'Crear proyecto y continuar' }).click();
    await expect(dialogo.getByText('✓ Proyecto creado')).toBeVisible();
    await expect(page).toHaveURL(/\/checklist$/, { timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('rf360_proyecto_activo'))).toBe('e2e-proy-omega7');
    expect(enviados).toEqual(Array(3).fill({ convocatoria_id: RESULTADO.id }));
    await page.unrouteAll({ behavior: 'wait' });
    await page.evaluate(id => localStorage.setItem('rf360_proyecto_activo', id), leerEstado().proyectoId);
  });

  test('UI: el botón de la tarjeta del Radar abre el mismo modal y la navegación lleva a la búsqueda', async () => {
    await page.route('**/api/convocatorias/meta', r => json(r, 200, { success: true, sectores: ['Agua'], paises: ['Colombia'] }));
    await page.route('**/api/convocatorias?*', r => json(r, 200, { success: true, data: [{ ...RESULTADO, paises_elegibles: '["Colombia"]', sectores: '["Agua"]', fecha_publicacion: '2026-09-01', created_at: '2026-09-01T00:00:00Z', score_probabilidad: 0.8, entidad_nombre: null, entidad_sigla: null, entidad_tipo: null, entidad_pais: null, root_domain: null, favorito: false }], total: 1 }));
    await page.goto('/radar');
    const tarjeta = page.locator('.radx__card');
    await expect(tarjeta).toHaveCount(1, { timeout: 20_000 });
    const disparador = tarjeta.getByRole('button', { name: 'Formular esta convocatoria' });
    await disparador.click();
    await expect(page.getByRole('dialog')).toContainText(RESULTADO.titulo);
    // Trampa de foco: Tab / Shift+Tab nunca salen del modal; Escape devuelve el foco al disparador.
    for (const tecla of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(tecla);
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), `foco dentro del modal tras ${tecla}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(disparador).toBeFocused();
    await disparador.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    await page.unrouteAll({ behavior: 'wait' });

    await page.getByRole('link', { name: /Búsqueda semántica/ }).first().click();
    await expect(page).toHaveURL(/\/busqueda-semantica$/);
  });
});
