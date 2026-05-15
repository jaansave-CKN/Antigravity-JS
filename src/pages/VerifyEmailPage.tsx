import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function VerifyEmailPage() {
  const { user, sendEmailVerification, signOut } = useAuth();
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleResend() {
    setLoading(true);
    try {
      await sendEmailVerification();
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.emailVerified) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-card__header">
            <div className="auth-icon auth-icon--success">✓</div>
            <h1>Correo verificado</h1>
            <p>Tu cuenta está lista. Ya puedes usar RADAR 360.</p>
          </div>
          <button className="btn btn--primary btn--full" onClick={() => navigate('/')}>
            Ir al Radar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__header">
          <div className="auth-icon auth-icon--email">✉</div>
          <h1>Verifica tu correo</h1>
          <p>Enviamos un enlace de verificación a <strong>{user.email}</strong></p>
        </div>

        {sent && (
          <div className="auth-alert auth-alert--success">
            Enlace reenviado. Revisa tu bandeja de entrada y spam.
          </div>
        )}

        <div className="verify-steps">
          <div className="verify-step">1. Abre tu correo electrónico</div>
          <div className="verify-step">2. Busca un mensaje de noreply@antigravity-jairo-2026.firebaseapp.com</div>
          <div className="verify-step">3. Haz clic en el enlace "Verificar correo"</div>
          <div className="verify-step">4. Recarga esta página</div>
        </div>

        <button
          className="btn btn--primary btn--full"
          onClick={handleResend}
          disabled={loading}
        >
          {loading ? 'Enviando...' : 'Reenviar enlace de verificación'}
        </button>

        <div className="auth-card__footer">
          <button className="auth-link" onClick={signOut}>
            Usar otra cuenta
          </button>
        </div>
      </div>
    </div>
  );
}