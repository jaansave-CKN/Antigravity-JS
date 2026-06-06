import React, { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useRadar } from '../contexts/RadarContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useFavoritos } from '../contexts/FavoritosContext';
import { useSearch } from '../contexts/SearchContext';
import type { ModuloActivo } from '../types';

import Header from './Header';
import Sidebar from './Sidebar';

// Definir tipos para las props que necesitamos pasar
interface HeaderProps {
  busqueda: string;
  onBusquedaChange: (valor: string) => void;
  alertasCount: number;
  ultimaActualizacion: string;
  alertas: any[]; // Tipo explícito para eliminar error TS7034
  onNavigateToModule: (modulo: string) => void;
}

interface SidebarProps {
  moduloActivo: ModuloActivo; // Ahora es específicamente ModuloActivo
  onModuloChange: (modulo: string) => void;
  badges?: Partial<Record<string, number>>;
}

// Interfaz mínima para las partes del estado de Radar que necesitamos
interface RadarStateSlice {
  colaValidacion: {
    estado: string;
    [key: string]: any;
  }[];
  vistaActual: 'radargrid' | 'bandeja' | 'configuracion' | 'proyectos';
}

const DashboardLayout = ({ children }: { children: ReactNode }) => {
  // Obtener datos de contextos
  const radarCtx = useRadar();
  const subscriptionCtx = useSubscription();
  const favoritosCtx = useFavoritos();

  const { busqueda, setBusqueda } = useSearch();
  const onBusquedaChange = setBusqueda;

  const alertasCount = radarCtx?.state?.colaValidacion?.filter((item: any) => item.estado === 'Pendiente').length || 0;
  const ultimaActualizacion = radarCtx?.state?.ultimaActualizacion ?? new Date().toLocaleString('es-CO');
  const alertas: any[] = []; // Tipo explícito para eliminar error TS7034
  
  const onNavigateToModule = (modulo: string) => {
    // Mapear nombres de módulo de Header a vistas de RadarContext
    const vistaMap = {
      'radar': 'radargrid',
      'alertas': 'bandeja', // Asumiendo que alertas van a la cola de validación
      'riesgos': 'configuracion',
      'favoritos': 'proyectos', // Placeholder
      'documentos': 'configuracion',
    } as const;
    
    // Afirmamos que modulo es una clave de vistaMap para evitar error TS7053
    const vista = vistaMap[modulo as keyof typeof vistaMap] || 'radargrid';
    radarCtx?.navegarA?.(vista as RadarStateSlice['vistaActual']);
  };

  // Para Sidebar: mapear vista de RadarContext a ModuloActivo
  const moduloActivoMap = {
    radargrid: 'radar',        // Viene de Header 'radar'
    bandeja: 'inteligencia',   // Viene de Header 'alertas' (placeholder)
    configuracion: 'configuracion', // Viene de Header 'riesgos', 'favoritos', 'documentos'
    proyectos: 'proyectos',    // Viene de Header 'proyectos'
  } as const;
  
  const vistaActual = radarCtx?.state?.vistaActual || 'radargrid';
  // Afirmamos que el resultado es de tipo ModuloActivo
  const moduloActivo = (moduloActivoMap[vistaActual] || 'radar') as ModuloActivo;
  
  const onModuloChange = (modulo: string) => {
    // Mapear ModuloActivo a vista de RadarContext
    const vistaMap = {
      'radar': 'radargrid',
      'inteligencia': 'bandeja',
      'configuracion': 'configuracion',
      'proyectos': 'proyectos',
    } as const;
    
    const vista = vistaMap[modulo as keyof typeof vistaMap] || 'radargrid';
    radarCtx?.navegarA?.(vista as RadarStateSlice['vistaActual']);
  };

  // Badges opcionales para Sidebar
  const badges = {
    inbox: radarCtx?.state?.colaValidacion?.filter((item: any) => item.estado === 'Pendiente').length || 0,
    // Otros badges pueden ir aquí
  };

  return (
    <div className='dashboard-layout'>
      <Header 
        busqueda={busqueda}
        onBusquedaChange={onBusquedaChange}
        alertasCount={alertasCount}
        ultimaActualizacion={ultimaActualizacion}
        alertas={alertas}
        onNavigateToModule={onNavigateToModule}
      />
      <Sidebar 
        moduloActivo={moduloActivo}
        onModuloChange={onModuloChange}
        badges={badges}
      />
      <main className='dashboard-content'>
        <div style={{ width: '60%' }}>
          {Array.isArray(children) ? children : [children]}
        </div>
        <div style={{ width: '40%' }}>
          {/* Placeholder for TablePanel or stats panels */}
          <div>Data Panels Will Go Here</div>
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;