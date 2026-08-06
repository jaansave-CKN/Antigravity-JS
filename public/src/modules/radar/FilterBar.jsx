import { Search, Filter, X } from 'lucide-react';

const SECTORS = ['Educación', 'Salud', 'Vivienda', 'Transporte', 'Agropecuario', 'Agua Potable', 'Cultura', 'Deporte', 'Medio Ambiente', 'Tecnología', 'General'];

export default function FilterBar({ query, sector, onQuery, onSector, onClear }) {
  const hasFilter = query || sector;

  return (
    <div style={{ padding: '12px 24px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #1f2937' }}>
      {/* Search */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
        <input
          type="text"
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder="Buscar por título, entidad o sector..."
          style={{
            width: '100%', background: '#1f2937', border: '1px solid #374151',
            borderRadius: 8, padding: '9px 12px 9px 36px', color: '#f1f5f9',
            fontSize: 13, outline: 'none', transition: 'border-color 0.15s',
            boxSizing: 'border-box',
          }}
          onFocus={e => { e.target.style.borderColor = '#3b82f6'; }}
          onBlur={e => { e.target.style.borderColor = '#374151'; }}
        />
      </div>

      {/* Sector filter */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Filter size={14} style={{ position: 'absolute', left: 10, color: '#64748b', pointerEvents: 'none' }} />
        <select
          value={sector}
          onChange={e => onSector(e.target.value)}
          style={{
            background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
            padding: '9px 12px 9px 30px', color: sector ? '#f1f5f9' : '#64748b',
            fontSize: 13, outline: 'none', cursor: 'pointer', appearance: 'none',
            minWidth: 150,
          }}>
          <option value="">Todos los sectores</option>
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Clear */}
      {hasFilter && (
        <button
          onClick={onClear}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <X size={13} /> Limpiar
        </button>
      )}
    </div>
  );
}
