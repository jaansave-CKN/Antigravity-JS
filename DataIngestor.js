/**
 * DataIngestor.js — Ingesta de datos reales con política Zero Trust
 * GGIE · Radar de Fondos 360
 *
 * Fuentes:
 *   - SECOP II (datos.gov.co SODA API)  — Convocatorias oficiales Colombia
 *   - World Bank Open Data API          — Proyectos internacionales Colombia
 *   - Entidades verificadas seedDB      — Directorio inicial verificado
 */

import crypto from 'crypto';
import { runSql, getRow, getRows } from './db.js';
import { sanitizeInput } from './SecurityMiddleware.js';

// ── Constantes ────────────────────────────────────────────────────────────────
const SECOP_SODA_BASE = 'https://www.datos.gov.co/resource';
const WORLD_BANK_API  = 'https://search.worldbank.org/api/v2/projects';
const FETCH_TIMEOUT_MS = 12000;

// ── Zero Trust: sanitiza TODOS los campos de datos externos ──────────────────
function sanitizeRecord(record) {
  if (!record || typeof record !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      clean[key] = sanitizeInput(value).slice(0, 1000);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    } else if (value === null || value === undefined) {
      clean[key] = null;
    }
    // Arrays y objetos anidados se descartan para evitar inyecciones
  }
  return clean;
}

function safeFloat(value, fallback = 0) {
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? fallback : n;
}

function safeFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'Accept': 'application/json',
      'X-App-Token': process.env.DATOS_GOV_TOKEN || '',
      ...(options.headers || {}),
    },
  });
}

// ── SECOP II — Procesos de Contratación Pública ───────────────────────────────
// Dataset oficial: https://www.datos.gov.co/resource/p6dx-8zbt.json
export async function fetchSecopConvocatorias(limit = 100) {
  const where = encodeURIComponent(
    `fecha_de_inicio_del_proceso > '${new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0]}'`
  );
  const url = `${SECOP_SODA_BASE}/p6dx-8zbt.json?$where=${where}&$limit=${limit}&$order=fecha_de_inicio_del_proceso DESC`;

  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`SECOP II API — HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.map(sanitizeRecord) : [];
}

// ── World Bank — Proyectos activos en Colombia ────────────────────────────────
export async function fetchWorldBankProjects(rows = 20) {
  const url = `${WORLD_BANK_API}?format=json&fl=id,project_name,status,url,boardapprovaldate,totalamt,closingdate,mjsector_namecode&rows=${rows}&countryname=Colombia&source=IBRD&status=Active`;
  const res = await safeFetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`World Bank API — HTTP ${res.status}`);
  const data = await res.json();
  const projects = data?.projects?.project;
  if (!Array.isArray(projects)) return [];
  return projects.map(sanitizeRecord);
}

// ── Ingestión de Convocatorias ────────────────────────────────────────────────
export async function ingestConvocatorias() {
  const report = { secop: { inserted: 0, skipped: 0, errors: 0 }, worldbank: { inserted: 0, skipped: 0, errors: 0 }, timestamp: new Date().toISOString() };

  // — SECOP II —
  try {
    const secopItems = await fetchSecopConvocatorias(100);
    for (const item of secopItems) {
      try {
        const refId = item.id_del_proceso || item.referencia_del_proceso || '';
        const existing = await getRow(
          'SELECT id FROM convocatorias WHERE url = ? OR (titulo = ? AND deleted_at IS NULL)',
          [item.url_del_proceso || '', item.descripci_n_del_procedimiento || '']
        );
        if (existing) { report.secop.skipped++; continue; }

        await runSql(
          `INSERT INTO convocatorias
           (titulo, sector, tipo_financiamiento, formato_formulacion, monto, url,
            fecha_cierre, entidad_id, score, estado, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            (item.descripci_n_del_procedimiento || item.objeto_del_proceso || 'PROCESO SIN TÍTULO').slice(0, 255),
            item.modalidad_de_contrataci_n || 'CONTRATACIÓN PÚBLICA',
            'PÚBLICO · SECOP II',
            `FUENTE:SECOP_II | REF:${refId} | ENTIDAD:${item.nombre_entidad || ''} | VALIDACION:VERIFICADO`,
            safeFloat(item.cuant_a_estudio_previo || item.valor_total_adjudicacion),
            item.url_del_proceso || '',
            item.fecha_de_cierre_del_proceso || '',
            item.nit_entidad || '',
            80,
            'abierta',
            new Date().toISOString(),
          ]
        );
        report.secop.inserted++;
      } catch (e) {
        console.error('[Ingestor/SECOP] Fila omitida:', e.message);
        report.secop.errors++;
      }
    }
    console.log(`[Ingestor/SECOP] insertados=${report.secop.inserted} omitidos=${report.secop.skipped} errores=${report.secop.errors}`);
  } catch (e) {
    console.error('[Ingestor/SECOP] Fallo de conexión:', e.message);
    report.secop.error = e.message;
  }

  // — World Bank —
  try {
    const wbProjects = await fetchWorldBankProjects(20);
    for (const p of wbProjects) {
      try {
        const existing = await getRow('SELECT id FROM convocatorias WHERE url = ?', [p.url || '']);
        if (existing) { report.worldbank.skipped++; continue; }

        await runSql(
          `INSERT INTO convocatorias
           (titulo, sector, tipo_financiamiento, formato_formulacion, monto, url,
            fecha_cierre, score, estado, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            (p.project_name || 'Proyecto Banco Mundial').slice(0, 255),
            p.mjsector_namecode || 'DESARROLLO',
            'MULTILATERAL · BANCO MUNDIAL',
            `FUENTE:WORLD_BANK | ID:${p.id || ''} | VALIDACION:VERIFICADO`,
            safeFloat(p.totalamt),
            p.url || '',
            p.closingdate || '',
            85,
            'abierta',
            new Date().toISOString(),
          ]
        );
        report.worldbank.inserted++;
      } catch (e) {
        console.error('[Ingestor/WB] Fila omitida:', e.message);
        report.worldbank.errors++;
      }
    }
    console.log(`[Ingestor/WB] insertados=${report.worldbank.inserted} omitidos=${report.worldbank.skipped}`);
  } catch (e) {
    console.error('[Ingestor/WB] Fallo de conexión:', e.message);
    report.worldbank.error = e.message;
  }

  return report;
}

// ── Entidades Verificadas — Semilla inicial del Directorio ────────────────────
export const VERIFIED_SEED_ENTITIES = [
  {
    id: 'apc-colombia',
    nombre: 'APC-Colombia',
    sigla: 'APC',
    tipo: 'GOBIERNO',
    pais: 'Colombia',
    sitio_web: 'https://www.apccolombia.gov.co',
    url_convocatorias: 'https://www.apccolombia.gov.co/cooperacion-ofrecida',
    telefono: '+57 601 381 6700',
    email: 'info@apccolombia.gov.co',
    alcance: 'Nacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
  {
    id: 'giz-colombia',
    nombre: 'GIZ Colombia',
    sigla: 'GIZ',
    tipo: 'BILATERAL',
    pais: 'Alemania',
    sitio_web: 'https://www.giz.de/en/worldwide/340.html',
    url_convocatorias: 'https://www.giz.de/en/worldwide/340.html',
    telefono: '+57 601 326 8080',
    email: 'info@giz.de',
    alcance: 'Internacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
  {
    id: 'usaid-colombia',
    nombre: 'USAID Colombia',
    sigla: 'USAID',
    tipo: 'BILATERAL',
    pais: 'Estados Unidos',
    sitio_web: 'https://www.usaid.gov/colombia',
    url_convocatorias: 'https://www.usaid.gov/colombia/work-usaid',
    telefono: '+57 601 275 2000',
    email: 'bogota@usaid.gov',
    alcance: 'Internacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
  {
    id: 'pnud-colombia',
    nombre: 'PNUD Colombia',
    sigla: 'PNUD',
    tipo: 'MULTILATERAL',
    pais: 'Internacional',
    sitio_web: 'https://www.undp.org/es/colombia',
    url_convocatorias: 'https://procurement-notices.undp.org',
    telefono: '+57 601 488 9000',
    email: 'registry.co@undp.org',
    alcance: 'Internacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
  {
    id: 'banco-mundial',
    nombre: 'Banco Mundial Colombia',
    sigla: 'BM',
    tipo: 'MULTILATERAL',
    pais: 'Internacional',
    sitio_web: 'https://www.bancomundial.org/es/country/colombia',
    url_convocatorias: 'https://projects.worldbank.org/en/projects-operations/projects-list?countrycode_exact=CO',
    telefono: '+57 601 326 3600',
    email: 'infoBogota@worldbank.org',
    alcance: 'Internacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
  {
    id: 'ue-colombia',
    nombre: 'Unión Europea en Colombia',
    sigla: 'UE',
    tipo: 'MULTILATERAL',
    pais: 'Unión Europea',
    sitio_web: 'https://www.eeas.europa.eu/delegations/colombia',
    url_convocatorias: 'https://webgate.ec.europa.eu/europeaid/online-services/index.cfm',
    telefono: '+57 601 326 7200',
    email: 'delegation-colombia@eeas.europa.eu',
    alcance: 'Internacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
  {
    id: 'minciencias',
    nombre: 'Minciencias Colombia',
    sigla: 'MCTI',
    tipo: 'GOBIERNO',
    pais: 'Colombia',
    sitio_web: 'https://minciencias.gov.co',
    url_convocatorias: 'https://minciencias.gov.co/convocatorias',
    telefono: '+57 601 625 8480',
    email: 'servicioalciudadano@minciencias.gov.co',
    alcance: 'Nacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
  {
    id: 'jica-colombia',
    nombre: 'JICA Colombia',
    sigla: 'JICA',
    tipo: 'BILATERAL',
    pais: 'Japón',
    sitio_web: 'https://www.jica.go.jp/colombia',
    url_convocatorias: 'https://www.jica.go.jp/colombia/activities/index.html',
    telefono: '+57 601 313 8800',
    email: 'jica_colombia@jica.go.jp',
    alcance: 'Internacional',
    validation_status: 'VERIFICADO',
    fuente: 'seed_verificado',
  },
];

// Siembra entidades verificadas en directorio_entidades (sin duplicados)
export async function seedDirectorio() {
  let seeded = 0;
  for (const entity of VERIFIED_SEED_ENTITIES) {
    const existing = await getRow('SELECT id FROM directorio_entidades WHERE id = ?', [entity.id]);
    if (existing) continue;
    const now = new Date().toISOString();
    await runSql(
      `INSERT INTO directorio_entidades
       (id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias,
        telefono, email, alcance, validation_status, fuente, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        entity.id, entity.nombre, entity.sigla, entity.tipo, entity.pais,
        entity.sitio_web, entity.url_convocatorias, entity.telefono, entity.email,
        entity.alcance, entity.validation_status, entity.fuente, now, now,
      ]
    );
    seeded++;
  }
  if (seeded > 0) console.log(`[Directorio] ${seeded} entidades verificadas sembradas.`);
}
