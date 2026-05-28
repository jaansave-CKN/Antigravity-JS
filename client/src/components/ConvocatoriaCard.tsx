import {
  Star,
  Calendar,
  MapPin,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  DollarSign,
  CheckCircle2,
} from 'lucide-react';
import { useState } from 'react';
import type { Convocatoria } from '../types';
import { sectorColors, fuenteLogos } from '../data/mockData';
import './ConvocatoriaCard.css';

interface ConvocatoriaCardProps {
  conv: Convocatoria;
  onToggleFavorito: (id: string) => void;
  index: number;
  allConvocatorias?: Convocatoria[];
}

export default function ConvocatoriaCard({ conv, onToggleFavorito, index, allConvocatorias }: ConvocatoriaCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);

  const diasRestantes = (() => {
    if (!conv.fechaCierre) return null;
    const diff = Math.ceil((new Date(conv.fechaCierre).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return isNaN(diff) ? null : diff;
  })();

  const scoreColor =
    conv.compatibilidadPerfil >= 80
      ? 'var(--success)'
      : conv.compatibilidadPerfil >= 60
        ? 'var(--warning)'
        : 'var(--danger)';

  const estadoLabel = {
    abierta: 'Abierta',
    proxima: 'Próxima',
    cerrada: 'Cerrada',
    pendiente_revision: 'Pendiente Revisión',
  };

  const TRM_2026 = 3850;

  const formatMonto = (monto: number, moneda: string) => {
    if (moneda === 'COP') {
      const enMillones = (monto / 1000000).toFixed(0);
      return `$${enMillones}M COP`;
    }
    let copEquiv = monto;
    let symbol = '';
    if (moneda === 'EUR') { copEquiv = monto * TRM_2026 * 1.08; symbol = '€'; }
    else if (moneda === 'CHF') { copEquiv = monto * TRM_2026 * 1.13; symbol = 'CHF'; }
    else { copEquiv = monto * TRM_2026; symbol = '$'; }
    const copMillones = (copEquiv / 1000000).toFixed(0);
    const original = monto >= 1000000 ? `$${(monto / 1000000).toFixed(1)}M ${moneda}` : `$${monto.toLocaleString()} ${moneda}`;
    return `${original} ≈ $${copMillones}M COP`;
  };

  const formatCopOnly = (monto: number, moneda: string) => {
    let copEquiv = monto;
    if (moneda === 'EUR') { copEquiv = monto * TRM_2026 * 1.08; }
    else if (moneda === 'CHF') { copEquiv = monto * TRM_2026 * 1.13; }
    else if (moneda !== 'COP') { copEquiv = monto * TRM_2026; }
    if (moneda === 'COP') return `$${(monto / 1000000).toFixed(0)}M COP`;
    return `$${(copEquiv / 1000000).toFixed(0)}M COP`;
  };

  return (
    <article
      className={`conv-card animate-fade-in`}
      style={{ animationDelay: `${index * 0.05}s` }}
      id={`convocatoria-${conv.id}`}
    >
      {/* Top row: Status + Score */}
      <div className="conv-card__top">
        <div className="conv-card__meta-left">
          <span className={`conv-card__estado conv-card__estado--${conv.estado}`}>
            {estadoLabel[conv.estado as keyof typeof estadoLabel]}
          </span>
          {conv.categoriaGestion && (
            <span className={`conv-card__gestion conv-card__gestion--${conv.categoriaGestion}`}>
              {conv.categoriaGestion.replace('_', ' ')}
            </span>
          )}
          <span className="conv-card__fuente">
            {fuenteLogos[conv.fuente] || '📄'} {conv.fuente}
          </span>
        </div>

        <div className="conv-card__score-ring" title={`Compatibilidad: ${conv.compatibilidadPerfil}%`}>
          <svg viewBox="0 0 36 36" className="conv-card__score-svg">
            <path
              className="conv-card__score-bg"
              d="M18 2.0845
                 a 15.9155 15.9155 0 0 1 0 31.831
                 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              className="conv-card__score-fill"
              strokeDasharray={`${conv.compatibilidadPerfil}, 100`}
              style={{ stroke: scoreColor }}
              d="M18 2.0845
                 a 15.9155 15.9155 0 0 1 0 31.831
                 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span className="conv-card__score-text mono" style={{ color: scoreColor }}>
            {conv.compatibilidadPerfil}
          </span>
        </div>
      </div>

      {/* Title & Donante */}
      <h3 className="conv-card__title">{conv.titulo}</h3>
      <p className="conv-card__donante">{conv.donante}</p>

      {/* Sectors */}
      <div className="conv-card__sectors">
        {conv.sectores.map((s) => {
          const color = sectorColors[s] || '#6B7280';
          const convsForSector = allConvocatorias ? allConvocatorias.filter(c => c.sectores.includes(s)) : [];
          const isExpanded = expandedSector === s;

          return (
            <div key={s} className="conv-card__sector-wrapper">
              <div className="conv-card__sector-interactive">
                <button
                  className={`conv-card__sector-btn ${isExpanded ? 'conv-card__sector-btn--active' : ''}`}
                  style={{
                    backgroundColor: color,
                    borderColor: color,
                    boxShadow: `0 4px 10px ${color}40`
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    if (allConvocatorias) {
                      setExpandedSector(isExpanded ? null : s);
                    }
                  }}
                  title="Haz clic para ver convocatorias relacionadas"
                >
                  <span className="conv-card__sector-btn-text">{s}</span>
                  <ChevronDown 
                    size={14} 
                    className={`conv-card__sector-btn-icon ${isExpanded ? 'conv-card__sector-btn-icon--rotated' : ''}`} 
                  />
                </button>
                {allConvocatorias && (
                  <div className="conv-card__sector-count-container">
                    <div className="conv-card__sector-count-badge">
                      {convsForSector.length} conv.
                    </div>
                  </div>
                )}
              </div>
              
              {isExpanded && (
                <div className="conv-card__sector-dropdown">
                  <div className="conv-card__sector-dropdown-header">
                    <span>Convocatorias en {s}</span>
                    <span className="conv-card__sector-dropdown-count">{convsForSector.length} encontradas</span>
                  </div>
                  <div className="conv-card__sector-dropdown-list">
                    {convsForSector.map(c => (
                      <a key={c.id} href={c.urlConvocatoria || c.urlOriginal || '#'} target="_blank" rel="noopener noreferrer" className="conv-card__sector-link">
                        <div className="conv-card__sector-link-content">
                          <span className="conv-card__sector-link-title">{c.titulo}</span>
                          <span className="conv-card__sector-link-donante">{c.donante}</span>
                        </div>
                        <ExternalLink size={14} className="conv-card__sector-link-icon" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {conv.poblacionesObjetivo?.map((p, i) => {
          const color = i % 2 === 0 ? '#FFC107' : '#8BC34A';
          const label = p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const convsForPob = allConvocatorias ? allConvocatorias.filter(c => c.poblacionesObjetivo?.includes(p)) : [];
          const isExpanded = expandedSector === `pob-${p}`;

          return (
            <div key={p} className="conv-card__sector-wrapper">
              <div className="conv-card__sector-interactive">
                <button
                  className={`conv-card__sector-btn ${isExpanded ? 'conv-card__sector-btn--active' : ''}`}
                  style={{
                    backgroundColor: color,
                    borderColor: color,
                    boxShadow: `0 4px 10px ${color}40`,
                    color: '#000' // Dark text for light colors
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    if (allConvocatorias) {
                      setExpandedSector(isExpanded ? null : `pob-${p}`);
                    }
                  }}
                  title="Haz clic para ver convocatorias relacionadas"
                >
                  <span className="conv-card__sector-btn-text">{label}</span>
                  <ChevronDown 
                    size={14} 
                    className={`conv-card__sector-btn-icon ${isExpanded ? 'conv-card__sector-btn-icon--rotated' : ''}`} 
                  />
                </button>
                {allConvocatorias && (
                  <div className="conv-card__sector-count-container">
                    <div className="conv-card__sector-count-badge">
                      {convsForPob.length} conv.
                    </div>
                  </div>
                )}
              </div>
              
              {isExpanded && (
                <div className="conv-card__sector-dropdown">
                  <div className="conv-card__sector-dropdown-header">
                    <span>Convocatorias para {label}</span>
                    <span className="conv-card__sector-dropdown-count">{convsForPob.length} encontradas</span>
                  </div>
                  <div className="conv-card__sector-dropdown-list">
                    {convsForPob.map(c => (
                      <a key={c.id} href={c.urlConvocatoria || c.urlOriginal || '#'} target="_blank" rel="noopener noreferrer" className="conv-card__sector-link">
                        <div className="conv-card__sector-link-content">
                          <span className="conv-card__sector-link-title">{c.titulo}</span>
                          <span className="conv-card__sector-link-donante">{c.donante}</span>
                        </div>
                        <ExternalLink size={14} className="conv-card__sector-link-icon" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info row */}
      <div className="conv-card__info-row">
        <div className="conv-card__info-item conv-card__info-item--amount" title={`Equivalente: ${formatCopOnly(conv.montoMax, conv.moneda)}`}>
          <DollarSign size={14} />
          <span className="mono">{formatMonto(conv.montoMax, conv.moneda)}</span>
        </div>
        <div className="conv-card__info-item">
          <Calendar size={14} />
          <span>{diasRestantes !== null ? (diasRestantes > 0 ? `${diasRestantes} días` : 'Cerrada') : 'Sin fecha'}</span>
        </div>
        <div className="conv-card__info-item">
          <MapPin size={14} />
          <span>{conv.paisesElegibles.length} países</span>
        </div>
      </div>

      {/* Expanded content */}
      <div className={`conv-card__expanded ${expanded ? 'conv-card__expanded--visible' : ''}`}>
        <div className="conv-card__desc-section">
          <span className="conv-card__requisitos-label">Descripcion</span>
          <p className="conv-card__desc">{conv.descripcion}</p>
        </div>

        <div className="conv-card__requisitos">
          <span className="conv-card__requisitos-label">Requisitos Clave</span>
          <ul className="conv-card__requisitos-list">
            {conv.requisitosClave.map((req, i) => (
              <li key={i}>
                <CheckCircle2 size={12} />
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="conv-card__paises">
          <span className="conv-card__requisitos-label">Paises Elegibles</span>
          <div className="conv-card__paises-list">
            {conv.paisesElegibles.map((p) => (
              <span key={p} className={`conv-card__pais ${p === 'Colombia' ? 'conv-card__pais--highlight' : ''}`}>
                {p}
              </span>
            ))}
          </div>
        </div>

        <div className="conv-card__meta-section">
          <div className="conv-card__meta-item">
            <Calendar size={14} />
            <span>Publicacion: {conv.fechaPublicacion}</span>
          </div>
          <div className="conv-card__meta-item">
            <Calendar size={14} />
            <span>Cierre: {conv.fechaCierre}</span>
          </div>
          <div className="conv-card__meta-item">
            <span className="conv-card__meta-label">Probabilidad de exito:</span>
            <span className="conv-card__meta-value" style={{color: scoreColor}}>{conv.probabilidadExito}%</span>
          </div>
          <div className="conv-card__meta-item">
            <DollarSign size={14} />
            <span>Monto original: {conv.moneda !== 'COP' ? `${conv.moneda} ${conv.montoMax.toLocaleString()}` : `$${conv.montoMax.toLocaleString()} ${conv.moneda}`}</span>
          </div>
          <div className="conv-card__meta-item conv-card__meta-item--highlight">
            <DollarSign size={14} />
            <span>Equivalente COP: {formatCopOnly(conv.montoMax, conv.moneda)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="conv-card__actions">
        <button
          className={`conv-card__fav ${conv.favorito ? 'conv-card__fav--active' : ''}`}
          onClick={() => onToggleFavorito(conv.id)}
          title={conv.favorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        >
          <Star size={16} fill={conv.favorito ? 'currentColor' : 'none'} />
        </button>

        <button
          className="conv-card__expand"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {expanded ? 'Menos' : 'Más detalles'}
        </button>

        <a
          href={conv.urlConvocatoria || conv.urlOriginal || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="conv-card__link"
        >
          <ExternalLink size={14} />
          Ir a Convocatoria
        </a>
      </div>
    </article>
  );
}
