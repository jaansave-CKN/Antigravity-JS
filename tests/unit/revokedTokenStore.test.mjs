import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const sqlCalls = [];
let writeFailure = null;
const backendUrl = path => new URL(`../../backend/${path}`, import.meta.url).href;
mock.module(backendUrl('config/database.config.js'), { namedExports: {
  queryPgOnly: async (sql, params) => {
    sqlCalls.push({ sql, params });
    if (writeFailure) throw writeFailure;
    return { rows: [] };
  },
} });

const { isRevokedPersisted, revokeToken, isRevoked, TokenRevocationPersistenceError } = await import('../../backend/middlewares/tokenBlacklist.js');

test('lookup persistido busca el hash y excluye tokens expirados', async () => {
  let llamada;
  const token = 'jwt-from-another-process';
  const revoked = await isRevokedPersisted(token, async (sql, params) => {
    llamada = { sql, params };
    return { revoked: 1 };
  });
  assert.equal(revoked, true);
  assert.match(llamada.sql, /expires_at > NOW\(\)/);
  assert.equal(llamada.params[0].length, 64);
  assert.notEqual(llamada.params[0], token);
});

test('fallo de BD se propaga y no se interpreta como sesión válida', async () => {
  await assert.rejects(
    () => isRevokedPersisted('jwt', async () => { throw new Error('BD fuera de servicio'); }),
    /BD fuera de servicio/
  );
});

test('revokeToken persiste por PostgreSQL directo antes de confirmar logout', async () => {
  sqlCalls.length = 0;
  writeFailure = null;
  const token = 'jwt-to-revoke-cross-instance';
  let legacyRouterCalled = false;
  await revokeToken(token, 'user-42', 1_900_000_000, async () => { legacyRouterCalled = true; });

  assert.equal(legacyRouterCalled, false, 'no usa el router que puede degradar a REST');
  assert.equal(sqlCalls.length, 1);
  assert.match(sqlCalls[0].sql, /ON CONFLICT \(token_hash\) DO NOTHING/);
  assert.equal(sqlCalls[0].params[0].length, 64, 'solo escribe el hash del JWT');
  assert.equal(isRevoked(token), true, 'mantiene la revocación local inmediata');
});

test('si falla PostgreSQL, mantiene bloqueo local y no confirma el logout', async () => {
  writeFailure = new Error('PostgreSQL no disponible');
  const token = 'jwt-revocation-write-fails';
  await assert.rejects(
    () => revokeToken(token, 'user-42', 1_900_000_000),
    error => error instanceof TokenRevocationPersistenceError && error.status === 503 && error.code === 'TOKEN_REVOCATION_UNAVAILABLE'
  );
  assert.equal(isRevoked(token), true);
  writeFailure = null;
});