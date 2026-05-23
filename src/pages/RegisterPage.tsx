import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<'inversor' | 'admin'>('inversor');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function validatePassword(pw: string): string | null {
    if (pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/[A-Z]/.test(pw)) return 'Debe contener al menos una letra mayúscula.';
    if (!/[0-9]/.test(pw)) return 'Debe contener al menos un número.';
    if (!/[^a-zA-Z0-9\s]/.test(pw)) return 'Debe contener al menos un carácter especial (@, #, $, etc.).';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      await register(email, password, displayName, role);
    } catch (err: any) {
      setError(err.message || 'Error al crear cuenta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Crear Cuenta</h2>

      <form onSubmit={handleSubmit} className="auth-form">
        {error && <div className="error">{error}</div>}

        <div className="auth-field">
          <label htmlFor="name">Nombre completo</label>
          <input
            id="name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Tu nombre completo"
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mín. 8 car, 1 mayúscula, 1 número, 1 especial"
            required
            minLength={8}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="confirm">Confirmar contraseña</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repite tu contraseña"
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="role">Tipo de Usuario</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="inversor">Inversor/Cliente</option>
            <option value="admin">Administrador</option>
          </select>
        </div>

        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Creando cuenta...' : 'Crear Cuenta'}
        </button>

        <button type="button" onClick={() => navigate('/login')} className="w-full mt-2 text-sm text-blue-600 hover:underline">
          ¿Ya tienes cuenta? Inicia sesión
        </button>
      </form>
      </div>
    </div>
  );
}