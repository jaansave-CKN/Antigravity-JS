import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContextNew';
import Dashboard from './Dashboard';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import PasswordResetPage from './pages/PasswordResetPage';
import ControlPanel from './pages/ControlPanel';
import DirectoryPage from './pages/DirectoryPage';
import ImportPage from './pages/ImportPage';
import TopNavBar from './components/TopNavBar';
import HomePage from './pages/HomePage';
import './index.css';
import 'leaflet/dist/leaflet.css';

// ── Error Boundary ────────────────────────────────────────────────────────────
interface EBState { hasError: boolean; error: Error | null }
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Crash capturado:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#f7f9fb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '2rem', fontFamily: 'sans-serif', zIndex: 99999,
        }}>
          <div style={{
            background: '#fff', border: '1px solid #e0e3e5',
            borderRadius: '12px', padding: '2rem', maxWidth: '640px', width: '100%',
          }}>
            <h1 style={{ color: '#ba1a1a', margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700 }}>
              Error inesperado
            </h1>
            <p style={{ color: '#45464d', marginBottom: '0.5rem' }}>
              {this.state.error?.message}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                marginTop: '1rem', background: '#0058be', color: '#fff', border: 'none',
                padding: '0.5rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
              }}
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App layout (TopNavBar + page content) ─────────────────────────────────────
function AppLayout() {
  return (
    <>
      <TopNavBar />
      <Outlet />
    </>
  );
}

// ── Route guard ───────────────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-outline text-sm">Verificando sesión…</div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

// ── Routes ────────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { isAuthenticated } = useAuth();
  const toHome = <Navigate to="/" replace />;

  return (
    <Routes>
      {/* Públicas — redirige al home si ya está autenticado */}
      <Route path="/login"          element={isAuthenticated ? toHome : <LoginPage />} />
      <Route path="/register"       element={isAuthenticated ? toHome : <RegisterPage />} />
      <Route path="/reset-password" element={isAuthenticated ? toHome : <PasswordResetPage />} />

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
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
