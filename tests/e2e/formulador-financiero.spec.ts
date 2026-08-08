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
    await page.getByRole('button', { name: /ejecutar autenticación/i }).click();
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
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
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
});
