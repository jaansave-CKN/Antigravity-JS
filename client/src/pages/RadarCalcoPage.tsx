/**
 * RadarCalcoPage — Radar de Convocatorias con filtros País / Sector
 * Tokens: primary #0058be · background #f7f9fb · surface-container #eceef0
 * badges: abierta #059669 · nueva #0284c7 · cerrada #76777d
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';
import { SECTORES_TAXONOMY } from '../data/sectoresTaxonomy';
import './RadarCalcoPage.css';

const STORAGE_KEY = 'radar360_radar_favoritos';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Convocatoria {
  id: string;
  titulo: string;
  donante: string;
  descripcion: string;
  monto_min: number;
  monto_max: number;
  moneda: string;
  paises_elegibles: string;
  sectores: string;
  url_convocatoria: string;
  fecha_limite: string;
  fecha_publicacion: string;
  estado: string;
  created_at: string;
  score_probabilidad: number;
  entidad_nombre: string | null;
  entidad_sigla: string | null;
  entidad_tipo: string | null;
  entidad_pais: string | null;
}

interface MetaFiltros {
  sectores: string[];
  paises: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parsePaises(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return raw ? [raw] : []; }
}
function parseSectores(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return raw ? [raw] : []; }
}
function formatMonto(min: number, max: number, moneda: string): string {
  const val = max > 0 ? max : min;
  if (!val) return '';
  const fmt = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
  return `${moneda === 'COP' ? '$' : 'USD '}${fmt.format(val)}`;
}
function getLogoText(conv: Convocatoria): string {
  const src = conv.entidad_sigla || conv.donante || conv.titulo;
  const words = src.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
function estadoBadge(conv: Pick<Convocatoria, 'estado' | 'created_at'>): 'abierta' | 'nueva' {
  if (conv.created_at) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (new Date(conv.created_at).getTime() >= sevenDaysAgo) return 'nueva';
  }
  return 'abierta';
}

// ── SectorDropdown — multi-selección jerárquica ───────────────────────────────
function SectorDropdown({ active, onChange }: {
  active: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(active);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange([...next]);
  };

  const toggleExpand = (nombre: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(nombre)) s.delete(nombre); else s.add(nombre);
      return s;
    });
  };

  const label = active.length === 0
    ? 'Todos los sectores'
    : active.length === 1
      ? active[0]
      : `${active.length} seleccionados`;

  return (
    <div className="radx__sector-drop" ref={panelRef}>
      <button
        className={`radx__sector-btn${active.length > 0 ? ' radx__sector-btn--active' : ''}`}
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/>
        </svg>
        <span className="radx__sector-btn__label">{label}</span>
        {active.length > 0 && <span className="radx__sector-btn__badge">{active.length}</span>}
        <svg className={`radx__sector-btn__chevron${open ? ' radx__sector-btn__chevron--open' : ''}`} width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="radx__sector-panel">
          {SECTORES_TAXONOMY.map(sector => {
            const isExpanded = expanded.has(sector.nombre);
            const isSectorChecked = active.includes(sector.nombre);
            return (
              <div key={sector.nombre} className="radx__sector-sect">
                <div
                  className="radx__sector-sect-hdr"
                  onClick={() => toggleExpand(sector.nombre)}
                >
                  <input
                    type="checkbox"
                    checked={isSectorChecked}
                    onChange={() => {}}
                    onClick={e => toggle(sector.nombre, e)}
                  />
                  <span>{sector.nombre}</span>
                  <svg className={isExpanded ? 'open' : ''} width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </div>
                {isExpanded && (
                  <div className="radx__sector-subs">
                    {sector.subgrupos.map(sg => (
                      <div
                        key={sg.nombre}
                        className="radx__sector-sub-row"
                        onClick={e => toggle(sg.nombre, e)}
                      >
                        <input
                          type="checkbox"
                          checked={active.includes(sg.nombre)}
                          onChange={() => {}}
                          onClick={e => toggle(sg.nombre, e)}
                        />
                        <span>{sg.nombre}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Componente ────────────────────────────────────────────────────────────────
export default function RadarCalcoPage() {
  const { token } = useAuth();
  const tokenRef = useRef<string | null>(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const [searchParams, setSearchParams] = useSearchParams();
  const entidadId     = searchParams.get('entidad_id') || '';
  const entidadNombre = searchParams.get('nombre') || '';

  const [convocatorias, setConvocatorias] = useState<Convocatoria[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [meta, setMeta]       = useState<MetaFiltros>({ sectores: [], paises: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [barrido, setBarrido] = useState(false);
  const [barridoMsg, setBarridoMsg] = useState('');
  const [rastreo1, setRastreo1] = useState(false);
  const [rastreo1Msg, setRastreo1Msg] = useState('');
  const [error, setError]     = useState<string | null>(null);
  // Vista activa: null = todas | '1' = Directorio | '2' = Web externa
  const [activeRastreo, setActiveRastreo] = useState<null | '1' | '2'>(null);

  // Filtros (servidor)
  const [busqueda, setBusqueda]     = useState('');
  const [filtroPais, setFiltroPais] = useState('Todos');
  const [filtroSectores, setFiltroSectores] = useState<string[]>([]);  // multi-select
  const [filtroEstado, setFiltroEstado]     = useState('todos');

  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs para que los filtros lean siempre el valor actual (evita stale closure en debounce)
  const busquedaRef   = useRef(busqueda);
  const paisRef       = useRef(filtroPais);
  const sectoresRef   = useRef<string[]>(filtroSectores);
  const estadoRef     = useRef(filtroEstado);
  const rastreoRef    = useRef<null | '1' | '2'>(activeRastreo);

  // Mantener refs sincronizados con el estado para evitar stale closures en debounce
  useEffect(() => { busquedaRef.current = busqueda; }, [busqueda]);
  useEffect(() => { paisRef.current = filtroPais; }, [filtroPais]);
  useEffect(() => { sectoresRef.current = filtroSectores; }, [filtroSectores]);
  useEffect(() => { estadoRef.current = filtroEstado; }, [filtroEstado]);
  useEffect(() => { rastreoRef.current = activeRastreo; }, [activeRastreo]);

  // Load favorites from DB when token resolves; fallback to localStorage for demo/guest
  const favLoadedRef = useRef(false);
  useEffect(() => {
    if (token === null) return; // auth context still initializing
    if (favLoadedRef.current) return;
    favLoadedRef.current = true;

    if (token && token !== 'demo-mode-token') {
      fetch('/api/favorites', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          if (json?.success && Array.isArray(json.data)) {
            setFavoritos(new Set(json.data.map((f: { grant_id: string }) => f.grant_id)));
          } else {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) { try { setFavoritos(new Set(JSON.parse(raw))); } catch {} }
          }
        })
        .catch(() => {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) { try { setFavoritos(new Set(JSON.parse(raw))); } catch {} }
        });
    } else {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { try { setFavoritos(new Set(JSON.parse(raw))); } catch {} }
    }
  }, [token]);

  useEffect(() => {
    fetchMeta();
  }, []);

  async function fetchMeta() {
    try {
      const res = await fetch('/api/convocatorias/meta');
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setMeta(json);
    } catch {}
  }

  const fetchConvocatorias = useCallback(async (opts: {
    q?: string; pais?: string; sectores?: string[]; estado?: string;
    isRefresh?: boolean; rastreo?: null | '1' | '2';
  } = {}) => {
    // Leer siempre desde refs para evitar stale closures
    const q        = opts.q        !== undefined ? opts.q        : busquedaRef.current;
    const pais     = opts.pais     !== undefined ? opts.pais     : paisRef.current;
    const sectores = opts.sectores !== undefined ? opts.sectores : sectoresRef.current;
    const estado   = opts.estado   !== undefined ? opts.estado   : estadoRef.current;
    const rastreoActivo = opts.rastreo !== undefined ? opts.rastreo : rastreoRef.current;
    const isRefresh = opts.isRefresh ?? false;

    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (rastreoActivo)   params.set('rastreo', rastreoActivo);
      if (q)               params.set('q', q);
      if (entidadId)       params.set('entidad_id', entidadId);
      if (pais !== 'Todos') params.set('pais', pais);
      if (sectores.length > 0) params.set('sector', sectores.join(','));
      if (estado !== 'todos')  params.set('estado', estado);
      const res = await fetch(`/api/convocatorias?${params}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const json = await res.json();
      const list: Convocatoria[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      setConvocatorias(list);
      if (typeof json?.total === 'number') setTotalCount(json.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar convocatorias');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [entidadId]); // Solo entidadId como dep real — el resto se leen de refs

  async function triggerRastreo1() {
    setActiveRastreo('1');
    rastreoRef.current = '1';
    setRastreo1(true);
    setRastreo1Msg('');
    // Mostrar inmediatamente solo convocatorias R1 (las que ya existen)
    fetchConvocatorias({ rastreo: '1' });
    try {
      const res = await fetch('/api/radar/rastreo1', { method: 'POST' });
      const json = await res.json();
      setRastreo1Msg(json.message || 'Rastreo 1 iniciado');
      // Refrescar R1 a los 15s para capturar nuevas entidades insertadas
      setTimeout(() => fetchConvocatorias({ isRefresh: true, rastreo: '1' }), 15000);
    } catch {
      setRastreo1Msg('Error al iniciar Rastreo 1');
    } finally {
      setTimeout(() => setRastreo1(false), 8000);
    }
  }

  async function triggerBarrido() {
    setActiveRastreo('2');
    rastreoRef.current = '2';
    setBarrido(true);
    setBarridoMsg('');
    // Mostrar inmediatamente solo convocatorias R2 (las que ya existen)
    fetchConvocatorias({ rastreo: '2' });
    try {
      const res = await fetch('/api/radar/trigger', { method: 'POST' });
      const json = await res.json();
      setBarridoMsg(json.message || 'Rastreo 2 iniciado');
      setTimeout(() => fetchConvocatorias({ isRefresh: true, rastreo: '2' }), 15000);
    } catch {
      setBarridoMsg('Error al iniciar Rastreo 2');
    } finally {
      setTimeout(() => setBarrido(false), 8000);
    }
  }

  // Carga inicial + recarga cuando cambia la entidad filtrada
  useEffect(() => { fetchConvocatorias(); }, [entidadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch al cambiar filtros de selects (inmediato)
  function onPaisChange(val: string) {
    setFiltroPais(val);
    paisRef.current = val;        // actualizar ref antes del fetch
    fetchConvocatorias({ pais: val });
  }
  function onSectoresChange(vals: string[]) {
    setFiltroSectores(vals);
    sectoresRef.current = vals;
    fetchConvocatorias({ sectores: vals });
  }
  function onEstadoChange(val: string) {
    setFiltroEstado(val);
    estadoRef.current = val;
    fetchConvocatorias({ estado: val });
  }

  // Búsqueda con debounce 350ms
  function onBusquedaChange(val: string) {
    setBusqueda(val);
    busquedaRef.current = val;    // actualizar ref inmediatamente (antes del debounce)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchConvocatorias({ q: val }), 350);
  }

  const toggleFavorito = (id: string) => {
    const t = tokenRef.current;
    // Optimistic update
    setFavoritos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (!t || t === 'demo-mode-token') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      }
      return next;
    });
    if (t && t !== 'demo-mode-token') {
      fetch(`/api/convocatorias/${id}/favorito`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      }).catch(() => {
        // Revert on network error
        setFavoritos(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      });
    }
  };

  const displayed = useMemo(
    () => convocatorias.map(c => ({ ...c, favorito: favoritos.has(c.id) })),
    [convocatorias, favoritos]
  );

  const favFirst = useMemo(
    () => [...displayed].sort((a, b) => Number(b.favorito) - Number(a.favorito)),
    [displayed]
  );

  return (
    <div className="radx">
      <div className="radx__container">

        {/* Banner de filtro por entidad */}
        {entidadId && (
          <div className="radx__entity-banner">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span>
              Convocatorias de: <strong>{entidadNombre || entidadId}</strong>
            </span>
            <button
              className="radx__entity-clear"
              onClick={() => setSearchParams({})}
              title="Ver todas las convocatorias"
            >
              × Quitar filtro
            </button>
          </div>
        )}

        {/* Header */}
        <header className="radx__header">
          <div>
            <h1 className="radx__title">RADAR</h1>
            <p className="radx__count">
              {loading ? 'Cargando...' : (() => {
                const shown = favFirst.length;
                const total = totalCount;
                if (total === null || total === shown) return `${shown} convocatoria${shown !== 1 ? 's' : ''}`;
                return `${shown} de ${total} convocatoria${total !== 1 ? 's' : ''}`;
              })()}
              {activeRastreo === '1' && <span className="radx__rastreo-badge radx__rastreo-badge--r1"> · Directorio</span>}
              {activeRastreo === '2' && <span className="radx__rastreo-badge radx__rastreo-badge--r2"> · Web externa</span>}
            </p>
          </div>
          <div className="radx__header-right">
            <button
              className={`radx__barrido-btn${rastreo1 ? ' radx__barrido-btn--active' : ''}`}
              onClick={triggerRastreo1}
              disabled={rastreo1 || loading}
              title="Rastreo 1 — Escanear convocatorias de cada entidad del Directorio"
            >
              {rastreo1 ? '⏳ Escaneando…' : '🏢 Rastreo 1'}
            </button>
            {rastreo1Msg && (
              <span className="radx__barrido-msg">{rastreo1Msg}</span>
            )}
            <button
              className={`radx__barrido-btn${barrido ? ' radx__barrido-btn--active' : ''}`}
              onClick={triggerBarrido}
              disabled={barrido || loading}
              title="Rastreo 2 — Minciencias + Banco Mundial"
            >
              {barrido ? '⏳ Rastreando…' : '🛰 Rastreo 2'}
            </button>
            {barridoMsg && (
              <span className="radx__barrido-msg">{barridoMsg}</span>
            )}
            <button
              className="radx__refresh-btn"
              onClick={() => { setActiveRastreo(null); rastreoRef.current = null; fetchConvocatorias({ isRefresh: true, rastreo: null }); }}
              disabled={loading || refreshing}
              title="Ver todas las convocatorias (R1 + R2)"
            >
              <svg
                className={refreshing ? 'radx__spin' : ''}
                width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
              Actualizar
            </button>
            <div className="radx__search-wrap">
              <svg className="radx__search-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
              <input
                className="radx__search"
                placeholder="Buscar convocatorias..."
                type="text"
                value={busqueda}
                onChange={e => onBusquedaChange(e.target.value)}
              />
            </div>
          </div>
        </header>

        {/* Barra de filtros País / Sector / Estado */}
        <div className="radx__filters">
          <div className="radx__filter-group">
            <label className="radx__filter-label">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              País
            </label>
            <select
              className="radx__filter-select"
              value={filtroPais}
              onChange={e => onPaisChange(e.target.value)}
            >
              <option value="Todos">Todos</option>
              <option value="Colombia">Colombia</option>
              <option value="Internacional">Internacional</option>
              {meta.paises
                .filter(p => p !== 'Colombia' && p !== 'Internacional')
                .map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Sector + Sub-grupo: multi-selección jerárquica */}
          <div className="radx__filter-group">
            <label className="radx__filter-label">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/>
              </svg>
              Sector
            </label>
            <SectorDropdown active={filtroSectores} onChange={onSectoresChange} />
          </div>

          <div className="radx__filter-group">
            <label className="radx__filter-label">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Estado
            </label>
            <select
              className="radx__filter-select"
              value={filtroEstado}
              onChange={e => onEstadoChange(e.target.value)}
            >
              <option value="todos">Todos</option>
              <option value="abierta">Abierta</option>
              <option value="nueva">Nueva</option>
            </select>
          </div>

          {(filtroPais !== 'Todos' || filtroSectores.length > 0 || filtroEstado !== 'todos' || busqueda) && (
            <button
              className="radx__filter-clear"
              onClick={() => {
                setBusqueda('');         busquedaRef.current = '';
                setFiltroPais('Todos');  paisRef.current = 'Todos';
                setFiltroSectores([]);   sectoresRef.current = [];
                setFiltroEstado('todos'); estadoRef.current = 'todos';
                setActiveRastreo(null);  rastreoRef.current = null;
                fetchConvocatorias({ q: '', pais: 'Todos', sectores: [], estado: 'todos', rastreo: null });
              }}
            >
              × Limpiar filtros
            </button>
          )}

          {/* Chips de sectores/subgrupos activos */}
          {filtroSectores.length > 0 && (
            <div className="radx__sector-chips">
              {filtroSectores.map(s => (
                <span key={s} className="radx__sector-chip">
                  {s}
                  <button
                    onClick={() => onSectoresChange(filtroSectores.filter(x => x !== s))}
                    title={`Quitar ${s}`}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="radx__error">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth="2" />
              <line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {error}
            <button className="radx__error-retry" onClick={() => fetchConvocatorias({ isRefresh: true })}>REINTENTAR</button>
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div className="radx__list">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="radx__skel-card">
                <div className="radx__skel-logo" />
                <div className="radx__skel-lines">
                  <div className="radx__skel-block" style={{ width: '65%' }} />
                  <div className="radx__skel-block" style={{ width: '40%', marginTop: 8 }} />
                </div>
                <div className="radx__skel-badge" />
              </div>
            ))}
          </div>
        )}

        {/* Lista de convocatorias */}
        {!loading && (
          <main className="radx__list">
            {favFirst.map((c, i) => {
              const paises  = parsePaises(c.paises_elegibles);
              const sects   = parseSectores(c.sectores);
              const monto   = formatMonto(c.monto_min, c.monto_max, c.moneda);
              const badge   = estadoBadge(c);
              const entidad = c.entidad_nombre || c.donante;
              return (
                <article key={c.id} className="radx__card">
                  <div className="radx__left">
                    <button
                      className={c.favorito ? 'radx__star radx__star--on' : 'radx__star'}
                      onClick={() => toggleFavorito(c.id)}
                      title={c.favorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill={c.favorito ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                    <span className="radx__rank">#{i + 1}</span>
                    <div className="radx__logo radx__logo--conv">{getLogoText(c)}</div>
                    <div className="radx__info">
                      <h2 className="radx__name" title={c.titulo}>{c.titulo}</h2>
                      <div className="radx__meta">
                        <div className="radx__badge-col">
                          <span className={`radx__badge radx__badge--${badge}`}>
                            <svg width="8" height="8" fill="currentColor" viewBox="0 0 8 8">
                              <circle cx="4" cy="4" r="4" />
                            </svg>
                            {badge.toUpperCase()}
                          </span>
                        </div>
                        <div className="radx__stats">
                          {entidad && (
                            <span className="radx__stat" title={entidad}>
                              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                              </svg>
                              {(c.entidad_sigla || entidad).slice(0, 16)}
                            </span>
                          )}
                          {c.fecha_limite && (
                            <span className="radx__stat radx__stat--fecha" title={`Cierre: ${c.fecha_limite}`}>
                              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                              </svg>
                              {c.fecha_limite.slice(0, 10)}
                            </span>
                          )}
                          {monto && (
                            <span className="radx__stat radx__stat--monto">
                              {monto}
                            </span>
                          )}
                          {paises.length > 0 && (
                            <span className="radx__stat">
                              <span className="radx__pin">📍</span>
                              {paises.slice(0, 2).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="radx__right">
                    {sects.slice(0, 3).map(s => (
                      <span key={s} className="radx__tag radx__tag--blue">{s}</span>
                    ))}
                    {sects.length > 3 && (
                      <span className="radx__tag-extra">+{sects.length - 3}</span>
                    )}
                    <a
                      href={c.url_convocatoria || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`radx__chevron${!c.url_convocatoria ? ' radx__chevron--disabled' : ''}`}
                      title={c.url_convocatoria ? 'Ver convocatoria' : 'Sin enlace disponible'}
                      onClick={e => { if (!c.url_convocatoria) e.preventDefault(); }}
                    >
                      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                      </svg>
                    </a>
                  </div>
                </article>
              );
            })}

            {favFirst.length === 0 && !error && (
              <p className="radx__empty">
                {busqueda || filtroPais !== 'Todos' || filtroSectores.length > 0
                  ? 'Sin convocatorias para los filtros seleccionados.'
                  : 'No hay convocatorias registradas. El ingestor automático las cargará en el próximo ciclo.'}
              </p>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
