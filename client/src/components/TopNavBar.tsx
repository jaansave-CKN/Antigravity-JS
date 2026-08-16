/**
 * TopNavBar — Arquitectura de dos pilares V8.0
 *
 * PILAR IZQUIERDO (Módulos de Gestión):
 *   Radar · Panel · Directorio · Favoritos · Calendario
 *
 * PILAR DERECHO (Ejecución IA 7.0):
 *   Entrada · Anexos · Biblioteca · Logística · Dialéctica · Ficha Técnica · Viabilidad · Check-List
 *
 * Centro: Brand GGIE · RadarFondos + indicador ROOT ONLINE/OFFLINE
 */
import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';
import { useSubscription } from '../contexts/SubscriptionContext';
import UserMenu from './UserMenu';

// ── Tipos ──────────────────────────────────────────────────────────────────────
type RootStatus = 'online' | 'offline' | 'checking';
type ReportState = 'idle' | 'open' | 'sending' | 'sent' | 'error';

// ── Pilares de navegación ──────────────────────────────────────────────────────
const LEFT_LINKS = [
  { to: '/radar',      label: 'Radar',      icon: '◎', requireAuth: false },
  { to: '/panel',      label: 'Panel',      icon: '⊞', requireAuth: false },
  { to: '/directorio', label: 'Directorio', icon: '⊟', requireAuth: false },
  { to: '/favoritos',  label: 'Favoritos',  icon: '♥', requireAuth: true  },
  { to: '/calendario', label: 'Calendario', icon: '◈', requireAuth: true  },
] as const;

const RIGHT_LINKS = [
  { to: '/entrada',    label: 'Entrada',          icon: '①', requireAuth: true  },
  { to: '/dialectica', label: 'Dialéctica',       icon: '◨', requireAuth: true  },
  { to: '/anexos',     label: 'Anexos',           icon: '⊕', requireAuth: true  },
  { to: '/biblioteca', label: 'Biblioteca',       icon: '⊡', requireAuth: true  },
  { to: '/logistica',  label: 'Logística',        icon: '◧', requireAuth: true  },
  { to: '/ficha',      label: 'Ficha Técnica',    icon: '◫', requireAuth: true  },
  { to: '/viabilidad', label: 'Viabilidad',       icon: '◈', requireAuth: true  },
  { to: '/checklist',  label: 'Check-List',       icon: '☑', requireAuth: true  },
] as const;

// ── Hook: estado ROOT (conectividad al backend) ───────────────────────────────
function useRootStatus(): RootStatus {
  const [status, setStatus] = useState<RootStatus>('checking');

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        if (mounted) setStatus(r.ok ? 'online' : 'offline');
      } catch {
        if (mounted) setStatus('offline');
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return status;
}

// ── Componente: botón de reporte de errores ───────────────────────────────────
function ReportErrorButton({ token }: { token: string | null }) {
  const [state, setState] = useState<ReportState>('idle');
  const [message, setMessage] = useState('');

  async function send() {
    if (!message.trim()) return;
    setState('sending');
    try {
      const r = await fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: message.trim(), url: window.location.href }),
      });
      setState(r.ok ? 'sent' : 'error');
      if (r.ok) { setMessage(''); setTimeout(() => setState('idle'), 3000); }
    } catch { setState('error'); }
  }

  if (state === 'open') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
         <input
           autoFocus type="text" value={message}
           onChange={e => setMessage(e.target.value)}
           onKeyDown={e => { if (e.key === 'Enter') send(); if (e.key === 'Escape') setState('idle'); }}
           placeholder="Describe el problema…"
           style={{
             width: 180, padding: '3px 8px',
             background: '#001c2e', border: '1px solid #254b67',
             borderRadius: 3, color: '#d1e8ff', fontSize: 10,
             fontFamily: "'JetBrains Mono', monospace", outline: 'none',
           }}
           maxLength={500}
         />
         <button onClick={send} disabled={!message.trim()} style={btnStyle('#60c9ff', '#003f58')}>
           OK
         </button>
        <button onClick={() => setState('idle')} style={{ background: 'none', border: 'none', color: '#557997', cursor: 'pointer', fontSize: 12 }}>✕</button>
      </div>
    );
  }

  return (
    <button onClick={() => state === 'sent' ? setState('idle') : setState('open')}
      style={{
        background: 'none', border: '1px solid transparent', borderRadius: 3,
        padding: '3px 8px', flexShrink: 0,
        color: state === 'sent' ? '#22c55e' : '#557997',
        cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      }}
    >{state === 'sent' ? '✓' : '⚑'}</button>
  );
}

function btnStyle(bg: string, color: string) {
  return {
    padding: '3px 8px', background: bg, color,
    border: 'none', borderRadius: 3, fontSize: 9, fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer',
  } as const;
}

// ── Componente: indicador ROOT ONLINE / OFFLINE ───────────────────────────────
function RootIndicator({ status }: { status: RootStatus }) {
  const cfg = {
    online:   { color: '#22c55e', label: 'ROOT ONLINE',   blink: true  },
    offline:  { color: '#f87171', label: 'ROOT OFFLINE',  blink: false },
    checking: { color: '#6b7280', label: 'ROOT …',        blink: false },
  }[status];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '2px 10px', borderRadius: 9999,
      background: 'rgba(0,0,0,0.3)',
      border: `1px solid ${cfg.color}33`,
      flexShrink: 0,
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: cfg.color,
        boxShadow: cfg.blink ? `0 0 5px ${cfg.color}` : 'none',
        animation: cfg.blink ? 'tnb-blink 2s infinite' : 'none',
        display: 'block', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 8, fontWeight: 700, color: cfg.color,
        letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        whiteSpace: 'nowrap' as const,
      }}>{cfg.label}</span>
    </div>
  );
}

// ── Componente: un link de nav con soporte de auth gate y plan gate ───────────
function NavItem({
  to, label, icon, requireAuth, isAuthenticated, planLocked,
}: {
  to: string; label: string; icon: string;
  requireAuth: boolean; isAuthenticated: boolean; planLocked?: boolean;
}) {
  const authLocked = requireAuth && !isAuthenticated;
  const locked     = authLocked || planLocked === true;
  const lockTitle  = planLocked
    ? `Upgrade de plan requerido — ${label}`
    : `Iniciar sesión para acceder a ${label}`;

  if (locked) {
    return (
      <span title={lockTitle} style={{
        padding: '3px 9px',
        borderRadius: 3,
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase' as const,
        color: planLocked ? '#3a2d4a' : '#2d4a60',
        cursor: 'not-allowed',
        display: 'flex', alignItems: 'center', gap: 4,
        userSelect: 'none' as const,
      }}>
        <span style={{ fontSize: 8, opacity: 0.5 }}>{planLocked ? '⬡' : '🔒'}</span>
        {label}
      </span>
    );
  }

  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        padding: '3px 9px',
        borderRadius: 3,
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase' as const,
        textDecoration: 'none',
        transition: 'all 0.15s',
        background: isActive ? 'rgba(96,201,255,0.12)' : 'transparent',
        color: isActive ? '#60c9ff' : '#557997',
        border: isActive ? '1px solid rgba(96,201,255,0.25)' : '1px solid transparent',
        display: 'flex', alignItems: 'center', gap: 4,
        whiteSpace: 'nowrap' as const,
      })}
    >
      {label}
    </NavLink>
  );
}

// ── Separador vertical entre pilares ──────────────────────────────────────────
function Divider() {
  return (
    <span style={{
      width: 1, height: 16,
      background: '#1a3a50',
      flexShrink: 0, alignSelf: 'center',
    }} />
  );
}

// ── Rutas de cada pilar ───────────────────────────────────────────────────────
const PILAR_A_PATHS = ['/radar', '/panel', '/directorio', '/favoritos', '/calendario'];
const PILAR_B_PATHS = ['/checklist', '/entrada', '/anexos', '/biblioteca', '/logistica', '/dialectica', '/ficha', '/viabilidad'];

// ── TOPNAVBAR PRINCIPAL ───────────────────────────────────────────────────────
export default function TopNavBar() {
  const { token, user }                    = useAuth();
  const { hasRadar, hasFormulador }        = useSubscription();
  const location   = useLocation();
  const rootStatus = useRootStatus();
  const isLanding  = location.pathname === '/';
  const isAuth     = !!(user && user.role !== 'trial');
  const isDemo     = token === 'demo-mode-token';

  // Pilar que el usuario visita actualmente
  const currentPilar: 'A' | 'B' | null =
    PILAR_A_PATHS.some(p => location.pathname.startsWith(p)) ? 'A' :
    PILAR_B_PATHS.some(p => location.pathname.startsWith(p)) ? 'B' : null;

  // Pilar A bloqueado si: usuario tiene solo plan formulador, O demo en contexto B
  const pilarALocked = (isAuth && !isDemo && hasFormulador && !hasRadar) ||
                       (isDemo && currentPilar === 'B');

  // Pilar B bloqueado si: usuario tiene solo plan radar, O demo en contexto A (no aplica en DEV)
  const pilarBLocked = (!import.meta.env.DEV && isAuth && !isDemo && hasRadar && !hasFormulador) ||
                       (!import.meta.env.DEV && isDemo && currentPilar === 'A');

  return (
    <>
      {/* Animación del dot ROOT */}
      <style>{`
        @keyframes tnb-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>

      <nav style={{
        background:           isLanding ? 'rgba(0, 21, 36, 0.92)' : '#00101c',
        borderBottom:         '1px solid #0d2a3d',
        height:               48,
        display:              'flex',
        alignItems:           'center',
        padding:              '0 1rem',
        gap:                  8,
        flexShrink:           0,
        backdropFilter:       isLanding ? 'blur(16px)' : 'none',
        WebkitBackdropFilter: isLanding ? 'blur(16px)' : 'none',
        position:             isLanding ? 'sticky' : 'relative',
        top:                  isLanding ? 0 : 'auto',
        zIndex:               100,
        overflow:             'hidden',
      }}>
        {/* Wrapper interno relativo: ancla el indicador ROOT al centro real de la barra,
            independiente del ancho desigual de los pilares A/B a los lados. */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)', pointerEvents: 'auto',
          }}>
            <RootIndicator status={rootStatus} />
          </div>
        </div>

        {/* ── BRAND ─────────────────────────────────────────────────────────── */}
        <NavLink to="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12, fontWeight: 700, color: '#60c9ff',
            letterSpacing: '0.04em', whiteSpace: 'nowrap',
          }}>
            INICIO
          </span>
        </NavLink>

        <Divider />

        {/* ── PILAR IZQUIERDO: Módulos de Gestión ───────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 1,
          borderLeft: '1px solid #0d2a3d', paddingLeft: 6,
        }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 7, fontWeight: 700, color: '#2d4a60',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            marginRight: 4, whiteSpace: 'nowrap',
          }}>A</span>
          {LEFT_LINKS.map(link => {
            // Bloqueado a nivel de pilar (usuario en contexto B o solo tiene plan formulador)
            if (pilarALocked) {
              return (
                <span key={link.to} title="Módulo A · Radar de Fondos — no activo en este contexto" style={{
                  padding: '3px 9px', borderRadius: 3, fontSize: 9,
                  fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                  letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                  color: '#1a3a50', cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 4,
                  userSelect: 'none' as const,
                }}>
                  <span style={{ fontSize: 8, opacity: 0.4 }}>⬡</span>{link.label}
                </span>
              );
            }
            // Favoritos y Calendario requieren plan Radar además de auth
            const requiresPlan = link.to === '/favoritos' || link.to === '/calendario';
            const planLocked   = isAuth && link.requireAuth && requiresPlan && !hasRadar;
            return <NavItem key={link.to} {...link} isAuthenticated={isAuth} planLocked={planLocked} />;
          })}
        </div>

        <Divider />

        {/* ── CENTRO: espaciador — el indicador ROOT real vive anclado al centro absoluto de la barra ── */}
        <div style={{ flex: 1 }} />

        <Divider />

        {/* ── PILAR DERECHO: Ejecución IA 7.0 ──────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 1,
          borderRight: '1px solid #0d2a3d', paddingRight: 6,
        }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 7, fontWeight: 700, color: '#2d4a60',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            marginRight: 4, whiteSpace: 'nowrap',
          }}>B</span>
          {RIGHT_LINKS.map(link => {
            const isMotor = link.to === '/checklist';
            // Bloqueado a nivel de pilar (usuario en contexto A o solo tiene plan radar)
            if (pilarBLocked) {
              return (
                <span key={link.to} title="Módulo B · Check-List — no activo en este contexto" style={{
                  padding: '3px 9px', borderRadius: 3, fontSize: 9,
                  fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                  letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                  color: '#2a1a4a', cursor: 'not-allowed', display: 'flex', alignItems: 'center', gap: 4,
                  userSelect: 'none' as const,
                }}>
                  <span style={{ fontSize: 8, opacity: 0.4 }}>⬡</span>{link.label}
                </span>
              );
            }
            const planLocked = !import.meta.env.DEV && isAuth && link.requireAuth && !hasFormulador;
            return (
              <span key={link.to} style={isMotor ? { background: 'rgba(189,194,255,0.06)', borderRadius: 4, padding: '0 2px' } : undefined}>
                <NavItem {...link} isAuthenticated={isAuth} planLocked={planLocked} />
              </span>
            );
          })}
        </div>

        <Divider />

        {/* ── Auth + Report ──────────────────────────────────────────────────── */}
        {!isAuth ? (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <NavLink to="/login" style={{ textDecoration: 'none' }}>
              <span style={{
                padding: '3px 10px', borderRadius: 3,
                background: 'rgba(96,201,255,0.08)',
                border: '1px solid rgba(96,201,255,0.25)',
                color: '#60c9ff', fontSize: 9, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>LOGIN</span>
            </NavLink>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {token && <ReportErrorButton token={token} />}
            <UserMenu />
          </div>
        )}
      </nav>
    </>
  );
}
