import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0b1326', color: '#64748b', fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
        Verificando sesión...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/inicio" replace state={{ from: location }} />;
  }

  return children;
}
