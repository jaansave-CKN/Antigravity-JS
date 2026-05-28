/**
 * FileImporter.js — Importación segura de CSV/Excel con política Zero Trust
 * GGIE · Radar de Fondos 360
 *
 * Procesa archivos subidos por el administrador desde portales oficiales.
 * Aplica sanitización completa antes de cualquier escritura en DB.
 */

import crypto from 'crypto';
import { createRequire } from 'module';
import { runSql, getRow } from './db.js';
import { sanitizeInput } from './SecurityMiddleware.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// ── CSV parser (dinámico para ESM) ────────────────────────────────────────────
async function importCsvParse() {
  const { parse } = await import('csv-parse/sync');
  return parse;
}

// ── Sanitización de fila completa ─────────────────────────────────────────────
function sanitizeRow(row) {
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    const key = sanitizeInput(String(k)).toLowerCase().replace(/\s+/g, '_');
    clean[key] = typeof v === 'string' ? sanitizeInput(v) : (v ?? '');
  }
  return clean;
}

// ── Normalización de headers a un esquema canónico ────────────────────────────
const DIRECTORIO_HEADER_MAP = {
  nombre: ['nombre', 'name', 'organization', 'entidad', 'organización'],
  sigla:  ['sigla', 'acronym', 'abreviatura'],
  tipo:   ['tipo', 'type', 'categoria', 'categoría', 'sector'],
  pais:   ['pais', 'país', 'country', 'paise'],
  sitio_web: ['sitio_web', 'web', 'url', 'website', 'página'],
  url_convocatorias: ['url_convocatorias', 'convocatorias', 'portal', 'grants_url'],
  telefono: ['telefono', 'teléfono', 'phone', 'tel'],
  email:    ['email', 'correo', 'e-mail', 'mail'],
  alcance:  ['alcance', 'scope', 'cobertura'],
};

const CONVOCATORIA_HEADER_MAP = {
  titulo:              ['titulo', 'título', 'title', 'nombre', 'convocatoria'],
  sector:              ['sector', 'area', 'área', 'thematic_area'],
  tipo_financiamiento: ['tipo_financiamiento', 'tipo', 'funding_type', 'modalidad'],
  monto:               ['monto', 'amount', 'valor', 'value', 'presupuesto'],
  url:                 ['url', 'link', 'enlace', 'portal'],
  fecha_cierre:        ['fecha_cierre', 'deadline', 'fecha_limite', 'closing_date', 'fecha'],
  entidad_id:          ['entidad', 'donante', 'donor', 'organización', 'entidad_id'],
};

function resolveColumn(headers, aliases) {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lowerHeaders.indexOf(alias);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function buildColumnMap(headers, schemaMap) {
  const map = {};
  for (const [field, aliases] of Object.entries(schemaMap)) {
    const found = resolveColumn(headers, aliases);
    if (found) map[field] = found;
  }
  return map;
}

// ── Parse CSV desde Buffer ────────────────────────────────────────────────────
export async function parseCSVBuffer(buffer) {
  const parse = await importCsvParse();
  const text = buffer.toString('utf-8').replace(/^﻿/, ''); // strip BOM
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  return records.map(sanitizeRow);
}

// ── Parse XLSX/XLS desde Buffer ───────────────────────────────────────────────
export function parseXLSXBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return records.map(sanitizeRow);
}

// ── Auto-detectar formato por extensión ───────────────────────────────────────
export async function parseFileBuffer(buffer, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'csv') return parseCSVBuffer(buffer);
  if (['xlsx', 'xls'].includes(ext)) return parseXLSXBuffer(buffer);
  // Intentar CSV como fallback
  try { return await parseCSVBuffer(buffer); }
  catch { return parseXLSXBuffer(buffer); }
}

// ── Importar al Directorio ────────────────────────────────────────────────────
export async function importToDirectorio(records) {
  if (!records.length) return { inserted: 0, skipped: 0, errors: 0, preview: [] };

  const headers = Object.keys(records[0]);
  const colMap  = buildColumnMap(headers, DIRECTORIO_HEADER_MAP);
  const report  = { inserted: 0, skipped: 0, errors: 0, preview: [] };
  const now     = new Date().toISOString();

  for (const row of records) {
    try {
      const nombre = colMap.nombre ? row[colMap.nombre] : '';
      if (!nombre || nombre.length < 2) { report.skipped++; continue; }

      const existing = await getRow(
        'SELECT id FROM directorio_entidades WHERE nombre = ? AND deleted_at IS NULL',
        [nombre]
      );
      if (existing) { report.skipped++; continue; }

      const id = `import-${crypto.randomUUID().slice(0, 8)}`;
      await runSql(
        `INSERT INTO directorio_entidades
         (id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias,
          telefono, email, alcance, validation_status, fuente, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          nombre.slice(0, 200),
          colMap.sigla         ? row[colMap.sigla].slice(0, 20)       : '',
          colMap.tipo          ? row[colMap.tipo].slice(0, 50)        : 'PRIVADO',
          colMap.pais          ? row[colMap.pais].slice(0, 100)       : 'Colombia',
          colMap.sitio_web     ? row[colMap.sitio_web].slice(0, 255)  : '',
          colMap.url_convocatorias ? row[colMap.url_convocatorias].slice(0, 255) : '',
          colMap.telefono      ? row[colMap.telefono].slice(0, 50)    : '',
          colMap.email         ? row[colMap.email].slice(0, 200)      : '',
          colMap.alcance       ? row[colMap.alcance].slice(0, 100)    : 'Nacional',
          'IMPORTADO · VALIDACION_PENDIENTE',
          'csv_import',
          now, now,
        ]
      );
      report.inserted++;
      if (report.preview.length < 5) report.preview.push({ nombre, tipo: colMap.tipo ? row[colMap.tipo] : '' });
    } catch (e) {
      console.error('[Importer/Directorio] Fila omitida:', e.message);
      report.errors++;
    }
  }
  return report;
}

// ── Importar a Convocatorias ──────────────────────────────────────────────────
export async function importToConvocatorias(records) {
  if (!records.length) return { inserted: 0, skipped: 0, errors: 0, preview: [] };

  const headers = Object.keys(records[0]);
  const colMap  = buildColumnMap(headers, CONVOCATORIA_HEADER_MAP);
  const report  = { inserted: 0, skipped: 0, errors: 0, preview: [] };
  const now     = new Date().toISOString();

  for (const row of records) {
    try {
      const titulo = colMap.titulo ? row[colMap.titulo] : '';
      if (!titulo || titulo.length < 3) { report.skipped++; continue; }

      const url = colMap.url ? row[colMap.url] : '';
      const existing = await getRow(
        'SELECT id FROM convocatorias WHERE titulo = ? OR (url != "" AND url = ?)',
        [titulo, url]
      );
      if (existing) { report.skipped++; continue; }

      const monto = parseFloat(String(colMap.monto ? row[colMap.monto] : 0).replace(/[^0-9.-]/g, '')) || 0;
      await runSql(
        `INSERT INTO convocatorias
         (titulo, sector, tipo_financiamiento, formato_formulacion, monto, url,
          fecha_cierre, entidad_id, score, estado, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          titulo.slice(0, 255),
          colMap.sector              ? row[colMap.sector].slice(0, 100)             : '',
          colMap.tipo_financiamiento ? row[colMap.tipo_financiamiento].slice(0, 100) : 'CSV_IMPORT',
          'FUENTE:CSV_IMPORT | VALIDACION:PENDIENTE',
          monto,
          url.slice(0, 255),
          colMap.fecha_cierre ? row[colMap.fecha_cierre].slice(0, 50) : '',
          colMap.entidad_id   ? row[colMap.entidad_id].slice(0, 100)  : '',
          60,
          'pendiente',
          now,
        ]
      );
      report.inserted++;
      if (report.preview.length < 5) report.preview.push({ titulo, url });
    } catch (e) {
      console.error('[Importer/Convocatorias] Fila omitida:', e.message);
      report.errors++;
    }
  }
  return report;
}
