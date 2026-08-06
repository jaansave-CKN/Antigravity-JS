/**
 * Formulador AI 7.0 — Data Schema
 * Base structures for Módulos 7, 8 y 9.
 * These are the empty contracts that the injection cycle will populate.
 */

/* ── MÓDULO 7 — Formulación de Objetivos ────────────────── */
export const modulo7Schema = {
  objetivo_general: '',
  objetivo_general_indicador: '',

  objetivos_especificos: [
    // { id: 'OE-1', descripcion: '', indicador: '', meta: '', unidad: '', linea_base: '' }
  ],

  cadena_valor: {
    insumos:    [],   // strings
    actividades:[],   // strings
    productos:  [],   // strings
    resultados: [],   // strings
    impacto:    '',
  },
};

/* ── MÓDULO 8 — Cronograma de Ejecución ─────────────────── */
export const modulo8Schema = {
  duracion_meses: 0,
  fecha_inicio: '',
  fecha_fin: '',

  fases: [
    // { id: 'F1', nombre: '', inicio_mes: 1, fin_mes: 3, responsable: '', porcentaje: 0 }
  ],

  hitos: [
    // { id: 'H1', nombre: '', mes: 0, descripcion: '', entregable: '' }
  ],

  cronograma_gantt: [],  // generado dinámicamente desde fases/hitos
};

/* ── MÓDULO 9 — Presupuesto y Fuentes de Financiación ───── */
export const modulo9Schema = {
  presupuesto_total: 0,
  moneda: 'COP',

  fuentes: [
    // {
    //   id: 'F1',
    //   nombre: '',
    //   tipo: 'SGR' | 'SGP' | 'DNP' | 'Kusanone' | 'OxI' | 'Cooperación' | 'Contrapartida' | 'Otro',
    //   aporte: 0,
    //   porcentaje: 0,
    //   es_publica: true,          // true → activa validación MGR/DNP
    //   certificacion: null,
    // }
  ],

  contrapartida: {
    monetaria: 0,
    especie: 0,
    descripcion: '',
  },

  resumen: {
    recursos_nacionales: 0,
    recursos_territoriales: 0,
    recursos_cooperacion: 0,
    recursos_privados: 0,
  },

  viabilidad_financiera: '',

  // Resultado de evaluación MGR/DNP — se puebla por validateCofinanciacion()
  validacion_cofinanciacion: {
    estado: 'pendiente',   // 'ok' | 'advertencia' | 'pendiente'
    porcentaje_contrapartida_real: 0,
    porcentaje_minimo_requerido: 0,
    mensaje: '',
    fuente_evaluada: '',   // nombre del fondo que activó la regla
  },
};

// Reglas de cofinanciación mínima por fondo (porcentaje sobre presupuesto total)
const REGLAS_COFINANCIACION = {
  SGR:       { pct_min: 0,    label: 'SGR' },
  DNP:       { pct_min: 20,   label: 'DNP' },
  Kusanone:  { pct_min: 30,   label: 'Kusanone (JICA)' },
  OxI:       { pct_min: 0,    label: 'OxI' },
  Cooperación: { pct_min: 10, label: 'Cooperación Internacional' },
};

/**
 * Evalúa si la contrapartida cumple el mínimo exigido por el fondo de financiación pública.
 * Retorna el objeto validacion_cofinanciacion con estado 'ok' o 'advertencia'.
 */
export function validateCofinanciacion(modulo9) {
  const { fuentes = [], contrapartida = {}, presupuesto_total = 0 } = modulo9;

  const fuentePublica = fuentes.find(f => f.es_publica && REGLAS_COFINANCIACION[f.tipo]);
  if (!fuentePublica || presupuesto_total <= 0) {
    return { estado: 'pendiente', porcentaje_contrapartida_real: 0, porcentaje_minimo_requerido: 0, mensaje: 'Sin fondo público identificado.', fuente_evaluada: '' };
  }

  const regla = REGLAS_COFINANCIACION[fuentePublica.tipo];
  const totalContrapartida = (contrapartida.monetaria || 0) + (contrapartida.especie || 0);
  const pctReal = (totalContrapartida / presupuesto_total) * 100;

  if (pctReal >= regla.pct_min) {
    return {
      estado: 'ok',
      porcentaje_contrapartida_real: +pctReal.toFixed(2),
      porcentaje_minimo_requerido: regla.pct_min,
      mensaje: `Contrapartida ${pctReal.toFixed(1)}% ≥ mínimo ${regla.pct_min}% requerido por ${regla.label}.`,
      fuente_evaluada: fuentePublica.nombre || fuentePublica.tipo,
    };
  }

  return {
    estado: 'advertencia',
    porcentaje_contrapartida_real: +pctReal.toFixed(2),
    porcentaje_minimo_requerido: regla.pct_min,
    mensaje: `⚠ Advertencia de Viabilidad: contrapartida ${pctReal.toFixed(1)}% < ${regla.pct_min}% mínimo exigido por ${regla.label}.`,
    fuente_evaluada: fuentePublica.nombre || fuentePublica.tipo,
  };
}

// Clasificación para infraestructura social rural (Radar semantic sweep)
export const INFRA_SOCIAL_RURAL = {
  vias:               { label: 'Vías y Transporte Rural', codigo: 'VIAS' },
  saneamiento:        { label: 'Saneamiento Básico y Agua Potable', codigo: 'SANEA' },
  educacion:          { label: 'Infraestructura Educativa Rural', codigo: 'EDUC' },
  salud:              { label: 'Puestos de Salud y Telemedicina', codigo: 'SALUD' },
  conectividad:       { label: 'Conectividad Digital Rural', codigo: 'CONEC' },
  vivienda:           { label: 'Mejoramiento de Vivienda Rural', codigo: 'VIV' },
  energia:            { label: 'Energías Renovables y Electrificación', codigo: 'ENER' },
  seguridad_alim:     { label: 'Seguridad Alimentaria', codigo: 'SEG_ALIM' },
};

/* ── Helper: create empty ficha_formulador payload ── */
export function createFichaFormulador(ficha_fase1 = {}) {
  return {
    ...ficha_fase1,
    modulo_7: { ...modulo7Schema },
    modulo_8: { ...modulo8Schema },
    modulo_9: { ...modulo9Schema },
    _meta: {
      version: '7.1',
      created_at: new Date().toISOString(),
      status: 'draft',
      // clasificacion_infra: INFRA_SOCIAL_RURAL key, populated by Módulo 1 sector selector
      clasificacion_infra: '',
    },
  };
}
