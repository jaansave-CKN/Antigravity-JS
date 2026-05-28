import { useState } from 'react';
import {
  Star, Calendar, Clock, CheckSquare, Square, Plus,
  AlertTriangle, Trash2, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { Convocatoria } from '../types';
import { sectorColors, fuenteLogos } from '../data/mockData';
import './FavoritosView.css';

interface FavoritosViewProps {
  convocatorias: Convocatoria[];
  onToggleFavorito: (id: string) => void;
}

interface Tarea {
  id: string;
  texto: string;
  completada: boolean;
}

interface TareasConv {
  [convId: string]: Tarea[];
}

const tareasIniciales: TareasConv = {};

export default function FavoritosView({ convocatorias, onToggleFavorito }: FavoritosViewProps) {
  const favoritos = convocatorias.filter(c => c.favorito);
  const [tareas, setTareas] = useState<TareasConv>(tareasIniciales);
  const [expandedId, setExpandedId] = useState<string | null>(favoritos[0]?.id || null);
  const [nuevaTarea, setNuevaTarea] = useState<{ [key: string]: string }>({});

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

  if (favoritos.length === 0) {
    return (
      <div className="favoritos__empty animate-fade-in">
        <Star size={48} className="favoritos__empty-icon" />
        <h3>No hay favoritos</h3>
        <p>Marca convocatorias con ★ desde el Radar para crear tu workflow de postulación.</p>
      </div>
    );
  }

  return (
    <div className="favoritos animate-fade-in">
      <div className="favoritos__summary">
        <div className="favoritos__summary-stat">
          <span className="favoritos__summary-value mono">{favoritos.length}</span>
          <span className="favoritos__summary-label">Convocatorias guardadas</span>
        </div>
        <div className="favoritos__summary-stat">
          <span className="favoritos__summary-value mono">
            {Object.values(tareas).flat().filter(t => !t.completada).length}
          </span>
          <span className="favoritos__summary-label">Tareas pendientes</span>
        </div>
        <div className="favoritos__summary-stat">
          <span className="favoritos__summary-value mono">
            {Object.values(tareas).flat().filter(t => t.completada).length}
          </span>
          <span className="favoritos__summary-label">Tareas completadas</span>
        </div>
      </div>

      <div className="favoritos__list">
        {favoritos.map(conv => {
          const convTareas = tareas[conv.id] || [];
          const completadas = convTareas.filter(t => t.completada).length;
          const progreso = convTareas.length > 0 ? Math.round((completadas / convTareas.length) * 100) : 0;
          const isExpanded = expandedId === conv.id;
          const diasRestantes = Math.ceil(
            (new Date(conv.fechaCierre).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );

          return (
            <div key={conv.id} className="favorito-card">
              <div
                className="favorito-card__header"
                onClick={() => setExpandedId(isExpanded ? null : conv.id)}
              >
                <div className="favorito-card__left">
                  <span className={`favorito-card__estado favorito-card__estado--${conv.estado}`}>
                    {conv.estado === 'abierta' ? 'Abierta' : conv.estado === 'proxima' ? 'Próxima' : 'Cerrada'}
                  </span>
                  <h3 className="favorito-card__title">{conv.titulo}</h3>
                  <div className="favorito-card__meta">
                    <span>{fuenteLogos[conv.fuente]} {conv.fuente}</span>
                    <span>·</span>
                    <span className="favorito-card__donante">{conv.donante}</span>
                  </div>
                </div>
                <div className="favorito-card__right">
                  <div className="favorito-card__deadline" style={{ color: diasRestantes < 30 ? 'var(--danger)' : diasRestantes < 60 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                    {diasRestantes > 0 ? (
                      <>
                        <Clock size={14} />
                        <span className="mono">{diasRestantes}d</span>
                      </>
                    ) : (
                      <span>Cerrada</span>
                    )}
                  </div>

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
                  {/* Sectors */}
                  <div className="favorito-card__sectors">
                    {conv.sectores.map(s => (
                      <span
                        key={s}
                        className="favorito-card__sector"
                        style={{ color: sectorColors[s], borderColor: `${sectorColors[s]}30` }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>

                  {/* Task list */}
                  <div className="favorito-card__tasks">
                    <div className="favorito-card__tasks-header">
                      <span>Tareas ({completadas}/{convTareas.length})</span>
                    </div>
                    {convTareas.map(tarea => (
                      <div
                        key={tarea.id}
                        className={`favorito-task ${tarea.completada ? 'favorito-task--done' : ''}`}
                      >
                        <button
                          className="favorito-task__check"
                          onClick={() => toggleTarea(conv.id, tarea.id)}
                        >
                          {tarea.completada ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        <span className="favorito-task__text">{tarea.texto}</span>
                        <button
                          className="favorito-task__delete"
                          onClick={() => eliminarTarea(conv.id, tarea.id)}
                          title="Eliminar tarea"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}

                    {/* Add task */}
                    <div className="favorito-card__add-task">
                      <input
                        type="text"
                        placeholder="Nueva tarea..."
                        value={nuevaTarea[conv.id] || ''}
                        onChange={(e) => setNuevaTarea(prev => ({ ...prev, [conv.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && agregarTarea(conv.id)}
                      />
                      <button onClick={() => agregarTarea(conv.id)} className="favorito-card__add-btn">
                        <Plus size={14} /> Agregar
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="favorito-card__actions">
                    {diasRestantes > 0 && diasRestantes < 30 && (
                      <div className="favorito-card__warning">
                        <AlertTriangle size={14} />
                        <span>¡Cierre en menos de 30 días!</span>
                      </div>
                    )}
                    <button
                      className="favorito-card__remove"
                      onClick={() => onToggleFavorito(conv.id)}
                    >
                      <Star size={14} fill="currentColor" /> Quitar de favoritos
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
