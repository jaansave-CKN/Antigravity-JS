/**
 * GraficoFinanciero — envoltorio Recharts para gráficas financieras
 * (presupuesto, costos APU, flujo de caja, valoración inmobiliaria).
 *
 * Mandato "Motor de Diagramación ISO 9000" (2026-08-17): eje Y y tooltips
 * SIEMPRE en COP (Intl.NumberFormat('es-CO', ...) vía lib/currencyFormat —
 * mismo formateador ya usado en Presupuesto/Viabilidad/Planes, sin
 * reinventarlo aquí).
 *
 * Expone un ref al contenedor para que quien necesite incrustar el gráfico
 * en un PDF (ver backend/services/svgEmbed.js) pueda leer el <svg> real que
 * Recharts ya renderiza en el DOM (contenedorRef.current.querySelector('svg')).
 */
import { forwardRef } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { formatCOP } from '../lib/currencyFormat';

export interface SerieFinanciera {
  clave: string;
  nombre: string;
  color?: string;
}

interface GraficoFinancieroProps {
  data: Array<Record<string, unknown>>;
  tipo?: 'linea' | 'barra';
  claveX: string;
  series: SerieFinanciera[];
  alto?: number;
  titulo?: string;
}

const PALETA_DEFECTO = ['#0058be', '#2e7d32', '#b45309', '#ba1a1a', '#6d28d9'];

const GraficoFinanciero = forwardRef<HTMLDivElement, GraficoFinancieroProps>(
  ({ data, tipo = 'barra', claveX, series, alto = 280, titulo }, ref) => {
    const Chart = tipo === 'linea' ? LineChart : BarChart;

    return (
      <div ref={ref} data-grafico-financiero="true">
        {titulo && (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#191c1e', marginBottom: 8 }}>{titulo}</div>
        )}
        <ResponsiveContainer width="100%" height={alto}>
          <Chart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e5" />
            <XAxis dataKey={claveX} tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={formatCOP} width={90} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => formatCOP(Number(value))} />
            <Legend />
            {series.map((s, i) => {
              const color = s.color ?? PALETA_DEFECTO[i % PALETA_DEFECTO.length];
              return tipo === 'linea'
                ? <Line key={s.clave} type="monotone" dataKey={s.clave} name={s.nombre} stroke={color} strokeWidth={2} dot={false} />
                : <Bar key={s.clave} dataKey={s.clave} name={s.nombre} fill={color} />;
            })}
          </Chart>
        </ResponsiveContainer>
      </div>
    );
  }
);
GraficoFinanciero.displayName = 'GraficoFinanciero';

export default GraficoFinanciero;
