/**
 * BANDEJA DE ENTRADA DE PROSPECTOS
 * ================================
 * Panel de validación del Agente Validador.
 * Muestra los resultados crudos del Agente Minero antes de ser indexados.
 */

import React from 'react';
import { useRadar } from '../contexts/RadarContext';
import { 
  Inbox, 
  CheckCircle, 
  XCircle, 
  Clock, 
  ExternalLink, 
  Building2,
  Calendar,
  Search
} from 'lucide-react';
import './BandejaProspectos.css';

export function BandejaProspectos() {
  const { 
    state, 
    aprobarItem, 
    descartarItem, 
    pendientesCount, 
    aprobadasCount, 
    descartadasCount 
  } = useRadar();

  const [filtroEstado, setFiltroEstado] = React.useState<'todos' | 'Pendiente' | 'Aprobado' | 'Descartado'>('Pendiente');

  const itemsFiltrados = React.useMemo(() => {
    if (filtroEstado === 'todos') return state.colaValidacion;
    return state.colaValidacion.filter(item => item.estado === filtroEstado);
  }, [state.colaValidacion, filtroEstado]);

  const formatearFecha = (fecha?: string) => {
    if (!fecha) return 'Sin fecha';
    return new Date(fecha).toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'score-high';
    if (score >= 60) return 'score-medium';
    return 'score-low';
  };

  if (state.cargandoCola) {
    return (
      <div className="bandeja-loading">
        <div className="spinner"></div>
        <p>Cargando prospectos...</p>
      </div>
    );
  }

  return (
    <div className="bandeja-container">
      {/* Header */}
      <div className="bandeja-header">
        <div className="bandeja-title">
          <Inbox size={24} />
          <h2>Bandeja de Entrada de Prospectos</h2>
          <span className="badge-pending">{pendientesCount} pendientes</span>
        </div>
        
        {/* Estadísticas rápidas */}
        <div className="bandeja-stats">
          <div className="stat-item stat-pending">
            <Clock size={16} />
            <span>{pendientesCount}</span>
          </div>
          <div className="stat-item stat-approved">
            <CheckCircle size={16} />
            <span>{aprobadasCount}</span>
          </div>
          <div className="stat-item stat-rejected">
            <XCircle size={16} />
            <span>{descartadasCount}</span>
          </div>
        </div>
      </div>

      {/* Filtros de tabs */}
      <div className="bandeja-tabs">
        <button 
          className={`tab ${filtroEstado === 'Pendiente' ? 'active' : ''}`}
          onClick={() => setFiltroEstado('Pendiente')}
        >
          <Clock size={14} />
          Pendientes ({pendientesCount})
        </button>
        <button 
          className={`tab ${filtroEstado === 'Aprobado' ? 'active' : ''}`}
          onClick={() => setFiltroEstado('Aprobado')}
        >
          <CheckCircle size={14} />
          Aprobadas ({aprobadasCount})
        </button>
        <button 
          className={`tab ${filtroEstado === 'Descartado' ? 'active' : ''}`}
          onClick={() => setFiltroEstado('Descartado')}
        >
          <XCircle size={14} />
          Descartadas ({descartadasCount})
        </button>
        <button 
          className={`tab ${filtroEstado === 'todos' ? 'active' : ''}`}
          onClick={() => setFiltroEstado('todos')}
        >
          Todas ({state.colaValidacion.length})
        </button>
      </div>

      {/* Lista de prospectos */}
      <div className="bandeja-list">
        {itemsFiltrados.length === 0 ? (
          <div className="bandeja-empty">
            <Inbox size={48} />
            <p>No hay prospectos en esta categoría</p>
          </div>
        ) : (
          itemsFiltrados.map(item => (
            <div key={item.id} className={`prospecto-card ${item.estado.toLowerCase()}`}>
              {/* Score de coincidencia */}
              <div className={`prospecto-score ${getScoreColor(item.score_encontrado)}`}>
                <span className="score-value">{item.score_encontrado}%</span>
                <span className="score-label">match</span>
              </div>

              {/* Contenido principal */}
              <div className="prospecto-content">
                <div className="prospecto-header">
                  <h3 className="prospecto-title">{item.titulo}</h3>
                  {item.url_fuente && (
                    <a 
                      href={item.url_fuente} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="prospecto-link"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>

                <div className="prospecto-meta">
                  <span className="meta-item">
                    <Building2 size={12} />
                    {item.donante || item.fuente || 'Fuente desconocida'}
                  </span>
                  <span className="meta-item">
                    <Calendar size={12} />
                    {formatearFecha(item.fecha_ingreso)}
                  </span>
                </div>

                {item.descripcion && (
                  <p className="prospecto-snippet">
                    <Search size={12} />
                    {item.descripcion.substring(0, 150)}
                    {item.descripcion.length > 150 && '...'}
                  </p>
                )}

                {/* Sectores */}
                {item.sectores && item.sectores.length > 0 && (
                  <div className="prospecto-tags">
                    {item.sectores.slice(0, 3).map((sector, idx) => (
                      <span key={idx} className="tag-sector">{sector}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Acciones */}
              {item.estado === 'Pendiente' && (
                <div className="prospecto-actions">
                  <button 
                    className="btn-aprobar"
                    onClick={() => aprobarItem(item.id)}
                  >
                    <CheckCircle size={16} />
                    Agregar Entidad
                  </button>
                  <button 
                    className="btn-descartar"
                    onClick={() => descartarItem(item.id)}
                  >
                    <XCircle size={16} />
                    Descartar
                  </button>
                </div>
              )}

              {/* Estado visual */}
              <div className={`prospecto-status status-${item.estado.toLowerCase()}`}>
                {item.estado === 'Pendiente' && <Clock size={12} />}
                {item.estado === 'Aprobado' && <CheckCircle size={12} />}
                {item.estado === 'Descartado' && <XCircle size={12} />}
                {item.estado}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Resumen */}
      <div className="bandeja-footer">
        <p>
          Total de prospectos capturados: <strong>{state.colaValidacion.length}</strong>
        </p>
        <p className="footer-hint">
          Los prospectos aprobados se agregarán automáticamente al RadarGrid.
        </p>
      </div>
    </div>
  );
}

export default BandejaProspectos;