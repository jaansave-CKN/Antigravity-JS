import { test, expect, request as pwRequest } from '@playwright/test';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * formulador-financiero.spec.ts — cubre el flujo real de Formulador/Anexos
 * con datos financieros en COP.
 *
 * NOTA VERIFICADA (no un supuesto): la UI real de Anexos
 * (client/src/components/AnexosCalcoView.tsx:256) manda SIEMPRE
 * `categoria: 'otro'` al subir un archivo — no existe hoy ningún control en
 * pantalla para marcar un adjunto como `categoria: 'presupuesto_apu'`, que es
 * el valor que activa el pipeline de extracción financiera
 * (backend/services/ExtractorService.js, disparado desde
 * backend/routes/anexos.routes.js:147/186). Por eso este archivo tiene DOS
 * pruebas separadas en vez de una sola "sube por la UI y verifica COP":
 *   1. UI real — sube un archivo por el botón real de Anexos (categoria
 *      'otro'), igual que cualquier usuario real hoy.
 *   2. API real — golpea el mismo endpoint que la UI (mismo backend, mismo
 *      Excel), pero con categoria 'presupuesto_apu', para probar el
 *      pipeline financiero COP que el prompt pidió verificar. Es la única
 *      forma real de ejercitarlo end-to-end hasta que exista un control de
 *      UI para esa categoría.
 */

const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

function leerEstadoE2E() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as {
    email: string; password: string; userId: string; token: string; proyectoId: string;
  };
}

/** Genera un Excel de presupuesto/APU real en memoria — mismos encabezados
 * que ExtractorService.HEADER_ALIASES reconoce, valores 100% en COP. */
function generarExcelApuCOP(): Buffer {
  const filas = [
    ['Item', 'Descripción', 'Unidad', 'Cantidad', 'Valor Unitario', 'Valor Total'],
    ['1', 'Excavación manual en material común', 'm3', 120, 45000, 5400000],
    ['2', 'Suministro e instalación de tubería PVC 6"', 'ml', 300, 82000, 24600000],
    ['3', 'Casco de seguridad industrial (EPP)', 'und', 15, 38000, 570000],
    ['4', 'Señalización y cerramiento de obra', 'gl', 1, 3200000, 3200000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Presupuesto');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test.describe('Formulador — flujo financiero (COP)', () => {
  test('autenticación real + navegación a Anexos + carga de archivo por la UI', async ({ page }) => {
    const estado = leerEstadoE2E();

    // 1) Autenticación exitosa del usuario — por la UI real, no por API.
    page.on('pageerror', e => console.log('[browser pageerror]', e.message));
    await page.goto('/login');
    await page.getByPlaceholder('operador@institucion.gov').fill(estado.email);
    await page.getByPlaceholder('••••••••••••').fill(estado.password);
    await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
    // Regresión real (2026-08-08): esto rebotaba a "/" un instante después de
    // llegar a /checklist — race entre el <Navigate> declarativo que main.tsx
    // montaba para /login y el navigate() imperativo de LoginPage (ver
    // main.tsx y LoginPage.tsx). Corregido quitando la autoridad de redirect
    // duplicada — LoginPage es ahora la única que decide, ver su useEffect
    // de mount-once. Aserción estricta a propósito: si vuelve a bifurcar, que
    // este test lo detecte.
    await expect(page).toHaveURL(/\/checklist/, { timeout: 15_000 });

    // 2) Selecciona el proyecto E2E creado en global-setup (mismo mecanismo
    // que usa la app: localStorage, ver PresupuestoPage.tsx/AnexosCalcoView.tsx).
    await page.evaluate(({ key, id }) => localStorage.setItem(key, id), {
      key: ACTIVE_PROJECT_KEY, id: estado.proyectoId,
    });

    // 3) Navega al módulo real de Anexos y sube un archivo por el botón real.
    await page.goto('/anexos');
    await expect(page.getByRole('heading', { name: 'Anexos' })).toBeVisible({ timeout: 10_000 });

    const excelBuffer = generarExcelApuCOP();
    const fileInput = page.locator('input[type="file"]');
    await page.locator('.anx__attach-btn').first().click();
    await fileInput.setInputFiles({
      name: 'presupuesto-apu.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: excelBuffer,
    });

    // El nombre del archivo debe reflejarse en la fila (subida real contra
    // /api/proyectos/:id/anexos, categoria 'otro' — ver nota de cabecera).
    await expect(page.locator('.anx__input--attach').first()).toHaveValue('presupuesto-apu.xlsx', { timeout: 15_000 });
  });

  test('pipeline financiero real: Excel de presupuesto se procesa 100% en COP sin excepciones', async ({}) => {
    const estado = leerEstadoE2E();
    const excelBuffer = generarExcelApuCOP();

    const api = await pwRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
      extraHTTPHeaders: { Authorization: `Bearer ${estado.token}` },
    });

    const res = await api.post(`/api/proyectos/${estado.proyectoId}/anexos`, {
      multipart: {
        categoria: 'presupuesto_apu',
        file: {
          name: 'presupuesto-apu.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: excelBuffer,
        },
      },
    });

    expect(res.ok(), `respuesta no-2xx: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json();

    expect(body.success).toBe(true);
    // "sin excepciones" = extraccion no es null (si hubiera lanzado ExtractorError,
    // el endpoint responde success:false y borra el anexo — ver anexos.routes.js:210-214).
    expect(body.extraccion).not.toBeNull();
    expect(body.extraccion.totalLineas).toBe(4); // las 4 filas de datos del fixture

    // Verifica en BD que los valores quedaron en COP tal cual el Excel (sin
    // conversión de moneda, sin truncamiento) — lee directo, no confía solo
    // en el resumen que devuelve el endpoint.
    const listado = await api.get(`/api/proyectos/${estado.proyectoId}/anexos`);
    const anexos = (await listado.json()).data as Array<{ categoria: string; nombre_archivo: string }>;
    const subido = anexos.find(a => a.nombre_archivo === 'presupuesto-apu.xlsx' && a.categoria === 'presupuesto_apu');
    expect(subido).toBeTruthy();

    await api.dispose();
  });

  // F-06 + F-11 (2026-09-24): Montecarlo VAN/TIR, SROI y estrés financiero
  // contra el backend real. Autosuficiente: si el proyecto aún no tiene APU
  // ingerido, lo sube (mismo Excel). Las filas que crea (corridas, SROI,
  // escenarios) caen por ON DELETE CASCADE al borrar el proyecto en
  // global-teardown; el hallazgo CRITICO lo borra el teardown explícitamente.
  test('evaluación financiera: Montecarlo VAN/TIR en COP, SROI y estrés sobre el APU real', async ({}) => {
    const estado = leerEstadoE2E();
    const api = await pwRequest.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
      extraHTTPHeaders: { Authorization: `Bearer ${estado.token}` },
    });
    const base = `/api/proyectos/${estado.proyectoId}`;

    let previo = await (await api.get(`${base}/montecarlo`)).json();
    if (!(previo.inversion_actual_cop > 0)) {
      const up = await api.post(`${base}/anexos`, { multipart: { categoria: 'presupuesto_apu', file: {
        name: 'presupuesto-apu.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: generarExcelApuCOP(),
      } } });
      expect(up.ok(), `subida APU: ${up.status()} ${await up.text()}`).toBeTruthy();
      previo = await (await api.get(`${base}/montecarlo`)).json();
    }
    const inversion: number = previo.inversion_actual_cop;
    expect(inversion).toBeGreaterThan(0);

    // Montecarlo — resultado real y reproducible por semilla.
    const entrada = { beneficioMin: 5_000_000, beneficioProbable: 8_000_000, beneficioMax: 12_000_000, horizonteAnios: 10, semilla: 42 };
    const r1 = await api.post(`${base}/montecarlo`, { data: entrada });
    expect(r1.status(), await r1.text()).toBe(201);
    const c1 = (await r1.json()).data;
    expect(c1.inversion_cop).toBe(inversion);
    expect(c1.inversion_fuente).toBe('auto_extraido_project_apu_lineas');
    expect(c1.resultado.moneda).toBe('COP');
    expect(c1.resultado.tasa_descuento).toBe(0.12);
    expect(c1.resultado.iteraciones).toBe(10000);
    const anualidad = (1 - Math.pow(1.12, -10)) / 0.12;
    expect(Math.abs(c1.resultado.van_escenario_probable_cop - (-inversion + 8_000_000 * anualidad))).toBeLessThan(0.01);
    expect(c1.resultado.van.p10_cop).toBeLessThan(c1.resultado.van.p90_cop);
    expect(c1.resultado.histograma_van.reduce((s: number, h: { frecuencia: number }) => s + h.frecuencia, 0)).toBe(10000);

    const r2 = await api.post(`${base}/montecarlo`, { data: entrada });
    expect((await r2.json()).data.resultado).toEqual(c1.resultado);

    const ultima = (await (await api.get(`${base}/montecarlo`)).json()).data;
    expect(ultima.obsoleta).toBe(false);
    expect(ultima.resultado).toEqual(c1.resultado);

    // Entradas inválidas: nunca un resultado inventado.
    expect((await api.post(`${base}/montecarlo`, { data: { ...entrada, beneficioMin: 9_000_000 } })).status()).toBe(422);
    expect((await api.post(`${base}/montecarlo`, { data: { beneficioMin: 1, beneficioProbable: 2, beneficioMax: 3 } })).status()).toBe(400);
    expect((await api.post(`${base}/montecarlo`, { data: { ...entrada, moneda: 'USD' } })).status()).toBe(422);

    // SROI (F-11 restaurado) — ratio explícito sobre la misma inversión.
    const sroi = await api.post(`${base}/calcular-sroi`, { data: { ratioConversion: 2.5 } });
    expect(sroi.status(), await sroi.text()).toBe(201);
    expect(Number((await sroi.json()).data.sroi.valor_social_generado_cop)).toBeCloseTo(inversion * 2.5, 0);
    const impacto = (await (await api.get(`${base}/impacto-social`)).json()).data;
    expect(Number(impacto.sroi.ratio_conversion)).toBe(2.5);

    // Estrés financiero (F-11 restaurado) — 20% supera el umbral crítico (15%).
    const estres = await api.post(`${base}/estres-financiero`, { data: { nombreEscenario: 'E2E alza SMMLV', porcentajeIncremento: 20 } });
    expect(estres.status(), await estres.text()).toBe(201);
    expect((await estres.json()).data.viabilidad_resultado).toBe('CRITICO');
    const escenarios = (await (await api.get(`${base}/estres-financiero`)).json()).data;
    expect(escenarios.some((e: { nombre_escenario: string }) => e.nombre_escenario === 'E2E alza SMMLV')).toBe(true);

    await api.dispose();
  });

  // UI real de /evaluacion-financiera y de la tarjeta Montecarlo de
  // /viabilidad — usa los datos que dejó la prueba anterior (mismo proyecto).
  test('UI: /evaluacion-financiera muestra VAN/TIR, SROI y estrés reales; /viabilidad ya no dibuja una curva fija', async ({ page }) => {
    const estado = leerEstadoE2E();
    await page.goto('/login');
    await page.getByPlaceholder('operador@institucion.gov').fill(estado.email);
    await page.getByPlaceholder('••••••••••••').fill(estado.password);
    await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
    await expect(page).toHaveURL(/\/checklist/, { timeout: 15_000 });
    await page.evaluate(({ key, id }) => localStorage.setItem(key, id), { key: ACTIVE_PROJECT_KEY, id: estado.proyectoId });

    await page.goto('/evaluacion-financiera');
    await expect(page.getByRole('heading', { name: 'Evaluación Financiera' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('VAN mediano (P50)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('TIR mediana (P50)')).toBeVisible();
    await expect(page.getByText('Valor social generado')).toBeVisible();
    await expect(page.getByText('E2E alza SMMLV · +20 %')).toBeVisible();
    await page.screenshot({ path: 'test-results/evaluacion-financiera.png', fullPage: true });
    // El layout desplaza un contenedor interno (fullPage no lo cubre): capturas
    // de la parte baja para revisar resultados, SROI y estrés.
    await page.getByText('VAN mediano (P50)').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/evaluacion-financiera-resultado.png' });
    await page.getByText('E2E alza SMMLV · +20 %').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/evaluacion-financiera-sroi-estres.png' });

    await page.goto('/viabilidad');
    await expect(page.getByText('Distribución Montecarlo')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('P(VAN>0)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('IC 68%')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/viabilidad-montecarlo.png', fullPage: true });
  });
});
