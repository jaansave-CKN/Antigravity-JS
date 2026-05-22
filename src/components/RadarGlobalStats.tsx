import { useState, useEffect } from 'react';
import { Database, RefreshCw, Cloud, Globe, TrendingUp } from 'lucide-react';
import './RadarGlobalStats.css';

interface StatsData {
  total: number;
  activas: number;
  favoritas: number;
  porSector: Record<string, number>;
  porDonante: Record<string, number>;
  ultimaActualizacion?: string;
  fuentesProcesadas?: number;
}

export default function RadarGlobalStats() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Intentar obtener stats locales primero
      const localRes = await fetch('/api/radar/repositorio-local');
      if (localRes.ok) {
        const localData = await localRes.json();
        if (localData.success) {
          setStats({
            total: localData.total,
            activas: localData.total,
            favoritas: 0,
            porSector: {},
            porDonante: {},
            ultimaActualizacion: localData.metadatos?.ultima_actualizacion,
            fuentesProcesadas: 10
          });
          setLastUpdate(localData.metadatos?.ultima_actualizacion || '');
          setLoading(false);
          return;
        }
      }
      
      // Fallback a Firebase
      const res = await fetch('/api/ia/estadisticas');
      const data = await res.json();
      
      if (data.success) {
        setStats(data);
        setLastUpdate(new Date().toISOString());
      }
    } catch (error) {
      console.error('Error cargando stats:', error);
    }
    setLoading(false);
  };

  const triggerImport = async () => {
    try {
      const res = await fetch('/api/radar/importar-repositorio', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        alert(`Importadas ${data.importadas} convocatorias al sistema`);
        loadStats();
      }
    } catch (error) {
      console.error('Error importando:', error);
    }
  };

  if (loading && !stats) {
    return <div className="radar-stats loading">Cargando estadísticas...</div>;
  }

  const topSector = stats?.porSector 
    ? Object.entries(stats.porSector).sort((a, b) => b[1] - a[1])[0]
    : null;

  const topDonante = stats?.porDonante
    ? Object.entries(stats.porDonante).sort((a, b) => b[1] - a[1])[0]
    : null;

  return (
    <div className="radar-stats">
      <div className="radar-stats__header">
        <h3><Database size={20} /> Radar Global 360</h3>
        <button className="refresh-btn" onClick={loadStats} title="Actualizar">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="radar-stats__grid">
        <div className="stat-card stat-card--primary">
          <Globe size={24} />
          <div className="stat-card__value">{stats?.total || 0}</div>
          <div className="stat-card__label">Total Rastreado</div>
        </div>

        <div className="stat-card">
          <Cloud size={24} />
          <div className="stat-card__value">{stats?.activas || 0}</div>
          <div className="stat-card__label">Activas</div>
        </div>

        <div className="stat-card">
          <TrendingUp size={24} />
          <div className="stat-card__value">{stats?.fuentesProcesadas || 0}</div>
          <div className="stat-card__label">Fuentes</div>
        </div>
      </div>

      {lastUpdate && (
        <div className="radar-stats__update">
          Ultima actualizacion: {lastUpdate}
        </div>
      )}

      <button className="import-btn" onClick={triggerImport}>
        <RefreshCw size={16} /> Importar al Sistema
      </button>
    </div>
  );
}