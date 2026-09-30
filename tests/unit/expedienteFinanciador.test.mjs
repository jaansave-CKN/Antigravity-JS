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
  assert.deepEqual(X.seccionesAplicables(resolverDirectivas(ENTRADA)), ['marco_logico', 'teoria_cambio', 'cadena_valor', 'salvaguardas', 'hseq', 'mel', 'riesgos_pmi', 'sostenibilidad_oym', 'checklist_juridico']);
  assert.deepEqual(X.seccionesAplicables(resolverDirectivas({ tipoConvocatoria: 'MGA / SGR', metodologias: ['Marco Lógico'] })), ['marco_logico', 'cadena_valor', 'checklist_juridico']);
  assert.deepEqual(X.seccionesAplicables(resolverDirectivas({})), ['cadena_valor', 'checklist_juridico']);
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

test('regresión (verificado en vivo con gemini-3.6-flash): "obligatorio" como texto "true"/"sí" se acepta; un valor ambiguo se descarta; la plantilla pide booleano', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const doc = (obligatorio) => ({ documento: 'Declaración de no duplicidad de fondos', obligatorio, referencia: '', anexo: '', fuentes: ['anexo:TDR Convocatoria BID.pdf'] });
  const r = X.validarSeccion('checklist_juridico', { documentos: [doc('true'), doc('Sí'), doc('no'), doc('quizás')] }, datos, anexosIds);
  assert.deepEqual(r.grupos.documentos.map(d => d.obligatorio), [true, true, false]);
  assert.deepEqual(r.descartados.map(d => d.detalle), ['obligatorio']);
  const [sys] = X.construirPrompt('checklist_juridico', resolverDirectivas(ENTRADA), datos);
  assert.match(sys.content, /"obligatorio":true/);
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

// ── Fase E (2026-09-30): marco_logico, cadena_valor, hseq, sostenibilidad_oym ──
test('marco_logico: árbol + matriz 4×4 validados; el problema central como "falta de" se descarta; las actividades no llevan costo', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const f = ['entrada.problema_seleccionado'];
  const r = X.validarSeccion('marco_logico', {
    problema_central: [{ texto: 'El 80% de las viviendas consume agua no apta', fuentes: f }],
    causas: [{ nivel: 'Directa', texto: 'Captación de una quebrada sin tratamiento', fuentes: ['anexo:Diagnóstico.docx'] }, { nivel: 'raíz', texto: 'x', fuentes: f }],
    efectos: [{ nivel: 'directo', texto: 'Enfermedad diarreica en menores', fuentes: f }],
    objetivo_general: [{ texto: 'Viviendas con agua apta para consumo humano', fuentes: f }],
    fin: [{ resumen: 'Mejorar la salud', indicador: 'Casos de EDA', medio_verificacion: '', supuesto: '', fuentes: f }],
    proposito: [{ resumen: 'Agua apta', indicador: '% viviendas con agua apta', medio_verificacion: 'Encuesta', supuesto: 'Operación comunitaria', fuentes: f }],
    componentes: [{ resumen: 'Sistema de acueducto', indicador: 'Sistema operando', medio_verificacion: 'Acta de entrega', supuesto: 'ND', fuentes: ['entrada.solucion_elegida'] }],
    actividades: [{ resumen: 'Construir la planta', indicador: 'Planta construida y recibida', medio_verificacion: 'Bitácora', supuesto: 'Clima', fuentes: ['entrada.solucion_elegida'] }],
    alineacion: [{ instrumento: 'ODS', texto: 'ODS 6', fuentes: f }],
  }, datos, anexosIds);
  assert.equal(r.grupos.problema_central.length, 1);
  assert.deepEqual(r.grupos.causas.map(c => c.nivel), ['directa'], 'el catálogo se normaliza; "raíz" no existe');
  assert.deepEqual([r.grupos.fin[0].medio_verificacion, r.grupos.fin[0].supuesto], ['ND', 'ND']);
  assert.equal('costo' in r.grupos.actividades[0], false);
  assert.equal(r.grupos.actividades[0].indicador, 'Planta construida y recibida', 'la actividad es fila 4×4 completa: lleva indicador');
  assert.deepEqual(r.descartados.map(d => [d.grupo, d.motivo]), [['causas', 'valor_invalido'], ['alineacion', 'cifra_no_trazable']], '"ODS 6" no está en las fuentes');
  assert.equal(X.seccionCumple('marco_logico', { estado: 'ok', contenido: { grupos: r.grupos } }), true);

  const malo = X.validarSeccion('marco_logico', { problema_central: [{ texto: 'Falta de acueducto en la vereda', fuentes: f }] }, datos, anexosIds);
  assert.deepEqual(malo.descartados.map(d => d.motivo), ['problema_como_ausencia']);
});

test('cadena_valor: sin montos (se descarta cualquier costo); aporte "ND" si la fuente no lo dice; códigos inventados no pasan', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const e = (extra) => ({ objetivo_o_componente: 'Suministrar agua apta', producto_o_entregable: 'Acueducto construido', actividad: 'Construir la planta compacta', etapa: 'Inversión', fuente_aporte: 'ND', fuentes: ['entrada.solucion_elegida'], ...extra });
  const r = X.validarSeccion('cadena_valor', { eslabones: [
    e(),
    e({ actividad: 'Construir la planta por $ 1.200 millones' }),
    e({ actividad: 'Obra civil — 450 millones de pesos' }),
    e({ producto_o_entregable: 'Producto MGA 4003031' }),
    e({ fuente_aporte: 'Regalías' }),
  ] }, datos, anexosIds);
  assert.equal(r.grupos.eslabones.length, 1);
  assert.deepEqual(r.descartados.map(d => d.motivo), ['monto_no_permitido', 'monto_no_permitido', 'cifra_no_trazable', 'valor_invalido']);
  const [sys] = X.construirPrompt('cadena_valor', resolverDirectivas(ENTRADA), datos);
  assert.match(sys.content, /PROHIBIDO escribir montos/);
  assert.doesNotMatch(sys.content, /"costo/);
});

test('hseq y sostenibilidad_oym: controles por norma ISO y esquema O&M; la Res. 1063 de 2016 (derogada) se descarta en cualquier sección', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const d = ['anexo:Diagnóstico.docx'];
  const h = X.validarSeccion('hseq', {
    iso_9001: [{ aspecto: 'Calidad del concreto', control: 'Ensayos de resistencia', fuentes: d }],
    iso_14001: [{ aspecto: 'Crecientes de la quebrada', control: 'Programar obras fuera de temporada de lluvias', fuentes: d }],
    iso_45001: [{ aspecto: 'Excavaciones', control: 'Entibado y permisos de trabajo', fuentes: d }, { aspecto: 'Norma', control: 'Aplicar la Res. 1063 de 2016', fuentes: d }],
  }, datos, anexosIds);
  assert.equal(X.seccionCumple('hseq', { estado: 'ok', contenido: { grupos: h.grupos } }), true);
  assert.deepEqual(h.descartados.map(x => [x.motivo, x.detalle]), [['norma_derogada', 'Res. 1063 de 2016 (derogada por la Res. 0661 de 2019)']]);
  const [sysH] = X.construirPrompt('hseq', resolverDirectivas(ENTRADA), datos);
  assert.match(sysH.content, /NUNCA afirmes que el proyecto o el contratista está certificado/);

  const o = X.validarSeccion('sostenibilidad_oym', {
    responsable: [{ entidad: 'Junta de acción comunal', rol: 'Opera el sistema', fuentes: d }],
    fuentes_recursos: [{ fuente_recurso: 'Cuota familiar', mecanismo: 'Recaudo mensual', fuentes: d }],
    actividades_om: [{ actividad: 'Limpieza de la captación', frecuencia: '', responsable: '', fuentes: d }],
  }, datos, anexosIds);
  assert.equal(X.seccionCumple('sostenibilidad_oym', { estado: 'ok', contenido: { grupos: o.grupos } }), true);
  assert.deepEqual([o.grupos.actividades_om[0].frecuencia, o.grupos.actividades_om[0].responsable], ['ND', 'ND']);
});

// ── Fase E — condiciones del architect ─────────────────────────────────────────
test('árbol de objetivos e indicadores registrados entran como fuentes arbol.*/indicador[n] (Marco Lógico y cadena de valor)', () => {
  const arbol = {
    nodos: [
      { tipo: 'CENTRAL', nivel: 0, texto: 'Garantizar agua apta en la vereda', supuestos: '' },
      { tipo: 'ESPECIFICO', nivel: 1, texto: 'Construir el acueducto', supuestos: 'La comunidad aporta mano de obra' },
    ],
    indicadores: [{ nombre: 'Viviendas con agua apta', tipo: 'resultado', linea_base: 20, meta_total: 100, unidad_medida: '%', fuente_verificacion: 'Encuesta' }],
  };
  const { datos } = X.construirFuentes(ENTRADA, ANEXOS, arbol);
  assert.equal(datos['arbol.central[1]'], 'Garantizar agua apta en la vereda');
  assert.equal(datos['arbol.especifico[1].supuestos'], 'La comunidad aporta mano de obra');
  assert.match(datos['indicador[1]'], /línea base 20 · meta 100 · %/);
  assert.equal(X.arbolObjetivosRegistrado(arbol.nodos), true);
  assert.equal(X.arbolObjetivosRegistrado([{ tipo: 'CENTRAL' }]), false, 'sin específicos no hay árbol');
  // El árbol cambia la huella (una sección generada antes queda desactualizada).
  assert.notEqual(X.huellaMetadatos({}, [], arbol), X.huellaMetadatos({}, [], { nodos: [], indicadores: [] }));
  const [sys] = X.construirPrompt('marco_logico', resolverDirectivas(ENTRADA), datos);
  assert.match(sys.content, /DEBEN ser coherentes con ellas/);
});

test('montos: "millones de litros" y "pesos de carga" NO son montos; "$", "millones de pesos" y 120.000.000 sí — también en actividades del Marco Lógico y en O&M', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, [...ANEXOS, { nombre: 'Estudio.pdf', texto: 'Caudal de 2 millones de litros al mes; control de pesos de carga en el puente. Costo 120.000.000.' }]);
  const e = (actividad) => ({ objetivo_o_componente: 'Agua apta', producto_o_entregable: 'Acueducto', actividad, etapa: 'Inversión', fuente_aporte: 'ND', fuentes: ['anexo:Estudio.pdf'] });
  const r = X.validarSeccion('cadena_valor', { eslabones: [
    e('Tratar 2 millones de litros al mes'), e('Control de pesos de carga en el puente'),
    e('Obra por 120.000.000'), e('Obra de 450 millones de pesos'), e('Compra por $ 5'),
  ] }, datos, anexosIds);
  assert.equal(r.grupos.eslabones.length, 2);
  assert.deepEqual(r.descartados.map(d => d.motivo), ['monto_no_permitido', 'monto_no_permitido', 'monto_no_permitido']);

  const ml = X.validarSeccion('marco_logico', { actividades: [{ resumen: 'Construir la planta por 120.000.000', indicador: 'Planta construida', medio_verificacion: 'Acta', supuesto: 'ND', fuentes: ['anexo:Estudio.pdf'] }] }, datos, anexosIds);
  assert.deepEqual(ml.descartados.map(d => d.motivo), ['monto_no_permitido']);
  const om = X.validarSeccion('sostenibilidad_oym', { fuentes_recursos: [{ fuente_recurso: 'Tarifa', mecanismo: 'Cobro de 120.000.000 anual', fuentes: ['anexo:Estudio.pdf'] }] }, datos, anexosIds);
  assert.deepEqual(om.descartados.map(d => d.motivo), ['monto_no_permitido']);
});

test('norma derogada anclada a la RESOLUCIÓN: "1063 viviendas en 2016" pasa; en el checklist solo se vacía la referencia derogada', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, [...ANEXOS, { nombre: 'Censo.pdf', texto: 'Se censaron 1063 viviendas en 2016. Requisito: concepto técnico según Resolución 1063 de 2016.' }]);
  const h = X.validarSeccion('hseq', {
    iso_9001: [{ aspecto: 'Base censal de 1063 viviendas en 2016', control: 'Verificar el censo', fuentes: ['anexo:Censo.pdf'] }],
    iso_14001: [], iso_45001: [],
  }, datos, anexosIds);
  assert.equal(h.grupos.iso_9001.length, 1);
  const c = X.validarSeccion('checklist_juridico', { documentos: [
    { documento: 'Concepto técnico', obligatorio: true, referencia: 'Resolución 1063 de 2016', anexo: '', fuentes: ['anexo:Censo.pdf'] },
  ] }, datos, anexosIds);
  assert.deepEqual(c.grupos.documentos.map(d => [d.documento, d.referencia]), [['Concepto técnico', '']]);
});

test('directiva cirujano: actividades del Marco Lógico con indicador obligatorio y sin monto; indicadores SMART en el prompt', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const f = ['entrada.solucion_elegida'];
  const r = X.validarSeccion('marco_logico', { actividades: [
    { resumen: 'Construir el tanque', indicador: 'Tanque construido y recibido por la interventoría', medio_verificacion: 'Acta de recibo', supuesto: 'ND', fuentes: f },
    { resumen: 'Instalar la red', indicador: '', medio_verificacion: 'Acta', supuesto: 'ND', fuentes: f },
    { resumen: 'Construir la planta', indicador: 'Inversión de $ 300 ejecutada', medio_verificacion: 'Acta', supuesto: 'ND', fuentes: f },
  ] }, datos, anexosIds);
  assert.deepEqual(r.grupos.actividades.map(a => a.indicador), ['Tanque construido y recibido por la interventoría']);
  assert.deepEqual(r.descartados.map(d => d.motivo), ['campo_vacio', 'monto_no_permitido'], 'sin indicador no hay fila 4×4; un costo como indicador es un monto');
  const [system] = X.construirPrompt('marco_logico', resolverDirectivas(ENTRADA), datos);
  assert.match(system.content, /indicador SMART/);
  assert.match(system.content, /NUNCA su costo/);
  assert.match(system.content, /"actividades":\[\{"resumen":"string","indicador":"string"/, 'la plantilla pide el indicador de la actividad');
});

test('directiva cirujano: el creador no se autoevalúa (dictamen = MIROFISH), pero los documentos de viabilidad/elegibilidad del checklist se conservan', () => {
  const { datos, anexosIds } = X.construirFuentes(ENTRADA, ANEXOS);
  const f = ['entrada.solucion_elegida'];
  const toc = (texto) => ({ texto, fuentes: f });
  const r = X.validarSeccion('teoria_cambio', { intervenciones: [
    toc('Construcción del acueducto veredal'),
    toc('El proyecto es técnicamente viable'),
    toc('La alternativa resulta elegible para el BID'),
    toc('La propuesta ya fue aprobada por el financiador'),
    toc('Viabilidad garantizada por el diseño'),
    toc('Score de auditoría alto'),
  ] }, datos, anexosIds);
  assert.deepEqual(r.grupos.intervenciones.map(i => i.texto), ['Construcción del acueducto veredal']);
  assert.deepEqual(r.descartados.map(d => d.motivo), Array(5).fill('autoevaluacion'));

  const t = 'anexo:TDR Convocatoria BID.pdf';
  const c = X.validarSeccion('checklist_juridico', { documentos: [
    { documento: 'Concepto de viabilidad técnica', obligatorio: true, referencia: '', anexo: '', fuentes: [t] },
    { documento: 'Certificado de elegibilidad', obligatorio: true, referencia: '', anexo: '', fuentes: [t] },
    { documento: 'Acto administrativo aprobado por el concejo', obligatorio: false, referencia: '', anexo: '', fuentes: [t] },
  ] }, datos, anexosIds);
  assert.equal(c.grupos.documentos.length, 3, 'nombres de documentos no son un dictamen');
  assert.deepEqual(c.grupos.documentos.map(d => d.estado), ['no_detectado', 'no_detectado', 'no_detectado']);

  const [system] = X.construirPrompt('cadena_valor', resolverDirectivas(ENTRADA), datos);
  assert.match(system.content, /NUNCA declares que el proyecto es viable, elegible, aprobado u otorgado/);
  assert.match(system.content, /Comité MIROFISH/);
});
