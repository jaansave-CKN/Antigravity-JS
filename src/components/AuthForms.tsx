import { useState } from 'react';
import { useAuth } from '../contexts/AuthContextNew';

interface LoginFormProps {
  onToggleMode?: () => void;
}

export function LoginForm({ onToggleMode }: LoginFormProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-form">
      <h2>Iniciar Sesión</h2>
      <form onSubmit={handleSubmit}>
        {error && <div className="error">{error}</div>}
        <div>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div>
          <label>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Ingresando...' : 'Entrar'}
        </button>
        {onToggleMode && (
          <button type="button" onClick={onToggleMode}>
            ¿No tienes cuenta? Regístrate
          </button>
        )}
      </form>
    </div>
  );
}

export function RegisterForm({ onToggleMode }: LoginFormProps) {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [role, setRole] = useState<'inversor' | 'admin'>('inversor');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      await register(email, password, nombre, role);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-form">
      <h2>Crear Cuenta</h2>
      <form onSubmit={handleSubmit}>
        {error && <div className="error">{error}</div>}
        <div>
          <label>Nombre Completo</label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div>
          <label>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={loading}
          />
        </div>
        <div>
          <label>Tipo de Usuario</label>
          <select value={role} onChange={e => setRole(e.target.value as any)} disabled={loading}>
            <option value="inversor">Inversor/Cliente</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Creando...' : 'Registrarse'}
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