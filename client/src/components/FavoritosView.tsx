import { useState } from 'react';
import {
  Star, Clock, CheckSquare, Square, Plus,
  AlertTriangle, Trash2, ChevronDown, ChevronUp, Loader2, XCircle,
} from 'lucide-react';
import { useFavoritos } from '../contexts/FavoritosContext';
import './FavoritosView.css';

interface Tarea {
  id: string;
  texto: string;
  completada: boolean;
}

interface TareasConv {
  [convId: string]: Tarea[];
}

export default function FavoritosView() {
  const { favoritos, cargando, eliminarFavorito } = useFavoritos();

  const [tareas, setTareas] = useState<TareasConv>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nuevaTarea, setNuevaTarea] = useState<Record<string, string>>({});
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorElim, setErrorElim] = useState<Record<string, string>>({});

  const toggleTarea = (convId: string, tareaId: string) => {
    setTareas(prev => ({
      ...prev,
      [convId]: (prev[convId] || []).map(t =>
        t.id === tareaId ? { ...t, completada: !t.completada } : t
      ),
    }));
  };

  const agregarTarea = (convId: string) => {
    const texto = nuevaTarea[convId]?.trim();
    if (!texto) return;
    setTareas(prev => ({
      ...prev,
      [convId]: [...(prev[convId] || []), { id: `t-${Date.now()}`, texto, completada: false }],
    }));
    setNuevaTarea(prev => ({ ...prev, [convId]: '' }));
  };

  const eliminarTarea = (convId: string, tareaId: string) => {
    setTareas(prev => ({
      ...prev,
      [convId]: (prev[convId] || []).filter(t => t.id !== tareaId),
    }));
  };

  const handleQuitarFavorito = async (favoritoId: string, grantId: string) => {
    setEliminando(grantId);
    setErrorElim(prev => ({ ...prev, [grantId]: '' }));
    try {
      await eliminarFavorito(favoritoId);
    } catch (err: any) {
      setErrorElim(prev => ({
        ...prev,
        [grantId]: err?.message || 'Error al quitar favorito. Intenta nuevamente.',
      }));
    } finally {
      setEliminando(null);
    }
  };

  if (cargando) {
    return (
      <div className="favoritos__empty animate-fade-in">
        <Loader2 size={32} className="favoritos__empty-icon" style={{ animation: 'spin 1s linear infinite' }} />
        <p>Cargando tus convocatorias guardadas…</p>
      </div>
    );
  }

  if (favoritos.length === 0) {
    return (
      <div className="favoritos__empty animate-fade-in">
        <Star size={48} className="favoritos__empty-icon" />
        <h3>No hay convocatorias guardadas</h3>
        <p>Marca convocatorias con ★ desde el Radar para crear tu workflow de postulación.</p>
      </div>
    );
  }

  const totalTareas = Object.values(tareas).flat();
  const pendientes = totalTareas.filter(t => !t.completada).length;
  const completadas = totalTareas.filter(t => t.completada).length;

  return (
    <div className="favoritos animate-fade-in">
      <div className="favoritos__summary">
        <div className="favoritos__summary-stat">
          <span className="favoritos__summary-value mono">{favoritos.length}</span>
          <span className="favoritos__summary-label">Convocatorias guardadas</span>
        </div>
        <div className="favoritos__summary-stat">
          <span className="favoritos__summary-value mono">{pendientes}</span>
          <span className="favoritos__summary-label">Tareas pendientes</span>
        </div>
        <div className="favoritos__summary-stat">
          <span className="favoritos__summary-value mono">{completadas}</span>
          <span className="favoritos__summary-label">Tareas completadas</span>
        </div>
      </div>

      <div className="favoritos__list">
        {favoritos.map(fav => {
          const conv = fav.grant_data;
          const convId = fav.grant_id;
          const convTareas = tareas[convId] || [];
          const done = convTareas.filter(t => t.completada).length;
          const progreso = convTareas.length > 0 ? Math.round((done / convTareas.length) * 100) : 0;
          const isExpanded = expandedId === convId;

          const fechaCierre = conv.fecha_cierre || conv.fechaCierre || conv.fecha_limite || '';
          const diasRestantes = fechaCierre
            ? Math.ceil((new Date(fechaCierre).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : null;

          const titulo = conv.titulo || 'Sin título';
          const donante = conv.donante || conv.fuente || '';
          const estado = conv.estado || 'abierta';
          const estaEliminando = eliminando === convId;
          const errMsg = errorElim[convId];

          return (
            <div key={fav.id} className="favorito-card">
              <div
                className="favorito-card__header"
                onClick={() => setExpandedId(isExpanded ? null : convId)}
              >
                <div className="favorito-card__left">
                  <span className={`favorito-card__estado favorito-card__estado--${estado}`}>
                    {estado === 'abierta' ? 'Abierta' : estado === 'nueva' ? 'Nueva' : estado === 'proxima' ? 'Próxima' : 'Cerrada'}
                  </span>
                  <h3 className="favorito-card__title">{titulo}</h3>
                  <div className="favorito-card__meta">
                    <span>{donante}</span>
                    {fav.saved_at && (
                      <>
                        <span>·</span>
                        <span style={{ fontSize: '11px', opacity: 0.6 }}>
                          Guardado {new Date(fav.saved_at).toLocaleDateString('es-CO')}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="favorito-card__right">
                  {diasRestantes !== null && (
                    <div
                      className="favorito-card__deadline"
                      style={{
                        color: diasRestantes < 30
                          ? 'var(--danger)'
                          : diasRestantes < 60
                            ? 'var(--warning)'
                            : 'var(--text-secondary)',
                      }}
                    >
                      {diasRestantes > 0 ? (
                        <><Clock size={14} /><span className="mono">{diasRestantes}d</span></>
                      ) : (
                        <span>Cerrada</span>
                      )}
                    </div>
                  )}
                  <div className="favorito-card__progress">
                    <div className="favorito-card__progress-bar">
                      <div
                        className="favorito-card__progress-fill"
                        style={{
                          width: `${progreso}%`,
                          background: progreso === 100 ? 'var(--success)' : 'var(--primary)',
                        }}
                      />
                    </div>
                    <span className="favorito-card__progress-text mono">{progreso}%</span>
                  </div>
                  <button className="favorito-card__toggle">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="favorito-card__body animate-fade-in">
                  {/* Lista de tareas */}
                  <div className="favorito-card__tasks">
                    <div className="favorito-card__tasks-header">
                      <span>Tareas ({done}/{convTareas.length})</span>
                    </div>
                    {convTareas.map(tarea => (
                      <div
                        key={tarea.id}
                        className={`favorito-task ${tarea.completada ? 'favorito-task--done' : ''}`}
                      >
                        <button className="favorito-task__check" onClick={() => toggleTarea(convId, tarea.id)}>
                          {tarea.completada ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        <span className="favorito-task__text">{tarea.texto}</span>
                        <button
                          className="favorito-task__delete"
                          onClick={() => eliminarTarea(convId, tarea.id)}
                          title="Eliminar tarea"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <div className="favorito-card__add-task">
                      <input
                        type="text"
                        placeholder="Nueva tarea…"
                        value={nuevaTarea[convId] || ''}
                        onChange={e => setNuevaTarea(prev => ({ ...prev, [convId]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && agregarTarea(convId)}
                      />
                      <button onClick={() => agregarTarea(convId)} className="favorito-card__add-btn">
                        <Plus size={14} /> Agregar
                      </button>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="favorito-card__actions">
                    {diasRestantes !== null && diasRestantes > 0 && diasRestantes < 30 && (
                      <div className="favorito-card__warning">
                        <AlertTriangle size={14} />
                        <span>¡Cierre en menos de 30 días!</span>
                      </div>
                    )}

                    {errMsg && (
                      <div className="favorito-card__warning" style={{ color: 'var(--danger)' }}>
                        <XCircle size={14} />
                        <span>{errMsg}</span>
                      </div>
                    )}

                    <button
                      className="favorito-card__remove"
                      onClick={() => handleQuitarFavorito(fav.id, convId)}
                      disabled={estaEliminando}
                    >
                      {estaEliminando
                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Star size={14} fill="currentColor" />}
                      {estaEliminando ? 'Quitando…' : 'Quitar de favoritos'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
