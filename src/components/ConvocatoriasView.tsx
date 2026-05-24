import { useState, useEffect, useMemo, useCallback } from 'react';
import { Filter, Search, Calendar, DollarSign, Globe, ExternalLink, Award, Wifi, WifiOff } from 'lucide-react';
import './ConvocatoriasView.css';

const API_URL = import.meta.env.VITE_API_URL || '';
const WS_URL = (API_URL || 'ws://localhost:8000').replace(/^http/, 'ws') + '/ws/live_radar';

interface Convocatoria {
  id: number;
  externo_id: string;
  titulo: string;
  donante: string;
  fuente: string;
  descripcion: string;
  monto_min: number;
  monto_max: number;
  moneda: string;
  paises_elegibles: string;
  sectores: string;
  url_convocatoria: string;
  url_fuente: string;
  fecha_limite: string;
  fecha_publicacion: string;
  requisitos: string;
  estado: string;
  score_probabilidad: number;
  created_at: string;
}

const defaultConvocatorias: Convocatoria[] = [
  { id: 0, externo_id: 'SENA-FE-2026-NARP', titulo: 'Fondo Emprender 2026 - Población NARP', donante: 'SENA - Fondo Emprender', fuente: 'SENA', descripcion: 'Financiamiento para proyectos de población negra, afrocolombiana, raizales y palenqueros.', monto_min: 0, monto_max: 100000000, moneda: 'COP', paises_elegibles: '["Colombia"]', sectores: '["Emprendimiento","Desarrollo Económico"]', url_convocatoria: 'https://www.fondoemprender.com', url_fuente: 'https://www.fondoemprender.com', fecha_limite: '2026-04-30', fecha_publicacion: '2026-01-01', requisitos: '["Ser colombiano mayor de edad","Presentar plan de negocios"]', estado: 'abierta', score_probabilidad: 70, created_at: '2026-01-01' },
  { id: 0, externo_id: 'UE-GRANT-2026-1', titulo: 'EU4Environment - Grants for SMEs', donante: 'Unión Europea', fuente: 'EU Funding', descripcion: 'Subvenciones para pequeñas y medianas empresas implementando prácticas ambientales.', monto_min: 50000, monto_max: 500000, moneda: 'EUR', paises_elegibles: '["Colombia","México","Perú"]', sectores: '["Medio Ambiente","Sostenibilidad"]', url_convocatoria: 'https://ec.europa.eu', url_fuente: 'https://ec.europa.eu', fecha_limite: '2026-06-15', fecha_publicacion: '2026-01-15', requisitos: '["PYME registrada","Proyecto ambiental"]', estado: 'abierta', score_probabilidad: 80, created_at: '2026-01-15' },
  { id: 0, externo_id: 'UNESCO-CULT-2026', titulo: 'UNESCO IFCD - Fondo Internacional para la Diversidad Cultural', donante: 'UNESCO', fuente: 'UNESCO', descripcion: 'Fondos para proyectos culturales que promuevan la diversidad cultural.', monto_min: 10000, monto_max: 100000, moneda: 'USD', paises_elegibles: '["Colombia"]', sectores: '["Cultura","Arte","Patrimonio"]', url_convocatoria: 'https://www.unesco.org', url_fuente: 'https://www.unesco.org', fecha_limite: '2026-05-31', fecha_publicacion: '2026-02-01', requisitos: '["Organización cultural","Proyecto viable"]', estado: 'abierta', score_probabilidad: 65, created_at: '2026-02-01' },
  { id: 0, externo_id: 'PNUD-PPD-2026', titulo: 'Programa de Pequeñas Donaciones - Biodiversidad', donante: 'PNUD', fuente: 'PNUD', descripcion: 'Donaciones para proyectos comunitarios de conservación biodiversity.', monto_min: 1000, monto_max: 50000, moneda: 'USD', paises_elegibles: '["Colombia"]', sectores: '["Medio Ambiente","Biodiversidad","Comunidad"]', url_convocatoria: 'https://ppdcolombia.org', url_fuente: 'https://ppdcolombia.org', fecha_limite: '2026-05-20', fecha_publicacion: '2026-03-01', requisitos: '["Proyecto comunitario","Enfoque ambiental"]', estado: 'abierta', score_probabilidad: 75, created_at: '2026-03-01' },
];

const tipoLabels: Record<string, string> = {
  'subvencion': 'Subvención / Grant',
  'donacion': 'Donación',
  'beca': 'Beca / Scholarship',
  'financiamiento': 'Financiamiento',
};

function clasificarPorTipo(convocatoria: Convocatoria): string {
  const tituloDesc = `${convocatoria.titulo} ${convocatoria.descripcion} ${convocatoria.sectores}`.toLowerCase();
  const fuente = convocatoria.fuente.toLowerCase();
  
  if (fuente.includes('bec') || tituloDesc.includes('beca') || tituloDesc.includes('scholarship')) return 'beca';
  if (fuente.includes('pnud') || tituloDesc.includes('donaci') || tituloDesc.includes('donation') || tituloDesc.includes('pequeñas donaciones')) return 'donacion';
  if (tituloDesc.includes('grant') || fuente.includes('ue') || fuente.includes('european') || fuente.includes('unesco') || tituloDesc.includes('subvenci')) return 'subvencion';
  return 'financiamiento';
}

function formatMoney(amount: number, currency: string): string {
  if (amount === 0) return 'No especificado';
  const formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 });
  return formatter.format(amount);
}

function parseJsonSafe<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export default function ConvocatoriasView() {
  const [search, setSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState('todos');
  const [fuenteFilter, setFuenteFilter] = useState('todos');
  const [convocatoriasLocal, setConvocatoriasLocal] = useState<Convocatoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const wsRef = useCallback(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;

    const connect = () => {
      if (ws?.readyState === WebSocket.OPEN) return;

      console.log('[WS] Conectando a', WS_URL);
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[WS] ✓ Conectado');
        setWsConnected(true);
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log('[WS] Mensaje recibido:', msg);
          
          if (msg.event === 'NEW_FUND_DETECTED' && msg.data) {
            const nuevas = Array.isArray(msg.data) ? msg.data : [msg.data];
            setConvocatoriasLocal(prev => {
              const mapped = nuevas.map((n: any) => ({
                id: n.id || Date.now(),
                externo_id: n.externo_id || n.hash_unico || `WS-${Date.now()}`,
                titulo: n.titulo || 'Sin título',
                donante: n.donante || n.fuente || 'Desconocido',
                fuente: n.fuente || 'scraped',
                descripcion: n.descripcion || '',
                monto_min: n.monto_min || 0,
                monto_max: n.monto_max || n.monto || 0,
                moneda: n.moneda || 'USD',
                paises_elegibles: n.paises_elegibles || n.paises || '["Colombia"]',
                sectores: n.sectores || '[]',
                url_convocatoria: n.url_convocatoria || n.url || '',
                url_fuente: n.url_fuente || n.url || '',
                fecha_limite: n.fecha_limite || n.fecha_cierre || '',
                fecha_publicacion: n.scraped_en || '',
                requisitos: '[]',
                estado: n.estado || 'nueva',
                score_probabilidad: n.score_probabilidad || n.score || 70,
                created_at: n.timestamp || new Date().toISOString(),
              }));
              return [...mapped, ...prev];
            });
            setNewCount(prev => prev + nuevas.length);
            setTimeout(() => setNewCount(0), 3000);
          }
        } catch (e) {
          console.warn('[WS] Error parseando mensaje:', e);
        }
      };

      ws.onclose = () => {
        console.log('[WS] ✗ Desconectado');
        setWsConnected(false);
        
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 30000);
          console.log(`[WS] Reconectando en ${delay}ms (intento ${reconnectAttempts + 1})`);
          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++;
            connect();
          }, delay);
        }
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  useEffect(() => {
    const cleanupWs = wsRef();
    return cleanupWs;
  }, [wsRef]);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timeoutMs = 10_000;

    async function cargar() {
      setLoading(true);
      setError(null);
      try {
        const resp = await Promise.race([
          fetch(`${API_URL}/api/convocatorias?limit=300`, { signal: ctrl.signal }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout 10s — backend no responde')), timeoutMs)
          ),
        ]);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON from backend'); }
        const data: { data: Convocatoria[]; total?: number } = parsed;

        if (cancelled) return;
        setConvocatoriasLocal(data.data || []);
        console.info('[ConvocatoriasView][INFO]', {
          msg: 'Convocatorias cargadas desde backend',
          total: data.data?.length || 0,
          timestamp: new Date().toISOString(),
        });
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          console.error('[ConvocatoriasView][ERROR]', { msg: e.message, ts: new Date().toISOString() });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    cargar();
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  const convocatorias = useMemo(
    () => (convocatoriasLocal.length > 0 ? convocatoriasLocal : defaultConvocatorias),
    [convocatoriasLocal]
  );

  const filteredConvocatorias = useMemo(() => {
    const searchLower = search.toLowerCase();
    return convocatorias.filter(c => {
      const sectoresArr = parseJsonSafe<string[]>(c.sectores, []);
      const matchesSearch = c.titulo.toLowerCase().includes(searchLower) || 
                           c.donante.toLowerCase().includes(searchLower) ||
                           sectoresArr.some(s => s.toLowerCase().includes(searchLower));
      const tipo = clasificarPorTipo(c);
      const matchesTipo = tipoFilter === 'todos' || tipo === tipoFilter;
      const matchesFuente = fuenteFilter === 'todos' || c.fuente.toLowerCase() === fuenteFilter;
      return matchesSearch && matchesTipo && matchesFuente;
    });
  }, [convocatorias, search, tipoFilter, fuenteFilter]);

  const tiposUnicos = useMemo(() => {
    const tipos = new Set(convocatorias.map(c => clasificarPorTipo(c)));
    return ['todos', ...Array.from(tipos)];
  }, [convocatorias]);

  const fuentesUnicas = useMemo(() => {
    const fuentes = new Set(convocatorias.map(c => c.fuente));
    return ['todos', ...Array.from(fuentes).sort()];
  }, [convocatorias]);

  const stats = useMemo(() => ({
    total: filteredConvocatorias.length,
    abiertas: filteredConvocatorias.filter(c => c.estado === 'abierta' || c.estado === 'nueva').length,
    montoTotal: filteredConvocatorias.reduce((acc, c) => acc + (c.monto_max || 0), 0),
  }), [filteredConvocatorias]);

  return (
    <div className="convocatorias-view">
      <div className="convocatorias-view__header">
        <div>
          <h1 className="convocatorias-view__title">
            Convocatorias de Financiamiento
            {newCount > 0 && (
              <span className="new-badge">{newCount} nueva{newCount > 1 ? 's' : ''}</span>
            )}
          </h1>
          <p className="convocatorias-view__subtitle">
            Subvenciones, donaciones, becas y financiamiento disponible
          </p>
        </div>
        <div className="ws-status" title={wsConnected ? 'Conectado en tiempo real' : 'Reconectando...'}>
          {wsConnected ? <Wifi size={18} className="ws-connected" /> : <WifiOff size={18} className="ws-disconnected" />}
        </div>
      </div>

      <div className="convocatorias-view__stats">
        <div className="stat-card">
          <Award size={20} />
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-card stat-card--success">
          <Calendar size={20} />
          <span className="stat-value">{stats.abiertas}</span>
          <span className="stat-label">Abiertas</span>
        </div>
        <div className="stat-card stat-card--info">
          <DollarSign size={20} />
          <span className="stat-value">{formatMoney(stats.montoTotal, 'USD').split(',')[0]}</span>
          <span className="stat-label">Monto disponible</span>
        </div>
      </div>

      {loading && (
        <div className="convocatorias-view__state">
          <p className="convocatorias-view__loading">Cargando convocatorias desde el backend…</p>
        </div>
      )}
      {error && (
        <div className="convocatorias-view__state">
          <p className="convocatorias-view__error">
            No se pudo conectar con el backend: {error}
          </p>
          <p className="convocatorias-view__hint">
            Asegúrate de que el servidor esté activo ejecutando `node server.js`
          </p>
        </div>
      )}

      <div className="convocatorias-view__filters">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar por título, donante o sector..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-group">
          <Filter size={16} />
          <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)} className="filter-select">
            {tiposUnicos.map(t => (
              <option key={t} value={t}>{t === 'todos' ? 'Todos los tipos' : tipoLabels[t] || t}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <Globe size={16} />
          <select value={fuenteFilter} onChange={(e) => setFuenteFilter(e.target.value)} className="filter-select">
            {fuentesUnicas.map(f => (
              <option key={f} value={f}>{f === 'todos' ? 'Todas las fuentes' : f}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="convocatorias-view__grid">
        {filteredConvocatorias.map((c, idx) => {
          const tipo = clasificarPorTipo(c);
          const sectoresArr = parseJsonSafe<string[]>(c.sectores, []);
          const paisesArr = parseJsonSafe<string[]>(c.paises_elegibles, []);
          const isNew = idx === 0 && newCount > 0;
          
          return (
            <div key={c.externo_id || c.id} className={`convocatoria-card ${isNew ? 'convocatoria-card--new' : ''}`}>
              <div className="convocatoria-card__header">
                <span className={`convocatoria-card__tipo tipo-${tipo}`}>
                  {tipoLabels[tipo]}
                </span>
                <span className={`convocatoria-card__estado estado-${c.estado}`}>
                  {c.estado}
                </span>
              </div>

              <h3 className="convocatoria-card__title">{c.titulo}</h3>
              
              <div className="convocatoria-card__donante">
                <strong>Donante:</strong> {c.donante}
              </div>

              <p className="convocatoria-card__desc">{c.descripcion}</p>

              <div className="convocatoria-card__details">
                <div className="detail-item">
                  <DollarSign size={14} />
                  <span>{formatMoney(c.monto_min, c.moneda)} - {formatMoney(c.monto_max, c.moneda)}</span>
                </div>
                <div className="detail-item">
                  <Calendar size={14} />
                  <span>Fecha límite: {c.fecha_limite || 'No especificada'}</span>
                </div>
                <div className="detail-item">
                  <Globe size={14} />
                  <span>{paisesArr.join(', ') || 'Colombia'}</span>
                </div>
              </div>

              <div className="convocatoria-card__sectores">
                {sectoresArr.map((s: string) => (
                  <span key={s} className="sector-tag">{s}</span>
                ))}
              </div>

              <a
                href={c.url_convocatoria || c.url_fuente || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="convocatoria-card__link"
              >
                Ver convocatoria <ExternalLink size={14} />
              </a>
            </div>
          );
        })}
      </div>

      {filteredConvocatorias.length === 0 && (
        <div className="convocatorias-view__empty">
          <Award size={48} />
          <p>No se encontraron convocatorias con los filtros aplicados</p>
        </div>
      )}
    </div>
  );
}