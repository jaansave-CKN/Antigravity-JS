import { useState } from 'react';
import { useAuth } from '../contexts/AuthContextNew';
import { getAuthHeaders } from '../lib/apiClient';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

/** Aviso no bloqueante — independiente del gate de aprobación de admin (is_approved). */
export default function EmailVerificationBanner() {
  const { user, token } = useAuth();
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'enviado' | 'error'>('idle');

  if (!user || token === 'demo-mode-token' || user.email_verified !== false) return null;

  const reenviar = async () => {
    setEstado('enviando');
    try {
      const res = await fetch(`${API_BASE}/auth/enviar-verificacion`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      setEstado(res.ok ? 'enviado' : 'error');
    } catch {
      setEstado('error');
    }
  };

  return (
    <div style={{
      background: '#fef3c7', borderBottom: '1px solid #fbbf24', color: '#78350f',
      fontSize: 12, padding: '8px 16px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span>Aún no has confirmado tu correo electrónico ({user.email}).</span>
      {estado === 'enviado' ? (
        <strong>Correo reenviado — revisa tu bandeja.</strong>
      ) : (
        <button
          onClick={reenviar}
          disabled={estado === 'enviando'}
          style={{
            background: '#78350f', color: '#fff', border: 'none', borderRadius: 5,
            padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            opacity: estado === 'enviando' ? 0.6 : 1,
          }}
        >
          {estado === 'enviando' ? 'Enviando...' : 'Reenviar correo'}
        </button>
      )}
      {estado === 'error' && <span style={{ color: '#b91c1c' }}>No se pudo reenviar — intenta de nuevo.</span>}
    </div>
  );
}
