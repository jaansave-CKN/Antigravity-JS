import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, AlertCircle, Star, Loader2 } from 'lucide-react';
import RadarDashboard, { type Donor, type DonorType, type TagColor } from './components/RadarDashboard';
import FavoritosView from './components/FavoritosView';
import { useFavoritos } from './contexts/FavoritosContext';

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

function parseJson<T>(str: string, fallback: T): T {
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function formatMoney(amount: number, currency: string): string {
  if (!amount) return 'No especificado';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

// ── Stitch helpers ────────────────────────────────────────────────────────────
const STITCH_CSS = `
  .badge-bilateral   { color: #059669; border-color: #059669; }
  .badge-multilateral{ color: #0284c7; border-color: #0284c7; }
  .badge-privado     { color: #9333ea; border-color: #9333ea; }
  .badge-gobierno    { color: #ca8a04; border-color: #ca8a04; }
  .tag-default { color: #45464d; background-color: transparent; border-color: transparent; }
  .tag-blue    { color: #0058be; background-color: rgba(0,88,190,0.1); }
  .tag-green   { color: #16a34a; background-color: rgba(22,163,74,0.1); }
  .tag-orange  { color: #ea580c; background-color: rgba(234,88,12,0.1); }
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

// ── ConvocatoriaCard — misma estructura exacta que DonorCard en RadarDashboard ─
interface ConvocatoriaCardProps {
  conv: Convocatoria;
  index: number;
  isFavorito?: boolean;
  guardandoId?: string | null;
  errorGuardado?: string | null;
  onToggleFavorito?: (conv: Convocatoria) => void;
}
function ConvocatoriaCard({ conv, index, isFavorito, guardandoId, errorGuardado, onToggleFavorito }: ConvocatoriaCardProps) {
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
      </div>
    </article>
  );
}

export default function Dashboard() {
  const [vista, setVista] = useState<'convocatorias' | 'donantes' | 'mis-convocatorias'>('donantes');
  const [convocatorias, setConvocatorias] = useState<Convocatoria[]>([]);
  const { isFavorito, guardarFavorito, eliminarPorGrantId } = useFavoritos();
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [search, setSearch] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');

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
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
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
              {convocatoriasFiltradas.length} convocatoria{convocatoriasFiltradas.length !== 1 ? 's' : ''} encontrada{convocatoriasFiltradas.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-full md:w-96 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="w-full bg-surface-container border border-outline-variant text-onSurface text-sm rounded-full focus:ring-secondary focus:border-secondary block pl-10 p-2.5 placeholder-outline-variant outline-none"
                placeholder="Buscar por título, donante o sector..."
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
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

        {/* Directory List */}
        <main className="space-y-3">
          {convocatoriasFiltradas.length === 0 && !loading ? (
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
