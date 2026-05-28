/**
 * RADARGRID - RADAR 360
 * ====================
 * Componente principal de visualización de entidades indexadas.
 * Filtros optimizados con useMemo para 60 FPS.
 */

import React, { useState, useEffect } from 'react';
import { useRadar } from '../contexts/RadarContext';
import { 
  Globe, 
  MapPin, 
  Filter, 
  Search, 
  Building2, 
  Calendar,
  DollarSign,
  Users,
  X,
  ChevronDown
} from 'lucide-react';
import { FiltrosRadarGrid, FundingType, SectorRadar, TargetPopulationRadar } from '../types';
import './RadarGrid.css';

// Opciones de filtros
const TIPOS_FONDO: { value: FundingType; label: string }[] = [
  { value: 'Subvención', label: 'Subvención' },
  { value: 'Donación', label: 'Donación' },
  { value: 'Financiación', label: 'Financiación' },
  { value: 'Crédito Condonable', label: 'Crédito Condonable' },
  { value: 'Cooperación Internacional', label: 'Cooperación Internacional' },
];

const SECTORES: { value: SectorRadar; label: string }[] = [
  { value: 'Saneamiento Básico', label: 'Saneamiento Básico' },
  { value: 'Infraestructura', label: 'Infraestructura' },
  { value: 'Educación', label: 'Educación' },
  { value: 'Agroindustria', label: 'Agroindustria' },
  { value: 'Medio Ambiente', label: 'Medio Ambiente' },
  { value: 'Salud', label: 'Salud' },
  { value: 'Tecnología', label: 'Tecnología' },
  { value: 'Energía', label: 'Energía' },
  { value: 'Desarrollo Rural', label: 'Desarrollo Rural' },
  { value: 'Vivienda', label: 'Vivienda' },
];

const POBLACIONES: { value: TargetPopulationRadar; label: string }[] = [
  { value: 'Rural', label: 'Rural' },
  { value: 'Urbanización', label: 'Urbanización' },
  { value: 'Municipios Cat 5 y 6', label: 'Municipios Cat 5 y 6' },
  { value: 'Asociaciones Agropecuarias', label: 'Asociaciones Agropecuarias' },
  { value: 'ONGs', label: 'ONGs' },
  { value: 'Comunidades Étnicas', label: 'Comunidades Étnicas' },
  { value: 'Mujeres Cabeza de Hogar', label: 'Mujeres Cabeza de Hogar' },
  { value: 'Jóvenes', label: 'Jóvenes' },
  { value: 'Población Vulnerable', label: 'Población Vulnerable' },
];

export function RadarGrid() {
  const { 
    state, 
    entidadesFiltradas, 
    actualizarFiltros, 
    resetearFiltros 
  } = useRadar();

  const [busquedaLocal, setBusquedaLocal] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showSectorDropdown, setShowSectorDropdown] = useState(false);
  const [showPoblacionDropdown, setShowPoblacionDropdown] = useState(false);

  // Filtrado local adicional (búsqueda de texto)
  const entidadesBusqueda = React.useMemo(() => {
    if (!busquedaLocal.trim()) return entidadesFiltradas;
    const query = busquedaLocal.toLowerCase();
    return entidadesFiltradas.filter(ent =>
      ent.titulo?.toLowerCase().includes(query) ||
      ent.donante?.toLowerCase().includes(query) ||
      ent.descripcion?.toLowerCase().includes(query) ||
      ent.tags?.some(t => t.toLowerCase().includes(query))
    );
  }, [entidadesFiltradas, busquedaLocal]);

  // Handlers
  const handleToggleGlobal = () => {
    actualizarFiltros({ isGlobal: !state.filtros.isGlobal });
  };

  const handlePaisChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    actualizarFiltros({ targetCountry: e.target.value, isGlobal: false });
  };

  const handleSectorToggle = (sector: SectorRadar) => {
    const current = state.filtros.sectors;
    const updated = current.includes(sector)
      ? current.filter(s => s !== sector)
      : [...current, sector];
    actualizarFiltros({ sectors: updated });
  };

  const handlePoblacionToggle = (poblacion: TargetPopulationRadar) => {
    const current = state.filtros.targetPopulation;
    const updated = current.includes(poblacion)
      ? current.filter(p => p !== poblacion)
      : [...current, poblacion];
    actualizarFiltros({ targetPopulation: updated });
  };

  const handleFundingTypeChange = (value: string) => {
    actualizarFiltros({ fundingType: value as FundingType || undefined });
  };

  const formatearMonto = (monto?: number) => {
    if (!monto) return '-';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(monto);
  };

  const tieneFiltrosActivos = 
    !state.filtros.isGlobal ||
    state.filtros.targetCountry ||
    state.filtros.fundingType ||
    state.filtros.sectors.length > 0 ||
    state.filtros.targetPopulation.length > 0 ||
    state.filtros.monto_min !== undefined ||
    state.filtros.monto_max !== undefined;

  if (state.cargandoEntidades) {
    return (
      <div className="radargrid-loading">
        <div className="spinner"></div>
        <p>Cargando entidades del RadarGrid...</p>
      </div>
    );
  }

  return (
    <div className="radargrid-container">
      {/* Header con filtros rápidos */}
      <div className="radargrid-header">
        <div className="header-left">
          <h2>
            <Building2 size={20} />
            RadarGrid
          </h2>
          <span className="entity-count">
            {entidadesBusqueda.length} entidades
          </span>
        </div>

        <div className="header-center">
          {/* Buscador local */}
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Buscar en resultados..."
              value={busquedaLocal}
              onChange={(e) => setBusquedaLocal(e.target.value)}
            />
            {busquedaLocal && (
              <button onClick={() => setBusquedaLocal('')}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="header-right">
          <button 
            className={`btn-global ${state.filtros.isGlobal ? 'active' : ''}`}
            onClick={handleToggleGlobal}
          >
            <Globe size={16} />
            Global
          </button>

          {!state.filtros.isGlobal && (
            <div className="pais-input">
              <MapPin size={14} />
              <input
                type="text"
                placeholder="País objetivo..."
                value={state.filtros.targetCountry || ''}
                onChange={handlePaisChange}
              />
            </div>
          )}

          <button 
            className={`btn-filters ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={16} />
            Filtros
            {tieneFiltrosActivos && <span className="filter-badge"></span>}
          </button>
        </div>
      </div>

      {/* Panel de filtros avanzados */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filter-section">
            <label>Tipo de Fondo</label>
            <select
              value={state.filtros.fundingType || ''}
              onChange={(e) => handleFundingTypeChange(e.target.value)}
            >
              <option value="">Todos los tipos</option>
              {TIPOS_FONDO.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label>Sectores</label>
            <div className="dropdown-container">
              <button
                className="dropdown-trigger"
                onClick={() => setShowSectorDropdown(!showSectorDropdown)}
              >
                {state.filtros.sectors.length > 0
                  ? `${state.filtros.sectors.length} seleccionados`
                  : 'Seleccionar sectores'}
                <ChevronDown size={14} />
              </button>
              {showSectorDropdown && (
                <div className="dropdown-menu">
                  {SECTORES.map(s => (
                    <label key={s.value} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={state.filtros.sectors.includes(s.value)}
                        onChange={() => handleSectorToggle(s.value)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="filter-section">
            <label>Población Objetivo</label>
            <div className="dropdown-container">
              <button
                className="dropdown-trigger"
                onClick={() => setShowPoblacionDropdown(!showPoblacionDropdown)}
              >
                {state.filtros.targetPopulation.length > 0
                  ? `${state.filtros.targetPopulation.length} seleccionadas`
                  : 'Seleccionar poblaciones'}
                <ChevronDown size={14} />
              </button>
              {showPoblacionDropdown && (
                <div className="dropdown-menu">
                  {POBLACIONES.map(p => (
                    <label key={p.value} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={state.filtros.targetPopulation.includes(p.value)}
                        onChange={() => handlePoblacionToggle(p.value)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="filter-section">
            <label>Monto (USD)</label>
            <div className="range-inputs">
              <input
                type="number"
                placeholder="Min"
                value={state.filtros.monto_min || ''}
                onChange={(e) => actualizarFiltros({ monto_min: e.target.value ? Number(e.target.value) : undefined })}
              />
              <span>-</span>
              <input
                type="number"
                placeholder="Max"
                value={state.filtros.monto_max || ''}
                onChange={(e) => actualizarFiltros({ monto_max: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
          </div>

          {tieneFiltrosActivos && (
            <button className="btn-reset" onClick={resetearFiltros}>
              <X size={14} />
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* Grid de entidades */}
      <div className="radargrid-content">
        {entidadesBusqueda.length === 0 ? (
          <div className="radargrid-empty">
            <Building2 size={48} />
            <p>No hay entidades que coincidan con los filtros</p>
            {tieneFiltrosActivos && (
              <button onClick={resetearFiltros}>Limpiar filtros</button>
            )}
          </div>
        ) : (
          <div className="entities-grid">
            {entidadesBusqueda.map(entidad => (
              <div key={entidad.id} className="entity-card">
                {/* Header */}
                <div className="entity-header">
                  <h3>{entidad.titulo}</h3>
                  {entidad.url_convocatoria && (
                    <a 
                      href={entidad.url_convocatoria} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="entity-link"
                    >
                      Ver →
                    </a>
                  )}
                </div>

                {/* Donante */}
                <div className="entity-donante">
                  <Building2 size={12} />
                  {entidad.donante}
                </div>

                {/* Descripción */}
                <p className="entity-description">
                  {entidad.descripcion?.substring(0, 120)}
                  {entidad.descripcion && entidad.descripcion.length > 120 && '...'}
                </p>

                {/* Meta información */}
                <div className="entity-meta">
                  {/* Monto */}
                  <div className="meta-item">
                    <DollarSign size={12} />
                    {formatearMonto(entidad.monto_min)} - {formatearMonto(entidad.monto_max)}
                  </div>

                  {/* Fecha cierre */}
                  {entidad.fecha_cierre && (
                    <div className="meta-item">
                      <Calendar size={12} />
                      Cierra: {new Date(entidad.fecha_cierre).toLocaleDateString('es-CO')}
                    </div>
                  )}
                </div>

                {/* Tags de sectores */}
                <div className="entity-sectors">
                  {entidad.sectors?.slice(0, 3).map((sector, idx) => (
                    <span key={idx} className="sector-tag">{sector}</span>
                  ))}
                </div>

                {/* Población objetivo */}
                {entidad.targetPopulation && entidad.targetPopulation.length > 0 && (
                  <div className="entity-population">
                    <Users size={12} />
                    {entidad.targetPopulation.slice(0, 2).join(', ')}
                  </div>
                )}

                {/* Score de compatibilidad */}
                <div className="entity-score">
                  <div 
                    className="score-bar"
                    style={{ width: `${entidad.score_compatibilidad}%` }}
                  />
                  <span>{entidad.score_compatibilidad}% compatibilidad</span>
                </div>

                {/* Estado de validación */}
                <div className={`entity-status status-${entidad.validationStatus?.toLowerCase()}`}>
                  {entidad.validationStatus}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default RadarGrid;