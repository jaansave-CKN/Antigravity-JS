import React, { useState, useCallback, useEffect } from 'react';
import { barridoMasivoLigero, type GeminiResult } from '../../../../services/geminiScanner';
import { http } from '../../../../lib/apiClient';

// ── Stitch Design Tokens — Global Grant Nexus (dark) ──────────────────────────
// Fuente: proyecto 3791086755596777919 · frame "Directorio de Subvenciones"
const T = {
  bg:             '#0b1326',   // canvas background
  surface:        '#111927',   // card surface
  surfaceElevated:'#161e2e',   // elevated card
  surfaceBorder:  '#1e2d42',   // card border
  divider:        '#1a2940',   // divider line
  inputBg:        '#0d1b2e',   // input field
  inputBorder:    '#253550',   // input border
  textPrimary:    '#dae2fd',   // primary text
  textSecondary:  '#8fa8c8',   // secondary text
  textMuted:      '#4e6a87',   // muted/placeholder
  primary:        '#8ed5ff',   // primary accent (cyan)
  primaryGlow:    'rgba(142,213,255,0.12)',
  primaryBorder:  'rgba(142,213,255,0.25)',
  cyan:           '#38bdf8',   // action cyan
  cyanGlow:       'rgba(56,189,248,0.15)',
  cyanBorder:     'rgba(56,189,248,0.30)',
  green:          '#34d399',   // success / abierta
  greenGlow:      'rgba(52,211,153,0.12)',
  amber:          '#fbbf24',   // warning / próxima
  purple:         '#c084fc',   // privado
  pill:           'rgba(14,25,42,0.9)',
  font:           "'Hanken Grotesk', 'Inter', system-ui, sans-serif",
  mono:           "'JetBrains Mono', 'Fira Code', monospace",
} as const;

// ── Badge types & colors ───────────────────────────────────────────────────────
type TipoBadge = 'BILATERAL' | 'MULTILATERAL' | 'PRIVADO' | 'GOBIERNO';

const BADGE: Record<TipoBadge, { fg: string; bg: string; border: string }> = {
  BILATERAL:    { fg: '#34d399', bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.25)' },
  MULTILATERAL: { fg: '#8ed5ff', bg: 'rgba(142,213,255,0.10)', border: 'rgba(142,213,255,0.25)' },
  PRIVADO:      { fg: '#c084fc', bg: 'rgba(192,132,252,0.10)', border: 'rgba(192,132,252,0.25)' },
  GOBIERNO:     { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.25)' },
};

const TIPOS: TipoBadge[] = ['BILATERAL', 'MULTILATERAL', 'PRIVADO', 'GOBIERNO'];
const KEYWORDS_KEY = 'radar_keywords';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Convocatoria {
  id: string;
  titulo: string;
  descripcion: string;
  donante: string;
  sector: string;
  tipo: TipoBadge;
  monto?: string;
  fechaLimite?: string;
  score: number;
  esFavorito: boolean;
  link: string;
  linkIsPortal: boolean;
}

function mapConvocatoria(c: Record<string, any>): Convocatoria {
  let sectores: string[] = [];
  try { sectores = JSON.parse(c.sectores || '[]'); } catch {}
  let monto: string | undefined;
  if (c.monto_max > 0) {
    const m = Number(c.monto_max);
    monto = `${c.moneda || 'USD'} ${m >= 1_000_000 ? `${(m / 1_000_000).toFixed(1)}M` : m.toLocaleString('es-CO')}`;
  }
  const hash = (c.id?.charCodeAt?.(0) ?? 0) + (c.id?.charCodeAt?.(4) ?? 0);
  return {
    id:          c.id,
    titulo:      c.titulo,
    descripcion: c.descripcion || '',
    donante:     c.donante || c.fuente || 'Desconocido',
    sector:      sectores[0] || 'General',
    tipo:        TIPOS[Math.abs(hash) % 4],
    monto,
    fechaLimite: c.fecha_limite || undefined,
    score:        Math.round(Number(c.score_probabilidad) || 70),
    esFavorito:   false,
    link:         c.url_convocatoria || c.url_fuente || '#',
    linkIsPortal: !c.url_convocatoria && !!c.url_fuente,
  };
}

// ── Mapeo GeminiResult → Convocatoria ─────────────────────────────────────────
function mapGeminiResult(r: GeminiResult, i: number): Convocatoria {
  return {
    id:          `g-${Date.now()}-${i}`,
    titulo:      r.titulo      || 'Sin título',
    descripcion: r.descripcion_corta || '',
    donante:     r.fuente      || 'Desconocido',
    sector:      'General',
    tipo:        TIPOS[i % 4],
    monto:       undefined,
    fechaLimite: undefined,
    score:       88,
    esFavorito:  false,
    link:        r.enlace_oficial || '#',
    linkIsPortal: false,
  };
}

async function fetchConvocatorias(opts: { sector?: string; estado?: string; q?: string; limit?: number }) {
  const p = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.sector && opts.sector !== 'Todos') p.set('sector', opts.sector);
  if (opts.estado) p.set('estado', opts.estado);
  if (opts.q?.trim()) p.set('q', opts.q.trim());
  const r = await fetch(`/api/convocatorias?${p}`);
  if (!r.ok) return { data: [] as Convocatoria[], total: 0 };
  const d = await r.json();
  if (!d?.success || !Array.isArray(d.data)) return { data: [] as Convocatoria[], total: 0 };
  return { data: d.data.map(mapConvocatoria), total: d.data.length };
}

async function fetchSectores(): Promise<string[]> {
  try {
    const body = await http.get<{ success: boolean; sectores?: string[] }>('/api/convocatorias/meta');
    return body.sectores || [];
  } catch { return []; }
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function RadarStatusBar({ total, scanning }: { total: number; scanning: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 14px',
      background: T.surface,
      border: `1px solid ${T.surfaceBorder}`,
      borderRadius: 8,
      marginBottom: 20,
    }}>
      {/* RF 360 badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: T.pill, borderRadius: 6,
        padding: '3px 10px',
        border: `1px solid ${T.primaryBorder}`,
        flexShrink: 0,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: T.cyan,
          boxShadow: `0 0 6px ${T.cyan}`,
          animation: 'radar-blink 2s infinite', display: 'block',
        }} />
        <span style={{ fontSize: 9, fontWeight: 700, fontFamily: T.mono, color: T.primary, letterSpacing: '0.08em' }}>
          RF 360
        </span>
      </div>

      {/* System label */}
      <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textMuted, letterSpacing: '0.04em' }}>
        RADAR DE FONDOS 360
      </span>

      <div style={{ flex: 1 }} />

      {/* Total counter */}
      {total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 16, fontWeight: 700, fontFamily: T.mono, color: T.primary,
            letterSpacing: '-0.02em',
          }}>{total.toLocaleString('es-CO')}</span>
          <span style={{ fontSize: 8, fontFamily: T.mono, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            FONDOS<br/>INDEXADOS
          </span>
        </div>
      )}

      {/* Status pill */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: scanning ? T.cyanGlow : 'rgba(52,211,153,0.08)',
        border: `1px solid ${scanning ? T.cyanBorder : 'rgba(52,211,153,0.25)'}`,
        borderRadius: 6, padding: '3px 10px',
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%',
          background: scanning ? T.cyan : T.green,
          animation: 'radar-blink 1.5s infinite', display: 'block', flexShrink: 0,
        }} />
        <span style={{ fontSize: 8, fontWeight: 700, fontFamily: T.mono, color: scanning ? T.cyan : T.green, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {scanning ? 'ESCANEANDO' : 'SISTEMA ACTIVO'}
        </span>
      </div>
    </div>
  );
}

function ConvocatoriaCard({ c, onToggleFav }: { c: Convocatoria; onToggleFav: (id: string) => void }) {
  const badge = BADGE[c.tipo];
  const initials = c.donante.split(/[\s\-–\/]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'FD';
  const scoreColor = c.score >= 95 ? T.green : c.score >= 85 ? T.primary : T.amber;

  return (
    <article style={{
      background: T.surface,
      border: `1px solid ${T.surfaceBorder}`,
      borderLeft: `3px solid ${badge.fg}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex', gap: 14, alignItems: 'flex-start',
      transition: 'border-color 0.15s, background 0.15s',
      cursor: 'default',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLElement).style.background = T.surfaceElevated;
      (e.currentTarget as HTMLElement).style.borderColor = badge.border;
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLElement).style.background = T.surface;
      (e.currentTarget as HTMLElement).style.borderColor = T.surfaceBorder;
    }}
    >
      {/* Donor avatar */}
      <div style={{
        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
        background: T.inputBg,
        border: `1px solid ${badge.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 12, color: badge.fg, fontFamily: T.mono,
        letterSpacing: '0.02em',
      }}>
        {initials}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title */}
        <p style={{
          fontSize: 13, fontWeight: 600, color: T.textPrimary, fontFamily: T.font,
          lineHeight: 1.4, margin: '0 0 5px', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {c.titulo}
        </p>

        {/* Description */}
        <p style={{
          fontSize: 11, color: T.textSecondary, fontFamily: T.font,
          lineHeight: 1.5, margin: '0 0 8px',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {c.descripcion}
        </p>

        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Type badge */}
          <span style={{
            fontSize: 9, fontWeight: 700, fontFamily: T.mono, letterSpacing: '0.06em',
            padding: '2px 7px', borderRadius: 4,
            background: badge.bg, color: badge.fg, border: `1px solid ${badge.border}`,
          }}>{c.tipo}</span>

          {/* Donor */}
          <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.donante}
          </span>

          {/* Sector chip */}
          <span style={{
            fontSize: 9, padding: '2px 7px', borderRadius: 4,
            background: T.inputBg, color: T.textSecondary, fontFamily: T.font,
            border: `1px solid ${T.inputBorder}`,
          }}>{c.sector}</span>

          {/* Monto */}
          {c.monto && (
            <span style={{ fontSize: 10, color: T.amber, fontFamily: T.mono, fontWeight: 600 }}>
              {c.monto}
            </span>
          )}

          {/* Fecha */}
          {c.fechaLimite && (
            <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>
              ◷ {c.fechaLimite}
            </span>
          )}
        </div>
      </div>

      {/* Actions column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
        {/* Score pill */}
        <span style={{
          fontSize: 10, fontWeight: 700, fontFamily: T.mono,
          padding: '2px 8px', borderRadius: 99,
          background: `${scoreColor}14`, color: scoreColor,
          border: `1px solid ${scoreColor}44`,
          whiteSpace: 'nowrap',
        }}>{c.score}%</span>

        {/* Favorite */}
        <button
          onClick={() => onToggleFav(c.id)}
          title={c.esFavorito ? 'Quitar de favoritos' : 'Guardar en favoritos'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 15, lineHeight: 1, padding: 2,
            color: c.esFavorito ? T.amber : T.textMuted,
            transition: 'color 0.15s',
          }}
        >{c.esFavorito ? '★' : '☆'}</button>

        {/* Ver link */}
        {c.link && c.link !== '#' && (
          <a
            href={c.link} target="_blank" rel="noopener noreferrer"
            title={c.linkIsPortal ? 'Ver portal de convocatorias del donante' : 'Ver convocatoria específica'}
            style={{
              fontSize: 9, fontWeight: 700, fontFamily: T.mono, letterSpacing: '0.05em',
              padding: '3px 9px', borderRadius: 5,
              background: T.inputBg,
              color: c.linkIsPortal ? T.textMuted : T.primary,
              border: `1px solid ${T.inputBorder}`,
              textDecoration: 'none', whiteSpace: 'nowrap',
              transition: 'border-color 0.15s, color 0.15s',
            }}
          >{c.linkIsPortal ? 'Ver portal →' : 'Ver →'}</a>
        )}
      </div>
    </article>
  );
}

function EmptyState({ scanning, query }: { scanning: boolean; query: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '56px 24px', gap: 14,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: T.surface, border: `1px solid ${T.surfaceBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24,
      }}>
        {scanning ? (
          <span style={{ animation: 'radar-spin 1s linear infinite', display: 'block' }}>◌</span>
        ) : '◎'}
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: T.textSecondary, fontFamily: T.font, margin: '0 0 4px' }}>
          {scanning ? 'Procesando barrido…' : query ? `Sin resultados para "${query}"` : 'Base de datos vacía'}
        </p>
        <p style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono, margin: 0 }}>
          {scanning ? 'Consultando fuentes institucionales' : query ? 'Ajusta los filtros o inicia un nuevo barrido' : 'Usa "Iniciar Barrido" para indexar convocatorias'}
        </p>
      </div>
    </div>
  );
}

// ── Lee los flags de motores desde localStorage (sincronizado con PanelPage) ──
const CREDS_KEY = 'rf360_credentials_v1';
function readEngineFlags() {
  try {
    const c = JSON.parse(localStorage.getItem(CREDS_KEY) || '{}');
    return { isGeminiEnabled: c.isGeminiEnabled !== false };
  } catch {
    return { isGeminiEnabled: true };
  }
}

const PAGE_SIZE = 50;

// ── Main component ─────────────────────────────────────────────────────────────
export const PestañaRadar: React.FC = () => {
  const [data,       setData]       = useState<Convocatoria[]>([]);
  const [total,      setTotal]      = useState(0);
  const [init,       setInit]       = useState(true);
  const [scanning,   setScanning]   = useState(false);
  const [engines,     setEngines]    = useState(readEngineFlags);
  const [noKeywords,  setNoKeywords] = useState(false);
  const [scanError,   setScanError]  = useState<string | null>(null);
  const [rawResults,  setRawResults] = useState<GeminiResult[]>([]);
  const [page,        setPage]       = useState(1);

  // ── Filtros reales (Fase 4) — conectados a los mismos params que el backend
  // ya soporta en GET /api/convocatorias (antes esta pestaña no tenía UI de
  // filtro alguna, pese a que fetchConvocatorias ya los aceptaba). ──────────
  const [sectorSel,   setSectorSel]   = useState('Todos');
  const [estadoSel,   setEstadoSel]   = useState('');
  const [query,       setQuery]       = useState('');
  const [sectores,    setSectores]    = useState<string[]>([]);
  const [favIds,      setFavIds]      = useState<Set<string>>(new Set());
  const [guardandoBarrido, setGuardandoBarrido] = useState(false);
  const [barridoGuardado,  setBarridoGuardado]  = useState<string | null>(null);

  useEffect(() => { fetchSectores().then(setSectores); }, []);

  // Hidrata qué convocatorias ya son favoritas del usuario — antes el ★
  // siempre arrancaba vacío al recargar aunque el dato ya estuviera guardado.
  useEffect(() => {
    http.get<{ success: boolean; data?: Array<{ grant_id: string }> }>('/api/favorites')
      .then(body => setFavIds(new Set((body.data || []).map(f => f.grant_id))))
      .catch(() => {});
  }, []);

  // Sincronizar flags de motores cuando PanelPage los cambia
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === CREDS_KEY) setEngines(readEngineFlags());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const noEnginesActive = !engines.isGeminiEnabled;
  const busy = init || scanning;

  // Carga inicial + recarga cuando cambian los filtros (debounced para búsqueda)
  useEffect(() => {
    setInit(true);
    const t = setTimeout(() => {
      fetchConvocatorias({ limit: 50, sector: sectorSel, estado: estadoSel || undefined, q: query })
        .then(({ data: d, total: total_ }) => {
          setData(d.map((c: Convocatoria) => ({ ...c, esFavorito: favIds.has(c.id) })));
          setTotal(total_); setPage(1);
        })
        .catch(() => {})
        .finally(() => setInit(false));
    }, query ? 400 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorSel, estadoSel, query, favIds]);

  const runScan = useCallback(async () => {
    if (noEnginesActive) return;
    // Limpiar residuos de ejecuciones anteriores antes de iniciar
    setScanError(null);
    setNoKeywords(false);
    setRawResults([]);
    setScanning(true);

    try {
      // ── Barrido Gemini Search Grounding — vía proxy seguro del backend ───
        const resultados = await barridoMasivoLigero('General', 50);
      console.log('🔥 CARGA ÚTIL RECIBIDA:', resultados);          // Auditoría

      // Solo actualizar UI cuando hay datos reales mapeados
      if (!Array.isArray(resultados) || resultados.length === 0) {
        throw new Error('El modelo respondió HTTP 200 pero el array de resultados está vacío.');
      }

      setRawResults(resultados);
      setTotal(resultados.length);
      setData(resultados.map(mapGeminiResult));
      setPage(1);

    } catch (err: any) {
      const msg: string = err?.message ?? 'Error desconocido en el barrido.';

      if (msg.includes('palabras clave') || msg.includes('Palabras Clave')) {
        setNoKeywords(true);
        setTimeout(() => setNoKeywords(false), 5000);
      } else {
        // Mostrar error exacto (incluye código HTTP y cuerpo del servidor)
        setScanError(msg);
        // Fallback a BD local para no dejar la pantalla vacía
        try {
          const fallback = await fetchConvocatorias({ limit: 50 });
          if (fallback.data.length > 0) {
            setData(fallback.data);
            setTotal(fallback.total);
          }
        } catch {}
      }
    } finally {
      setScanning(false);
    }
  }, [noEnginesActive]);

  const toggleFav = useCallback((id: string) => {
    setData(prev => prev.map(c => c.id === id ? { ...c, esFavorito: !c.esFavorito } : c));
    // Persistencia real — antes esto solo cambiaba el estado local en memoria.
    http.post<{ success: boolean; favorito?: boolean }>(`/api/convocatorias/${id}/favorito`)
      .then(resp => {
        setFavIds(prev => {
          const next = new Set(prev);
          resp.favorito ? next.add(id) : next.delete(id);
          return next;
        });
      })
      .catch(() => {
        // revertir en caso de fallo de red/auth
        setData(prev => prev.map(c => c.id === id ? { ...c, esFavorito: !c.esFavorito } : c));
      });
  }, []);

  const guardarResultadosBarrido = useCallback(async () => {
    if (rawResults.length === 0) return;
    setGuardandoBarrido(true);
    setBarridoGuardado(null);
    try {
      const body = await http.post<{ success: boolean; insertadas: number; duplicadas: number }>(
        '/api/radar/persistir-barrido', { resultados: rawResults }
      );
      setBarridoGuardado(`${body.insertadas} convocatoria(s) guardada(s) permanentemente (${body.duplicadas} ya existían).`);
    } catch (e: any) {
      setBarridoGuardado(`Error al guardar: ${e?.message ?? 'desconocido'}`);
    } finally {
      setGuardandoBarrido(false);
    }
  }, [rawResults]);

  // Paginación — fuente activa: rawResults (Gemini) o data (BD)
  const activeList   = rawResults.length > 0 ? rawResults : data;
  const totalPages   = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
  const safePage     = Math.min(page, totalPages);
  const pageStart    = (safePage - 1) * PAGE_SIZE;
  const pageRaw      = rawResults.length > 0 ? rawResults.slice(pageStart, pageStart + PAGE_SIZE) : [];
  const pageData     = rawResults.length > 0 ? [] : data.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div style={{
      background: T.bg,
      minHeight: 'calc(100vh - 48px)',
      padding: '18px 20px',
      fontFamily: T.font,
    }}>

      {/* ── Status bar ── */}
      <RadarStatusBar total={total} scanning={busy} />

      {/* ── Error toast — imprime el error exacto del SDK ── */}
      {scanError && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          background: 'rgba(248,113,113,0.10)',
          border: '1px solid rgba(248,113,113,0.35)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#f87171', margin: '0 0 2px', fontFamily: T.mono }}>
              ERROR DE BARRIDO
            </p>
            <p style={{ fontSize: 11, color: '#fca5a5', margin: 0, fontFamily: T.mono, wordBreak: 'break-word' }}>
              {scanError}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setScanError(null)}
            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Page header ── */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: T.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>
              Escáner de Fondos AI
            </h1>
            <span style={{
              fontSize: 8, fontWeight: 700, fontFamily: T.mono, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              background: T.cyanGlow, color: T.cyan, border: `1px solid ${T.cyanBorder}`,
            }}>Gemini · Search Grounding</span>
          </div>
          <p style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono, margin: 0, letterSpacing: '0.02em' }}>
            Barrido autónomo por Palabras Clave · Colombia · MGA
          </p>
        </div>

        {/* ── INICIAR BARRIDO — acción única ── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <button
            onClick={runScan}
            disabled={busy || noEnginesActive}
            style={{
              padding: '9px 24px', borderRadius: 8, border: 'none',
              background: (busy || noEnginesActive)
                ? T.inputBg
                : `linear-gradient(135deg, ${T.cyan} 0%, #0058be 100%)`,
              color: (busy || noEnginesActive) ? T.textMuted : '#001c2e',
              fontSize: 12, fontWeight: 700, fontFamily: T.mono,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              cursor: (busy || noEnginesActive) ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              boxShadow: (busy || noEnginesActive) ? 'none' : `0 0 24px ${T.cyanGlow}`,
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            {scanning
              ? <><span style={{ animation: 'radar-spin 1s linear infinite', display: 'block' }}>◌</span> Escaneando con IA…</>
              : '◎ Iniciar Barrido'}
          </button>

          {/* Advertencias */}
          {noEnginesActive && (
            <p style={{ fontSize: 9, color: '#f59e0b', margin: 0, fontFamily: T.mono, letterSpacing: '0.04em', textAlign: 'right', whiteSpace: 'nowrap' }}>
              ⚠ Activa al menos un motor de IA en el Panel de Control
            </p>
          )}
          {noKeywords && (
            <p style={{ fontSize: 9, color: '#f87171', margin: 0, fontFamily: T.mono, letterSpacing: '0.04em', textAlign: 'right', whiteSpace: 'nowrap' }}>
              ⚠ Sin palabras clave activas — actívalas en el Panel de Control
            </p>
          )}
        </div>
      </div>

      {/* ── Filtros reales (sector/estado/búsqueda) — Fase 4 ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por título o donante…"
          style={{
            flex: '1 1 220px', minWidth: 180, padding: '8px 12px', borderRadius: 7,
            background: T.inputBg, border: `1px solid ${T.inputBorder}`, color: T.textPrimary,
            fontSize: 12, fontFamily: T.font, outline: 'none',
          }}
        />
        <select
          value={sectorSel}
          onChange={e => setSectorSel(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 7, background: T.inputBg,
            border: `1px solid ${T.inputBorder}`, color: T.textPrimary, fontSize: 12, fontFamily: T.font,
          }}
        >
          <option value="Todos">Todos los sectores</option>
          {sectores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={estadoSel}
          onChange={e => setEstadoSel(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 7, background: T.inputBg,
            border: `1px solid ${T.inputBorder}`, color: T.textPrimary, fontSize: 12, fontFamily: T.font,
          }}
        >
          <option value="">Todas (abiertas)</option>
          <option value="nueva">Nuevas (≤7 días)</option>
          <option value="abierta">Abiertas (&gt;7 días)</option>
        </select>
      </div>

      {/* ── Counter + guardar resultados del barrido en BD (antes se perdían al recargar) ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {barridoGuardado && (
          <span style={{ fontSize: 9, color: T.green, fontFamily: T.mono }}>{barridoGuardado}</span>
        )}
        {rawResults.length > 0 && !busy && (
          <button
            onClick={guardarResultadosBarrido}
            disabled={guardandoBarrido}
            style={{
              padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.cyanBorder}`,
              background: T.cyanGlow, color: T.cyan, fontSize: 9, fontWeight: 700, fontFamily: T.mono,
              letterSpacing: '0.05em', textTransform: 'uppercase', cursor: guardandoBarrido ? 'not-allowed' : 'pointer',
            }}
          >
            {guardandoBarrido ? 'Guardando…' : '💾 Guardar resultados permanentemente'}
          </button>
        )}
        <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>
          {busy ? '…' : `${activeList.length} resultado${activeList.length !== 1 ? 's' : ''} indexados`}
        </span>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: T.divider, marginBottom: 14 }} />

      {/* ── Results ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {busy ? (
          <EmptyState scanning={scanning} query={query} />
        ) : pageRaw.length > 0 ? (
          /* ── Renderizado directo de GeminiResult (sin mapeo) ── */
          pageRaw.map((r, i) => (
            <article key={i} style={{
              background: T.surface, border: `1px solid ${T.surfaceBorder}`,
              borderLeft: `3px solid ${T.cyan}`, borderRadius: 10,
              padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, margin: 0, flex: 1 }}>
                  {r.titulo || '—'}
                </p>
                <span style={{
                  fontSize: 9, fontWeight: 700, fontFamily: T.mono, flexShrink: 0,
                  padding: '2px 8px', borderRadius: 99,
                  background: r.estado === 'Abierta' ? 'rgba(52,211,153,0.12)' : 'rgba(142,213,255,0.10)',
                  color:      r.estado === 'Abierta' ? T.green : T.primary,
                  border:     `1px solid ${r.estado === 'Abierta' ? 'rgba(52,211,153,0.3)' : T.primaryBorder}`,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {r.estado || 'Activa'}
                </span>
              </div>
              <p style={{ fontSize: 11, color: T.textSecondary, margin: 0 }}>
                <span style={{ color: T.textMuted, fontWeight: 600 }}>Fuente:</span> {r.fuente || '—'}
              </p>
              <p style={{ fontSize: 11, color: T.textMuted, margin: 0, lineHeight: 1.5 }}>
                {r.descripcion_corta || '—'}
              </p>
              {r.enlace_oficial && r.enlace_oficial !== '#' && (
                <a
                  href={r.enlace_oficial}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    alignSelf: 'flex-start', fontSize: 10, fontFamily: T.mono, fontWeight: 700,
                    color: T.cyan, textDecoration: 'none', letterSpacing: '0.04em',
                    background: T.cyanGlow, border: `1px solid ${T.cyanBorder}`,
                    borderRadius: 6, padding: '4px 10px', marginTop: 2,
                  }}
                >
                  Ver convocatoria oficial →
                </a>
              )}
            </article>
          ))
        ) : pageData.length > 0 ? (
          pageData.map(c => <ConvocatoriaCard key={c.id} c={c} onToggleFav={toggleFav} />)
        ) : (
          <EmptyState scanning={false} query={query} />
        )}
      </div>

      {/* ── Pagination bar ── */}
      {!busy && activeList.length > 0 && (
        <div style={{
          marginTop: 20,
          borderTop: `1px solid ${T.divider}`,
          paddingTop: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
        }}>
          {/* Left: total */}
          <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {activeList.length} fondos · RadarFondos 360 · Gemini 1.5 Flash
          </span>

          {/* Center: prev / page indicator / next */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                style={{
                  background: T.inputBg, border: `1px solid ${T.inputBorder}`,
                  borderRadius: 6, color: safePage <= 1 ? T.textMuted : T.primary,
                  fontFamily: T.mono, fontSize: 11, fontWeight: 700,
                  padding: '5px 12px', cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
              >← Anterior</button>

              <span style={{
                fontFamily: T.mono, fontSize: 11, color: T.textPrimary,
                background: T.surface, border: `1px solid ${T.surfaceBorder}`,
                borderRadius: 6, padding: '5px 14px', whiteSpace: 'nowrap',
              }}>
                Página <strong style={{ color: T.primary }}>{safePage}</strong> de <strong>{totalPages}</strong>
              </span>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                style={{
                  background: T.inputBg, border: `1px solid ${T.inputBorder}`,
                  borderRadius: 6, color: safePage >= totalPages ? T.textMuted : T.primary,
                  fontFamily: T.mono, fontSize: 11, fontWeight: 700,
                  padding: '5px 12px', cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
              >Siguiente →</button>
            </div>
          )}

          {/* Right: range indicator */}
          <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.04em' }}>
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, activeList.length)} de {activeList.length}
          </span>
        </div>
      )}

      <style>{`
        @keyframes radar-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes radar-spin  { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
};
