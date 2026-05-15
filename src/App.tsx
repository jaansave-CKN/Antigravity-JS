import { useState, useMemo, useCallback } from 'react';
import type { ModuloActivo, FiltroActivo, Convocatoria } from './types';
import { realConvocatorias, realEstadisticas } from './data/realData';
import { alertasSenales, hallazgosPendientes as hallazgosIniciales } from './data/mockData';
import { useEntidades } from './hooks/useEntidades';
import { useConvocatorias } from './hooks/useConvocatorias';

import Sidebar from './components/Sidebar';
import Header from './components/Header';
import StatsGrid from './components/StatsGrid';
import ConvocatoriaCard from './components/ConvocatoriaCard';
import FilterBar from './components/FilterBar';
import SignalPanel from './components/SignalPanel';
import RadarVisual from './components/RadarVisual';
import HistoricoView from './components/HistoricoView';
import RiesgosView from './components/RiesgosView';
import ConsorciosView from './components/ConsorciosView';
import FavoritosView from './components/FavoritosView';
import EntidadesView from './components/EntidadesView';
import IntelligenceInbox from './components/IntelligenceInbox';
import AlertsView from './components/AlertsView';
import AdminPanel from './pages/AdminPanel';
import BusquedaEnTiempoReal from './components/BusquedaEnTiempoReal';

import './App.css';

const filtrosIniciales: FiltroActivo = {
  sectores: [],
  fuentes: [],
  montoMin: 0,
  montoMax: Infinity,
  soloElegibleColombia: true,
  soloFavoritos: false,
  busqueda: '',
  estado: [],
  poblacionesObjetivo: [],
};

export default function App() {
  const [moduloActivo, setModuloActivo] = useState<ModuloActivo>('radar');
  const [filtros, setFiltros] = useState<FiltroActivo>(filtrosIniciales);
  const [loading, setLoading] = useState(false);
  const [hallazgos, setHallazgos] = useState<Convocatoria[]>(hallazgosIniciales);
  const [radarTab, setRadarTab] = useState<'convocatorias' | 'donantes'>('convocatorias');

  const { entidades, loading: loadingEntidades, lastSync: lastSyncEntidades, isStale: isStaleEntidades, forceSync: forceSyncEntidades } = useEntidades();
  const { convocatorias: rawConvocatorias, loading: loadingConv, lastSync: lastSyncConv, isStale: isStaleConv, sync: syncConvocatorias } = useConvocatorias();

  const [favoritos, setFavoritos] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('radar_favoritos');
      return saved ? new Set(JSON.parse(saved)) : new Set(rawConvocatorias.filter(c => c.favorito).map(c => c.id));
    } catch { return new Set(rawConvocatorias.filter(c => c.favorito).map(c => c.id)); }
  });

  const toggleFavorito = useCallback((id: string) => {
    setFavoritos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('radar_favoritos', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const convocatorias = useMemo(() =>
    rawConvocatorias.map(c => ({ ...c, favorito: favoritos.has(c.id) })),
    [rawConvocatorias, favoritos]
  );

  const estadisticas = useMemo(() => ({
    ...realEstadisticas,
    totalConvocatorias: convocatorias.length || realEstadisticas.totalConvocatorias,
    convocatoriasAbiertas: convocatorias.filter(c => c.estado === 'abierta').length || realEstadisticas.convocatoriasAbiertas,
  }), [convocatorias]);

  const handleFiltroChange = (update: Partial<FiltroActivo>) => {
    setFiltros((prev) => ({ ...prev, ...update }));
  };

  const handleToggleFavorito = (id: string) => {
    toggleFavorito(id);
  };

  const handleNavigateToModule = (modulo: string) => {
    setModuloActivo(modulo as ModuloActivo);
  };

  const handleApproveHallazgo = (id: string, categoria: string) => {
    setHallazgos(prev => prev.filter(h => h.id !== id));
    // Here we could add the approved hallazgo to the rawConvocatorias or similar,
    // but for now we just remove it from the inbox.
  };
  const handleDiscardHallazgo = (id: string) => {
    setHallazgos(prev => prev.filter(h => h.id !== id));
  };

  const convocatoriasFiltradas = useMemo(() => {
    let result = [...convocatorias];

    // BÃºsqueda global (funciona en todos los mÃ³dulos)
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      result = result.filter(
        (c) =>
          c.titulo.toLowerCase().includes(q) ||
          c.donante.toLowerCase().includes(q) ||
          c.sectores.some((s) => s.toLowerCase().includes(q)) ||
          c.fuente.toLowerCase().includes(q) ||
          c.descripcion.toLowerCase().includes(q)
      );
    }

    // Colombia
    if (filtros.soloElegibleColombia) {
      result = result.filter((c) => c.paisesElegibles.includes('Colombia'));
    }

    // Sectores
    if (filtros.sectores.length > 0) {
      result = result.filter((c) =>
        c.sectores.some((s) => filtros.sectores.includes(s))
      );
    }

    // Fuentes
    if (filtros.fuentes.length > 0) {
      result = result.filter((c) => filtros.fuentes.includes(c.fuente));
    }

    // Estado
    if (filtros.estado.length > 0) {
      result = result.filter((c) => filtros.estado.includes(c.estado));
    }

    // Poblacion Objetivo
    if (filtros.poblacionesObjetivo.length > 0) {
      result = result.filter((c) =>
        c.poblacionesObjetivo?.some((p) => filtros.poblacionesObjetivo.includes(p))
      );
    }

    // Ordenar por compatibilidad
    result.sort((a, b) => b.compatibilidadPerfil - a.compatibilidadPerfil);

    return result;
  }, [convocatorias, filtros]);

  const moduloTitulos: Record<ModuloActivo, string> = {
    radar: 'Radar',
    historico: 'HistÃ³rico Predictivo',
    riesgos: 'Analista de Riesgos',
    consorcios: 'Buscador de Consorcios',
    favoritos: 'Gestor de Favoritos',
    entidades: 'Directorio de Donantes',
    alertas: 'Centro de Alertas',
    inbox: 'Bandeja de Inteligencia IA',
    admin: 'Panel de AdministraciÃ³n',
  };

  const moduloDescripciones: Record<ModuloActivo, string> = {
    radar: 'Dashboard統合 - Convocatorias + Directorio de Donantes + Inteligencia en un solo lugar',
    historico: 'Calendario predictivo basado en patrones anuales de fondos no reimbursables',
    riesgos: 'EvaluaciÃ³n de documentos legales vs. requisitos de la subvenciÃ³n',
    consorcios: 'Base de datos de aliados internacionales potenciales para co-ejecuciÃ³n',
    favoritos: 'Workflow de postulaciones con fechas lÃ­mite y tareas asignadas',
    entidades: 'Directorio simple de contactos y datos bÃ¡sicos de donors (sin convocatorias)',
    alertas: 'Notificaciones automÃ¡ticas al Super Admin (000) con escalamiento inteligente',
    inbox: 'RevisiÃ³n de subvenciones encontradas autÃ³nomamente por el rastreador',
    admin: 'AprobaciÃ³n de convocatorias encontradas por el agente automÃ¡tico',
  };

  const renderModulo = () => {
    switch (moduloActivo) {
      case 'radar':
        return (
          <>
            <StatsGrid stats={estadisticas} />
            <div className="app__grid">
              <aside className="app__sidebar-panel">
                <FilterBar
                  filtros={filtros}
                  onFiltroChange={handleFiltroChange}
                  totalResultados={radarTab === 'convocatorias' ? convocatoriasFiltradas.length : entidades.length}
                  convocatorias={convocatorias}
                />
                <RadarVisual />
                <SignalPanel alertas={alertasSenales} />
              </aside>
              <section className="app__feed">
                <div className="app__feed-header">
                  <div className="app__feed-tabs">
                    <button 
                      className={`app__feed-tab ${radarTab === 'convocatorias' ? 'app__feed-tab--active' : ''}`}
                      onClick={() => setRadarTab('convocatorias')}
                    >
                      Subvenciones <span className="app__feed-count mono">{convocatoriasFiltradas.length}</span>
                    </button>
                    <button 
                      className={`app__feed-tab ${radarTab === 'donantes' ? 'app__feed-tab--active' : ''}`}
                      onClick={() => setRadarTab('donantes')}
                    >
                      Donantes <span className="app__feed-count mono">{entidades.length}</span>
                    </button>
                  </div>
                  {radarTab === 'convocatorias' && (
                    <div className="app__feed-sort">
                      Ordenar por: <strong>Compatibilidad</strong>
                    </div>
                  )}
                </div>
                {radarTab === 'convocatorias' ? (
                  convocatoriasFiltradas.length === 0 ? (
                    <div className="app__empty">
                      <p className="app__empty-text">No se encontraron subvenciones o donaciones con los filtros actuales.</p>
                    </div>
                  ) : (
                    <div className="app__feed-list stagger-children">
                      {convocatoriasFiltradas.map((conv, i) => (
                        <ConvocatoriaCard
                          key={conv.id}
                          conv={conv}
                          onToggleFavorito={handleToggleFavorito}
                          index={i}
                          allConvocatorias={convocatorias}
                        />
                      ))}
                    </div>
                  )
                ) : (
                  <EntidadesView entidadesIniciales={entidades} />
                )}
              </section>
            </div>
          </>
        );

      case 'historico':
        return <HistoricoView convocatorias={convocatorias} />;

      case 'riesgos':
        return <RiesgosView />;

      case 'consorcios':
        return <ConsorciosView />;

      case 'favoritos':
        return (
          <FavoritosView
            convocatorias={convocatorias}
            onToggleFavorito={handleToggleFavorito}
          />
        );

      case 'entidades':
        return <EntidadesView entidadesIniciales={entidades} modoSimple />;

      case 'alertas':
        return <AlertsView />;

      case 'inbox':
        return <IntelligenceInbox hallazgos={hallazgos} onApprove={handleApproveHallazgo} onDiscard={handleDiscardHallazgo} />;

      case 'admin':
        return <AdminPanel />;

      default:
        return null;
    }
  };

  const badges = useMemo(() => ({
    radar: convocatorias.length,
    favoritos: favoritos.size,
    inbox: hallazgos.length,
    entidades: entidades.length,
    alertas: alertasSenales.length
  }), [convocatorias.length, favoritos.size, hallazgos.length, entidades.length, alertasSenales.length]);

  return (
    <div className="app">
      <Sidebar 
        moduloActivo={moduloActivo} 
        onModuloChange={setModuloActivo} 
        badges={badges}
      />

      <main className="app__main">
        <Header
          busqueda={filtros.busqueda}
          onBusquedaChange={(busqueda) => handleFiltroChange({ busqueda })}
          alertasCount={alertasSenales.length}
          ultimaActualizacion={lastSyncConv || "nunca"}
          alertas={alertasSenales}
          onNavigateToModule={handleNavigateToModule}
        />

        <div className="app__content">
          {/* Page header */}
          <div className="app__page-header animate-fade-in" key={moduloActivo}>
            <div className="app__page-info">
              <h1 className="app__page-title">{moduloTitulos[moduloActivo]}</h1>
              <p className="app__page-desc">{moduloDescripciones[moduloActivo]}</p>
            </div>
            <div className="app__page-actions">
              <div className="app__live-badge">
                <span className="app__live-dot" />
                LIVE
              </div>
            </div>
          </div>

          {/* Module content */}
          <div key={`content-${moduloActivo}`}>
            {renderModulo()}
          </div>
        </div>
      </main>
    </div>
  );
}
