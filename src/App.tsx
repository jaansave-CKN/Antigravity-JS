import { useState, useEffect } from 'react';
import type { ModuloActivo } from './types';
import { RadarProvider, useRadar } from './contexts/RadarContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import { PestañaRadar } from './features/radar-fondos/presentation/components/PestañaRadar';
import Dashboard from './Dashboard';
import { PestañaInteligenciaChat } from './features/radar-fondos/presentation/components/PestañaInteligenciaChat';
import { RadarWorkspace } from './features/radar-fondos/presentation/components/PestañaPrueba';
import { RadarGridRealTime } from './features/radar-fondos/presentation/components/RadarGridRealTime';
import { SidebarConfiguracion } from './components/SidebarConfiguracion';
import SidebarRight from './components/SidebarRight';
import Directorio from './components/directorio';
import ConvocatoriasView from './components/ConvocatoriasView';
import BandejaProspectos from './components/BandejaProspectos';
import RadarGrid from './components/RadarGrid';
import { DirectorioGrid } from './components/DirectorioGrid';
import { ConfiguracionCredenciales } from './components/ConfiguracionCredenciales';
import { TableroBeneficiarios } from './components/TableroBeneficiarios';
import { PanelControl } from './components/PanelControl';
import './App.css';
import './components/DirectorioGrid.css';
import './components/ConfiguracionCredenciales.css';
import './components/PanelControl.css';

function AppContent() {
  const [moduloActivo, setModuloActivo] = useState<ModuloActivo>('dashboard');
  const [busqueda, setBusqueda] = useState('');
  const [alertasCount] = useState(0);
  const { state, verificarCredenciales } = useRadar();

  useEffect(() => {
    verificarCredenciales();
  }, [verificarCredenciales]);

  const renderModulo = () => {
    if (state.necesitaConfiguracion && moduloActivo !== 'configuracion') {
      return <SidebarConfiguracion />;
    }

    switch (moduloActivo) {
      case 'radar':
        return <RadarGrid />;
      case 'directorio':
        return <Directorio />;
      case 'directoriogrid':
        return <DirectorioGrid />;
      case 'credenciales':
        return <ConfiguracionCredenciales />;
      case 'convocatorias':
        return <ConvocatoriasView />;
      case 'inbox':
        return <BandejaProspectos />;
      case 'chat':
      case 'inteligencia':
        return <PestañaInteligenciaChat />;
      case 'prueba':
        return <RadarWorkspace />;
      case 'realtime':
        return <RadarGridRealTime />;
      case 'configuracion':
        return <SidebarConfiguracion />;
      case 'tablero-beneficiarios':
        return <TableroBeneficiarios />;
      case 'panel-control':
        return <PanelControl />;
      case 'dashboard':
        return <Dashboard />;
      default:
        return <RadarGrid />;
    }
  };

  return (
    <div className="app">
      <Sidebar
        moduloActivo={moduloActivo}
        onModuloChange={setModuloActivo}
      />
      <main className="app__main">
        <Header
          busqueda={busqueda}
          onBusquedaChange={setBusqueda}
          alertasCount={alertasCount}
          ultimaActualizacion=""
          alertas={[]}
          onNavigateToModule={(m) => setModuloActivo(m as ModuloActivo)}
        />
        <div className="app__content">
          {renderModulo()}
        </div>
      </main>
      <SidebarRight
        moduloActivo={moduloActivo}
        onModuloChange={setModuloActivo}
      />
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