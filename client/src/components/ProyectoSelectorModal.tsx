import { useEffect, useState, useRef } from 'react';
import { getAuthHeaders } from '../lib/apiClient';
import { C } from '../pages/DashboardFormuladorPage';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';
const ACTIVE_PROJECT_NAME_KEY = 'rf360_proyecto_nombre';

interface ProyectoRow {
  id: string;
  nombre: string;
  // "Nombre del Proyecto" (nombre, largo/descriptivo, se edita en Entrada
  // M1) vs "Nombre del Archivo" (nombre_archivo, identificador corto, se
  // edita SOLO desde este modal — mandato 2026-08-24). null en proyectos
  // creados antes de la migración 047 hasta que corra el backfill.
  nombre_archivo: string | null;
  estado: string;
  bloqueo_razon: string | null;
  created_at: string;
  updated_at: string;
}

const ESTADO_COLOR: Record<string, { bg: string; border: string; color: string }> = {
  Borrador:   { bg: 'rgba(100,116,139,0.10)', border: 'rgba(100,116,139,0.30)', color: '#475569' },
  Formulado:  { bg: 'rgba(37,99,235,0.10)',   border: 'rgba(37,99,235,0.30)',   color: '#2563eb' },
  Finalizado: { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.35)',   color: '#15803d' },
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
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): el guard `if (creando) return` leía estado de React, que no
  // se actualiza sincrónicamente entre 2 invocaciones en el mismo tick (antes
  // del primer re-render) — un ref sí protege contra eso.
  const creandoRef = useRef(false);

  // ── Renombrar ────────────────────────────────────────────────────────────
  const [editandoId, setEditandoId]       = useState<string | null>(null);
  const [nombreEdit, setNombreEdit]       = useState('');
  const [guardandoNombre, setGuardandoNombre] = useState(false);

  // ── Borrar (requiere contraseña real de la cuenta) ──────────────────────
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [pwdBorrar, setPwdBorrar]   = useState('');
  const [borrando, setBorrando]     = useState(false);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);

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
    localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, p.nombre_archivo || p.nombre);
    notificarCambioProyecto();
    onClose();
  };

  const crearNuevo = async () => {
    const nombreArchivo = nombreNuevo.trim();
    if (!nombreArchivo || creandoRef.current) return;
    creandoRef.current = true;
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/proyectos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ nombreArchivo }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo crear el proyecto.');
      localStorage.setItem(ACTIVE_PROJECT_KEY, body.id);
      localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, body.nombreArchivo || nombreArchivo);
      notificarCambioProyecto();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al crear el proyecto.');
    } finally {
      creandoRef.current = false;
      setCreando(false);
    }
  };

  const iniciarEdicion = (p: ProyectoRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setBorrandoId(null);
    setEditandoId(p.id);
    setNombreEdit(p.nombre_archivo || p.nombre);
  };

  const cancelarEdicion = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditandoId(null);
  };

  const guardarNombre = async (id: string, e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const nombreArchivo = nombreEdit.trim();
    if (!nombreArchivo || guardandoNombre) return;
    setGuardandoNombre(true);
    setError(null);
    try {
      const res = await fetch(`/api/proyectos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ nombreArchivo }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo renombrar el proyecto.');
      setProyectos(prev => prev.map(p => (p.id === id ? { ...p, nombre_archivo: nombreArchivo } : p)));
      if (id === activoId) localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, nombreArchivo);
      setEditandoId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al renombrar el proyecto.');
    } finally {
      setGuardandoNombre(false);
    }
  };

  const iniciarBorrado = (p: ProyectoRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditandoId(null);
    setBorrandoId(p.id);
    setPwdBorrar('');
    setErrorBorrar(null);
  };

  const cancelarBorrado = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBorrandoId(null);
    setPwdBorrar('');
    setErrorBorrar(null);
  };

  const confirmarBorrado = async (id: string, e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!pwdBorrar || borrando) return;
    setBorrando(true);
    setErrorBorrar(null);
    try {
      const res = await fetch(`/api/proyectos/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ password: pwdBorrar }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo eliminar el proyecto.');
      setProyectos(prev => prev.filter(p => p.id !== id));
      if (id === activoId) {
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
        localStorage.removeItem(ACTIVE_PROJECT_NAME_KEY);
        setActivoId(null);
        notificarCambioProyecto();
      }
      setBorrandoId(null);
      setPwdBorrar('');
    } catch (e) {
      setErrorBorrar(e instanceof Error ? e.message : 'Error al eliminar el proyecto.');
    } finally {
      setBorrando(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16,
          width: 720, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>
              MIS PROYECTOS
            </h2>
            <p style={{ fontSize: 11, color: C.textMuted, margin: '3px 0 0' }}>Selecciona un proyecto activo para el Formulador.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: C.textMuted, lineHeight: 1, padding: 4 }}>
            ×
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 22px', fontSize: 12, color: '#b91c1c', background: '#fef2f2' }} role="alert">{error}</div>
        )}

        {/* Lista (Abrir / Ver listado) */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, alignContent: 'start' }}>
          {cargando ? (
            <p style={{ fontSize: 12.5, color: C.textMuted, gridColumn: '1 / -1' }}>Cargando proyectos…</p>
          ) : proyectos.length === 0 ? (
            <p style={{ fontSize: 12.5, color: C.textMuted, fontStyle: 'italic', gridColumn: '1 / -1' }}>Aún no tienes proyectos — crea el primero abajo.</p>
          ) : (
            proyectos.map(p => {
              const isActivo = p.id === activoId;
              const badge = ESTADO_COLOR[p.estado] ?? ESTADO_COLOR.Borrador;
              const editando = editandoId === p.id;
              const confirmandoBorrado = borrandoId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => !editando && !confirmandoBorrado && abrir(p)}
                  title={p.nombre}
                  style={{
                    textAlign: 'left', padding: 14, borderRadius: 10,
                    cursor: editando || confirmandoBorrado ? 'default' : 'pointer',
                    background: isActivo ? 'rgba(37,99,235,0.06)' : C.bgCard,
                    border: isActivo ? `1px solid ${C.cyan}` : `1px solid ${C.border}`,
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {isActivo && !editando && !confirmandoBorrado && (
                        <span style={{ fontSize: 9, color: C.cyan, fontFamily: "'JetBrains Mono', monospace" }}>● ACTIVO</span>
                      )}
                      {!editando && !confirmandoBorrado && (
                        <>
                          <button
                            onClick={e => iniciarEdicion(p, e)}
                            title="Editar nombre"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: C.textMuted, fontSize: 12, lineHeight: 1 }}
                          >
                            ✎
                          </button>
                          <button
                            onClick={e => iniciarBorrado(p, e)}
                            title="Eliminar proyecto"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#dc2626', fontSize: 12, lineHeight: 1 }}
                          >
                            🗑
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {editando ? (
                    <form onSubmit={e => guardarNombre(p.id, e)} onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6 }}>
                      <input
                        autoFocus
                        aria-label="Nuevo nombre del proyecto"
                        value={nombreEdit}
                        onChange={e => setNombreEdit(e.target.value)}
                        style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, fontSize: 12.5, outline: 'none' }}
                      />
                      <button type="submit" disabled={!nombreEdit.trim() || guardandoNombre} style={{ padding: '6px 10px', borderRadius: 6, border: 'none', background: C.cyan, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: nombreEdit.trim() ? 1 : 0.5 }}>
                        {guardandoNombre ? '…' : 'OK'}
                      </button>
                      <button type="button" onClick={cancelarEdicion} style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'none', color: C.textMuted, fontSize: 11, cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.nombre_archivo || p.nombre}
                    </div>
                  )}

                  <div style={{ fontSize: 10.5, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                    Modificado {fmtFecha(p.updated_at)}
                  </div>

                  {confirmandoBorrado && (
                    <form onSubmit={e => confirmarBorrado(p.id, e)} onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 10.5, color: '#b91c1c', fontWeight: 600 }}>
                        Esta acción no se puede deshacer. Ingresa tu contraseña para confirmar.
                      </span>
                      <input
                        autoFocus
                        type="password"
                        value={pwdBorrar}
                        onChange={e => setPwdBorrar(e.target.value)}
                        placeholder="Tu contraseña"
                        aria-label="Contraseña para confirmar eliminación"
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: C.bgCard, color: C.text, fontSize: 12.5, outline: 'none' }}
                      />
                      {errorBorrar && <span style={{ fontSize: 10.5, color: '#b91c1c' }}>{errorBorrar}</span>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="submit" disabled={!pwdBorrar || borrando} style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: pwdBorrar ? 1 : 0.5 }}>
                          {borrando ? 'Eliminando…' : 'Eliminar definitivamente'}
                        </button>
                        <button type="button" onClick={cancelarBorrado} style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'none', color: C.textMuted, fontSize: 11, cursor: 'pointer' }}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Acciones: Nuevo proyecto */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={nombreNuevo}
              onChange={e => setNombreNuevo(e.target.value)}
              placeholder="Nombre del archivo (identificador corto)"
              aria-label="Nombre del nuevo archivo"
              onKeyDown={e => e.key === 'Enter' && crearNuevo()}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: C.bgCard, color: C.text, fontSize: 12.5, outline: 'none',
              }}
            />
            <button
              onClick={crearNuevo}
              disabled={!nombreNuevo.trim() || creando}
              style={{
                padding: '9px 16px', borderRadius: 8, border: 'none',
                background: C.cyan, color: '#fff',
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
