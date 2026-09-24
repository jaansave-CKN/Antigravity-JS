import { test, expect, request as pwRequest } from '@playwright/test';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * lote3-vigencia-mirofish.spec.ts — Lote 3 (2026-09-24) contra el backend real:
 *   F-10  vigencia documental de Anexos (endpoint aislado + triggers de la 069)
 *   F-09  comité hostil MIROFISH (reglas PDET deterministas + IA BYOK)
 * Usa el proyecto E2E de global-setup; todo lo que crea cae por CASCADE o lo
 * borra global-teardown (anexos + archivos del bucket incluidos).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';
const leerEstado = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as { email: string; password: string; userId: string; token: string; proyectoId: string };

function excelApu(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Item', 'Descripción', 'Unidad', 'Cantidad', 'Valor Unitario', 'Valor Total'],
    ['1', 'Excavación manual en material común', 'm3', 120, 45000, 5400000],
    ['2', 'Casco de seguridad industrial (EPP)', 'und', 15, 38000, 570000],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Presupuesto');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Fecha AAAA-MM-DD en Bogotá desplazada `dias` hacia atrás.
function haceDias(dias: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}

test.describe.serial('Lote 3 — vigencia documental (F-10) y comité MIROFISH (F-09)', () => {
  let anexoApuId = '';

  test('F-10: tipo por defecto, reglas de vigencia, validaciones y no-reversión del tipo elegido', async () => {
    const e = leerEstado();
    const api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
    const base = `/api/proyectos/${e.proyectoId}/anexos`;

    const up = await api.post(base, { multipart: { categoria: 'presupuesto_apu', descripcion: 'APU lote 3', file: {
      name: 'apu-lote3.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excelApu(),
    } } });
    expect(up.ok(), `subida: ${up.status()} ${await up.text()}`).toBeTruthy();
    anexoApuId = (await up.json()).data.id;

    // Trigger de INSERT (069): un presupuesto_apu nace 'apu_cotizacion', sin fecha.
    let lista = (await (await api.get(base)).json()).data as Array<{ id: string; tipo_vigencia: string; vigencia: { estado: string } }>;
    let fila = lista.find(a => a.id === anexoApuId)!;
    expect(fila.tipo_vigencia).toBe('apu_cotizacion');
    expect(fila.vigencia.estado).toBe('sin_fecha');

    // APU de hace 200 días (> 6 meses) → vencido.
    let r = await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { fecha_documento: haceDias(200) } });
    expect(r.status(), await r.text()).toBe(200);
    expect((await r.json()).data.vigencia.estado).toBe('vencido');

    // Libertad y Tradición de hace 10 días → vigente; de hace 40 → vencido.
    r = await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { tipo_vigencia: 'libertad_tradicion', fecha_documento: haceDias(10) } });
    expect((await r.json()).data.vigencia.estado).toBe('vigente');
    r = await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { fecha_documento: haceDias(40) } });
    expect((await r.json()).data.vigencia.estado).toBe('vencido');

    // Validaciones: fecha futura, fecha imposible, tipo inválido, body vacío.
    expect((await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { fecha_documento: haceDias(-5) } })).status()).toBe(400);
    expect((await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { fecha_documento: '2025-02-30' } })).status()).toBe(400);
    expect((await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { tipo_vigencia: 'inventado' } })).status()).toBe(400);
    expect((await api.patch(`${base}/${anexoApuId}/vigencia`, { data: {} })).status()).toBe(400);

    // B1: el tipo elegido a mano ('general') NO se revierte cuando la UI
    // reenvía la misma categoria en un guardado normal (blur).
    await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { tipo_vigencia: 'general' } });
    const blur = await api.patch(`${base}/${anexoApuId}`, { data: { descripcion: 'APU lote 3 (editado)', texto: '', link: '', categoria: 'presupuesto_apu' } });
    expect(blur.ok()).toBeTruthy();
    lista = (await (await api.get(base)).json()).data;
    fila = lista.find(a => a.id === anexoApuId)!;
    expect(fila.tipo_vigencia).toBe('general');

    // Deja un documento realmente vencido para la prueba de UI (aviso resumen).
    r = await api.patch(`${base}/${anexoApuId}/vigencia`, { data: { tipo_vigencia: 'libertad_tradicion', fecha_documento: haceDias(40) } });
    expect((await r.json()).data.vigencia.estado).toBe('vencido');
    await api.dispose();
  });

  test('F-09: reglas PDET deterministas (el casco EPP no cuenta como seguridad) + IA sin fabricar', async () => {
    // Una llamada real a Gemini (hasta 45 s + 1 reintento ante 503) no cabe en
    // el tope por defecto de 30 s; en CI (sin llaves) responde al instante.
    test.setTimeout(150_000);
    const e = leerEstado();
    // El usuario E2E no tiene llave propia: se marca exento para que byokGate
    // no responda 428 (mismo mecanismo de BD que global-setup para aprobarlo).
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('UPDATE usuarios SET byok_exento = true WHERE id = $1', [e.userId]);
    await db.end();

    const api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
    const merge = await api.patch(`/api/proyectos/${e.proyectoId}/ficha-tecnica-merge`, { data: { key: 'entrada_completa', value: { municipio: 'Argelia, Cauca' } } });
    expect(merge.ok(), await merge.text()).toBeTruthy();
    const tramos = await api.post(`/api/proyectos/${e.proyectoId}/logistica-tramos`, { data: { tramos: [
      { numero: 1, origen: 'Popayán', destino: 'Argelia', duracion: '06h 30m', distancia_km: 180, medio: 'Camión Turbo', estado_via: 'Destapada', calidad: 'Regular', tipo_transporte: 'Carga Pesada', orden_publico: 'Sí', seleccionado: true },
    ] } });
    expect(tramos.ok(), await tramos.text()).toBeTruthy();

    const r = await api.post(`/api/proyectos/${e.proyectoId}/mirofish`, { data: {} });
    expect(r.status(), await r.text()).toBe(201);
    const ev = (await r.json()).data;
    expect(ev.municipio_match.tipo).toBe('exacta');
    expect(ev.municipio_match.municipio.cod_muni).toBe('19050');
    const r1 = ev.reglas.hallazgos.find((h: { regla: string }) => h.regla === 'R1');
    expect(r1.severidad).toBe('CRITICA');
    expect(ev.reglas.hallazgos.find((h: { regla: string }) => h.regla === 'R2').severidad).toBe('ALTA');
    // IA: o respondió con hallazgos ya validados, o declara por qué no — nunca otra cosa.
    expect(['ok', 'no_disponible']).toContain(ev.ia.estado);
    if (ev.ia.estado === 'no_disponible') {
      expect(['USER_KEY_EXHAUSTED', 'pool_servidor_agotado', 'sin_llaves_servidor', 'modelo_saturado', 'respuesta_invalida', 'error']).toContain(ev.ia.motivo);
      expect(ev.ia.hallazgos).toEqual([]);
    }
    for (const h of ev.ia.hallazgos) expect(h.evidencia.length).toBeGreaterThan(0);

    const ultima = (await (await api.get(`/api/proyectos/${e.proyectoId}/mirofish`)).json()).data;
    expect(ultima.id).toBe(ev.id);
    await api.dispose();
  });

  test('UI: columnas TIPO DOC./FECHA en Anexos y tarjeta del Comité MIROFISH en Viabilidad', async ({ page }) => {
    const e = leerEstado();
    await page.goto('/login');
    await page.getByPlaceholder('operador@institucion.gov').fill(e.email);
    await page.getByPlaceholder('••••••••••••').fill(e.password);
    await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
    await expect(page).toHaveURL(/\/checklist/, { timeout: 15_000 });
    await page.evaluate(({ key, id }) => localStorage.setItem(key, id), { key: ACTIVE_PROJECT_KEY, id: e.proyectoId });

    await page.goto('/anexos');
    await expect(page.getByText('TIPO DOC.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('FECHA', { exact: true })).toBeVisible();
    await expect(page.getByText(/documento\(s\) con más de 1 año|documento\(s\) vencido/)).toBeVisible();
    await page.screenshot({ path: 'test-results/lote3-anexos.png' });
    await page.locator('.anx__table-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.screenshot({ path: 'test-results/lote3-anexos-scroll.png' });

    await page.goto('/viabilidad');
    await expect(page.getByText('Comité Hostil MIROFISH', { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Municipio PDET sin rubro de seguridad / orden público')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Comité Hostil MIROFISH', { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/lote3-mirofish.png' });
  });
});
