import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * lote5-config-logistica.spec.ts — Lote 5 T1 (2026-09-24): endpoint AISLADO
 * de escritura de config_logistica (PATCH/GET /api/proyectos/:id/config-logistica).
 * Cubre: semántica de presencia, NULL (no 'Urbana'/0) en campos ausentes
 * (fiscalización architect T1-B1), validaciones estrictas, aislamiento frente
 * a tramos y Entrada, y que MIROFISH lee la ubicación guardada aquí.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.auth', 'e2e-state.json');
const leerEstado = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as { userId: string; token: string; proyectoId: string };

test.describe.serial('Lote 5 — config_logistica (endpoint aislado)', () => {
  test('presencia, NULL en ausentes, validaciones y aislamiento', async () => {
    const e = leerEstado();
    const api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
    const url = `/api/proyectos/${e.proyectoId}/config-logistica`;
    // Reintento seguro: parte siempre de "sin configuración" (un intento
    // previo fallido pudo dejar la fila creada). Solo la fila del proyecto E2E.
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('DELETE FROM config_logistica WHERE proyecto_id = $1 AND user_id = $2', [e.proyectoId, e.userId]);
    await db.end();
    const antesEntrada = (await (await api.get(`/api/proyectos/${e.proyectoId}`)).json()).data?.ficha_tecnica?.entrada_completa ?? null;
    const antesTramos = (await (await api.get(`/api/proyectos/${e.proyectoId}/logistica-tramos`)).json()).data;

    expect((await (await api.get(url)).json()).data).toBeNull();

    // Primer guardado parcial: lo ausente queda NULL, NO 'Urbana' ni 0.
    let r = await api.patch(url, { data: { departamento: 'Cauca', municipio: 'Argelia' } });
    expect(r.status(), await r.text()).toBe(200);
    let fila = (await r.json()).data;
    expect([fila.departamento, fila.municipio]).toEqual(['Cauca', 'Argelia']);
    expect(fila.zona).toBeNull();
    expect(fila.duracion_meses).toBeNull();
    expect(fila.user_id).toBe(e.userId);

    // Segundo guardado: solo cambia lo enviado.
    r = await api.patch(url, { data: { duracion_meses: 6, fecha_inicio: '2026-10-01', zona: 'Rural' } });
    fila = (await r.json()).data;
    expect([fila.municipio, fila.duracion_meses, fila.fecha_inicio, fila.zona]).toEqual(['Argelia', 6, '2026-10-01', 'Rural']);

    // null = borrado intencional de ese campo, sin tocar los demás.
    fila = (await (await api.patch(url, { data: { zona: null } })).json()).data;
    expect([fila.zona, fila.municipio, fila.duracion_meses]).toEqual([null, 'Argelia', 6]);

    // Validaciones estrictas.
    for (const body of [{}, { campo_inventado: 'x' }, { duracion_meses: '' }, { duracion_meses: 0 }, { duracion_meses: 2.5 }, { fecha_inicio: '2026-02-30' }, { fecha_inicio: '01/10/2026' }]) {
      expect((await api.patch(url, { data: body })).status(), JSON.stringify(body)).toBe(400);
    }

    // Aislamiento: Entrada y tramos intactos.
    expect((await (await api.get(`/api/proyectos/${e.proyectoId}`)).json()).data?.ficha_tecnica?.entrada_completa ?? null).toEqual(antesEntrada);
    expect((await (await api.get(`/api/proyectos/${e.proyectoId}/logistica-tramos`)).json()).data).toEqual(antesTramos);
    expect((await (await api.get(url)).json()).data.municipio).toBe('Argelia');
    await api.dispose();
  });

  test('MIROFISH usa la ubicación y el plazo guardados en config_logistica', async () => {
    const e = leerEstado();
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('UPDATE usuarios SET byok_exento = true WHERE id = $1', [e.userId]);
    await db.end();
    const api = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', extraHTTPHeaders: { Authorization: `Bearer ${e.token}` } });
    const r = await api.post(`/api/proyectos/${e.proyectoId}/mirofish`, { data: {} });
    expect(r.status(), await r.text()).toBe(201);
    const ev = (await r.json()).data;
    expect(ev.municipio_match.municipio.cod_muni).toBe('19050');
    expect(ev.municipio_match.evidencia.map((x: { campo: string }) => x.campo)).toEqual(expect.arrayContaining(['logistica.municipio', 'logistica.departamento']));
    await api.dispose();
  });
});
