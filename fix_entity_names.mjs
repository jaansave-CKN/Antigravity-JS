/**
 * fix_entity_names.mjs — Saneamiento de nombres de entidades en PostgreSQL
 *
 * Detecta registros con nombres ruidosos (títulos de pestaña web, palabras de
 * navegación) y los reemplaza con el nombre oficial de la organización,
 * extrayendo en este orden de prioridad:
 *   1. JSON-LD (schema.org Organization.name)
 *   2. og:site_name (meta tag)
 *   3. Limpieza del <title> (eliminar prefijos de navegación)
 *   4. Gemini (si la clave API está disponible)
 *
 * Uso:
 *   node fix_entity_names.mjs [--dry-run]
 *
 * --dry-run: muestra los cambios propuestos sin escribir en la BD.
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const FETCH_TIMEOUT = 12_000;

// ── Conexión a PostgreSQL ─────────────────────────────────────────────────────
function buildConnStr(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch { return url.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''); }
}

const isLocal = process.env.DATABASE_URL?.match(/localhost|127\.0\.0\.1/);
const pool = new Pool({
  connectionString: buildConnStr(process.env.DATABASE_URL),
  ssl: isLocal ? false : { rejectUnauthorized: false },
  options: '-c search_path=public',
  max: 5,
});

// ── Patrones de nombres ruidosos ──────────────────────────────────────────────
const NOISY_PATTERNS = [
  /^home\b/i,
  /^homepage\b/i,
  /^inicio\b/i,
  /^index\b/i,
  /^welcome\b/i,
  /^bienvenid/i,
  /^convocatorias?\s*[-|–]/i,
  /^grants?\s*[-|–]/i,
  /^funding\s*[-|–]/i,
  /^opportunities\s*[-|–]/i,
  /\b(home|homepage|inicio|index)\s*[|(–\-]/i,
  /^error\s*\d{3}/i,
  /^page\s+not\s+found/i,
];

function isNoisyName(nombre) {
  return NOISY_PATTERNS.some(p => p.test(nombre?.trim() ?? ''));
}

// ── Extracción HTML del nombre oficial ───────────────────────────────────────
async function extractOfficialName(url) {
  if (!url) return null;
  let html = '';
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos-Cleaner/1.0' },
    });
    html = await res.text();
  } catch { return null; }

  // 1. JSON-LD schema.org — fuente más autoritativa
  const ldMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    try {
      const json = JSON.parse(m[1]);
      const nodes = Array.isArray(json) ? json : [json, ...(json['@graph'] ?? [])];
      for (const node of nodes) {
        if (/@type/.test(JSON.stringify(node)) &&
            /Organization|NGO|GovernmentOrganization|EducationalOrganization|Corporation|Foundation/i.test(node['@type'])) {
          if (node.name && typeof node.name === 'string' && node.name.trim().length > 3) {
            return node.name.trim();
          }
        }
      }
    } catch { /* JSON inválido, continuar */ }
  }

  // 2. og:site_name — refleja el nombre de la organización, no el título de la página
  const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
               ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  if (ogSite?.[1]?.trim()) {
    const name = ogSite[1].trim();
    if (name.length >= 4 && !isNoisyName(name)) return name;
  }

  // 3. <title> limpio: quitar prefijos de navegación y sufijos genéricos
  const tagTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '';
  if (tagTitle) {
    // Quitar ruido después del separador (Home | NombreOrg → NombreOrg)
    const parts = tagTitle.split(/\s*[\|–\-—]\s*/);
    // Intentar la parte que NO es ruido
    const clean = parts.find(p => !isNoisyName(p.trim()) && p.trim().length >= 3)?.trim();
    if (clean) return clean;
  }

  // 4. meta name="application-name"
  const appName = html.match(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (appName?.trim() && !isNoisyName(appName)) return appName.trim();

  return null;
}

// ── Fallback Gemini para nombres difíciles ────────────────────────────────────
async function askGemini(sigla, sitio_web) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `Devuelve SOLO el nombre oficial completo de la organización con sigla "${sigla}" y sitio web "${sitio_web}". Sin explicaciones, solo el nombre.`;
    const result = await model.generateContent(prompt);
    const name = result.response.text().trim().replace(/^["']|["']$/g, '');
    return name.length >= 4 ? name : null;
  } catch { return null; }
}

// ── Migración principal ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  fix_entity_names.mjs${DRY_RUN ? ' [DRY-RUN — sin escritura]' : ''}`);
  console.log(`${'='.repeat(60)}\n`);

  const client = await pool.connect();
  try {
    // Traer todas las entidades — comparar nombre localmente (evita depender de ILIKE SQL para cada patrón)
    const { rows: allEntities } = await client.query(
      'SELECT id, nombre, sigla, sitio_web, url_convocatorias FROM directorio_entidades WHERE deleted_at IS NULL ORDER BY created_at'
    );

    const toFix = allEntities.filter(e => isNoisyName(e.nombre));

    console.log(`Total entidades en BD:  ${allEntities.length}`);
    console.log(`Con nombre ruidoso:     ${toFix.length}\n`);

    if (toFix.length === 0) {
      console.log('✓ No hay nombres que sanear. Base de datos limpia.');
      return;
    }

    const results = { fixed: 0, skipped: 0, errors: 0 };

    for (const entity of toFix) {
      const webUrl = entity.sitio_web || entity.url_convocatorias;
      console.log(`\n─── ${entity.nombre} (${entity.sigla ?? 'sin sigla'}) ───`);
      console.log(`    URL: ${webUrl ?? 'ninguna'}`);

      let newName = null;

      // Paso 1: extracción HTML
      if (webUrl) {
        newName = await extractOfficialName(webUrl);
        if (newName) console.log(`    → HTML:   "${newName}"`);
      }

      // Paso 2: Gemini como último recurso
      if (!newName && (entity.sigla || webUrl)) {
        newName = await askGemini(entity.sigla ?? '', webUrl ?? '');
        if (newName) console.log(`    → Gemini: "${newName}"`);
      }

      if (!newName || newName === entity.nombre) {
        console.log('    ✗ Sin mejora disponible — registro omitido.');
        results.skipped++;
        continue;
      }

      // Validar que el nombre propuesto no sea ruidoso
      if (isNoisyName(newName)) {
        console.log(`    ✗ Nombre propuesto también es ruidoso — omitido.`);
        results.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`    [DRY-RUN] Actualizaría: "${entity.nombre}" → "${newName}"`);
        results.fixed++;
        continue;
      }

      // Escribir en BD dentro de transacción por fila
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE directorio_entidades SET nombre = $1, updated_at = NOW() WHERE id = $2',
          [newName, entity.id]
        );
        await client.query('COMMIT');
        console.log(`    ✓ Actualizado: "${entity.nombre}" → "${newName}"`);
        results.fixed++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`    ✗ Error al actualizar: ${err.message}`);
        results.errors++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Resultado${DRY_RUN ? ' (DRY-RUN)' : ''}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Corregidos: ${results.fixed}`);
    console.log(`  Omitidos:   ${results.skipped}`);
    console.log(`  Errores:    ${results.errors}`);
    console.log(`${'='.repeat(60)}\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
