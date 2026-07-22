/**
 * NN_Viability_Agent — Dos motores de viabilidad distintos en este archivo:
 *
 * 1. `runNN_ViabilityAgent()` — rúbrica ponderada DETERMINISTA (sin IA) de
 *    estilo comunicacional (interlocutor/tono/enfoque/humanización/alcance),
 *    pesos en `RUBRICA_DIMENSIONES`. Sin cambios: sigue siendo un cálculo
 *    local puro sobre las selecciones del Motor Dialéctico. Los pesos
 *    (0.22/0.18/0.24/0.20/0.16) siguen siendo valores de diseño, no
 *    calibrados con datos históricos — pendiente de validación por un
 *    experto de dominio antes de usarse en decisiones de negocio reales.
 *
 * 2. `runViabilidadIA(proyectoId)` — dictamen de viabilidad del PROYECTO
 *    (no de su estilo comunicacional), respaldado por Gemini real vía
 *    `POST /api/proyectos/:id/viabilidad-ia`. La API key de Google nunca
 *    sale del backend — este archivo solo hace fetch al proxy, igual que
 *    el resto de servicios de IA de la app. El backend consulta
 *    ficha_tecnica/presupuesto/anexos reales del proyecto y persiste el
 *    resultado; si Gemini no está disponible, el backend degrada a un
 *    cálculo heurístico determinista (nunca falla, nunca inventa datos).
 *
 * Patrón estructural de la rúbrica adaptado de mirofish-guide (evaluation
 * rubric + staged pipeline). Importado y usado activamente por
 * `client/src/agents/000_formulador.ts` y `ViabilidadPage.tsx`.
 */
import { getAuthHeaders } from '../lib/apiClient';

// ── Tipos de entrada ───────────────────────────────────────────────────────────

/** Parámetros visuales/normativos para reportes de auditoría */
export interface MetadatosAuditoria {
  membrete:    string;
  normativa:   'ONU' | 'JAPON' | 'MEXICO' | 'ESTANDAR';
  pieDePagina: string;
}

export interface ConfigViabilidad {
  selecciones: Record<string, string>;
  adicionales: string[];
  metadatos?:  MetadatosAuditoria; // opcional — no afecta cálculo de score
}

// ── Dimensiones de evaluación (rúbrica 1-5 por dimensión) ─────────────────────

export interface DimensionScore {
  id: string;
  nombre: string;
  score: number;        // 1-5
  criterio: string;
  peso: number;         // 0-1, suma total = 1.0
}

export interface ResultadoAgente {
  scoreTotal: number;   // 0-10 normalizado
  banda: 'EXCELENTE' | 'ALTA' | 'MEDIA' | 'BAJA' | 'CRITICA';
  dimensiones: DimensionScore[];
  pipeline: EtapaPipeline[];
  alertas: string[];
  acciones: AccionRecomendada[];
  metadatos?: MetadatosAuditoria; // pass-through desde ConfigViabilidad
}

export interface EtapaPipeline {
  etapa: number;
  nombre: string;
  estado: 'ok' | 'advertencia' | 'fallo';
  detalle: string;
}

export interface AccionRecomendada {
  prioridad: 'alta' | 'media' | 'baja';
  dimension: string;
  texto: string;
  icono: string;
}

// ── Rúbrica de dimensiones (patrón MiroFish adaptado a RadarFondos) ────────────

const RUBRICA_DIMENSIONES: Omit<DimensionScore, 'score' | 'criterio'>[] = [
  { id: 'interlocutor', nombre: 'Legitimidad del Interlocutor', peso: 0.22 },
  { id: 'tono',         nombre: 'Registro Comunicacional',      peso: 0.18 },
  { id: 'enfoque',      nombre: 'Alineación Estratégica',       peso: 0.24 },
  { id: 'humanizacion', nombre: 'Coherencia Narrativa',         peso: 0.20 },
  { id: 'adicional',    nombre: 'Alcance Transversal',          peso: 0.16 },
];

// Criterios verbales por nivel (1-5) para cada dimensión
const CRITERIOS: Record<string, Record<number, string>> = {
  interlocutor: {
    5: 'Multilateral ONU/Banca: máxima legitimidad internacional',
    4: 'Embajada u ONG con trayectoria reconocida',
    3: 'Corporativo con enfoque en RSE',
    2: 'Entidad municipal con alcance limitado',
    1: 'Interlocutor no configurado',
  },
  tono: {
    5: 'Ejecutivo: máxima claridad para paneles evaluadores',
    4: 'Institucional o Técnico: rigor reconocido',
    3: 'Diplomático: aceptado pero menos diferenciador',
    2: 'Inspirador: riesgo de falta de rigor percibido',
    1: 'Tono no configurado',
  },
  enfoque: {
    5: 'ODS y sostenible: criterio obligatorio en 78% de fondos 2025-2026',
    4: 'Financiero/Analítico: evidencia y retorno sólidos',
    3: 'Técnico-estructural: competente pero menos transversal',
    2: 'Social/comunitario: valioso pero de menor alcance competitivo',
    1: 'Enfoque no configurado',
  },
  humanizacion: {
    5: 'Formal: aceptado universalmente por evaluadores institucionales',
    4: 'Conversacional: accesible sin pérdida de rigor',
    3: 'Relatable: funciona en contextos bilaterales',
    2: 'Indetectable: riesgo de incoherencia si se detecta IA',
    1: 'Humanización no configurada',
  },
  adicional: {
    5: 'Múltiples enfoques transversales activos (Género + Verde)',
    4: 'Economía Verde o Género: prioritarios en fondos multilaterales',
    3: 'Economía Circular: alineado con estándares PNUMA',
    2: 'Reglas de oro: base mínima aplicada',
    1: 'Sin enfoque transversal adicional',
  },
};

// ── Mapeo de opciones → nivel de rúbrica ─────────────────────────────────────

function scoreDimension(id: string, selecciones: Record<string, string>, adicionales: string[]): number {
  if (id === 'adicional') {
    if (adicionales.length >= 3) return 5;
    if (adicionales.includes('Economía Verde') && adicionales.includes('Enfoque de Género')) return 5;
    if (adicionales.includes('Economía Verde') || adicionales.includes('Enfoque de Género')) return 4;
    if (adicionales.includes('Economía Circular')) return 3;
    if (adicionales.length > 0) return 2;
    return 1;
  }
  const val = selecciones[id];
  if (!val) return 1;
  const maps: Record<string, Record<string, number>> = {
    interlocutor: {
      'Multilateral ONU/Banca': 5, 'Embajada': 4, 'ONG': 4,
      'Corporativo': 3, 'Municipal': 2,
    },
    tono: {
      'Ejecutivo': 5, 'Institucional': 4, 'Tecnico': 4,
      'Diplomatico': 3, 'Inspirador': 2,
    },
    enfoque: {
      '(ODS) y sostenible': 5, 'Financiero y Eficiente': 4, 'Analítico': 4,
      'Tecnico-estructural': 3, 'Social y comunitario': 2,
    },
    humanizacion: {
      'Formal': 5, 'Conversacional': 4, 'Relatable': 3, 'Indetectable': 2,
    },
  };
  return maps[id]?.[val] ?? 1;
}

// ── Pipeline de etapas (patrón MiroFish: inspeccionar en orden) ───────────────

function evaluarPipeline(cfg: ConfigViabilidad): EtapaPipeline[] {
  const { selecciones, adicionales } = cfg;
  const etapas: EtapaPipeline[] = [
    {
      etapa: 1,
      nombre: 'Material de entrada (configuración Dialéctica)',
      estado: Object.keys(selecciones).length >= 4 ? 'ok' : 'advertencia',
      detalle: Object.keys(selecciones).length >= 4
        ? 'Perfil completo — 4-5 dimensiones configuradas'
        : `Solo ${Object.keys(selecciones).length} de 5 dimensiones activas`,
    },
    {
      etapa: 2,
      nombre: 'Legitimidad del vector de acceso',
      estado: ['Multilateral ONU/Banca', 'Embajada', 'ONG'].includes(selecciones.interlocutor) ? 'ok' : 'advertencia',
      detalle: selecciones.interlocutor
        ? `Interlocutor: ${selecciones.interlocutor}`
        : 'Interlocutor no seleccionado',
    },
    {
      etapa: 3,
      nombre: 'Coherencia narrativa (humanización)',
      estado: selecciones.humanizacion === 'Indetectable' ? 'fallo'
        : selecciones.humanizacion ? 'ok' : 'advertencia',
      detalle: selecciones.humanizacion === 'Indetectable'
        ? 'RIESGO ALTO: humanización "Indetectable" puede ser detectada'
        : `Humanización: ${selecciones.humanizacion ?? 'no configurada'}`,
    },
    {
      etapa: 4,
      nombre: 'Alineación con marcos de financiamiento',
      estado: selecciones.enfoque === '(ODS) y sostenible' ? 'ok'
        : selecciones.enfoque ? 'advertencia' : 'fallo',
      detalle: selecciones.enfoque
        ? `Enfoque: ${selecciones.enfoque}`
        : 'Sin enfoque estratégico configurado',
    },
    {
      etapa: 5,
      nombre: 'Enfoques transversales adicionales',
      estado: adicionales.length >= 2 ? 'ok' : adicionales.length === 1 ? 'advertencia' : 'fallo',
      detalle: adicionales.length > 0
        ? `Activos: ${adicionales.join(', ')}`
        : 'Sin enfoques adicionales — reduce competitividad',
    },
  ];
  return etapas;
}

// ── Banda de interpretación (patrón MiroFish adaptado) ───────────────────────
// Score 0-10: Excelente ≥8.5 | Alta ≥7.0 | Media ≥5.0 | Baja ≥3.0 | Crítica <3.0

function interpretarBanda(score: number): ResultadoAgente['banda'] {
  if (score >= 8.5) return 'EXCELENTE';
  if (score >= 7.0) return 'ALTA';
  if (score >= 5.0) return 'MEDIA';
  if (score >= 3.0) return 'BAJA';
  return 'CRITICA';
}

// ── Punto de entrada del agente ───────────────────────────────────────────────

export function runNN_ViabilityAgent(cfg: ConfigViabilidad): ResultadoAgente {
  const { selecciones, adicionales } = cfg;

  // Evaluar cada dimensión
  const dimensiones: DimensionScore[] = RUBRICA_DIMENSIONES.map(dim => {
    const score = scoreDimension(dim.id, selecciones, adicionales);
    return {
      ...dim,
      score,
      criterio: CRITERIOS[dim.id]?.[score] ?? 'Sin criterio disponible',
    };
  });

  // Score ponderado → normalizado a 0-10
  const scorePonderado = dimensiones.reduce(
    (acc, d) => acc + (d.score / 5) * d.peso * 10,
    0,
  );
  const scoreTotal = Math.min(10, Math.max(0, Math.round(scorePonderado * 10) / 10));

  // Pipeline
  const pipeline = evaluarPipeline(cfg);

  // Alertas
  const alertas: string[] = [];
  if (selecciones.humanizacion === 'Indetectable')
    alertas.push('CRÍTICO: Cambiar humanización a "Formal" o "Conversacional" antes de presentar');
  if (dimensiones.some(d => d.score === 1))
    alertas.push('Dimensiones sin configurar reducen el puntaje en 2-3 puntos');
  if (adicionales.length === 0)
    alertas.push('Sin enfoques adicionales: considera "Economía Verde" o "Enfoque de Género"');

  // Acciones recomendadas (por prioridad)
  const acciones: AccionRecomendada[] = [];
  dimensiones
    .filter(d => d.score <= 2)
    .sort((a, b) => b.peso - a.peso)
    .forEach(d => {
      acciones.push({
        prioridad: d.score === 1 ? 'alta' : 'media',
        dimension: d.nombre,
        texto: `Mejorar ${d.nombre.toLowerCase()} — actualmente en nivel ${d.score}/5`,
        icono: d.score === 1 ? 'error' : 'warning',
      });
    });

  return { scoreTotal, banda: interpretarBanda(scoreTotal), dimensiones, pipeline, alertas, acciones, metadatos: cfg.metadatos };
}

// ── Motor de Viabilidad del PROYECTO respaldado por Gemini real ──────────────
// Distinto de runNN_ViabilityAgent (rúbrica comunicacional, sin IA, arriba).

export interface ViabilidadIAResultado {
  estado_auditoria: 'APROBADO_TECNICAMENTE' | 'OBSERVACION_CRITICA' | 'RECHAZADO_INCOHERENCIA';
  score_viabilidad: number;
  analisis_escala_poblacion: { proporcion_logica: boolean; veredicto_escala: string; alerta: string };
  cruce_anexos: { respaldo_financiero_detectado: boolean; marco_normativo_validado: boolean; brechas_detectadas: string[] };
  teoria_del_cambio_generada: { supuestos: string[]; resultados_esperados: string[] };
  fuente: string;        // 'gemini-2.0-flash' | 'heuristica'
  calculadoEn: string;
}

/**
 * Llama a POST /api/proyectos/:id/viabilidad-ia — el backend carga ficha
 * técnica, presupuesto y anexos reales del proyecto, calcula el dictamen
 * con Gemini (o heurística si no hay cuota/API key) y persiste el resultado.
 * Nunca envía ni maneja una API key de Gemini en el cliente.
 */
export async function runViabilidadIA(proyectoId: string): Promise<ViabilidadIAResultado> {
  const res = await fetch(`/api/proyectos/${proyectoId}/viabilidad-ia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    credentials: 'include',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    throw new Error(body?.message ?? `Error al calcular viabilidad (HTTP ${res.status})`);
  }
  return body.data as ViabilidadIAResultado;
}

// ── Exportación de tipos para uso en componentes ──────────────────────────────
export type { ConfigViabilidad as NNViabilityInput };
