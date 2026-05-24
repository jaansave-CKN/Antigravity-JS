import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { loadEnv } from './server/env-loader.js';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);

loadEnv();

import { initSQL, getDb, getRow, getRows, getCount, runSql } from './server/db.js';
import { seedPredios } from './server/seed-predios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Set it in Render dashboard or .env.');
  process.exit(1);
}
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRATION_HOURS = 24;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hashed}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hashed] = stored.split(':');
    const check = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hashed));
  } catch { return false; }
}

function generateToken(userId, email, role) {
  return jwt.sign({ sub: userId, email, role }, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: `${JWT_EXPIRATION_HOURS}h` });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }); }
  catch { return null; }
}

async function initDb() {
  const pool = getDb();
  try {
    await runSql(`CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, nombre TEXT NOT NULL,
      tipoUsuario TEXT NOT NULL DEFAULT 'user',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_approved INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1,
      deleted_at TIMESTAMP DEFAULT NULL
    )`);
    await runSql(`CREATE TABLE IF NOT EXISTS tokens_revocados (
      id TEXT PRIMARY KEY, token TEXT NOT NULL,
      usuario_id TEXT NOT NULL, revocado_en TIMESTAMP NOT NULL,
      deleted_at TIMESTAMP DEFAULT NULL
    )`);
    await runSql(`CREATE TABLE IF NOT EXISTS convocatorias (
        id SERIAL PRIMARY
        