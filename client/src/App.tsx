import { useState, useEffect, lazy, Suspense } from 'react';
import { RadarProvider, useRadar } from './contexts/RadarContext';
import type { ModuloActivo } from './types';
import './App.css';

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
    <RadarProvider>
      <AppContent />
    </RadarProvider>
  );
}
