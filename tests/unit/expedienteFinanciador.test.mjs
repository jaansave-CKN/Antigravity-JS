/**
 * expedienteFinanciador.test.mjs — Fase C (2026-09-30): agente del Expediente
 * del Financiador (Viabilidad). IA simulada: sin red ni BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
class IaNoDisponibleError extends Error { constructor() { super('sin IA'); this.status = 503; } }
class IaTopeAgotadoError extends Error {}
const sim = { respuesta: null, llamadas: [] };
mock.module(u('services/llmProveedor.js'), { namedExports: {
  IaNoDisponibleError, IaTopeAgotadoError,
  generarConIA: async (op) => {
    sim.llamadas.push(op);
    if (sim.respuesta instanceof Error) throw sim.respuesta;
    const texto = JSON.stringify(sim.respuesta);
    return { texto, valor: op.validar(texto), modelo: 'modelo-prueba', proveedor: 'gemini_servidor' };
  },
} });
mock.module(u('services/nimCliente.js'), { namedExports: { llamarNim: async () => ({}), NimError: class extends Error {}, MAX_TOKENS_NIM: 8192 } });
mock.module(u('services/aiTokenLogger.js'), { namedExports: { logTokenUsage: async () => {} } });

const X = await import('../../backend/services/expedienteFinanciador.js');
const { resolverDirectivas } = await import('../../backend/services/directivasFormulacion.js');

const ENTRADA = {
  pitch: 'Acueducto veredal para 320 usuarios',
  contextoMeta: { problemaSeleccionado: 'El 80% de las viviendas consume agua no apta', beneficiarios: '320' },
  contexto: { linea_base: 'Cobertura actual: 20%' },
  municipio: 'Argelia', sectores: ['Acueductos'], metodologias: ['Marco Lógico', 'Teoría del Cambio', 'MEL', 'PMI', 'Salvaguardas'],
  tipoConvocatoria: 'Banca multilateral', enfoque: 'INFRAESTRUCTURA',
  soluciones: { propuestasIA: ['Sistema de acueducto con tanque elevado'], propuestaManual: '', seleccion: { tipo: 'ia', index: 0 } },
};
const ANEXOS = [{ nombre: 'TDR Convocatoria BID.pdf', texto: 'Documentos exigidos: certificado de existencia y representación legal; declaración de no duplicidad de fondos (numeral 4.2).' }, { nombre: 'Diagnóstico.docx', texto: 'Riesgo de crecientes en temporada de lluvias de abril a junio.' }];

test('secciones aplicables según los ejes (el checklist aplica siempre)', () => {
  assert.deepEqual(X.seccionesAplicables(resolverDirectivas(ENTRADA)), ['teoria_cambio', 'salvaguardas', 'mel', 'riesgos_pmi', 'checklist_juridico']);
  assert.deepEqual(X.seccionesAplicables(resolverDirectivas({ tipoConvocatoria: 'MGA / SGR', metodologias: ['Marco Lógico'] })), ['checklist_juridico']);
});

test('fuentes: campos de Entrada + texto de cada anexo con id "anexo:<nombre>"; nombres repetidos se distinguen; el tope omite y lo informa', () => {
  const { datos, anexosIds, omitidos } = X.construirFuentes(ENTRADA, [...ANEXOS, { nombre: 'TDR Convocatoria BID.pdf', texto: 'otra versión' }, { nombre: 'vacío.pdf', texto: '' }]);
  assert.equal(datos['entrada.problema_seleccionado'], 'El 80% de las viviendas consume agua no apta');
  assert.equal(datos['entrada.solucion_elegida'], 'Sistema de acueducto con tanque elevado');
  assert.ok(datos['anexo:TDR Convocatoria BID.pdf'] && datos['anexo:TDR Convocatoria BID.pdf (2)']);
  assert.equal(Object.keys(anexosIds).length, 3);
  assert.deepEqual(omitidos, []);
  const grande = Array.from({ length: 12 }, (_, i) => ({ nombre: `doc${i}.pdf`, texto: 'x'.repeat(6000) }));
  assert.ok(X.construirFuentes({}, grande).omitidos.length >= 2, 'tope total de fuentes');
});

test('validación: descarta sin fuente, fuente inexistente, cifra no trazable y valores fuera de catálogo; "ND" donde falta el dato', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const salida = {
    indicadores: [
      { indicador: 'Cobertura de agua apta', linea_base: '20%', meta: '', metodo: 'Encuesta', frecuencia: 'Anual', responsable: '', fuentes: ['entrada.contexto.linea_base'] },
      { indicador: 'Usuarios conectados', linea_base: 'ND', meta: '500 usuarios', metodo: 'Registro', frecuencia: 'Semestral', responsable: 'Operador', fuentes: ['entrada.pitch'] },
      { indicador: 'Sin fuente', linea_base: 'ND', meta: 'ND', metodo: 'x', frecuencia: 'x', responsable: 'x', fuentes: [] },
      { indicador: 'Fuente falsa', linea_base: 'ND', meta: 'ND', metodo: 'x', frecuencia: 'x', responsable: 'x', fuentes: ['anexo:No existe.pdf'] },
    ],
  };
  const r = X.validarSeccion('mel', salida, datos, anexosIds);
  assert.equal(r.itemsValidos, 1);
  assert.deepEqual(r.grupos.indicadores[0], { indicador: 'Cobertura de agua apta', linea_base: '20%', meta: 'ND', metodo: 'Encuesta', frecuencia: 'Anual', responsable: 'ND', fuentes: ['entrada.contexto.linea_base'] });
  assert.deepEqual(r.descartados.map(d => d.motivo), ['cifra_no_trazable', 'sin_fuente', 'fuente_inexistente']);
  assert.match(r.descartados[0].detalle, /500/, 'la meta de 500 usuarios no está en las fuentes');

  const riesgos = X.validarSeccion('riesgos_pmi', { riesgos: [
    { evento: 'Crecientes en temporada de lluvias', categoria: 'climático', probabilidad: 4, impacto: 5, respuesta: 'Cronograma fuera de abril a junio', reserva: '', fuentes: ['anexo:Diagnóstico.docx'] },
    { evento: 'x', categoria: 'Inventada', probabilidad: 3, impacto: 3, respuesta: 'y', reserva: 'ND', fuentes: ['entrada.pitch'] },
    { evento: 'z', categoria: 'Social', probabilidad: 9, impacto: 3, respuesta: 'y', reserva: 'ND', fuentes: ['entrada.pitch'] },
  ] }, datos, anexosIds);
  assert.deepEqual(riesgos.grupos.riesgos.map(x => [x.categoria, x.probabilidad, x.impacto, x.reserva]), [['Climático', 4, 5, 'ND']], 'la calificación 1–5 no es una cifra a rastrear; el catálogo se normaliza');
  assert.deepEqual(riesgos.descartados.map(d => [d.motivo, d.detalle]), [['valor_invalido', 'categoria'], ['valor_invalido', 'probabilidad']]);
});

test('checklist jurídico: la IA NUNCA da un documento por soportado (decisión del dueño); el TdR que lo EXIGE no lo prueba; normas solo literales de las fuentes', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const r = X.validarSeccion('checklist_juridico', { documentos: [
    // El anexo citado es el mismo TdR que exige el documento → no lo prueba.
    { documento: 'Certificado de existencia y representación legal', obligatorio: true, referencia: '', anexo: 'tdr convocatoria bid.pdf', fuentes: ['anexo:TDR Convocatoria BID.pdf'] },
    // Anexo inexistente → no detectado; la referencia literal del TdR se conserva.
    { documento: 'Declaración de no duplicidad de fondos', obligatorio: true, referencia: 'numeral 4.2', anexo: 'Declaración firmada.pdf', fuentes: ['anexo:TDR Convocatoria BID.pdf'] },
    // Anexo real distinto de la fuente → solo "propuesto — verificar"; la norma no literal se borra.
    { documento: 'Estudio de riesgos climáticos', obligatorio: false, referencia: 'Guía de riesgos del financiador', anexo: 'Diagnóstico.docx', fuentes: ['anexo:TDR Convocatoria BID.pdf'] },
    { documento: 'Licencia ambiental', obligatorio: true, referencia: 'Decreto 1076 de 2015', anexo: '', fuentes: ['anexo:TDR Convocatoria BID.pdf'] },
    { documento: 'Carta de intención', obligatorio: true, referencia: '', anexo: '', fuentes: ['entrada.pitch'] },
  ] }, datos, anexosIds);
  assert.deepEqual(r.grupos.documentos.map(d => [d.estado, d.anexo, d.referencia]), [
    ['no_detectado', '', ''],
    ['no_detectado', '', 'numeral 4.2'],
    ['anexo_propuesto_verificar', 'Diagnóstico.docx', ''],
  ]);
  assert.ok(r.grupos.documentos.every(d => d.estado !== 'soportado_por_anexo'), 'solo la regla determinista (V6) puede marcar soportado');
  assert.deepEqual(r.descartados.map(d => [d.motivo, d.detalle ?? null]), [['cifra_no_trazable', '1076, 2015'], ['sin_fuente_documental', null]]);
});

test('seccionCumple: una sección cuenta como soporte de las reglas V solo con sus grupos mínimos', () => {
  const tocMinima = { estado: 'ok', contenido: { grupos: { impacto_largo_plazo: [], resultados_intermedios: [], intervenciones: [], supuestos_criticos: [{ texto: 'x' }] } } };
  assert.equal(X.seccionCumple('teoria_cambio', tocMinima), false, 'un solo supuesto no es una ruta causal');
  const tocCompleta = { estado: 'ok', contenido: { grupos: { impacto_largo_plazo: [{}], resultados_intermedios: [{}], intervenciones: [{}] } } };
  assert.equal(X.seccionCumple('teoria_cambio', tocCompleta), true);
  assert.equal(X.seccionCumple('mel', { estado: 'sin_contenido_verificable', contenido: { grupos: { indicadores: [{}] } } }), false);
  assert.equal(X.seccionCumple('riesgos_pmi', { estado: 'ok', contenido: { grupos: { riesgos: [{}] } } }), true);
});

test('prompt: solo el diccionario de fuentes, forma exacta por sección, vectores del financiador; generarSeccion usa el agente creador y json_object', async () => {
  const d = resolverDirectivas(ENTRADA);
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const [sys, user] = X.construirPrompt('teoria_cambio', d, datos);
  assert.match(sys.content, /NUNCA inventes cifras/);
  assert.match(sys.content, /"resultados_intermedios"/);
  assert.match(user.content, /VECTORES DEL FINANCIADOR/);
  assert.match(user.content, /anexo:Diagnóstico\.docx/);

  sim.llamadas = [];
  sim.respuesta = { impacto_largo_plazo: [{ texto: 'Viviendas con agua apta para consumo', fuentes: ['entrada.problema_seleccionado'] }], resultados_intermedios: [], precondiciones: [], intervenciones: [{ texto: 'Sistema de acueducto con tanque elevado', fuentes: ['entrada.solucion_elegida'] }], supuestos_criticos: [] };
  const r = await X.generarSeccion({ seccionId: 'teoria_cambio', directivas: d, datos, anexosIds, userId: 'u1' });
  assert.deepEqual([r.estado, r.grupos.intervenciones.length, r.modelo], ['ok', 1, 'modelo-prueba']);
  assert.deepEqual([sim.llamadas[0].agente, sim.llamadas[0].responseFormat], [X.AGENTE_EXPEDIENTE, { type: 'json_object' }]);

  sim.respuesta = { impacto_largo_plazo: [{ texto: 'Sin fuente', fuentes: [] }] };
  assert.equal((await X.generarSeccion({ seccionId: 'teoria_cambio', directivas: d, datos, anexosIds, userId: 'u1' })).estado, 'sin_contenido_verificable');

  sim.respuesta = { otra_cosa: 1 };
  await assert.rejects(X.generarSeccion({ seccionId: 'teoria_cambio', directivas: d, datos, anexosIds, userId: 'u1' }), /sin los grupos/);
  sim.respuesta = new IaNoDisponibleError();
  await assert.rejects(X.generarSeccion({ seccionId: 'mel', directivas: d, datos, anexosIds, userId: 'u1' }), (e) => e instanceof IaNoDisponibleError);
});

test('huella de metadatos: estable ante el orden y ante la caché de extracción; cambia con el contenido, la vigencia o la entrada', () => {
  const a = [{ id: '2', nombre_archivo: 'b', texto: 'Cobertura 2020' }, { id: '1', nombre_archivo: 'a', ruta_storage: 'p/a.pdf' }];
  const h = X.huellaMetadatos({ x: 1 }, a);
  assert.equal(h, X.huellaMetadatos({ x: 1 }, [...a].reverse()));
  assert.equal(h, X.huellaMetadatos({ x: 1 }, a.map(x => ({ ...x, archivo_cache_de: 'p/a.pdf' }))), 'la extracción (archivo_cache_de) no desactualiza la sección');
  assert.notEqual(h, X.huellaMetadatos({ x: 1 }, [{ ...a[0], texto: 'Cobertura 2021' }, a[1]]), 'mismo largo, otra cifra → cambia');
  assert.notEqual(h, X.huellaMetadatos({ x: 1 }, [a[0], { ...a[1], tipo_vigencia: 'libertad_tradicion' }]));
  assert.notEqual(h, X.huellaMetadatos({ x: 1 }, [...a, { id: '3' }]));
  assert.notEqual(h, X.huellaMetadatos({ x: 2 }, a));
});
