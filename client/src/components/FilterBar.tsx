import { Filter, X, Globe, Building2, Users, ChevronDown } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { Sector, FiltroActivo, CategoriaGestion, Fuente, Convocatoria, PoblacionObjetivo } from '../types';
import './FilterBar.css';

interface FilterBarProps {
  filtros: FiltroActivo;
  onFiltroChange: (filtros: Partial<FiltroActivo>) => void;
  totalResultados: number;
  convocatorias?: Convocatoria[];
}

type SectorPilar = {
  pilar: string;
  sectores: Sector[];
};

const sectoresPorPilar: SectorPilar[] = [
  {
    pilar: 'HÁBITAT Y TERRITORIO',
    sectores: [
      'Construccion', 'Vivienda', 'Transporte', 'Ordenamiento Territorial'
    ]
  },
  {
    pilar: 'SOBERANÍA Y VIDA',
    sectores: [
      'Agua', 'Saneamiento', 'Salud', 'Medio Ambiente', 'Gestion de Riesgos'
    ]
  },
  {
    pilar: 'PAZ Y SOCIEDAD',
    sectores: [
      'Derechos Humanos', 'Cultura', 'Deporte', 'Justicia', 'Ayuda Humanitaria'
    ]
  },
  {
    pilar: 'AUTONOMÍA ECONÓMICA',
    sectores: [
      'Agro', 'Desarrollo Rural', 'Turismo', 'Emprendimiento y Cooperativismo'
    ]
  },
  {
    pilar: 'FUTURO Y CONOCIMIENTO',
    sectores: [
      'Educacion', 'Ciencia, Tecnologia e Innovacion', 'Tecnologias', 'Energias Renovables'
    ]
  }
];

const todosLosSectores: Sector[] = sectoresPorPilar.flatMap(p => p.sectores);

const estados = [
  { value: 'abierta' as const, label: 'Abiertas' },
  { value: 'proxima' as const, label: 'Próximas' },
  { value: 'cerrada' as const, label: 'Cerradas' },
];

type PoblacionItem = {
  value: PoblacionObjetivo;
  label: string;
  sub?: { value: PoblacionObjetivo; label: string }[];
};

const poblaciones: Record<string, PoblacionItem[]> = {
  'CICLO DE VIDA Y ETNIA': [
    { value: 'primera_infancia' as const, label: 'Primera Infancia' },
    { value: 'adulto_mayor' as const, label: 'Adulto Mayor' },
    { value: 'madres_cabeza_hogar' as const, label: 'Madres Cabeza de Hogar' },
    { value: 'grupos_etnicos' as const, label: 'GRUPOS ÉTNICOS', sub: [
      { value: 'indigenas' as const, label: 'Indígenas' },
      { value: 'afrocolombianos' as const, label: 'Afrocolombianos' },
      { value: 'raizales' as const, label: 'Raizales' },
      { value: 'palenqueros' as const, label: 'Palenqueros' },
      { value: 'rrom' as const, label: 'Rrom' },
      { value: 'otros_etnicos' as const, label: 'Otros' },
    ]},
  ],
  'JUSTICIA Y PAZ': [
    { value: 'victimas_violencia' as const, label: 'Víctimas de la Violencia' },
    { value: 'poblacion_desplazada' as const, label: 'Población Desplazada' },
    { value: 'reincorporacion' as const, label: 'Proceso de Reincorporación' },
    { value: 'otros_justicia_paz' as const, label: 'Otros' },
  ],
  'VULNERABILIDAD CRÍTICA': [
    { value: 'desastres_naturales' as const, label: 'Víctimas de desastres naturales' },
    { value: 'situacion_calle' as const, label: 'Personas en situación de calle' },
    { value: 'salud_especial' as const, label: 'Condiciones de salud especiales' },
    { value: 'consumo_sustancias' as const, label: 'Consumo de sustancias' },
    { value: 'pobreza_extrema' as const, label: 'Pobreza extrema' },
    { value: 'poblacion_migrante' as const, label: 'Población migrante' },
    { value: 'otros_vulnerabilidad' as const, label: 'Otros' },
  ],
};

const SECCIONES = ['estado', 'sector', 'publico', 'fuente'] as const;

export default function FilterBar({ filtros, onFiltroChange, totalResultados, convocatorias = [] }: FilterBarProps) {
  const [collapsedSecciones, setCollapsedSecciones] = useState<Record<string, boolean>>(
    Object.fromEntries(SECCIONES.map(s => [s, true]))
  );
  const [collapsedGrupos, setCollapsedGrupos] = useState<Record<string, boolean>>(() => {
    const grupos: Record<string, boolean> = {};
    Object.keys(poblaciones).forEach(k => grupos[k] = false);
    sectoresPorPilar.forEach(p => grupos[p.pilar] = true);
    return grupos;
  });

  const entidadesUnicas = useMemo(() => {
    const conteo: Record<string, number> = {};
    convocatorias.forEach(conv => {
      const fuente = conv.fuente as string;
      conteo[fuente] = (conteo[fuente] || 0) + 1;
    });
    return Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .map(([nombre, cantidad]) => ({ nombre, cantidad }));
  }, [convocatorias]);

  const toggleSeccion = (seccion: string) => {
    setCollapsedSecciones(prev => ({ ...prev, [seccion]: !prev[seccion] }));
  };

  const toggleGrupo = (grupo: string) => {
    setCollapsedGrupos(prev => ({ ...prev, [grupo]: !prev[grupo] }));
  };

  const toggleSector = (sector: Sector) => {
    if (filtros.sectores.includes(sector)) {
      onFiltroChange({ sectores: [] });
    } else {
      onFiltroChange({ sectores: [sector] });
    }
  };

  const toggleFuente = (fuente: Fuente) => {
    const newFuentes = filtros.fuentes.includes(fuente)
      ? filtros.fuentes.filter((f) => f !== fuente)
      : [...filtros.fuentes, fuente];
    onFiltroChange({ fuentes: newFuentes });
  };

  const toggleEstado = (estado: 'abierta' | 'proxima' | 'cerrada') => {
    if (filtros.estado.includes(estado)) {
      onFiltroChange({ estado: [] });
    } else {
      onFiltroChange({ estado: [estado] });
    }
  };

  const togglePoblacion = (poblacion: PoblacionObjetivo) => {
    const isSelected = filtros.poblacionesObjetivo.includes(poblacion);
    if (isSelected) {
      onFiltroChange({ poblacionesObjetivo: [] });
    } else {
      onFiltroChange({ poblacionesObjetivo: [poblacion] });
    }
  };

  const clearAll = () => {
    onFiltroChange({
      sectores: [],
      fuentes: [],
      estado: [],
      soloElegibleColombia: true,
      soloFavoritos: false,
      categoriaGestion: undefined,
      poblacionesObjetivo: [],
    });
  };

  const hasFilters = filtros.sectores.length > 0 || filtros.estado.length > 0 ||
    filtros.fuentes.length > 0 || filtros.soloFavoritos || filtros.categoriaGestion ||
    filtros.poblacionesObjetivo.length > 0;

  const seccionBadge = (key: string, count: number) => count > 0
    ? <span className="filter-bar__seccion-badge">{count}</span>
    : null;

  return (
    <div className="filter-bar">
      <div className="filter-bar__header">
        <div className="filter-bar__title">
          <Filter size={14} />
          <span>Filtros</span>
          <span className="filter-bar__count mono">{totalResultados} resultados</span>
        </div>
        {hasFilters && (
          <button className="filter-bar__clear" onClick={clearAll}>
            <X size={12} /> Limpiar
          </button>
        )}
      </div>

      <div className="filter-bar__group">
        <span className="filter-bar__group-label">Estado</span>
        <div className="filter-bar__chips">
          {estados.map((e) => (
            <button
              key={e.value}
              className={`filter-chip ${filtros.estado.includes(e.value) ? 'filter-chip--active' : ''}`}
              onClick={() => toggleEstado(e.value)}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-bar__group" style={{ width: '25% !important', maxWidth: '25% !important', minWidth: '200px' }}>
        <button className="filter-bar__seccion-header" onClick={() => toggleSeccion('sector')}>
          <span className="filter-bar__seccion-title">
            Sector
            {seccionBadge('sector', filtros.sectores.length)}
          </span>
          <ChevronDown size={14} className={`filter-bar__seccion-chevron ${collapsedSecciones['sector'] ? 'filter-bar__seccion-chevron--collapsed' : ''}`} />
        </button>
        {!collapsedSecciones['sector'] && (
          <div className="filter-bar__pilar-container" style={{ maxWidth: '100% !important', width: '100%' }}>
            {sectoresPorPilar.map((pilar) => (
              <div key={pilar.pilar} className="filter-bar__pilar-group">
                <button 
                  className="filter-bar__pilar-header" 
                  onClick={() => toggleGrupo(pilar.pilar)}
                >
                  <span className="filter-bar__pilar-title">{pilar.pilar}</span>
                  <ChevronDown size={12} className={`filter-bar__seccion-chevron ${collapsedGrupos[pilar.pilar] ? 'filter-bar__seccion-chevron--collapsed' : ''}`} />
                </button>
                {!collapsedGrupos[pilar.pilar] && (
                  <div className="filter-bar__chips filter-bar__chips--wrap">
                    {pilar.sectores.map((s) => (
                      <button
                        key={s}
                        className={`filter-chip ${filtros.sectores.includes(s) ? 'filter-chip--active' : ''}`}
                        onClick={() => toggleSector(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="filter-bar__group" style={{ width: '25% !important', maxWidth: '25% !important', minWidth: '200px' }}>
        <button className="filter-bar__seccion-header" onClick={() => toggleSeccion('publico')}>
          <span className="filter-bar__seccion-title">
            <Users size={12} /> Población Objetiva
            {seccionBadge('publico', filtros.poblacionesObjetivo.length)}
          </span>
          <ChevronDown size={14} className={`filter-bar__seccion-chevron ${collapsedSecciones['publico'] ? 'filter-bar__seccion-chevron--collapsed' : ''}`} />
        </button>
        {!collapsedSecciones['publico'] && Object.entries(poblaciones).map(([grupo, items]) => (
          <div key={grupo} className="filter-bar__poblacion-group">
            <button className="filter-bar__poblacion-header" onClick={() => toggleGrupo(grupo)}>
              <span>{grupo}</span>
              <ChevronDown size={12} className={`filter-bar__seccion-chevron ${collapsedGrupos[grupo] ? 'filter-bar__seccion-chevron--collapsed' : ''}`} />
            </button>
            {!collapsedGrupos[grupo] && (
              <div className="filter-bar__chips filter-bar__chips--wrap">
                {items.map((item) => {
                  if (item.sub) {
                    return (
                      <div key={item.value} className="filter-bar__poblacion-sub-group">
                        <button
                          className={`filter-chip filter-chip--poblacion ${filtros.poblacionesObjetivo.includes(item.value) ? 'filter-chip--active' : ''}`}
                          onClick={() => togglePoblacion(item.value)}
                        >
                          {item.label}
                        </button>
                        <div className="filter-bar__chips filter-bar__chips--wrap filter-bar__poblacion-sub-items">
                          {item.sub.map((subItem) => (
                            <button
                              key={subItem.value}
                              className={`filter-chip filter-chip--poblacion filter-chip--poblacion-sub ${filtros.poblacionesObjetivo.includes(subItem.value) ? 'filter-chip--active' : ''}`}
                              onClick={() => togglePoblacion(subItem.value)}
                            >
                              {subItem.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={item.value}
                      className={`filter-chip filter-chip--poblacion ${filtros.poblacionesObjetivo.includes(item.value) ? 'filter-chip--active' : ''}`}
                      onClick={() => togglePoblacion(item.value)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="filter-bar__group">
        <button className="filter-bar__seccion-header" onClick={() => toggleSeccion('fuente')}>
          <span className="filter-bar__seccion-title">
            <Building2 size={12} /> Fuente ({entidadesUnicas.length})
            {seccionBadge('fuente', filtros.fuentes.length)}
          </span>
          <ChevronDown size={14} className={`filter-bar__seccion-chevron ${collapsedSecciones['fuente'] ? 'filter-bar__seccion-chevron--collapsed' : ''}`} />
        </button>
        {!collapsedSecciones['fuente'] && (
          <div className="filter-bar__chips filter-bar__chips--wrap">
            {entidadesUnicas.map((ent) => (
              <button
                key={ent.nombre}
                className={`filter-chip filter-chip--fuente ${filtros.fuentes.includes(ent.nombre as Fuente) ? 'filter-chip--active' : ''}`}
                onClick={() => toggleFuente(ent.nombre as Fuente)}
                title={`${ent.cantidad} convocatorias`}
              >
                {ent.nombre} <span className="filter-chip__count">({ent.cantidad})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="filter-bar__toggles">
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={filtros.soloElegibleColombia}
            onChange={(e) => onFiltroChange({ soloElegibleColombia: e.target.checked })}
          />
          <span className="filter-toggle__switch" />
          <Globe size={12} />
          <span>Solo elegible Colombia</span>
        </label>
      </div>
    </div>
  );
}