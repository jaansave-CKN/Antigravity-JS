import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, updateDoc, doc, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Clock, Check, X, Eye, ExternalLink, Search, Filter, AlertCircle } from 'lucide-react';
import '../components/AdminPanel.css';

interface ConvocatoriaPendiente {
  id: string;
  titulo: string;
  donante: string;
  fuente: string;
  urlConvocatoria: string;
  sectores: string[];
  poblacionesObjetivo: string[];
  hash_contenido: string;
  ultima_actualizacion: string;
  probabilidadExito: number;
  compatibilidadPerfil: number;
}

const sectoresList = [
  'Vivienda', 'Ambiente', 'Medio Ambiente', 'Ciencia', 'Tecnologia e Innovacion',
  'Infraestructura', 'Educacion', 'Salud', 'Desarrollo Social', 'Saneamiento',
  'Agricultura', 'Emprendimiento', 'Innovacion', 'Ayuda Humanitaria', 'Desarrollo Rural',
  'Cambio Climatico', 'Biodiversidad', 'Genero', 'Paz', 'Empleo', 'Tecnologia'
];

const poblacionesList = [
  'primera_infancia', 'adulto_mayor', 'madres_cabeza_hogar', 'indigenas',
  'afrocolombianos', 'victimas_violencia', 'poblacion_desplazada', 'reincorporacion',
  'desastres_naturales', 'pobreza_extrema', 'poblacion_migrante'
];

export default function AdminPanel() {
  const { user } = useAuth();
  const [pendientes, setPendientes] = useState<ConvocatoriaPendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<string>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [convocatoriaSeleccionada, setConvocatoriaSeleccionada] = useState<ConvocatoriaPendiente | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [actualizando, setActualizando] = useState(false);
  const [radarActivo, setRadarActivo] = useState(false);
  const [radarMsg, setRadarMsg] = useState('');

  // Verificar si es admin (simplificado - en producción usar custom claims)
  const esAdmin = user?.email?.includes('admin') || user?.email?.includes('jairo');

  const checkRadarStatus = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/radar/status');
      const data = await res.json();
      setRadarActivo(data.activo);
    } catch { setRadarActivo(false); }
  };

  const toggleRadar = async () => {
    try {
      const endpoint = radarActivo ? '/api/radar/stop' : '/api/radar/start';
      const res = await fetch(`http://localhost:5000${endpoint}`, { method: 'POST' });
      const data = await res.json();
      setRadarMsg(data.message || data.error);
      setTimeout(() => setRadarMsg(''), 3000);
      checkRadarStatus();
    } catch (e) { setRadarMsg('Error de conexión'); }
  };

  const triggerRadar = async () => {
    setRadarMsg('Ejecutando ciclo...');
    try {
      await fetch('http://localhost:5000/api/radar/trigger', { method: 'POST' });
      setRadarMsg('Ciclo ejecutado');
      setTimeout(() => setRadarMsg(''), 3000);
    } catch { setRadarMsg('Error'); }
  };

  useEffect(() => { if (esAdmin) checkRadarStatus(); }, [esAdmin]);

  useEffect(() => {
    if (esAdmin) {
      cargarPendientes();
    }
  }, [esAdmin]);

  const cargarPendientes = async () => {
    setCargando(true);
    try {
      const q = query(
        collection(db, 'convocatorias'),
        where('revisada', '==', false),
        orderBy('ultima_actualizacion', 'desc'),
        limit(50)
      );
      const snapshot = await getDocs(q);
      const results: ConvocatoriaPendiente[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        results.push({
          id: doc.id,
          titulo: data.titulo || '',
          donante: data.donante || '',
          fuente: data.fuente || '',
          urlConvocatoria: data.urlConvocatoria || '',
          sectores: data.sectores ? data.sectores.split(',') : [],
          poblacionesObjetivo: data.poblacionesObjetivo ? data.poblacionesObjetivo.split(',') : [],
          hash_contenido: data.hash_contenido || '',
          ultima_actualizacion: data.ultima_actualizacion || '',
          probabilidadExito: data.probabilidadExito || 70,
          compatibilidadPerfil: data.compatibilidadPerfil || 70
        });
      });
      setPendientes(results);
    } catch (error) {
      console.error('Error cargando pendientes:', error);
    } finally {
      setCargando(false);
    }
  };

  const aprobarConvocatoria = async (conv: ConvocatoriaPendiente, aprobar: boolean) => {
    if (!conv.id) return;
    setActualizando(true);
    try {
      await updateDoc(doc(db, 'convocatorias', conv.id), {
        revisada: true,
        aprobado: aprobar,
        verificada: aprobar ? 1 : 0,
        estado: aprobar ? 'abierta' : 'rechazada',
        observaciones: observaciones || (aprobar ? 'Aprobada por admin' : 'Rechazada por admin'),
        fecha_revision: new Date().toISOString()
      });
      setPendientes(pendientes.filter(p => p.id !== conv.id));
      setConvocatoriaSeleccionada(null);
      setObservaciones('');
    } catch (error) {
      console.error('Error actualizando:', error);
    } finally {
      setActualizando(false);
    }
  };

  const pendientesFiltrados = pendientes.filter(p => {
    const matchFiltro = filtro === 'todas' || 
      (filtro === 'sector' && p.sectores.length > 0) ||
      (filtro === 'poblacion' && p.poblacionesObjetivo.length > 0);
    const matchBusqueda = !busqueda || 
      p.titulo.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.donante?.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.fuente?.toLowerCase().includes(busqueda.toLowerCase());
    return matchFiltro && matchBusqueda;
  });

  if (!esAdmin) {
    return (
      <div className="admin-panel admin-panel--acceso-denegado">
        <AlertCircle size={48} />
        <h2>Acceso Restringido</h2>
        <p>Solo los administradores pueden acceder a este panel.</p>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <div className="admin-panel__title">
          <h1>Panel de Administración</h1>
          <span className="admin-panel__badge admin-panel__badge--pendiente">
            {pendientes.length} pendientes
          </span>
        </div>

        {esAdmin && (
          <div className="admin-panel__radar-controls" style={{display: 'flex', gap: '10px', alignItems: 'center', marginLeft: 'auto'}}>
            <button
              onClick={toggleRadar}
              className={`admin-panel__btn ${radarActivo ? 'admin-panel__btn--stop' : 'admin-panel__btn--start'}`}
              style={{padding: '8px 16px', fontSize: '14px'}}
            >
              {radarActivo ? '⏹ Detener Radar' : '▶ Iniciar Radar 24/7'}
            </button>
            <button
              onClick={triggerRadar}
              className="admin-panel__btn admin-panel__btn--refresh"
              style={{padding: '8px 16px', fontSize: '14px'}}
            >
              🔄 Ciclo Ahora
            </button>
            {radarMsg && <span style={{color: radarMsg.includes('Error') ? 'red' : 'green', fontSize: '12px'}}>{radarMsg}</span>}
          </div>
        )}
        
        <div className="admin-panel__filtros">
          <div className="admin-panel__busqueda">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Buscar convocatorias..." 
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          
          <select 
            value={filtro} 
            onChange={(e) => setFiltro(e.target.value)}
            className="admin-panel__select"
          >
            <option value="todas">Todas</option>
            <option value="sector">Con sectores</option>
            <option value="poblacion">Con poblaciones</option>
          </select>
          
          <button 
            onClick={cargarPendientes}
            className="admin-panel__btn admin-panel__btn--refresh"
          >
            Actualizar
          </button>
        </div>
      </div>

      {cargando ? (
        <div className="admin-panel__loading">Cargando...</div>
      ) : pendientesFiltrados.length === 0 ? (
        <div className="admin-panel__empty">
          <Check size={48} />
          <h3>No hay convocatorias pendientes</h3>
          <p>El agente ha encontrado todo lo necesario o no hay nuevas convocatorias.</p>
        </div>
      ) : (
        <div className="admin-panel__lista">
          {pendientesFiltrados.map(conv => (
            <div key={conv.id} className="admin-panel__item">
              <div className="admin-panel__item-header">
                <div className="admin-panel__item-titulo">
                  <h3>{conv.titulo}</h3>
                  <span className="admin-panel__item-fuente">{conv.fuente}</span>
                </div>
                <div className="admin-panel__item-stats">
                  <span className="admin-panel__item-stat">
                    Compatibilidad: {conv.compatibilidadPerfil}%
                  </span>
                  <span className="admin-panel__item-stat">
                    Probabilidad: {conv.probabilidadExito}%
                  </span>
                </div>
              </div>
              
              <div className="admin-panel__item-tags">
                {conv.sectores.slice(0, 3).map(s => (
                  <span key={s} className="admin-panel__tag admin-panel__tag--sector">{s}</span>
                ))}
                {conv.poblacionesObjetivo.slice(0, 2).map(p => (
                  <span key={p} className="admin-panel__tag admin-panel__tag--poblacion">{p}</span>
                ))}
              </div>
              
              {conv.urlConvocatoria && (
                <a 
                  href={conv.urlConvocatoria} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="admin-panel__item-link"
                >
                  <ExternalLink size={14} />
                  Ver convocatoria original
                </a>
              )}
              
              <div className="admin-panel__item-actions">
                <button 
                  onClick={() => setConvocatoriaSeleccionada(conv)}
                  className="admin-panel__btn admin-panel__btn--ver"
                >
                  <Eye size={14} />
                  Revisar
                </button>
                <button 
                  onClick={() => aprobarConvocatoria(conv, true)}
                  className="admin-panel__btn admin-panel__btn--aprobar"
                  disabled={actualizando}
                >
                  <Check size={14} />
                  Aprobar
                </button>
                <button 
                  onClick={() => aprobarConvocatoria(conv, false)}
                  className="admin-panel__btn admin-panel__btn--rechazar"
                  disabled={actualizando}
                >
                  <X size={14} />
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de revisión */}
      {convocatoriaSeleccionada && (
        <div className="admin-panel__modal-overlay" onClick={() => setConvocatoriaSeleccionada(null)}>
          <div className="admin-panel__modal" onClick={e => e.stopPropagation()}>
            <div className="admin-panel__modal-header">
              <h2>Revisar Convocatoria</h2>
              <button onClick={() => setConvocatoriaSeleccionada(null)}>X</button>
            </div>
            
            <div className="admin-panel__modal-content">
              <div className="admin-panel__modal-section">
                <label>Título</label>
                <p>{convocatoriaSeleccionada.titulo}</p>
              </div>
              
              <div className="admin-panel__modal-section">
                <label>Fuente / Donante</label>
                <p>{convocatoriaSeleccionada.donante} ({convocatoriaSeleccionada.fuente})</p>
              </div>
              
              <div className="admin-panel__modal-section">
                <label>Sectores detectados</label>
                <div className="admin-panel__tags-list">
                  {convocatoriaSeleccionada.sectores.length > 0 
                    ? convocatoriaSeleccionada.sectores.map(s => (
                        <span key={s} className="admin-panel__tag admin-panel__tag--sector">{s}</span>
                      ))
                    : <span className="admin-panel__tag admin-panel__tag--none">Sin detectar</span>
                  }
                </div>
              </div>
              
              <div className="admin-panel__modal-section">
                <label>Poblaciones objetivo detectadas</label>
                <div className="admin-panel__tags-list">
                  {convocatoriaSeleccionada.poblacionesObjetivo.length > 0
                    ? convocatoriaSeleccionada.poblacionesObjetivo.map(p => (
                        <span key={p} className="admin-panel__tag admin-panel__tag--poblacion">{p}</span>
                      ))
                    : <span className="admin-panel__tag admin-panel__tag--none">Sin detectar</span>
                  }
                </div>
              </div>
              
              <div className="admin-panel__modal-section">
                <label>URL de la convocatoria</label>
                <a 
                  href={convocatoriaSeleccionada.urlConvocatoria} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="admin-panel__modal-link"
                >
                  {convocatoriaSeleccionada.urlConvocatoria}
                </a>
              </div>
              
              <div className="admin-panel__modal-section">
                <label>Observaciones (opcional)</label>
                <textarea 
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Agregar observaciones..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="admin-panel__modal-actions">
              <button 
                className="admin-panel__btn admin-panel__btn--aprobar"
                onClick={() => aprobarConvocatoria(convocatoriaSeleccionada, true)}
                disabled={actualizando}
              >
                <Check size={16} />
                Aprobar y Publicar
              </button>
              <button 
                className="admin-panel__btn admin-panel__btn--rechazar"
                onClick={() => aprobarConvocatoria(convocatoriaSeleccionada, false)}
                disabled={actualizando}
              >
                <X size={16} />
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}