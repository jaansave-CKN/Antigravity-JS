import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  LogOut, Radio, Zap, Layers, FileText, Snowflake
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { signOut } from '../lib/firebase';

const S = {
  sidebar:  { width: 260, minWidth: 260, height: '100vh', background: 'linear-gradient(180deg, #131b2e 0%, #060e20 100%)', borderRight: '1px solid rgba(201,162,39,0.15)', display: 'flex', flexDirection: 'column', overflowY: 'auto', fontFamily: "'Hanken Grotesk', system-ui, sans-serif" },
  brand:    { padding: '20px 16px 16px', borderBottom: '1px solid rgba(201,162,39,0.15)', display: 'flex', alignItems: 'center', gap: 10 },
  logo:     { width: 36, height: 36, borderRadius: 10, background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, color: '#fff', flexShrink: 0 },
  brandText:{ display: 'flex', flexDirection: 'column' },
  brandName:{ color: '#dae2fd', fontWeight: 800, fontSize: 14, letterSpacing: '-0.3px' },
  brandSub: { color: '#c9a227', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700 },
  section:  { padding: '12px 8px 4px' },
  secLabel: { color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700, padding: '0 8px 6px', display: 'block' },
  divider:  { height: 1, background: 'rgba(255,255,255,0.05)', margin: '4px 16px' },
  footer:   { marginTop: 'auto', padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.8 },
};

const activeStyle  = { background: 'rgba(56,189,248,0.15)', color: '#38bdf8', borderLeft: '3px solid #38bdf8' };
const defaultStyle = { color: '#bdc8d1', borderLeft: '3px solid transparent' };
const frozenStyle  = { color: '#3e484f', borderLeft: '3px solid transparent', cursor: 'default' };

function NavItem({ to, label, Icon, frozen = false, external = false, badge = null }) {
  const itemBase = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', borderRadius: 8, textDecoration: 'none',
    fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
    marginBottom: 2, position: 'relative',
  };

  if (frozen) {
    return (
      <div style={{ ...itemBase, ...frozenStyle, opacity: 0.5 }}>
        <Icon size={16} />
        <span style={{ flex: 1 }}>{label}</span>
        <Snowflake size={11} style={{ color: '#3b82f6', opacity: 0.6 }} />
      </div>
    );
  }

  if (external) {
    return (
      <a href={to} style={{ ...itemBase, ...defaultStyle }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56,189,248,0.08)'; e.currentTarget.style.color = '#dae2fd'; }}
        onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = '#bdc8d1'; }}>
        <Icon size={16} />
        <span style={{ flex: 1 }}>{label}</span>
        {badge && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontWeight: 700, letterSpacing: 0.5 }}>{badge}</span>}
      </a>
    );
  }

  return (
    <NavLink to={to} style={({ isActive }) => ({ ...itemBase, ...(isActive ? activeStyle : defaultStyle) })}>
      {({ isActive }) => (
        <>
          <Icon size={16} />
          <span style={{ flex: 1 }}>{label}</span>
          {badge && (
            <span style={{
              fontSize: 9, padding: '2px 6px', borderRadius: 10, fontWeight: 700, letterSpacing: 0.5,
              background: isActive ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.15)',
              color: isActive ? '#93c5fd' : '#60a5fa',
            }}>{badge}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/inicio', { replace: true });
  };

  return (
    <nav style={S.sidebar}>
      {/* Brand */}
      <div style={S.brand}>
        <div style={S.logo}>AG</div>
        <div style={S.brandText}>
          <span style={S.brandName}>Antigravity OS</span>
          <span style={S.brandSub}>Radar Formulador</span>
        </div>
      </div>

      {/* Cuenta */}
      <div style={S.section}>
        <span style={S.secLabel}>Cuenta</span>
        {user?.email && (
          <div style={{ padding: '4px 12px 8px', fontSize: 12, color: '#94a3b8', wordBreak: 'break-all' }}>
            {user.email}
          </div>
        )}
        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '9px 12px', borderRadius: 8, border: 'none', background: 'transparent',
            color: '#bdc8d1', fontSize: 13, fontWeight: 500, cursor: 'pointer', textAlign: 'left',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#f87171'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#bdc8d1'; }}
        >
          <LogOut size={16} />
          <span>Cerrar sesión</span>
        </button>
      </div>

      <div style={S.divider} />

      {/* Module A */}
      <div style={S.section}>
        <span style={S.secLabel}>Módulo A · Monitoreo</span>
        <NavItem to="/radar"      label="Radar"                   Icon={Radio}    badge="LIVE" />
      </div>

      <div style={S.divider} />

      {/* Module B */}
      <div style={S.section}>
        <span style={S.secLabel}>Módulo B · Formulación AI 7.0</span>
        <NavItem to="/fase1-entrada.html" label="Entrada (1–9)"    Icon={Zap}           external badge="ACTIVO" />
        <NavItem to="/modulo10"           label="Módulo 10"        Icon={Layers}        badge="ACTIVO" />
        <NavItem to="/ficha"              label="Ficha Técnica"    Icon={FileText}      frozen />
      </div>

      {/* Footer */}
      <div style={S.footer}>
        <div style={{ color: '#c9a227', fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>ASFÁLTICA S.A.S.</div>
        <div>Bucaramanga · Santander</div>
        <div>310 760 89 49</div>
      </div>
    </nav>
  );
}
