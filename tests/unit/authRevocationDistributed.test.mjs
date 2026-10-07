import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-only-secret';
let tokenRevoked = true;
let revocationLookupFails = false;
const queries = [];
const backendUrl = path => new URL(`../../backend/${path}`, import.meta.url).href;

mock.module('jsonwebtoken', { defaultExport: {
  verify: () => ({ sub: 'user-1', role: 'Usuario', iat: Math.floor(Date.now() / 1000) }),
} });
mock.module(backendUrl('db.js'), { namedExports: {
  getRow: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM revoked_tokens')) {
      if (revocationLookupFails) throw new Error('BD no verificable');
      return tokenRevoked ? { revoked: 1 } : null;
    }
    if (sql.includes('tokens_invalidated_at')) return null;
    if (sql.includes('SELECT is_active')) return { is_active: true };
    if (sql.includes('SELECT expires_at')) return null;
    throw new Error(`consulta inesperada: ${sql}`);
  },
} });
mock.module(backendUrl('utils/logger.js'), { namedExports: { logger: { info: () => {}, warn: () => {} } } });

const { authenticateToken } = await import('../../backend/middlewares/auth.middleware.js');

function buildRequest() {
  return { cookies: {}, headers: { authorization: 'Bearer session-token' }, path: '/api/private', method: 'GET' };
}

function buildResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('otra instancia rechaza el token revocado persistido por logout', async () => {
  tokenRevoked = true;
  revocationLookupFails = false;
  queries.length = 0;
  const res = buildResponse();
  let nextCalled = false;
  await authenticateToken(buildRequest(), res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
  const query = queries.find(item => item.sql.includes('FROM revoked_tokens'));
  assert.ok(query, 'consulta la revocación persistida');
  assert.equal(query.params[0].length, 64, 'consulta por SHA-256, no por JWT crudo');
  assert.notEqual(query.params[0], 'session-token');
});

test('fallo al consultar revocaciones no autoriza el request', async () => {
  revocationLookupFails = true;
  const res = buildResponse();
  let nextCalled = false;
  await assert.rejects(
    () => authenticateToken(buildRequest(), res, () => { nextCalled = true; }),
    /BD no verificable/
  );
  assert.equal(nextCalled, false);
});

test('token vigente continúa tras revisar revocación, sesión y cuenta', async () => {
  tokenRevoked = false;
  revocationLookupFails = false;
  queries.length = 0;
  const res = buildResponse();
  let nextCalled = false;
  await authenticateToken(buildRequest(), res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.ok(queries.some(item => item.sql.includes('FROM revoked_tokens')));
});