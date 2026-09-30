/**
 * vectoresFinanciador.test.mjs — Fases A y B de la directiva "Audit de
 * Impacto Integral" (2026-09-30): los 5 ejes de Entrada gobiernan las reglas
 * de las IAs creadoras (directivasFormulacion.js) y el auditor determinista
 * del Comité MIROFISH (auditoriaVectores.js, reglas V0–V6).
 * Sin red ni BD. Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
class E extends Error {}
mock.module(u('config/supabase.config.js'), { namedExports: { supabaseStorage: {}, supabaseAdmin: {} } });
mock.module(u('utils/fileConverters.js'), { namedExports: { convertBufferToMarkdown: async () => '' } });
mock.module(u('services/geminiCircuitBreaker.js'), { namedExports: { LlmLoopGuardError: E } });
mock.module(u('services/llmProveedor.js'), { namedExports: { generarConIA: async () => { throw new E(); }, IaNoDisponibleError: E, IaTopeAgotadoError: E } });
mock.module(u('services/scoringDinamico.js'), { namedExports: { calcularScoringDinamico: async () => ({}) } });
class StoreFalso { async increment() { return { totalHits: 1, resetTime: new Date() }; } async decrement() {} async resetKey() {} }
mock.module(u('middlewares/PostgresRateLimitStore.js'), { namedExports: { PostgresRateLimitStore: StoreFalso } });

const { resolverDirectivas, reglaMonetaria, REGLA_COP, REGLA_PROBLEMA_MGA, bloqueVectores } = await import('../../backend/services/directivasFormulacion.js');
const { evaluarVectores: evaluarTodas } = await import('../../backend/services/auditoriaVectores.js');
// Los tests de la Fase B miran solo V0–V6; las reglas de la Fase E (V7–V9) tienen tests propios abajo.
const FASE_E = new Set(['V7', 'V8', 'V9']);
const evaluarVectores = (p) => evaluarTodas(p).filter(h => !FASE_E.has(h.regla));
const EIA = await import('../../backend/services/EntradaIAService.js');
const { buildUserPrompt } = await import('../../backend/services/viabilidadAgent.js');

// Etiquetas EXACTAS de client/src/components/entrada/entradaModelo.ts.
const entrada = (x = {}) => ({ enfoque: 'SOCIAL', tipoConvocatoria: '', nivelProyecto: 'Perfil', metodologias: ['Marco Lógico'], formatoFinanciador: '', sectores: [], ...x });

test('esquema según las etiquetas REALES de la UI (la directiva comparaba mayúsculas y nunca entraba a la rama internacional)', () => {
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'Banca multilateral' })).esquema, 'internacional');
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'Subvención internacional' })).esquema, 'internacional');
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'MGA / SGR' })).esquema, 'nacional');
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'APP / OXI' })).esquema, 'nacional');
  assert.equal(resolverDirectivas(entrada({ formatoFinanciador: 'MGA Web' })).esquema, 'nacional');
  assert.equal(resolverDirectivas(entrada({ formatoFinanciador: 'ONU / BID / UE' })).esquema, 'internacional');
  assert.equal(resolverDirectivas(entrada()).esquema, 'sin_definir');
  assert.equal(resolverDirectivas(null).esquema, 'sin_definir');
});

test('Cofinanciación: la define el formato; con "Formato propio" o vacío queda sin_definir (no genera falsos V1)', () => {
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'Cofinanciación', formatoFinanciador: 'ONU / BID / UE' })).esquema, 'internacional');
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'Cofinanciación', formatoFinanciador: 'MGA Web' })).esquema, 'nacional');
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'Cofinanciación', formatoFinanciador: 'Formato propio' })).esquema, 'sin_definir');
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'Cofinanciación' })).esquema, 'sin_definir');
});

test('conflictos de ejes y exigencias por metodología, tipo y sector', () => {
  const c1 = resolverDirectivas(entrada({ tipoConvocatoria: 'MGA / SGR', formatoFinanciador: 'ONU / BID / UE' }));
  assert.deepEqual([c1.esquema, c1.conflictos.map(c => c.tipo)], ['nacional', ['fuente_nacional_formato_internacional']]);
  const c2 = resolverDirectivas(entrada({ tipoConvocatoria: 'Banca multilateral', formatoFinanciador: 'MGA Web' }));
  assert.deepEqual(c2.conflictos.map(c => c.tipo), ['fuente_internacional_formato_nacional']);

  const d = resolverDirectivas(entrada({ enfoque: 'INFRAESTRUCTURA', tipoConvocatoria: 'MGA / SGR', metodologias: ['Marco Lógico', 'Teoría del Cambio', 'MEL', 'PMI'], sectores: ['Acueductos'] }));
  assert.deepEqual(d.exige, { teoriaCambio: true, mel: true, pmi: true, salvaguardas: false, saneamientoPredial: true, marcoLogico: true, hseq: true, sostenibilidadOym: true });
  assert.equal(d.sectorAgua, true);
  assert.equal(resolverDirectivas(entrada({ tipoConvocatoria: 'Banca multilateral' })).exige.salvaguardas, true, 'internacional exige salvaguardas aunque no se marquen');
  assert.equal(resolverDirectivas(entrada({ enfoque: 'INFRAESTRUCTURA', tipoConvocatoria: 'Banca multilateral' })).exige.saneamientoPredial, false);
});

test('regla monetaria: nacional y sin_definir IDÉNTICAS a la regla COP de siempre; internacional sin tasas ni porcentajes inventados', () => {
  for (const esquema of ['nacional', 'sin_definir']) {
    assert.equal(reglaMonetaria({ esquema }, 'completa'), REGLA_COP.completa);
    assert.equal(reglaMonetaria({ esquema }, 'corta'), REGLA_COP.corta);
  }
  assert.equal(reglaMonetaria(null, 'completa'), REGLA_COP.completa, 'sin directivas (BD no disponible) = comportamiento de siempre');
  const intl = reglaMonetaria({ esquema: 'internacional' }, 'corta');
  assert.match(intl, /nunca asumas una tasa de cambio/);
  assert.doesNotMatch(intl, /\d/, 'ningún número (tasas/porcentajes) en la regla');
});

test('prompts de Entrada IA: la regla COP solo cambia con esquema internacional; problemáticas y campo F exigen la redacción MGA del problema', () => {
  const nac = resolverDirectivas(entrada({ tipoConvocatoria: 'MGA / SGR' }));
  const intl = resolverDirectivas(entrada({ tipoConvocatoria: 'Banca multilateral' }));
  assert.equal(EIA.buildSystemPrompt('MAT', nac), EIA.buildSystemPrompt('MAT', null));
  assert.ok(EIA.buildSystemPrompt('MAT', null).includes(`4. ${REGLA_COP.completa}`));
  assert.ok(!EIA.buildSystemPrompt('MAT', intl).includes(REGLA_COP.completa));
  assert.ok(EIA.buildSystemPromptSoluciones('MAT', {}, {}, null).includes(`5. ${REGLA_COP.corta}`));
  assert.ok(EIA.buildSystemPromptSoluciones('MAT', {}, {}, intl).includes('USD, EUR o COP'));
  assert.ok(EIA.buildSystemPromptCampoIndividual('linea_base', 'MAT', {}, {}, null).includes(`3. ${REGLA_COP.corta}`));
  assert.ok(!EIA.buildSystemPromptCampoIndividual('linea_base', 'MAT', {}, {}, null).includes(REGLA_PROBLEMA_MGA));
  assert.ok(EIA.buildSystemPromptCampoIndividual('problema_urgente', 'MAT', {}, {}, null).includes(`6. ${REGLA_PROBLEMA_MGA}`));
  assert.ok(EIA.buildSystemPromptProblematicas('MAT', {}).includes(`5. ${REGLA_PROBLEMA_MGA}`));
});

test('cargarDirectivasProyecto: filtro explícito por org_id; si la BD falla devuelve null (regla de siempre)', async () => {
  let consulta;
  const d = await EIA.cargarDirectivasProyecto('p1', 'org1', async (sql, params) => { consulta = { sql, params }; return [{ ficha_tecnica: JSON.stringify({ entrada_completa: { tipoConvocatoria: 'Banca multilateral' } }) }]; });
  assert.match(consulta.sql, /WHERE id = \? AND org_id = \?/);
  assert.deepEqual(consulta.params, ['p1', 'org1']);
  assert.equal(d.esquema, 'internacional');
  assert.equal(await EIA.cargarDirectivasProyecto('p1', 'org1', async () => { throw new Error('BD caída'); }), null);
  assert.equal(await EIA.cargarDirectivasProyecto('p1', 'org1', async () => []), null);
});

test('Viabilidad recibe los vectores y sus exigencias en el prompt (esquema JSON sin cambios)', () => {
  const d = resolverDirectivas(entrada({ tipoConvocatoria: 'Banca multilateral', metodologias: ['Marco Lógico', 'MEL'] }));
  const p = buildUserPrompt({ id: 'x', nombre: 'n', problema: 'p', metaEsperada: 'm', poblacionAfectada: '1', coberturaGeografica: 'c', presupuesto: {}, anexos: [], directivas: d });
  assert.match(p, /VECTORES DEL FINANCIADOR/);
  assert.match(p, /Fuente de financiación: Banca multilateral/);
  assert.match(p, /Plan MEL/);
  assert.doesNotMatch(buildUserPrompt({ id: 'x', presupuesto: {}, anexos: [] }), /VECTORES DEL FINANCIADOR/);
  assert.match(bloqueVectores(resolverDirectivas(entrada({ tipoConvocatoria: 'MGA / SGR', formatoFinanciador: 'ONU / BID / UE' }))), /INCOHERENCIA DE EJES/);
});

// ── Fase B: reglas V del Comité MIROFISH ──────────────────────────────────────
const HOY = '2026-09-30';
const reglas = (h) => h.map(x => x.regla);

test('V0 + V1: ejes incoherentes y moneda extranjera en régimen nacional (con evidencia literal)', () => {
  const d = resolverDirectivas(entrada({ tipoConvocatoria: 'MGA / SGR', formatoFinanciador: 'ONU / BID / UE' }));
  const h = evaluarVectores({ directivas: d, textosMoneda: [{ campo: 'apu[1].descripcion', valor: 'Tubería importada US$ 12.000' }, { campo: 'entrada.pitch', valor: 'Acueducto veredal' }], hoy: HOY });
  assert.deepEqual(reglas(h), ['V0', 'V1']);
  const v1 = h.find(x => x.regla === 'V1');
  assert.equal(v1.severidad, 'ALTA');
  assert.ok(v1.evidencia.some(e => e.campo === 'apu[1].descripcion' && e.valor.includes('US$')));
  assert.ok(!v1.evidencia.some(e => e.campo === 'entrada.pitch'));
  // Mismos textos con régimen sin definir: la regla V1 no aplica.
  assert.deepEqual(reglas(evaluarVectores({ directivas: resolverDirectivas(entrada()), textosMoneda: [{ campo: 'x', valor: '5.000 dólares' }], hoy: HOY })), []);
});

test('V1b INFO: financiador internacional sin anexo Financiero; desaparece al adjuntarlo', () => {
  const d = resolverDirectivas(entrada({ tipoConvocatoria: 'Subvención internacional' }));
  const sin = evaluarVectores({ directivas: d, anexos: [{ nombre_archivo: 'salvaguardas.pdf' }], hoy: HOY });
  assert.deepEqual(sin.filter(x => x.regla === 'V1b').map(x => x.severidad), ['INFO']);
  const con = evaluarVectores({ directivas: d, anexos: [{ nombre_archivo: 'budget.xlsx', categoria: 'financiero' }, { nombre_archivo: 'salvaguardas.pdf' }], hoy: HOY });
  assert.deepEqual(reglas(con), []);
});

test('V2: problema redactado como "falta de" (MEDIA); una condición medible no dispara', () => {
  const d = resolverDirectivas(entrada());
  const h = evaluarVectores({ directivas: d, problemas: [{ campo: 'entrada.problema_seleccionado', valor: 'Falta de acueducto en la vereda' }, { campo: 'entrada.problema_urgente', valor: 'El 80 % consume agua no apta' }], hoy: HOY });
  assert.deepEqual(h.map(x => [x.regla, x.severidad]), [['V2', 'MEDIA']]);
  assert.deepEqual(h[0].evidencia.map(e => e.campo), ['entrada.problema_seleccionado']);
  assert.deepEqual(evaluarVectores({ directivas: d, problemas: [{ campo: 'p', valor: 'No hay cobertura de alcantarillado' }], hoy: HOY }).map(x => x.regla), ['V2']);
});

test('V3/V4/V4b/V5: metodologías exigidas sin soporte; el anexo (nombre o descripción) las satisface; "process/access" no cuentan como ESS', () => {
  const d = resolverDirectivas(entrada({ metodologias: ['Marco Lógico', 'Teoría del Cambio', 'MEL', 'PMI', 'Salvaguardas'] }));
  const sin = evaluarVectores({ directivas: d, anexos: [{ nombre_archivo: 'PROCESS access business.pdf' }], teoriaCambioRegistrada: false, hoy: HOY });
  assert.deepEqual(sin.map(x => [x.regla, x.severidad]), [['V3', 'ALTA'], ['V4', 'ALTA'], ['V4b', 'MEDIA'], ['V5', 'ALTA']]);
  assert.ok(sin.every(x => /no se detect/i.test(x.detalle) || x.regla === 'V4b'), 'dice "no se detectó", nunca "no existe"');
  const con = evaluarVectores({ directivas: d, teoriaCambioRegistrada: false, hoy: HOY, anexos: [
    { nombre_archivo: 'toc.pdf', descripcion: 'Teoría del Cambio del proyecto' },
    { nombre_archivo: 'Plan de monitoreo.docx' },
    { nombre_archivo: 'Matriz de riesgos.xlsx' },
    { nombre_archivo: 'Análisis ESS1 y ESS7.pdf' },
  ] });
  assert.deepEqual(reglas(con), []);
  assert.deepEqual(reglas(evaluarVectores({ directivas: resolverDirectivas(entrada({ metodologias: ['Teoría del Cambio'] })), teoriaCambioRegistrada: true, hoy: HOY })), [], 'ruta causal registrada en el proyecto');
});

test('V6: infraestructura nacional sin soporte predial (ALTA, cita Ley 1551 art. 48 / Ley 2140 y Res. 0661 solo en agua); certificado vencido (MEDIA); vigente o posesión acreditada no disparan', () => {
  const d = resolverDirectivas(entrada({ enfoque: 'INFRAESTRUCTURA', tipoConvocatoria: 'MGA / SGR', sectores: ['Acueductos'] }));
  const sin = evaluarVectores({ directivas: d, hoy: HOY });
  assert.deepEqual(sin.map(x => [x.regla, x.severidad]), [['V6', 'ALTA']]);
  assert.match(sin[0].recomendacion, /Ley 1551 de 2012, art\. 48 \(modificado por la Ley 2140 de 2021/);
  assert.match(sin[0].recomendacion, /Res\. 0661 de 2019/);
  assert.doesNotMatch(sin[0].recomendacion, /1063/, 'la Res. 1063 de 2016 está derogada');
  const sinAgua = evaluarVectores({ directivas: resolverDirectivas(entrada({ enfoque: 'INFRAESTRUCTURA', tipoConvocatoria: 'MGA / SGR' })), hoy: HOY });
  assert.doesNotMatch(sinAgua[0].recomendacion, /0661/);

  const vencido = evaluarVectores({ directivas: d, hoy: HOY, anexos: [{ nombre_archivo: 'ctl.pdf', tipo_vigencia: 'libertad_tradicion', fecha_documento: '2026-07-01' }] });
  assert.deepEqual(vencido.map(x => [x.regla, x.severidad]), [['V6', 'MEDIA']]);
  assert.deepEqual(reglas(evaluarVectores({ directivas: d, hoy: HOY, anexos: [{ nombre_archivo: 'ctl.pdf', tipo_vigencia: 'libertad_tradicion', fecha_documento: '2026-09-20' }] })), []);
  assert.deepEqual(reglas(evaluarVectores({ directivas: d, hoy: HOY, anexos: [{ nombre_archivo: 'Acta de sana posesión JAC.pdf' }] })), []);
});

test('proyecto sin ejes definidos: el auditor V no emite nada (cero ruido para proyectos existentes)', () => {
  assert.deepEqual(evaluarVectores({ directivas: resolverDirectivas({}), hoy: HOY }), []);
  assert.deepEqual(evaluarVectores({ directivas: null, hoy: HOY }), []);
});

// ── Fase E (2026-09-30): V7 Marco Lógico, V8 HSEQ, V9 operación y mantenimiento ──
test('V7/V8/V9: Marco Lógico sin matriz (ALTA), obra física sin HSEQ ni O&M (MEDIA); el expediente vigente o el anexo las satisfacen', () => {
  const d = resolverDirectivas(entrada({ enfoque: 'INFRAESTRUCTURA', tipoConvocatoria: 'MGA / SGR', metodologias: ['Marco Lógico'] }));
  const soloE = (h) => h.filter(x => FASE_E.has(x.regla)).map(x => [x.regla, x.severidad]);
  assert.deepEqual(soloE(evaluarTodas({ directivas: d, hoy: HOY })), [['V7', 'ALTA'], ['V8', 'MEDIA'], ['V9', 'MEDIA']]);
  assert.deepEqual(soloE(evaluarTodas({ directivas: d, hoy: HOY, expediente: { marco_logico: true, hseq: true, sostenibilidad_oym: true } })), []);
  assert.deepEqual(soloE(evaluarTodas({ directivas: d, hoy: HOY, anexos: [
    { nombre_archivo: 'Matriz de Marco Lógico.xlsx' }, { nombre_archivo: 'Plan de manejo ambiental y SG-SST.pdf' }, { nombre_archivo: 'Plan de operación y mantenimiento.docx' },
  ] })), []);
  // Proyecto social sin Marco Lógico marcado: ninguna regla de la Fase E aplica.
  assert.deepEqual(soloE(evaluarTodas({ directivas: resolverDirectivas(entrada({ metodologias: [] })), hoy: HOY })), []);
  const v7 = evaluarTodas({ directivas: d, hoy: HOY }).find(x => x.regla === 'V7');
  assert.match(v7.detalle, /no se detect/);
  // Con el árbol de objetivos ya registrado solo falta la matriz → MEDIA (no un ALTA falso).
  const v7Arbol = evaluarTodas({ directivas: d, hoy: HOY, arbolObjetivos: true }).find(x => x.regla === 'V7');
  assert.deepEqual([v7Arbol.severidad, v7Arbol.titulo], ['MEDIA', 'Marco Lógico: falta la matriz 4×4']);
});

test('bloque de vectores: agua y saneamiento nacional cita la Res. 0661 de 2019 y declara la 1063 de 2016 derogada', () => {
  const b = bloqueVectores(resolverDirectivas(entrada({ enfoque: 'INFRAESTRUCTURA', tipoConvocatoria: 'MGA / SGR', sectores: ['Alcantarillado'] })));
  assert.match(b, /Res\. 0661 de 2019 de MinVivienda \(la Res\. 1063 de 2016 está derogada\)/);
  assert.match(b, /ISO 45001/);
  assert.doesNotMatch(bloqueVectores(resolverDirectivas(entrada({ tipoConvocatoria: 'Banca multilateral', sectores: ['Alcantarillado'] }))), /0661/);
});
