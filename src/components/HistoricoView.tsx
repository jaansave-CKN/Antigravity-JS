import { useMemo, useState } from 'react';
import { CalendarClock, TrendingUp, ChevronLeft, ChevronRight, ArrowUpRight, Clock } from 'lucide-react';
import type { Convocatoria } from '../types';
import { sectorColors } from '../data/mockData';
import './HistoricoView.css';

interface HistoricoViewProps {
  convocatorias: Convocatoria[];
}

interface FondoMes {
  nombre: string;
  sector: string;
  probabilidad: number;
  fuente: string;
}

interface PatronAnual {
  mes: string;
  mesNum: number;
  fondos: FondoMes[];
}

const meses = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function obtenerPatronesDesdeConvocatorias(convocatorias: Convocatoria[], anio: number): PatronAnual[] {
  const patrones: PatronAnual[] = meses.map((nombre, idx) => ({
    mes: nombre,
    mesNum: idx + 1,
    fondos: [] as FondoMes[]
  }));

  convocatorias.forEach(conv => {
    if (!conv.fechaCierre) return;
    const fecha = new Date(conv.fechaCierre);
    const anioConv = fecha.getFullYear();
    const mesConv = fecha.getMonth() + 1;

    if (anioConv === anio && mesConv >= 1 && mesConv <= 12) {
      patrones[mesConv - 1].fondos.push({
        nombre: conv.titulo,
        sector: conv.sectores[0] || 'General',
        probabilidad: conv.probabilidadExito,
        fuente: conv.fuente
      });
    }
  });

  return patrones;
}

export default function HistoricoView({ convocatorias }: HistoricoViewProps) {
  const [anio, setAnio] = useState(2026);
  const mesActual = new Date().getMonth() + 1;

  const patronesAnuales = useMemo(() =>
    obtenerPatronesDesdeConvocatorias(convocatorias, anio),
    [convocatorias, anio]
  );

  const cerradas = useMemo(() =>
    convocatorias.filter(c => {
      if (!c.fechaCierre || c.estado !== 'cerrada') return false;
      const fecha = new Date(c.fechaCierre);
      return fecha.getFullYear() === anio;
    }),
    [convocatorias, anio]
  );

  const proximas = useMemo(() =>
    convocatorias.filter(c => {
      if (c.estado !== 'abierta') return false;
      if (!c.fechaCierre) return false;
      const fecha = new Date(c.fechaCierre);
      const anioActual = new Date().getFullYear();
      return fecha.getFullYear() === anio && fecha.getMonth() + 1 > mesActual;
    }),
    [convocatorias, anio, mesActual]
  );

  return (
    <div className="historico animate-fade-in">
      {/* Year nav */}
      <div className="historico__year-nav">
        <button className="historico__year-btn" onClick={() => setAnio(a => a - 1)}>
          <ChevronLeft size={16} />
        </button>
        <span className="historico__year mono">{anio}</span>
        <button className="historico__year-btn" onClick={() => setAnio(a => a + 1)}>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="historico__summary">
        <div className="historico__summary-card">
          <CalendarClock size={18} className="historico__summary-icon" />
          <div>
            <div className="historico__summary-value mono">{patronesAnuales.reduce((acc, m) => acc + m.fondos.length, 0)}</div>
            <div className="historico__summary-label">Fondos predichos {anio}</div>
          </div>
        </div>
        <div className="historico__summary-card">
          <TrendingUp size={18} className="historico__summary-icon historico__summary-icon--green" />
          <div>
            <div className="historico__summary-value mono">{proximas.length}</div>
            <div className="historico__summary-label">Próximas a abrir</div>
          </div>
        </div>
        <div className="historico__summary-card">
          <Clock size={18} className="historico__summary-icon historico__summary-icon--orange" />
          <div>
            <div className="historico__summary-value mono">{cerradas.length}</div>
            <div className="historico__summary-label">Cerradas este ciclo</div>
          </div>
        </div>
      </div>

      {/* Calendar timeline */}
      <div className="historico__calendar">
        {patronesAnuales.map((patron) => {
          const isPast = patron.mesNum < mesActual && anio === 2026;
          const isCurrent = patron.mesNum === mesActual && anio === 2026;

          return (
            <div
              key={patron.mes}
              className={`historico__month ${isPast ? 'historico__month--past' : ''} ${isCurrent ? 'historico__month--current' : ''}`}
            >
              <div className="historico__month-header">
                <span className={`historico__month-name ${isCurrent ? 'historico__month-name--active' : ''}`}>
                  {patron.mes}
                </span>
                <span className="historico__month-count">{patron.fondos.length} fondo{patron.fondos.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="historico__month-items">
                {patron.fondos.map((fondo, i) => (
                  <div key={i} className="historico__fund-item">
                    <div
                      className="historico__fund-dot"
                      style={{ background: sectorColors[fondo.sector] || 'var(--primary)' }}
                    />
                    <div className="historico__fund-info">
                      <span className="historico__fund-name">{fondo.nombre}</span>
                      <div className="historico__fund-meta">
                        <span
                          className="historico__fund-sector"
                          style={{ color: sectorColors[fondo.sector] || 'var(--text-secondary)' }}
                        >
                          {fondo.sector}
                        </span>
                        <span className="historico__fund-prob">
                          <ArrowUpRight size={10} />
                          {fondo.probabilidad}% prob.
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
