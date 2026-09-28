/**
 * checklistModulos.ts — datos estáticos, tipos y tokens de ChecklistPage.
 * Extraído tal cual de pages/ChecklistPage.tsx (refactor 2026-09-28, sin
 * cambio de comportamiento ni de estilos).
 */

export const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

export interface ProyectoDataResponse {
  ficha_tecnica: Record<string, unknown> | null;
  presupuesto: Record<string, unknown> | null;
}
export interface RadicarSello { auditId: string; pasado_en: string; discrepancy: number }
export interface RadicarResponse { estado: string; sello: RadicarSello }

// ── Formulación Integral con IA (2026-09-22) — cadena real Entrada→Árbol→
// Viabilidad (backend/routes/formulacionIntegral.routes.js). Motor
// Dialéctico, Ficha Técnica y Logística NO tienen agente de IA detrás
// (verificado por grep antes de construir esto — son CRUD manual o
// agregación de solo lectura), quedan fuera de esta cadena a propósito.
export type PasoFormulacionId = 'entrada' | 'arbol' | 'viabilidad';
interface PasoFormulacionEstado { estado: 'pendiente' | 'completado' | 'fallido'; completado_at: string | null; error: string | null; }
export interface ProgresoFormulacion {
  paso_actual: PasoFormulacionId;
  pasos: Record<PasoFormulacionId, PasoFormulacionEstado>;
  objetivo_central_usado: string | null;
  iniciado_at: string;
  actualizado_at: string;
}
export const ORDEN_PASOS_FORMULACION: PasoFormulacionId[] = ['entrada', 'arbol', 'viabilidad'];
export const LABEL_PASO_FORMULACION: Record<PasoFormulacionId, string> = {
  entrada: 'Contexto/Entrada', arbol: 'Árbol de Objetivos', viabilidad: 'Viabilidad',
};

/**
 * Check-List automático — sin edición manual. El estado de cada módulo se
 * lee directamente de los datos reales guardados por cada pantalla
 * (localStorage); el usuario no marca nada aquí, solo ve el avance real.
 * El "Formato de Formulación" se define en /entrada.
 */
export interface ModuloStatus { percent: number; detail: string; }
interface ModuloDef {
  route: string;
  label: string;
  hint: string;
  compute: () => ModuloStatus;
}
export type ModuloEstado = ModuloDef & { status: ModuloStatus };

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// ── Formato del financiador — definido en Entrada, solo lectura aquí ───────
interface EntradaState {
  nombre: string; enfoque: string; tipoConvocatoria: string; formatoFinanciador: string;
  sectores: string[]; municipio: string; vereda: string;
}

export function getFormato(): string {
  const st = readJSON<EntradaState>('radar360_entrada_m1');
  return st?.formatoFinanciador || '';
}

// ── Definición de módulos y su cálculo de avance real ──────────────────────
export const MODULOS: ModuloDef[] = [
  {
    route: '/entrada', label: 'Entrada', hint: 'Datos generales, tipo de convocatoria, formato y contexto territorial.',
    compute: () => {
      const st = readJSON<EntradaState>('radar360_entrada_m1');
      if (!st) return { percent: 0, detail: 'Sin datos guardados' };
      const checks = [st.nombre, st.enfoque, st.tipoConvocatoria, st.formatoFinanciador, st.municipio, st.sectores?.length > 0];
      const done = checks.filter(Boolean).length;
      return { percent: Math.round((done / checks.length) * 100), detail: `${done}/${checks.length} campos clave` };
    },
  },
  {
    route: '/contexto', label: 'Contexto y Diagnóstico', hint: 'Diagnóstico del problema, KPIs, meta SMART y teoría del cambio.',
    compute: () => {
      const st = readJSON<Record<string, string>>('radar360_contexto_problema');
      const keys = ['A_diagnostico', 'B_kpis', 'C_meta', 'D_alineacion', 'E_pertinencia', 'F_priorizacion', 'G_logistica'];
      if (!st) return { percent: 0, detail: 'Sin datos guardados' };
      const done = keys.filter(k => (st[k] || '').trim().length > 0).length;
      return { percent: Math.round((done / keys.length) * 100), detail: `${done}/${keys.length} campos completados` };
    },
  },
  {
    route: '/dialectica', label: 'Motor Dialéctico', hint: 'Interlocutor, tono, enfoque y humanización del documento.',
    compute: () => {
      const st = readJSON<{ selecciones: Record<string, string> }>('radar360_dialectica_config');
      const requeridas = ['interlocutor', 'tono', 'enfoque', 'humanizacion'];
      if (!st?.selecciones) return { percent: 0, detail: 'Sin configurar' };
      const done = requeridas.filter(k => !!st.selecciones[k]).length;
      return { percent: Math.round((done / requeridas.length) * 100), detail: `${done}/${requeridas.length} categorías definidas` };
    },
  },
  {
    route: '/logistica', label: 'Logística', hint: 'Tramos de ejecución, medios de transporte y observaciones.',
    compute: () => {
      const st = readJSON<{ tramos: { origen: string; destino: string; duracion: string }[] }>('radar360_logistica_tramos');
      const tramos = st?.tramos || [];
      if (!tramos.length) return { percent: 0, detail: 'Sin tramos registrados' };
      const validos = tramos.filter(t => t.origen && t.destino && t.duracion).length;
      return { percent: Math.round((validos / tramos.length) * 100), detail: `${validos}/${tramos.length} tramos completos` };
    },
  },
  {
    route: '/anexos', label: 'Anexos', hint: 'Soportes documentales y enlaces de respaldo.',
    compute: () => {
      const arr = readJSON<{ descripcion: string; anexo: string; link: string }[]>('radar360_anexos_calco') || [];
      if (!arr.length) return { percent: 0, detail: 'Sin soportes cargados' };
      const validos = arr.filter(s => s.descripcion && (s.anexo || s.link)).length;
      return { percent: Math.round((validos / arr.length) * 100), detail: `${validos}/${arr.length} soportes con respaldo` };
    },
  },
  {
    route: '/viabilidad', label: 'Viabilidad', hint: 'Análisis calculado automáticamente a partir del Motor Dialéctico.',
    compute: () => {
      const st = readJSON<{ selecciones: Record<string, string> }>('radar360_dialectica_config');
      const requeridas = ['interlocutor', 'tono', 'enfoque', 'humanizacion'];
      if (!st?.selecciones) return { percent: 0, detail: 'Requiere configurar Motor Dialéctico' };
      const done = requeridas.filter(k => !!st.selecciones[k]).length;
      const percent = Math.round((done / requeridas.length) * 100);
      return { percent, detail: percent === 100 ? 'Análisis disponible' : 'Configuración incompleta' };
    },
  },
  {
    route: '/ficha', label: 'Ficha Técnica', hint: 'Sello final del documento, generado y verificado en el servidor.',
    // El sello ahora vive en el servidor (versiones_proyecto), no en localStorage
    // — este check-list solo lee datos locales de forma síncrona, así que no
    // puede afirmar el % real sin una llamada de red. Se remite al módulo real
    // en vez de mostrar el antiguo (y ya falso) "en construcción".
    compute: () => ({ percent: 0, detail: 'Estado real disponible en el módulo Ficha Técnica (sellado en servidor)' }),
  },
  {
    route: '/arbol-objetivos', label: 'Árbol de Objetivos y Coherencia', hint: 'Árbol de objetivos, indicadores y confirmación de coherencia — persistidos en el servidor.',
    compute: () => ({ percent: 0, detail: 'Estado real disponible en el módulo Árbol de Objetivos (persistido en servidor)' }),
  },
  {
    route: '/exportacion', label: 'Exportación (MGA / BID / OXI)', hint: 'Descarga el proyecto en la estructura de cada metodología de cooperación.',
    compute: () => ({ percent: 0, detail: 'Disponible una vez completada la Ficha Técnica y el Árbol de Objetivos' }),
  },
  {
    route: '/compliance', label: 'Compliance & Marco Normativo (M10)', hint: 'Sostenibilidad, ODS, enfoque de género, riesgos y normativa aplicable — persistidos en el servidor.',
    compute: () => ({ percent: 0, detail: 'Estado real disponible en el módulo Compliance (persistido en servidor)' }),
  },
];

// ── Tokens calco (EntradaPage.css) ─────────────────────────────────────────
export const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.50)', textHint: 'rgba(25,28,30,0.45)',
  primary: '#0058be', primarySoft: 'rgba(0,88,190,0.10)', primaryBorder: 'rgba(0,88,190,0.30)',
  success: '#15803d', successSoft: 'rgba(21,128,61,0.08)', successBorder: 'rgba(21,128,61,0.30)',
  font: "'Manrope', sans-serif",
};
