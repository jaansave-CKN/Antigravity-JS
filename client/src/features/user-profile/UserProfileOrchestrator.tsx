import { useState } from 'react';
import { useUserProfile } from './hooks/useUserProfile';
import type { EngineCardState } from './types';

// ── Dark-mode tokens (sincronizados con index.css :root) ──────────────────────
const T = {
  bg:          '#0b1326',
  surface:     '#131b2e',
  surfaceHigh: '#222a3e',
  outline:     '#3e484f',
  text:        '#dbe2fd',
  textMuted:   '#bdc8d1',
  textDim:     '#87929a',
  primary:     '#38bdf8',
  tertiary:    '#52e87c',
  tertiaryCont:'#2ccb63',
  error:       '#f87171',
  inputBg:     '#060d20',
} as const;

// ── Animación de pulso (inyectada en DOM una vez) ─────────────────────────────
const PULSE_CSS = `
  @keyframes upo-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }
  @keyframes upo-in    { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
  .upo-card { animation: upo-in .35s ease both; }
`;

// ── Sub-componente: tarjeta de motor ──────────────────────────────────────────
function EngineCard({
  engine,
  onActivate,
  disabled,
}: {
  engine:     EngineCardState;
  onActivate: () => void;
  disabled:   boolean;
}) {
  const isConnected = engine.status === 'connected';
  const color = isConnected ? T.tertiary : T.textDim;
  const bgColor = isConnected
    ? 'rgba(82,232,124,0.08)'
    : `${T.surfaceHigh}99`;

  return (
    <div className="upo-card" style={{
      background: bgColor,
      border: `1px solid ${isConnected ? 'rgba(82,232,124,0.25)' : T.outline}`,
      borderRadius: '10px',
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      transition: 'all 0.2s',
    }}>
      {/* Indicador de pulso */}
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: isConnected ? T.tertiary : T.textDim,
        animation: isConnected ? 'upo-pulse 2s infinite' : 'none',
        boxShadow: isConnected ? `0 0 6px ${T.tertiary}` : 'none',
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: T.text, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {engine.label}
        </p>
        {engine.lastActivity ? (
          <p style={{ fontSize: 10, color: T.textDim, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
            Última actividad: {new Date(engine.lastActivity).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
        ) : (
          <p style={{ fontSize: 10, color: T.textDim, margin: 0 }}>
            {isConnected ? 'Activo · esperando consulta' : 'Sin conexión activa'}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onActivate}
        disabled={disabled || isConnected}
        style={{
          flexShrink: 0,
          background: isConnected ? 'rgba(82,232,124,0.12)' : 'rgba(56,189,248,0.10)',
          border: `1px solid ${isConnected ? 'rgba(82,232,124,0.35)' : 'rgba(56,189,248,0.30)'}`,
          color: isConnected ? T.tertiary : T.primary,
          borderRadius: '6px', padding: '6px 12px',
          fontSize: 10, fontWeight: 700, cursor: isConnected ? 'default' : 'pointer',
          letterSpacing: '0.05em', textTransform: 'uppercase',
          transition: 'all 0.15s',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {isConnected ? '✓ Activo' : 'Conectar'}
      </button>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
interface UserProfileOrchestratorProps {
  authToken: string | null;
}

export default function UserProfileOrchestrator({ authToken }: UserProfileOrchestratorProps) {
  const {
    profile,
    engines,
    loading,
    error,
    connectGoogle,
    disconnectGoogle,
    activateEngine,
    saveIdentity,
  } = useUserProfile(authToken);

  const [name, setName]       = useState(profile.identity.name);
  const [email, setEmail]     = useState(profile.identity.email);
  const [saveOk, setSaveOk]   = useState(false);

  const isDemoMode = !authToken || authToken === 'demo-mode-token';
  const googleConnected = profile.connections.googleDrive.connected;
  const isSecured = profile.security.encryptionStatus === 'secured';

  async function handleSave() {
    await saveIdentity(name, email);
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2000);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: T.inputBg,
    border: `1px solid ${T.outline}`,
    borderRadius: 6, padding: '9px 12px',
    color: T.text, fontSize: 13, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: T.textMuted, marginBottom: 6, letterSpacing: '0.02em',
  };

  return (
    <>
      <style>{PULSE_CSS}</style>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px',
        fontFamily: "'Hanken Grotesk', 'Inter', system-ui, sans-serif",
        color: T.text,
      }}>

        {/* ── Panel izquierdo: Identidad + Google SSO ── */}
        <div style={{
          background: T.surface, borderRadius: '12px',
          padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.30)',
          display: 'flex', flexDirection: 'column', gap: '16px',
        }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
            ◈ Perfil de Usuario
          </p>

          {/* Identidad */}
          <div>
            <label style={labelStyle}>Nombre Completo</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Ej: Juan Pérez" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Correo Electrónico</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="operador@institucion.gov" style={inputStyle} />
          </div>

          {/* Seguridad */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: isSecured ? 'rgba(82,232,124,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${isSecured ? 'rgba(82,232,124,0.25)' : 'rgba(248,113,113,0.25)'}`,
            borderRadius: 8, padding: '8px 12px',
          }}>
            <span style={{ fontSize: 14 }}>{isSecured ? '🔒' : '⚠️'}</span>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: isSecured ? T.tertiary : T.error, margin: 0 }}>
                {isSecured ? 'Cifrado activo — datos seguros' : 'Cifrado pendiente'}
              </p>
              <p style={{ fontSize: 10, color: T.textDim, margin: 0 }}>
                Credenciales inyectadas via proxy backend:8000
              </p>
            </div>
          </div>

          {/* Google SSO — interruptor maestro */}
          <div style={{
            borderTop: `1px solid ${T.outline}`, paddingTop: 16,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
              Interruptor Maestro — Google SSO
            </p>
            <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>
              Al conectar, el sistema autoconfigura el acceso a Drive e IA de forma invisible.
            </p>
            {googleConnected ? (
              <button type="button" onClick={disconnectGoogle} disabled={loading} style={{
                alignSelf: 'flex-start',
                background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)',
                color: T.error, borderRadius: 6, padding: '8px 16px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s',
              }}>
                ✓ Google Conectado · Desconectar
              </button>
            ) : (
              <button type="button" onClick={connectGoogle} disabled={isDemoMode || loading} style={{
                alignSelf: 'flex-start',
                background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.35)',
                color: T.primary, borderRadius: 6, padding: '8px 16px',
                fontSize: 11, fontWeight: 700, cursor: isDemoMode ? 'not-allowed' : 'pointer',
                letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s',
                opacity: isDemoMode ? 0.4 : 1,
              }}>
                Conectar con Google
              </button>
            )}
            {isDemoMode && (
              <p style={{ fontSize: 10, color: T.textDim, margin: 0 }}>
                Disponible con cuenta real — modo demo activo
              </p>
            )}
          </div>

          {/* Botón guardar */}
          {error && <p style={{ fontSize: 11, color: T.error, margin: 0 }}>{error}</p>}
          <button type="button" onClick={handleSave} disabled={loading} style={{
            alignSelf: 'flex-start',
            background: saveOk ? 'rgba(44,203,99,0.15)' : 'rgba(56,189,248,0.12)',
            border: `1px solid ${saveOk ? 'rgba(44,203,99,0.45)' : 'rgba(56,189,248,0.35)'}`,
            color: saveOk ? T.tertiaryCont : T.primary,
            borderRadius: 6, padding: '10px 16px',
            fontSize: 11, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '0.06em', textTransform: 'uppercase', transition: 'all 0.15s',
          }}>
            {saveOk ? '✓ GUARDADO' : 'Guardar Perfil'}
          </button>
        </div>

        {/* ── Panel derecho: Motores de IA ── */}
        <div style={{
          background: T.surface, borderRadius: '12px',
          padding: '24px', border: `1px solid ${T.outline}`,
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.30)',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
            ✦ Motores de Inteligencia
          </p>
          <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>
            La activación requiere conexión Google activa. Las credenciales viajan cifradas via proxy backend.
          </p>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ height: 64, background: T.surfaceHigh, borderRadius: 10, opacity: 0.5,
                  animation: 'upo-pulse 1.5s infinite' }} />
              ))}
            </div>
          ) : (
            engines.map(engine => (
              <EngineCard
                key={engine.key}
                engine={engine}
                onActivate={() => activateEngine(engine.key)}
                disabled={isDemoMode || (!googleConnected && engine.key !== 'googleDrive')}
              />
            ))
          )}

          {/* StatusBox canal unificado */}
          <div style={{
            background: 'rgba(82,232,124,0.08)', border: '1px solid rgba(82,232,124,0.20)',
            borderRadius: 8, padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.tertiary,
              animation: 'upo-pulse 2s infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 11, color: T.tertiary, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>
              Canal unificado streamable-http listo · backend:8000
            </p>
          </div>
        </div>

      </div>
    </>
  );
}
