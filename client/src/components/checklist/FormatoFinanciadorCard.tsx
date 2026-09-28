import { T } from './checklistModulos';

// Formato del Financiador — solo lectura, definido en Entrada.
export default function FormatoFinanciadorCard({ formato }: { formato: string }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 9999, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: T.primarySoft, border: `1px solid ${T.primaryBorder}`,
          color: T.primary, fontSize: 10, fontWeight: 700, fontFamily: "'Inter', sans-serif",
        }}>05</span>
        <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 700, color: T.primary, letterSpacing: '0.01em' }}>
          Formato del Financiador
        </h2>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 11, color: T.textHint }}>
        Este valor se define en la ventana Entrada — aquí solo se muestra automáticamente.
      </p>

      <div style={{
        background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: formato ? T.primary : T.border,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: formato ? T.text : T.textMuted, fontFamily: "'Inter', sans-serif" }}>
          {formato || 'Sin definir — selecciónalo en Entrada'}
        </span>
      </div>
    </div>
  );
}
