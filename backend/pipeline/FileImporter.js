/**
 * FileImporter.js — Importación segura de CSV/Excel con política Zero Trust
 * GGIE · Radar de Fondos 360
 *
 * Procesa archivos subidos por el administrador desde portales oficiales
 * (POST /api/importar exige requireAdmin). Aplica decodificación de entidades
 * y sanitización completa antes de cualquier escritura en DB.
 *
 * Reparación 2026-09-29: la importación de CONVOCATORIAS fallaba en el 100 %
 * de las filas (verificado ejecutándola: "Could not find the 'fecha_cierre'
 * column"): usaba columnas inexistentes (sector, monto, url, fecha_cierre,
 * score…), `url != ""` (identificador vacío en Postgres) y no generaba id.
 * Ahora escribe el esquema real, igual que EntityScraper/DataIngestor.
 */

import crypto from 'crypto';
import { createRequire } from 'module';
import { runSql, getRow } from '../db.js';
import { sanitizeInput } from '../middlewares/SecurityMiddleware.js';
import { invalidateRadarCache } from '../middlewares/radarCache.js';
import { classifyByKeywords } from '../services/sectorClassifier.js';
import { getApexDomain } from '../utils/domainUtils.js';
import { decodificarEntidades } from '../utils/textoHtml.js';
import { extraerMonto, parsearNumero, resolverMoneda, montoParaGuardar } from '../utils/montos.js';
import { motivoBasura } from '../utils/tituloBasura.js';
import { calcEstado, normalizarFechaLimite } from '../utils/fechasConvocatoria.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// ── CSV parser (dinámico para ESM) ────────────────────────────────────────────
async function importCsvParse() {
  const { parse } = await import('csv-parse/sync');
  return parse;
}

// ── Sanitización de fila completa ─────────────────────────────────────────────
// Decodificar ANTES de sanitizar (textoHtml.js): un "&lt;script&gt;" decodificado
// es "<script>" y sanitizeInput lo elimina. Números y fechas quedan intactos.
// sanitizeInput borra todo ';' — se convierte antes en ',' para no fundir
// valores ("Agua; Saneamiento" quedaba "Agua Saneamiento", verificado en
// producción 2026-09-29).
function sanitizeRow(row) {
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    const key = sanitizeInput(String(k)).toLowerCase().replace(/\s+/g, '_');
    clean[key] = typeof v === 'string' ? sanitizeInput(decodificarEntidades(v).replace(/;/g, ',')) : (v ?? '');
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

// Columnas reales de convocatorias (DDL en server.js). Los alias cubren los
// encabezados habituales de portales oficiales en español e inglés.
const CONVOCATORIA_HEADER_MAP = {
  titulo:       ['titulo', 'título', 'title', 'nombre', 'convocatoria'],
  donante:      ['donante', 'entidad', 'donor', 'organización', 'organizacion', 'financiador', 'funder'],
  descripcion:  ['descripcion', 'descripción', 'description', 'resumen', 'objetivo'],
  monto:        ['monto', 'monto_max', 'amount', 'valor', 'value', 'presupuesto'],
  moneda:       ['moneda', 'currency', 'divisa'],
  pais:         ['pais', 'país', 'country'],
  url:          ['url', 'url_convocatoria', 'link', 'enlace', 'portal'],
  fecha_limite: ['fecha_limite', 'fecha_cierre', 'deadline', 'closing_date', 'fecha'],
  sectores:     ['sectores', 'sector', 'area', 'área', 'thematic_area'],
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
// cellDates: las fechas de Excel llegan como Date (no como serial numérico).
export function parseXLSXBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return records.map(sanitizeRow);
}

// ── Parse JSON desde Buffer ────────────────────────────────────────────────────
// Acepta: un array de objetos [{...}, {...}], o un objeto envoltorio { data: [...] }.
// Cualquier otra forma (objeto único, array de primitivos, JSON inválido) se
// rechaza explícitamente — nunca se intenta "adivinar" una estructura.
export function parseJSONBuffer(buffer) {
  const text = buffer.toString('utf-8').replace(/^﻿/, ''); // strip BOM

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const err = new Error(`JSON inválido: ${e.message}`);
    err.code = 'INVALID_JSON';
    throw err;
  }

  const records = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.data) ? parsed.data : null);

  if (!records) {
    const err = new Error('El JSON debe ser un array de objetos, o un objeto con la forma { "data": [...] }');
    err.code = 'INVALID_JSON_SHAPE';
    throw err;
  }
  if (!records.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
    const err = new Error('Cada elemento del array JSON debe ser un objeto (fila de datos)');
    err.code = 'INVALID_JSON_SHAPE';
    throw err;
  }

  return records.map(sanitizeRow);
}

// ── Auto-detectar formato por extensión ───────────────────────────────────────
// Sin fallback ciego: una extensión no reconocida es un error explícito de
// validación, no un intento silencioso de parsearla como CSV/Excel (eso
// producía basura o excepciones crípticas para XML, PDF y cualquier otro
// formato que pasara la whitelist de subida pero no tuviera parser real).
export async function parseFileBuffer(buffer, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'csv') return parseCSVBuffer(buffer);
  if (['xlsx', 'xls'].includes(ext)) return parseXLSXBuffer(buffer);
  if (ext === 'json') return parseJSONBuffer(buffer);

  const err = new Error(`Formato de archivo no soportado para importación: ".${ext}". Formatos con parser real: CSV, XLSX, XLS, JSON.`);
  err.code = 'UNSUPPORTED_FILE_FORMAT';
  throw err;
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
export const MAX_FILAS_IMPORTACION = 500;
const MONEDAS = new Set(['COP', 'USD', 'EUR', 'GBP', 'CAD']);
const MAX_DETALLE = 100; // filas omitidas/erróneas detalladas en el reporte

const texto = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());

/**
 * Prepara UNA fila (pura, sin BD) → { ok: true, datos } o
 * { ok: false, omitida: boolean, motivo }. "omitida" = no es un error del
 * archivo (basura curada); lo demás es un error de formato de esa fila.
 */
export function prepararFilaConvocatoria(row, colMap) {
  const get = (campo) => (colMap[campo] ? row[colMap[campo]] : '');
  const titulo = texto(get('titulo')).replace(/\s+/g, ' ').slice(0, 255);
  if (titulo.length < 5) return { ok: false, omitida: false, motivo: 'título vacío o menor a 5 caracteres' };
  const basura = motivoBasura(titulo);
  if (basura) return { ok: false, omitida: true, motivo: `no es una convocatoria (${basura})` };

  // Misma regla que R1/R2: sin URL específica la convocatoria no es verificable.
  const url = texto(get('url'));
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return { ok: false, omitida: false, motivo: 'URL requerida (http/https) para que la convocatoria sea verificable' };

  const donante = texto(get('donante')).slice(0, 150);
  const descripcion = texto(get('descripcion')).slice(0, 800);
  const pais = texto(get('pais')) || 'Colombia';
  const monedaColumna = texto(get('moneda')).toUpperCase();
  let moneda = MONEDAS.has(monedaColumna) ? monedaColumna : (/colombia/i.test(pais) ? 'COP' : 'USD');

  // Monto: número de la celda tal cual; texto numérico con miles/decimales;
  // o texto con moneda ("30 millones de pesos") vía el parser único.
  const crudo = get('monto');
  let valor = 0;
  if (typeof crudo === 'number') valor = crudo;
  else if (/^[\d.,\s]+$/.test(texto(crudo))) valor = parsearNumero(texto(crudo));
  else if (texto(crudo)) {
    const info = extraerMonto(texto(crudo));
    if (info) {
      valor = info.valor;
      if (!MONEDAS.has(monedaColumna)) moneda = resolverMoneda(info, pais);
    }
  }
  const montoMax = montoParaGuardar(valor, moneda);

  const fechaLimite = normalizarFechaLimite(get('fecha_limite'));
  const sectoresColumna = texto(get('sectores')).split(/[,;|]/).map(s => s.trim()).filter(Boolean).slice(0, 5);
  const sectores = sectoresColumna.length ? sectoresColumna : classifyByKeywords(titulo, descripcion, donante);

  return {
    ok: true,
    datos: {
      externoId: crypto.createHash('sha256').update(`CSV::${url}`).digest('hex').slice(0, 64),
      titulo, donante, descripcion, montoMax, moneda, url,
      paises: [pais], sectores, fechaLimite, estado: calcEstado(fechaLimite),
      rootDomain: getApexDomain(url) || null,
    },
  };
}

export async function importToConvocatorias(records) {
  const report = { inserted: 0, skipped: 0, errors: 0, preview: [], omitidas: [], errores: [] };
  if (!records.length) return report;
  if (records.length > MAX_FILAS_IMPORTACION) {
    const err = new Error(`El archivo tiene ${records.length} filas; el máximo por importación es ${MAX_FILAS_IMPORTACION}. Divídelo en varios archivos.`);
    err.code = 'IMPORT_DEMASIADAS_FILAS';
    throw err;
  }
  const colMap = buildColumnMap(Object.keys(records[0]), CONVOCATORIA_HEADER_MAP);
  for (const [campo, alias] of [['titulo', 'titulo/title'], ['url', 'url/link/enlace']]) {
    if (!colMap[campo]) {
      const err = new Error(`Falta la columna obligatoria "${campo}" (encabezados aceptados: ${alias}).`);
      err.code = 'IMPORT_COLUMNA_FALTANTE';
      throw err;
    }
  }
  const anotar = (lista, fila, motivo) => { if (lista.length < MAX_DETALLE) lista.push({ fila, motivo }); };

  // Cada fila es UN INSERT independiente e idempotente (dedup por externo_id y
  // URL): no hace falta transacción. Una fila mala se registra y se sigue.
  for (const [i, row] of records.entries()) {
    const fila = i + 2; // fila 1 = encabezados
    try {
      const p = prepararFilaConvocatoria(row, colMap);
      if (!p.ok) {
        if (p.omitida) { report.skipped++; anotar(report.omitidas, fila, p.motivo); }
        else { report.errors++; anotar(report.errores, fila, p.motivo); }
        continue;
      }
      const d = p.datos;
      const existe = await getRow(
        `SELECT id FROM convocatorias WHERE externo_id = ? OR url_convocatoria = ? LIMIT 1`,
        [d.externoId, d.url]
      );
      if (existe) { report.skipped++; anotar(report.omitidas, fila, 'ya existe en el catálogo (misma URL)'); continue; }

      await runSql(
        `INSERT INTO convocatorias
           (id, externo_id, titulo, donante, entidad_id, fuente, descripcion,
            monto_min, monto_max, moneda,
            paises_elegibles, sectores,
            url_convocatoria, url_fuente,
            fecha_limite, fecha_publicacion,
            requisitos, estado, score_probabilidad, root_domain, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          crypto.randomUUID(), d.externoId, d.titulo, d.donante, null, 'CSV_IMPORT', d.descripcion,
          0, d.montoMax, d.moneda,
          JSON.stringify(d.paises), JSON.stringify(d.sectores),
          d.url, '',
          d.fechaLimite, '',
          '[]', d.estado, 60, d.rootDomain, new Date().toISOString(),
        ]
      );
      report.inserted++;
      if (report.preview.length < 5) report.preview.push({ titulo: d.titulo, url: d.url });
    } catch (e) {
      // El índice único 076 / externo_id UNIQUE atrapan una carrera: es un duplicado, no un error.
      if (/duplicate key|unique/i.test(e.message || '')) {
        report.skipped++; anotar(report.omitidas, fila, 'duplicada');
        continue;
      }
      report.errors++;
      anotar(report.errores, fila, String(e.message || e).slice(0, 200));
      logger.warn('[Importer/Convocatorias] Fila con error', { fila, err: String(e.message || e).slice(0, 200) });
    }
  }
  if (report.inserted > 0) invalidateRadarCache();
  return report;
}
