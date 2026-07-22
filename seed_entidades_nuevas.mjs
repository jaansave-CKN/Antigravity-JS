/**
 * seed_entidades_nuevas.mjs — Siembra 7 entidades solicitadas en directorio_entidades
 *                             y ejecuta Greedy Match para vincular convocatorias existentes.
 *
 * Uso:
 *   node seed_entidades_nuevas.mjs [--dry-run]
 *
 * Deduplica por: sigla exacto, nombre exacto, root_domain exacto.
 * Lloyd's Register Foundation aparecía en dos URLs — se inserta una sola vez.
 */

import 'dotenv/config';
import crypto from 'crypto';
import pg from 'pg';
import { getApexDomain } from './backend/utils/domainUtils.js';

const { Pool } = pg;
const DRY_RUN = process.argv.includes('--dry-run');

// ── 7 entidades únicas ────────────────────────────────────────────────────────
const ENTIDADES = [
  {
    sigla: 'FFEM',
    nombre: 'Fonds Français pour l\'Environnement Mondial',
    pais: 'Francia',
    tipo: 'BILATERAL',
    alcance: 'Internacional',
    sitio_web: 'https://www.ffem.fr',
    url_convocatorias: 'https://www.ffem.fr/en/submit-project',
    telefono: '',
    email: '',
  },
  {
    sigla: 'AJA Foundation',
    nombre: 'AJA Foundation',
    pais: 'Estados Unidos',
    tipo: 'FUNDACIÓN',
    alcance: 'Internacional',
    sitio_web: 'https://www.ajafoundation.org',
    url_convocatorias: 'https://www.ajafoundation.org/how-to-apply/',
    telefono: '',
    email: '',
  },
  {
    sigla: 'LRF',
    nombre: "Lloyd's Register Foundation",
    pais: 'Reino Unido',
    tipo: 'FUNDACIÓN',
    alcance: 'Internacional',
    sitio_web: 'https://www.lrfoundation.org.uk',
    url_convocatorias: 'https://www.lrfoundation.org.uk/partnerships-and-funding/grant-funding',
    telefono: '',
    email: '',
  },
  {
    sigla: 'DRK',
    nombre: 'DRK Foundation',
    pais: 'Estados Unidos',
    tipo: 'FUNDACIÓN',
    alcance: 'Internacional',
    sitio_web: 'https://www.drkfoundation.org',
    url_convocatorias: 'https://www.drkfoundation.org/apply/',
    telefono: '',
    email: '',
  },
  {
    sigla: 'Roddenberry',
    nombre: 'Roddenberry Foundation',
    pais: 'Estados Unidos',
    tipo: 'FUNDACIÓN',
    alcance: 'Internacional',
    sitio_web: 'https://roddenberryfoundation.org',
    url_convocatorias: 'https://roddenberryfoundation.org/',
    telefono: '',
    email: '',
  },
  {
    sigla: 'CFC',
    nombre: 'Common Fund for Commodities',
    pais: 'Países Bajos',
    tipo: 'MULTILATERAL',
    alcance: 'Internacional',
    sitio_web: 'https://www.common-fund.org',
    url_convocatorias: 'https://www.common-fund.org/call-for-proposals',
    telefono: '',
    email: '',
  },
  {
    sigla: 'Innovamos',
    nombre: 'Innovamos — MinCiencias Colombia',
    pais: 'Colombia',
    tipo: 'GOBIERNO',
    alcance: 'Nacional',
    sitio_web: 'https://www.innovamos.gov.co',
    url_convocatorias: 'https://www.innovamos.gov.co/',
    telefono: '',
    email: '',
  },
];

// ── Conexión PostgreSQL ───────────────────────────────────────────────────────
let connStr = process.env.DATABASE_URL || '';
try {
  const u = new URL(connStr);
  u.searchParams.delete('sslmode');
  connStr = u.toString();
} catch {}

const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.match(/localhost|127\.0\.0\.1/) ? false : { rejectUnauthorized: false },
  max: 3,
});

// ── Greedy Match — T1 texto fuzzy (PostgreSQL $N placeholders) ───────────────
async function greedyT1(client, id, nombre, sigla) {
  const n = nombre.trim();
  const s = (sigla || '').trim();
  await client.query(`
    UPDATE convocatorias SET entidad_id = $1
    WHERE entidad_id IS NULL AND deleted_at IS NULL
      AND (
        LOWER(donante) = LOWER($2)
        OR ($3 != '' AND LOWER(donante) = LOWER($3))
        OR LOWER(donante) LIKE '%' || LOWER($4) || '%'
        OR (LENGTH(donante) > 4 AND LOWER($5) LIKE '%' || LOWER(donante) || '%')
        OR ($6 != '' AND LENGTH($7) > 2 AND LOWER(donante) LIKE '%' || LOWER($8) || '%')
      )
  `, [id, n, s, n, n, s, s, s]);
}

// ── Greedy Match — T2 hostname endsWith ──────────────────────────────────────
async function greedyT2(client, id, entRoot) {
  if (!entRoot) return;
  await client.query(`
    UPDATE convocatorias
    SET entidad_id = $1, root_domain = COALESCE(root_domain, $2)
    WHERE entidad_id IS NULL AND deleted_at IS NULL
      AND (
        LOWER(COALESCE(root_domain,'')) = LOWER($3)
        OR LOWER(COALESCE(root_domain,'')) LIKE '%.' || LOWER($4)
        OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_fuente,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) = LOWER($5)
        OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_fuente,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) LIKE '%.' || LOWER($6)
        OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_convocatoria,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) = LOWER($7)
        OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_convocatoria,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) LIKE '%.' || LOWER($8)
      )
  `, [id, entRoot, entRoot, entRoot, entRoot, entRoot, entRoot, entRoot]);
}

// ── Greedy Match — T3 email domain ───────────────────────────────────────────
async function greedyT3(client, id, entRoot) {
  if (!entRoot) return;
  const safeRoot = entRoot.replace(/[%_\\;'"]/g, '');
  await client.query(`
    UPDATE convocatorias SET entidad_id = $1
    WHERE entidad_id IS NULL AND deleted_at IS NULL
      AND donante LIKE '%@%'
      AND LOWER(SUBSTRING(donante FROM POSITION('@' IN donante) + 1)) LIKE '%' || LOWER($2) || '%'
  `, [id, safeRoot]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(65)}`);
  console.log(`  seed_entidades_nuevas.mjs${DRY_RUN ? ' [DRY-RUN — sin escritura]' : ''}`);
  console.log(`${'='.repeat(65)}\n`);

  const client = await pool.connect();
  try {
    const stats = { insertadas: 0, existentes: 0, convocatorias_vinculadas: 0 };

    for (const src of ENTIDADES) {
      const apex = getApexDomain(src.sitio_web);

      // ── Verificar si ya existe ───────────────────────────────────────────
      const { rows: exists } = await client.query(
        `SELECT id FROM directorio_entidades
         WHERE deleted_at IS NULL AND (
           LOWER(sigla)  = LOWER($1)
           OR LOWER(nombre) = LOWER($2)
           OR (root_domain IS NOT NULL AND root_domain != '' AND LOWER(root_domain) = LOWER($3))
         ) LIMIT 1`,
        [src.sigla, src.nombre, apex || '']
      );

      if (exists.length > 0) {
        const eid = exists[0].id;
        console.log(`  [OK]  ${src.sigla.padEnd(14)} ya existe (id: ${eid.slice(0, 8)}...)`);
        // Asegurar root_domain seteado
        if (!DRY_RUN && apex) {
          await client.query(
            `UPDATE directorio_entidades SET root_domain = $1
             WHERE id = $2 AND (root_domain IS NULL OR root_domain = '')`,
            [apex, eid]
          );
        }
        stats.existentes++;
        continue;
      }

      // ── Insertar nueva entidad ───────────────────────────────────────────
      const id = crypto.randomUUID();
      console.log(`  [NEW] ${src.sigla.padEnd(14)} → insertando (${apex})`);

      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO directorio_entidades
             (id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias,
              telefono, email, alcance, validation_status, fuente,
              root_domain, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
           ON CONFLICT DO NOTHING`,
          [
            id,
            src.nombre,
            src.sigla,
            src.tipo,
            src.pais,
            src.sitio_web,
            src.url_convocatorias,
            src.telefono,
            src.email,
            src.alcance,
            'IMPORTADO',
            'SEED_MANUAL',
            apex || null,
          ]
        );

        // ── Greedy Match: vincular convocatorias existentes ────────────────
        let vinc = 0;
        const before = await client.query(
          `SELECT COUNT(*) AS c FROM convocatorias WHERE entidad_id = $1`, [id]
        );

        try { await greedyT1(client, id, src.nombre, src.sigla); } catch (e) { console.warn(`    [greedy/T1] ${e.message?.slice(0,80)}`); }
        try { await greedyT2(client, id, apex); } catch (e) { console.warn(`    [greedy/T2] ${e.message?.slice(0,80)}`); }
        try { await greedyT3(client, id, apex); } catch (e) { console.warn(`    [greedy/T3] ${e.message?.slice(0,80)}`); }

        const after = await client.query(
          `SELECT COUNT(*) AS c FROM convocatorias WHERE entidad_id = $1`, [id]
        );
        vinc = Number(after.rows[0].c) - Number(before.rows[0].c);
        if (vinc > 0) console.log(`         → ${vinc} convocatoria(s) vinculadas`);
        stats.convocatorias_vinculadas += vinc;
      }
      stats.insertadas++;
    }

    console.log(`\n${'='.repeat(65)}`);
    console.log(`  Resultado${DRY_RUN ? ' (DRY-RUN — nada escrito)' : ''}`);
    console.log(`${'='.repeat(65)}`);
    console.log(`  Entidades insertadas           : ${stats.insertadas}`);
    console.log(`  Entidades ya existían          : ${stats.existentes}`);
    console.log(`  Convocatorias vinculadas (R2→R1): ${stats.convocatorias_vinculadas}`);
    console.log();

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('[seed_entidades_nuevas] Error fatal:', e.message);
  process.exit(1);
});
