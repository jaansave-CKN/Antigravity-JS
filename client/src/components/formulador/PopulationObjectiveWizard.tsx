/**
 * PopulationObjectiveWizard — Paso de Población Objetivo
 *
 * Diseño: Enterprise Blue · Tokens exactos Stitch MCP
 *   bg      #F8FAFC  (layout)
 *   card    #FFFFFF  border #E2E8F0  radius 12px  shadow 0 4px 6px -1px rgba(0,0,0,0.05)
 *   text    #1E293B  secondary #64748B
 *   accent  #2563EB  (blue-600)
 *
 * Output JSON: { poblacion: { institucional: string[], comunitaria: string[],
 *                              productiva: string[], otros: string } }
 *
 * Props:
 *   initialData?  — datos precargados (para integración con wizard padre)
 *   onSubmit      — recibe el JSON limpio; el padre lo envía al pipeline LangGraph
 *   onBack?       — navegación al paso anterior
 */

import { useState, useCallback, useId } from 'react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PoblacionPayload {
  institucional: string[];
  comunitaria:   string[];
  productiva:    string[];
  otros:         string;
}

export interface PopulationObjectiveData {
  poblacion: PoblacionPayload;
}

interface Props {
  initialData?: Partial<PopulationObjectiveData>;
  onSubmit:     (data: PopulationObjectiveData) => void | Promise<void>;
  onBack?:      () => void;
  loading?:     boolean;
}

// ── Catálogos de opciones por sección ────────────────────────────────────────

const SECTION_A_INSTITUCIONAL = [
  'Alcaldías municipales',
  'Gobernaciones departamentales',
  'Entidades descentralizadas',
  'Institutos técnicos públicos',
  'Secretarías de planeación',
  'Personerías y contralorías',
  'Juntas Administradoras Locales (JAL)',
  'Otro',
] as const;

const SECTION_B_COMUNITARIA = [
  'Juntas de Acción Comunal (JAC)',
  'Asociaciones de usuarios',
  'Consejos comunitarios afrocolombianos',
  'Cabildos indígenas y resguardos',
  'Organizaciones de mujeres rurales',
  'Comités de agua y saneamiento',
  'Redes de líderes comunitarios',
  'Veedurías ciudadanas',
  'Otro',
] as const;

const SECTION_C_PRODUCTIVA = [
  'Pequeños y medianos agricultores',
  'Cooperativas agropecuarias',
  'Empresas de economía solidaria',
  'Artesanos y economía creativa',
  'Microempresarios urbanos y rurales',
  'Emprendedores juveniles',
  'Asociaciones ganaderas y pesqueras',
  'Otro',
] as const;

// ── Tokens CSS exactos del Plano de Obra (Stitch MCP) ────────────────────────

const T = {
  bg:           '#F8FAFC',
  cardBg:       '#FFFFFF',
  border:       '#E2E8F0',
  radius:       '12px',
  shadow:       '0 4px 6px -1px rgba(0,0,0,0.05)',
  text:         '#1E293B',
  textSec:      '#64748B',
  textMuted:    '#94A3B8',
  accent:       '#2563EB',
  accentLight:  '#EFF6FF',
  accentBorder: '#BFDBFE',
  checkBorder:  '#CBD5E1',
  checkHover:   '#DBEAFE',
  success:      '#16A34A',
  successLight: '#F0FDF4',
  headerBg:     '#F1F5F9',
} as const;

// ── Sub-componente: Checkbox Option ──────────────────────────────────────────

interface CheckboxOptionProps {
  id:       string;
  label:    string;
  checked:  boolean;
  onChange: (checked: boolean) => void;
  accent?:  string;
}

function CheckboxOption({ id, label, checked, onChange, accent = T.accent }: CheckboxOptionProps) {
  return (
    <label
      htmlFor={id}
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            '10px',
        padding:        '10px 12px',
        borderRadius:   '8px',
        border:         `1px solid ${checked ? accent + '40' : T.border}`,
        background:     checked ? accent + '08' : T.cardBg,
        cursor:         'pointer',
        transition:     'all 0.15s ease',
        userSelect:     'none',
        minHeight:      '44px',
      }}
      onMouseEnter={e => {
        if (!checked) (e.currentTarget as HTMLLabelElement).style.background = T.checkHover;
      }}
      onMouseLeave={e => {
        if (!checked) (e.currentTarget as HTMLLabelElement).style.background = T.cardBg;
      }}
    >
      {/* Checkbox visual grande (20×20) */}
      <div
        style={{
          width:          '20px',
          height:         '20px',
          borderRadius:   '5px',
          border:         `2px solid ${checked ? accent : T.checkBorder}`,
          background:     checked ? accent : 'transparent',
          flexShrink:     0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          transition:     'all 0.15s ease',
        }}
      >
        {checked && (
          <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
            <path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span style={{ fontSize: '13px', color: checked ? T.text : T.textSec, fontWeight: checked ? 500 : 400, lineHeight: 1.4 }}>
        {label}
      </span>
    </label>
  );
}

// ── Sub-componente: SectionCard ───────────────────────────────────────────────

interface SectionCardProps {
  letter:   'A' | 'B' | 'C';
  title:    string;
  subtitle: string;
  accent:   string;
  children: React.ReactNode;
  count:    number;
}

function SectionCard({ letter, title, subtitle, accent, children, count }: SectionCardProps) {
  return (
    <div style={{
      background:   T.cardBg,
      borderRadius: T.radius,
      border:       `1px solid ${T.border}`,
      boxShadow:    T.shadow,
      overflow:     'hidden',
      display:      'flex',
      flexDirection: 'column',
    }}>
      {/* Header de la sección */}
      <div style={{
        padding:      '16px 20px',
        borderBottom: `1px solid ${T.border}`,
        background:   T.headerBg,
        display:      'flex',
        alignItems:   'center',
        gap:          '12px',
      }}>
        <div style={{
          width:          '32px',
          height:         '32px',
          borderRadius:   '8px',
          background:     accent + '15',
          border:         `1px solid ${accent}30`,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          flexShrink:     0,
          fontFamily:     'JetBrains Mono, monospace',
          fontSize:       '13px',
          fontWeight:     700,
          color:          accent,
        }}>
          {letter}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: T.text, lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '2px' }}>{subtitle}</div>
        </div>
        {count > 0 && (
          <div style={{
            background:   accent,
            color:        '#fff',
            borderRadius: '9999px',
            fontSize:     '11px',
            fontWeight:   700,
            padding:      '2px 8px',
            flexShrink:   0,
          }}>
            {count}
          </div>
        )}
      </div>

      {/* Opciones */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function PopulationObjectiveWizard({ initialData, onSubmit, onBack, loading = false }: Props) {
  const uid = useId();

  // ── Estado de checkboxes ──────────────────────────────────────────────────
  const [institucional, setInstitucional] = useState<Set<string>>(
    new Set(initialData?.poblacion?.institucional ?? [])
  );
  const [comunitaria, setComunitaria] = useState<Set<string>>(
    new Set(initialData?.poblacion?.comunitaria ?? [])
  );
  const [productiva, setProductiva] = useState<Set<string>>(
    new Set(initialData?.poblacion?.productiva ?? [])
  );

  // ── Estado de campos "Otro" ───────────────────────────────────────────────
  const [otroInstitucional, setOtroInstitucional] = useState('');
  const [otroComunitaria,   setOtroComunitaria]   = useState('');
  const [otroProductiva,    setOtroProductiva]    = useState('');

  // ── Estado de envío ───────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  // ── Handlers genéricos ────────────────────────────────────────────────────
  const toggleSet = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
      (item: string, checked: boolean) => {
        setter(prev => {
          const next = new Set(prev);
          if (checked) next.add(item);
          else next.delete(item);
          return next;
        });
      },
    []
  );

  const toggleA = toggleSet(setInstitucional);
  const toggleB = toggleSet(setComunitaria);
  const toggleC = toggleSet(setProductiva);

  // ── Resolver items con "Otro" ─────────────────────────────────────────────
  const resolveItems = (set: Set<string>, otroText: string): string[] => {
    const items = Array.from(set).filter(i => i !== 'Otro');
    if (set.has('Otro') && otroText.trim()) items.push(otroText.trim());
    return items;
  };

  // ── Conteos para badges ───────────────────────────────────────────────────
  const countA = institucional.size - (institucional.has('Otro') ? 1 : 0) + (institucional.has('Otro') && otroInstitucional.trim() ? 1 : 0);
  const countB = comunitaria.size   - (comunitaria.has('Otro')   ? 1 : 0) + (comunitaria.has('Otro')   && otroComunitaria.trim()   ? 1 : 0);
  const countC = productiva.size    - (productiva.has('Otro')    ? 1 : 0) + (productiva.has('Otro')    && otroProductiva.trim()    ? 1 : 0);
  const totalSelected = countA + countB + countC;

  // ── Validación mínima ─────────────────────────────────────────────────────
  const validate = (): boolean => {
    if (totalSelected === 0) {
      setError('Selecciona al menos una población objetivo para continuar.');
      return false;
    }
    setError('');
    return true;
  };

  // ── handleSubmit — produce JSON limpio para el pipeline LangGraph ─────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const otros = [
      otroInstitucional.trim(),
      otroComunitaria.trim(),
      otroProductiva.trim(),
    ].filter(Boolean).join('; ');

    const payload: PopulationObjectiveData = {
      poblacion: {
        institucional: resolveItems(institucional, otroInstitucional),
        comunitaria:   resolveItems(comunitaria,   otroComunitaria),
        productiva:    resolveItems(productiva,    otroProductiva),
        otros,
      },
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = loading || submitting;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: T.bg, padding: '32px 24px', minHeight: '100%' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <div style={{
            width: '4px', height: '24px', borderRadius: '2px',
            background: 'linear-gradient(180deg, #2563EB, #7C3AED)',
          }} />
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: T.text }}>
            Población Objetivo
          </h2>
          {totalSelected > 0 && (
            <span style={{
              background: T.successLight, color: T.success,
              border: `1px solid ${T.success}30`,
              borderRadius: '9999px', fontSize: '11px', fontWeight: 700,
              padding: '2px 10px',
            }}>
              {totalSelected} seleccionada{totalSelected !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: T.textSec, maxWidth: '640px' }}>
          Define los grupos poblacionales que se beneficiarán directamente del proyecto.
          Las selecciones alimentan el módulo M4 del pipeline LangGraph (Árbol de Objetivos).
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>

        {/* ── Grid 3 columnas ─────────────────────────────────────────── */}
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap:                 '20px',
          marginBottom:        '24px',
        }}
          className="pop-grid"
        >

          {/* ── Sección A: Fortalecimiento Institucional ───────────────── */}
          <SectionCard
            letter="A" count={countA}
            accent="#2563EB"
            title="Fortalecimiento Institucional"
            subtitle="Entidades públicas y de gobierno"
          >
            {SECTION_A_INSTITUCIONAL.map(opt => (
              <div key={opt}>
                <CheckboxOption
                  id={`${uid}-a-${opt}`}
                  label={opt}
                  checked={institucional.has(opt)}
                  onChange={v => toggleA(opt, v)}
                  accent="#2563EB"
                />
                {opt === 'Otro' && institucional.has('Otro') && (
                  <input
                    type="text"
                    placeholder="Especifica la entidad..."
                    aria-label="Especifica la entidad institucional"
                    value={otroInstitucional}
                    onChange={e => setOtroInstitucional(e.target.value)}
                    style={{
                      marginTop:   '6px',
                      width:       '100%',
                      padding:     '8px 12px',
                      fontSize:    '12px',
                      borderRadius: '8px',
                      border:      `1px solid #2563EB40`,
                      background:  T.accentLight,
                      color:       T.text,
                      outline:     'none',
                      boxSizing:   'border-box',
                    }}
                    autoFocus
                  />
                )}
              </div>
            ))}
          </SectionCard>

          {/* ── Sección B: Organizaciones Comunitarias ─────────────────── */}
          <SectionCard
            letter="B" count={countB}
            accent="#7C3AED"
            title="Organizaciones Comunitarias"
            subtitle="Tejido social y participación ciudadana"
          >
            {SECTION_B_COMUNITARIA.map(opt => (
              <div key={opt}>
                <CheckboxOption
                  id={`${uid}-b-${opt}`}
                  label={opt}
                  checked={comunitaria.has(opt)}
                  onChange={v => toggleB(opt, v)}
                  accent="#7C3AED"
                />
                {opt === 'Otro' && comunitaria.has('Otro') && (
                  <input
                    type="text"
                    placeholder="Especifica la organización..."
                    aria-label="Especifica la organización comunitaria"
                    value={otroComunitaria}
                    onChange={e => setOtroComunitaria(e.target.value)}
                    style={{
                      marginTop:   '6px',
                      width:       '100%',
                      padding:     '8px 12px',
                      fontSize:    '12px',
                      borderRadius: '8px',
                      border:      `1px solid #7C3AED40`,
                      background:  '#F5F3FF',
                      color:       T.text,
                      outline:     'none',
                      boxSizing:   'border-box',
                    }}
                    autoFocus
                  />
                )}
              </div>
            ))}
          </SectionCard>

          {/* ── Sección C: Sector Productivo ───────────────────────────── */}
          <SectionCard
            letter="C" count={countC}
            accent="#0D9488"
            title="Sector Productivo"
            subtitle="Actores económicos y empresariales"
          >
            {SECTION_C_PRODUCTIVA.map(opt => (
              <div key={opt}>
                <CheckboxOption
                  id={`${uid}-c-${opt}`}
                  label={opt}
                  checked={productiva.has(opt)}
                  onChange={v => toggleC(opt, v)}
                  accent="#0D9488"
                />
                {opt === 'Otro' && productiva.has('Otro') && (
                  <input
                    type="text"
                    placeholder="Especifica el sector..."
                    aria-label="Especifica el sector productivo"
                    value={otroProductiva}
                    onChange={e => setOtroProductiva(e.target.value)}
                    style={{
                      marginTop:   '6px',
                      width:       '100%',
                      padding:     '8px 12px',
                      fontSize:    '12px',
                      borderRadius: '8px',
                      border:      `1px solid #0D948840`,
                      background:  '#F0FDFA',
                      color:       T.text,
                      outline:     'none',
                      boxSizing:   'border-box',
                    }}
                    autoFocus
                  />
                )}
              </div>
            ))}
          </SectionCard>

        </div>

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: '8px', padding: '10px 16px',
            fontSize: '13px', color: '#DC2626',
            marginBottom: '20px',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#DC2626" strokeWidth="1.5"/>
              <path d="M8 5v3M8 10.5v.5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        {/* ── Barra de acciones ────────────────────────────────────────── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          paddingTop:     '20px',
          borderTop:      `1px solid ${T.border}`,
          gap:            '12px',
        }}>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={isLoading}
              style={{
                padding:      '10px 20px',
                borderRadius: '8px',
                border:       `1px solid ${T.border}`,
                background:   T.cardBg,
                color:        T.textSec,
                fontSize:     '13px',
                fontWeight:   500,
                cursor:       'pointer',
                transition:   'all 0.15s',
                opacity:      isLoading ? 0.5 : 1,
              }}
            >
              ← Paso anterior
            </button>
          ) : <div />}

          {/* Resumen de selección */}
          {totalSelected > 0 && (
            <div style={{ fontSize: '12px', color: T.textMuted, flex: 1, textAlign: 'center' }}>
              {countA > 0 && <span style={{ marginRight: 8 }}>A: {countA}</span>}
              {countB > 0 && <span style={{ marginRight: 8 }}>B: {countB}</span>}
              {countC > 0 && <span>C: {countC}</span>}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding:         '10px 28px',
              borderRadius:    '8px',
              border:          'none',
              background:      isLoading ? '#93C5FD' : T.accent,
              color:           '#fff',
              fontSize:        '13px',
              fontWeight:      600,
              cursor:          isLoading ? 'not-allowed' : 'pointer',
              transition:      'all 0.15s',
              display:         'flex',
              alignItems:      'center',
              gap:             '8px',
              boxShadow:       isLoading ? 'none' : '0 2px 8px rgba(37,99,235,0.30)',
            }}
          >
            {isLoading ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
                </svg>
                Procesando…
              </>
            ) : (
              <>Siguiente paso →</>
            )}
          </button>
        </div>

      </form>

      {/* ── Estilos responsive + animación spinner ────────────────────── */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .pop-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 580px) {
          .pop-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

    </div>
  );
}
