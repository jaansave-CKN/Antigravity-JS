import { Navigate } from 'react-router-dom';

// La ruta raíz redirige al radar; RequireAuth ya maneja el onboarding hacia /apis.
export default function HomePage() {
  return <Navigate to="/radar" replace />;
}
