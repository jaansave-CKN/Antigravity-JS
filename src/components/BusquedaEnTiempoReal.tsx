import { useState, useEffect } from 'react';
import { Search, ExternalLink, Loader2, X, Plus, Calendar, DollarSign, Building2, RefreshCw } from 'lucide-react';

interface ResultadoBusqueda {
  titulo: string;
  url: string;
  donante: string;
  monto?: string;
  fechaCierre?: string;
  descripcion?: string;
  sector?: string;
}

interface BusquedaEnTiempoRealProps {
  onAgregarConvocatoria?: (conv: any) => void;
}

const BUSQUEDAS_RAPIDAS = [
  { label: 'MinCiencias 2026', query: 'convocatorias MinCiencias 2026 abiertas', sector: 'Ciencia' },
  { label: 'Becas Colombia', query: 'becas Colombia 2026 maestría doctorado', sector: 'Educación' },
  { label: 'Fondos Cultura', query: 'convocatorias MinCultura Colombia 2026', sector: 'Cultura' },
  { label: 'Fondos Ambiente', query: 'convocatorias MinAmbiente Colombia 2026', sector: 'Ambiente' },
  { label: 'UNESCO Becas', query: 'UNESCO scholarships Latin America 2026', sector: 'Internacional' },
  { label: 'PNUD Colombia', query: 'PNUD UNDP Colombia calls 2026', sector: 'Internacional' },
  { label: 'USAID Colombia', query: 'USAID Colombia grants funding 2026', sector: 'Internacional' },
  { label: 'BID Convocatorias', query: 'BID IDB Colombia calls proposals 2026', sector: 'Internacional' },
];

export default function BusquedaEnTiempoReal({ onAgregarConvocatoria }: BusquedaEnTiempoRealProps) {
  const [queryPersonalizado, setQueryPersonalizado] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  const [loading, setLoading] = useState(false);
  const [busquedaActiva, setBusquedaActiva] = useState<string>('');
  const [busquedaRealizada, setBusquedaRealizada] = useState(false);

  const handleBusquedaRapida = (busqueda: { label: string; query: string }) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(busqueda.query)}`;
    window.open(url, '_blank');
    setBusquedaActiva(busqueda.label);
    setBusquedaRealizada(true);
  };

  const handleBusquedaPersonalizada = () => {
    if (!queryPersonalizado.trim()) return;
    const url = `https://www.google.com/search?q=${encodeURIComponent(queryPersonalizado)}`;
    window.open(url, '_blank');
    setBusquedaActiva(queryPersonalizado);
    setBusquedaRealizada(true);
  };

  const handleBuscarEnPagina = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <div className="busqueda-tiempo-real">
      <div className="busqueda-tiempo-real__header">
        <h3>
          <Search className="icon" size={18} />
          Radar de Búsqueda 24/7
        </h3>
        <p>Hacé clic en una búsqueda para encontrar convocatorias en tiempo real</p>
      </div>

      <div className="busqueda-tiempo-real__section">
        <h4>Búsquedas Rápidas</h4>
        <div className="busqueda-tiempo-real__rapidas">
          {BUSQUEDAS_RAPIDAS.map((busqueda, index) => (
            <button
              key={index}
              onClick={() => handleBusquedaRapida(busqueda)}
              className={`busqueda-tiempo-real__rapida-btn ${busquedaActiva === busqueda.label ? 'active' : ''}`}
            >
              <Search size={14} />
              {busqueda.label}
              <span className="busqueda-tiempo-real__rapida-sector">{busqueda.sector}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="busqueda-tiempo-real__section">
        <h4>Búsqueda Personalizada</h4>
        <div className="busqueda-tiempo-real__input-group">
          <input
            type="text"
            value={queryPersonalizado}
            onChange={(e) => setQueryPersonalizado(e.target.value)}
            placeholder="Escribí tu búsqueda: Becas vivienda Colombia 2026..."
            className="busqueda-tiempo-real__input"
            onKeyDown={(e) => e.key === 'Enter' && handleBusquedaPersonalizada()}
          />
          <button 
            onClick={handleBusquedaPersonalizada}
            className="busqueda-tiempo-real__btn busqueda-tiempo-real__btn--primary"
          >
            <Search size={16} />
            Buscar
          </button>
        </div>
      </div>

      <div className="busqueda-tiempo-real__section">
        <h4>Portales de Convocatorias</h4>
        <div className="busqueda-tiempo-real__portales">
          <a 
            href="https://minciencias.gov.co/convocatorias/todas" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal"
          >
            <Building2 size={16} />
            MinCiencias
            <ExternalLink size={12} />
          </a>
          <a 
            href="https://www.colfuturo.org/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal"
          >
            <Building2 size={16} />
            Colfuturo
            <ExternalLink size={12} />
          </a>
          <a 
            href="https://www.icetex.gov.co/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal"
          >
            <Building2 size={16} />
            Icetex
            <ExternalLink size={12} />
          </a>
          <a 
            href="https://www.sena.edu.co/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal"
          >
            <Building2 size={16} />
            SENA
            <ExternalLink size={12} />
          </a>
          <a 
            href="https://www.unesco.org/creativity" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal"
          >
            <Building2 size={16} />
            UNESCO
            <ExternalLink size={12} />
          </a>
          <a 
            href="https://www.iadb.org/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal"
          >
            <Building2 size={16} />
            BID
            <ExternalLink size={12} />
          </a>
          <a 
            href="https://www.usaid.gov/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal"
          >
            <Building2 size={16} />
            USAID
            <ExternalLink size={12} />
          </a>
          <a 
            href="https://www.google.com/search?q=convocatorias+becas+Colombia+2026" 
            target="_blank" 
            rel="noopener noreferrer"
            className="busqueda-tiempo-real__portal busqueda-tiempo-real__portal--google"
          >
            <Search size={16} />
            Ver más en Google
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {busquedaRealizada && (
        <div className="busqueda-tiempo-real__status">
          <RefreshCw size={16} className="spin" />
          <span>Búsqueda abierta en nueva pestaña</span>
          <button onClick={() => setBusquedaRealizada(false)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}