import React, { useState, useEffect, useCallback } from 'react';
import { useAIOrchestrator } from '../hooks/useAIOrchestrator';
import { Convocatoria, PoblacionObjetivo } from '../types';
import { Search, Filter, Users, Target, TrendingUp, AlertCircle, CheckCircle, Clock, ArrowRight } from 'lucide-react';

interface CategoriaPoblacion {
  id: string;
  nombre: string;
  descripcion: string;
  icon: string;
  viabilityNBI: number;
  isPDET: boolean;
  poblaciones: string[];
  seleccionado: boolean;
}

interface SegmentoDetallado {
  id: string;
  categoria: string;
  nombre: string;
  rangoEdad?: string;
  seleccionado: boolean;
}

interface FondoAprobado {
  id: string;
  nombre: string;
  donante: string;
  monto: number;
  poblacionObjetivo: string[];
  viabilidad: number;
  estado: 'aprobado' | 'pendiente' | 'rechazado';
  fechaAprobacion?: string;
  taskId?: string;
}

const CATEGORIAS_POBLACION: CategoriaPoblacion[] = [
  {
    id: 'fortalecimiento-publico',
    nombre: 'Fortalecimiento Público',
    descripcion: 'Entidades gubernamentales, instituciones públicas y organizaciones del sector estatal',
    icon: '🏛️',
    viabilityNBI: 85,
    isPDET: true,
    poblaciones: ['entidades_publicas', 'gobierno_municipal', 'alcaldias', 'governanza'],
    seleccionado: false,
  },
  {
    id: 'organizaciones-base',
    nombre: 'Organizaciones de Base',
    descripcion: 'JAC, JAL, organizaciones comunitarias, cooperativas y grupos de base',
    icon: '🤝',
    viabilityNBI: 92,
    isPDET: true,
    poblaciones: ['juntas_accion_comunal', 'cooperativas', 'asociaciones_comunales', 'organizaciones_mujeres'],
    seleccionado: false,
  },
  {
    id: 'desarrollo-rural',
    nombre: 'Desarrollo Rural',
    descripcion: 'Comunidades rurales, campesinas, agrarias y proyectos de campo',
    icon: '🌾',
    viabilityNBI: 78,
    isPDET: true,
    poblaciones: ['campesinos', 'comunidades_rurales', 'productores_agrarios', 'economia_ campestre'],
    seleccionado: false,
  },
];

const SEGMENTOS_CICLO_VIDA: SegmentoDetallado[] = [
  { id: 'primera-infancia', categoria: 'ciclo_vida', nombre: 'Primera Infancia', rangoEdad: '0-5 años', seleccionado: false },
  { id: 'infancia', categoria: 'ciclo_vida', nombre: 'Infancia', rangoEdad: '6-11 años', seleccionado: false },
  { id: 'adolescencia', categoria: 'ciclo_vida', nombre: 'Adolescencia', rangoEdad: '12-17 años', seleccionado: false },
  { id: 'juventud', categoria: 'ciclo_vida', nombre: 'Juventud', rangoEdad: '18-28 años', seleccionado: false },
  { id: 'adulthood', categoria: 'ciclo_vida', nombre: 'Adulthood', rangoEdad: '29-59 años', seleccionado: false },
  { id: 'adulto-mayor', categoria: 'ciclo_vida', nombre: 'Adulto Mayor', rangoEdad: '60+ años', seleccionado: false },
];

const SEGMENTOS_ETNICOS: SegmentoDetallado[] = [
  { id: 'indigenas', categoria: 'etnico', nombre: 'Pueblos Indígenas', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'afrocolombianos', categoria: 'etnico', nombre: 'Comunidades Afrocolombianas', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'raizales', categoria: 'etnico', nombre: 'Raizales', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'palenqueros', categoria: 'etnico', nombre: 'Palenqueros', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'rom', categoria: 'etnico', nombre: 'Pueblo Rrom', rangoEdad: 'Todas las edades', seleccionado: false },
];

const SEGMENTOS_JUSTICIA_PAZ: SegmentoDetallado[] = [
  { id: 'victimas', categoria: 'justicia_paz', nombre: 'Víctimas del Conflicto', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'reincorporacion', categoria: 'justicia_paz', nombre: 'Proceso de Reincorporación', rangoEdad: '18-60 años', seleccionado: false },
  { id: 'desplazados', categoria: 'justicia_paz', nombre: 'Población Desplazada', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'sDDR', categoria: 'justicia_paz', nombre: 'Desarme Desmovilización Reintegración', rangoEdad: '18-55 años', seleccionado: false },
];

const SEGMENTOS_VULNERABILIDAD: SegmentoDetallado[] = [
  { id: 'pobreza-extrema', categoria: 'vulnerabilidad', nombre: 'Pobreza Extrema (NBI)', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'madres-cabeza', categoria: 'vulnerabilidad', nombre: 'Madres Cabeza de Hogar', rangoEdad: '18-65 años', seleccionado: false },
  { id: 'situacion-calle', categoria: 'vulnerabilidad', nombre: 'Población en Situación de Calle', rangoEdad: '18+ años', seleccionado: false },
  { id: 'migrantes', categoria: 'vulnerabilidad', nombre: 'Población Migrante', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'salud-especial', categoria: 'vulnerabilidad', nombre: 'Salud con Necesidades Especiales', rangoEdad: 'Todas las edades', seleccionado: false },
  { id: 'consumo-sustancias', categoria: 'vulnerabilidad', nombre: 'Programa de Sustancias Psicoactivas', rangoEdad: '15-65 años', seleccionado: false },
];

const mockFondosAprobados: FondoAprobado[] = [
  {
    id: 'fondo-001',
    nombre: 'Fondo de Fortalecimiento Comunitario 2026',
    donante: 'UNDP Colombia',
    monto: 150000000,
    poblacionObjetivo: ['organizaciones_base', 'desarrollo_rural'],
    viabilidad: 94,
    estado: 'aprobado',
    fechaAprobacion: '2026-05-15',
  },
  {
    id: 'fondo-002',
    nombre: 'Programa PDET - Inversión Territorial',
    donante: 'Agencia de Renovación del Territorio',
    monto: 500000000,
    poblacionObjetivo: ['fortalecimiento_publico', 'desarrollo_rural'],
    viabilidad: 89,
    estado: 'aprobado',
    fechaAprobacion: '2026-05-10',
  },
  {
    id: 'fondo-003',
    nombre: 'Fondo Indigenous & Afro Rights',
    donante: 'USAID',
    monto: 85000000,
    poblacionObjetivo: ['organizaciones_base'],
    viabilidad: 87,
    estado: 'pendiente',
    taskId: 'task-semantic-001',
  },
];

export const TableroBeneficiarios: React.FC = () => {
  const { stats, tasks, submitTask, queueStatus } = useAIOrchestrator();
  
  const [categorias, setCategorias] = useState<CategoriaPoblacion[]>(CATEGORIAS_POBLACION);
  const [segmentosCiclo, setSegmentosCiclo] = useState<SegmentoDetallado[]>(SEGMENTOS_CICLO_VIDA);
  const [segmentosEtnicos, setSegmentosEtnicos] = useState<SegmentoDetallado[]>(SEGMENTOS_ETNICOS);
  const [segmentosJusticia, setSegmentosJusticia] = useState<SegmentoDetallado[]>(SEGMENTOS_JUSTICIA_PAZ);
  const [segmentosVulnerabilidad, setSegmentosVulnerabilidad] = useState<SegmentoDetallado[]>(SEGMENTOS_VULNERABILIDAD);
  const [fondos, setFondos] = useState<FondoAprobado[]>(mockFondosAprobados);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const toggleCategoria = useCallback((id: string) => {
    setCategorias(prev => prev.map(cat => 
      cat.id === id ? { ...cat, seleccionado: !cat.seleccionado } : cat
    ));
  }, []);

  const toggleSegmento = (
    setter: React.Dispatch<React.SetStateAction<SegmentoDetallado[]>>,
    segmentos: SegmentoDetallado[],
    id: string
  ) => {
    setter(prev => prev.map(seg => 
      seg.id === id ? { ...seg, seleccionado: !seg.seleccionado } : seg
    ));
  };

  const handleSearchFondos = useCallback(() => {
    if (!searchTerm.trim()) return;
    
    setIsSearching(true);
    const selectedPoblaciones: string[] = [];
    
    categorias.filter(c => c.seleccionado).forEach(c => {
      selectedPoblaciones.push(...c.poblaciones);
    });
    
    segmentosCiclo.filter(s => s.seleccionado).forEach(s => selectedPoblaciones.push(s.id));
    segmentosEtnicos.filter(s => s.seleccionado).forEach(s => selectedPoblaciones.push(s.id));
    segmentosJusticia.filter(s => s.seleccionado).forEach(s => selectedPoblaciones.push(s.id));
    segmentosVulnerabilidad.filter(s => s.seleccionado).forEach(s => selectedPoblaciones.push(s.id));

    const taskId = submitTask('analysis',
      `Buscar fondos disponibles para poblaciones objetivo:
      Búsqueda: ${searchTerm}
      Categorías: ${categorias.filter(c => c.seleccionado).map(c => c.nombre).join(', ')}
      Segmentos seleccionados: ${selectedPoblaciones.join(', ')}

      Generar lista de fondos con viabilidad > 80%`,
      'high'
    );

    setTimeout(() => {
      setIsSearching(false);
      const newFondo: FondoAprobado = {
        id: `fondo-${Date.now()}`,
        nombre: `Fondo: ${searchTerm} - Resultado IA`,
        donante: 'Agente Autonomo',
        monto: Math.floor(Math.random() * 500000000) + 50000000,
        poblacionObjetivo: selectedPoblaciones,
        viabilidad: Math.floor(Math.random() * 20) + 80,
        estado: 'pendiente',
        taskId,
      };
      setFondos(prev => [newFondo, ...prev]);
    }, 2000);
  }, [searchTerm, categorias, segmentosCiclo, segmentosEtnicos, segmentosJusticia, segmentosVulnerabilidad, submitTask]);

  const getStatusIcon = (estado: string) => {
    switch (estado) {
      case 'aprobado': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'pendiente': return <Clock className="w-4 h-4 text-amber-500" />;
      case 'rechazado': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return null;
    }
  };

  const formatMoneda = (monto: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(monto);
  };

  const selectedCount = categorias.filter(c => c.seleccionado).length + 
    segmentosCiclo.filter(s => s.seleccionado).length +
    segmentosEtnicos.filter(s => s.seleccionado).length +
    segmentosJusticia.filter(s => s.seleccionado).length +
    segmentosVulnerabilidad.filter(s => s.seleccionado).length;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        
        {/* HEADER */}
        <div className="bg-white rounded-lg shadow-md p-4 border border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Tablero de Cotejo Semántico - Beneficiarios</h1>
                <p className="text-xs text-slate-500">Sistema de Matching Fondo-Población Objetivo</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Segmentos: {selectedCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Queue: {queueStatus}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Tasks: {stats.processing}/{stats.total}</span>
              </div>
            </div>
          </div>
        </div>

        {/* BLOQUE 1: CATEGORÍA DE POBLACIÓN OBJETIVO */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200">
          <div className="p-4 border-b border-slate-200 bg-slate-100">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span>🏛️</span> Categoría de Población Objetivo
            </h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {categorias.map(cat => (
                <div 
                  key={cat.id}
                  onClick={() => toggleCategoria(cat.id)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    cat.seleccionado 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">{cat.icon}</span>
                    <div className="flex gap-1">
                      <span className={`px-2 py-0.5 text-xs rounded ${cat.viabilityNBI >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        NBI: {cat.viabilityNBI}%
                      </span>
                      {cat.isPDET && (
                        <span className="px-2 py-0.5 text-xs rounded bg-purple-100 text-purple-700">
                          PDET
                        </span>
                      )}
                    </div>
                  </div>
                  <h3 className="font-semibold text-slate-800 mb-1">{cat.nombre}</h3>
                  <p className="text-xs text-slate-500">{cat.descripcion}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {cat.poblaciones.slice(0, 3).map(p => (
                      <span key={p} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                        {p.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* BLOQUE 2: SEGMENTACIÓN DETALLADA */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200">
          <div className="p-4 border-b border-slate-200 bg-slate-100">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span>👥</span> Segmentación Detallada
            </h2>
          </div>
          <div className="p-4 space-y-6">
            
            {/* Ciclo de Vida */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Ciclo de Vida
              </h3>
              <div className="flex flex-wrap gap-2">
                {segmentosCiclo.map(seg => (
                  <button
                    key={seg.id}
                    onClick={() => toggleSegmento(setSegmentosCiclo, segmentosCiclo, seg.id)}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      seg.seleccionado
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {seg.nombre}
                    {seg.rangoEdad && <span className="ml-1 opacity-75">({seg.rangoEdad})</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Grupos Étnicos */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4" /> Grupos Étnicos
              </h3>
              <div className="flex flex-wrap gap-2">
                {segmentosEtnicos.map(seg => (
                  <button
                    key={seg.id}
                    onClick={() => toggleSegmento(setSegmentosEtnicos, segmentosEtnicos, seg.id)}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      seg.seleccionado
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {seg.nombre}
                    {seg.rangoEdad && <span className="ml-1 opacity-75">({seg.rangoEdad})</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Justicia y Paz */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Justicia y Paz
              </h3>
              <div className="flex flex-wrap gap-2">
                {segmentosJusticia.map(seg => (
                  <button
                    key={seg.id}
                    onClick={() => toggleSegmento(setSegmentosJusticia, segmentosJusticia, seg.id)}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      seg.seleccionado
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {seg.nombre}
                    {seg.rangoEdad && <span className="ml-1 opacity-75">({seg.rangoEdad})</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Vulnerabilidad Crítica */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" /> Vulnerabilidad Crítica
              </h3>
              <div className="flex flex-wrap gap-2">
                {segmentosVulnerabilidad.map(seg => (
                  <button
                    key={seg.id}
                    onClick={() => toggleSegmento(setSegmentosVulnerabilidad, segmentosVulnerabilidad, seg.id)}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      seg.seleccionado
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {seg.nombre}
                    {seg.rangoEdad && <span className="ml-1 opacity-75">({seg.rangoEdad})</span>}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* BLOQUE 3: CONSOLA DE MATCH SEMÁNTICO */}
        <div className="bg-white rounded-lg shadow-md border border-slate-200">
          <div className="p-4 border-b border-slate-200 bg-slate-100">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Search className="w-5 h-5" /> Consola de Match Semántico
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar fondos por palabra clave..."
                    className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm w-80"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchFondos()}
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
                <button
                  onClick={handleSearchFondos}
                  disabled={isSearching || !searchTerm.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSearching ? (
                    <>Buscando...</>
                  ) : (
                    <>
                      <Filter className="w-4 h-4" />
                      Buscar Fondos
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          
          <div className="p-4">
            {/* Tabla de Resultados */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-3 font-semibold text-slate-600">Estado</th>
                    <th className="text-left p-3 font-semibold text-slate-600">Fondo</th>
                    <th className="text-left p-3 font-semibold text-slate-600">Donante</th>
                    <th className="text-right p-3 font-semibold text-slate-600">Monto</th>
                    <th className="text-center p-3 font-semibold text-slate-600">Viabilidad</th>
                    <th className="text-left p-3 font-semibold text-slate-600">Poblaciones</th>
                    <th className="text-center p-3 font-semibold text-slate-600">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {fondos.map(fondo => (
                    <tr key={fondo.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(fondo.estado)}
                          <span className={`text-xs font-medium ${
                            fondo.estado === 'aprobado' ? 'text-emerald-600' :
                            fondo.estado === 'pendiente' ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {fondo.estado.toUpperCase()}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 font-medium text-slate-800">{fondo.nombre}</td>
                      <td className="p-3 text-slate-600">{fondo.donante}</td>
                      <td className="p-3 text-right font-mono text-slate-700">
                        {formatMoneda(fondo.monto)}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                fondo.viabilidad >= 90 ? 'bg-emerald-500' :
                                fondo.viabilidad >= 80 ? 'bg-blue-500' : 'bg-amber-500'
                              }`}
                              style={{ width: `${fondo.viabilidad}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{fondo.viabilidad}%</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {fondo.poblacionObjetivo.slice(0, 2).map(p => (
                            <span key={p} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                              {p.replace('_', ' ')}
                            </span>
                          ))}
                          {fondo.poblacionObjetivo.length > 2 && (
                            <span className="px-2 py-0.5 text-xs text-slate-400">
                              +{fondo.poblacionObjetivo.length - 2}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                          <ArrowRight className="w-4 h-4 text-slate-400 hover:text-blue-500" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {fondos.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No hay fondos disponibles. Seleccione poblaciones objetivo y busque.</p>
              </div>
            )}

            {/* Stats Row */}
            <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                  {fondos.filter(f => f.estado === 'aprobado').length} Aprobados
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-500" />
                  {fondos.filter(f => f.estado === 'pendiente').length} Pendientes
                </span>
              </div>
              <div>
                Total disponible: <span className="font-mono font-medium text-slate-700">
                  {formatMoneda(fondos.filter(f => f.estado === 'aprobado').reduce((acc, f) => acc + f.monto, 0))}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default TableroBeneficiarios;