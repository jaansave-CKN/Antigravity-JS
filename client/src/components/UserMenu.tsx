import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

// Widget de sesión (correo + menú de Cerrar Sesión) — vive en TopNavBar, que
// envuelve TODAS las rutas vía AppLayout, así que aparece en cualquier
// ventana de la app, no solo en el dashboard del Formulador.
//
// El dropdown usa position:fixed con coordenadas calculadas del botón (no
// position:absolute) porque el <nav> de TopNavBar tiene overflow:hidden —
// un absolute anclado ahí quedaba recortado e invisible.
export default function UserMenu() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  // DEV: visible para cualquier sesión en desarrollo, para no depender de
  // promover manualmente la cuenta a admin solo para llegar al link — la
  // protección real sigue siendo AdminGuard al entrar a /admin, esto es
  // solo visibilidad del atajo.
  const mostrarAdmin = isAdmin || import.meta.env.DEV;
  const [abierto, setAbierto] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!user) return null;

  function toggle() {
    if (!abierto && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setAbierto(o => !o);
  }

  async function handleLogout() {
    setAbierto(false);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}
        title={user.email}
      >
        <div style={{
          width: 20, height: 20, borderRadius: '50%', background: '#111827',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <span style={{
          fontSize: 12, color: '#c8d8e8', fontWeight: 500,
          fontFamily: "'JetBrains Mono', monospace",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130,
        }}>
          {user.email}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#557997" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {abierto && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} onClick={() => setAbierto(false)} />
          <div style={{
            position: 'fixed', top: coords.top, right: coords.right, width: 200, zIndex: 151,
            background: '#0d1b2f', border: '1px solid #1a3a50', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
          }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #1a3a50' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#e0e0ff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.nombre || 'Operador'}
              </p>
              <p style={{ fontSize: 12, color: '#557997', margin: '2px 0 0', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </p>
            </div>
            {mostrarAdmin && (
              <button
                onClick={() => { setAbierto(false); navigate('/admin'); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 12px',
                  background: 'none', border: 'none', borderBottom: '1px solid #1a3a50', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, color: '#38bdf8', fontWeight: 600,
                }}
              >
                🛡️ Panel Admin
                {!isAdmin && (
                  <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginLeft: 'auto' }}>DEV</span>
                )}
              </button>
            )}
            <button
              onClick={handleLogout}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 13, color: '#f87171', fontWeight: 500,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Cerrar Sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}
