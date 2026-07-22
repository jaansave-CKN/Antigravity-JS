import { NavLink, useLocation } from 'react-router-dom';

// ── Tokens idénticos a entr__sidebar / entr__sidebar-link ─────────────────────
// Fuente: EntradaPage.css — tolerancia cero a desviaciones

const HIDDEN_ON = new Set(['/']);

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
  { to: '/ficha',      label: 'Ficha Técnica',    icon: 'id_card'        },
  { to: '/viabilidad', label: 'Viabilidad',       icon: 'analytics'      },
  { to: '/checklist',  label: 'Check-List',       icon: 'checklist'      },
];

export default function AppLeftNav() {
  const { pathname } = useLocation();
  if (HIDDEN_ON.has(pathname)) return null;

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
        {PILAR_A.map(l => <NavItem key={l.to} {...l} />)}

        {/* Divisor */}
        <div style={{ height: 1, background: '#e0e3e5', margin: '8px 2px' }} />

        {/* Sección B */}
        <SectionLabel label="PILAR B" />
        {PILAR_B.map(l => <NavItem key={l.to} {...l} />)}
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
