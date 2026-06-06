import { useState } from 'react';

// ── Stitch scr_panel_control_360 — Dark-mode token map (source: index.css :root)
// Light token → CSS var → resolved hex
// #F8FAFC → --background               → #0b1326
// #FFFFFF → --surface-container-low    → #131b2e
// #E2E8F0 → --outline-variant          → #3e484f
// #F1F5F9 → --outline-variant          → #3e484f
// #2563EB → --primary-container        → #38bdf8  (text, tinted bg)
// #0F172A → --surface-variant          → #2d3449
// #F0FDF4 → --tertiary tint            → rgba(82,232,124,0.10)
const T = {
  bg:          '#0b1326',   // --background
  surface:     '#131b2e',   // --surface-container-low
  surfaceHigh: '#222a3e',   // --surface-container-high
  surfaceVar:  '#2d3449',   // --surface-variant
  outline:     '#3e484f',   // --outline-variant
  text:        '#dbe2fd',   // --on-surface
  textMuted:   '#bdc8d1',   // --on-surface-variant
  textDim:     '#87929a',   // --outline
  primary:     '#38bdf8',   // --primary-container
  tertiary:    '#52e87c',   // --tertiary
  tertiaryCont:'#2ccb63',   // --tertiary-container
  inputBg:     '#060d20',   // --surface-container-lowest
} as const;

// ── Types ────────────────────────────────────────────────────────────────────
export interface SearchKeyword {
  id:      number;
  term:    string;
  enabled: boolean;
}

interface ProjectProfile {
  id: string;
  slotIndex: number;
  name: string;
  prioritizarColombia: boolean;
  paisInternacional: string;
  createdAt: string;
  updatedAt: string;
}

// ── Persistence ──────────────────────────────────────────────────────────────
const PROFILES_KEY = 'rf360_profiles_v1';
const CREDS_KEY    = 'rf360_credentials_v1';
const KEYWORDS_KEY = 'radar_keywords';
const SLOT_COUNT   = 20;

const DEFAULT_KEYWORDS: SearchKeyword[] = [
  { id: 1, term: 'Subvenciones',              enabled: true  },
  { id: 2, term: 'Donaciones',                enabled: true  },
  { id: 3, term: 'Grants',                    enabled: true  },
  { id: 4, term: 'Cooperación Internacional', enabled: false },
  { id: 5, term: 'Infraestructura Modular',   enabled: false },
];

function loadKeywords(): SearchKeyword[] {
  try {
    const s = localStorage.getItem(KEYWORDS_KEY);
    if (s) return JSON.parse(s) as SearchKeyword[];
  } catch {}
  localStorage.setItem(KEYWORDS_KEY, JSON.stringify(DEFAULT_KEYWORDS));
  return DEFAULT_KEYWORDS;
}

function loadProfiles(): Record<number, ProjectProfile> {
  try {
    const s = localStorage.getItem(PROFILES_KEY);
    if (s) return JSON.parse(s) as Record<number, ProjectProfile>;
  } catch {}
  return {};
}

// ── Shared style helpers ─────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: T.textMuted,
  marginBottom: 6,
  letterSpacing: '0.02em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: T.inputBg,
  border: `1px solid ${T.outline}`,
  borderRadius: 6,
  padding: '9px 12px',
  color: T.text,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

// ── Component ────────────────────────────────────────────────────────────────
export default function PanelPage() {
  // Contenedor A state
  const [profiles, setProfiles]   = useState<Record<number, ProjectProfile>>(loadProfiles);
  const [slot, setSlot]           = useState(1);
  const [projName, setProjName]   = useState('');
  const [colombia, setColombia]   = useState(true);
  const [pais, setPais]           = useState('');
  const [savedOk, setSavedOk]     = useState(false);

  // Contenedor B state
  const [gemini, setGemini]         = useState('');
  const [pplx, setPplx]             = useState('');
  const [credsOk, setCredsOk]       = useState(false);
  const [geminiClip, setGeminiClip] = useState<'idle'|'ok'|'err'>('idle');
  const [pplxClip, setPplxClip]     = useState<'idle'|'ok'|'err'>('idle');

  // Keywords state
  const [keywords, setKeywords] = useState<SearchKeyword[]>(loadKeywords);

  function updateKeyword(id: number, changes: Partial<SearchKeyword>) {
    setKeywords(prev => {
      const next = prev.map(k => k.id === id ? { ...k, ...changes } : k);
      try { localStorage.setItem(KEYWORDS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Motor enable flags — persisten en CREDS_KEY para que PestañaRadar los lea
  const [isGeminiEnabled, setIsGeminiEnabled] = useState<boolean>(() => {
    try { const c = JSON.parse(localStorage.getItem(CREDS_KEY) || '{}'); return c.isGeminiEnabled !== false; }
    catch { return true; }
  });
  const [isPerplexityEnabled, setIsPerplexityEnabled] = useState<boolean>(() => {
    try { const c = JSON.parse(localStorage.getItem(CREDS_KEY) || '{}'); return c.isPerplexityEnabled !== false; }
    catch { return true; }
  });

  function persistEngineFlag(key: 'isGeminiEnabled' | 'isPerplexityEnabled', val: boolean) {
    try {
      const prev = JSON.parse(localStorage.getItem(CREDS_KEY) || '{}');
      localStorage.setItem(CREDS_KEY, JSON.stringify({ ...prev, [key]: val, updatedAt: new Date().toISOString() }));
      window.dispatchEvent(new StorageEvent('storage', { key: CREDS_KEY }));
    } catch {}
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  function selectSlot(n: number) {
    setSlot(n);
    const p = profiles[n];
    setProjName(p?.name ?? '');
    setColombia(p?.prioritizarColombia ?? true);
    setPais(p?.paisInternacional ?? '');
  }

  function saveProfile() {
    const now = new Date().toISOString();
    const prev = profiles[slot];
    const updated: ProjectProfile = {
      id:                  prev?.id ?? crypto.randomUUID(),
      slotIndex:           slot,
      name:                projName,
      prioritizarColombia: colombia,
      paisInternacional:   colombia ? '' : pais,
      createdAt:           prev?.createdAt ?? now,
      updatedAt:           now,
    };
    const next = { ...profiles, [slot]: updated };
    setProfiles(next);
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(next)); } catch {}
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  }

  function updateCreds() {
    try {
      localStorage.setItem(CREDS_KEY, JSON.stringify({
        googleGeminiToken:  gemini,
        perplexityToken:    pplx,
        isGeminiEnabled,
        isPerplexityEnabled,
        updatedAt:          new Date().toISOString(),
      }));
      window.dispatchEvent(new StorageEvent('storage', { key: CREDS_KEY }));
    } catch {}
    setCredsOk(true);
    setTimeout(() => setCredsOk(false), 2000);
  }

  async function pasteFromClipboard(
    setter: (v: string) => void,
    setStatus: (s: 'idle'|'ok'|'err') => void,
  ) {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text.length < 8) { setStatus('err'); setTimeout(() => setStatus('idle'), 2500); return; }
      setter(text);
      setStatus('ok');
      setTimeout(() => setStatus('idle'), 2500);
    } catch {
      setStatus('err');
      setTimeout(() => setStatus('idle'), 2500);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: 'calc(100vh - 48px)',
      background: T.bg,
      color: T.text,
      fontFamily: "'Hanken Grotesk', 'Inter', system-ui, sans-serif",
      padding: '32px',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
    }}>

      {/* ── Header (panel_header) ─────────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${T.outline}`, paddingBottom: '16px' }}>
        <p style={{
          fontSize: 10, fontWeight: 700, color: T.textDim,
          letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0 0 6px',
        }}>
          MÓDULO A · PANEL DE CONTROL
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: '0 0 4px', letterSpacing: '-0.01em' }}>
          Panel de Control — Centro de Mando
        </h1>
        <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>
          Parametrización global de proyectos y credenciales de infraestructura.
        </p>
      </div>

      {/* ── Grid Workspace (panel_grid_workspace) ────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* ─── CONTENEDOR A — Gestión de Favoritos ──────────────────────────── */}
        <div style={{
          background: T.surface,
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.30)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          <p style={{
            fontSize: 9, fontWeight: 700, color: T.textDim,
            letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0,
          }}>
            ♥ Gestión de Favoritos — 20 Perfiles
          </p>

          {/* profile_selector_dropdown */}
          <div>
            <label style={labelStyle}>Cargar Ficha de Profesional Guardada</label>
            <select
              value={slot}
              onChange={e => selectSlot(Number(e.target.value))}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {Array.from({ length: SLOT_COUNT }, (_, i) => {
                const n = i + 1;
                const p = profiles[n];
                return (
                  <option key={n} value={n} style={{ background: T.surface, color: T.text }}>
                    {p?.name ? `Ficha ${n}: ${p.name}` : `Ficha ${n} — (vacía)`}
                  </option>
                );
              })}
            </select>
          </div>

          {/* input_project_name */}
          <div>
            <label style={labelStyle}>Nombre de la Ficha Técnica / Proyecto</label>
            <input
              type="text"
              value={projName}
              onChange={e => setProjName(e.target.value)}
              placeholder="Ej: Construcción Modular Saneamiento Veredal"
              style={inputStyle}
            />
          </div>

          {/* switch_cobertura_colombia */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: T.textMuted, margin: '0 0 2px' }}>
                Priorizar Cobertura Colombia
              </p>
              <p style={{ fontSize: 11, color: T.textDim, margin: 0 }}>
                Aplica normatividad MGA y Plan Nacional de Desarrollo
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={colombia}
              onClick={() => setColombia(v => !v)}
              style={{
                width: 44, height: 24, borderRadius: 9999, padding: 0, border: 'none',
                background: colombia ? T.tertiaryCont : T.surfaceHigh,
                cursor: 'pointer', position: 'relative', flexShrink: 0,
                transition: 'background 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 3,
                left: colombia ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%',
                background: '#ffffff',
                transition: 'left 0.18s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }} />
            </button>
          </div>

          {/* combobox_pais_internacional — visible when colombia === false */}
          {!colombia && (
            <div>
              <label style={labelStyle}>País de Destino Internacional</label>
              <input
                type="text"
                value={pais}
                onChange={e => setPais(e.target.value)}
                placeholder="Ej: Alemania, Venezuela, Global..."
                style={inputStyle}
                autoFocus
              />
            </div>
          )}

          {/* btn_guardar_perfil */}
          <button
            type="button"
            onClick={saveProfile}
            style={{
              alignSelf: 'flex-start',
              background: savedOk ? 'rgba(44,203,99,0.15)' : 'rgba(56,189,248,0.12)',
              border: `1px solid ${savedOk ? 'rgba(44,203,99,0.45)' : 'rgba(56,189,248,0.35)'}`,
              color: savedOk ? T.tertiaryCont : T.primary,
              borderRadius: '6px', padding: '10px 16px',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              transition: 'all 0.15s',
            }}
          >
            {savedOk ? '✓ GUARDADO' : 'Guardar Ficha en Favoritos'}
          </button>
        </div>

        {/* ─── CONTENEDOR B — Búnker de Conexiones ─────────────────────────── */}
        <div style={{
          background: T.surface,
          borderRadius: '12px',
          padding: '24px',
          border: `1px solid ${T.outline}`,
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.30)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          <p style={{
            fontSize: 9, fontWeight: 700, color: T.textDim,
            letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0,
          }}>
            ⚿ Búnker de Conexiones — APIs
          </p>

          {/* ── Instrucción dummy ── */}
          <div style={{
            background: 'rgba(56,189,248,0.06)',
            border: '1px solid rgba(56,189,248,0.18)',
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
            <p style={{ fontSize: 11, color: T.textMuted, margin: 0, lineHeight: 1.5 }}>
              Haz clic en el enlace, copia tu código y vuelve aquí para presionar{' '}
              <span style={{ color: T.primary, fontWeight: 700 }}>"Autocompletar"</span> — ¡Listo!
            </p>
          </div>

          {/* ── Google Gemini ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Toggle + label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button" role="switch" aria-checked={isGeminiEnabled}
                  onClick={() => { const v = !isGeminiEnabled; setIsGeminiEnabled(v); persistEngineFlag('isGeminiEnabled', v); }}
                  style={{
                    width: 36, height: 20, borderRadius: 9999, padding: 0, border: 'none',
                    background: isGeminiEnabled ? T.tertiaryCont : T.surfaceHigh,
                    cursor: 'pointer', position: 'relative', flexShrink: 0,
                    transition: 'background 0.2s', boxShadow: isGeminiEnabled ? `0 0 6px ${T.tertiaryCont}88` : 'none',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: isGeminiEnabled ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  }} />
                </button>
                <label style={{ ...labelStyle, margin: 0, color: isGeminiEnabled ? T.textMuted : T.textDim }}>
                  Google Gemini API Key
                </label>
              </div>
              <button
                type="button"
                onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank', 'noopener')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: isGeminiEnabled ? T.primary : T.textDim, fontWeight: 700,
                  letterSpacing: '0.04em', textDecoration: 'underline',
                  padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'opacity 0.15s',
                }}
              >
                🔗 Obtener Token
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, opacity: isGeminiEnabled ? 1 : 0.35, transition: 'opacity 0.2s' }}>
              <input
                type="password"
                value={gemini}
                onChange={e => setGemini(e.target.value)}
                placeholder="AIzaSy... o Bearer eyJhbGciOi..."
                disabled={!isGeminiEnabled}
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", flex: 1,
                  cursor: isGeminiEnabled ? 'text' : 'not-allowed' }}
              />
              <button
                type="button"
                onClick={() => pasteFromClipboard(setGemini, setGeminiClip)}
                disabled={!isGeminiEnabled}
                style={{
                  flexShrink: 0,
                  background: geminiClip === 'ok'  ? 'rgba(82,232,124,0.15)'
                            : geminiClip === 'err' ? 'rgba(248,113,113,0.15)'
                            : 'rgba(56,189,248,0.10)',
                  border: `1px solid ${geminiClip === 'ok'  ? 'rgba(82,232,124,0.45)'
                                      : geminiClip === 'err' ? 'rgba(248,113,113,0.45)'
                                      : 'rgba(56,189,248,0.30)'}`,
                  color: geminiClip === 'ok' ? T.tertiary : geminiClip === 'err' ? '#f87171' : T.primary,
                  borderRadius: '6px', padding: '0 12px',
                  fontSize: 11, fontWeight: 700, cursor: isGeminiEnabled ? 'pointer' : 'not-allowed',
                  letterSpacing: '0.04em', whiteSpace: 'nowrap', transition: 'all 0.15s',
                }}
              >
                {geminiClip === 'ok' ? '✓ Pegado' : geminiClip === 'err' ? '✗ Error' : '📋 Autocompletar'}
              </button>
            </div>
          </div>

          {/* ── Perplexity ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Toggle + label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button" role="switch" aria-checked={isPerplexityEnabled}
                  onClick={() => { const v = !isPerplexityEnabled; setIsPerplexityEnabled(v); persistEngineFlag('isPerplexityEnabled', v); }}
                  style={{
                    width: 36, height: 20, borderRadius: 9999, padding: 0, border: 'none',
                    background: isPerplexityEnabled ? T.tertiaryCont : T.surfaceHigh,
                    cursor: 'pointer', position: 'relative', flexShrink: 0,
                    transition: 'background 0.2s', boxShadow: isPerplexityEnabled ? `0 0 6px ${T.tertiaryCont}88` : 'none',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: isPerplexityEnabled ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  }} />
                </button>
                <label style={{ ...labelStyle, margin: 0, color: isPerplexityEnabled ? T.textMuted : T.textDim }}>
                  Perplexity API — Engine Token
                </label>
              </div>
              <button
                type="button"
                onClick={() => window.open('https://www.perplexity.ai/settings/api', '_blank', 'noopener')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: isPerplexityEnabled ? '#bdc2ff' : T.textDim, fontWeight: 700,
                  letterSpacing: '0.04em', textDecoration: 'underline',
                  padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'opacity 0.15s',
                }}
              >
                🔗 Obtener Token
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, opacity: isPerplexityEnabled ? 1 : 0.35, transition: 'opacity 0.2s' }}>
              <input
                type="password"
                value={pplx}
                onChange={e => setPplx(e.target.value)}
                placeholder="pplx-xxxxxxxxxxxxxxxxxxxxxxxx"
                disabled={!isPerplexityEnabled}
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", flex: 1,
                  cursor: isPerplexityEnabled ? 'text' : 'not-allowed' }}
              />
              <button
                type="button"
                onClick={() => pasteFromClipboard(setPplx, setPplxClip)}
                disabled={!isPerplexityEnabled}
                style={{
                  flexShrink: 0,
                  background: pplxClip === 'ok'  ? 'rgba(82,232,124,0.15)'
                            : pplxClip === 'err' ? 'rgba(248,113,113,0.15)'
                            : 'rgba(189,194,255,0.10)',
                  border: `1px solid ${pplxClip === 'ok'  ? 'rgba(82,232,124,0.45)'
                                      : pplxClip === 'err' ? 'rgba(248,113,113,0.45)'
                                      : 'rgba(189,194,255,0.30)'}`,
                  color: pplxClip === 'ok' ? T.tertiary : pplxClip === 'err' ? '#f87171' : '#bdc2ff',
                  borderRadius: '6px', padding: '0 12px',
                  fontSize: 11, fontWeight: 700, cursor: isPerplexityEnabled ? 'pointer' : 'not-allowed',
                  letterSpacing: '0.04em', whiteSpace: 'nowrap', transition: 'all 0.15s',
                }}
              >
                {pplxClip === 'ok' ? '✓ Pegado' : pplxClip === 'err' ? '✗ Error' : '📋 Autocompletar'}
              </button>
            </div>
          </div>

          {/* ── Matriz de Palabras Clave — Barrido Gemini ── */}
          <div style={{
            borderTop: `1px solid ${T.outline}`,
            paddingTop: 14,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <p style={{
              fontSize: 9, fontWeight: 700, color: T.textDim,
              letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0,
            }}>
              🔍 Palabras Clave — Barrido Autónomo Gemini
            </p>
            {keywords.map(kw => (
              <div key={kw.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button" role="switch" aria-checked={kw.enabled}
                  onClick={() => updateKeyword(kw.id, { enabled: !kw.enabled })}
                  style={{
                    width: 32, height: 18, borderRadius: 9999, padding: 0, border: 'none',
                    background: kw.enabled ? T.tertiaryCont : T.surfaceHigh,
                    cursor: 'pointer', position: 'relative', flexShrink: 0,
                    transition: 'background 0.2s',
                    boxShadow: kw.enabled ? `0 0 5px ${T.tertiaryCont}88` : 'none',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: kw.enabled ? 16 : 2,
                    width: 14, height: 14, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  }} />
                </button>
                <input
                  type="text"
                  value={kw.term}
                  onChange={e => updateKeyword(kw.id, { term: e.target.value })}
                  style={{
                    flex: 1,
                    background: T.inputBg,
                    border: `1px solid ${kw.enabled ? T.outline : T.surfaceHigh}`,
                    borderRadius: 6, padding: '6px 10px',
                    color: kw.enabled ? T.text : T.textDim,
                    fontSize: 12, outline: 'none',
                    fontFamily: "'JetBrains Mono', monospace",
                    opacity: kw.enabled ? 1 : 0.45,
                    transition: 'all 0.2s',
                  }}
                />
              </div>
            ))}
          </div>

          {/* status_indicator_box */}
          <div style={{
            background: 'rgba(82,232,124,0.10)',
            border: '1px solid rgba(82,232,124,0.25)',
            padding: '10px 12px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.tertiary, flexShrink: 0 }} />
            <p style={{ fontSize: 11, color: T.tertiary, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
              Canal unificado bajo protocolo streamable-http listo.
            </p>
          </div>

          {/* btn_salvar_credenciales */}
          <button
            type="button"
            onClick={updateCreds}
            style={{
              alignSelf: 'flex-start',
              background: credsOk ? 'rgba(82,232,124,0.15)' : `${T.surfaceVar}cc`,
              border: `1px solid ${credsOk ? 'rgba(82,232,124,0.45)' : T.outline}`,
              color: credsOk ? T.tertiary : T.textMuted,
              borderRadius: '6px', padding: '10px 16px',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              transition: 'all 0.15s',
            }}
          >
            {credsOk ? '✓ ACTUALIZADO' : 'Actualizar Credenciales en Caliente'}
          </button>
        </div>

      </div>
    </div>
  );
}
