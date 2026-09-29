/**
 * b1Guardias.test.mjs — guardias de CI de B1 (2026-09-28): retiro del gate
 * BYOK, OpenRouter como proveedor primario y REGLA DE ORO (cero datos
 * inventados). Lectura estática del repo: sin red ni BD.
 * Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const leer = (rel) => readFileSync(join(RAIZ, rel), 'utf8');
// Solo código: descarta líneas de comentario (// … y líneas de bloque /* … */).
const codigo = (src) => src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
function archivosBackend() {
  const salida = [join(RAIZ, 'server.js')];
  const recorrer = (d) => { for (const n of readdirSync(d)) {
    if (n === 'node_modules') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) recorrer(p); else if (p.endsWith('.js')) salida.push(p);
  } };
  recorrer(join(RAIZ, 'backend'));
  return salida;
}

test('ninguna ruta monta ya el gate BYOK (y el middleware no existe)', () => {
  assert.equal(existsSync(join(RAIZ, 'backend/middlewares/byokGate.js')), false);
  const conGate = archivosBackend().filter(f => /requireByokOrExento\(|from '.*byokGate\.js'/.test(codigo(readFileSync(f, 'utf8'))));
  assert.deepEqual(conGate, []);
});

test('solo openRouterCliente.js llama al endpoint de chat de OpenRouter', () => {
  const llamadores = archivosBackend().filter(f => /openrouter\.ai\/api\/v1\/chat/.test(codigo(readFileSync(f, 'utf8'))));
  assert.deepEqual(llamadores.map(f => f.replace(/\\/g, '/').split('/backend/')[1]), ['services/openRouterCliente.js']);
});

test('REGLA DE ORO: los servicios de IA del Formulador no fabrican un resultado de respaldo', () => {
  for (const rel of ['backend/services/viabilidadAgent.js', 'backend/services/CopilotoService.js', 'backend/services/mirofishComite.js', 'backend/services/EntradaIAService.js', 'backend/agents/arbolObjetivosAgent.js', 'backend/services/formuladorMga.js']) {
    const src = codigo(leer(rel));
    assert.doesNotMatch(src, /fuente:\s*'heuristica'/, `${rel}: resultado heurístico etiquetado`);
    assert.doesNotMatch(src, /calcularViabilidadHeuristica|respuestaRespaldo\(/, `${rel}: función de respaldo`);
    assert.match(src, /generarConIA/, `${rel}: debe pasar por la capa única`);
  }
});

test('el tope de gasto vive en Postgres (migración 073) y el proveedor lo consulta antes de OpenRouter', () => {
  const sql = leer('backend/migrations/073_ai_consumo_usuario.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_consumo_usuario/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  const proveedor = leer('backend/services/llmProveedor.js');
  assert.ok(proveedor.indexOf('await reservar(') < proveedor.indexOf('await llamarOpenRouter('), 'reserva ANTES de llamar');
});

test('los 503 de IA marcan X-RF-No-Retry y el cliente lo respeta (sin reenvíos que gasten cuota)', () => {
  for (const rel of ['server.js', 'backend/routes/entradaIA.routes.js', 'backend/routes/copiloto.routes.js', 'backend/routes/formulacionIntegral.routes.js']) {
    assert.match(leer(rel), /res\.set\('X-RF-No-Retry', '1'\)/, rel);
  }
  assert.match(leer('server.js'), /exposedHeaders: \['X-RF-No-Retry'\]/);
  assert.match(leer('client/src/lib/apiClient.ts'), /resp\.headers\.get\('X-RF-No-Retry'\) === '1'/);
});

test('el Co-Piloto exige plan Formulador (sin el gate BYOK consumiría IA pagada por el servidor)', () => {
  assert.match(leer('backend/routes/copiloto.routes.js'), /copiloto\/chat', authenticateToken, requireAccess\('formulador'\)/);
});
