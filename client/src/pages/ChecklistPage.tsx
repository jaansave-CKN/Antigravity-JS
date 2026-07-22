import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * ChecklistPage — alineado a la paleta calco Light Mode del resto del área
 * de trabajo (Entrada, Contexto, Dialéctica, Logística, Anexos).
 * Tokens fuente: EntradaPage.css — bg #f7f9fb · card #ffffff · border #e0e3e5
 * · text #191c1e · primary #0058be · Manrope.
 *
 * Check-List automático — sin edición manual. El estado de cada módulo se
 * lee directamente de los datos reales guardados por cada pantalla
 * (localStorage); el usuario no marca nada aquí, solo ve el avance real.
 * El "Formato de Formulación" se define en /entrada.
 */

interface ModuloStatus { percent: number; detail: string; }
interface ModuloDef {
  route: string;
  label: string;
  hint: string;
  compute: () => ModuloStatus;
}

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

function getFormato(): string {
  const st = readJSON<EntradaState>('radar360_entrada_m1');
  return st?.formatoFinanciador || '';
}

// ── Definición de módulos y su cálculo de avance real ──────────────────────
const MODULOS: ModuloDef[] = [
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
const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.50)', textHint: 'rgba(25,28,30,0.45)',
  primary: '#0058be', primarySoft: 'rgba(0,88,190,0.10)', primaryBorder: 'rgba(0,88,190,0.30)',
  success: '#15803d', successSoft: 'rgba(21,128,61,0.08)', successBorder: 'rgba(21,128,61,0.30)',
  font: "'Manrope', sans-serif",
};

export default function ChecklistPage() {
  const navigate = useNavigate();
  const formato = getFormato();

  const estados = useMemo(() => MODULOS.map(m => ({ ...m, status: m.compute() })), []);
  const doneCount = estados.filter(e => e.status.percent === 100).length;
  const progress  = Math.round(estados.reduce((sum, e) => sum + e.status.percent, 0) / estados.length);

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.font, minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: T.card, borderBottom: `1px solid ${T.border}`,
        height: 72, padding: '0 32px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: T.text, margin: 0, letterSpacing: '-0.02em' }}>
          Check-List
        </h1>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: progress === 100 ? T.successSoft : T.primarySoft,
          border: `1px solid ${progress === 100 ? T.successBorder : T.primaryBorder}`,
          borderRadius: 9999, padding: '6px 14px',
        }}>
          <span style={{ width: 96, height: 4, background: T.border, borderRadius: 2, overflow: 'hidden', display: 'inline-block' }}>
            <span style={{ width: `${progress}%`, height: '100%', background: progress === 100 ? T.success : T.primary, borderRadius: 2, display: 'block', transition: 'width 0.3s' }} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: progress === 100 ? T.success : T.primary, whiteSpace: 'nowrap' }}>
            {doneCount}/{estados.length} · {progress}%
          </span>
        </div>
      </div>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

        {/* ── Formato del Financiador — solo lectura, definido en Entrada ── */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 9999, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: T.primarySoft, border: `1px solid ${T.primaryBorder}`,
              color: T.primary, fontSize: 10, fontWeight: 700, fontFamily: "'Inter', sans-serif",
            }}>05</span>
            <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 700, color: T.primary, letterSpacing: '0.01em' }}>
              Formato del Financiador
            </h2>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 11, color: T.textHint }}>
            Este valor se define en la ventana Entrada — aquí solo se muestra automáticamente.
          </p>

          <div style={{
            background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: formato ? T.primary : T.border,
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: formato ? T.text : T.textMuted, fontFamily: "'Inter', sans-serif" }}>
              {formato || 'Sin definir — selecciónalo en Entrada'}
            </span>
          </div>
        </div>

        {/* ── Avance por módulo — solo lectura ────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {estados.map(m => {
            const isDone = m.status.percent === 100;
            return (
              <button
                key={m.route}
                onClick={() => navigate(m.route)}
                title="Ir al módulo"
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '16px 20px', textAlign: 'left',
                  background: T.card,
                  border: `1px solid ${isDone ? T.successBorder : T.border}`,
                  borderRadius: 12, cursor: 'pointer', width: '100%', fontFamily: T.font,
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isDone ? T.success : m.status.percent > 0 ? T.primarySoft : T.bg,
                  color: '#ffffff', fontSize: 13, fontWeight: 700,
                }}>
                  {isDone ? '✓' : <span style={{ fontSize: 9, fontWeight: 800, color: m.status.percent > 0 ? T.primary : T.textMuted }}>{m.status.percent}</span>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.text }}>
                    {m.label}
                  </p>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: T.textHint, lineHeight: 1.5 }}>
                    {m.hint}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: isDone ? T.success : T.primary }}>
                    {m.status.percent}%
                  </span>
                  <span style={{ fontSize: 10.5, color: T.textMuted, whiteSpace: 'nowrap' }}>
                    {m.status.detail}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {progress === 100 && (
          <div style={{ background: T.successSoft, border: `1px solid ${T.successBorder}`, borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 13, color: T.success, fontWeight: 700, letterSpacing: '0.02em' }}>
              ✓ Proyecto completo en todos los módulos
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
