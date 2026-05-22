import { useState, useMemo, useCallback, memo, useMemo as useMemoCallback } from 'react';
import { Plus, Search, Filter, Building2, MapPin, Globe, Users, Briefcase, Mail, Phone, AlertCircle } from 'lucide-react';
import './directorio.css';

interface Entidad {
  id: string;
  nombre: string;
  tipo: string;
  pais: string;
  ciudad: string;
  sector: string;
  contacto: string;
  telefono: string;
  email: string;
  sitioWeb: string;
  convocatoriasActivas: number;
  ultimaActualizacion: string;
}

const entidadesIniciales: Entidad[] = [
  { id: '1', nombre: 'SENA - Fondo Emprender', tipo: 'Gubernamental', pais: 'Colombia', ciudad: 'Bogotá', sector: 'Emprendimiento', contacto: 'Dirección de Empleo y emprendimiento', telefono: '(601) 3430111', email: 'fondoemprender@sena.edu.co', sitioWeb: 'https://www.fondoemprender.com', convocatoriasActivas: 8, ultimaActualizacion: '2026-05-15' },
  { id: '2', nombre: 'ICETEX', tipo: 'Gubernamental', pais: 'Colombia', ciudad: 'Bogotá', sector: 'Educación', contacto: 'Oficina de Becas', telefono: '(601) 4173535', email: 'becas@icetex.gov.co', sitioWeb: 'https://www.icetex.gov.co', convocatoriasActivas: 12, ultimaActualizacion: '2026-05-14' },
  { id: '3', nombre: 'Ministerio de Tecnologías de la Información', tipo: 'Gubernamental', pais: 'Colombia', ciudad: 'Bogotá', sector: 'Tecnología', contacto: 'Dirección de-apps.co', telefono: '(601) 6061000', email: 'info@mincolombia.gov.co', sitioWeb: 'https://www.mintic.gov.co', convocatoriasActivas: 5, ultimaActualizacion: '2026-05-10' },
  { id: '4', nombre: 'Colombia Productiva', tipo: 'Gubernamental', pais: 'Colombia', ciudad: 'Bogotá', sector: 'Industria', contacto: 'Programa de competitividad', telefono: '(601) 7440510', email: 'contacto@colombiaproductiva.gov.co', sitioWeb: 'https://www.colombiaproductiva.gov.co', convocatoriasActivas: 6, ultimaActualizacion: '2026-05-12' },
  { id: '5', nombre: 'Fondo Nacional de Garantías', tipo: 'Financiero', pais: 'Colombia', ciudad: 'Bogotá', sector: 'Financiero', contacto: 'Área de garantías', telefono: '(601) 7421212', email: 'info@fng.gov.co', sitioWeb: 'https://www.fng.gov.co', convocatoriasActivas: 3, ultimaActualizacion: '2026-05-08' },
  { id: '6', nombre: 'BID - Banco Interamericano de Desarrollo', tipo: 'Multilateral', pais: 'Estados Unidos', ciudad: 'Washington D.C.', sector: 'Desarrollo', contacto: 'Oficina de proyectos Colombia', telefono: '+1 2026231000', email: 'colombia@iadb.org', sitioWeb: 'https://www.iadb.org', convocatoriasActivas: 15, ultimaActualizacion: '2026-05-16' },
  { id: '7', nombre: 'FAO Colombia', tipo: 'Multilateral', pais: 'Colombia', ciudad: 'Bogotá', sector: 'Agricultura', contacto: 'Programa de desarrollo rural', telefono: '(601) 2549000', email: 'FAO-CO@fao.org', sitioWeb: 'https://www.fao.org/colombia', convocatoriasActivas: 7, ultimaActualizacion: '2026-05-11' },
  { id: '8', nombre: 'PNUD Colombia', tipo: 'Multilateral', pais: 'Colombia', ciudad: 'Bogotá', sector: 'Desarrollo Social', contacto: 'Área de programas', telefono: '(601) 4889000', email: 'colombia@undp.org', sitioWeb: 'https://www.co.undp.org', convocatoriasActivas: 9, ultimaActualizacion: '2026-05-13' },
];

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch { return defaultValue; }
}

function saveToStorage(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { console.warn('Storage error'); }
}

const EntidadCard = memo(function EntidadCard({ entidad }: { entidad: Entidad }) {
  return (
    <div className="directorio__card">
      <div className="directorio__card-header">
        <div className="directorio__card-icon"><Building2 size={24} /></div>
        <div className="directorio__card-info">
          <h3 className="directorio__card-title">{entidad.nombre}</h3>
          <span className="directorio__card-type">{entidad.tipo}</span>
        </div>
      </div>
      <div className="directorio__card-body">
        <div className="directorio__card-detail"><MapPin size={14} /><span>{entidad.ciudad}, {entidad.pais}</span></div>
        <div className="directorio__card-detail"><Briefcase size={14} /><span>{entidad.sector}</span></div>
        <div className="directorio__card-detail"><Users size={14} /><span>{entidad.contacto}</span></div>
        <div className="directorio__card-detail"><Mail size={14} /><span>{entidad.email}</span></div>
        <div className="directorio__card-detail"><Phone size={14} /><span>{entidad.telefono}</span></div>
      </div>
      <div className="directorio__card-footer">
        <div className="directorio__card-badges">
          <span className="directorio__card-badge">{entidad.convocatoriasActivas} convocatorias activas</span>
          <span className="directorio__card-date">Actualizado: {entidad.ultimaActualizacion}</span>
        </div>
        <a href={entidad.sitioWeb} target="_blank" rel="noopener noreferrer" className="directorio__card-link">Visitar sitio →</a>
      </div>
    </div>
  );
});

export default function Directorio() {
  const [busqueda, setBusqueda] = useState(() => loadFromStorage('directorio_busqueda', ''));
  const [filtroTipo, setFiltroTipo] = useState(() => loadFromStorage('directorio_filtro', 'todos'));
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBusquedaChange = useCallback((value: string) => {
    setBusqueda(value);
    saveToStorage('directorio_busqueda', value);
  }, []);

  const handleFiltroChange = useCallback((value: string) => {
    setFiltroTipo(value);
    saveToStorage('directorio_filtro', value);
  }, []);

  const entidadesFiltradas = useMemo(() => {
    const searchLower = busqueda.toLowerCase();
    return entidadesIniciales.filter(entidad =>
      (entidad.nombre.toLowerCase().includes(searchLower) ||
       entidad.sector.toLowerCase().includes(searchLower) ||
       entidad.ciudad.toLowerCase().includes(searchLower)) &&
      (filtroTipo === 'todos' || entidad.tipo === filtroTipo)
    );
  }, [busqueda, filtroTipo]);

  const tiposEntidad = useMemo(() => ['todos', ...new Set(entidadesIniciales.map(e => e.tipo))], []);

  const stats = useMemo(() => ({
    entidades: entidadesFiltradas.length,
    paises: new Set(entidadesIniciales.map(e => e.pais)).size,
    convocatorias: entidadesIniciales.reduce((acc, e) => acc + e.convocatoriasActivas, 0),
  }), [entidadesFiltradas.length]);

  const gridKey = useMemo(() => `${busqueda}-${filtroTipo}`, [busqueda, filtroTipo]);

  return (
    <div className="directorio">
      {error && (
        <div className="directorio__error">
          <AlertCircle size={16} /><span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="directorio__header">
        <div className="directorio__title-section">
          <h1 className="directorio__title">Directorio de Entidades</h1>
          <p className="directorio__subtitle">Explora organizaciones, donorantes y fuentes de financiamiento disponibles</p>
        </div>
        <button className="directorio__btn-agregar" onClick={() => setMostrarFormulario(true)}>
          <Plus size={18} />Agregar Nuevo
        </button>
      </div>

      <div className="directorio__filters">
        <div className="directorio__search">
          <Search size={18} className="directorio__search-icon" />
          <input
            type="text"
            placeholder="Buscar por nombre, sector o ciudad..."
            value={busqueda}
            onChange={(e) => handleBusquedaChange(e.target.value)}
            className="directorio__search-input"
          />
        </div>
        <div className="directorio__filter-group">
          <Filter size={16} />
          <select value={filtroTipo} onChange={(e) => handleFiltroChange(e.target.value)} className="directorio__select">
            {tiposEntidad.map((tipo) => (
              <option key={tipo} value={tipo}>{tipo === 'todos' ? 'Todos los tipos' : tipo}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="directorio__stats">
        <div className="directorio__stat"><Building2 size={20} /><span className="directorio__stat-value">{stats.entidades}</span><span className="directorio__stat-label">Entidades</span></div>
        <div className="directorio__stat"><Globe size={20} /><span className="directorio__stat-value">{stats.paises}</span><span className="directorio__stat-label">Países</span></div>
        <div className="directorio__stat"><Briefcase size={20} /><span className="directorio__stat-value">{stats.convocatorias}</span><span className="directorio__stat-label">Convocatorias Activas</span></div>
      </div>

      <div className="directorio__grid" key={gridKey}>
        {entidadesFiltradas.map((entidad) => (
          <EntidadCard key={entidad.id} entidad={entidad} />
        ))}
      </div>

      {entidadesFiltradas.length === 0 && (
        <div className="directorio__empty"><Building2 size={48} /><p>No se encontraron entidades con los filtros aplicados</p></div>
      )}

      {mostrarFormulario && (
        <div className="directorio__modal-overlay" onClick={() => setMostrarFormulario(false)}>
          <div className="directorio__modal" onClick={(e) => e.stopPropagation()}>
            <div className="directorio__modal-header">
              <h2>Agregar Nueva Entidad</h2>
              <button className="directorio__modal-close" onClick={() => setMostrarFormulario(false)}>×</button>
            </div>
            <div className="directorio__modal-body">
              <p>Formulario en desarrollo...</p>
              <p className="directorio__modal-note">Esta funcionalidad permitirá agregar nuevas entidades al directorio.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}