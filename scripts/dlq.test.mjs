// dlq.test.mjs — cola de cuarentena (src/shared/infrastructure/DeadLetterQueue.js,
// dictamen RadFor-360 2026-10-04, F3-1). Sin red: Upstash se simula con un
// fetch inyectado.
// Corre con: node --test scripts/dlq.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearDLQ, CLAVE_REDIS_DLQ } from '../src/shared/infrastructure/DeadLetterQueue.js';
import { ponerEnCuarentena } from '../src/shared/contracts/Handoffs.js';

const rutaTmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dlq-')), 'sub', 'cuarentena.jsonl');
const registro = (muestra) => ponerEnCuarentena({ origen: 'M1', destino: 'cache/cron/spa', motivo: 'pipeline_fallo', errores: ['Error: boom'], muestra });

test('archivo: append-only, crea la carpeta, una línea por registro, nunca reescribe', () => {
  const ruta = rutaTmp();
  const dlq = crearDLQ({ ruta, env: {} });
  dlq.registrar(registro({ query: 'uno' }));
  const primera = fs.readFileSync(ruta, 'utf8');
  dlq.registrar(registro({ query: 'dos' }));
  const contenido = fs.readFileSync(ruta, 'utf8');
  assert.ok(contenido.startsWith(primera), 'lo escrito antes no se altera');
  assert.equal(dlq.leer().length, 2);
});

test('Upstash: RPUSH durable a dlq:cuarentena con el registro ya redactado; sin LTRIM', async () => {
  const llamadas = [];
  const fetchImpl = async (url, init) => { llamadas.push({ url, init }); return new Response('{"result":1}', { status: 200 }); };
  const dlq = crearDLQ({ ruta: rutaTmp(), fetchImpl, env: { UPSTASH_REDIS_REST_URL: 'https://fake-upstash.test', UPSTASH_REDIS_REST_TOKEN: 'tok-test' } });
  dlq.registrar(registro({ correo: 'ana.gomez@correo.com', cedula: '1.098.765.432' }));
  await dlq.drenar();
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, `https://fake-upstash.test/rpush/${encodeURIComponent(CLAVE_REDIS_DLQ)}`);
  assert.equal(llamadas[0].init.headers.Authorization, 'Bearer tok-test');
  const enviado = JSON.parse(llamadas[0].init.body);
  assert.match(enviado.huella_sha256, /^[a-f0-9]{64}$/);
  assert.ok(!llamadas[0].init.body.includes('ana.gomez@correo.com') && !llamadas[0].init.body.includes('1.098.765.432'), 'PII enmascarada antes de salir');
  assert.ok(!llamadas.some(l => /ltrim/i.test(l.url)), 'retención append-only: nunca se recorta la lista');
});

test('resiliencia: archivo no escribible y Redis caído NO lanzan hacia la request', async () => {
  const bloqueado = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dlq-')), 'archivo');
  fs.writeFileSync(bloqueado, 'soy un archivo, no una carpeta');
  const dlq = crearDLQ({
    ruta: path.join(bloqueado, 'cuarentena.jsonl'),
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    env: { UPSTASH_REDIS_REST_URL: 'https://fake-upstash.test', UPSTASH_REDIS_REST_TOKEN: 'tok' },
  });
  assert.doesNotThrow(() => dlq.registrar(registro({ q: 'x' })));
  await dlq.drenar();
});

test('un registro fuera de contrato no se persiste (la DLQ también valida su propia forma)', () => {
  const ruta = rutaTmp();
  const dlq = crearDLQ({ ruta, env: {} });
  assert.throws(() => dlq.registrar({ origen: 'x' }));
  assert.equal(fs.existsSync(ruta), false);
});
