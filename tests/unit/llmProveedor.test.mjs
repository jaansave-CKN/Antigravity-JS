/**
 * llmProveedor.test.mjs — B1 (2026-09-28): cascada OpenRouter → pool Gemini
 * → BYOK, tope de gasto por usuario y REGLA DE ORO (503 sin datos inventados).
 * fetch (OpenRouter y Gemini), presupuesto, pool de llaves, BYOK, BD, logger
 * y FinOps simulados: sin red, sin BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;

class GeminiPoolExhaustedError extends Error { constructor(m, retryAt = null) { super(m); this.retryAt = retryAt; } }
class LlmLoopGuardError extends Error { constructor() { super('bucle'); this.code = 'LLM_LOOP_GUARD'; this.status = 429; } }
class UserKeyPoolExhaustedError extends Error { constructor() { super('agotada'); this.code = 'USER_KEY_EXHAUSTED'; } }
class IaTopeAgotadoError extends Error { constructor(retryAt) { super('tope'); this.code = 'IA_TOPE_AGOTADO'; this.status = 429; this.retryAt = retryAt; } }
class PresupuestoNoVerificableError extends Error { constructor(m) { super(m); this.motivo = m; } }

const geminiCB = { keys: ['srv'] };
const estado = {};
const reiniciarEstado = () => Object.assign(estado, {
  rotacion: async (fn) => fn('srv'),
  llavesUsuario: [],
  leyoLlaves: 0,
  reservar: async () => 'reserva-1',
  liquidadas: [], liberadas: [], tokens: [], logs: [],
});

mock.module(u('services/geminiCircuitBreaker.js'), { namedExports: {
  geminiCB, GeminiPoolExhaustedError, LlmLoopGuardError,
  withKeyRotation: (fn) => estado.rotacion(fn),
  registrarLlamadaLLM: () => {},
  retryDelayDe429: () => null,
  isQuotaError: (e) => /429|quota|rate.?limit/i.test(e?.message || ''),
} });
mock.module(u('services/byokService.js'), { namedExports: {
  UserKeyPoolExhaustedError,
  resolverLlavesUsuario: async () => { estado.leyoLlaves++; return estado.llavesUsuario; },
  withUserKeyRotation: async (llaves, fn) => fn(llaves[0]),
} });
mock.module(u('services/iaPresupuesto.js'), { namedExports: {
  IaTopeAgotadoError, PresupuestoNoVerificableError,
  configPresupuesto: (env = process.env) => {
    const ok = !!env.LLM_TOPE_USD_DIA && !!env.LLM_TOPE_USD_MES;
    return { ok, faltante: ok ? [] : ['LLM_TOPE_USD_DIA'] };
  },
  estimarReservaUsd: () => 0.09,
  costoRealUsd: (usage, costo) => (Number.isFinite(costo) ? costo : 0.01),
  reservar: (...a) => estado.reservar(...a),
  liquidar: async (userId, id, datos) => { estado.liquidadas.push({ id, ...datos }); },
  liberar: async (userId, id) => { estado.liberadas.push(id); },
} });
mock.module(u('config/database.config.js'), { namedExports: { withTenantRows: async () => [] } });
mock.module(u('services/aiTokenLogger.js'), { namedExports: { logTokenUsage: async (t) => { estado.tokens.push(t); } } });
mock.module(u('utils/logger.js'), { namedExports: { logger: {
  info: () => {}, debug: () => {},
  warn: (m, extra) => estado.logs.push({ nivel: 'warn', m, ...extra }),
  error: (m, extra) => estado.logs.push({ nivel: 'error', m, ...extra }),
} } });

const { generarConIA, IaNoDisponibleError, estadoOpenRouter, estadoGroq, GUARDA_CERO_INVENCION, AGENTES_CREADORES, _reiniciarEstadoProveedor } = await import('../../backend/services/llmProveedor.js');

const MSGS = [{ role: 'system', content: 'sistema' }, { role: 'user', content: 'pregunta' }];
const respuesta = ({ status = 200, finish = 'stop', content = '{"ok":true}', usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 1150 }, model, headers = {} } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  text: async () => 'detalle',
  json: async () => ({ model, choices: [{ finish_reason: finish, message: { content } }], usage }),
});

/** Simula la red: `groq`, `openrouter` y `gemini` son funciones (cuerpo) → respuesta o lanzan. */
let llamadas = [];
function red({
  openrouter = () => respuesta({ model: 'anthropic/claude-sonnet-5', usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0007 } }),
  gemini = () => respuesta(),
  groq = () => respuesta({ model: 'openai/gpt-oss-120b', usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 400 } }),
} = {}) {
  llamadas = [];
  globalThis.fetch = async (url, init) => {
    const cuerpo = JSON.parse(init.body);
    const destino = String(url).includes('openrouter.ai') ? 'openrouter' : String(url).includes('api.groq.com') ? 'groq' : 'gemini';
    llamadas.push({ destino, cuerpo, headers: init.headers });
    return destino === 'openrouter' ? openrouter(cuerpo) : destino === 'groq' ? groq(cuerpo) : gemini(cuerpo);
  };
}

function preparar({ openrouter = true, tope = true } = {}) {
  reiniciarEstado();
  _reiniciarEstadoProveedor();
  geminiCB.keys = ['srv'];
  if (openrouter) process.env.OPENROUTER_API_KEY = 'sk-or-prueba'; else delete process.env.OPENROUTER_API_KEY;
  if (tope) { process.env.LLM_TOPE_USD_DIA = '1'; process.env.LLM_TOPE_USD_MES = '10'; }
  else { delete process.env.LLM_TOPE_USD_DIA; delete process.env.LLM_TOPE_USD_MES; }
  delete process.env.OPENROUTER_MODEL;
  // Aislado del entorno real: una GROQ_API_KEY presente no puede alterar los
  // tests de 'entrada-ia'/'arbol_objetivos' (dictamen architect, condición 5).
  delete process.env.GROQ_API_KEY; delete process.env.GROQ_MODEL; delete process.env.GROQ_LIMITE_TPM;
}

test('OpenRouter responde: modelo claude-sonnet-5, sin temperature, response_format, sin retención de datos; se reserva y liquida el costo real', async () => {
  preparar();
  red();
  const r = await generarConIA({ userId: 'u1', agente: 'viabilidad', messages: MSGS, temperature: 0.2, responseFormat: { type: 'json_object' }, validar: (t) => JSON.parse(t) });
  assert.deepEqual([r.proveedor, r.modelo], ['openrouter', 'anthropic/claude-sonnet-5']);
  assert.deepEqual(r.valor, { ok: true });
  const c = llamadas[0].cuerpo;
  assert.equal(llamadas.length, 1);
  assert.equal(c.model, 'anthropic/claude-sonnet-5');
  assert.equal(c.max_tokens, 8192);
  assert.equal('temperature' in c, false, 'claude-sonnet-5 en OpenRouter no admite temperature (verificado 2026-09-28)');
  assert.equal(c.provider.require_parameters, undefined, 'require_parameters dejaría la petición sin proveedor');
  assert.equal(c.provider.data_collection, 'deny');
  assert.deepEqual(c.response_format, { type: 'json_object' });
  assert.equal(llamadas[0].headers.Authorization, 'Bearer sk-or-prueba');
  assert.deepEqual(estado.liquidadas.map(l => [l.id, l.costoUsd]), [['reserva-1', 0.0007]], 'se liquida con usage.cost real');
  assert.equal(estado.tokens[0].costoUsdReal, 0.0007, 'FinOps con el costo real, no la tarifa de Gemini');
  assert.equal(estado.leyoLlaves, 0, 'las llaves BYOK solo se cargan si se llega al último paso');
});

test('sin OPENROUTER_API_KEY: salta directo al pool Gemini (8192 + razonamiento acotado) y lo registra una sola vez', async () => {
  preparar({ openrouter: false });
  red();
  const r = await generarConIA({ userId: 'u1', agente: 'copiloto', messages: MSGS, temperature: 0.3 });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.deepEqual(llamadas.map(l => l.destino), ['gemini']);
  assert.equal(llamadas[0].cuerpo.max_tokens, 8192);
  assert.equal(llamadas[0].cuerpo.reasoning_effort, 'low');
  assert.equal(llamadas[0].cuerpo.temperature, 0.3);
  assert.equal(estado.tokens[0].tokensOutput, 1050, 'FinOps Gemini: salida real = total − entrada (incluye razonamiento)');
  assert.equal(estado.logs.filter(l => l.motivo === 'sin_llave').length, 1);
  await generarConIA({ userId: 'u1', agente: 'copiloto', messages: MSGS });
  assert.equal(estado.logs.filter(l => l.motivo === 'sin_llave').length, 1, 'el aviso no se repite en cada llamada');
});

test('sin tope configurado: OpenRouter NO se usa (nunca gasto sin límite)', async () => {
  preparar({ tope: false });
  red();
  const r = await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.equal(llamadas.some(l => l.destino === 'openrouter'), false);
  assert.equal(estadoOpenRouter().motivo, 'sin_tope_configurado');
});

test('presupuesto no verificable (BD degradada / tabla ausente): falla cerrado, se salta OpenRouter', async () => {
  preparar();
  estado.reservar = async () => { throw new PresupuestoNoVerificableError('BD en modo REST'); };
  red();
  const r = await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.equal(llamadas.some(l => l.destino === 'openrouter'), false);
});

test('402 sin créditos: se libera la reserva, se pasa a Gemini y OpenRouter queda en pausa 10 min', async () => {
  preparar();
  red({ openrouter: () => respuesta({ status: 402 }) });
  const r = await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.deepEqual(estado.liberadas, ['reserva-1']);
  assert.equal(estado.liquidadas.length, 0, 'nada generado = nada cobrado');
  assert.equal(estadoOpenRouter().motivo, 'pausado_por_configuracion');
  llamadas = [];
  await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
  assert.deepEqual(llamadas.map(l => l.destino), ['gemini'], 'durante la pausa no se reintenta OpenRouter');
});

test('timeout de OpenRouter: la reserva se LIQUIDA (pudo haber cobrado), no se libera', async () => {
  preparar();
  red({ openrouter: () => { const e = new Error('tiempo'); e.name = 'TimeoutError'; throw e; } });
  const r = await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.equal(estado.liberadas.length, 0);
  assert.equal(estado.liquidadas.length, 1);
});

test('salida de OpenRouter rechazada por validar(): costo liquidado y se prueba Gemini, que sí cumple', async () => {
  preparar();
  red({ openrouter: () => respuesta({ content: 'no es json', usage: { cost: 0.002 } }), gemini: () => respuesta({ content: '{"nodos":[1]}' }) });
  const r = await generarConIA({ userId: 'u1', agente: 'arbol', messages: MSGS, validar: (t) => JSON.parse(t) });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.deepEqual(r.valor, { nodos: [1] });
  assert.equal(estado.liquidadas[0].costoUsd, 0.002);
});

test('respuesta cortada: en modo JSON pasa al siguiente; con permitirTruncado se entrega marcada', async () => {
  preparar({ openrouter: false });
  red({ gemini: () => respuesta({ finish: 'length', content: '{"a":' }) });
  await assert.rejects(generarConIA({ userId: 'u1', agente: 'x', messages: MSGS }), (e) => e instanceof IaNoDisponibleError);
  const r = await generarConIA({ userId: 'u1', agente: 'copiloto', messages: MSGS, permitirTruncado: true });
  assert.equal(r.truncada, true);
});

test('BYOK es el ÚLTIMO recurso: solo si OpenRouter y el pool Gemini fallaron', async () => {
  preparar({ openrouter: false });
  estado.rotacion = async () => { throw new GeminiPoolExhaustedError('pool agotado'); };
  estado.llavesUsuario = ['llave-propia'];
  red();
  const r = await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
  assert.equal(r.proveedor, 'byok');
  assert.equal(llamadas[0].headers.Authorization, 'Bearer llave-propia');
  assert.equal(estado.leyoLlaves, 1);
});

test('REGLA DE ORO: si nadie responde → 503 IA_NO_DISPONIBLE con el motivo de cada proveedor, sin texto', async () => {
  preparar();
  const reset = new Date('2026-09-29T07:00:00Z');
  red({ openrouter: () => respuesta({ status: 503 }) });
  estado.rotacion = async () => { throw new GeminiPoolExhaustedError('pool agotado', reset); };
  await assert.rejects(generarConIA({ userId: 'u1', agente: 'x', messages: MSGS }), (e) => {
    assert.ok(e instanceof IaNoDisponibleError);
    assert.deepEqual([e.status, e.code], [503, 'IA_NO_DISPONIBLE']);
    assert.deepEqual(e.intentos, [
      { proveedor: 'openrouter', motivo: 'saturado' },
      { proveedor: 'gemini_servidor', motivo: 'cuota_agotada' },
      { proveedor: 'byok', motivo: 'sin_llaves_usuario' },
    ]);
    assert.equal(e.retryAt, reset);
    return true;
  });
});

test('tope del usuario agotado y el resto de la cascada también falla → 429 IA_TOPE_AGOTADO con retryAt', async () => {
  preparar();
  const manana = new Date('2026-09-29T05:00:00Z');
  estado.reservar = async () => { throw new IaTopeAgotadoError(manana); };
  estado.rotacion = async () => { throw new GeminiPoolExhaustedError('pool agotado'); };
  red();
  await assert.rejects(generarConIA({ userId: 'u1', agente: 'x', messages: MSGS }), (e) => e.code === 'IA_TOPE_AGOTADO' && e.status === 429 && e.retryAt === manana);
  assert.equal(llamadas.some(l => l.destino === 'openrouter'), false, 'con el tope agotado no se llama a OpenRouter');
});

test('tope agotado pero Gemini responde → se entrega (el tope solo limita el gasto de OpenRouter)', async () => {
  preparar();
  estado.reservar = async () => { throw new IaTopeAgotadoError(new Date()); };
  red();
  const r = await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
  assert.equal(r.proveedor, 'gemini_servidor');
});

test('guardián anti-bucle: corta toda la cascada (no se prueba BYOK)', async () => {
  preparar({ openrouter: false });
  estado.rotacion = async () => { throw new LlmLoopGuardError(); };
  estado.llavesUsuario = ['llave-propia'];
  red();
  await assert.rejects(generarConIA({ userId: 'u1', agente: 'x', messages: MSGS }), (e) => e instanceof LlmLoopGuardError);
  assert.equal(estado.leyoLlaves, 0);
});

// ── Llamadas de SISTEMA: soloServidor + tope duro diario (núcleo 2026-09-28) ──
const TS = await import('../../backend/services/iaTopeSistema.js');
function topeFalso({ consumido = 0, pgReady = true, falla = false, fila } = {}) {
  const consultas = [];
  TS._reiniciarTopeSistema();
  TS.configurarTopeSistema({
    dbStatus: () => ({ pgReady }),
    getRow: async (sql, params) => {
      consultas.push({ sql, params });
      if (falla) throw new Error('BD caída');
      return fila !== undefined ? fila : { consumido: String(consumido) };
    },
  });
  return consultas;
}

test('soloServidor: SOLO pool Gemini — cero llamadas a OpenRouter y no se leen llaves BYOK; el tope se consulta por agentes de sistema en hora de Colombia', async () => {
  preparar();
  red();
  const consultas = topeFalso({ consumido: 1000 });
  const r = await generarConIA({ userId: 'sistema-radar-batch', agente: 'sector-classifier', soloServidor: true, maxTokens: 2048, messages: MSGS });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.equal(llamadas.some(l => l.destino === 'openrouter'), false);
  assert.equal(estado.leyoLlaves, 0);
  assert.equal(consultas.length, 1);
  assert.match(consultas[0].sql, /America\/Bogota/);
  assert.match(consultas[0].sql, /agent_name = ANY/);
  assert.deepEqual(consultas[0].params[0], TS.AGENTES_SISTEMA);
  TS._reiniciarTopeSistema();
});

test('soloServidor: tope diario excedido → IaTopeSistemaError y CERO peticiones', async () => {
  preparar();
  red();
  topeFalso({ consumido: 49_000 });
  await assert.rejects(
    generarConIA({ userId: 'sistema-radar-batch', agente: 'sector-classifier', soloServidor: true, maxTokens: 2048, messages: MSGS }),
    (e) => e.code === 'IA_TOPE_SISTEMA' && e.motivo === 'tope_diario_agotado');
  assert.equal(llamadas.length, 0);
  TS._reiniciarTopeSistema();
});

test('soloServidor FALLA CERRADO: sin configurar, BD en modo REST, consulta con error, valor no finito, tope mal configurado o agente no listado → cero peticiones', async () => {
  preparar();
  const casos = [
    ['no_configurado', () => TS._reiniciarTopeSistema()],
    ['bd_no_verificable', () => topeFalso({ pgReady: false })],
    ['consumo_no_verificable', () => topeFalso({ falla: true })],
    ['consumo_no_verificable', () => topeFalso({ fila: { consumido: 'NaN' } })],
    ['consumo_no_verificable', () => topeFalso({ fila: {} })],
  ];
  for (const [motivo, montar] of casos) {
    red(); montar();
    await assert.rejects(generarConIA({ userId: 's', agente: 'markitdown-extract', soloServidor: true, maxTokens: 2048, messages: MSGS }), (e) => e.motivo === motivo, motivo);
    assert.equal(llamadas.length, 0, motivo);
  }
  red(); topeFalso();
  process.env.LLM_TOPE_TOKENS_SISTEMA_DIA = 'mucho';
  await assert.rejects(generarConIA({ userId: 's', agente: 'lookup-entidad', soloServidor: true, messages: MSGS }), (e) => e.motivo === 'tope_mal_configurado');
  delete process.env.LLM_TOPE_TOKENS_SISTEMA_DIA;
  await assert.rejects(generarConIA({ userId: 's', agente: 'viabilidad', soloServidor: true, messages: MSGS }), (e) => e.motivo === 'agente_no_es_de_sistema');
  assert.equal(llamadas.length, 0);
  TS._reiniciarTopeSistema();
});

test('soloServidor: si el pool Gemini falla → IaNoDisponibleError con OpenRouter y BYOK OMITIDOS (nunca la llave del usuario)', async () => {
  preparar();
  red({ gemini: () => respuesta({ status: 500 }) });
  topeFalso();
  estado.llavesUsuario = ['clave-del-usuario'];
  await assert.rejects(
    generarConIA({ userId: 'u1', agente: 'lookup-entidad', soloServidor: true, maxTokens: 2048, messages: MSGS }),
    (e) => e instanceof IaNoDisponibleError
      && e.intentos.some(i => i.proveedor === 'openrouter' && i.motivo === 'omitido_solo_servidor')
      && e.intentos.some(i => i.proveedor === 'byok' && i.motivo === 'omitido_solo_servidor'));
  assert.equal(estado.leyoLlaves, 0);
  TS._reiniciarTopeSistema();
});

test('tope del sistema: el contador en memoria suma las reservas en vuelo (dos llamadas concurrentes no pasan juntas el tope)', async () => {
  topeFalso({ consumido: 45_000 });
  const primera = await TS.reservarTopeSistema('sector-classifier', 3_000);
  await assert.rejects(TS.reservarTopeSistema('sector-classifier', 3_000), (e) => e.motivo === 'tope_diario_agotado');
  TS.liquidarTopeSistema(primera, 500);
  assert.ok(await TS.reservarTopeSistema('sector-classifier', 3_000), 'liberada la reserva, cabe otra');
  TS._reiniciarTopeSistema();
});

test('Búnker: interruptor del admin apagado → OpenRouter sale de la cascada (sin fetch) y estado-cuota lo refleja', async () => {
  preparar();
  red();
  const { configurarFlagsIA, _reiniciarFlagsIA } = await import('../../backend/services/iaFlags.js');
  configurarFlagsIA({ getRow: async (sql, [clave]) => (clave === 'ia_flag_openrouter' ? { value: 'false' } : null), runSql: async () => ({}) });
  try {
    const r = await generarConIA({ userId: 'u1', agente: 'x', messages: MSGS });
    assert.equal(r.proveedor, 'gemini_servidor');
    assert.equal(llamadas.some(l => l.destino === 'openrouter'), false);
    assert.equal(estadoOpenRouter().motivo, 'deshabilitado_por_admin');
  } finally { _reiniciarFlagsIA(); }
});

test('INTEGRACIÓN #38×#41: soloServidor IGNORA los interruptores del Búnker — no los lee y nunca activa OpenRouter aunque esté encendido', async () => {
  preparar();
  red();
  topeFalso();
  const { configurarFlagsIA, _reiniciarFlagsIA } = await import('../../backend/services/iaFlags.js');
  let lecturasFlags = 0;
  configurarFlagsIA({ getRow: async () => { lecturasFlags++; return { value: 'true' }; }, runSql: async () => ({}) });
  try {
    const r = await generarConIA({ userId: 'sistema-radar-batch', agente: 'sector-classifier', soloServidor: true, maxTokens: 2048, messages: MSGS });
    assert.equal(r.proveedor, 'gemini_servidor');
    assert.equal(llamadas.some(l => l.destino === 'openrouter'), false, 'OpenRouter encendido en el Búnker no aplica al tráfico de fondo');
    assert.equal(lecturasFlags, 0, 'el tráfico de fondo ni siquiera consulta los interruptores');
  } finally { _reiniciarFlagsIA(); TS._reiniciarTopeSistema(); }
});

// ── Arquitectura híbrida Cero-Sesgo: Groq para el rol CREADOR (2026-09-30) ──
const AVISO_GROQ = '[WARN] Groq límite excedido, cayendo a Gemini...';
const MSGS_CREADOR = [{ role: 'system', content: 'Instrucciones del Árbol. Si falta un dato usa "ND".' }, { role: 'user', content: 'Genera el JSON' }];
function prepararGroq(opciones = {}) {
  preparar(opciones);
  process.env.GROQ_API_KEY = 'gsk_prueba';
}

test('Groq: creador con llave → gpt-oss-120b, $0 en FinOps, sin tocar OpenRouter; guarda anti-invención en el PRIMER system y JSON por defecto', async () => {
  prepararGroq();
  red();
  const r = await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR, temperature: 0.3, validar: (t) => JSON.parse(t) });
  assert.deepEqual([r.proveedor, r.modelo], ['groq', 'openai/gpt-oss-120b']);
  assert.deepEqual(r.valor, { ok: true });
  assert.deepEqual(llamadas.map(l => l.destino), ['groq'], 'OpenRouter (de pago) ni se intenta si Groq responde');
  const c = llamadas[0].cuerpo;
  assert.equal(c.model, 'openai/gpt-oss-120b');
  assert.equal(c.reasoning_effort, 'low');
  assert.equal(c.include_reasoning, false);
  assert.equal('reasoning_format' in c, false, 'gpt-oss no admite reasoning_format (400)');
  assert.deepEqual(c.response_format, { type: 'json_object' });
  assert.equal(c.temperature, 0.3);
  assert.ok(c.max_completion_tokens >= 2048 && c.max_completion_tokens <= 7200, `salida dentro del límite por minuto (${c.max_completion_tokens})`);
  assert.equal(c.messages.filter(m => m.role === 'system').length, 1, 'no se agrega un segundo system');
  assert.ok(c.messages[0].content.startsWith(GUARDA_CERO_INVENCION));
  assert.match(c.messages[0].content, /Si falta un dato usa "ND"/, 'se conserva la convención del llamador');
  assert.match(GUARDA_CERO_INVENCION, /convención para datos ausentes que indiquen las instrucciones/);
  assert.equal(llamadas[0].headers.Authorization, 'Bearer gsk_prueba');
  assert.deepEqual([estado.tokens[0].agentName, estado.tokens[0].costoUsdReal, estado.tokens[0].tokensOutput], ['arbol_objetivos', 0, 280]);
  assert.equal(estado.liquidadas.length + estado.liberadas.length, 0, 'Groq no toca el presupuesto en USD');
});

test('Groq: el response_format del llamador (json_schema) se respeta; sin system propio se agrega uno con la guarda', async () => {
  prepararGroq({ openrouter: false });
  red();
  const esquema = { type: 'json_schema', json_schema: { name: 'x', schema: { type: 'object' } } };
  await generarConIA({ userId: 'u1', agente: 'entrada-ia', messages: [{ role: 'user', content: 'JSON por favor' }], responseFormat: esquema });
  assert.deepEqual(llamadas[0].cuerpo.response_format, esquema);
  assert.deepEqual(llamadas[0].cuerpo.messages[0], { role: 'system', content: GUARDA_CERO_INVENCION });
});

for (const [status, headers] of [[413, {}], [429, { 'retry-after': '30' }], [503, {}]]) {
  test(`Groq ${status} → aviso literal y cae a Gemini con la petición original (sin la guarda)`, async () => {
    prepararGroq({ openrouter: false });
    red({ groq: () => respuesta({ status, headers }) });
    const r = await generarConIA({ userId: 'u1', agente: 'entrada-ia', messages: MSGS_CREADOR, validar: (t) => JSON.parse(t) });
    assert.equal(r.proveedor, 'gemini_servidor');
    assert.deepEqual(llamadas.map(l => l.destino), ['groq', 'gemini']);
    assert.equal(llamadas[1].cuerpo.messages[0].content, MSGS_CREADOR[0].content, 'Gemini recibe el prompt tal cual (comportamiento ya probado)');
    assert.equal('response_format' in llamadas[1].cuerpo, false);
    const aviso = estado.logs.filter(l => l.m === AVISO_GROQ);
    assert.equal(aviso.length, 1);
    assert.deepEqual([aviso[0].nivel, aviso[0].status], ['warn', status]);
  });
}

test('Groq 429: pausa según retry-after (sin volver a llamarlo) y como máximo 10 min', async () => {
  prepararGroq({ openrouter: false });
  red({ groq: () => respuesta({ status: 429, headers: { 'retry-after': '30' } }) });
  await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR });
  assert.equal(estadoGroq().motivo, 'pausado');
  assert.equal(estadoGroq(process.env, Date.now() + 31_000).activo, true, 'la pausa dura lo que dijo retry-after');
  llamadas = [];
  await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR });
  assert.deepEqual(llamadas.map(l => l.destino), ['gemini'], 'durante la pausa no se reintenta Groq');

  prepararGroq({ openrouter: false });
  red({ groq: () => respuesta({ status: 429, headers: { 'retry-after': '99999' } }) });
  await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR });
  assert.equal(estadoGroq(process.env, Date.now() + 10 * 60_000 + 1_000).activo, true, 'tope de 10 min');
  prepararGroq({ openrouter: false });
  red({ groq: () => respuesta({ status: 429 }) });
  await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR });
  assert.equal(estadoGroq(process.env, Date.now() + 30_000).motivo, 'pausado', 'sin retry-after: pausa por defecto de 60 s');
  assert.equal(estadoGroq(process.env, Date.now() + 61_000).activo, true);
});

test('Groq 401: pausa 10 min con error (acción del dueño); salida inválida → siguiente proveedor', async () => {
  prepararGroq({ openrouter: false });
  red({ groq: () => respuesta({ status: 401 }) });
  assert.equal((await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR })).proveedor, 'gemini_servidor');
  assert.equal(estadoGroq().motivo, 'pausado');
  assert.ok(estado.logs.some(l => l.nivel === 'error' && /Groq rechazó la llave/.test(l.m)));
  assert.equal(estado.logs.some(l => l.m === AVISO_GROQ), false, '401 no es un límite excedido');

  prepararGroq({ openrouter: false });
  red({ groq: () => respuesta({ content: 'esto no es json' }), gemini: () => respuesta({ content: '{"nodos":[1]}' }) });
  const r = await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR, validar: (t) => JSON.parse(t) });
  assert.deepEqual([r.proveedor, r.valor], ['gemini_servidor', { nodos: [1] }]);
  assert.equal(estado.tokens[0].costoUsdReal, 0, 'lo que Groq consumió igual queda en FinOps');
});

test('Groq: contexto que no cabe en el límite por minuto → bypass a Gemini SIN petición (evita el 413)', async () => {
  prepararGroq({ openrouter: false });
  red();
  const grande = [{ role: 'system', content: 'x'.repeat(30_000) }, { role: 'user', content: 'JSON' }];
  const r = await generarConIA({ userId: 'u1', agente: 'entrada-ia', messages: grande });
  assert.equal(r.proveedor, 'gemini_servidor');
  assert.deepEqual(llamadas.map(l => l.destino), ['gemini']);
  process.env.GROQ_LIMITE_TPM = '60000';
  red();
  await generarConIA({ userId: 'u1', agente: 'entrada-ia', messages: grande });
  assert.equal(llamadas[0].destino, 'groq', 'con un límite mayor configurado (plan de pago) sí cabe');
});

test('Groq: auditores, copiloto y tráfico soloServidor NUNCA van a Groq aunque haya llave', async () => {
  prepararGroq({ openrouter: false });
  topeFalso();
  for (const [agente, extra] of [['viabilidad', {}], ['mirofish_comite', {}], ['copiloto', {}], ['sector-classifier', { soloServidor: true, maxTokens: 2048 }]]) {
    red();
    await generarConIA({ userId: 'u1', agente, messages: MSGS, ...extra });
    assert.equal(llamadas.some(l => l.destino === 'groq'), false, agente);
  }
  assert.deepEqual(AGENTES_CREADORES, ['entrada-ia', 'arbol_objetivos', 'formulador_mga', 'expediente_financiador']);
  TS._reiniciarTopeSistema();
});

test('Groq: interruptor del Búnker apagado → sin petición; sin llave → la REGLA DE ORO lista el motivo de Groq', async () => {
  prepararGroq({ openrouter: false });
  red();
  const { configurarFlagsIA, _reiniciarFlagsIA } = await import('../../backend/services/iaFlags.js');
  configurarFlagsIA({ getRow: async (sql, [clave]) => (clave === 'ia_flag_groq' ? { value: 'false' } : null), runSql: async () => ({}) });
  try {
    const r = await generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR });
    assert.equal(r.proveedor, 'gemini_servidor');
    assert.equal(llamadas.some(l => l.destino === 'groq'), false);
    assert.equal(estadoGroq().motivo, 'deshabilitado_por_admin');
  } finally { _reiniciarFlagsIA(); }

  preparar({ openrouter: false });
  estado.rotacion = async () => { throw new GeminiPoolExhaustedError('pool agotado'); };
  red();
  await assert.rejects(generarConIA({ userId: 'u1', agente: 'arbol_objetivos', messages: MSGS_CREADOR }), (e) => {
    assert.ok(e instanceof IaNoDisponibleError);
    assert.deepEqual(e.intentos.map(i => i.proveedor), ['groq', 'openrouter', 'gemini_servidor', 'byok']);
    assert.equal(e.intentos[0].motivo, 'sin_llave');
    return true;
  });
  assert.equal(llamadas.some(l => l.destino === 'groq'), false);
});

test('groqCliente: retry-after en segundos (entero o decimal) → ms; ausente o basura → null', async () => {
  const { retryAfterMs } = await import('../../backend/services/groqCliente.js');
  assert.deepEqual([retryAfterMs('30'), retryAfterMs('2.5'), retryAfterMs(null), retryAfterMs('abc'), retryAfterMs('0')], [30_000, 2_500, null, null, null]);
});

test('Groq: si Groq y el resto fallan → 503 honesto con el motivo de Groq primero (nunca texto inventado)', async () => {
  prepararGroq();
  estado.rotacion = async () => { throw new GeminiPoolExhaustedError('pool agotado'); };
  red({ groq: () => respuesta({ status: 503 }), openrouter: () => respuesta({ status: 503 }) });
  await assert.rejects(generarConIA({ userId: 'u1', agente: 'formulador_mga', messages: MSGS_CREADOR }), (e) =>
    e instanceof IaNoDisponibleError && e.intentos[0].proveedor === 'groq' && e.intentos[0].motivo === 'saturado');
});
