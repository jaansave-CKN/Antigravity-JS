import { Check, X, Tag, ExternalLink, Zap } from 'lucide-react';
import type { Convocatoria, CategoriaGestion } from '../types';
import './IntelligenceInbox.css';

interface IntelligenceInboxProps {
  hallazgos: Convocatoria[];
  onApprove: (id: string, categoria: CategoriaGestion) => void;
  onDiscard: (id: string) => void;
}

const CATEGORIAS: { id: CategoriaGestion; label: string; color: string }[] = [
  { id: 'importante', label: 'Importante', color: '#ffcc00' },
  { id: 'facil_victoria', label: 'Fácil Victoria', color: '#00c853' },
  { id: 'complicada', label: 'Complicada', color: '#ff6d00' },
  { id: 'estratégica', label: 'Estratégica', color: '#651fff' },
];

export default function IntelligenceInbox({ hallazgos, onApprove, onDiscard }: IntelligenceInboxProps) {
  if (hallazgos.length === 0) {
    return (
      <div className="inbox-empty">
        <div className="inbox-empty__icon">
          <Zap size={40} />
        </div>
        <h3>Bandeja Limpia</h3>
        <p>No hay nuevos hallazgos pendientes de revisión en este momento.</p>
      </div>
    );
  }

  return (
    <div className="inbox">
      <div className="inbox__header">
        <div className="inbox__badge">{hallazgos.length} Hallazgos IA</div>
        <p>Revisa y clasifica las subvenciones encontradas por el rastreador autónomo.</p>
      </div>

      <div className="inbox__list">
        {hallazgos.map((item) => (
          <div key={item.id} className="inbox-card animate-slide-in">
            <div className="inbox-card__main">
              <div className="inbox-card__header">
                <span className="inbox-card__source">{item.fuente}</span>
                <span className="inbox-card__match">{item.compatibilidadPerfil}% Match</span>
              </div>
              <h3 className="inbox-card__title">{item.titulo}</h3>
              <p className="inbox-card__desc">{item.descripcion}</p>
              <div className="inbox-card__meta">
                <span>💰 {item.montoMax.toLocaleString()} {item.moneda}</span>
                <span>📅 Cierre: {item.fechaCierre}</span>
              </div>
            </div>

            <div className="inbox-card__actions">
              <div className="inbox-card__approval">
                <span className="inbox-card__action-label">Clasificar y Aprobar:</span>
                <div className="inbox-card__buttons">
                  {CATEGORIAS.map((cat) => (
                    <button
                      key={cat.id}
                      className="inbox-card__btn-approve"
                      onClick={() => onApprove(item.id, cat.id)}
                      style={{ '--btn-color': cat.color } as any}
                    >
                      <Tag size={14} />
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="inbox-card__secondary">
                <a href={item.urlOriginal} target="_blank" rel="noreferrer" className="inbox-card__link">
                  <ExternalLink size={14} /> Ver Fuente
                </a>
                <button className="inbox-card__btn-discard" onClick={() => onDiscard(item.id)}>
                  <X size={16} /> Descartar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
