import { useState } from 'react';
import {
  ShieldCheck, ShieldAlert, ShieldX,
  FileText, Building2, CreditCard, Users, Award,
  CheckCircle2, AlertTriangle, XCircle, Upload,
  ChevronDown, ChevronUp, FolderOpen,
} from 'lucide-react';
import './RiesgosView.css';

interface Documento {
  id: string;
  nombre: string;
  tipo: 'legal' | 'financiero' | 'tecnico' | 'institucional';
  estado: 'vigente' | 'por_vencer' | 'vencido' | 'no_cargado';
  fechaVencimiento: string | null;
  observaciones: string;
}

const documentosVacio: Documento[] = [];

const tipoIcons = {
  legal: <FileText size={16} />,
  financiero: <CreditCard size={16} />,
  tecnico: <Award size={16} />,
  institucional: <Building2 size={16} />,
};

const estadoConfig = {
  vigente: { icon: <CheckCircle2 size={14} />, label: 'Vigente', color: 'var(--success)' },
  por_vencer: { icon: <AlertTriangle size={14} />, label: 'Por vencer', color: 'var(--warning)' },
  vencido: { icon: <XCircle size={14} />, label: 'Vencido', color: 'var(--danger)' },
  no_cargado: { icon: <Upload size={14} />, label: 'No cargado', color: 'var(--text-muted)' },
};

export default function RiesgosView() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');
  const documentos = documentosVacio;

  const vigentes = documentos.filter(d => d.estado === 'vigente').length;
  const porVencer = documentos.filter(d => d.estado === 'por_vencer').length;
  const vencidos = documentos.filter(d => d.estado === 'vencido').length;
  const noCargados = documentos.filter(d => d.estado === 'no_cargado').length;
  const cumplimiento = documentos.length > 0 ? Math.round((vigentes / documentos.length) * 100) : 0;

  const docsFiltrados = filtroEstado === 'todos'
    ? documentos
    : documentos.filter(d => d.estado === filtroEstado);

  return (
    <div className="riesgos animate-fade-in">
      {/* Score general */}
      <div className="riesgos__score-card">
        <div className="riesgos__score-visual">
          <svg viewBox="0 0 120 120" className="riesgos__score-ring">
            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="54" fill="none"
              stroke={cumplimiento >= 70 ? 'var(--success)' : cumplimiento >= 50 ? 'var(--warning)' : 'var(--danger)'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${cumplimiento * 3.39} 339`}
              transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dasharray 1s ease' }}
            />
          </svg>
          <div className="riesgos__score-value">
            <span className="mono" style={{ fontSize: '32px', fontWeight: 800 }}>{cumplimiento}%</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Cumplimiento</span>
          </div>
        </div>
        <div className="riesgos__score-breakdown">
          <div className="riesgos__score-item">
            <ShieldCheck size={16} style={{ color: 'var(--success)' }} />
            <span>{vigentes} Vigentes</span>
          </div>
          <div className="riesgos__score-item">
            <ShieldAlert size={16} style={{ color: 'var(--warning)' }} />
            <span>{porVencer} Por vencer</span>
          </div>
          <div className="riesgos__score-item">
            <ShieldX size={16} style={{ color: 'var(--danger)' }} />
            <span>{vencidos} Vencidos</span>
          </div>
          <div className="riesgos__score-item">
            <Upload size={16} style={{ color: 'var(--text-muted)' }} />
            <span>{noCargados} No cargados</span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="riesgos__tabs">
        {[
          { key: 'todos', label: 'Todos', count: documentos.length },
          { key: 'vigente', label: 'Vigentes', count: vigentes },
          { key: 'por_vencer', label: 'Por vencer', count: porVencer },
          { key: 'vencido', label: 'Vencidos', count: vencidos },
          { key: 'no_cargado', label: 'Sin cargar', count: noCargados },
        ].map(tab => (
          <button
            key={tab.key}
            className={`riesgos__tab ${filtroEstado === tab.key ? 'riesgos__tab--active' : ''}`}
            onClick={() => setFiltroEstado(tab.key)}
          >
            {tab.label}
            <span className="riesgos__tab-count">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Documents list */}
      {documentos.length === 0 ? (
        <div className="riesgos__empty">
          <FolderOpen size={48} strokeWidth={1} />
          <h3>Sin documentos cargados</h3>
          <p>El Analista de Riesgos requiere que cargues los documentos de tu organización (RUT, certificados, estados financieros) para evaluar tu elegibilidad frente a las convocatorias disponibles.</p>
        </div>
      ) : (
      <div className="riesgos__list">
        {docsFiltrados.map(doc => {
          const config = estadoConfig[doc.estado];
          const isExpanded = expandedId === doc.id;

          return (
            <div key={doc.id} className={`riesgos__doc riesgos__doc--${doc.estado}`}>
              <div className="riesgos__doc-main" onClick={() => setExpandedId(isExpanded ? null : doc.id)}>
                <div className="riesgos__doc-icon">{tipoIcons[doc.tipo]}</div>
                <div className="riesgos__doc-info">
                  <span className="riesgos__doc-name">{doc.nombre}</span>
                  <span className="riesgos__doc-tipo">{doc.tipo}</span>
                </div>
                <div className="riesgos__doc-estado" style={{ color: config.color }}>
                  {config.icon}
                  <span>{config.label}</span>
                </div>
                {doc.fechaVencimiento && (
                  <span className="riesgos__doc-fecha mono">{doc.fechaVencimiento}</span>
                )}
                <button className="riesgos__doc-toggle">
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {isExpanded && (
                <div className="riesgos__doc-details animate-fade-in">
                  <p>{doc.observaciones}</p>
                  <div className="riesgos__doc-actions">
                    {doc.estado === 'no_cargado' && (
                      <button className="riesgos__btn riesgos__btn--primary">
                        <Upload size={14} /> Cargar documento
                      </button>
                    )}
                    {doc.estado === 'vencido' && (
                      <button className="riesgos__btn riesgos__btn--danger">
                        <AlertTriangle size={14} /> Renovar urgente
                      </button>
                    )}
                    {doc.estado === 'por_vencer' && (
                      <button className="riesgos__btn riesgos__btn--warning">
                        <AlertTriangle size={14} /> Programar renovación
                      </button>
                    )}
                    <button className="riesgos__btn">
                      <FileText size={14} /> Ver documento
                    </button>
                  </div>
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
