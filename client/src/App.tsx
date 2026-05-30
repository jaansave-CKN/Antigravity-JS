import { useState, useEffect, lazy, Suspense, Component, type ReactNode, type ErrorInfo } from 'react';
import { RadarProvider, useRadar } from './contexts/RadarContext';
import { FavoritosProvider } from './contexts/FavoritosContext';
import type { ModuloActivo } from './types';
import './App.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[App] Error de renderizado:', err, info);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#f7f9fb', fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: '#ba1a1a', fontWeight: 700, marginBottom: '0.5rem', fontSize: 15 }}>
            Algo falló al cargar la aplicación
          </p>
          <p style={{ color: '#76777d', fontSize: 12, marginBottom: '1.5rem' }}>
            Esto puede deberse a un error de red o un módulo no disponible.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 28px', background: '#0058be', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
              fontWeight: 700, fontSize: 13, letterSpacing: '0.03em',
            }}
          >
            Recargar App
          </button>
        </div>
      </div>
    );
  }
}

// Lazy imports — si uno falla el ErrorBoundary lo atrapa, no toda la app
const Dashboard        = lazy(() => import('./components/Dashboard'));
const SidebarRight     = lazy(() => import('./components/SidebarRight'));
const ConvocatoriasView= lazy(() => import('./components/ConvocatoriasView'));
const BandejaProspectos= lazy(() => import('./components/BandejaProspectos'));
const RadarGrid        = lazy(() => import('./components/RadarGrid'));
const DirectorioGrid   = lazy(() => import('./components/DirectorioGrid').then(m => ({ default: m.DirectorioGrid })));
const ConfigCreds      = lazy(() => import('./components/ConfiguracionCredenciales').then(m => ({ default: m.ConfiguracionCredenciales })));
const TableroBenef     = lazy(() => import('./components/TableroBeneficiarios').then(m => ({ default: m.TableroBeneficiarios })));
const PanelControl     = lazy(() => import('./components/PanelControl').then(m => ({ default: m.PanelControl })));

// CSS
import './components/DirectorioGrid.css';
import './components/ConfiguracionCredenciales.css';
import './components/PanelControl.css';

function ModuloFallback({ name }: { name: string }) {
  return (
    <div style={{ padding: '2rem', color: '#888', textAlign: 'center' }}>
      Módulo "{name}" no disponible
    </div>
  );
}

function ModuloLoader() {
  return (
    <div style={{ padding: '2rem', color: '#666', textAlign: 'center' }}>
      Cargando módulo…
    </div>
  );
}

function AppContent() {
  const [moduloActivo, setModuloActivo] = useState<ModuloActivo>('dashboard');

  let radarCtx: ReturnType<typeof useRadar> | null = null;
  try {
    radarCtx = useRadar();
  } catch {
    console.warn('[App] RadarContext no disponible');
  }

  useEffect(() => {
    try { radarCtx?.verificarCredenciales?.(); } catch {}
  }, []);

  const handleModuloChange = (modulo: ModuloActivo) => setModuloActivo(modulo);

  return (
    <div className="app">
      <Suspense fallback={<ModuloLoader />}>
        <Dashboard />
        <SidebarRight
          moduloActivo={moduloActivo}
          onModuloChange={handleModuloChange}
        />
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <FavoritosProvider>
        <RadarProvider>
          <AppContent />
        </RadarProvider>
      </FavoritosProvider>
    </AppErrorBoundary>
  );
}
