import { T, type ModuloEstado } from './checklistModulos';

// Fila de avance de un módulo — solo lectura, navega al módulo al hacer clic.
function ModuloRow({ m, onNavigate }: { m: ModuloEstado; onNavigate: (route: string) => void }) {
  const isDone = m.status.percent === 100;
  return (
    <button
      onClick={() => onNavigate(m.route)}
      title="Ir al módulo"
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 20px', textAlign: 'left',
        background: T.card,
        border: `1px solid ${isDone ? T.successBorder : T.border}`,
        borderRadius: 12, cursor: 'pointer', width: '100%', fontFamily: T.font,
      }}
    >
      <span style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isDone ? T.success : m.status.percent > 0 ? T.primarySoft : T.bg,
        color: '#ffffff', fontSize: 13, fontWeight: 700,
      }}>
        {isDone ? '✓' : <span style={{ fontSize: 9, fontWeight: 800, color: m.status.percent > 0 ? T.primary : T.textMuted }}>{m.status.percent}</span>}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T.text }}>
          {m.label}
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: T.textHint, lineHeight: 1.5 }}>
          {m.hint}
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: isDone ? T.success : T.primary }}>
          {m.status.percent}%
        </span>
        <span style={{ fontSize: 10.5, color: T.textMuted, whiteSpace: 'nowrap' }}>
          {m.status.detail}
        </span>
      </div>
    </button>
  );
}

// Avance por módulo — solo lectura.
export default function ModulosLista({ estados, onNavigate }: { estados: ModuloEstado[]; onNavigate: (route: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {estados.map(m => <ModuloRow key={m.route} m={m} onNavigate={onNavigate} />)}
    </div>
  );
}
