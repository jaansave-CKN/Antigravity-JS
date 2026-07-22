import { useEffect, useState } from 'react';
import { getAuthHeaders } from '../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';
const ACTIVE_PROJECT_NAME_KEY = 'rf360_proyecto_nombre';

interface ProyectoRow {
  id: string;
  nombre: string;
  estado: string;
  bloqueo_razon: string | null;
  created_at: string;
  updated_at: string;
}

const ESTADO_COLOR: Record<string, { bg: string; color: string }> = {
  Borrador:   { bg: '#f3f4f6', color: '#6b7280' },
  Formulado:  { bg: '#dbeafe', color: '#1d4ed8' },
  Finalizado: { bg: '#dcfce7', color: '#15803d' },
};

function fmtFecha(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function notificarCambioProyecto() {
  window.dispatchEvent(new StorageEvent('storage', { key: ACTIVE_PROJECT_KEY }));
}

export default function ProyectoSelectorModal({ onClose }: { onClose: () => void }) {
  const [proyectos, setProyectos] = useState<ProyectoRow[]>([]);
  const [cargando, setCargando]   = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [activoId, setActivoId]   = useState(() => localStorage.getItem(ACTIVE_PROJECT_KEY));

  const [nombreNuevo, setNombreNuevo] = useState('');
  const [creando, setCreando]         = useState(false);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch('/api/proyectos', { headers: { ...getAuthHeaders() }, credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo cargar la lista de proyectos.');
      setProyectos(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido al cargar proyectos.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const abrir = (p: ProyectoRow) => {
    localStorage.setItem(ACTIVE_PROJECT_KEY, p.id);
    localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, p.nombre);
    notificarCambioProyecto();
    onClose();
  };

  const crearNuevo = async () => {
    const nombre = nombreNuevo.trim();
    if (!nombre || creando) return;
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/proyectos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ nombre }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo crear el proyecto.');
      localStorage.setItem(ACTIVE_PROJECT_KEY, body.id);
      localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, nombre);
      notificarCambioProyecto();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al crear el proyecto.');
    } finally {
      setCreando(false);
    }
  };


  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#ffffff', borderRadius: 12, width: 480, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: 0 }}>Mis Proyectos</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', lineHeight: 1, padding: 4 }}>
            ×
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 20px', fontSize: 12, color: '#ba1a1a', background: '#fef2f2' }} role="alert">{error}</div>
        )}

        {/* Lista (Abrir / Ver listado) */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {cargando ? (
            <p style={{ padding: '16px 20px', fontSize: 12.5, color: '#6b7280' }}>Cargando proyectos…</p>
          ) : proyectos.length === 0 ? (
            <p style={{ padding: '16px 20px', fontSize: 12.5, color: '#6b7280', fontStyle: 'italic' }}>Aún no tienes proyectos — crea el primero abajo.</p>
          ) : (
            proyectos.map(p => {
              const isActivo = p.id === activoId;
              const badge = ESTADO_COLOR[p.estado] ?? ESTADO_COLOR.Borrador;
              return (
                <button
                  key={p.id}
                  onClick={() => abrir(p)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                    padding: '10px 20px', background: isActivo ? '#eff6ff' : 'transparent', border: 'none',
                    borderLeft: isActivo ? '3px solid #2563eb' : '3px solid transparent', cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.nombre}{isActivo ? ' (activo)' : ''}
                    </div>
                    <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>Modificado {fmtFecha(p.updated_at)}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: badge.bg, color: badge.color, flexShrink: 0 }}>
                    {p.estado}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Acciones: Nuevo proyecto */}
        <div style={{ borderTop: '1px solid #e5e7eb', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={nombreNuevo}
              onChange={e => setNombreNuevo(e.target.value)}
              placeholder="Nombre del nuevo proyecto"
              onKeyDown={e => e.key === 'Enter' && crearNuevo()}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12.5 }}
            />
            <button
              onClick={crearNuevo}
              disabled={!nombreNuevo.trim() || creando}
              style={{
                padding: '8px 14px', borderRadius: 6, border: 'none', background: '#111827', color: '#fff',
                fontSize: 12, fontWeight: 700, cursor: nombreNuevo.trim() ? 'pointer' : 'not-allowed',
                opacity: nombreNuevo.trim() ? 1 : 0.5, whiteSpace: 'nowrap',
              }}
            >
              {creando ? 'Creando…' : '+ Nuevo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
