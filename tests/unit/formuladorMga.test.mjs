/**
 * formuladorMga.test.mjs — Fase 3: Formulador MGA (consolidador, NVIDIA NIM).
 * Cubre la regla de oro numérica (B4, casos R9 del architect), la recolección
 * (B2/B3/R4/R5), el 422 previo (faltantesFormulador) y la llamada a NIM
 * (sin llave, respuesta válida, cifra inventada, truncada). Sin red ni BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
const tokens = [];
mock.module(u('services/aiTokenLogger.js'), { namedExports: { logTokenUsage: async (t) => { tokens.push(t); } } });

const F = await import(u('services/formuladorMga.js'));
const { faltantesFormulador } = await import(u('services/datosMinimosIA.js'));
const { MAX_TOKENS_NIM, NIM_URL, limpiarRazonamiento } = await import(u('services/nimCliente.js'));

// ── Formato único (B4.1) ─────────────────────────────────────────────────────
test('formato: COP es-CO sin decimales, negativos, % con 1 decimal, null se omite', () => {
  assert.equal(F.cop(1234567.4), '$ 1.234.567');
  assert.equal(F.cop(-12345), '-$ 12.345');
  assert.equal(F.pctDeFraccion(0.8123), '81,2 %');
  assert.equal(F.pctDeFraccion(null), null, 'TIR nula nunca es "0 %"');
  assert.match(F.fechaLarga('2026-10-01T15:00:00Z'), /^1 de octubre de 2026$/);
});

// ── Tokenizador y validación por párrafo (B4, casos R9) ──────────────────────
test('tokens: pesos, porcentajes y puntajes; ids como R1 o p50 no son números', () => {
  assert.deepEqual(F.tokensNumericos('$ 1.234.567'), [{ valor: '1234567', pct: false }]);
  assert.deepEqual(F.tokensNumericos('81,2 %'), [{ valor: '81.2', pct: true }]);
  assert.deepEqual(F.tokensNumericos('81,2%'), [{ valor: '81.2', pct: true }]);
  assert.deepEqual(F.tokensNumericos('-$ 12.345'), [{ valor: '-12345', pct: false }]);
  assert.deepEqual(F.tokensNumericos('72/100').map(t => t.valor), ['72', '100']);
  assert.deepEqual(F.tokensNumericos('regla R1 y percentil p50'), []);
});

const DATOS = {
  'finanzas.van_p50_cop': '$ 45.300.000',
  'finanzas.van_p10_cop': '-$ 12.345',
  'finanzas.probabilidad_van_positivo': '81,2 %',
  'finanzas.apu_total_cop': '$ 412.000.000 (según APU en Anexos)',
  'entrada.numeroBeneficiarios': '320',
  'viabilidad.fecha': '1 de octubre de 2026',
};

test('cifra copiada literal de SU fuente → válida', () => {
  assert.deepEqual(F.cifrasNoTrazables('El VAN mediano es de $ 45.300.000.', ['finanzas.van_p50_cop'], DATOS), []);
  assert.deepEqual(F.cifrasNoTrazables('Probabilidad de VAN positivo del 81,2%.', ['finanzas.probabilidad_van_positivo'], DATOS), [], '% sin espacio');
});

test('cifra real pero de OTRO campo no citado → no trazable', () => {
  assert.deepEqual(F.cifrasNoTrazables('Beneficia a 320 familias con $ 412.000.000.', ['entrada.numeroBeneficiarios'], DATOS), ['412000000']);
});

test('años y normas sin respaldo → no trazables (sin excepción)', () => {
  assert.deepEqual(F.cifrasNoTrazables('Conforme a la Ley 1450 de 2011.', ['entrada.numeroBeneficiarios'], DATOS), ['1450', '2011']);
  assert.deepEqual(F.cifrasNoTrazables('Dictamen del 1 de octubre de 2026.', ['viabilidad.fecha'], DATOS), []);
});

test('ordinales e ids citados en el texto no cuentan como cifras', () => {
  assert.deepEqual(F.cifrasNoTrazables('En 3er lugar, ver finanzas.van_p50_cop: $ 45.300.000.', ['finanzas.van_p50_cop'], DATOS), []);
});

test('VAN negativo: el valor absoluto solo pasa si el texto dice "negativo"', () => {
  assert.deepEqual(F.cifrasNoTrazables('En el escenario pesimista el VAN es negativo: $ 12.345.', ['finanzas.van_p10_cop'], DATOS), []);
  assert.deepEqual(F.cifrasNoTrazables('En el escenario pesimista el VAN es de $ 12.345.', ['finanzas.van_p10_cop'], DATOS), ['12345']);
});

test('un % solo coincide con un %; cifras redondeadas se descartan', () => {
  assert.deepEqual(F.cifrasNoTrazables('Probabilidad de 81,2.', ['finanzas.probabilidad_van_positivo'], DATOS), ['81.2']);
  assert.deepEqual(F.cifrasNoTrazables('Probabilidad de 81 %.', ['finanzas.probabilidad_van_positivo'], DATOS), ['81%']);
});

test('validarConsolidacion: sin fuente, fuente inexistente, cifra no trazable, tope de párrafos y bloque vacío', () => {
  const salida = {
    identificacion_problema: { parrafos: [
      { texto: 'Válido: 320 beneficiarios.', fuentes: ['entrada.numeroBeneficiarios'] },
      { texto: 'Sin fuente.', fuentes: [] },
      { texto: 'Fuente inventada.', fuentes: ['entrada.no_existe'] },
      { texto: 'Cifra inventada: 999.', fuentes: ['entrada.numeroBeneficiarios'] },
      { texto: 'Quinto párrafo (se ignora por el tope).', fuentes: ['entrada.numeroBeneficiarios'] },
    ] },
    poblacion_beneficiaria: { parrafos: [] },
  };
  const r = F.validarConsolidacion(salida, DATOS);
  assert.equal(r.bloques.identificacion_problema.parrafos.length, 1);
  assert.deepEqual(r.descartados.map(d => d.motivo), ['sin_fuente', 'fuente_inexistente', 'cifra_no_trazable']);
  assert.equal(r.bloques.poblacion_beneficiaria.estado, 'sin_contenido_verificable');
  assert.equal(r.bloques.analisis_riesgos.estado, 'sin_contenido_verificable', 'bloque ausente en la salida');
  assert.equal(r.parrafosValidos, 1);
});

test('extraerJson tolera cercas ``` y texto alrededor; limpiarRazonamiento quita <think>', () => {
  assert.deepEqual(F.extraerJson('Aquí va:\n```json\n{"a":{"b":"}"}}\n```\nfin'), { a: { b: '}' } });
  assert.equal(F.extraerJson('sin json'), null);
  assert.equal(limpiarRazonamiento('<think>pienso {x}</think>\n{"ok":1}'), '{"ok":1}');
});

// ── Recolección (B2, B3, R4, R5) ─────────────────────────────────────────────
function fakeDeps({ apu = [{ valor_total_cop: 1000 }], corrida = null, mirofish = null, logistica = null } = {}) {
  return {
    getRow: async (sql) => (/config_logistica/.test(sql) ? logistica : /mirofish/.test(sql) ? mirofish : /montecarlo/.test(sql) ? corrida : null),
    getRows: async () => apu,
  };
}
const proyectoBase = (ft) => ({ id: 'p1', nombre: 'Acueducto veredal', ficha_tecnica: ft });
const RESULTADO_MC = { van: { p10_cop: -500, p50_cop: 2500, p90_cop: 9000 }, probabilidad_van_positivo: 0.7, tir: { p50: null } };

test('recolección: sectores con "Otro" resuelto, logística como ubicación, TIR nula omitida', async () => {
  const ft = { entrada_completa: { sectores: ['Agua', 'Otro'], sectorOtro: { Otro: 'Riego comunitario' }, nivelProyecto: 'Municipal', numeroBeneficiarios: '320', camposBloqueados: { x: true } } };
  const corrida = { inversion_cop: 1000, tasa_descuento: 0.12, horizonte_anios: 10, iteraciones: 10000, resultado: RESULTADO_MC, created_at: '2026-09-25T12:00:00Z' };
  const { datos, meta } = await F.recolectarFuentes(proyectoBase(ft), fakeDeps({ corrida, logistica: { municipio: 'Argelia', departamento: 'Cauca' } }));
  assert.equal(datos['entrada.sectores'], 'Agua; Riego comunitario');
  assert.equal(datos['logistica.municipio'], 'Argelia');
  assert.equal(datos['finanzas.van_p10_cop'], '-$ 500');
  assert.equal(datos['finanzas.tasa_descuento'], '12,0 %');
  assert.equal(datos['finanzas.probabilidad_van_positivo'], '70,0 %');
  assert.ok(!('finanzas.tir_p50' in datos), 'TIR nula no se escribe');
  assert.ok(!Object.keys(datos).some(k => k.includes('camposBloqueados')));
  assert.equal(meta.corrida, 'vigente');
  assert.equal(meta.ubicacion, true);
});

test('recolección: corrida Montecarlo calculada con otra inversión → obsoleta y sin cifras', async () => {
  const corrida = { inversion_cop: 5000, tasa_descuento: 0.12, horizonte_anios: 10, iteraciones: 10000, resultado: RESULTADO_MC, created_at: '2026-09-25T12:00:00Z' };
  const { datos, meta } = await F.recolectarFuentes(proyectoBase({}), fakeDeps({ corrida }));
  assert.equal(meta.corrida, 'obsoleta');
  assert.ok(!Object.keys(datos).some(k => k.startsWith('finanzas.van')));
});

test('recolección: viabilidad heurística excluye el relleno de escala; MIROFISH-IA solo si estado ok', async () => {
  const via = { fuente: 'heuristica', estado_auditoria: 'OBSERVACION_CRITICA', score_viabilidad: 55,
    analisis_escala_poblacion: { proporcion_logica: true, veredicto_escala: 'No evaluable sin IA' },
    cruce_anexos: { brechas_detectadas: ['Sin cotizaciones'] }, teoria_del_cambio_generada: { supuestos: [], resultados_esperados: [] } };
  const mirofish = { reglas: { hallazgos: [{ regla: 'R1', severidad: 'CRITICA', titulo: 'Sin rubro de seguridad', recomendacion: 'Incluir rubro' }] },
    ia: { estado: 'no_disponible', hallazgos: [{ titulo: 'no debe entrar' }] } };
  const { datos } = await F.recolectarFuentes(proyectoBase({ viabilidad_ia: via }), fakeDeps({ mirofish }));
  assert.equal(datos['viabilidad.score_viabilidad'], '55/100 (cálculo heurístico, sin IA)');
  assert.ok(!('viabilidad.veredicto_escala' in datos), 'relleno heurístico excluido');
  assert.equal(datos['viabilidad.brechas_detectadas[1]'], 'Sin cotizaciones');
  assert.equal(datos['mirofish.regla[1].titulo'], 'R1 · CRITICA · Sin rubro de seguridad');
  assert.ok(!Object.keys(datos).some(k => k.startsWith('mirofish.ia')));
});

test('faltantesFormulador: tipo de obra = sectores + nivelProyecto; Montecarlo ausente u obsoleto falta', () => {
  const completo = { sectores: true, nivelProyecto: true, ubicacion: true, poblacion: true, viabilidad: true, mirofish: true, lineasApu: 3, corrida: 'vigente' };
  assert.deepEqual(faltantesFormulador(completo), []);
  assert.deepEqual(faltantesFormulador({}).map(f => f.campo), ['sectores', 'nivelProyecto', 'ubicacion', 'poblacion', 'viabilidad', 'mirofish', 'presupuesto']);
  assert.deepEqual(faltantesFormulador({ ...completo, corrida: 'ninguna' }).map(f => f.campo), ['montecarlo']);
  assert.match(faltantesFormulador({ ...completo, corrida: 'obsoleta' })[0].donde, /presupuesto cambió/);
});

test('huella: estable ante el orden de claves y distinta si cambia un valor', () => {
  assert.equal(F.huellaFuentes({ a: '1', b: '2' }), F.huellaFuentes({ b: '2', a: '1' }));
  assert.notEqual(F.huellaFuentes({ a: '1' }), F.huellaFuentes({ a: '2' }));
});

// ── Llamada a NVIDIA NIM ─────────────────────────────────────────────────────
const respuestaNim = (content, extra = {}) => new Response(JSON.stringify({
  model: F.MODELO_NIM_FORMULADOR, choices: [{ finish_reason: 'stop', message: { content }, ...extra }], usage: { prompt_tokens: 900, total_tokens: 1500 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('sin NVIDIA_API_KEY → no_disponible (sin_llave_nvidia), sin llamar a la red', async () => {
  delete process.env.NVIDIA_API_KEY;
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; return respuestaNim('{}'); };
  const r = await F.consolidarMGA(DATOS, { userId: 'u1' });
  assert.deepEqual([r.estado, r.motivo, llamadas], ['no_disponible', 'sin_llave_nvidia', 0]);
});

test('respuesta válida → ok; la cifra inventada se descarta; modelo y URL correctos; FinOps total − prompt', async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-prueba';
  let peticion;
  const json = JSON.stringify({
    identificacion_problema: { parrafos: [{ texto: 'El proyecto beneficia a 320 familias.', fuentes: ['entrada.numeroBeneficiarios'] }] },
    poblacion_beneficiaria: { parrafos: [{ texto: 'Son 5.000 personas.', fuentes: ['entrada.numeroBeneficiarios'] }] },
    justificacion_tecnica: { parrafos: [{ texto: 'VAN mediano de $ 45.300.000.', fuentes: ['finanzas.van_p50_cop'] }] },
    analisis_riesgos: { parrafos: [] },
  });
  globalThis.fetch = async (url, init) => { peticion = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return respuestaNim(`<think>razono</think>${json}`); };
  tokens.length = 0;
  const r = await F.consolidarMGA(DATOS, { userId: 'u1' });
  assert.equal(r.estado, 'ok');
  assert.equal(peticion.url, NIM_URL);
  assert.equal(peticion.body.model, 'deepseek-ai/deepseek-v4.1-flash');
  assert.equal(peticion.body.max_tokens, 8192);
  assert.equal(peticion.auth, 'Bearer nvapi-prueba');
  assert.equal(r.bloques.identificacion_problema.parrafos.length, 1);
  assert.equal(r.bloques.poblacion_beneficiaria.estado, 'sin_contenido_verificable');
  assert.deepEqual(r.descartados.map(d => [d.motivo, d.detalle]), [['cifra_no_trazable', '5000']]);
  assert.equal(tokens[0].agentName, 'formulador_mga');
  assert.equal(tokens[0].tokensOutput, 600);
});

test('respuesta cortada (finish_reason length) → no_disponible respuesta_truncada, nunca texto parcial', async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-prueba';
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"identificacion_problema":' } }] }), { status: 200 });
  const r = await F.consolidarMGA(DATOS, { userId: 'u1' });
  assert.deepEqual([r.estado, r.motivo], ['no_disponible', 'respuesta_truncada']);
  assert.equal(r.bloques, undefined);
});

test('NIM: 401 → llave_rechazada; 429 → cuota_nvidia (sin reintentos de cuota)', async () => {
  process.env.NVIDIA_API_KEY = 'nvapi-prueba';
  for (const [status, motivo] of [[401, 'llave_rechazada'], [429, 'cuota_nvidia']]) {
    let llamadas = 0;
    globalThis.fetch = async () => { llamadas++; return new Response('{}', { status }); };
    const r = await F.consolidarMGA(DATOS, { userId: 'u1' });
    assert.equal(r.motivo, motivo);
    assert.equal(llamadas, 1);
  }
});

test('guardia: el tope de tokens de NIM no baja de 8192 (el razonamiento consume tokens)', () => {
  assert.ok(MAX_TOKENS_NIM >= 8192);
});
