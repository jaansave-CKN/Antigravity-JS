import { useState } from 'react';
import {
  Globe, MapPin, Award, ExternalLink, Search,
  Filter, Star, Building2, Users as UsersIcon, Handshake,
} from 'lucide-react';
import './ConsorciosView.css';

interface Aliado {
  id: string;
  nombre: string;
  pais: string;
  bandera: string;
  tipo: 'ONG' | 'Universidad' | 'Empresa' | 'Gobierno' | 'Multilateral';
  sectores: string[];
  experiencia: string;
  proyectosConjuntos: number;
  calificacion: number;
  contacto: string;
  descripcion: string;
}

const aliadosVacio: Aliado[] = [];

export default function ConsorciosView() {
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const aliados = aliadosVacio;

  const tipos = ['todos', 'ONG', 'Universidad', 'Empresa', 'Gobierno', 'Multilateral'];

  const aliadosFiltrados = aliados.filter(a => {
    const matchBusqueda = !busqueda ||
      a.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      a.pais.toLowerCase().includes(busqueda.toLowerCase()) ||
      a.sectores.some(s => s.toLowerCase().includes(busqueda.toLowerCase()));
    const matchTipo = filtroTipo === 'todos' || a.tipo === filtroTipo;
    return matchBusqueda && matchTipo;
  });

  return (
    <div className="consorcios animate-fade-in">
      {/* Search + filters */}
      <div className="consorcios__controls">
        <div className="consorcios__search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Buscar aliados por nombre, país o sector..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="consorcios__filters">
          <Filter size={14} />
          {tipos.map(t => (
            <button
              key={t}
              className={`consorcios__filter-btn ${filtroTipo === t ? 'consorcios__filter-btn--active' : ''}`}
              onClick={() => setFiltroTipo(t)}
            >
              {t === 'todos' ? 'Todos' : t}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="consorcios__results-header">
        <span className="consorcios__results-count">
          <UsersIcon size={14} />
          {aliadosFiltrados.length} aliados potenciales
        </span>
      </div>

      {aliados.length === 0 ? (
        <div className="consorcios__empty">
          <Handshake size={48} strokeWidth={1} />
          <h3>Sin aliados registrados</h3>
          <p>El Buscador de Consorcios te permite gestionar aliados internacionales para co-ejecución de proyectos. Los aliados se detectan automáticamente cuando identificas una convocatoria que requiere consorcio, o puedes agregar aliados manualmente desde el directorio de entidades.</p>
        </div>
      ) : (
      /* Cards grid */
      <div className="consorcios__grid stagger-children">
        {aliadosFiltrados.map(aliado => {
          const isExpanded = expandedId === aliado.id;
          return (
            <div key={aliado.id} className="consorcio-card animate-fade-in">
              <div className="consorcio-card__header">
                <div className="consorcio-card__avatar">{aliado.bandera}</div>
                <div className="consorcio-card__identity">
                  <h3 className="consorcio-card__name">{aliado.nombre}</h3>
                  <div className="consorcio-card__location">
                    <MapPin size={12} />
                    <span>{aliado.pais}</span>
                    <span className="consorcio-card__tipo">{aliado.tipo}</span>
                  </div>
                </div>
                <div className="consorcio-card__rating">
                  <Star size={14} fill="var(--warning)" stroke="var(--warning)" />
                  <span className="mono">{aliado.calificacion}</span>
                </div>
              </div>

              <div className="consorcio-card__sectors">
                {aliado.sectores.map(s => (
                  <span key={s} className="consorcio-card__sector">{s}</span>
                ))}
              </div>

              <div className="consorcio-card__stats">
                <div className="consorcio-card__stat">
                  <Award size={12} />
                  <span>{aliado.experiencia}</span>
                </div>
                {aliado.proyectosConjuntos > 0 && (
                  <div className="consorcio-card__stat consorcio-card__stat--highlight">
                    <Globe size={12} />
                    <span>{aliado.proyectosConjuntos} proyectos previos</span>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="consorcio-card__details animate-fade-in">
                  <p>{aliado.descripcion}</p>
                  <div className="consorcio-card__contact">
                    <span className="mono">{aliado.contacto}</span>
                  </div>
                </div>
              )}

              <div className="consorcio-card__actions">
                <button
                  className="consorcio-card__btn"
                  onClick={() => setExpandedId(isExpanded ? null : aliado.id)}
                >
                  {isExpanded ? 'Menos' : 'Ver perfil'}
                </button>
                <button className="consorcio-card__btn consorcio-card__btn--primary">
                  <ExternalLink size={12} />
                  Contactar
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
