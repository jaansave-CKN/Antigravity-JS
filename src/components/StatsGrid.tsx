import {
  FileSearch2,
  CircleDollarSign,
  TrendingUp,
  Sparkles,
  Radio,
  Layers,
} from 'lucide-react';
import type { EstadisticasRadar } from '../types';
import './StatsGrid.css';

interface StatsGridProps {
  stats: EstadisticasRadar;
}

export default function StatsGrid({ stats }: StatsGridProps) {
  const cards = [
    {
      id: 'total',
      icon: <FileSearch2 size={20} />,
      label: 'Total Convocatorias',
      value: stats.totalConvocatorias.toString(),
      change: '+12 hoy',
      changeType: 'positive' as const,
      color: 'blue',
    },
    {
      id: 'abiertas',
      icon: <Radio size={20} />,
      label: 'Convocatorias Abiertas',
      value: stats.convocatoriasAbiertas.toString(),
      change: '60.5%',
      changeType: 'neutral' as const,
      color: 'green',
    },
    {
      id: 'monto',
      icon: <CircleDollarSign size={20} />,
      label: 'Monto Disponible',
      value: `$${(stats.montoTotalDisponible / 1000000).toFixed(0)}M`,
      change: 'USD agregado',
      changeType: 'neutral' as const,
      color: 'gold',
    },
    {
      id: 'match',
      icon: <TrendingUp size={20} />,
      label: 'Compatibilidad Promedio',
      value: `${stats.promedioCompatibilidad}%`,
      change: '+5% vs Q1',
      changeType: 'positive' as const,
      color: 'cyan',
    },
    {
      id: 'nuevas',
      icon: <Sparkles size={20} />,
      label: 'Nuevas (24h)',
      value: stats.nuevasUltimas24h.toString(),
      change: 'detectadas',
      changeType: 'neutral' as const,
      color: 'purple',
    },
    {
      id: 'fuentes',
      icon: <Layers size={20} />,
      label: 'Fuentes Activas',
      value: stats.fuentesActivas.toString(),
      change: 'conectadas',
      changeType: 'positive' as const,
      color: 'orange',
    },
  ];

  return (
    <div className="stats-grid stagger-children">
      {cards.map((card) => (
        <div key={card.id} className={`stat-card stat-card--${card.color} animate-fade-in`}>
          <div className="stat-card__header">
            <div className={`stat-card__icon stat-card__icon--${card.color}`}>
              {card.icon}
            </div>
            <span className={`stat-card__change stat-card__change--${card.changeType}`}>
              {card.change}
            </span>
          </div>
          <div className="stat-card__value mono">{card.value}</div>
          <div className="stat-card__label">{card.label}</div>
          <div className="stat-card__glow" />
        </div>
      ))}
    </div>
  );
}
