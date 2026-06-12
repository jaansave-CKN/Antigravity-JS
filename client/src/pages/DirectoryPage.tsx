/**
 * DirectoryPage — Calco estricto Stitch
 * Screen DIRECTORIO del canvas: dc6d74fb078a49f0a507878d8a822275
 * "Radar Formulador 360 - Subvenciones Favoritas" (layout tabla/lista)
 *
 * Columnas: Organización · Logo · Categoría · Información de contacto · Acciones.
 * Header: título + Eliminar(bulk)/Filtrar/Ordenar (calco) + Importar/Refrescar (función real).
 * Datos 100% reales desde GET /api/entidades (merge localStorage).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';
import './DirectoryPage.css';

const STORAGE_KEY = 'radar_directory_entries';
const FAV_KEY = 'radar_directory_favoritos';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DirectoryEntry {
  id: string;
  nombre: string;
  sigla: string;
  tipo: string;
  pais: string;
  sitio_web: string;
  url_convocatorias: string;
  telefono: string;
  email: string;
  alcance: string;
  validation_status: string;
  fuente: string;
  convocatorias_count?: number;
  logo_url?: string;
}

type Orden = 'az' | 'categoria';

// ── Icono búsqueda ────────────────────────────────────────────────────────────
const IconSearch = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconClose = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// ── Persistencia ──────────────────────────────────────────────────────────────
function loadStored(): DirectoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DirectoryEntry[]) : [];
  } catch { return []; }
}
function saveStored(entries: DirectoryEntry[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* lleno */ }
}

// ── Fetch seguro ──────────────────────────────────────────────────────────────
async function safeJsonFetch(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    throw new Error(`Error de conexión con el repositorio (el servidor devolvió HTML en lugar de JSON — ruta ${url})`);
  }
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error('Error de conexión con el repositorio (respuesta no es JSON válido)'); }
  return { ok: res.ok, status: res.status, data };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getInitials(sigla: string, nombre: string): string {
  if (sigla && sigla.length >= 2) return sigla.slice(0, 2).toUpperCase();
  const words = nombre.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return nombre.slice(0, 2).toUpperCase();
}
function mergeEntries(stored: DirectoryEntry[], incoming: DirectoryEntry[]): DirectoryEntry[] {
  const map = new Map(stored.map(e => [e.id, e]));
  for (const entry of incoming) if (!map.has(entry.id)) map.set(entry.id, entry);
  return Array.from(map.values());
}
function normalizeApiEntry(raw: any): DirectoryEntry {
  return {
    id:                   String(raw.id ?? Math.random()),
    nombre:               raw.nombre ?? '',
    sigla:                raw.sigla ?? '',
    tipo:                 raw.tipo ?? 'ENTIDAD',
    pais:                 raw.pais ?? '',
    sitio_web:            raw.sitio_web ?? '',
    url_convocatorias:    raw.url_convocatorias ?? '',
    telefono:             raw.telefono ?? '',
    email:                raw.email ?? '',
    alcance:              raw.alcance ?? '',
    validation_status:    raw.validation_status ?? 'IMPORTADO',
    fuente:               raw.fuente ?? '',
    convocatorias_count:  Number(raw.convocatorias_count ?? 0),
    logo_url:             raw.logo_url ?? '',
  };
}

// ── Favicon helper ────────────────────────────────────────────────────────────
function getFaviconUrl(sitio_web: string): string | null {
  if (!sitio_web) return null;
  try {
    const { hostname } = new URL(sitio_web);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch { return null; }
}

// ── LogoThumb: miniatura con fallback a iniciales ─────────────────────────────
function LogoThumb({ entry }: { entry: DirectoryEntry }) {
  const [failed, setFailed] = useState(false);
  const src = entry.logo_url || getFaviconUrl(entry.sitio_web);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="dirx__thumb-img"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="dirx__thumb-initials">
      {getInitials(entry.sigla, entry.nombre).slice(0, 1)}
    </span>
  );
}

// ── Iconos SVG ────────────────────────────────────────────────────────────────
const IconStar = ({ filled }: { filled: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
);
const IconGlobe = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
);
const IconCall = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
);
const IconMail = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
);
const IconPin = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
);
const IconExternal = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
);
const IconFilter = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
);
const IconSort = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><line x1="11" y1="5" x2="21" y2="5"/><line x1="11" y1="9" x2="17" y2="9"/><line x1="11" y1="13" x2="21" y2="13"/><polyline points="3 8 6 5 9 8"/><line x1="6" y1="5" x2="6" y2="19"/></svg>
);
const IconUpload = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
);
const IconRefresh = ({ spinning }: { spinning: boolean }) => (
  <svg className={spinning ? 'dirx__spin' : undefined} width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
);
const IconDelete = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
);
const IconSpinner = () => (
  <svg className="dirx__spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
);
const IconWarning = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);

// ── Componente principal ──────────────────────────────────────────────────────
export default function DirectoryPage() {
  const { token } = useAuth();
  const navigate  = useNavigate();

  const [entries, setEntries]       = useState<DirectoryEntry[]>(() => loadStored());
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [soloFav, setSoloFav]       = useState(false);
  const [orden, setOrden]           = useState<Orden>('az');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipo, setFilterTipo]   = useState('');
  const [filterPais, setFilterPais]   = useState('');
  const [filterAlcance, setFilterAlcance] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // ── Selección múltiple ────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [favoritos, setFavoritos]   = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); }
  });

  function commit(next: DirectoryEntry[]) {
    setEntries(next);
    saveStored(next);
  }

  useEffect(() => {
    fetchDirectory(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cerrar panel de filtros al click fuera
  useEffect(() => {
    if (!showFilterPanel) return;
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterPanel(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilterPanel]);

  const uniqueTipos   = useMemo(() => [...new Set(entries.map(e => e.tipo).filter(Boolean))].sort(), [entries]);
  const uniquePaises  = useMemo(() => [...new Set(entries.map(e => e.pais).filter(Boolean))].sort(), [entries]);
  const uniqueAlcances = useMemo(() => [...new Set(entries.map(e => e.alcance).filter(Boolean))].sort(), [entries]);

  const activeFilterCount = [soloFav, filterTipo, filterPais, filterAlcance].filter(Boolean).length;

  async function fetchDirectory(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const { ok, data } = await safeJsonFetch('/api/entidades', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!ok) throw new Error(data?.message ?? 'Error al cargar directorio.');
      const incoming: DirectoryEntry[] = (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])
        .map(normalizeApiEntry);
      setEntries(prev => {
        const merged = mergeEntries(prev, incoming);
        saveStored(merged);
        return merged;
      });
    } catch (e: any) {
      console.error('[DirectoryPage] fetch error:', e);
      setError(e.message ?? 'Error de conexión con el repositorio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteBulk() {
    setBulkDeleting(true);
    const ids = [...selectedIds];
    await Promise.allSettled(
      ids.map(id =>
        safeJsonFetch(`/api/entidades/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    );
    commit(entries.filter(e => !selectedIds.has(e.id)));
    setSelectedIds(new Set());
    setShowDeleteModal(false);
    setBulkDeleting(false);
  }

  function toggleFavorito(id: string) {
    setFavoritos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const filtradas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let base = [...entries];
    if (q) {
      base = base.filter(e =>
        e.nombre.toLowerCase().includes(q) ||
        e.sigla.toLowerCase().includes(q)  ||
        e.tipo.toLowerCase().includes(q)   ||
        e.pais.toLowerCase().includes(q)   ||
        e.email.toLowerCase().includes(q)
      );
    }
    if (soloFav)      base = base.filter(e => favoritos.has(e.id));
    if (filterTipo)   base = base.filter(e => e.tipo === filterTipo);
    if (filterPais)   base = base.filter(e => e.pais === filterPais);
    if (filterAlcance) base = base.filter(e => e.alcance === filterAlcance);
    base.sort((a, b) => {
      if (orden === 'categoria') return (a.tipo || '').localeCompare(b.tipo || '') || a.nombre.localeCompare(b.nombre);
      return a.nombre.localeCompare(b.nombre);
    });
    return base.sort((a, b) => Number(favoritos.has(b.id)) - Number(favoritos.has(a.id)));
  }, [entries, searchQuery, soloFav, filterTipo, filterPais, filterAlcance, orden, favoritos]);

  return (
    <div className="dirx">
      <main className="dirx__main">

        {/* Header */}
        <div className="dirx__header">
          <div>
            <h1 className="dirx__title">DIRECTORIO</h1>
            <p className="dirx__subtitle">
              {loading
                ? 'Cargando…'
                : (searchQuery || activeFilterCount > 0)
                  ? `${filtradas.length} resultado${filtradas.length !== 1 ? 's' : ''} de ${entries.length} entidades`
                  : `${entries.length} entidad${entries.length !== 1 ? 'es' : ''} registrada${entries.length !== 1 ? 's' : ''}`
              }
            </p>
          </div>
          <div className="dirx__header-actions">

            {/* Botón Eliminar masivo */}
            <button
              className="dirx__hbtn dirx__hbtn--danger"
              disabled={selectedIds.size === 0}
              onClick={() => setShowDeleteModal(true)}
              title={selectedIds.size === 0 ? 'Selecciona filas para eliminar' : `Eliminar ${selectedIds.size} entidad(es)`}
            >
              <IconDelete />
              <span>Eliminar{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</span>
            </button>

            {/* Filtrar con panel dropdown */}
            <div className="dirx__filter-wrap" ref={filterRef}>
              <button
                className={activeFilterCount > 0 ? 'dirx__hbtn dirx__hbtn--active' : 'dirx__hbtn'}
                onClick={() => setShowFilterPanel(v => !v)}
              >
                <IconFilter />
                <span>Filtrar</span>
                {activeFilterCount > 0 && (
                  <span className="dirx__filter-badge">{activeFilterCount}</span>
                )}
              </button>
              {showFilterPanel && (
                <div className="dirx__filter-panel">
                  <p className="dirx__filter-panel-title">Filtros</p>

                  <label className="dirx__filter-label">
                    <input
                      type="checkbox"
                      checked={soloFav}
                      onChange={() => setSoloFav(v => !v)}
                    />
                    Solo favoritos
                  </label>

                  <div className="dirx__filter-group">
                    <span className="dirx__filter-group-label">Categoría</span>
                    <select
                      className="dirx__filter-select"
                      value={filterTipo}
                      onChange={e => setFilterTipo(e.target.value)}
                    >
                      <option value="">Todas</option>
                      {uniqueTipos.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  <div className="dirx__filter-group">
                    <span className="dirx__filter-group-label">País</span>
                    <select
                      className="dirx__filter-select"
                      value={filterPais}
                      onChange={e => setFilterPais(e.target.value)}
                    >
                      <option value="">Todos</option>
                      {uniquePaises.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  {uniqueAlcances.length > 0 && (
                    <div className="dirx__filter-group">
                      <span className="dirx__filter-group-label">Alcance</span>
                      <select
                        className="dirx__filter-select"
                        value={filterAlcance}
                        onChange={e => setFilterAlcance(e.target.value)}
                      >
                        <option value="">Todos</option>
                        {uniqueAlcances.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  )}

                  {activeFilterCount > 0 && (
                    <button
                      className="dirx__filter-clear"
                      onClick={() => { setSoloFav(false); setFilterTipo(''); setFilterPais(''); setFilterAlcance(''); }}
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              className="dirx__hbtn"
              onClick={() => setOrden(o => o === 'az' ? 'categoria' : 'az')}
              title={orden === 'az' ? 'Ordenado A-Z' : 'Ordenado por categoría'}
            >
              <IconSort />
              <span>{orden === 'az' ? 'A-Z' : 'Categoría'}</span>
            </button>
            <button className="dirx__hbtn dirx__hbtn--primary" onClick={() => navigate('/importar')}>
              <IconUpload />
              <span>Importar</span>
            </button>
            <button
              className="dirx__hbtn dirx__hbtn--icononly"
              onClick={() => fetchDirectory(true)}
              disabled={refreshing || loading}
              title="Actualizar desde fuentes oficiales"
            >
              <IconRefresh spinning={refreshing} />
            </button>
          </div>
        </div>

        {/* Barra de búsqueda */}
        <div className="dirx__search-wrap">
          <span className="dirx__search-icon"><IconSearch /></span>
          <input
            className="dirx__search-input"
            type="text"
            placeholder="Buscar por nombre, sigla, categoría o país…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="dirx__search-clear" onClick={() => setSearchQuery('')} title="Limpiar búsqueda">
              <IconClose />
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="dirx__error">
            <IconWarning />
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => fetchDirectory(false)} className="dirx__error-retry">REINTENTAR</button>
          </div>
        )}

        {/* Table */}
        <div className="dirx__table">
          {/* Table header — grid 12: org(3) + thumb(1) + cat(2) + contact(4) + actions(2) */}
          <div className="dirx__thead">
            <div className="dirx__th--org">Organización</div>
            <div className="dirx__th--thumb">Logo</div>
            <div className="dirx__th--cat">Categoría</div>
            <div className="dirx__th--contact">Información de contacto</div>
            <div className="dirx__th--actions">Seleccionar</div>
          </div>

          {/* Skeleton */}
          {loading && entries.length === 0 && [...Array(5)].map((_, i) => (
            <div key={i} className="dirx__skel-row">
              <div className="dirx__org" style={{ gridColumn: 'span 3' }}>
                <div className="dirx__skel-logo" />
                <div className="dirx__skel-block" style={{ width: 140 }} />
              </div>
              <div className="dirx__skel-block" style={{ gridColumn: 'span 1' }} />
              <div className="dirx__skel-block" style={{ gridColumn: 'span 2' }} />
              <div className="dirx__skel-block" style={{ gridColumn: 'span 4' }} />
              <div className="dirx__skel-block" style={{ gridColumn: 'span 2' }} />
            </div>
          ))}

          {/* Rows */}
          {filtradas.map((entry) => {
            const esFav = favoritos.has(entry.id);
            const accion = entry.url_convocatorias ? 'ACCEDER' : 'SITIO WEB';
            const isSelected = selectedIds.has(entry.id);
            return (
              <div
                key={entry.id}
                className={['dirx__row', isSelected ? 'dirx__row--selected' : ''].filter(Boolean).join(' ')}
              >
                {/* Organización */}
                <div className="dirx__org">
                  <div className="dirx__logo">{getInitials(entry.sigla, entry.nombre)}</div>
                  <div className="dirx__org-info">
                    <h2 className="dirx__name">{entry.nombre}</h2>
                    <div className="dirx__cat-mobile">
                      <span className="dirx__badge dirx__badge--sm">{entry.tipo || 'ENTIDAD'}</span>
                      {(entry.convocatorias_count ?? 0) > 0 && (
                        <span className="dirx__badge dirx__badge--sm dirx__badge--conv">
                          {entry.convocatorias_count} conv.
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Logo miniatura */}
                <div className="dirx__thumb">
                  <LogoThumb entry={entry} />
                </div>

                {/* Categoría */}
                <div className="dirx__cat">
                  <span className="dirx__badge">{entry.tipo || 'ENTIDAD'}</span>
                </div>

                {/* Información de contacto */}
                <div className="dirx__contact">
                  {entry.sitio_web && (
                    <div className="dirx__contact-item">
                      <IconGlobe />
                      <a href={entry.sitio_web} target="_blank" rel="noopener noreferrer">
                        {entry.sitio_web.replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    </div>
                  )}
                  <div className="dirx__contact-item">
                    <IconCall /><span>{entry.telefono || 'No disponible'}</span>
                  </div>
                  {entry.email && (
                    <div className="dirx__contact-item">
                      <IconMail /><span>{entry.email}</span>
                    </div>
                  )}
                  <div className="dirx__contact-item">
                    <IconPin /><span>{entry.pais || '—'}{entry.alcance ? ` / ${entry.alcance}` : ''}</span>
                  </div>
                </div>

                {/* Acciones */}
                <div className="dirx__actions">
                  <button
                    className="dirx__star"
                    onClick={() => toggleFavorito(entry.id)}
                    title={esFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    <IconStar filled={esFav} />
                  </button>
                  <a
                    className="dirx__portal"
                    href={entry.url_convocatorias || entry.sitio_web || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{accion}</span>
                    <IconExternal />
                  </a>
                  {/* Checkbox de selección múltiple */}
                  <label className="dirx__checkbox-wrap" title="Seleccionar para eliminar">
                    <input
                      type="checkbox"
                      className="dirx__checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(entry.id)}
                    />
                  </label>
                </div>
              </div>
            );
          })}

          {/* Vacío */}
          {!loading && entries.length === 0 && !error && (
            <div className="dirx__empty">
              <p className="dirx__empty-title">No hay entidades registradas</p>
              <p className="dirx__empty-sub">Importe un archivo CSV o Excel obtenido directamente de portales oficiales.</p>
              <button onClick={() => navigate('/importar')} className="dirx__empty-btn">IMPORTAR DATOS OFICIALES</button>
            </div>
          )}

          {/* Sin resultados de búsqueda/filtros */}
          {!loading && entries.length > 0 && filtradas.length === 0 && (
            <div className="dirx__empty">
              <p className="dirx__empty-title">Sin resultados</p>
              <p className="dirx__empty-sub">
                {searchQuery
                  ? `No se encontraron entidades que coincidan con "${searchQuery}".`
                  : soloFav
                    ? 'No tienes entidades marcadas como favoritas.'
                    : 'Ninguna entidad coincide con los filtros seleccionados.'}
              </p>
              {(searchQuery || activeFilterCount > 0) && (
                <button
                  className="dirx__empty-btn"
                  onClick={() => { setSearchQuery(''); setSoloFav(false); setFilterTipo(''); setFilterPais(''); setFilterAlcance(''); }}
                >
                  Limpiar búsqueda y filtros
                </button>
              )}
            </div>
          )}
        </div>

      </main>

      {/* Modal de confirmación de eliminación masiva */}
      {showDeleteModal && (
        <div className="dirx__modal-overlay" onClick={() => !bulkDeleting && setShowDeleteModal(false)}>
          <div className="dirx__modal" onClick={e => e.stopPropagation()}>
            <div className="dirx__modal-icon">
              <IconDelete />
            </div>
            <h3 className="dirx__modal-title">Eliminar entidades</h3>
            <p className="dirx__modal-body">
              Vas a eliminar <strong>{selectedIds.size}</strong> entidad{selectedIds.size !== 1 ? 'es' : ''} del directorio.
              Esta acción no se puede deshacer.
            </p>
            <div className="dirx__modal-actions">
              <button
                className="dirx__modal-cancel"
                onClick={() => setShowDeleteModal(false)}
                disabled={bulkDeleting}
              >
                Cancelar
              </button>
              <button
                className="dirx__modal-confirm"
                onClick={deleteBulk}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? <IconSpinner /> : <IconDelete />}
                <span>{bulkDeleting ? 'Eliminando…' : 'Confirmar eliminación'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
