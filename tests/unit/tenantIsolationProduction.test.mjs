import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const envPrevio = { ...process.env };
process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgres://test/main';
process.env.DATABASE_URL_TENANT_SCOPED = 'postgres://test/scoped';
process.env.SUPABASE_SERVICE_KEY = 'test-only';

let sondasScoped = 0;
let poolScopedUsado = false;
const queriesPrincipales = [];
class PoolFalso {
  constructor({ connectionString }) { this.scoped = connectionString.includes('/scoped'); }
  async query(sql, params = []) {
    if (!this.scoped) queriesPrincipales.push({ sql, params });
    if (this.scoped && ++sondasScoped === 1) throw new Error('fallo transitorio del pool RLS');
    return { rows: [{ ok: 1, sql, params }] };
  }
  async connect() {
    poolScopedUsado = this.scoped;
    return {
      query: async () => ({ rows: [{ tenant: 'tenant-123' }] }),
      release: () => {},
    };
  }
}
mock.module('pg', { defaultExport: { Pool: PoolFalso } });

const { dbStatus, withTenant, queryPgOnly, RlsNoDisponibleError } = await import('../../backend/config/database.config.js');

test('producción reintenta el pool scoped y solo ejecuta con RLS real', async () => {
  const resultado = await withTenant('tenant-123', client => client.query('SELECT 1'));
  assert.equal(sondasScoped, 2, 'falló la sonda inicial y la petición realizó el reintento acotado');
  assert.equal(poolScopedUsado, true, 'la consulta de tenant usó exclusivamente el pool RLS-scoped');
  assert.equal(resultado.rows[0].tenant, 'tenant-123');
  assert.equal(dbStatus().productionGatePassed, true);
});

test('queryPgOnly conserva placeholders y no cambia a la capa REST', async () => {
  const resultado = await queryPgOnly('SELECT ? AS value', [7]);
  const consulta = queriesPrincipales.at(-1);
  assert.equal(consulta.sql, 'SELECT $1 AS value');
  assert.deepEqual(consulta.params, [7]);
  assert.equal(resultado.rows[0].sql, consulta.sql);
});

test('producción falla cerrado si se pierde la configuración del pool scoped', async () => {
  delete process.env.DATABASE_URL_TENANT_SCOPED;
  assert.equal(dbStatus().productionGatePassed, false);
  await assert.rejects(
    () => withTenant('tenant-123', async () => ({ ok: true })),
    err => err instanceof RlsNoDisponibleError
  );
  process.env.DATABASE_URL_TENANT_SCOPED = 'postgres://test/scoped';
});

test('restaura el entorno del proceso', () => {
  process.env = envPrevio;
});
