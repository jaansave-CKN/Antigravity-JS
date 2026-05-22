/**
 * RADAR CONTEXT - RADAR 360
 * ========================
 * Gestiona el estado global de la aplicación, incluyendo:
 * - Estado de autenticación y organización activa
 * - Cola de validación del Agente Validador
 * - Entidades indexadas del Agente Arquitecto
 * - Filtros cruzados del RadarGrid
 * - Estado de protección por credenciales
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { 
  ConvocatoriaEstandarizada, 
  ItemColaValidacion,
  Proyecto,
  FiltrosRadarGrid,
  Organizacion,
  ValidationStatus
} from '../types';
import apiService from '../services/api';

// ============================================================
// TIPOS DEL CONTEXTO
// ============================================================

interface RadarState {
  // Estado de la organización
  organizacionActiva: Organizacion | null;
  credencialesConfiguradas: boolean;
  cargandoCredenciales: boolean;

  // Cola de validación (Agente Validador)
  colaValidacion: ItemColaValidacion[];
  cargandoCola: boolean;
  
  // Entidades indexadas (Agente Arquitecto)
  entidadesIndexadas: ConvocatoriaEstandarizada[];
  cargandoEntidades: boolean;
  
  // Proyectos (Motor B)
  proyectos: Proyecto[];
  proyectoActivoId: string | null;
  
  // Filtros RadarGrid
  filtros: FiltrosRadarGrid;
  
  // Estado de navegación
  vistaActual: 'radargrid' | 'bandeja' | 'configuracion' | 'proyectos';
  necesitaConfiguracion: boolean;
  
  // Notificaciones
  notificacion: { tipo: 'success' | 'error' | 'info'; mensaje: string } | null;
}

type RadarAction =
  | { type: 'SET_ORGANIZACION'; payload: Organizacion | null }
  | { type: 'SET_CREDENCIALES_CONFIGURADAS'; payload: boolean }
  | { type: 'SET_CARGANDO_CREDENCIALES'; payload: boolean }
  | { type: 'SET_COLA_VALIDACION'; payload: ItemColaValidacion[] }
  | { type: 'SET_CARGANDO_COLA'; payload: boolean }
  | { type: 'AGREGAR_A_COLA'; payload: ItemColaValidacion }
  | { type: 'REMOVER_DE_COLA'; payload: string }
  | { type: 'ACTUALIZAR_ITEM_COLA'; payload: { id: string; decision: ValidationStatus } }
  | { type: 'SET_ENTIDADES_INDEXADAS'; payload: ConvocatoriaEstandarizada[] }
  | { type: 'SET_CARGANDO_ENTIDADES'; payload: boolean }
  | { type: 'AGREGAR_ENTIDAD'; payload: ConvocatoriaEstandarizada }
  | { type: 'REMOVER_ENTIDAD'; payload: string }
  | { type: 'SET_PROYECTOS'; payload: Proyecto[] }
  | { type: 'SET_PROYECTO_ACTIVO'; payload: string | null }
  | { type: 'SET_FILTROS'; payload: Partial<FiltrosRadarGrid> }
  | { type: 'RESET_FILTROS' }
  | { type: 'SET_VISTA'; payload: RadarState['vistaActual'] }
  | { type: 'SET_NOTIFICACION'; payload: RadarState['notificacion'] }
  | { type: 'SET_BLOQUEO_CONFIGURACION'; payload: boolean };

const estadoInicial: RadarState = {
  organizacionActiva: null,
  credencialesConfiguradas: false,
  cargandoCredenciales: true,
  colaValidacion: [],
  cargandoCola: false,
  entidadesIndexadas: [],
  cargandoEntidades: false,
  proyectos: [],
  proyectoActivoId: null,
  filtros: {
    isGlobal: true,
    targetCountry: '',
    localRegion: undefined,
    fundingType: undefined,
    sectors: [],
    targetPopulation: [],
    monto_min: undefined,
    monto_max: undefined,
  },
  vistaActual: 'radargrid',
  necesitaConfiguracion: false,
  notificacion: null,
};

function radarReducer(state: RadarState, action: RadarAction): RadarState {
  switch (action.type) {
    case 'SET_ORGANIZACION':
      return { ...state, organizacionActiva: action.payload };
    
    case 'SET_CREDENCIALES_CONFIGURADAS':
      return { ...state, credencialesConfiguradas: action.payload };
    
    case 'SET_CARGANDO_CREDENCIALES':
      return { ...state, cargandoCredenciales: action.payload };
    
    case 'SET_COLA_VALIDACION':
      return { ...state, colaValidacion: action.payload };
    
    case 'SET_CARGANDO_COLA':
      return { ...state, cargandoCola: action.payload };
    
    case 'AGREGAR_A_COLA':
      return { ...state, colaValidacion: [action.payload, ...state.colaValidacion] };
    
    case 'REMOVER_DE_COLA':
      return { 
        ...state, 
        colaValidacion: state.colaValidacion.filter(item => item.id !== action.payload) 
      };
    
    case 'ACTUALIZAR_ITEM_COLA':
      return {
        ...state,
        colaValidacion: state.colaValidacion.map(item =>
          item.id === action.payload.id
            ? { ...item, estado: action.payload.decision, decision: action.payload.decision }
            : item
        ),
      };
    
    case 'SET_ENTIDADES_INDEXADAS':
      return { ...state, entidadesIndexadas: action.payload };
    
    case 'SET_CARGANDO_ENTIDADES':
      return { ...state, cargandoEntidades: action.payload };
    
    case 'AGREGAR_ENTIDAD':
      return { 
        ...state, 
        entidadesIndexadas: [action.payload, ...state.entidadesIndexadas] 
      };
    
    case 'REMOVER_ENTIDAD':
      return {
        ...state,
        entidadesIndexadas: state.entidadesIndexadas.filter(e => e.id !== action.payload),
      };
    
    case 'SET_PROYECTOS':
      return { ...state, proyectos: action.payload };
    
    case 'SET_PROYECTO_ACTIVO':
      return { ...state, proyectoActivoId: action.payload };
    
    case 'SET_FILTROS':
      return { 
        ...state, 
        filtros: { ...state.filtros, ...action.payload } 
      };
    
    case 'RESET_FILTROS':
      return { 
        ...state, 
        filtros: estadoInicial.filtros 
      };
    
    case 'SET_VISTA':
      return { ...state, vistaActual: action.payload };
    
    case 'SET_NOTIFICACION':
      return { ...state, notificacion: action.payload };
    
    case 'SET_BLOQUEO_CONFIGURACION':
      return { ...state, necesitaConfiguracion: action.payload };
    
    default:
      return state;
  }
}

// ============================================================
// CONTEXTO
// ============================================================

interface RadarContextValue {
  state: RadarState;
  dispatch: React.Dispatch<RadarAction>;
  
  // Actions
  verificarCredenciales: () => Promise<void>;
  cargarColaValidacion: () => Promise<void>;
  cargarEntidades: () => Promise<void>;
  aprobarItem: (itemId: string) => Promise<void>;
  descartarItem: (itemId: string, notas?: string) => Promise<void>;
  actualizarFiltros: (filtros: Partial<FiltrosRadarGrid>) => void;
  resetearFiltros: () => void;
  navegarA: (vista: RadarState['vistaActual']) => void;
  
  // Computados
  entidadesFiltradas: ConvocatoriaEstandarizada[];
  pendientesCount: number;
  aprobadasCount: number;
  descartadasCount: number;
}

const RadarContext = createContext<RadarContextValue | null>(null);

// ============================================================
// PROVIDER
// ============================================================

export function RadarProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(radarReducer, estadoInicial);

  // Verificar credenciales al inicio
  const verificarCredenciales = useCallback(async () => {
    dispatch({ type: 'SET_CARGANDO_CREDENCIALES', payload: true });
    
    try {
      const response = await apiService.validarCredenciales();
      
      if (response.success) {
        const validas = response.data?.validas || false;
        dispatch({ type: 'SET_CREDENCIALES_CONFIGURADAS', payload: validas });
        
        if (!validas) {
          dispatch({ type: 'SET_BLOQUEO_CONFIGURACION', payload: true });
          dispatch({ type: 'SET_VISTA', payload: 'configuracion' });
        }
      } else {
        dispatch({ type: 'SET_CREDENCIALES_CONFIGURADAS', payload: false });
        dispatch({ type: 'SET_BLOQUEO_CONFIGURACION', payload: true });
      }
    } catch (error) {
      dispatch({ type: 'SET_CREDENCIALES_CONFIGURADAS', payload: false });
    } finally {
      dispatch({ type: 'SET_CARGANDO_CREDENCIALES', payload: false });
    }
  }, []);

  // Cargar cola de validación
  const cargarColaValidacion = useCallback(async () => {
    dispatch({ type: 'SET_CARGANDO_COLA', payload: true });
    
    try {
      const response = await apiService.getColaValidacion();
      if (response.success && response.data) {
        dispatch({ type: 'SET_COLA_VALIDACION', payload: response.data });
      }
    } catch (error) {
      console.error('Error cargando cola:', error);
    } finally {
      dispatch({ type: 'SET_CARGANDO_COLA', payload: false });
    }
  }, []);

  // Cargar entidades indexadas
  const cargarEntidades = useCallback(async () => {
    dispatch({ type: 'SET_CARGANDO_ENTIDADES', payload: true });
    
    try {
      const response = await apiService.getEntidadesIndexadas();
      if (response.success && response.data) {
        dispatch({ type: 'SET_ENTIDADES_INDEXADAS', payload: response.data });
      }
    } catch (error) {
      console.error('Error cargando entidades:', error);
    } finally {
      dispatch({ type: 'SET_CARGANDO_ENTIDADES', payload: false });
    }
  }, []);

  // Aprobar item (mover a RadarGrid)
  const aprobarItem = useCallback(async (itemId: string) => {
    // Optimistic update
    dispatch({ type: 'ACTUALIZAR_ITEM_COLA', payload: { id: itemId, decision: 'Aprobado' } });
    
    try {
      const response = await apiService.aprobarItem(itemId);
      
      if (response.success) {
        dispatch({ type: 'REMOVER_DE_COLA', payload: itemId });
        
        // Cargar nuevas entidades
        await cargarEntidades();
        
        dispatch({ 
          type: 'SET_NOTIFICACION', 
          payload: { tipo: 'success', mensaje: 'Entidad agregada al RadarGrid' } 
        });
      } else {
        // Revertir
        dispatch({ type: 'ACTUALIZAR_ITEM_COLA', payload: { id: itemId, decision: 'Pendiente' } });
        dispatch({ 
          type: 'SET_NOTIFICACION', 
          payload: { tipo: 'error', mensaje: 'Error al aprobar entidad' } 
        });
      }
    } catch (error) {
      dispatch({ type: 'ACTUALIZAR_ITEM_COLA', payload: { id: itemId, decision: 'Pendiente' } });
    }
  }, [cargarEntidades]);

  // Descartar item
  const descartarItem = useCallback(async (itemId: string, notas?: string) => {
    // Optimistic update
    dispatch({ type: 'REMOVER_DE_COLA', payload: itemId });
    
    try {
      const response = await apiService.descartarItem(itemId);
      
      if (!response.success) {
        // Revertir si hay error
        console.error('Error descartando item');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }, []);

  // Actualizar filtros
  const actualizarFiltros = useCallback((filtros: Partial<FiltrosRadarGrid>) => {
    dispatch({ type: 'SET_FILTROS', payload: filtros });
  }, []);

  // Resetear filtros
  const resetearFiltros = useCallback(() => {
    dispatch({ type: 'RESET_FILTROS' });
  }, []);

  // Navegar a vista
  const navegarA = useCallback((vista: RadarState['vistaActual']) => {
    dispatch({ type: 'SET_VISTA', payload: vista });
  }, []);

  // Entidades filtradas con useMemo para 60 FPS
  const entidadesFiltradas = useMemo(() => {
    const { filtros } = state;
    let resultado = state.entidadesIndexadas;

    // Filtro por país
    if (!filtros.isGlobal && filtros.targetCountry) {
      resultado = resultado.filter(ent => 
        ent.paises_elegibles?.some(p => 
          p.toLowerCase().includes(filtros.targetCountry?.toLowerCase() || '')
        )
      );
    }

    // Filtro por tipo de fondo
    if (filtros.fundingType) {
      resultado = resultado.filter(ent => ent.fundingType === filtros.fundingType);
    }

    // Filtro por sectores
    if (filtros.sectors.length > 0) {
      resultado = resultado.filter(ent => 
        ent.sectors?.some(s => filtros.sectors.includes(s))
      );
    }

    // Filtro por población objetivo
    if (filtros.targetPopulation.length > 0) {
      resultado = resultado.filter(ent => 
        ent.targetPopulation?.some(p => filtros.targetPopulation.includes(p))
      );
    }

    // Filtro por monto mínimo
    if (filtros.monto_min !== undefined) {
      resultado = resultado.filter(ent => 
        (ent.monto_max || 0) >= filtros.monto_min!
      );
    }

    // Filtro por monto máximo
    if (filtros.monto_max !== undefined) {
      resultado = resultado.filter(ent => 
        (ent.monto_min || 0) <= filtros.monto_max!
      );
    }

    // Filtro por región local (Motor B)
    if (filtros.localRegion) {
      resultado = resultado.filter(ent => 
        ent.localRegion?.toLowerCase().includes(filtros.localRegion?.toLowerCase() || '')
      );
    }

    return resultado;
  }, [state.entidadesIndexadas, state.filtros]);

  // Contadores
  const pendientesCount = useMemo(() => 
    state.colaValidacion.filter(item => item.estado === 'Pendiente').length,
    [state.colaValidacion]
  );

  const aprobadasCount = useMemo(() => 
    state.colaValidacion.filter(item => item.estado === 'Aprobado').length,
    [state.colaValidacion]
  );

  const descartadasCount = useMemo(() => 
    state.colaValidacion.filter(item => item.estado === 'Descartado').length,
    [state.colaValidacion]
  );

  // Efecto inicial
  useEffect(() => {
    verificarCredenciales();
  }, [verificarCredenciales]);

  // Efecto para cargar datos cuando cambie la vista
  useEffect(() => {
    if (state.vistaActual === 'bandeja') {
      cargarColaValidacion();
    } else if (state.vistaActual === 'radargrid') {
      cargarEntidades();
    }
  }, [state.vistaActual, cargarColaValidacion, cargarEntidades]);

  // Auto-limpiar notificación
  useEffect(() => {
    if (state.notificacion) {
      const timer = setTimeout(() => {
        dispatch({ type: 'SET_NOTIFICACION', payload: null });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [state.notificacion]);

  const value: RadarContextValue = {
    state,
    dispatch,
    verificarCredenciales,
    cargarColaValidacion,
    cargarEntidades,
    aprobarItem,
    descartarItem,
    actualizarFiltros,
    resetearFiltros,
    navegarA,
    entidadesFiltradas,
    pendientesCount,
    aprobadasCount,
    descartadasCount,
  };

  return (
    <RadarContext.Provider value={value}>
      {children}
    </RadarContext.Provider>
  );
}

// ============================================================
// HOOK
// ============================================================

export function useRadar() {
  const context = useContext(RadarContext);
  if (!context) {
    throw new Error('useRadar debe usarse dentro de RadarProvider');
  }
  return context;
}

export default RadarContext;