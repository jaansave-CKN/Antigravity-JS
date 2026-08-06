import { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, ExternalLink, Star, AlertCircle } from 'lucide-react';

const ESTADO_STYLE = {
  'Abierto':           { bg: 'rgba(34,197,94,0.15)',   color: '#4ade80',  border: 'rgba(34,197,94,0.3)' },
  'En Evaluación':     { bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa',  border: 'rgba(59,130,246,0.3)' },
  'Crítico':           { bg: 'rgba(239,68,68,0.15)',   color: '#f87171',  border: 'rgba(239,68,68,0.3)' },
  'Próximo a vencer':  { bg: 'rgba(245,158,11,0.15)',  color: '#fbbf24',  border: 'rgba(245,158,11,0.3)' },
};

function EstadoBadge({ estado }) {
  const s = ESTADO_STYLE[estado] ?? { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', border: 'rgba(100,116,139,0.3)' };
  return (
    <span style={{
      fontSize: 11, padding: '3px 9px', borderRadius: 20, fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {estado}
    </span>
  );
}

function DetailPanel({ item }) {
  return (
    <tr>
      <td colSpan={7} style={{ background: '#171f33', padding: 0, borderBottom: '2px solid #38bdf8' }}>
        <div style={{ padding: '18px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>Entidad</div>
            <div style={{ color: '#f1f5f9', fontSize: 13 }}>{item.entidad}</div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>Región</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>{item.region}</div>
          </div>
          <div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>Presupuesto</div>
            <div style={{ color: '#4ade80', fontSize: 14, fontWeight: 700, fontFamily: 'monospace' }}>{item.presupuesto}</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>Objeto</div>
            <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.6 }}>{item.objeto}</div>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 6 }}>
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '7px 14px', background: '#3b82f6', color: '#fff',
                borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none',
              }}>
                <ExternalLink size={13} /> Ver Convocatoria
              </a>
            )}
            <button style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '7px 14px', background: 'rgba(59,130,246,0.12)',
              color: '#60a5fa', borderRadius: 7, fontSize: 12, fontWeight: 600,
              border: '1px solid rgba(59,130,246,0.25)', cursor: 'pointer',
            }}>
              <Star size={13} /> Guardar en Favoritos
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function DataTable({ data, loading, flashIds = new Set(), newItemIds = new Set() }) {
  const [expanded, setExpanded] = useState(null);

  const toggle = (id) => setExpanded(prev => prev === id ? null : id);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <RefreshCw size={34} className="animate-spin" style={{ color: '#3b82f6' }} />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#64748b', padding: 60 }}>
        <AlertCircle size={38} />
        <span style={{ fontSize: 14 }}>Sin convocatorias para mostrar</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 32px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#060e20' }}>
            {['ID', 'Entidad', 'Objeto', 'Región', 'Presupuesto', 'Estado', 'Cierre'].map(h => (
              <th key={h} style={{
                padding: '10px 12px', textAlign: 'left', color: '#64748b',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 0.6, borderBottom: '1px solid #3e484f',
                whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
            <th style={{ width: 32, borderBottom: '1px solid #3e484f' }} />
          </tr>
        </thead>
        <tbody>
          {data.map((item) => {
            const isNew    = newItemIds.has(item.id);
            const isFlash  = flashIds.has(item.id);
            const isOpen   = expanded === item.id;
            const rowClass = isNew ? 'row-new' : (isFlash ? 'row-flash' : '');

            return (
              <>
                <tr
                  key={item.id}
                  className={rowClass}
                  onClick={() => toggle(item.id)}
                  style={{
                    borderBottom: '1px solid #3e484f',
                    cursor: 'pointer',
                    background: isOpen ? '#111b2e' : undefined,
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#131b2e'; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = ''; }}
                >
                  <td style={{ padding: '11px 12px', color: '#475569', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {item.id}
                  </td>
                  <td style={{ padding: '11px 12px', color: '#93c5fd', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {item.entidad}
                  </td>
                  <td style={{ padding: '11px 12px', color: '#e2e8f0', fontSize: 12, maxWidth: 260 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.objeto}
                    </div>
                  </td>
                  <td style={{ padding: '11px 12px', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {item.region}
                  </td>
                  <td style={{ padding: '11px 12px', color: '#4ade80', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {item.presupuesto}
                  </td>
                  <td style={{ padding: '11px 12px' }}>
                    <EstadoBadge estado={item.estado} />
                  </td>
                  <td style={{ padding: '11px 12px', color: '#64748b', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {item.fecha_cierre}
                  </td>
                  <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                    {isOpen
                      ? <ChevronUp  size={14} style={{ color: '#3b82f6' }} />
                      : <ChevronDown size={14} style={{ color: '#475569' }} />
                    }
                  </td>
                </tr>
                {isOpen && <DetailPanel key={`d-${item.id}`} item={item} />}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
