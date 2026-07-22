/**
 * CalendarioPage — Calco estricto Stitch screen "Calendario de Favoritos - Azul Ideal Desktop"
 * Fuente: projects/3791086755596777919/screens/dea6a29baece4040983fd48c2c7c326b
 * Tokens: bg #f7f9fb · primary #0037b0 · outline-variant #c4c5d7 · Public Sans
 */
import { useMemo, useState } from 'react';
import './CalendarioPage.css';

interface EventoCal {
  dia: number;
  mes: number; // 0-index
  anio: number;
  titulo: string;
  tipo: 'primary' | 'today' | 'neutral-green' | 'neutral-secondary' | 'error';
}

const EVENTOS: EventoCal[] = [
  { dia: 5,  mes: 2, anio: 2024, titulo: 'USAID Local - 12:00',        tipo: 'primary' },
  { dia: 6,  mes: 2, anio: 2024, titulo: 'Fundación FORD - 15:00',     tipo: 'today' },
  { dia: 14, mes: 2, anio: 2024, titulo: 'MinCiencias - 17:00',        tipo: 'neutral-green' },
  { dia: 14, mes: 2, anio: 2024, titulo: 'SENA Fondo Emprender',       tipo: 'neutral-secondary' },
  { dia: 20, mes: 2, anio: 2024, titulo: 'Cierre CAF - 23:59',         tipo: 'error' },
];

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

export default function CalendarioPage() {
  const [anio, setAnio] = useState(2024);
  const [mes, setMes] = useState(2); // Marzo 2024 — mes de la fuente Stitch
  const [vista, setVista] = useState<'mes' | 'semana'>('mes');

  const hoy = { dia: 6, mes: 2, anio: 2024 }; // Today indicator de la fuente

  const celdas = useMemo(() => {
    const primerDia = new Date(anio, mes, 1).getDay();
    const diasMes = new Date(anio, mes + 1, 0).getDate();
    const diasMesPrev = new Date(anio, mes, 0).getDate();
    const cells: { dia: number; fuera: boolean }[] = [];
    for (let i = primerDia - 1; i >= 0; i--) cells.push({ dia: diasMesPrev - i, fuera: true });
    for (let d = 1; d <= diasMes; d++) cells.push({ dia: d, fuera: false });
    while (cells.length % 7 !== 0) cells.push({ dia: cells.length - (primerDia + diasMes) + 1, fuera: true });
    return cells;
  }, [anio, mes]);

  const navegarMes = (delta: number) => {
    let m = mes + delta, a = anio;
    if (m < 0) { m = 11; a--; }
    if (m > 11) { m = 0; a++; }
    setMes(m); setAnio(a);
  };

  const eventosDe = (dia: number) =>
    EVENTOS.filter(e => e.dia === dia && e.mes === mes && e.anio === anio);

  const esHoy = (dia: number) => dia === hoy.dia && mes === hoy.mes && anio === hoy.anio;

  const exportarICS = () => {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RadarFormulador360//Calendario//ES'];
    EVENTOS.forEach((e, i) => {
      const dt = `${e.anio}${String(e.mes + 1).padStart(2, '0')}${String(e.dia).padStart(2, '0')}`;
      lines.push('BEGIN:VEVENT', `UID:rf360-${i}@radarformulador`, `DTSTART;VALUE=DATE:${dt}`, `SUMMARY:${e.titulo}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calendario_convocatorias.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="calpage">
      {/* Content Header */}
      <div className="calpage__header">
        <div>
          <h2 className="calpage__title">Calendario convocatorias</h2>
          <p className="calpage__subtitle">Fechas críticas para sus convocatorias seleccionadas</p>
        </div>
        <div className="calpage__header-actions">
          <button className="calpage__iconbtn" title="Filtrar" aria-label="Filtrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
          </button>
          <button className="calpage__iconbtn" title="Descargar .ics" aria-label="Descargar" onClick={exportarICS}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </div>

      {/* Calendar Container */}
      <div className="calpage__container">
        {/* Controls */}
        <div className="calpage__controls">
          <div className="calpage__nav">
            <button className="calpage__navbtn" onClick={() => navegarMes(-1)} aria-label="Mes anterior">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h3 className="calpage__month">{MESES[mes]} {anio}</h3>
            <button className="calpage__navbtn" onClick={() => navegarMes(1)} aria-label="Mes siguiente">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div className="calpage__toggle">
            <button className={vista === 'mes' ? 'calpage__togglebtn calpage__togglebtn--active' : 'calpage__togglebtn'} onClick={() => setVista('mes')}>Mes</button>
            <button className={vista === 'semana' ? 'calpage__togglebtn calpage__togglebtn--active' : 'calpage__togglebtn'} onClick={() => setVista('semana')}>Semana</button>
          </div>
        </div>

        {/* Grid */}
        <div className="calpage__grid-wrap">
          <div className="calpage__days-header">
            {DIAS.map((d, i) => (
              <div key={d} className={i === 0 ? 'calpage__dayname' : 'calpage__dayname calpage__dayname--bl'}>{d}</div>
            ))}
          </div>
          <div className="calpage__grid" style={{ gridTemplateRows: `repeat(${celdas.length / 7}, 1fr)` }}>
            {celdas.map((c, i) => {
              const evs = c.fuera ? [] : eventosDe(c.dia);
              const today = !c.fuera && esHoy(c.dia);
              const cls = [
                'calpage__cell',
                i % 7 !== 0 ? 'calpage__cell--bl' : '',
                i < celdas.length - 7 ? 'calpage__cell--bb' : '',
                c.fuera ? 'calpage__cell--out' : '',
                today ? 'calpage__cell--today' : '',
              ].filter(Boolean).join(' ');
              return (
                <div key={i} className={cls}>
                  {today && <div className="calpage__today-bar" />}
                  <span className={c.fuera ? 'calpage__daynum calpage__daynum--out' : today ? 'calpage__daynum calpage__daynum--today' : 'calpage__daynum'}>
                    {c.dia}
                  </span>
                  {evs.map((e, k) => (
                    <div key={k} className={`calpage__event calpage__event--${e.tipo}`}>
                      {e.tipo === 'error' && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      )}
                      {(e.tipo === 'primary' || e.tipo === 'neutral-green' || e.tipo === 'neutral-secondary') && (
                        <span className={`calpage__dot calpage__dot--${e.tipo}`} />
                      )}
                      <span className="calpage__event-text">{e.titulo}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
