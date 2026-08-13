// check_veto_008.test.cjs — cobertura de la "Guillotina CI/CD" (Fase 2,
// 2026-08-13). Corre con: node --test scripts/check_veto_008.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { verificarSQL, verificarJS } = require('./check_veto_008.cjs');

test('verificarSQL: detecta fuga_multi_tenant en RPC con p_tenant_id obligatorio sin filtro', () => {
  const sql = `
    CREATE OR REPLACE FUNCTION obtener_algo(p_tenant_id UUID, p_id UUID)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    BEGIN
      SELECT * FROM tabla WHERE id = p_id;
    END;
    $$;
  `;
  const hallazgos = [];
  verificarSQL('fake.sql', sql, hallazgos);
  assert.ok(hallazgos.some(h => h.tipo === 'fuga_multi_tenant'));
});

test('verificarSQL: NO marca fuga_multi_tenant si filtra por tenant_id = p_tenant_id', () => {
  const sql = `
    CREATE OR REPLACE FUNCTION obtener_algo(p_tenant_id UUID, p_id UUID)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    BEGIN
      SELECT * FROM tabla WHERE id = p_id AND tenant_id = p_tenant_id;
    END;
    $$;
  `;
  const hallazgos = [];
  verificarSQL('fake.sql', sql, hallazgos);
  assert.ok(!hallazgos.some(h => h.tipo === 'fuga_multi_tenant'));
});

test('verificarSQL: NO marca fuga_multi_tenant si p_tenant_id tiene DEFAULT (opcional/contextual)', () => {
  const sql = `
    CREATE OR REPLACE FUNCTION registrar_algo(p_endpoint TEXT, p_tenant_id UUID DEFAULT NULL)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO log (endpoint, tenant_id) VALUES (p_endpoint, p_tenant_id);
    END;
    $$;
  `;
  const hallazgos = [];
  verificarSQL('fake.sql', sql, hallazgos);
  assert.deepEqual(hallazgos, []);
});

test('verificarSQL: detecta sin_idempotencia en función que hace INSERT sin ningún mecanismo', () => {
  const sql = `
    CREATE OR REPLACE FUNCTION crear_proyecto(p_tenant_id UUID, p_nombre TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO proyectos (tenant_id, nombre) VALUES (p_tenant_id, p_nombre);
    END;
    $$;
  `;
  const hallazgos = [];
  verificarSQL('fake.sql', sql, hallazgos);
  assert.ok(hallazgos.some(h => h.tipo === 'sin_idempotencia'));
});

test('verificarSQL: NO marca sin_idempotencia si hay idempotency_key/ON CONFLICT/OCC/FOR UPDATE', () => {
  const variantes = [
    `INSERT INTO t (tenant_id, idempotency_key) VALUES (p_tenant_id, p_key);`,
    `INSERT INTO t (tenant_id) VALUES (p_tenant_id) ON CONFLICT DO NOTHING;`,
    `PERFORM 1 FROM t WHERE id = p_id FOR UPDATE; INSERT INTO t (tenant_id) VALUES (p_tenant_id);`,
  ];
  for (const cuerpo of variantes) {
    const sql = `CREATE OR REPLACE FUNCTION f(p_tenant_id UUID) RETURNS JSONB LANGUAGE plpgsql AS $$ BEGIN ${cuerpo} END; $$;`;
    const hallazgos = [];
    verificarSQL('fake.sql', sql, hallazgos);
    assert.ok(!hallazgos.some(h => h.tipo === 'sin_idempotencia'), `no debería marcar: ${cuerpo}`);
  }
});

test('verificarSQL: exime funciones registrar_* del chequeo de idempotencia (logs/auditoría append-only)', () => {
  const sql = `
    CREATE OR REPLACE FUNCTION registrar_violacion(p_endpoint TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO violaciones (endpoint) VALUES (p_endpoint);
    END;
    $$;
  `;
  const hallazgos = [];
  verificarSQL('fake.sql', sql, hallazgos);
  assert.deepEqual(hallazgos, []);
});

test('verificarSQL: exime set_tenant_context de requerirse a sí mismo', () => {
  const sql = `
    CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id TEXT)
    RETURNS VOID LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM set_config('app.tenant_id', p_tenant_id, true);
    END;
    $$;
  `;
  const hallazgos = [];
  verificarSQL('fake.sql', sql, hallazgos);
  assert.deepEqual(hallazgos, []);
});

test('verificarSQL: detecta divisa_no_cop ante la cadena "USD"', () => {
  const sql = `-- presupuesto en USD, no COP\nSELECT 1;`;
  const hallazgos = [];
  verificarSQL('fake.sql', sql, hallazgos);
  assert.ok(hallazgos.some(h => h.tipo === 'divisa_no_cop'));
});

test('verificarJS: detecta divisa_no_cop en código JS también', () => {
  const js = `const precio = convertirA('USD', total);`;
  const hallazgos = [];
  verificarJS('fake.js', js, hallazgos);
  assert.ok(hallazgos.some(h => h.tipo === 'divisa_no_cop'));
});

test('verificarSQL: las migraciones VIGENTES reales (009, 008) no generan ningún hallazgo', () => {
  const fs = require('fs');
  const path = require('path');
  const hallazgos = [];
  for (const f of ['009_idempotencia_fase1.sql', '008_occ_atomic_guardar_modulo10.sql']) {
    const ruta = path.join(__dirname, '..', 'src', 'modules', 'formulador', 'migrations', f);
    verificarSQL(ruta, fs.readFileSync(ruta, 'utf8'), hallazgos);
  }
  assert.deepEqual(hallazgos, [], 'las versiones vigentes de las migraciones no deben generar falsos positivos');
});
