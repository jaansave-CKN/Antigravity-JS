import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

type Estado = 'validando' | 'error';

// Destino del botón "Validar" del correo que se envía justo después de que
// el admin aprueba una cuenta nueva (ver aprobar-por-correo en server.js).
// Intercambia el token de un solo uso por una sesión real y entra directo
// al portal — reemplaza al viejo flujo de "verificar tu correo", que era
// una segunda validación independiente y confusa junto a la aprobación admin.
export default function ValidarCuentaPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activarPorCorreo } = useAuth();
  const [estado, setEstado] = useState<Estado>('validando');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setEstado('error');
      setMensaje('Enlace de validación incompleto — falta el token.');
      return;
    }
    activarPorCorreo(token)
      .then(() => navigate('/', { replace: true }))
      .catch((err: Error) => {
        setEstado('error');
        setMensaje(err.message || 'No se pudo validar la cuenta.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div style={{
      minHeight: '100vh', background: '#0b1326', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{
        background: '#0d1b2f', border: '1px solid #1a3a50', borderRadius: 12,
        padding: '2.5rem', maxWidth: 420, width: '100%', textAlign: 'center',
      }}>
        {estado === 'validando' ? (
          <>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
            <h2 style={{ color: '#e0e0ff', fontSize: 18, margin: '0 0 8px' }}>Validando tu cuenta...</h2>
            <p style={{ color: '#8bafcf', fontSize: 12 }}>Te llevaremos al portal en un momento.</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ color: '#e0e0ff', fontSize: 18, margin: '0 0 8px' }}>No se pudo validar</h2>
            <p style={{ color: '#8bafcf', fontSize: 13, marginBottom: 20 }}>{mensaje}</p>
            <Link to="/login" style={{ color: '#38bdf8', fontSize: 12, textDecoration: 'underline' }}>
              Ir al login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
