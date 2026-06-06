/**
 * ModuloProximamente — Placeholder para módulos IA 7.0 en desarrollo.
 * Recibe `nombre` e `icono` para identificar el módulo.
 */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap');
  @keyframes mp-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
`;

interface Props {
  nombre: string;
  icono:  string;
  descripcion?: string;
}

export default function ModuloProximamente({ nombre, icono, descripcion }: Props) {
  return (
    <>
      <style>{CSS}</style>
      <div style={{
        minHeight: 'calc(100vh - 48px)',
        background: '#00101c',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem',
      }}>
        <div style={{
          background: '#001524',
          border: '1px solid #1a3a50',
          borderRadius: 12,
          padding: '3rem 2.5rem',
          maxWidth: 480,
          width: '100%',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16, animation: 'mp-pulse 2s infinite' }}>
            {icono}
          </div>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9, fontWeight: 700, color: '#254b67',
            letterSpacing: '0.12em', textTransform: 'uppercase',
            marginBottom: 8,
          }}>Módulo IA 7.0</p>
          <h2 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 20, fontWeight: 700, color: '#60c9ff',
            letterSpacing: '-0.01em', marginBottom: 12,
          }}>{nombre}</h2>
          {descripcion && (
            <p style={{
              fontSize: 13, color: '#8bafcf', lineHeight: 1.6,
              marginBottom: 24, fontFamily: 'system-ui, sans-serif',
            }}>{descripcion}</p>
          )}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(96,201,255,0.06)',
            border: '1px solid rgba(96,201,255,0.15)',
            borderRadius: 9999, padding: '6px 16px',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#f59e0b',
              animation: 'mp-pulse 1.5s infinite',
              display: 'block',
            }} />
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9, fontWeight: 700, color: '#f59e0b',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>En desarrollo · Disponible en V9.0</span>
          </div>
        </div>
      </div>
    </>
  );
}
