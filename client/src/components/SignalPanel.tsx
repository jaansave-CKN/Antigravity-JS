import { Zap, TrendingUp, Landmark, AlertTriangle } from 'lucide-react';
import type { AlertaSenal } from '../types';
import './SignalPanel.css';

interface SignalPanelProps {
  alertas: AlertaSenal[];
}

const iconMap = {
  presupuestal: <Landmark size={16} />,
  politica: <AlertTriangle size={16} />,
  tendencia: <TrendingUp size={16} />,
};

const impactoLabel = {
  alto: { text: 'Alto', color: 'var(--danger)' },
  medio: { text: 'Medio', color: 'var(--warning)' },
  bajo: { text: 'Bajo', color: 'var(--text-muted)' },
};

export default function SignalPanel({ alertas }: SignalPanelProps) {
  return (
    <div className="signal-panel">
      <div className="signal-panel__header">
        <div className="signal-panel__title">
          <Zap size={16} className="signal-panel__title-icon" />
          <h3>Señales Débiles</h3>
        </div>
        <span className="signal-panel__subtitle">Alertas pre-convocatoria</span>
      </div>

      <div className="signal-panel__list">
        {alertas.map((alerta) => (
          <div key={alerta.id} className="signal-item" id={`signal-${alerta.id}`}>
            <div className={`signal-item__icon signal-item__icon--${alerta.tipo}`}>
              {iconMap[alerta.tipo]}
            </div>
            <div className="signal-item__content">
              <div className="signal-item__top">
                <h4 className="signal-item__title">{alerta.titulo}</h4>
                <span
                  className="signal-item__impacto"
                  style={{ color: impactoLabel[alerta.impacto].color }}
                >
                  ● {impactoLabel[alerta.impacto].text}
                </span>
              </div>
              <p className="signal-item__desc">{alerta.descripcion}</p>
              <div className="signal-item__meta">
                <span className="signal-item__fecha">{alerta.fecha}</span>
                <span className="signal-item__fuente">{alerta.fuente}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
