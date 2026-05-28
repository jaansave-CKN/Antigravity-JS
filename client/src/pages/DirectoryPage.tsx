import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

const STORAGE_KEY = 'radar_directory_entries';

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
  status: 'active' | 'disabled';
}

type RowOp = 'deleting' | 'toggling';

// ── Persistencia localStorage ─────────────────────────────────────────────────
function loadStored(): DirectoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DirectoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveStored(entries: DirectoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

// ── Fetch seguro — valida JSON antes de parsear ───────────────────────────────
async function safeJsonFetch(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    throw new Error(`Error de conexión con el repositorio (el servidor devolvió HTML en lugar de JSON — ruta ${url})`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Error de conexión con el repositorio (respuesta no es JSON válido)`);
  }

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
  for (const entry of incoming) {
    if (!map.has(entry.id)) map.set(entry.id, entry);
  }
  return Array.from(map.values());
}

function normalizeApiEntry(raw: any): DirectoryEntry {
  return {
    id:                String(raw.id ?? Math.random()),
    nombre:            raw.nombre ?? '',
    sigla:             raw.sigla ?? '',
    tipo:              raw.tipo ?? 'ENTIDAD',
    pais:              raw.pais ?? '',
    sitio_web:         raw.sitio_web ?? '',
    url_convocatorias: raw.url_convocatorias ?? '',
    telefono:          raw.telefono ?? '',
    email:             raw.email ?? '',
    alcance:           raw.alcance ?? '',
    validation_status: raw.validation_status ?? 'IMPORTADO',
    fuente:            raw.fuente ?? '',
    status:            raw.status === 'disabled' ? 'disabled' : 'active',
  };
}

// ── Sub-componentes ───────────────────────────────────────────────────────────
function ValidationBadge({ status }: { status: string }) {
  const verified = status === 'VERIFICADO';
  const pending  = status.includes('PENDIENTE');
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[rgba(5,150,105,0.1)] text-[#065f46] border border-[rgba(5,150,105,0.2)]">
        <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
        VERIFICADO
      </span>
    );
  }
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
        VALIDACIÓN PENDIENTE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#eceef0] text-[#76777d] border border-[#e2e8f0]">
      IMPORTADO
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col border border-outline-variant rounded bg-surface-container-lowest p-md gap-sm animate-pulse">
      <div className="flex items-center gap-md pr-16">
        <div className="w-12 h-12 rounded bg-surface-container shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-surface-container rounded w-3/4" />
          <div className="h-3 bg-surface-container rounded w-1/3" />
        </div>
      </div>
      <div className="space-y-2 mt-sm">
        {[...Array(4)].map((_, i) => <div key={i} className="h-3 bg-surface-container rounded w-full" />)}
      </div>
      <div className="mt-auto pt-sm">
        <div className="h-9 bg-surface-container rounded w-full" />
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function DirectoryPage() {
  const { token }   = useAuth();
  const navigate    = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries]       = useState<DirectoryEntry[]>(() => loadStored());
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [rowOps, setRowOps]         = useState<Record<string, RowOp>>({});

  // ── Utilidad para actualizar estado + storage ──────────────────────────────
  function commit(next: DirectoryEntry[]) {
    setEntries(next);
    saveStored(next);
  }

  // ── Carga inicial: localStorage ya está en estado; luego intenta API ────────
  useEffect(() => {
    fetchDirectory(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchDirectory(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const { ok, data } = await safeJsonFetch('/api/directory', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!ok) throw new Error(data?.message ?? 'Error al cargar directorio.');

      const incoming: DirectoryEntry[] = (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])
        .map(normalizeApiEntry);

      // Merge: preserva entidades ya guardadas (no sobreescribe status del usuario)
      setEntries(prev => {
        const merged = mergeEntries(prev, incoming);
        saveStored(merged);
        return merged;
      });
    } catch (e: any) {
      console.error('[DirectoryPage] fetch error:', e);
      setError(e.message ?? 'Error de conexión con el repositorio');
      // No borramos lo que ya había en storage — la vista sigue mostrando datos locales
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // ── Acciones de fila ───────────────────────────────────────────────────────
  async function deleteEntity(id: string) {
    setRowOps(prev => ({ ...prev, [id]: 'deleting' }));
    try {
      // Intenta borrar en backend si está disponible; si falla, solo borra localmente
      await safeJsonFetch(`/api/directory/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {/* silencioso — continúa con borrado local */});

      commit(entries.filter(e => e.id !== id));
    } finally {
      setRowOps(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  async function toggleStatus(id: string) {
    setRowOps(prev => ({ ...prev, [id]: 'toggling' }));
    try {
      const entry = entries.find(e => e.id === id);
      if (!entry) return;
      const nextStatus: 'active' | 'disabled' = entry.status === 'active' ? 'disabled' : 'active';

      await safeJsonFetch(`/api/directory/${id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      }).catch(() => {/* silencioso */});

      commit(entries.map(e => e.id === id ? { ...e, status: nextStatus } : e));
    } finally {
      setRowOps(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  // ── Importar archivo (trigger manual) ─────────────────────────────────────
  function handleImportClick() {
    navigate('/importar');
  }

  const visibleEntries = entries.filter(e => e.status !== 'disabled');
  const disabledCount  = entries.length - visibleEntries.length;

  return (
    <div className="flex flex-1 max-w-container-max mx-auto w-full">
      <main className="flex-1 p-lg md:p-xl bg-surface-container-low min-h-full">

        {/* Encabezado */}
        <div className="flex items-center justify-between mb-lg">
          <div>
            <h1 className="text-headline-md font-headline-md text-on-surface">Directorio Global de Cooperantes</h1>
            <p className="text-label-md font-label-md text-on-surface-variant mt-xs uppercase tracking-wider">
              {loading
                ? 'Cargando…'
                : `${visibleEntries.length} entidades activas${disabledCount > 0 ? ` · ${disabledCount} deshabilitadas` : ''} · Datos verificados`}
            </p>
          </div>
          <div className="flex items-center gap-sm">
            <button
              onClick={handleImportClick}
              className="h-9 px-md flex items-center gap-xs bg-secondary text-on-secondary rounded text-label-sm font-label-sm uppercase tracking-wider hover:bg-secondary-container transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">upload_file</span>
              IMPORTAR DATOS
            </button>
            <button
              onClick={() => fetchDirectory(true)}
              disabled={refreshing || loading}
              title="Actualizar desde fuentes oficiales"
              className="h-9 w-9 flex items-center justify-center border border-outline-variant rounded bg-surface-container-lowest hover:border-secondary text-on-surface-variant hover:text-secondary transition-colors disabled:opacity-40"
            >
              <span className={`material-symbols-outlined text-[18px] ${refreshing ? 'animate-spin' : ''}`}>
                refresh
              </span>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-lg px-md py-3 rounded bg-[#fff4f4] border border-error text-error text-body-sm font-mono flex items-center gap-sm">
            <span className="material-symbols-outlined text-[18px] shrink-0">warning</span>
            <span className="flex-1">{error}</span>
            <button
              onClick={() => fetchDirectory(false)}
              className="ml-auto text-label-sm underline shrink-0"
            >
              REINTENTAR
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 gap-lg md:grid-cols-3">

          {/* Skeleton */}
          {loading && entries.length === 0 && [...Array(6)].map((_, i) => <SkeletonCard key={i} />)}

          {/* Cards activas */}
          {visibleEntries.map((entry, idx) => {
            const op = rowOps[entry.id];
            return (
              <div
                key={entry.id}
                className={`relative flex flex-col border border-outline-variant rounded bg-surface-container-lowest shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-md gap-sm hover:border-secondary transition-colors group ${op ? 'opacity-60 pointer-events-none' : ''}`}
              >
                {/* Badge + controles de fila */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  <span className="text-label-sm font-label-sm text-on-surface-variant">#{idx + 1}</span>
                  <ValidationBadge status={entry.validation_status} />

                  {/* Toggle disable */}
                  <button
                    onClick={() => toggleStatus(entry.id)}
                    disabled={!!op}
                    title="Deshabilitar entidad"
                    className="ml-1 w-6 h-6 flex items-center justify-center rounded text-on-surface-variant hover:text-amber-600 hover:bg-amber-50 transition-colors"
                  >
                    {op === 'toggling'
                      ? <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                      : <span className="material-symbols-outlined text-[14px]">visibility_off</span>
                    }
                  </button>

                  {/* Eliminar */}
                  <button
                    onClick={() => deleteEntity(entry.id)}
                    disabled={!!op}
                    title="Eliminar entidad"
                    className="w-6 h-6 flex items-center justify-center rounded text-on-surface-variant hover:text-error hover:bg-[#fff4f4] transition-colors"
                  >
                    {op === 'deleting'
                      ? <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                      : <span className="material-symbols-outlined text-[14px]">delete</span>
                    }
                  </button>
                </div>

                {/* Header: logo + nombre */}
                <div className="flex items-center gap-md pr-28">
                  <div className="w-12 h-12 rounded bg-secondary-fixed/10 border border-secondary flex items-center justify-center overflow-hidden shrink-0">
                    <span className="text-secondary font-headline-md font-bold">
                      {getInitials(entry.sigla, entry.nombre)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-body-lg font-body-md font-bold text-primary group-hover:text-secondary transition-colors truncate">
                      {entry.nombre}
                    </h3>
                    <span className="text-label-sm font-label-sm bg-surface-container border border-outline-variant text-on-surface-variant px-2 py-[2px] rounded-full inline-block mt-xs">
                      {entry.tipo || 'ENTIDAD'}
                    </span>
                  </div>
                </div>

                {/* Datos */}
                <div className="flex flex-col gap-xs text-body-sm text-on-surface-variant mt-sm">
                  {entry.sitio_web && (
                    <a
                      className="text-label-sm font-label-sm text-secondary hover:underline w-fit truncate"
                      href={entry.sitio_web}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {entry.sitio_web.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  )}
                  {entry.telefono && (
                    <div className="flex items-center gap-xs text-[12px]">
                      <span className="material-symbols-outlined text-[14px]">call</span>
                      {entry.telefono}
                    </div>
                  )}
                  {entry.email && (
                    <div className="flex items-center gap-xs text-[12px]">
                      <span className="material-symbols-outlined text-[14px]">mail</span>
                      {entry.email}
                    </div>
                  )}
                  <div className="flex items-center gap-xs font-label-sm text-label-sm">
                    <span className="material-symbols-outlined text-[14px]">
                      {entry.alcance === 'Nacional' ? 'location_on' : 'public'}
                    </span>
                    {entry.pais} · {entry.alcance}
                  </div>
                </div>

                {/* Acción */}
                <div className="mt-auto pt-sm">
                  <a
                    href={entry.url_convocatorias || entry.sitio_web || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-secondary text-on-secondary hover:bg-secondary-container px-md rounded text-label-sm font-label-sm transition-colors border border-transparent h-9 flex items-center justify-center whitespace-nowrap"
                  >
                    Acceder al Portal
                  </a>
                </div>
              </div>
            );
          })}

          {/* Estado vacío */}
          {!loading && entries.length === 0 && !error && (
            <div className="col-span-3 flex flex-col items-center justify-center py-16 text-center gap-md">
              <span className="material-symbols-outlined text-[48px] text-outline-variant">folder_open</span>
              <div>
                <p className="text-body-lg font-body-md font-bold text-on-surface">No hay entidades registradas</p>
                <p className="text-body-sm text-on-surface-variant mt-xs">
                  Importe un archivo CSV o Excel obtenido directamente de portales oficiales.
                </p>
              </div>
              <button
                onClick={() => navigate('/importar')}
                className="mt-sm bg-secondary text-on-secondary px-lg py-2.5 rounded text-label-sm font-label-sm uppercase tracking-wider hover:bg-secondary-container transition-colors"
              >
                IMPORTAR DATOS OFICIALES
              </button>
            </div>
          )}

          {/* Card: deshabilitadas (resumen) */}
          {!loading && disabledCount > 0 && (
            <div className="col-span-3 flex items-center gap-sm px-md py-3 rounded border border-dashed border-outline-variant bg-surface-container-lowest text-[12px] font-mono text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px]">visibility_off</span>
              {disabledCount} entidad{disabledCount !== 1 ? 'es' : ''} deshabilitada{disabledCount !== 1 ? 's' : ''}.
              <button
                onClick={() => commit(entries.map(e => ({ ...e, status: 'active' })))}
                className="ml-auto underline text-secondary"
              >
                Mostrar todas
              </button>
            </div>
          )}

          {/* Card: Agregar Nuevo */}
          {!loading && entries.length > 0 && (
            <div
              onClick={handleImportClick}
              className="relative flex flex-col items-center justify-center border border-dashed border-outline-variant rounded bg-surface-container-lowest shadow-sm p-md gap-sm hover:border-secondary hover:bg-surface-container transition-all cursor-pointer group min-h-[220px]"
            >
              <div className="flex flex-col items-center gap-md">
                <div className="w-12 h-12 rounded bg-secondary-fixed/10 border border-outline-variant flex items-center justify-center overflow-hidden shrink-0 group-hover:border-secondary transition-colors">
                  <span className="material-symbols-outlined text-secondary text-[32px]">add</span>
                </div>
                <div className="text-center">
                  <h3 className="text-body-lg font-body-md font-bold text-primary group-hover:text-secondary transition-colors">Agregar Datos</h3>
                  <p className="text-label-sm font-label-sm text-on-surface-variant mt-xs">Importación CSV / Excel</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input oculto para importación directa opcional */}
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" />
      </main>
    </div>
  );
}
