/**
 * s3backup.test.mjs — Lote 5 T3: el backup ya no puede "salir en verde" sin
 * respaldar nada. Sin red, sin AWS y sin BD (logService simulado).
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const alertas = [];
mock.module(new URL('../../backend/services/logService.js', import.meta.url).href, {
  namedExports: { logCriticalError: async (origen, mensaje, extra) => { alertas.push({ origen, mensaje, extra }); } },
});
const { validarVolcado, urlParaPgDump, sanitizar, runS3Backup } = await import('../../backend/scripts/s3backup.js');

const volcado = ({ filas = 2, pie = true, relleno = 12000 } = {}) => [
  '--', '-- PostgreSQL database dump', '--', 'x'.repeat(relleno),
  'CREATE TABLE public.usuarios (id text NOT NULL, email text);',
  'COPY public.usuarios (id, email) FROM stdin;',
  ...Array.from({ length: filas }, (_, i) => `u${i}\tu${i}@x.co`),
  '\\.', '',
  pie ? '-- PostgreSQL database dump complete' : '', '',
].join('\n');

test('validarVolcado: acepta un volcado completo con datos', () => {
  assert.deepEqual(validarVolcado(volcado()), { ok: true, filasUsuarios: 2 });
});

test('validarVolcado: rechaza vacío, pequeño, truncado, sin tablas y sin datos', () => {
  assert.equal(validarVolcado('').ok, false);
  assert.match(validarVolcado(volcado({ relleno: 10 })).motivo, /demasiado pequeño/);
  assert.match(validarVolcado(volcado({ pie: false })).motivo, /truncado/);
  assert.match(validarVolcado(volcado().replace(/^CREATE TABLE .*$/m, '')).motivo, /ninguna tabla/);
  assert.match(validarVolcado(volcado({ filas: 0 })).motivo, /0 fila/);
  assert.equal(validarVolcado(volcado({ filas: 0 }), { minFilasUsuarios: 0 }).ok, true, 'umbral configurable (réplica vacía de CI)');
});

test('urlParaPgDump: pooler en transacción → sesión; la contraseña sale de la URL', () => {
  const r = urlParaPgDump('postgresql://postgres.ref:s3cr%40to@aws-1-us-west-2.pooler.supabase.com:6543/postgres');
  assert.equal(r.password, 's3cr@to');
  assert.equal(r.url, 'postgresql://postgres.ref@aws-1-us-west-2.pooler.supabase.com:5432/postgres');
  assert.equal(urlParaPgDump('postgresql://postgres:postgres@127.0.0.1:54322/postgres').url, 'postgresql://postgres@127.0.0.1:54322/postgres', 'la réplica local no cambia de puerto');
});

test('sanitizar: nunca deja contraseñas en un mensaje de error', () => {
  const msg = 'Command failed: pg_dump "postgresql://postgres.ref:MiClave123@host:5432/postgres" -- MiClave123';
  const limpio = sanitizar(msg, ['MiClave123']);
  assert.doesNotMatch(limpio, /MiClave123/);
  assert.match(sanitizar('postgres://u:otra@h/db'), /u:\*\*\*@/);
});

test('sin credenciales AWS: success=false (el CI sale en rojo) y queda alerta persistida', async () => {
  for (const k of ['AWS_S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) delete process.env[k];
  const r = await runS3Backup({ dryRun: false });
  assert.equal(r.success, false);
  assert.equal(r.skipped, true);
  assert.ok(alertas.some(a => a.origen === 'S3Backup'));
});

test('pg_dump inexistente: success=false con error, nunca "completado"', async () => {
  process.env.DATABASE_URL = 'postgresql://u:clave-secreta@127.0.0.1:1/db';
  process.env.PG_DUMP_BIN = 'pg_dump_que_no_existe_rf360';
  const r = await runS3Backup({ dryRun: true });
  assert.equal(r.success, false);
  assert.match(r.error, /pg_dump falló/);
  assert.doesNotMatch(r.error, /clave-secreta/);
});
