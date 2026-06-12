// Script de ingesta manual — carga Minciencias + Banco Mundial en la BD
// Uso: node --env-file=.env _ingest_now.mjs
import { ingestConvocatorias } from './backend/pipeline/DataIngestor.js';

console.log('[Ingest] Iniciando ingesta manual...');
const start = Date.now();

try {
  const result = await ingestConvocatorias();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[Ingest] ✓ Completado en ${elapsed}s`);
  console.log(`  Minciencias:   ${result.minciencias.inserted} nuevas, ${result.minciencias.skipped} omitidas${result.minciencias.errorMsg ? ' | ERROR: ' + result.minciencias.errorMsg : ''}`);
  console.log(`  Banco Mundial: ${result.worldbank.inserted} nuevas, ${result.worldbank.skipped} omitidas${result.worldbank.errorMsg ? ' | ERROR: ' + result.worldbank.errorMsg : ''}`);
  const total = result.minciencias.inserted + result.worldbank.inserted;
  console.log(`\n  TOTAL INSERTADAS: ${total}`);
} catch (e) {
  console.error('[Ingest] Error fatal:', e.message);
  process.exit(1);
}
