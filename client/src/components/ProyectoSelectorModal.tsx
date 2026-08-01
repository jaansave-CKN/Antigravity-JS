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

const ESTADO_COLOR: Record<string, { bg: string; border: string; color: string }> = {
  Borrador:   { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', color: '#94a3b8' },
  Formulado:  { bg: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.30)',  color: '#38bdf8' },
  Finalizado: { bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.30)',   color: '#22c55e' },
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
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0b1326', border: '1px solid rgba(56,189,248,0.30)', borderRadius: 16,
          width: 720, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #1a3a50' }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#c8d8e8', margin: 0, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>
              MIS PROYECTOS
            </h2>
            <p style={{ fontSize: 11, color: '#557997', margin: '3px 0 0' }}>Selecciona un proyecto activo para el Formulador.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#557997', lineHeight: 1, padding: 4 }}>
            ×
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 22px', fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)' }} role="alert">{error}</div>
        )}

        {/* Lista (Abrir / Ver listado) */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, alignContent: 'start' }}>
          {cargando ? (
            <p style={{ fontSize: 12.5, color: '#557997', gridColumn: '1 / -1' }}>Cargando proyectos…</p>
          ) : proyectos.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#557997', fontStyle: 'italic', gridColumn: '1 / -1' }}>Aún no tienes proyectos — crea el primero abajo.</p>
          ) : (
            proyectos.map(p => {
              const isActivo = p.id === activoId;
              const badge = ESTADO_COLOR[p.estado] ?? ESTADO_COLOR.Borrador;
              return (
                <button
                  key={p.id}
                  onClick={() => abrir(p)}
                  style={{
                    textAlign: 'left', padding: 14, borderRadius: 10, cursor: 'pointer',
                    background: isActivo ? 'rgba(56,189,248,0.08)' : '#0f1b30',
                    border: isActivo ? '1px solid rgba(56,189,248,0.5)' : '1px solid #1a3a50',
                    transition: 'border-color 0.15s, background 0.15s',
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
                      background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color,
                      fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {p.estado}
                    </span>
                    {isActivo && (
                      <span style={{ fontSize: 9, color: '#38bdf8', fontFamily: "'JetBrains Mono', monospace" }}>● ACTIVO</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#c8d8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.nombre}
                  </div>
                  <div style={{ fontSize: 10.5, color: '#557997', fontFamily: "'JetBrains Mono', monospace" }}>
                    Modificado {fmtFecha(p.updated_at)}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Acciones: Nuevo proyecto */}
        <div style={{ borderTop: '1px solid #1a3a50', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={nombreNuevo}
              onChange={e => setNombreNuevo(e.target.value)}
              placeholder="Nombre del nuevo proyecto"
              onKeyDown={e => e.key === 'Enter' && crearNuevo()}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #1a3a50',
                background: '#0b1326', color: '#c8d8e8', fontSize: 12.5, outline: 'none',
              }}
            />
            <button
              onClick={crearNuevo}
              disabled={!nombreNuevo.trim() || creando}
              style={{
                padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.35)',
                background: '#172133', color: '#38bdf8',
                fontSize: 12, fontWeight: 700, cursor: nombreNuevo.trim() ? 'pointer' : 'not-allowed',
                opacity: nombreNuevo.trim() ? 1 : 0.5, whiteSpace: 'nowrap',
                fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em',
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
