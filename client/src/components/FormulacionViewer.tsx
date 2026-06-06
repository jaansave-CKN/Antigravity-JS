/**
 * FormulacionViewer.tsx — Visualizador bilingüe BLINDADO contra pantalla blanca
 *
 * Lógica de renderizado defensiva (sin acceso a propiedades internas si el payload no existe):
 *
 *   lang='es'                           → siempre renderiza payload_es
 *   lang='en' + status='completed'      → renderiza payload_en
 *   lang='en' + status='processing'     → Skeleton Loader (NO accede a payload_en)
 *   lang='en' + status='failed'         → alerta sutil + fallback a payload_es
 *   lang='en' + status='skipped'        → banner info + renderiza payload_es
 *   payload_es vacío o nulo             → estado "Formulación pendiente"
 */

import React, { useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageToggle from './LanguageToggle';

// ── Estado de traducción (espejo del CHECK en SQL) ────────────────────────────
export type TranslationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

// ── Tipos del payload bilingüe ────────────────────────────────────────────────
interface ObjectiveNode {
  tipo?:        string;
  nivel?:       number;
  texto?:       string;
  content?:     string;
  parent_id?:   string | null;
  ai_generated?: boolean;
}

interface BudgetItem {
  fase?:          string;
  phase?:         string;
  capitulo?:      string;
  chapter?:       string;
  item?:          string;
  item_name?:     string;
  costo_directo?: number;
  direct_cost?:   number;
  valor_total?:   number;
  total_value?:   number;
}

interface FormulacionPayload {
  version?:           string;
  idioma?:            string;
  language?:          string;
  translation_status?: string;
  generado_en?:       string;
  translated_at?:     string;
  translation_model?: string;
  proyecto?: { id?: string; nombre?: string; name?: string; estado?: string; status?: string };
  project?:  { id?: string; name?: string; status?: string };
  arbol_objetivos?:      ObjectiveNode[];
  objective_tree?:       ObjectiveNode[];
  cronograma?: {
    duracion_meses?:   number;
    duration_months?:  number;
    fecha_inicio?:     string;
    start_date?:       string;
    fases?:            unknown[];
    hitos?:            unknown[];
  };
  schedule?:    unknown;
  presupuesto?: { resumen?: unknown; items_apu?: BudgetItem[] };
  budget?:      { items_apu?: BudgetItem[] };
  marco_normativo?:      { normas?: unknown[]; citas?: unknown[] };
  regulatory_framework?: unknown;
  match_score?:          unknown;
}

interface Props {
  payloadEs?:        FormulacionPayload | null;
  payloadEn?:        FormulacionPayload | null;
  /** translation_status desde la columna de la tabla projects */
  translationStatus?: TranslationStatus;
  projectName?:      string;
  className?:        string;
}

// ── Helpers visuales ──────────────────────────────────────────────────────────
function badge(text: string, color = '#2563eb') {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      background: color + '18', color, fontSize: 11, fontWeight: 700,
      fontFamily: 'monospace', letterSpacing: '0.05em',
    }}>{text}</span>
  );
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #e5e7eb' }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#111827', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </h3>
    </div>
  );
}

// ── Skeleton Loader — "traducción en progreso" ────────────────────────────────
function SkeletonBar({ w = '100%', h = 12 }: { w?: string; h?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 4,
      background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
      backgroundSize: '200% 100%',
      animation: 'skeleton-shimmer 1.4s ease-in-out infinite',
    }} />
  );
}

function TranslationSkeletonLoader({ projectName }: { projectName?: string }) {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @keyframes skeleton-shimmer {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1 }
          50%       { opacity: 0.3 }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, padding: '12px 16px',
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#f59e0b',
              display: 'inline-block', animation: 'pulse-dot 1s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              🌐 Engineering Translation in Progress…
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
            {projectName ? `"${projectName}" — ` : ''}
            Gemini 1.5 Pro is translating the technical formulation (MGA/DNP methodology) into English.
            This usually takes 30–60 seconds.
          </p>
        </div>
        <LanguageToggle variant="compact" />
      </div>

      {/* Skeleton blocks */}
      {[
        { icon: '🌳', title: 'Objective Tree', bars: [100, 80, 65, 90, 55, 70] },
        { icon: '📅', title: 'Schedule',        bars: [40, 30] },
        { icon: '💰', title: 'Budget (APU)',     bars: [100, 100, 100] },
      ].map(section => (
        <div key={section.title} style={{ marginBottom: 16, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <SectionTitle icon={section.icon} title={section.title} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {section.bars.map((w, i) => (
              <SkeletonBar key={i} w={`${w}%`} h={10} />
            ))}
          </div>
        </div>
      ))}

      <div style={{
        padding: '10px 14px', background: '#fffbeb',
        border: '1px solid #fde68a', borderRadius: 6,
        fontSize: 11, color: '#92400e', fontFamily: 'monospace',
      }}>
        ⏳ The EN version will be available automatically when the translation job completes.
        Spanish content remains fully accessible — switch to 🇨🇴 ES to continue working.
      </div>
    </div>
  );
}

// ── Árbol de objetivos ────────────────────────────────────────────────────────
const TIPO_COLORS: Record<string, string> = {
  CENTRAL: '#7c3aed', ESPECIFICO: '#2563eb', RESULTADO: '#059669', ACTIVIDAD: '#d97706',
  general: '#7c3aed', specific:   '#2563eb', result:    '#059669', activity: '#d97706',
};

function ObjectiveTree({ nodes, lang }: { nodes: ObjectiveNode[]; lang: string }) {
  if (!nodes?.length) {
    return <p style={{ color: '#9ca3af', fontSize: 12, fontStyle: 'italic', margin: 0 }}>
      {lang === 'en' ? 'No objectives generated yet.' : 'Sin nodos generados aún.'}
    </p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {nodes.map((node, i) => {
        const text  = node.texto || node.content || '—';
        const tipo  = node.tipo || 'CENTRAL';
        const color = TIPO_COLORS[tipo] || '#374151';
        return (
          <div key={i} style={{ paddingLeft: (node.nivel || 0) * 20 + 4, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ marginTop: 4, flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: color }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 10, color, fontWeight: 700, fontFamily: 'monospace', marginRight: 6 }}>{tipo}</span>
              <span style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tabla de presupuesto ──────────────────────────────────────────────────────
function BudgetTable({ items, lang }: { items: BudgetItem[]; lang: string }) {
  if (!items?.length) {
    return <p style={{ color: '#9ca3af', fontSize: 12, fontStyle: 'italic', margin: 0 }}>
      {lang === 'en' ? 'No budget items yet.' : 'Sin ítems de presupuesto.'}
    </p>;
  }
  const fmt = (n?: number) => n != null ? `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}` : '—';
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            {[lang === 'en' ? 'Phase' : 'Fase', lang === 'en' ? 'Chapter' : 'Capítulo', lang === 'en' ? 'Item' : 'Ítem', lang === 'en' ? 'Direct Cost' : 'Costo Directo', 'Total'].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '5px 8px' }}>{it.fase || it.phase || '—'}</td>
              <td style={{ padding: '5px 8px' }}>{it.capitulo || it.chapter || '—'}</td>
              <td style={{ padding: '5px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.item || it.item_name || '—'}</td>
              <td style={{ padding: '5px 8px', color: '#059669', textAlign: 'right' }}>{fmt(it.costo_directo ?? it.direct_cost)}</td>
              <td style={{ padding: '5px 8px', color: '#2563eb', fontWeight: 700, textAlign: 'right' }}>{fmt(it.valor_total ?? it.total_value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function FormulacionViewer({
  payloadEs,
  payloadEn,
  translationStatus: statusProp,
  projectName,
  className = '',
}: Props) {
  const { lang, isEN } = useLanguage();

  // Determinar translation_status desde prop de BD (fuente canónica)
  // o inferir desde el objeto payload_en si no viene la prop
  const translationStatus: TranslationStatus = useMemo(() => {
    if (statusProp) return statusProp;
    const fromPayload = payloadEn?.translation_status as TranslationStatus | undefined;
    if (fromPayload) return fromPayload;
    if (payloadEs && Object.keys(payloadEs).length > 0) return 'pending';
    return 'pending';
  }, [statusProp, payloadEn, payloadEs]);

  // Payload vacío = aún no se ha iniciado la formulación
  const hasEs = payloadEs && Object.keys(payloadEs).length > 0;

  if (!hasEs) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', border: '1px dashed #e5e7eb', borderRadius: 8 }} className={className}>
        <p style={{ fontSize: 14 }}>⏳ Formulación pendiente</p>
        <p style={{ fontSize: 12 }}>Inicia la formulación para ver el árbol de objetivos, cronograma y presupuesto.</p>
      </div>
    );
  }

  // ── DEFENSA: si EN y estado no es 'completed', no acceder a payload_en ──────
  if (isEN) {
    if (translationStatus === 'processing' || translationStatus === 'pending') {
      return (
        <div className={className}>
          <TranslationSkeletonLoader projectName={projectName} />
        </div>
      );
    }

    if (translationStatus === 'failed') {
      // Fallback seguro: mostrar payload_es con alerta
      return (
        <div className={className}>
          <div style={{
            marginBottom: 12, padding: '10px 14px',
            background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 6,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#be123c' }}>
                EN translation failed — showing Spanish content
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9f1239' }}>
                The AI translation step encountered an error. The Spanish formulation is complete and fully operational.
              </p>
            </div>
            <LanguageToggle variant="compact" />
          </div>
          <FormulacionContent payload={payloadEs!} lang="es" />
        </div>
      );
    }

    if (translationStatus === 'skipped' || !payloadEn || Object.keys(payloadEn).length === 0) {
      return (
        <div className={className}>
          <div style={{
            marginBottom: 12, padding: '10px 14px',
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>ℹ️</span>
            <p style={{ margin: 0, fontSize: 11, color: '#166534' }}>
              EN translation not available (Google API key not configured). Showing 🇨🇴 Spanish content.
            </p>
            <LanguageToggle variant="compact" />
          </div>
          <FormulacionContent payload={payloadEs!} lang="es" />
        </div>
      );
    }

    // translationStatus === 'completed' && payloadEn exists → renderizar EN
    return (
      <div className={className}>
        <FormulacionContent payload={payloadEn} lang="en" translatedAt={payloadEn.translated_at} />
      </div>
    );
  }

  // lang === 'es' → siempre payload_es
  return (
    <div className={className}>
      <FormulacionContent payload={payloadEs!} lang="es" />
    </div>
  );
}

// ── Cuerpo del reporte (compartido por ambos idiomas) ─────────────────────────
function FormulacionContent({
  payload,
  lang,
  translatedAt,
}: {
  payload: FormulacionPayload;
  lang: string;
  translatedAt?: string;
}) {
  const isEN        = lang === 'en';
  const name        = payload.proyecto?.nombre || payload.proyecto?.name || payload.project?.name || '—';
  const status      = payload.proyecto?.estado || payload.proyecto?.status || payload.project?.status || '—';
  const objectives  = payload.arbol_objetivos || payload.objective_tree || [];
  const schedule    = payload.cronograma || payload.schedule as any;
  const budgetItems = payload.presupuesto?.items_apu || (payload.budget as any)?.items_apu || [];
  const norms       = payload.marco_normativo || payload.regulatory_framework as any;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, padding: '12px 16px',
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
            {isEN ? '📋 Project Formulation Report' : '📋 Reporte de Formulación'}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>{name}</span>
            {badge(status, '#2563eb')}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <LanguageToggle variant="pill" />
          {isEN && translatedAt && (
            <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
              ✓ Translated by Gemini 1.5 Pro
            </span>
          )}
        </div>
      </div>

      {/* Árbol de Objetivos */}
      <div style={{ marginBottom: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <SectionTitle icon="🌳" title={isEN ? 'Objective Tree' : 'Árbol de Objetivos'} />
        <ObjectiveTree nodes={objectives} lang={lang} />
      </div>

      {/* Cronograma */}
      {schedule && (
        <div style={{ marginBottom: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <SectionTitle icon="📅" title={isEN ? 'Schedule' : 'Cronograma'} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div style={{ padding: 10, background: '#f0fdf4', borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginBottom: 2 }}>
                {isEN ? 'DURATION' : 'DURACIÓN'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>
                {(schedule as any).duracion_meses || (schedule as any).duration_months || '—'}{' '}
                <span style={{ fontSize: 11 }}>{isEN ? 'months' : 'meses'}</span>
              </div>
            </div>
            <div style={{ padding: 10, background: '#eff6ff', borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginBottom: 2 }}>
                {isEN ? 'START DATE' : 'FECHA INICIO'}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>
                {(schedule as any).fecha_inicio || (schedule as any).start_date || '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Presupuesto APU */}
      <div style={{ marginBottom: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <SectionTitle icon="💰" title={isEN ? 'Budget (APU)' : 'Presupuesto (APU)'} />
        <BudgetTable items={budgetItems} lang={lang} />
      </div>

      {/* Marco Normativo */}
      {norms && (
        <div style={{ marginBottom: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <SectionTitle icon="⚖️" title={isEN ? 'Regulatory Framework' : 'Marco Normativo'} />
          {Array.isArray((norms as any)?.normas) ? (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {((norms as any).normas as any[]).slice(0, 8).map((n: any, i: number) => (
                <li key={i} style={{ fontSize: 12, color: '#374151', marginBottom: 3 }}>
                  {n.codigo && <strong style={{ color: '#7c3aed' }}>{n.codigo}: </strong>}
                  {n.nombre || n.name || JSON.stringify(n)}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: '#9ca3af', fontSize: 12, fontStyle: 'italic', margin: 0 }}>
              {isEN ? 'No regulatory norms generated yet.' : 'Sin normas generadas aún.'}
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{
        padding: '8px 12px', background: '#f8fafc', borderRadius: 6,
        border: '1px solid #e2e8f0', fontSize: 10, color: '#94a3b8',
        fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>
          {isEN
            ? '🌐 Showing: English (Gemini 1.5 Pro technical translation)'
            : '🇨🇴 Mostrando: Español (formulación original MGA/DNP)'}
        </span>
        <span>
          {(payload.generado_en || translatedAt)
            ? `Generated: ${new Date(payload.generado_en || translatedAt || '').toLocaleString('es-CO')}`
            : ''}
        </span>
      </div>
    </div>
  );
}
