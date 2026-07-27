import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContextNew';
import TopNavBar from './components/TopNavBar';
import AuthGuard from './components/AuthGuard';
import { FavoritosProvider } from './contexts/FavoritosContext';
import { SubscriptionProvider, useSubscription } from './contexts/SubscriptionContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { RadarProvider } from './contexts/RadarContext';
import { SearchProvider } from './contexts/SearchContext';
import FormuladorLayout from './components/FormuladorLayout';
import AppLeftNav from './components/AppLeftNav';
import EmailVerificationBanner from './components/EmailVerificationBanner';
import './index.css';

// ── Code-splitting: cada página (y sus dependencias pesadas — leaflet, xlsx,
// jspdf, framer-motion — solo se descargan al visitarla, no en el bundle
// inicial. Antes TODO se importaba de forma estática (Fase 6). ─────────────
const Dashboard              = lazy(() => import('./Dashboard'));
const LoginPage              = lazy(() => import('./pages/LoginPage'));
const RegisterPage           = lazy(() => import('./pages/RegisterPage'));
const PasswordResetPage      = lazy(() => import('./pages/PasswordResetPage'));
const VerificacionEmailPage  = lazy(() => import('./pages/VerificacionEmailPage'));
const ControlPanel           = lazy(() => import('./pages/ControlPanel'));
const DirectoryPage          = lazy(() => import('./pages/DirectoryPage'));
const ImportPage             = lazy(() => import('./pages/ImportPage'));
const CredentialsPage        = lazy(() => import('./pages/CredentialsPage'));
const LandingPage            = lazy(() => import('./pages/LandingPage'));
const TerminosPage           = lazy(() => import('./pages/TerminosPage'));
const PrivacidadPage         = lazy(() => import('./pages/PrivacidadPage'));
const ChecklistPage          = lazy(() => import('./pages/ChecklistPage'));
const FichaTecnicaPage       = lazy(() => import('./pages/FichaTecnicaPage'));
const PlanesPage             = lazy(() => import('./pages/PlanesPage'));
const FavoritosPage          = lazy(() => import('./pages/FavoritosPage'));
const AnexosPage             = lazy(() => import('./pages/AnexosPage'));
const PanelPage              = lazy(() => import('./pages/PanelPage'));
const AdminUsuariosPendientesPage = lazy(() => import('./pages/AdminUsuariosPendientesPage'));
const FormulacionViewer      = lazy(() => import('./components/FormulacionViewer'));
const LogisticaPage          = lazy(() => import('./pages/LogisticaPage'));
// Revertido a pedido del usuario: el diseño Stitch (PestañaRadar) reemplazó
// este diseño y no gustó — RadarCalcoPage (LayoutPadre) vuelve a ser /radar.
const RadarCalcoPage         = lazy(() => import('./pages/RadarCalcoPage'));
const CalendarioPage         = lazy(() => import('./pages/CalendarioPage'));
const EntradaPage            = lazy(() => import('./pages/EntradaPage'));
const DialecticaPage         = lazy(() => import('./pages/DialecticaPage'));
const ViabilidadPage         = lazy(() => import('./pages/ViabilidadPage'));
const ContextoPage           = lazy(() => import('./pages/ContextoPage'));
const ArbolObjetivosPage     = lazy(() => import('./pages/ArbolObjetivosPage'));
const ExportacionPage        = lazy(() => import('./pages/ExportacionPage'));
const Modulo10Page           = lazy(() => import('./pages/Modulo10Page'));
const PopulationObjectiveWizard = lazy(() => import('./components/formulador/PopulationObjectiveWizard'));
import 'leaflet/dist/leaflet.css';
import { validateEnv } from './utils/envValidator';
import { captureError } from './lib/sentry';

// Falla rápido y explícito si faltan llaves críticas — evita arranques fantasma en producción
validateEnv();

// Bootstrap de una sola vez: activa el proyecto "Cantagallo - Patico (UMIS)"
// si el usuario todavía no tiene ningún proyecto activo — evita que los
// anexos capturados en modo "sin proyecto" (ver AnexosCalcoView.tsx) se
// queden huérfanos. Se autodesactiva tras la primera ejecución.
if (!localStorage.getItem('rf360_proyecto_activo') && !localStorage.getItem('rf360_bootstrap_cantagallo')) {
  localStorage.setItem('rf360_proyecto_activo', '132c2bb8-e181-4c04-9385-6fb76d4fdb99');
  localStorage.setItem('rf360_proyecto_nombre', 'Cantagallo - Patico (UMIS)');
  localStorage.setItem('rf360_bootstrap_cantagallo', '1');
}

// Bootstrap de una sola vez: purga una sesión "demo-mode-token" atascada.
// AuthContextNew.tsx carga esa sesión falsa sin red apenas la ve en
// localStorage (nunca reintenta el login real) — quedó así por un bug de CSP
// ya corregido (VITE_API_URL apuntaba a "localhost" en vez de "127.0.0.1").
// Sin este bootstrap, ningún reload futuro volvería a probar el backend real.
if (localStorage.getItem('auth_token') === 'demo-mode-token' && !localStorage.getItem('rf360_bootstrap_demofix')) {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  localStorage.setItem('rf360_bootstrap_demofix', '1');
}

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
    captureError(error, { routeName: this.props.routeName, componentStack: info.componentStack });
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

// ── Plan Gate V7.0: interceptor de pilares por suscripción ───────────────────
// Redirige a /planes cuando el token no contiene el plan requerido.
// El loading impide un flash de "acceso denegado" antes de que el contexto cargue.
function PlanGate({ require: plan, children }: { require: 'radar' | 'formulador'; children: React.ReactNode }) {
  const { subscription, loading } = useSubscription();

  // En modo desarrollo, todos los módulos son accesibles sin suscripción
  if (import.meta.env.DEV) return <>{children}</>;

  if (loading) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 48px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f7f9fb',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 24, height: 24,
            border: '2px solid #c6c6cd', borderTopColor: '#0058be',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ fontSize: 11, color: '#76777d', fontFamily: 'monospace' }}>Verificando plan…</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (plan === 'radar' && !subscription.access_radar) {
    return <Navigate to="/planes" state={{ upgrade: 'radar', reason: 'Requiere Plan Radar' }} replace />;
  }
  if (plan === 'formulador' && !subscription.access_formulador) {
    return <Navigate to="/planes" state={{ upgrade: 'formulador', reason: 'Requiere Plan Formulador · IA 7.0' }} replace />;
  }
  return <>{children}</>;
}

// ── Fallback de carga para páginas lazy (Fase 6 — code-splitting) ──────────
function RouteLoadingFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0b1326' }}>
      <span style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '3px solid rgba(142,213,255,0.25)', borderTopColor: '#8ed5ff',
        animation: 'main-spin 0.8s linear infinite', display: 'block',
      }} />
      <style>{'@keyframes main-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}

// ── App layout (TopNavBar + AppLeftNav + página envuelta en ErrorBoundary por ruta) ────────
function AppLayout() {
  return (
    <FavoritosProvider>
      <SearchProvider>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <TopNavBar />
          <EmailVerificationBanner />
          <div style={{ display: 'flex', flex: 1 }}>
            <AppLeftNav />
            <div style={{ flex: 1, minWidth: 0 }}>
              <ErrorBoundary routeName="página">
                <Outlet />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </SearchProvider>
    </FavoritosProvider>
  );
}


// ── Routes ────────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { isAuthenticated, hasCredentials, token, logout } = useAuth();
  const location = useLocation();
  const toHome = <Navigate to="/" replace />;
  const realAuth = isAuthenticated && token !== 'demo-mode-token';

  // Guard: si React cree que hay sesión pero localStorage ya no tiene token
  // (purgado por otra pestaña, extensión o Clear-Site-Data), forzar logout local.
  React.useEffect(() => {
    if (isAuthenticated && token !== 'demo-mode-token' && !localStorage.getItem('auth_token')) {
      logout();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <Routes>
      {/* ── Autenticación (públicas) ───────────────────────────────────────── */}
      <Route path="/login"          element={realAuth ? toHome : <LoginPage />} />
      <Route path="/register"       element={realAuth ? toHome : <RegisterPage />} />
      <Route path="/reset-password" element={<PasswordResetPage />} />
      <Route path="/verificar-email" element={<VerificacionEmailPage />} />
      <Route path="/terminos"       element={<TerminosPage />} />
      <Route path="/privacidad"     element={<PrivacidadPage />} />

      {/* ── LANDING (ruta pública, sin gate de plan) ─────────────────────── */}
      {/* Única ruta sin requisito de auth — todo lo demás pasa por AuthContextNew */}
      <Route element={<AuthGuard mode="public-demo"><AppLayout /></AuthGuard>}>
        <Route path="/"            element={<LandingPage />} />
        <Route path="/radar"       element={<RadarCalcoPage />} />
        <Route path="/directorio"  element={<DirectoryPage />} />
        <Route path="/planes"      element={<PlanesPage />} />
        <Route path="/panel"       element={<PanelPage />} />
      </Route>

      {/* ── Pilar A (Gestión/Radar) — auth + plan radar ───────────────────── */}
      {/* Token sin access_radar → interceptado → /planes (upgrade required)  */}
      <Route element={<AuthGuard mode="require-auth"><AppLayout /></AuthGuard>}>
        <Route path="/favoritos"  element={
          <PlanGate require="radar"><FavoritosPage /></PlanGate>
        } />
        <Route path="/calendario" element={
          <PlanGate require="radar"><CalendarioPage /></PlanGate>
        } />
        <Route path="/admin/usuarios-pendientes" element={<AdminUsuariosPendientesPage />} />
      </Route>

      {/* ── Pilar B (Ejecución IA 7.0) — acceso libre con demo mode ─────── */}
      {/* PlanGate en DEV es bypass; en prod requiere access_formulador      */}
      <Route element={<AuthGuard mode="public-demo"><AppLayout /></AuthGuard>}>
        {/* FormuladorLayout inyecta el sidebar derecho en todos los módulos B */}
        <Route element={<FormuladorLayout />}>
          <Route path="/checklist" element={
            <PlanGate require="formulador"><ChecklistPage /></PlanGate>
          } />
          <Route path="/entrada"    element={
            <PlanGate require="formulador"><EntradaPage /></PlanGate>
          } />
          <Route path="/anexos"     element={
            <PlanGate require="formulador"><AnexosPage /></PlanGate>
          } />
          <Route path="/logistica"  element={
            <PlanGate require="formulador"><LogisticaPage /></PlanGate>
          } />
          <Route path="/contexto" element={
            <PlanGate require="formulador"><ContextoPage /></PlanGate>
          } />
          <Route path="/arbol-objetivos" element={
            <PlanGate require="formulador"><ArbolObjetivosPage /></PlanGate>
          } />
          <Route path="/exportacion" element={
            <PlanGate require="formulador"><ExportacionPage /></PlanGate>
          } />
          <Route path="/compliance" element={
            <PlanGate require="formulador"><Modulo10Page /></PlanGate>
          } />
          <Route path="/dialectica" element={
            <PlanGate require="formulador"><DialecticaPage /></PlanGate>
          } />
          <Route path="/viabilidad" element={
            <PlanGate require="formulador"><ViabilidadPage /></PlanGate>
          } />
          <Route path="/ficha"      element={
            <PlanGate require="formulador"><FichaTecnicaPage /></PlanGate>
          } />
        </Route>
      </Route>

      {/* ── Gestión interna: demo mode + credential check ─────────────────── */}
      <Route element={<AuthGuard mode="normal"><AppLayout /></AuthGuard>}>
        <Route path="/importar"   element={<ImportPage />} />
        <Route path="/settings"   element={<ControlPanel />} />
        <Route path="/apis"       element={<CredentialsPage isOnboarding={hasCredentials === false} />} />
      </Route>

      {/* ── Rutas experimentales (WIP) — auth requerida ───────────────────── */}
      <Route element={<AuthGuard mode="require-auth"><AppLayout /></AuthGuard>}>
        <Route path="/dev/dashboard"   element={<RadarProvider><Dashboard /></RadarProvider>} />
        <Route path="/dev/formulacion" element={<FormulacionViewer />} />
      </Route>

      {/* ── Rutas de preview DEV — sin auth (solo import.meta.env.DEV) ────── */}
      {import.meta.env.DEV && (
        <Route element={<AppLayout />}>
          <Route path="/dev/logistica"  element={<LogisticaPage />} />
          <Route path="/dev/calendario" element={<CalendarioPage />} />
          <Route path="/dev/entrada"    element={<EntradaPage />} />
          <Route path="/dev/dialectica" element={<DialecticaPage />} />
          <Route path="/dev/anexos"     element={<AnexosPage />} />
          <Route path="/dev/poblacion"  element={
            <div style={{ padding: 0 }}>
              <PopulationObjectiveWizard
                onSubmit={(data) => { console.log('[DEV] poblacion payload:', data); alert(JSON.stringify(data.poblacion, null, 2)); }}
                onBack={() => window.history.back()}
              />
            </div>
          } />
        </Route>
      )}

      {/* Catch-all → home */}
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
          <SubscriptionProvider>
            <LanguageProvider>
              <OAuthParamCleaner />
              <Suspense fallback={<RouteLoadingFallback />}>
                <AppRoutes />
              </Suspense>
            </LanguageProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
