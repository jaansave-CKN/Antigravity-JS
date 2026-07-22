/**
 * Radford360_Agent.ts
 * Auditor Internacional de Proyectos · Nivel ONU
 * Validación de doble entrada: consistencia A↔B↔C + completitud G-fields
 */

export interface ContextoProblema {
  A_diagnostico: string;
  B_kpis: string;
  C_meta: string;
  D_alineacion: string;
  E_pertinencia: string;
  F_priorizacion: string;
  G_logistica: string;
}

export const CAMPO_LABELS: Record<keyof ContextoProblema, string> = {
  A_diagnostico: 'A · Diagnóstico del Problema',
  B_kpis:        'B · Indicadores KPI',
  C_meta:        'C · Meta SMART',
  D_alineacion:  'D · Alineación Estratégica',
  E_pertinencia: 'E · Pertinencia y Gobernanza',
  F_priorizacion:'F · Priorización Crítica',
  G_logistica:   'G · Viabilidad Logística',
};

export interface AuditAlerta {
  codigo: string;
  nivel: 'bloqueo' | 'advertencia' | 'info';
  campo: keyof ContextoProblema | 'GLOBAL';
  mensaje: string;
  accion: string;
}

export interface ResultadoAuditoria {
  aprobado: boolean;
  puntaje: number;
  alertas: AuditAlerta[];
  resumen: string;
  timestamp: string;
}

const MIN_CHARS = 40;

// ── Utilidades de análisis léxico ──────────────────────────────────────────────

function extraerPalabrasClaveProblema(texto: string): string[] {
  const stopWords = new Set([
    'de','la','el','en','que','los','las','por','con','una','un','se','del',
    'al','es','su','sus','para','como','más','pero','no','si','ya','hay',
    'son','ser','han','fue','está','este','esta','también','cuando','sobre',
    'entre','hasta','desde','hacia','durante','mediante','través','nivel',
  ]);
  return texto
    .toLowerCase()
    .replace(/[^\w\sáéíóúüñ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
}

function contieneMetrica(texto: string): boolean {
  return /\d+\s*(%|por\s*ciento|unidades?|personas?|familias?|km|ha|ton|USD|COP|\$|hogares?|beneficiarios?|muestras?|puntos?\s*porcentuales?)/i.test(texto);
}

function contieneHorizonteTemporal(texto: string): boolean {
  return /\b(20\d{2}|en\s+\d+\s+años?|al\s+finalizar|para\s+el|diciembre|junio|trimestre|semestre|año\s+\d|plazo|período|periodo|fase)\b/i.test(texto);
}

function solapamientoTematico(base: string, objetivo: string): number {
  const palabrasBase = new Set(extraerPalabrasClaveProblema(base));
  const palabrasObj  = extraerPalabrasClaveProblema(objetivo);
  if (palabrasBase.size === 0 || palabrasObj.length === 0) return 0;
  const coincidencias = palabrasObj.filter(p => palabrasBase.has(p)).length;
  return coincidencias / Math.min(palabrasBase.size, palabrasObj.length);
}

// ── Pulidor de voz → lenguaje técnico formal ──────────────────────────────────

const REEMPLAZOS_VOZ: Array<[RegExp, string]> = [
  [/\bno tenemos\b/gi, 'se carece de'],
  [/\bmucha pobreza\b/gi, 'alta incidencia de pobreza multidimensional'],
  [/\bno funciona\b/gi, 'presenta disfunción sistémica en'],
  [/\bla gente no tiene\b/gi, 'la población carece de acceso a'],
  [/\bpoca agua\b/gi, 'déficit hídrico'],
  [/\bno hay plata\b/gi, 'restricción presupuestaria severa'],
  [/\bquiero que\b/gi, 'el objetivo es que'],
  [/\bvamos a hacer\b/gi, 'se implementará'],
  [/\bpara el año\b/gi, 'con horizonte al año'],
  [/\bpor ciento\b/gi, '%'],
  [/\bmas o menos\b/gi, 'aproximadamente'],
  [/\bmás o menos\b/gi, 'aproximadamente'],
];

export function pulidorVoz(transcripcion: string): string {
  let texto = transcripcion.trim();
  if (!texto) return texto;
  for (const [patron, reemplazo] of REEMPLAZOS_VOZ) {
    texto = texto.replace(patron, reemplazo);
  }
  // Capitalizar primera letra
  texto = texto.charAt(0).toUpperCase() + texto.slice(1);
  // Agregar punto final si no hay puntuación
  if (!/[.!?]$/.test(texto)) texto += '.';
  return texto;
}

// ── Motor de auditoría ─────────────────────────────────────────────────────────

export function auditarContexto(ctx: Partial<ContextoProblema>): ResultadoAuditoria {
  const alertas: AuditAlerta[] = [];
  let puntaje = 100;

  const A = (ctx.A_diagnostico || '').trim();
  const B = (ctx.B_kpis        || '').trim();
  const C = (ctx.C_meta        || '').trim();
  const D = (ctx.D_alineacion  || '').trim();
  const E = (ctx.E_pertinencia || '').trim();
  const F = (ctx.F_priorizacion|| '').trim();
  const G = (ctx.G_logistica   || '').trim();

  // ── 1. Validación de completitud mínima ──
  const campos: Array<[string, keyof ContextoProblema]> = [
    [A,'A_diagnostico'],[B,'B_kpis'],[C,'C_meta'],
    [D,'D_alineacion'],[E,'E_pertinencia'],[F,'F_priorizacion'],[G,'G_logistica'],
  ];
  for (const [val, key] of campos) {
    if (val.length < MIN_CHARS) {
      alertas.push({
        codigo: 'VACIO',
        nivel: 'bloqueo',
        campo: key,
        mensaje: `${CAMPO_LABELS[key]}: contenido insuficiente (mínimo ${MIN_CHARS} caracteres para auditoría).`,
        accion: 'Amplíe la descripción con precisión técnica antes de guardar.',
      });
      puntaje -= 10;
    }
  }

  // ── 2. Validación KPIs: deben contener métricas cuantificables ──
  if (B.length >= MIN_CHARS && !contieneMetrica(B)) {
    alertas.push({
      codigo: 'B-METRICA',
      nivel: 'bloqueo',
      campo: 'B_kpis',
      mensaje: 'B · KPIs: no se detectan métricas cuantificables (%, unidades, beneficiarios, etc.).',
      accion: 'Incluya al menos un indicador con valor numérico y unidad de medida estándar (ej: "reducir en 30% la tasa de..."). Los KPIs sin métricas no son auditables.',
    });
    puntaje -= 15;
  }

  // ── 3. Validación Meta SMART: debe tener horizonte temporal y resultado ──
  if (C.length >= MIN_CHARS) {
    if (!contieneHorizonteTemporal(C)) {
      alertas.push({
        codigo: 'C-TEMPORAL',
        nivel: 'bloqueo',
        campo: 'C_meta',
        mensaje: 'C · Meta SMART: no se detecta horizonte temporal definido.',
        accion: 'Una meta SMART requiere fecha o plazo explícito (ej: "al 2027", "en 18 meses", "al finalizar la fase II").',
      });
      puntaje -= 12;
    }
    if (!contieneMetrica(C)) {
      alertas.push({
        codigo: 'C-MEDIBLE',
        nivel: 'advertencia',
        campo: 'C_meta',
        mensaje: 'C · Meta SMART: no se detecta resultado medible con valor numérico.',
        accion: 'Especifique el resultado esperado en términos cuantitativos para que la meta sea verificable.',
      });
      puntaje -= 8;
    }
  }

  // ── 4. Consistencia A↔B (diagnóstico vs indicadores) ──
  if (A.length >= MIN_CHARS && B.length >= MIN_CHARS) {
    const solapamiento = solapamientoTematico(A, B);
    if (solapamiento < 0.12) {
      alertas.push({
        codigo: 'A-B',
        nivel: 'bloqueo',
        campo: 'B_kpis',
        mensaje: 'Inconsistencia A↔B: los KPIs no guardan relación temática con el Diagnóstico del Problema.',
        accion: 'Revise que los indicadores midan las causas/efectos identificados en el diagnóstico. Una desconexión entre A y B invalida la teoría del cambio.',
      });
      puntaje -= 20;
    } else if (solapamiento < 0.22) {
      alertas.push({
        codigo: 'A-B-ADV',
        nivel: 'advertencia',
        campo: 'B_kpis',
        mensaje: 'Alineación A↔B débil: los KPIs cubren parcialmente el problema diagnosticado.',
        accion: 'Verifique que cada KPI corresponda directamente a una causa o efecto del diagnóstico.',
      });
      puntaje -= 8;
    }
  }

  // ── 5. Consistencia A↔C (diagnóstico vs meta) ──
  if (A.length >= MIN_CHARS && C.length >= MIN_CHARS) {
    const solapamiento = solapamientoTematico(A, C);
    if (solapamiento < 0.10) {
      alertas.push({
        codigo: 'A-C',
        nivel: 'bloqueo',
        campo: 'C_meta',
        mensaje: 'Inconsistencia A↔C: la Meta SMART no responde al problema diagnosticado.',
        accion: 'La meta debe representar la situación mejorada del problema descrito en A. Si el diagnóstico cambia de tema, la meta queda huérfana de justificación.',
      });
      puntaje -= 20;
    }
  }

  // ── 6. Consistencia B↔C (KPIs vs meta) ──
  if (B.length >= MIN_CHARS && C.length >= MIN_CHARS) {
    const solapamiento = solapamientoTematico(B, C);
    if (solapamiento < 0.10) {
      alertas.push({
        codigo: 'B-C',
        nivel: 'advertencia',
        campo: 'C_meta',
        mensaje: 'Alineación B↔C débil: los KPIs y la Meta SMART no comparten el mismo dominio temático.',
        accion: 'Los KPIs deben ser los instrumentos de medición de la meta. Si no coinciden en tema, el sistema M&E no podrá verificar el logro.',
      });
      puntaje -= 10;
    }
  }

  // ── 7. Logística: detección de cuellos de botella ──
  if (G.length >= MIN_CHARS) {
    const riesgosCuello = /sin\s+presupuesto|no\s+contamos|falta\s+de\s+personal|sin\s+capacidad|no\s+existe/i.test(G);
    if (riesgosCuello) {
      alertas.push({
        codigo: 'G-RESTRICCION',
        nivel: 'advertencia',
        campo: 'G_logistica',
        mensaje: 'G · Logística: se detectan restricciones operativas críticas que pueden bloquear la ejecución.',
        accion: 'Documente el plan de mitigación para cada cuello de botella identificado antes de someter el proyecto.',
      });
      puntaje -= 5;
    }
  }

  puntaje = Math.max(0, Math.min(100, puntaje));
  const bloqueos = alertas.filter(a => a.nivel === 'bloqueo');
  const aprobado = bloqueos.length === 0 && puntaje >= 60;

  let resumen = '';
  if (aprobado) {
    resumen = `Auditoría aprobada · Puntaje ${puntaje}/100. El contexto del problema cumple los estándares técnicos de coherencia lógica y medibilidad. Puede proceder al registro.`;
  } else if (bloqueos.length > 0) {
    resumen = `Auditoría BLOQUEADA · ${bloqueos.length} inconsistencia${bloqueos.length > 1 ? 's' : ''} crítica${bloqueos.length > 1 ? 's' : ''} detectada${bloqueos.length > 1 ? 's' : ''}. Corrija antes de guardar.`;
  } else {
    resumen = `Auditoría con observaciones · Puntaje ${puntaje}/100. Revise las advertencias para elevar la calidad técnica del formulario.`;
  }

  return { aprobado, puntaje, alertas, resumen, timestamp: new Date().toISOString() };
}
