import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, loading, isPermitted, userProfile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading__spinner" />
        <span>Verificando acceso...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isPermitted) {
    return (
      <div className="auth-blocked">
        <div className="auth-blocked__card">
          <div className="auth-blocked__icon">🔒</div>
          <h2>Cuenta suspendida</h2>
          <p>Tu cuenta ha sido suspendida. Contacta al administrador para más información.</p>
          <button onClick={() => window.location.href = '/login'} className="btn btn--secondary">
            Volver al login
          </button>
        </div>
      </div>
    );
  }

  if (requireAdmin && userProfile?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}