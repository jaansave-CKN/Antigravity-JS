import { Database, Zap, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

const parseNum = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v.replace(/[^0-9]/g, '')) || 0;
  return 0;
};

export default function KPICards({ data, status, loading }) {
  const total    = data.length;
  const abiertos = data.filter(d => d.estado === 'Abierto').length;
  const criticos = data.filter(d => d.estado === 'Crítico' || d.estado === 'Próximo a vencer').length;
  const isLive   = status === 'Live & Online';

  const cards = [
    {
      label: 'Total Convocatorias',
      value: loading ? '—' : total,
      sub:   'registradas en el radar',
      Icon:  Database,
      color: '#38bdf8',
      bg:    'rgba(56,189,248,0.10)',
      border:'rgba(56,189,248,0.25)',
    },
    {
      label: 'Abiertas / Activas',
      value: loading ? '—' : abiertos,
      sub:   'disponibles para aplicar',
      Icon:  Zap,
      color: '#22c55e',
      bg:    'rgba(34,197,94,0.10)',
      border:'rgba(34,197,94,0.22)',
    },
    {
      label: 'Críticas / Por Vencer',
      value: loading ? '—' : criticos,
      sub:   'requieren acción inmediata',
      Icon:  AlertTriangle,
      color: '#f59e0b',
      bg:    'rgba(245,158,11,0.10)',
      border:'rgba(245,158,11,0.22)',
    },
    {
      label: 'Canal Live',
      value: isLive ? 'Online' : 'Offline',
      sub:   isLive ? 'WebSocket activo' : 'Sin conexión al servidor',
      Icon:  isLive ? Wifi : WifiOff,
      color: isLive ? '#22c55e' : '#ef4444',
      bg:    isLive ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
      border:isLive ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)',
    },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12,
      padding: '24px 24px 0',
      background: '#0b1326',
    }}>
      {cards.map(({ label, value, sub, Icon, color, bg, border }) => (
        <div key={label} style={{
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: '14px 16px',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          transition: 'border-color 0.3s',
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9,
            background: `${color}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon size={19} style={{ color }} />
          </div>
          <div>
            <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 22, lineHeight: 1 }}>
              {value}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, fontWeight: 600 }}>
              {label}
            </div>
            <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>
              {sub}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
