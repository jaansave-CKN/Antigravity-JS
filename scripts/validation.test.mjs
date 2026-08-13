// validation.test.mjs — primera cobertura real de LÓGICA DE NEGOCIO de la app
// (no del gate/PMU). Nace de una autocrítica honesta (2026-08-13): los 48
// tests existentes cubren únicamente el mecanismo de gobernanza de agentes,
// cero cobertura de lo que la app realmente valida antes de tocar Supabase.
// Corre con: node --test scripts/validation.test.mjs (ESM — este archivo usa
// import, no require, consistente con "type": "module" del proyecto).
import test from 'node:test';
import assert from 'node:assert/strict';
import { schemas, validateBody } from '../src/shared/infrastructure/validation.js';

test('schemas.fase1: acepta un payload mínimo válido (nombre + módulos vacíos por default)', () => {
  const r = schemas.fase1.safeParse({ ficha_fase1: { nombre: 'Proyecto X' } });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.modulo_7, {});
});

test('schemas.fase1: rechaza si falta nombre y nombre_proyecto (hallazgo real, ambos opcionales antes)', () => {
  const r = schemas.fase1.safeParse({ ficha_fase1: { codigo: 'ABC' } });
  assert.equal(r.success, false);
});

test('schemas.fase1: acepta nombre_proyecto como alternativa a nombre', () => {
  const r = schemas.fase1.safeParse({ ficha_fase1: { nombre_proyecto: 'Proyecto Y' } });
  assert.equal(r.success, true);
});

test('schemas.fase1: rechaza payload que excede 300KB (guardrail agregado en la auditoría PROTOCOLO TITÁN)', () => {
  const textoGigante = 'x'.repeat(310_000);
  const r = schemas.fase1.safeParse({ ficha_fase1: { nombre: 'P', diagnostico: textoGigante } });
  assert.equal(r.success, false);
});

test('schemas.fase1: dentro del límite de tamaño, pasa', () => {
  const textoOk = 'x'.repeat(1000);
  const r = schemas.fase1.safeParse({ ficha_fase1: { nombre: 'P', diagnostico: textoOk } });
  assert.equal(r.success, true);
});

test('schemas.modulo10: version_hash debe tener exactamente 64 caracteres (sha256 hex) si se envía', () => {
  const corto = schemas.modulo10.safeParse({ version_hash: 'abc123', indicadores: [] });
  assert.equal(corto.success, false);
  const correcto = schemas.modulo10.safeParse({ version_hash: 'a'.repeat(64), indicadores: [] });
  assert.equal(correcto.success, true);
});

test('schemas.modulo10: version_hash es opcional (cliente legacy sin OCC)', () => {
  const r = schemas.modulo10.safeParse({ indicadores: [] });
  assert.equal(r.success, true);
});

test('schemas.modulo10: indicadores por default es [] si no se envía', () => {
  const r = schemas.modulo10.safeParse({});
  assert.equal(r.success, true);
  assert.deepEqual(r.data.indicadores, []);
});

test('schemas.modulo10: rechaza un indicador sin el campo obligatorio "indicador"', () => {
  const r = schemas.modulo10.safeParse({ indicadores: [{ tipo: 'producto' }] });
  assert.equal(r.success, false);
});

test('schemas.sendEmail: rechaza un email con formato inválido', () => {
  const r = schemas.sendEmail.safeParse({ email: 'no-es-un-email', content: 'hola' });
  assert.equal(r.success, false);
});

test('schemas.sendEmail: acepta email válido + content, subject es opcional', () => {
  const r = schemas.sendEmail.safeParse({ email: 'a@b.com', content: 'hola mundo' });
  assert.equal(r.success, true);
});

test('schemas.sessionLogin/sessionVerify: rechazan tokens obviamente cortos (< 20 chars) — primera línea de defensa contra tokens vacíos/basura', () => {
  assert.equal(schemas.sessionLogin.safeParse({ firebaseToken: 'x' }).success, false);
  assert.equal(schemas.sessionVerify.safeParse({ token: 'x' }).success, false);
});

test('validateBody: middleware responde 400 con detalle de issues cuando el body no pasa el schema', () => {
  const mw = validateBody(schemas.sendEmail);
  const req = { body: { email: 'invalido' } };
  let statusCode, jsonBody;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  let nextLlamado = false;
  mw(req, res, () => { nextLlamado = true; });
  assert.equal(nextLlamado, false, 'next() no debe llamarse si el body es inválido');
  assert.equal(statusCode, 400);
  assert.ok(Array.isArray(jsonBody.detail) && jsonBody.detail.length > 0);
});

test('validateBody: middleware llama next() y normaliza req.body cuando el schema pasa', () => {
  const mw = validateBody(schemas.sendEmail);
  const req = { body: { email: '  a@b.com  ', content: 'hola' } };
  let nextLlamado = false;
  const res = { status() { return this; }, json() {} };
  mw(req, res, () => { nextLlamado = true; });
  assert.equal(nextLlamado, true);
  assert.equal(req.body.email, 'a@b.com', 'zod .trim() debe normalizar espacios');
});
