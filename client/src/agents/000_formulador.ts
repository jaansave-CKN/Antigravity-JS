/**
 * 000_formulador — Orquestador Maestro de la Tríada
 *
 * PUNTO DE ENTRADA ÚNICO para todos los datos que provienen del localStorage.
 * Ningún módulo de cálculo ni página de UI debe leer localStorage directamente.
 *
 * Flujo:
 *   localStorage → 000_formulador → runNN_ViabilityAgent → AnalisisViabilidad → ViabilidadPage
 */

import { runNN_ViabilityAgent, type ConfigViabilidad, type ResultadoAgente, type MetadatosAuditoria } from './NN_Viability_Agent';

export type { MetadatosAuditoria };

// ── Constante de almacenamiento (centralizada aquí) ───────────────────────────
const DIALECTICA_KEY = 'radar360_dialectica_config';

// ── Tipos de vista (compatibles con la UI de ViabilidadPage) ──────────────────

export interface AnalisisViabilidad {
  score: number;
  label: string;
  color: string;
  justificacion: string[];
  riesgos: { nivel: 'alto' | 'medio' | 'bajo'; texto: string }[];
  acciones: { id: string; texto: string; icono: string; cat: string }[];
}

export interface EstadoFormulador {
  config:    ConfigViabilidad;
  analisis:  AnalisisViabilidad;
  crudo:     ResultadoAgente;
  timestamp: number;
  metadatos: MetadatosAuditoria; // siempre presente (defaults si no configurado)
}

// ── Portafolio de proyectos ───────────────────────────────────────────────────

export interface ProyectoSnapshot {
  id:             string;
  nombre:         string;
  fechaRegistro:  number;
  config:         ConfigViabilidad;
}

// FIX (react-doctor client-localstorage-no-version, 2026-09-05): clave
// versionada — leerPortafolio() migra la clave vieja sin perder proyectos ya
// guardados.
const PORTAFOLIO_KEY   = 'radar360_portafolio:v1';
const PORTAFOLIO_KEY_LEGACY = 'radar360_portafolio';
const LIMITE_PROYECTOS = 30;

const METADATOS_DEFAULT: MetadatosAuditoria = {
  membrete:    '',
  normativa:   'ESTANDAR',
  pieDePagina: '',
};

function leerPortafolio(): ProyectoSnapshot[] {
  try {
    let raw = localStorage.getItem(PORTAFOLIO_KEY);
    if (!raw) {
      const legado = localStorage.getItem(PORTAFOLIO_KEY_LEGACY);
      if (legado) {
        localStorage.setItem(PORTAFOLIO_KEY, legado);
        localStorage.removeItem(PORTAFOLIO_KEY_LEGACY);
        raw = legado;
      }
    }
    return raw ? (JSON.parse(raw) as ProyectoSnapshot[]) : [];
  } catch { return []; }
}

/** Verifica si hay capacidad para registrar un nuevo proyecto */
export function validarCapacidad(): { ok: boolean; actual: number; limite: number } {
  const actual = leerPortafolio().length;
  return { ok: actual < LIMITE_PROYECTOS, actual, limite: LIMITE_PROYECTOS };
}

/**
 * Guarda un snapshot del estado actual de Dialéctica en el portafolio.
 * Lanza error si se alcanzó el límite de 30 proyectos.
 */
export function registrarProyectoActual(nombre: string): ProyectoSnapshot {
  const cap = validarCapacidad();
  if (!cap.ok) throw new Error(`Capacidad máxima alcanzada: ${LIMITE_PROYECTOS} proyectos por portafolio.`);
  const config = leerConfig();
  const proyecto: ProyectoSnapshot = { id: `proj_${Date.now()}`, nombre, fechaRegistro: Date.now(), config };
  const portafolio = leerPortafolio();
  portafolio.push(proyecto);
  localStorage.setItem(PORTAFOLIO_KEY, JSON.stringify(portafolio));
  return proyecto;
}

/** Exporta el portafolio completo como JSON descargable */
export function exportarPortafolio(): string {
  return JSON.stringify(
    { version: '1.0', exportado: new Date().toISOString(), proyectos: leerPortafolio() },
    null, 2,
  );
}

/** Importa proyectos desde JSON (merge sin duplicados, respeta límite de 30) */
export function importarPortafolio(json: string): { importados: number; total: number } {
  const parsed = JSON.parse(json) as { proyectos?: ProyectoSnapshot[] };
  if (!Array.isArray(parsed.proyectos)) throw new Error('Formato inválido: se esperaba { proyectos: [...] }');
  const existentes   = leerPortafolio();
  const existentesIds = new Set(existentes.map(p => p.id));
  const nuevos = parsed.proyectos.filter(p => !existentesIds.has(p.id));
  const merged = [...existentes, ...nuevos].slice(0, LIMITE_PROYECTOS);
  localStorage.setItem(PORTAFOLIO_KEY, JSON.stringify(merged));
  return { importados: nuevos.length, total: merged.length };
}

// ── Adaptador: ResultadoAgente → AnalisisViabilidad ───────────────────────────

function bandaToLabel(banda: ResultadoAgente['banda']): string {
  return { EXCELENTE: 'Excelente', ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja', CRITICA: 'Crítica' }[banda];
}

function bandaToColor(banda: ResultadoAgente['banda']): string {
  return { EXCELENTE: '#0d6efd', ALTA: '#0041a3', MEDIA: '#f59e0b', BAJA: '#dc2626', CRITICA: '#7f1d1d' }[banda];
}

function adaptarResultado(crudo: ResultadoAgente): AnalisisViabilidad {
  // Justificaciones: criterios de dimensiones con puntuación alta (≥4)
  const justificacion: string[] = [];
  for (const d of crudo.dimensiones) {
    if (d.score >= 4) justificacion.push(d.criterio);
  }

  if (justificacion.length === 0) {
    justificacion.push('Completa la configuración en Dialéctica para obtener el análisis completo.');
  }

  // Riesgos: alertas + etapas fallidas del pipeline
  const riesgos: AnalisisViabilidad['riesgos'] = [];

  crudo.alertas.forEach(alerta => {
    const nivel = alerta.startsWith('CRÍTICO') ? 'alto'
      : alerta.startsWith('Sin') ? 'bajo'
      : 'medio';
    riesgos.push({ nivel, texto: alerta });
  });

  crudo.pipeline.forEach(e => {
    if (e.estado === 'ok') return;
    riesgos.push({
      nivel: e.estado === 'fallo' ? 'alto' : 'medio',
      texto: `[${e.nombre}] ${e.detalle}`,
    });
  });

  if (riesgos.length === 0) {
    riesgos.push({ nivel: 'bajo', texto: 'Sin riesgos críticos detectados — configuración robusta' });
  }

  // Acciones: adaptar shape AccionRecomendada → shape UI
  const acciones: AnalisisViabilidad['acciones'] = crudo.acciones.map(a => ({
    id:    a.dimension.toLowerCase().replace(/\s+/g, '_'),
    texto: a.texto,
    icono: a.icono,
    cat:   a.prioridad === 'alta' ? 'Crítico' : 'Recomendación',
  }));

  if (acciones.length === 0) {
    acciones.push({ id: 'ok', texto: 'Configuración óptima — proceder a formulación', icono: 'rocket_launch', cat: 'Listo' });
  }

  return {
    score:         crudo.scoreTotal,
    label:         bandaToLabel(crudo.banda),
    color:         bandaToColor(crudo.banda),
    justificacion,
    riesgos,
    acciones,
  };
}

// ── Lector de configuración desde localStorage ────────────────────────────────

function leerConfig(): ConfigViabilidad {
  try {
    const raw = localStorage.getItem(DIALECTICA_KEY);
    if (!raw) return { selecciones: {}, adicionales: [], metadatos: METADATOS_DEFAULT };
    const parsed = JSON.parse(raw) as {
      selecciones?: Record<string, string>;
      adicionales?: string[];
      metadatos?:  MetadatosAuditoria;
    };
    return {
      selecciones: parsed.selecciones ?? {},
      adicionales: parsed.adicionales ?? [],
      metadatos:   parsed.metadatos   ?? METADATOS_DEFAULT,
    };
  } catch {
    return { selecciones: {}, adicionales: [], metadatos: METADATOS_DEFAULT };
  }
}

// ── Punto de entrada principal ────────────────────────────────────────────────

export function ejecutarFormulador(): EstadoFormulador {
  const config   = leerConfig();
  const crudo    = runNN_ViabilityAgent(config);
  const analisis = adaptarResultado(crudo);
  const metadatos = config.metadatos ?? METADATOS_DEFAULT;

  return { config, analisis, crudo, timestamp: Date.now(), metadatos };
}

// ── Selector de estado vacío (para inicialización antes del useEffect) ────────
export function estadoVacio(): AnalisisViabilidad {
  const crudo = runNN_ViabilityAgent({ selecciones: {}, adicionales: [] });
  return adaptarResultado(crudo);
}
