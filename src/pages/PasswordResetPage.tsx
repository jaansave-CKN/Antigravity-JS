import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

export default function PasswordResetPage() {
  const { sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err: any) {
      setError(mapFirebaseError(err.code));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md text-center">
          <div className="text-4xl mb-4">✉</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Correo enviado</h2>
          <p className="text-gray-600 mb-6">
            Revisa <strong>{email}</strong> para restablecer tu contraseña.
          </p>
          <button onClick={() => navigate('/login')} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
            Volver al login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Recuperar contraseña</h2>
        <p className="text-gray-600 mb-6">Ingresa tu correo y te enviaremos un enlace para restablecerla.</p>

        <form onSubmit={handleSubmit}>
          {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}

          <div className="auth-field">
            <label htmlFor="reset-email">Correo electrónico</label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoComplete="email"
            />
          </div>

          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
          </button>
        </form>

        <button type="button" onClick={() => navigate('/login')} className="w-full mt-4 text-sm text-blue-600 hover:underline">
          Volver al login
        </button>
      </div>
    </div>
  );
}

function mapFirebaseError(code: string): string {
  const map: Record<string, string> = {
    'auth/user-not-found': 'No existe cuenta con este correo.',
    'auth/network-request-failed': 'Error de red. Verifica tu conexión.',
  };
  return map[code] || 'Error al enviar correo. Intenta de nuevo.';
}
