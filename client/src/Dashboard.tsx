import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, AlertCircle, Star, Loader2, ArrowRight } from 'lucide-react';
import RadarDashboard, { type Donor, type DonorType, type TagColor } from './components/RadarDashboard';
import FavoritosView from './components/FavoritosView';
import { useFavoritos } from './contexts/FavoritosContext';
import { useSubscription } from './contexts/SubscriptionContext';
import { useAuth } from './contexts/AuthContextNew';
import { leerAuthToken, obtenerCsrfHeaders } from './lib/authStorage';

const API_URL = import.meta.env.VITE_API_URL || '';
const WS_URL = (API_URL || 'ws://localhost:8000').replace(/^http/, 'ws') + '/ws/live_radar';

interface Convocatoria {
  id: number;
  externo_id: string;
  titulo: string;
  donante: string;
  fuente: string;
  descripcion: string;
  monto_min: number;
  monto_max: number;
  moneda: string;
  paises_elegibles: string;
  sectores: string;
  url_convocatoria: string;
  url_fuente: string;
  fecha_limite: string;
  fecha_publicacion: string;
  requisitos: string;
  estado: string;
  score_probabilidad: number;
  created_at: string;
}

// ── Radar Status ──────────────────────────────────────────────────────────────
interface RadarStatus {
  active: boolean;
  infraestructura: {
    motor_db: string;
    embeddings_model: string;
    google_api_activa: boolean;
    busqueda_vectorial: {
      enabled: boolean;
      convocatorias_total: number;
      convocatorias_indexadas: number;
      proyectos_indexados: number;
      cobertura_pct: number;
    };
  };
}

function useRadarStatus() {
  const [status, setStatus] = useState<RadarStatus | null>(null);
  useEffect(() => {
    const load = async () => {
      try {
        // FIX (Fase 1, 2026-09-05): leerAuthToken() ya solo puede devolver
        // 'demo-mode-token' o null (el JWT real vive en la cookie httpOnly,
        // nunca en localStorage) — una sesión real ya no manda nada aquí, se
        // autentica sola vía credentials:'include'.
        const token = leerAuthToken();
        const r = await fetch('/api/radar/status', {
          credentials: 'include',
          headers: token === 'demo-mode-token' ? { Authorization: `Bearer ${token}` } : {},
        });
        const d = await r.json();
        if (d.success) setStatus(d);
      } catch {}
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  return status;
}

function parseJson<T>(str: string, fallback: T): T {
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function formatMoney(amount: number, currency: string): string {
  if (!amount) return 'No especificado';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

// ── Stitch helpers ────────────────────────────────────────────────────────────
const STITCH_CSS = `
  .badge-bilateral   { color: var(--tertiary); border-color: var(--tertiary); }
  .badge-multilateral{ color: var(--primary); border-color: var(--primary); }
  .badge-privado     { color: var(--secondary); border-color: var(--secondary); }
  .badge-gobierno    { color: var(--primary-fixed-dim); border-color: var(--primary-fixed-dim); }
  .tag-default { color: var(--on-surface-variant); background-color: transparent; border-color: transparent; }
  .tag-blue    { color: var(--primary); background-color: rgba(142, 213, 255, 0.1); }
  .tag-green   { color: var(--tertiary); background-color: rgba(82, 232, 124, 0.1); }
  .tag-orange  { color: var(--secondary-fixed-dim); background-color: rgba(189, 194, 255, 0.1); }
`;

const TYPE_ICON: Record<DonorType, string> = {
  BILATERAL:    'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.102',
  MULTILATERAL: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  PRIVADO:      'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  GOBIERNO:     'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
};

const TYPE_BADGE_CLASS: Record<DonorType, string> = {
  BILATERAL:    'badge-bilateral',
  MULTILATERAL: 'badge-multilateral',
  PRIVADO:      'badge-privado',
  GOBIERNO:     'badge-gobierno',
};

const TAG_CLASS: Record<TagColor, string> = {
  default: 'tag-default',
  blue:    'tag-blue',
  green:   'tag-green',
  orange:  'tag-orange',
};

function fuenteToType(fuente: string): DonorType {
  const f = fuente.toLowerCase();
  if (f.includes('bilateral') || f.includes('embajada') || f.includes('jica') || f.includes('usaid') || f.includes('giz')) return 'BILATERAL';
  if (f.includes('multilateral') || f.includes('onu') || f.includes('pnud') || f.includes('banco') || f.includes('ue') || f.includes('eu') || f.includes('unesco')) return 'MULTILATERAL';
  if (f.includes('privado') || f.includes('fundacion') || f.includes('ong')) return 'PRIVADO';
  return 'GOBIERNO';
}

function sectorTagColor(sector: string): TagColor {
  const s = sector.toLowerCase();
  if (s.includes('educ') || s.includes('tecn') || s.includes('innov') || s.includes('ciencia') || s.includes('saneamiento')) return 'blue';
  if (s.includes('ambient') || s.includes('clima') || s.includes('biodiv') || s.includes('agua') || s.includes('verde')) return 'green';
  if (s.includes('empren') || s.includes('social') || s.includes('comunid') || s.includes('empleo') || s.includes('rural')) return 'orange';
  return 'default';
}

function getAcronym(donante: string): string {
  const parts = donante.split(/[\s\-–\/]+/).filter(p => p.length > 0);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || 'FD').substring(0, 2).toUpperCase();
}

// ── RadarStatusBar ────────────────────────────────────────────────────────────
function RadarStatusBar({ status }: { status: RadarStatus | null }) {
  if (!status) return null;
  const { infraestructura: inf } = status;
  const vb = inf.busqueda_vectorial;
  return (
    <div style={{
      display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center',
      padding: '8px 14px', borderRadius: 8,
      background: 'var(--surface-container)', border: '1px solid var(--outline-variant)',
      fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--on-surface)'
    }}>
      {/* Motor DB */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--on-surface-variant)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: vb.enabled ? 'var(--tertiary)' : 'var(--error)', display: 'inline-block', flexShrink: 0 }}/>
        {inf.motor_db}
      </span>
      {/* Cobertura vectorial */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--on-surface-variant)' }}>
        🔍 {vb.convocatorias_indexadas}/{vb.convocatorias_total} indexadas
        <span style={{
          padding: '1px 6px', borderRadius: 4,
          background: vb.cobertura_pct > 70 ? 'rgba(82, 232, 124, 0.12)' : 'rgba(255, 180, 171, 0.12)',
          color: vb.cobertura_pct > 70 ? 'var(--tertiary)' : 'var(--error)',
          fontWeight: 700,
        }}>{vb.cobertura_pct}%</span>
      </span>
      {/* API IA */}
      <span style={{ color: inf.google_api_activa ? 'var(--tertiary)' : 'var(--error)' }}>
        {inf.google_api_activa ? '● IA activa' : '○ IA inactiva'}
      </span>
      {/* Modelo embedding */}
      <span style={{ color: 'var(--on-surface-variant)', marginLeft: 'auto' }}>
        {inf.embeddings_model}
      </span>
    </div>
  );
}

// ── ConvocatoriaCard — misma estructura exacta que DonorCard en RadarDashboard ─
interface ConvocatoriaCardProps {
  conv: Convocatoria;
  index: number;
  isFavorito?: boolean;
  guardandoId?: string | null;
  errorGuardado?: string | null;
  onToggleFavorito?: (conv: Convocatoria) => void;
  onFormular?: (conv: Convocatoria) => void;
}
function ConvocatoriaCard({ conv, index, isFavorito, guardandoId, errorGuardado, onToggleFavorito, onFormular }: ConvocatoriaCardProps) {
  const type = fuenteToType(conv.fuente);
  const sectores = parseJson<string[]>(conv.sectores, []);
  const paises = parseJson<string[]>(conv.paises_elegibles, ['Colombia']);
  const visibleTags = sectores.slice(0, 3);
  const overflow = sectores.length - 3;
  const acronym = getAcronym(conv.donante);
  const url = conv.url_convocatoria || conv.url_fuente || '#';

  return (
    <article className="bg-surface-container border-l-4 border-l-outline-variant hover:border-l-secondary transition-colors rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      {/* Left: Logo & Main Info */}
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <span className="text-sm font-bold text-outline mr-1 shrink-0">#{index + 1}</span>
        <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center text-onSurface font-bold text-lg shrink-0">
          {acronym}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-onSurface truncate">
            {conv.titulo}{' '}
            <span className="text-outline font-normal">({conv.donante})</span>
          </h2>
          <div className="flex items-center gap-4 mt-2 text-xs text-onSurface-variant flex-wrap">
            <div className="w-[140px] shrink-0">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-medium ${TYPE_BADGE_CLASS[type]}`}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TYPE_ICON[type]} />
                </svg>
                {type}
              </span>
            </div>
            <div className="grid gap-2 items-center grid-cols-[102px_80px_120px_32px]">
              <span className="flex items-center gap-1 truncate">
                <span className="text-red-500 shrink-0">📍</span> {paises[0] || 'Colombia'}
              </span>
              <span className="flex items-center gap-1 shrink-0 text-onSurface-variant">
                📅 {conv.fecha_limite || 'N/A'}
              </span>
              <span className="flex items-center gap-1 text-yellow-600 shrink-0">
                💰 <span className="text-onSurface-variant">{conv.monto_max ? formatMoney(conv.monto_max, conv.moneda) : 'N/E'}</span>
              </span>
              <span className="flex items-center justify-center text-onSurface-variant font-medium shrink-0 text-xs">
                {conv.moneda}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Tags & Action */}
      <div className="flex items-center gap-3 shrink-0 self-end md:self-auto w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
        {visibleTags.map(tag => (
          <span
            key={tag}
            className={`text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap ${TAG_CLASS[sectorTagColor(tag)]}`}
          >
            {tag}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-xs font-medium text-outline bg-surface-container-high px-2 rounded-md">
            +{overflow}
          </span>
        )}
        {url !== '#' && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-outline hover:text-onSurface p-1 rounded-md ml-2 hidden md:block"
            title="Ver convocatoria"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}

        {/* Botón favorito */}
        {onToggleFavorito && (
          <div className="flex flex-col items-center gap-1 ml-1">
            <button
              onClick={() => onToggleFavorito(conv)}
              disabled={guardandoId === String(conv.externo_id || conv.id)}
              title={isFavorito ? 'Quitar de Mis Convocatorias' : 'Guardar en Mis Convocatorias'}
              className="p-1.5 rounded-md transition-colors"
              style={{
                color: isFavorito ? '#f59e0b' : '#64748b',
                background: isFavorito ? 'rgba(245,158,11,0.1)' : 'transparent',
              }}
            >
              {guardandoId === String(conv.externo_id || conv.id)
                ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                : <Star size={18} fill={isFavorito ? 'currentColor' : 'none'} />}
            </button>
            {errorGuardado && guardandoId === null && (
              <span className="text-red-400 text-xs whitespace-nowrap max-w-[120px] text-center leading-tight">
                {errorGuardado}
              </span>
            )}
          </div>
        )}

        {/* M2 — Puente de Interoperabilidad */}
        {onFormular && (
          <button
            onClick={() => onFormular(conv)}
            title="Formular esta oportunidad (M2 — Puente)"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 6, border: 'none',
              background: 'var(--primary-container)',
              color: 'var(--on-primary-container)', fontSize: 11, fontWeight: 700,
              fontFamily: 'monospace', letterSpacing: '0.04em',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <ArrowRight size={13} />
            Formular
          </button>
        )}
      </div>
    </article>
  );
}

export default function Dashboard() {
  const [vista, setVista] = useState<'convocatorias' | 'donantes' | 'mis-convocatorias'>('donantes');
  const [convocatorias, setConvocatorias] = useState<Convocatoria[]>([]);
  const { isFavorito, guardarFavorito, eliminarPorGrantId } = useFavoritos();
  const navigate = useNavigate();
  const { hasFormulador } = useSubscription();
  const { isAuthenticated, token: authToken } = useAuth();
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [search, setSearch] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [searchMode, setSearchMode] = useState<'texto'|'semantica'>('texto');
  const [semanticResults, setSemanticResults] = useState<Convocatoria[] | null>(null);
  const [searchingIA, setSearchingIA] = useState(false);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): `disabled={searchingIA}` en el botón solo se aplica al DOM
  // tras el re-render — un segundo clic/evento antes de eso todavía puede
  // disparar el handler de nuevo. Guarda síncrona compartida por las dos
  // acciones que usan searchingIA (búsqueda semántica y barrido masivo).
  const searchingIARef = useRef(false);
  const radarStatus = useRadarStatus();

  const connectWebSocket = useCallback(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const maxAttempts = 10;

    const connect = () => {
      if (ws?.readyState === WebSocket.OPEN) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { setWsConnected(true); reconnectAttempts = 0; };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'NEW_FUND_DETECTED' && msg.data) {
            const nuevas = Array.isArray(msg.data) ? msg.data : [msg.data];
            setConvocatorias(prev => {
              const mapped = nuevas.map((n: any) => ({
                id: n.id || Date.now(),
                externo_id: n.externo_id || `WS-${Date.now()}`,
                titulo: n.titulo || 'Sin título',
                donante: n.donante || n.fuente || 'Desconocido',
                fuente: n.fuente || 'scraped',
                descripcion: n.descripcion || '',
                monto_min: n.monto_min || 0,
                monto_max: n.monto_max || n.monto || 0,
                moneda: n.moneda || 'USD',
                paises_elegibles: n.paises_elegibles || '["Colombia"]',
                sectores: n.sectores || '[]',
                url_convocatoria: n.url_convocatoria || n.url || '',
                url_fuente: n.url_fuente || n.url || '',
                fecha_limite: n.fecha_limite || n.fecha_cierre || '',
                fecha_publicacion: n.scraped_en || '',
                requisitos: '[]',
                estado: n.estado || 'nueva',
                score_probabilidad: n.score_probabilidad || 70,
                created_at: n.timestamp || new Date().toISOString(),
              }));
              return [...mapped, ...prev];
            });
            setNewCount(prev => prev + nuevas.length);
            setTimeout(() => setNewCount(0), 4000);
          }
        } catch {}
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (reconnectAttempts < maxAttempts) {
          const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectTimeout = setTimeout(() => { reconnectAttempts++; connect(); }, delay);
        }
      };
      ws.onerror = () => {};
    };

    connect();
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  useEffect(() => { return connectWebSocket(); }, [connectWebSocket]);

  useEffect(() => {
    const MOCK_DATA: Convocatoria[] = [
      {
        id: 1, externo_id: 'mock-1',
        titulo: 'Programa Kusanone - Embajada de Japón',
        donante: 'Embajada de Japón', fuente: 'bilateral',
        descripcion: 'Proyectos de infraestructura social comunitaria en Colombia.',
        monto_min: 50000, monto_max: 150000, moneda: 'USD',
        paises_elegibles: '["Colombia"]',
        sectores: '["Infraestructura Social","Comunidades","Saneamiento"]',
        url_convocatoria: '', url_fuente: '',
        fecha_limite: '2026-09-30', fecha_publicacion: '2026-05-01',
        requisitos: '[]', estado: 'abierta', score_probabilidad: 82,
        created_at: new Date().toISOString(),
      },
      {
        id: 2, externo_id: 'mock-2',
        titulo: 'Fondo de Cooperación Europea',
        donante: 'Unión Europea', fuente: 'multilateral',
        descripcion: 'Financiación para proyectos de saneamiento básico y agua potable.',
        monto_min: 100000, monto_max: 300000, moneda: 'EUR',
        paises_elegibles: '["Colombia","Ecuador","Perú"]',
        sectores: '["Agua","Medio Ambiente","Cambio Climatico"]',
        url_convocatoria: '', url_fuente: '',
        fecha_limite: '2026-08-15', fecha_publicacion: '2026-04-20',
        requisitos: '[]', estado: 'nueva', score_probabilidad: 91,
        created_at: new Date().toISOString(),
      },
      {
        id: 3, externo_id: 'mock-3',
        titulo: 'Fondo Global para Medio Ambiente (GEF)',
        donante: 'GEF / Banco Mundial', fuente: 'multilateral',
        descripcion: 'Iniciativas de adaptación al cambio climático y biodiversidad.',
        monto_min: 200000, monto_max: 500000, moneda: 'USD',
        paises_elegibles: '["Colombia"]',
        sectores: '["Medio Ambiente","Biodiversidad","Cambio Climatico","Ruralidad"]',
        url_convocatoria: '', url_fuente: '',
        fecha_limite: '2026-10-01', fecha_publicacion: '2026-05-10',
        requisitos: '[]', estado: 'abierta', score_probabilidad: 75,
        created_at: new Date().toISOString(),
      },
    ];
    setConvocatorias(MOCK_DATA);
    setLoading(false);
    setError(null);
  }, []);

  const convocatoriasFiltradas = useMemo(() => {
    const q = search.toLowerCase();
    return convocatorias.filter(c => {
      const sectores = parseJson<string[]>(c.sectores, []);
      const matchSearch = !q || c.titulo.toLowerCase().includes(q) ||
        c.donante.toLowerCase().includes(q) ||
        sectores.some(s => s.toLowerCase().includes(q));
      const matchEstado = filtroEstado === 'todos' || c.estado?.toLowerCase() === filtroEstado;
      return matchSearch && matchEstado;
    });
  }, [convocatorias, search, filtroEstado]);

  const handleToggleFavorito = useCallback(async (conv: Convocatoria) => {
    const grantId = String(conv.externo_id || conv.id);
    setGuardandoId(grantId);
    setErrorGuardado(null);
    try {
      if (isFavorito(grantId)) {
        await eliminarPorGrantId(grantId);
      } else {
        await guardarFavorito(grantId, {
          titulo: conv.titulo,
          donante: conv.donante,
          fuente: conv.fuente,
          estado: conv.estado,
          monto_max: conv.monto_max,
          moneda: conv.moneda,
          fecha_limite: conv.fecha_limite,
          fecha_cierre: conv.fecha_limite,
          url_convocatoria: conv.url_convocatoria,
          url_fuente: conv.url_fuente,
          descripcion: conv.descripcion,
          sectores: conv.sectores,
          paises_elegibles: conv.paises_elegibles,
        });
      }
    } catch (err: any) {
      setErrorGuardado(err?.message || 'No se pudo guardar. Intenta nuevamente.');
      setTimeout(() => setErrorGuardado(null), 4000);
    } finally {
      setGuardandoId(null);
    }
  }, [isFavorito, guardarFavorito, eliminarPorGrantId]);

  // M2 — Puente: transfiere convocatoria al Formulador si el usuario tiene acceso
  const handleFormular = useCallback(async (conv: Convocatoria) => {
    if (!hasFormulador) { navigate('/planes'); return; }
    // FIX (Fase 1, 2026-09-05): antes comparaba leerAuthToken() (el JWT
    // crudo) — con el JWT real fuera de localStorage esta condición habría
    // sido SIEMPRE verdadera y mandado a /login a cualquier usuario real ya
    // autenticado. isAuthenticated viene del estado reactivo de AuthContext,
    // que sí sabe si la cookie httpOnly es válida.
    if (!isAuthenticated || authToken === 'demo-mode-token') { navigate('/login'); return; }
    try {
      const r = await fetch('/api/bridge/transfer', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...obtenerCsrfHeaders() },
        body: JSON.stringify({
          convocatoria: {
            id: conv.externo_id || String(conv.id),
            titulo: conv.titulo,
            donante: conv.donante,
            descripcion: conv.descripcion,
            monto_max: conv.monto_max,
            moneda: conv.moneda,
          },
        }),
      });
      const data = await r.json();
      if (data.success && data.data?.redirect_to) {
        navigate(data.data.redirect_to);
      } else if (data.code === 'NO_ACCESS_FORMULADOR') {
        navigate('/planes');
      }
    } catch {
      navigate('/checklist');
    }
  }, [hasFormulador, navigate, isAuthenticated, authToken]);

  // ── Búsqueda semántica con pgvector (POST /api/radar/buscar-masivo) ──────────
  const handleBusquedaSemantica = useCallback(async () => {
    if (!search.trim() || searchingIARef.current) return;
    searchingIARef.current = true;
    setSearchingIA(true);
    setSemanticResults(null);
    try {
      const token = leerAuthToken(); // solo 'demo-mode-token' o null — ver comentario en useRadarStatus()
      const r = await fetch('/api/radar/buscar-masivo', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token === 'demo-mode-token' ? { Authorization: `Bearer ${token}` } : {}),
          ...obtenerCsrfHeaders(),
        },
        body: JSON.stringify({ texto: search.trim(), limit: 20, threshold: 0.25 }),
      });
      const d = await r.json();
      if (d.success && Array.isArray(d.resultados)) {
        const mapped: Convocatoria[] = d.resultados.map((r: any, i: number) => ({
          id: r.id || i,
          externo_id: r.id || `sem-${i}`,
          titulo: r.titulo || '',
          donante: r.donante || '',
          fuente: 'semantico',
          descripcion: r.descripcion || '',
          monto_min: r.monto_min || 0,
          monto_max: r.monto_max || 0,
          moneda: 'USD',
          paises_elegibles: '["Colombia"]',
          sectores: '[]',
          url_convocatoria: '',
          url_fuente: '',
          fecha_limite: r.fecha_limite || '',
          fecha_publicacion: '',
          requisitos: '[]',
          estado: r.estado || 'abierta',
          score_probabilidad: Math.round((r.similitud || 0) * 100),
          created_at: new Date().toISOString(),
        }));
        setSemanticResults(mapped);
      }
    } catch {
      setSemanticResults([]);
    } finally {
      searchingIARef.current = false;
      setSearchingIA(false);
    }
  }, [search]);

  // ── Barrido masivo por proyecto (POST /api/radar/barrido-masivo) ─────────────
  const handleBarridoMasivo = useCallback(async () => {
    if (!search.trim() || searchingIARef.current) return;
    searchingIARef.current = true;
    setSearchingIA(true);
    setSemanticResults(null);
    try {
      const token = leerAuthToken(); // solo 'demo-mode-token' o null — ver comentario en useRadarStatus()
      const r = await fetch('/api/radar/barrido-masivo', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token === 'demo-mode-token' ? { Authorization: `Bearer ${token}` } : {}),
          ...obtenerCsrfHeaders(),
        },
        body: JSON.stringify({ texto: search.trim(), limit: 30, threshold: 0.25 }),
      });
      const d = await r.json();
      if (d.success && Array.isArray(d.resultados)) {
        const mapped: Convocatoria[] = d.resultados.map((res: any, i: number) => ({
          id: res.id || i,
          externo_id: res.id || `barrido-${i}`,
          titulo: res.titulo || '',
          donante: res.donante || '',
          fuente: 'barrido',
          descripcion: res.descripcion || '',
          monto_min: res.monto_min || 0,
          monto_max: res.monto_max || 0,
          moneda: 'USD',
          paises_elegibles: '["Colombia"]',
          sectores: '[]',
          url_convocatoria: res.url_convocatoria || '',
          url_fuente: '',
          fecha_limite: res.fecha_limite || '',
          fecha_publicacion: '',
          requisitos: '[]',
          estado: res.estado || 'abierta',
          score_probabilidad: Math.round((res.similitud || 0) * 100),
          created_at: new Date().toISOString(),
        }));
        setSemanticResults(mapped);
      }
    } catch {
      setSemanticResults([]);
    } finally {
      searchingIARef.current = false;
      setSearchingIA(false);
    }
  }, [search]);

  // Vista "Mis Convocatorias"
  if (vista === 'mis-convocatorias') {
    return (
      <>
        <style>{STITCH_CSS}</style>
        <div className="max-w-7xl mx-auto space-y-6">
          <header className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-semibold text-onSurface flex items-center gap-2">
                <Star size={22} style={{ color: '#f59e0b' }} fill="#f59e0b" />
                Mis Convocatorias
              </h1>
              <p className="text-sm text-outline font-medium mt-1">Convocatorias guardadas para postulación</p>
            </div>
            <button
              onClick={() => setVista('convocatorias')}
              className="text-xs text-outline hover:text-onSurface underline underline-offset-2"
            >
              ← Volver al Radar
            </button>
          </header>
          <FavoritosView />
        </div>
      </>
    );
  }

  // Vista donantes → RadarDashboard (diseño Stitch ya implementado)
  if (vista === 'donantes') {
    return (
      <RadarDashboard
        onDonorSelect={(d: Donor) => console.log('[Dashboard] Donor seleccionado:', d.id)}
      >
        <button
          onClick={() => setVista('convocatorias')}
          className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
        >
          Ver convocatorias activas →
        </button>
      </RadarDashboard>
    );
  }

  // Vista convocatorias → diseño Stitch (idéntico a RadarDashboard)
  return (
    <>
      <style>{STITCH_CSS}</style>
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="flex flex-col gap-4 mb-6">
          {/* Fila 1: título + búsqueda */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-onSurface">
                RADAR FONDOS 360
                {newCount > 0 && (
                  <span className="ml-3 inline-flex items-center gap-1 text-sm font-semibold px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-600">
                    <ArrowUp size={14} /> {newCount} nueva{newCount > 1 ? 's' : ''}
                  </span>
                )}
              </h1>
              <p className="text-sm text-outline font-medium mt-1">
                {semanticResults
                  ? `${semanticResults.length} resultado${semanticResults.length !== 1 ? 's' : ''} semántico${semanticResults.length !== 1 ? 's' : ''}`
                  : `${convocatoriasFiltradas.length} convocatoria${convocatoriasFiltradas.length !== 1 ? 's' : ''} encontrada${convocatoriasFiltradas.length !== 1 ? 's' : ''}`
                }
              </p>
            </div>
            {/* Barra de búsqueda con modo IA */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-80">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  className="w-full bg-surface-container border border-outline-variant text-onSurface text-sm rounded-full focus:ring-secondary focus:border-secondary block pl-10 p-2.5 placeholder-outline-variant outline-none"
                  placeholder={searchMode === 'semantica' ? 'Describe tu proyecto para buscar fondos...' : 'Buscar por título, donante o sector...'}
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); if (semanticResults) setSemanticResults(null); }}
                  onKeyDown={e => { if (e.key === 'Enter' && searchMode === 'semantica') handleBusquedaSemantica(); }}
                />
              </div>
              {/* Toggle modo IA */}
              <button
                onClick={() => setSearchMode(m => m === 'texto' ? 'semantica' : 'texto')}
                title={searchMode === 'texto' ? 'Activar búsqueda semántica IA (pgvector)' : 'Volver a búsqueda por texto'}
                style={{
                  padding: '7px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em',
                  border: `1px solid ${searchMode === 'semantica' ? 'var(--primary)' : 'var(--outline-variant)'}`,
                  background: searchMode === 'semantica' ? 'rgba(142, 213, 255, 0.08)' : 'transparent',
                  color: searchMode === 'semantica' ? 'var(--primary)' : 'var(--on-surface-variant)',
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >🔮 IA</button>
              {/* Botón búsqueda semántica */}
              {searchMode === 'semantica' && (
                <button
                  onClick={handleBusquedaSemantica}
                  disabled={searchingIA || !search.trim()}
                  style={{
                    padding: '7px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    fontFamily: 'JetBrains Mono, monospace',
                    background: 'var(--primary)', color: 'var(--on-primary)', border: 'none',
                    cursor: searchingIA || !search.trim() ? 'not-allowed' : 'pointer',
                    opacity: searchingIA || !search.trim() ? 0.6 : 1,
                    whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {searchingIA ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                  {searchingIA ? 'Buscando...' : 'Buscar'}
                </button>
              )}
              {/* Botón barrido masivo */}
              {searchMode === 'semantica' && (
                <button
                  onClick={handleBarridoMasivo}
                  disabled={searchingIA || !search.trim()}
                  title="Barrido masivo de fondos (POST /api/radar/barrido-masivo)"
                  style={{
                    padding: '7px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    fontFamily: 'JetBrains Mono, monospace',
                    background: 'transparent', color: 'var(--primary)',
                    border: '1px solid var(--primary)',
                    cursor: searchingIA || !search.trim() ? 'not-allowed' : 'pointer',
                    opacity: searchingIA || !search.trim() ? 0.6 : 1,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >⚡ Barrido</button>
              )}
              {/* Limpiar resultados semánticos */}
              {semanticResults && (
                <button
                  onClick={() => { setSemanticResults(null); setSearch(''); }}
                  style={{
                    padding: '7px 10px', borderRadius: 20, fontSize: 11,
                    fontFamily: 'JetBrains Mono, monospace',
                    background: 'transparent', color: 'var(--on-surface-variant)',
                    border: '1px solid var(--outline-variant)', cursor: 'pointer', flexShrink: 0,
                  }}
                >✕ Limpiar</button>
              )}
            </div>
          </div>

          {/* Fila 2: RadarStatusBar */}
          <RadarStatusBar status={radarStatus} />
        </header>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['todos', 'abierta', 'nueva', 'pendiente', 'cerrada'] as const).map(estado => (
            <button
              key={estado}
              onClick={() => setFiltroEstado(estado)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                filtroEstado === estado
                  ? 'bg-secondary text-white border-secondary'
                  : 'bg-surface-container text-onSurface-variant border-outline-variant hover:border-outline'
              }`}
            >
              {estado === 'todos' ? 'Todas' : estado.charAt(0).toUpperCase() + estado.slice(1)}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-4">
            <button
              onClick={() => setVista('mis-convocatorias')}
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-amber-400/40 text-amber-500 hover:bg-amber-400/10 transition-colors flex items-center gap-1"
            >
              <Star size={13} fill="currentColor" /> Mis Convocatorias
            </button>
            <button
              onClick={() => setVista('donantes')}
              className="text-xs text-outline hover:text-onSurface underline underline-offset-2"
            >
              ← Directorio Donantes
            </button>
          </div>
        </div>

        {/* States */}
        {loading && (
          <div className="text-center py-16 text-outline">Cargando convocatorias…</div>
        )}
        {error && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <AlertCircle size={40} className="text-red-400" />
            <p className="text-red-500 font-medium">{error}</p>
          </div>
        )}

        {/* Etiqueta modo semántico */}
        {semanticResults && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            borderRadius: 6, background: 'rgba(0,88,190,0.06)', border: '1px solid rgba(0,88,190,0.2)',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#0058be',
          }}>
            🔮 Resultados por similitud semántica pgvector · Motor: IA vectorial 768D
          </div>
        )}

        {/* Directory List */}
        <main className="space-y-3">
          {searchingIA ? (
            <div className="text-center py-16 text-outline flex flex-col items-center gap-3">
              <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#0058be' }} />
              <span>Procesando con pgvector HNSW…</span>
            </div>
          ) : semanticResults !== null ? (
            semanticResults.length === 0 ? (
              <div className="text-center py-16 text-outline">
                Sin resultados semánticos para "{search}". Intenta con otro umbral.
              </div>
            ) : (
              semanticResults.map((c, i) => (
                <ConvocatoriaCard
                  key={c.externo_id || c.id}
                  conv={c}
                  index={i}
                  isFavorito={isFavorito(String(c.externo_id || c.id))}
                  guardandoId={guardandoId}
                  errorGuardado={errorGuardado}
                  onToggleFavorito={handleToggleFavorito}
                  onFormular={handleFormular}
                />
              ))
            )
          ) : convocatoriasFiltradas.length === 0 && !loading ? (
            <div className="text-center py-16 text-outline">
              No se encontraron convocatorias para "{search}"
            </div>
          ) : (
            convocatoriasFiltradas.map((c, i) => (
              <ConvocatoriaCard
                key={c.externo_id || c.id}
                conv={c}
                index={i}
                isFavorito={isFavorito(String(c.externo_id || c.id))}
                guardandoId={guardandoId}
                errorGuardado={errorGuardado}
                onToggleFavorito={handleToggleFavorito}
                onFormular={handleFormular}
              />
            ))
          )}
        </main>

        <footer className="flex justify-end pt-4 border-t border-outline-variant text-xs text-outline">
          {convocatorias.length} registros en base de datos • Radar Fondos 360 © 2026
        </footer>
      </div>
    </>
  );
}
