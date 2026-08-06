import { NavLink, useLocation } from 'react-router-dom';
import { useSubscription } from '../contexts/SubscriptionContext';

// ── Tokens idénticos a entr__sidebar / entr__sidebar-link ─────────────────────
// Fuente: EntradaPage.css — tolerancia cero a desviaciones

const HIDDEN_ON = new Set(['/']);

// Mismo criterio que TopNavBar.tsx: dentro de PILAR A solo Favoritos/Calendario
// requieren plan Radar (Radar/Panel/Directorio son públicos ahí y en main.tsx).
// PILAR B completo requiere plan Formulador — las 8 rutas están detrás de
// PlanGate require="formulador" en main.tsx.
const PLAN_REQUERIDO_A = new Set(['/favoritos', '/calendario']);

const PILAR_A = [
  { to: '/radar',      label: 'Radar',           icon: 'radar'          },
  { to: '/panel',      label: 'Panel',            icon: 'dashboard'      },
  { to: '/directorio', label: 'Directorio',       icon: 'contacts'       },
  { to: '/favoritos',  label: 'Favoritos',        icon: 'favorite'       },
  { to: '/calendario', label: 'Calendario',       icon: 'calendar_month' },
];

const PILAR_B = [
  { to: '/entrada',    label: 'Entrada',          icon: 'home_pin'       },
  { to: '/contexto',   label: 'Contexto',         icon: 'manage_search'  },
  { to: '/dialectica', label: 'Dialéctica',       icon: 'forum'          },
  { to: '/anexos',     label: 'Anexos',           icon: 'attach_file'    },
  { to: '/logistica',  label: 'Logística',        icon: 'route'          },
  { to: '/presupuesto',label: 'Presupuesto',      icon: 'payments'       },
  { to: '/ficha',      label: 'Ficha Técnica',    icon: 'id_card'        },
  { to: '/viabilidad', label: 'Viabilidad',       icon: 'analytics'      },
  { to: '/checklist',  label: 'Check-List',       icon: 'checklist'      },
];

export default function AppLeftNav() {
  const { pathname } = useLocation();
  const { hasRadar, hasFormulador } = useSubscription();
  if (HIDDEN_ON.has(pathname)) return null;

  // demo-mode-token resuelve hasRadar/hasFormulador en false siempre
  // (SubscriptionContext.tsx) — sin este bypass, cualquier sesión de
  // desarrollo local quedaría con el nav lateral completo bloqueado.
  const devBypass = import.meta.env.DEV;

  return (
    <aside style={{
      width: 220,
      flexShrink: 0,
      background: '#f0f2f4',
      borderRight: '1px solid #e0e3e5',
      padding: '16px 0',
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
      height: 'calc(100vh - 48px)',
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      <nav style={{
        flex: 1,
        padding: '0 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        {/* Sección A */}
        <SectionLabel label="PILAR A" />
        {PILAR_A.map(l => {
          const locked = !devBypass && PLAN_REQUERIDO_A.has(l.to) && !hasRadar;
          return locked
            ? <LockedNavItem key={l.to} {...l} reason="Plan Radar requerido" />
            : <NavItem key={l.to} {...l} />;
        })}

        {/* Divisor */}
        <div style={{ height: 1, background: '#e0e3e5', margin: '8px 2px' }} />

        {/* Sección B */}
        <SectionLabel label="PILAR B" />
        {PILAR_B.map(l => {
          const locked = !devBypass && !hasFormulador;
          return locked
            ? <LockedNavItem key={l.to} {...l} reason="Plan Formulador requerido" />
            : <NavItem key={l.to} {...l} />;
        })}
      </nav>
    </aside>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.09em',
      color: 'rgba(25,28,30,0.35)',
      fontFamily: "'Manrope', sans-serif",
      padding: '6px 12px 4px',
      textTransform: 'uppercase',
    }}>{label}</div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 12px',
        borderRadius: '0.375rem',
        color: isActive ? '#0058be' : 'rgba(25,28,30,0.50)',
        fontSize: 12,
        fontWeight: isActive ? 600 : 500,
        fontFamily: "'Manrope', sans-serif",
        textDecoration: 'none',
        background: isActive ? 'rgba(0,88,190,0.08)' : 'transparent',
        borderRight: isActive ? '2px solid #0058be' : '2px solid transparent',
        transition: 'all 0.15s',
      })}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'inherit', flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </NavLink>
  );
}

// Mismo tratamiento funcional que TopNavBar.tsx (span no-clicable, cursor
// not-allowed, tooltip con el plan requerido) — icono `lock` en vez del
// glifo Unicode de TopNavBar porque este archivo ya usa material-symbols
// para todo lo demás; mezclar dos sistemas de íconos en el mismo componente
// rompería la consistencia visual que se busca mantener.
function LockedNavItem({ label, icon, reason }: { to: string; label: string; icon: string; reason: string }) {
  return (
    <span title={reason} style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '7px 12px',
      borderRadius: '0.375rem',
      color: 'rgba(25,28,30,0.30)',
      fontSize: 12,
      fontWeight: 500,
      fontFamily: "'Manrope', sans-serif",
      cursor: 'not-allowed',
      userSelect: 'none',
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'inherit', flexShrink: 0 }}>
        {icon}
      </span>
      {label}
      <span className="material-symbols-outlined" style={{ fontSize: 13, marginLeft: 'auto', flexShrink: 0, opacity: 0.6 }}>
        lock
      </span>
    </span>
  );
}
