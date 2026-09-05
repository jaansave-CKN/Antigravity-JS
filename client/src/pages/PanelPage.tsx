import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContextNew';
import { http } from '../lib/apiClient';

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
// FIX (react-doctor client-localstorage-no-version, 2026-09-05): clave
// versionada — loadKeywords() migra la clave vieja.
const KEYWORDS_KEY = 'radar_keywords:v1';
const KEYWORDS_KEY_LEGACY = 'radar_keywords';
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
    let s = localStorage.getItem(KEYWORDS_KEY);
    if (!s) {
      const legado = localStorage.getItem(KEYWORDS_KEY_LEGACY);
      if (legado) { localStorage.setItem(KEYWORDS_KEY, legado); localStorage.removeItem(KEYWORDS_KEY_LEGACY); s = legado; }
    }
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

// ── QuotaTelemetry — Widget de Telemetría Gemini ─────────────────────────────
interface QuotaData {
  operating_mode: 'IA Avanzada' | 'Respaldo';
  circuit_state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  current_usage: { daily: number; rpm_last_minute: number };
  limit_daily: number;
  limit_rpm: number;
  daily_pct: number;
  rpm_pct: number;
  reset_time_countdown: string;
  reset_at: string;
  last_quota_error: string | null;
}

function QuotaTelemetry() {
  const { token } = useAuth();
  const [data, setData]       = useState<QuotaData | null>(null);
  const [error, setError]     = useState('');
  const [countdown, setCountdown] = useState('--:--:--');
  const resetAtRef = useRef<string | null>(null);

  // Actualiza el reloj cada segundo de forma local (sin re-fetch)
  useEffect(() => {
    const tick = setInterval(() => {
      if (!resetAtRef.current) return;
      const ms = Math.max(0, new Date(resetAtRef.current).getTime() - Date.now());
      const hh = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
      const mm = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
      const ss = String(Math.floor((ms % 60_000) / 1_000)).padStart(2, '0');
      setCountdown(`${hh}:${mm}:${ss}`);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // Fetch cada 30 s
  useEffect(() => {
    async function fetchQuota() {
      try {
        const res  = await fetch('/api/admin/quota-status', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = await res.json();
        if (json.success) {
          setData(json.data);
          resetAtRef.current = json.data.reset_at;
          setError('');
        }
      } catch { setError('No se pudo conectar al servidor de cuotas.'); }
    }
    fetchQuota();
    const interval = setInterval(fetchQuota, 30_000);
    return () => clearInterval(interval);
  }, [token]);

  const isIA      = data?.operating_mode === 'IA Avanzada';
  const modeColor = isIA ? T.tertiary : '#fb923c';
  const modeBg    = isIA ? 'rgba(82,232,124,0.10)' : 'rgba(251,146,60,0.10)';
  const modeBorder= isIA ? 'rgba(82,232,124,0.25)' : 'rgba(251,146,60,0.25)';
  const dailyPct  = data?.daily_pct ?? 0;
  const barColor  = dailyPct >= 90 ? '#f87171' : dailyPct >= 70 ? '#fb923c' : T.tertiary;

  return (
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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
          📡 Telemetría — Motor de IA
        </p>
        {/* Badge de modo */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: modeBg, border: `1px solid ${modeBorder}`,
          borderRadius: 9999, padding: '4px 10px',
          fontSize: 11, fontWeight: 700, color: modeColor,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.04em',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: modeColor,
            boxShadow: `0 0 6px ${modeColor}`, flexShrink: 0,
            animation: isIA ? 'none' : undefined,
          }} />
          {data?.operating_mode ?? '—'}
        </span>
      </div>

      {error && (
        <p style={{ fontSize: 11, color: '#f87171', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
          ⚠ {error}
        </p>
      )}

      {data && (
        <>
          {/* Barra — consumo diario */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Consumo Diario</span>
              <span style={{ fontSize: 11, color: barColor, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {data.current_usage.daily} / {data.limit_daily} req ({data.daily_pct}%)
              </span>
            </div>
            <div style={{ height: 8, background: T.surfaceVar, borderRadius: 9999, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 9999,
                width: `${data.daily_pct}%`,
                background: barColor,
                transition: 'width 0.6s ease, background-color 0.4s',
                boxShadow: dailyPct >= 70 ? `0 0 8px ${barColor}88` : 'none',
              }} />
            </div>
          </div>

          {/* Barra — RPM */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Peticiones / Minuto</span>
              <span style={{ fontSize: 11, color: T.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                {data.current_usage.rpm_last_minute} / {data.limit_rpm} RPM
              </span>
            </div>
            <div style={{ height: 5, background: T.surfaceVar, borderRadius: 9999, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 9999,
                width: `${data.rpm_pct}%`,
                background: T.primary,
                transition: 'width 0.6s ease',
              }} />
            </div>
          </div>

          {/* Reloj cuenta regresiva */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: T.surfaceVar, borderRadius: 8, padding: '10px 14px',
          }}>
            <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Reset diario en</span>
            <span style={{
              fontSize: 18, fontWeight: 700, color: T.primary,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em',
            }}>
              {countdown}
            </span>
          </div>

          {/* Estado circuito + último error */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, background: T.inputBg, borderRadius: 8, padding: '8px 12px' }}>
              <p style={{ fontSize: 9, color: T.textDim, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 4px' }}>
                Estado Circuito
              </p>
              <p style={{ fontSize: 12, color: isIA ? T.tertiary : '#fb923c', fontFamily: "'JetBrains Mono', monospace", margin: 0, fontWeight: 700 }}>
                {data.circuit_state}
              </p>
            </div>
            {data.last_quota_error && (
              <div style={{ flex: 1, background: T.inputBg, borderRadius: 8, padding: '8px 12px' }}>
                <p style={{ fontSize: 9, color: T.textDim, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 4px' }}>
                  Último Error 429
                </p>
                <p style={{ fontSize: 11, color: '#f87171', fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
                  {new Date(data.last_quota_error).toLocaleTimeString('es-CO')}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {!data && !error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textDim, fontSize: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${T.primary}`, borderTopColor: 'transparent',
            display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
          Cargando telemetría...
        </div>
      )}
    </div>
  );
}

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
  const [credsOk, setCredsOk]       = useState(false);

  // Keywords state
  const [keywords, setKeywords] = useState<SearchKeyword[]>(loadKeywords);

  // Al montar: localStorage es la fuente de verdad para la UI.
  // El backend (DB) es solo para que el rastreo R2 conozca las keywords activas.
  // → Siempre empujamos localStorage → DB (nunca al revés), para evitar reset en F5.
  useEffect(() => {
    const local = loadKeywords();
    // Solo admins pueden escribir esta config global (server.js exige rol admin) —
    // para no-admins el 403 es esperado y se ignora silenciosamente aquí.
    http.put('/api/panel/keywords', { keywords: local }).catch(() => {});
  }, []);

  function updateKeyword(id: number, changes: Partial<SearchKeyword>) {
    // FIX (react-doctor no-impure-state-updater, 2026-09-05): localStorage.
    // setItem y el POST http.put vivían dentro del updater de setKeywords —
    // un updater puede reintentarse/descartarse, lo que arriesgaba escrituras
    // duplicadas o perdidas. `updateKeyword` es una función plana (se recrea
    // cada render), `keywords` del closure ya es el valor actual.
    const next = keywords.map(k => k.id === id ? { ...k, ...changes } : k);
    try { localStorage.setItem(KEYWORDS_KEY, JSON.stringify(next)); } catch {}
    http.put('/api/panel/keywords', { keywords: next }).catch(() => {});
    setKeywords(next);
  }

  // Motor enable flags — persisten en CREDS_KEY para que PestañaRadar los lea
  const [isGeminiEnabled, setIsGeminiEnabled] = useState<boolean>(() => {
    try { const c = JSON.parse(localStorage.getItem(CREDS_KEY) || '{}'); return c.isGeminiEnabled !== false; }
    catch { return true; }
  });

  function persistEngineFlag(key: 'isGeminiEnabled', val: boolean) {
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
        isGeminiEnabled,
        updatedAt: new Date().toISOString(),
      }));
      window.dispatchEvent(new StorageEvent('storage', { key: CREDS_KEY }));
    } catch {}
    setCredsOk(true);
    setTimeout(() => setCredsOk(false), 2000);
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
            <label htmlFor="panel-slot-ficha" style={labelStyle}>Cargar Ficha de Profesional Guardada</label>
            <select
              id="panel-slot-ficha"
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
            <label htmlFor="panel-nombre-proyecto" style={labelStyle}>Nombre de la Ficha Técnica / Proyecto</label>
            <input
              id="panel-nombre-proyecto"
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
              aria-label="Priorizar cobertura Colombia"
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
              <label htmlFor="panel-pais-destino" style={labelStyle}>País de Destino Internacional</label>
              <input
                id="panel-pais-destino"
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

          {/* ── Instrucción: la key ya no se gestiona desde el cliente ── */}
          <div style={{
            background: 'rgba(56,189,248,0.06)',
            border: '1px solid rgba(56,189,248,0.18)',
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>🔒</span>
            <p style={{ fontSize: 11, color: T.textMuted, margin: 0, lineHeight: 1.5 }}>
              La API Key de Google Gemini se gestiona de forma segura en el servidor
              (variable de entorno <code>GOOGLE_API_KEY</code>) — nunca se almacena ni se
              transmite desde el navegador.
            </p>
          </div>

          {/* ── Google Gemini — solo activación del motor, sin credencial en cliente ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Toggle + label */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  id="panel-toggle-gemini"
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
                <label htmlFor="panel-toggle-gemini" style={{ ...labelStyle, margin: 0, color: isGeminiEnabled ? T.textMuted : T.textDim }}>
                  Motor Gemini (gestionado por servidor)
                </label>
              </div>
            </div>
            <p style={{ fontSize: 10, color: T.textDim, margin: 0, lineHeight: 1.5 }}>
              {isGeminiEnabled
                ? 'Activo — el barrido autónomo usará Google Search Grounding vía el proxy del backend.'
                : 'Desactivado — el barrido autónomo no invocará Gemini.'}
            </p>
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
                  aria-label={kw.enabled ? `Desactivar palabra clave "${kw.term}"` : `Activar palabra clave "${kw.term}"`}
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
                  aria-label="Palabra clave"
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

      {/* ─── CONTENEDOR C — Telemetría Motor de IA ───────────────────────────── */}
      <QuotaTelemetry />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
