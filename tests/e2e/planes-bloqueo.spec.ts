import { test, expect, request as pwRequest, type Browser } from '@playwright/test';
import pg from 'pg';
import 'dotenv/config';

/**
 * planes-bloqueo.spec.ts — control de planes (2026-09-29, sellado de puntos ciegos).
 *
 * Antes el CI nunca ejercía PlanGate: la suite corre vite dev y el control se
 * saltaba en DEV. Con VITE_TEST_PLAN_ENFORCEMENT=true (paso E2E del CI;
 * client/src/lib/planes.ts) PlanGate se aplica también en dev, y este spec:
 *   - API: un usuario SIN plan recibe 403 con el code exacto en rutas de Radar
 *     y Formulador; uno CON plan no.
 *   - UI: cargar DIRECTO /entrada, /checklist y /busqueda-semantica lleva a
 *     /planes sin plan y se queda con plan (regresión del bug del PR #46).
 * En CI FALLA si la bandera no está activa: nadie puede apagarla en silencio.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const BANDERA = process.env.VITE_TEST_PLAN_ENFORCEMENT === 'true';
const PASSWORD = 'E2ePlanes1234!';

interface Usuario { email: string; id: string; token: string }
const usuarios: Record<'sinPlan' | 'conPlan', Usuario | null> = { sinPlan: null, conPlan: null };

async function crearUsuario(etiqueta: string, conPlan: boolean): Promise<Usuario> {
  const email = `e2e_planes_${etiqueta}_${Date.now()}@example.com`;
  const reg = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, nombre: `E2E Planes ${etiqueta}` }) });
  expect(reg.ok, `registro ${etiqueta}: ${reg.status}`).toBeTruthy();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const id = (await db.query('SELECT id FROM usuarios WHERE email = $1', [email])).rows[0].id as string;
    await db.query('UPDATE usuarios SET is_approved = 1, is_active = 1 WHERE id = $1', [id]);
    await db.query('UPDATE user_subscriptions SET access_radar = $2, access_formulador = $2, plan = $3 WHERE user_id = $1',
      [id, conPlan ? 1 : 0, conPlan ? 'suite' : 'free']);
    const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    const token = (await login.json()).token as string;
    expect(token, `login ${etiqueta}`).toBeTruthy();
    return { email, id, token };
  } finally {
    await db.end();
  }
}

async function entrarPorUI(browser: Browser, u: Usuario) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByPlaceholder('operador@institucion.gov').fill(u.email);
  await page.getByPlaceholder('••••••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  return page;
}

test.describe.serial('Control de planes (PlanGate + requireAccess)', () => {
  test.beforeAll(async () => {
    if (process.env.CI) {
      expect(BANDERA, 'En CI VITE_TEST_PLAN_ENFORCEMENT debe ser "true" (.github/workflows/playwright.yml): sin ella PlanGate no se prueba').toBe(true);
    }
    usuarios.sinPlan = await crearUsuario('sin', false);
    usuarios.conPlan = await crearUsuario('con', true);
  });

  test.afterAll(async () => {
    const ids = Object.values(usuarios).filter(Boolean).map(u => (u as Usuario).id);
    if (!ids.length) return;
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('DELETE FROM user_subscriptions WHERE user_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM usuarios WHERE id = ANY($1::text[])', [ids]);
    await db.end();
  });

  test('API: sin plan → 403 con el code exacto; con plan → pasa el control', async () => {
    for (const [clave, esperado] of [['sinPlan', 403], ['conPlan', 200]] as const) {
      const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${usuarios[clave]!.token}` } });
      const radar = await api.get('/api/radar/busqueda-semantica/estado');
      const formulador = await api.get('/api/proyectos/no-existe-e2e-planes/indicadores');
      if (esperado === 403) {
        expect(radar.status()).toBe(403);
        expect((await radar.json()).code).toBe('NO_ACCESS_RADAR');
        expect(formulador.status()).toBe(403);
        expect((await formulador.json()).code).toBe('NO_ACCESS_FORMULADOR');
      } else {
        expect(radar.status(), await radar.text()).toBe(200);
        expect(formulador.status(), 'con plan no debe recibir 403 de plan').not.toBe(403);
      }
      await api.dispose();
    }
  });

  test('UI: carga directa sin plan → /planes; con plan se queda (PlanGate real)', async ({ browser }) => {
    test.skip(!BANDERA, 'Local sin VITE_TEST_PLAN_ENFORCEMENT: el frontend dev salta PlanGate (en CI es obligatoria)');
    const rutas = ['/entrada', '/checklist', '/busqueda-semantica'];

    const sin = await entrarPorUI(browser, usuarios.sinPlan!);
    for (const ruta of rutas) {
      await sin.goto(ruta);
      await expect(sin, `sin plan en ${ruta}`).toHaveURL(/\/planes$/, { timeout: 15_000 });
    }
    await sin.context().close();

    const con = await entrarPorUI(browser, usuarios.conPlan!);
    for (const ruta of rutas) {
      await con.goto(ruta);
      // Espera a que PlanGate termine ("Verificando plan…") y compruebe que NO redirige.
      await expect(con.getByText('Verificando plan…')).toHaveCount(0, { timeout: 15_000 });
      await expect(con, `con plan en ${ruta}`).toHaveURL(new RegExp(`${ruta}$`));
    }
    await con.context().close();
  });
});
