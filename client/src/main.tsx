import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContextNew';
import Dashboard from './Dashboard';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import PasswordResetPage from './pages/PasswordResetPage';
import ControlPanel from './pages/ControlPanel';
import DirectoryPage from './pages/DirectoryPage';
import ImportPage from './pages/ImportPage';
import CredentialsPage from './pages/CredentialsPage';
import TopNavBar from './components/TopNavBar';
import HomePage from './pages/HomePage';
import './index.css';
import 'leaflet/dist/leaflet.css';

// ── Error Boundary — global y por ruta ───────────────────────────────────────
interface EBProps { children: React.ReactNode; routeName?: string; }
interface EBState { hasError: boolean; error: Error | null; info: string }

class ErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, error: null, info: '' };
  }
  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.routeName ? ':' + this.props.routeName : ''}]`, error, info);
    this.setState({ info: info.componentStack?.slice(0, 400) ?? '' });
  }
  handleReload = () => {
    // Limpiar caché y recargar forzando descarga de recursos frescos
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(n => caches.delete(n)));
    }
    window.location.reload();
  };
  handleReset = () => this.setState({ hasError: false, error: null, info: '' });

  render() {
    if (!this.state.hasError) return this.props.children;

    const isRoute = !!this.props.routeName;

    return (
      <div style={{
        minHeight: isRoute ? 'calc(100vh - 48px)' : '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f7f9fb', padding: '2rem', fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          background: '#fff', border: '1px solid #fca5a5',
          borderRadius: 12, padding: '2rem', maxWidth: 560, width: '100%',
          boxShadow: '0 4px 24px rgba(186,26,26,0.08)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, background: '#fee2e2', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 20 }}>⚠</span>
            </div>
            <div>
              <p style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#76777d', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
                {isRoute ? `Error en módulo ${this.props.routeName}` : 'Error de aplicación'}
              </p>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#191c1e', margin: 0 }}>
                No se pudo cargar esta sección
              </h2>
            </div>
          </div>

          {/* Mensaje del error */}
          <div style={{ background: '#fff4f4', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 12px', marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontFamily: 'monospace', color: '#ba1a1a', margin: 0, wordBreak: 'break-word' }}>
              {this.state.error?.message ?? 'Error desconocido'}
            </p>
          </div>

          {/* Stack trace colapsable */}
          {this.state.info && (
            <details style={{ marginBottom: 16 }}>
              <summary style={{ fontSize: 11, fontFamily: 'monospace', color: '#76777d', cursor: 'pointer', marginBottom: 4 }}>
                Ver detalles técnicos
              </summary>
              <pre style={{ fontSize: 10, fontFamily: 'monospace', color: '#45464d', background: '#f2f4f6', borderRadius: 4, padding: 8, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {this.state.info}
              </pre>
            </details>
          )}

          {/* Acciones */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={this.handleReload}
              style={{ flex: 1, height: 36, background: '#0058be', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Recargar página
            </button>
            {isRoute && (
              <button onClick={this.handleReset}
                style={{ height: 36, padding: '0 14px', background: 'white', color: '#45464d', border: '1px solid #c6c6cd', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', cursor: 'pointer' }}>
                Reintentar
              </button>
            )}
          </div>

          <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#c6c6cd', marginTop: 12, textAlign: 'center' }}>
            Si el problema persiste, prueba Ctrl+Shift+R para forzar recarga sin caché.
          </p>
        </div>
      </div>
    );
  }
}

// ── Limpiador de parámetros OAuth / Google ────────────────────────────────────
// Chrome puede agregar params de OAuth o de su gestor de contraseñas a la URL.
// Este componente los detecta y hace una redirección limpia antes de renderizar.
const OAUTH_JUNK_PARAMS = [
  'code', 'state', 'error', 'error_description', 'error_uri',
  'scope', 'hd', 'prompt', 'authuser', 'session_state',
  'oauth_token', 'oauth_verifier', 'access_token',
];

function OAuthParamCleaner() {
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    const params  = new URLSearchParams(location.search);
    const hasJunk = OAUTH_JUNK_PARAMS.some(p => params.has(p));
    if (!hasJunk) return;

    // Parámetros OAuth/Google detectados (p.ej. tras alerta de contraseña de Chrome).
    // Forzamos redirección limpia a /apis para evitar pantalla en blanco.
    console.warn('[OAuthCleaner] Parámetros OAuth inesperados detectados — redirigiendo a /apis');
    navigate('/apis', { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ── App layout (TopNavBar + página envuelta en ErrorBoundary por ruta) ────────
function AppLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopNavBar />
      <ErrorBoundary routeName="página">
        <Outlet />
      </ErrorBoundary>
    </div>
  );
}

// ── Pantalla de carga compartida ──────────────────────────────────────────────
function LoadingScreen({ message = 'Verificando sesión…' }: { message?: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f9fb' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 28, height: 28, border: '3px solid #c6c6cd', borderTopColor: '#0058be', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: '#76777d', fontFamily: 'monospace' }}>{message}</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Route guard ───────────────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, hasCredentials, enterDemoMode } = useAuth();
  const [credTimedOut, setCredTimedOut] = React.useState(false);
  const loc = window.location.pathname;

  // Sin sesión → entrar en modo demo automáticamente (sin pantalla de login)
  React.useEffect(() => {
    if (!loading && !isAuthenticated) {
      enterDemoMode();
    }
  }, [loading, isAuthenticated, enterDemoMode]);

  // Si hasCredentials sigue null después de 5 s, el servidor no respondió — avanzar igual
  React.useEffect(() => {
    if (hasCredentials !== null) { setCredTimedOut(false); return; }
    const t = setTimeout(() => setCredTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, [hasCredentials]);

  // Durante carga inicial o mientras se activa el demo, mostrar spinner breve
  if (loading || !isAuthenticated) return <LoadingScreen message="Iniciando panel…" />;
  if (hasCredentials === null && !credTimedOut) return <LoadingScreen message="Verificando acceso…" />;
  if ((hasCredentials === false || credTimedOut) && loc !== '/apis') {
    return <Navigate to="/apis" replace />;
  }

  return <>{children}</>;
}

// ── Routes ────────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { isAuthenticated, hasCredentials } = useAuth();
  const toPanel = <Navigate to="/apis" replace />;
  const toHome  = <Navigate to="/"    replace />;

  return (
    <Routes>
      {/* Públicas — con demo activo, redirige directo al panel */}
      <Route path="/login"          element={isAuthenticated ? toPanel : <LoginPage />} />
      <Route path="/register"       element={isAuthenticated ? toPanel : <RegisterPage />} />
      <Route path="/reset-password" element={isAuthenticated ? toHome  : <PasswordResetPage />} />

      {/* Protegidas — con TopNavBar via AppLayout */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/"           element={<HomePage />} />
        <Route path="/radar"      element={<Dashboard />} />
        <Route path="/directorio" element={<DirectoryPage />} />
        <Route path="/importar"   element={<ImportPage />} />
        <Route path="/settings"   element={<ControlPanel />} />
        <Route path="/apis"       element={<CredentialsPage isOnboarding={hasCredentials === false} />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────
const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML =
    '<div style="color:red;padding:2rem;font-family:monospace">FATAL: elemento #root no encontrado en index.html</div>';
} else {
  createRoot(rootEl).render(
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <OAuthParamCleaner />
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
