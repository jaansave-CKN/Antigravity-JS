import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * global-setup.ts — crea un usuario E2E real y autoaprobado antes de la
 * suite, y un proyecto real de Formulador para que los tests tengan algo
 * sobre lo que operar.
 *
 * Por qué no un usuario fijo con contraseña hardcodeada: /api/auth/register
 * (server.js:1260) es el ÚNICO camino real que genera el hash de contraseña
 * correcto — replicarlo a mano aquí duplicaría lógica de hashing y podría
 * desincronizarse si cambia el algoritmo. Se registra por API real y solo se
 * usa SQL directo para lo que la API no puede hacer sola: saltar el gate de
 * aprobación manual de admin (is_approved) y otorgar access_formulador —
 * ambos existen a propósito para usuarios reales, no para este fixture.
 *
 * Email único por corrida (Date.now()) — mismo patrón ya usado en
 * backend/scripts/smokeTest.js — evita colisión "ya existe" en reruns.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const STATE_DIR = path.join(__dirname, '.auth');
const STATE_FILE = path.join(STATE_DIR, 'e2e-state.json');

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está definida — global-setup necesita acceso directo a la BD para aprobar al usuario E2E y otorgar access_formulador (fuera del alcance de cualquier endpoint público).');
  }

  const email = `e2e_formulador_${Date.now()}@radfor360.e2e-test`;
  const password = 'E2eFormulador1234!';
  const nombre = 'E2E Formulador Bot';

  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, nombre }),
  });
  const regBody = await regRes.json();
  if (!regRes.ok || !regBody.success) {
    throw new Error(`No se pudo registrar el usuario E2E: HTTP ${regRes.status} — ${JSON.stringify(regBody)}`);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let userId: string;
  try {
    const userRow = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (!userRow.rows.length) throw new Error(`Usuario recién registrado no aparece en BD: ${email}`);
    userId = userRow.rows[0].id;

    // is_active/is_approved/access_formulador son columnas integer (0/1) en
    // Postgres aquí, no boolean — verificado contra information_schema.columns
    // antes de escribir esto (un `true` literal falla con type mismatch).
    await client.query('UPDATE usuarios SET is_approved = 1, is_active = 1 WHERE id = $1', [userId]);
    await client.query(
      `UPDATE user_subscriptions SET access_formulador = 1, plan = 'formulador' WHERE user_id = $1`,
      [userId]
    );
  } finally {
    await client.end();
  }

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok || !loginBody.token) {
    throw new Error(`No se pudo iniciar sesión con el usuario E2E recién aprobado: HTTP ${loginRes.status} — ${JSON.stringify(loginBody)}`);
  }
  const token: string = loginBody.token;

  const proyRes = await fetch(`${BASE_URL}/api/proyectos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nombre: `E2E Formulador Financiero — ${new Date().toISOString()}` }),
  });
  const proyBody = await proyRes.json();
  if (!proyRes.ok || !proyBody.success) {
    throw new Error(`No se pudo crear el proyecto E2E: HTTP ${proyRes.status} — ${JSON.stringify(proyBody)}`);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    email, password, userId, token, proyectoId: proyBody.id,
  }, null, 2));
}
