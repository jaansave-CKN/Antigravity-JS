import { useState } from 'react';
import { useAuth } from '../contexts/AuthContextNew';

interface RegisterPageProps {
  onToggleMode?: () => void;
}

export default function RegisterPage({ onToggleMode }: RegisterPageProps) {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<'inversor' | 'admin'>('inversor');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
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
    <div>
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
            placeholder="Jairo Antonio Salinas"
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
            placeholder="Mínimo 8 caracteres"
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

        <button type="submit" disabled={loading}>
          {loading ? 'Creando cuenta...' : 'Crear Cuenta'}
        </button>

        {onToggleMode && (
          <button type="button" onClick={onToggleMode}>
            ¿Ya tienes cuenta? Inicia sesión
          </button>
        )}
      </form>
    </div>
  );
}