import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const statements = [];
let pgUnavailable = false;
let hits = 0;
const backendUrl = path => new URL(`../../backend/${path}`, import.meta.url).href;
mock.module(backendUrl('config/database.config.js'), { namedExports: {
  queryPgOnly: async (sql, params = []) => {
    statements.push({ sql, params });
    if (pgUnavailable) {
      const error = new Error('PostgreSQL no disponible');
      error.status = 503;
      error.code = 'PG_DIRECTO_NO_DISPONIBLE';
      throw error;
    }
    if (/^\s*CREATE TABLE/i.test(sql)) return { rows: [] };
    hits++;
    return { rows: [{ count: hits, reset_at: '2026-10-07T12:01:00.000Z' }] };
  },
} });

const { PostgresRateLimitStore } = await import('../../backend/middlewares/PostgresRateLimitStore.js');

test('increment usa un único UPSERT atómico sin SELECT previo', async () => {
  statements.length = 0;
  hits = 0;
  pgUnavailable = false;
  const store = new PostgresRateLimitStore('login');
  store.init({ windowMs: 60_000 });

  const result = await store.increment('ip-hash');
  const increment = statements.find(item => /INSERT INTO rate_limit_counters/i.test(item.sql));
  assert.ok(increment);
  assert.match(increment.sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(increment.sql, /rate_limit_counters\.count \+ 1/);
  assert.match(increment.sql, /reset_at <= NOW\(\)/);
  assert.deepEqual(increment.params, ['login:ip-hash', 60_000]);
  assert.equal(statements.some(item => /^\s*SELECT/i.test(item.sql)), false);
  assert.equal(result.totalHits, 1);
  assert.equal(result.resetTime.toISOString(), '2026-10-07T12:01:00.000Z');
});

test('rate limiter falla cerrado si PostgreSQL no está disponible', async () => {
  pgUnavailable = true;
  const store = new PostgresRateLimitStore('login');
  store.init({ windowMs: 60_000 });
  await assert.rejects(
    () => store.increment('ip-hash'),
    error => error.code === 'PG_DIRECTO_NO_DISPONIBLE' && error.status === 503
  );
});

test('el limitador global de API no conserva MemoryStore por instancia', () => {
  const serverSource = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  assert.match(serverSource, /app\.use\('\/api', rateLimit\(\{[\s\S]*?store: new PostgresRateLimitStore\('globalApi'\)/);
});