import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Filter, Wifi, WifiOff, TrendingUp, DollarSign, Calendar, Building2, ArrowUp, AlertCircle } from 'lucide-react';

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

function parseJson<T>(str: string, fallback: T): T {
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function formatMoney(amount: number, currency: string): string {
  if (!amount) return 'No especificado';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function getBadgeColor(estado: string): string {
  const colors: Record<string, string> = {
    nueva: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
   abierta: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    pendiente: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    cerrada: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    migrado: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };
  return colors[estado?.toLowerCase()] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
}

export default function Dashboard() {
  const [convocatorias, setConvocatorias] = useState<Convocatoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroFuente, setFiltroFuente] = useState('todos');

  const connectWebSocket = useCallback(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const maxAttempts = 10;

    const connect = () => {
      if (ws?.readyState === WebSocket.OPEN) return;
      
      ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        setWsConnected(true);
        reconnectAttempts = 0;
      };
      
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'NEW_FUND_DETECTED' && msg.data) {
            const nuevas = Array.isArray(msg.data) ? msg.data : [msg.data];
            setConvocatorias(prev => {
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
                paises_elegibles: n.paises_elegibles || '["Colombia"]',
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
            setTimeout(() => setNewCount(0), 4000);
          }
        } catch {}
      };
      
      ws.onclose = () => {
        setWsConnected(false);
        if (reconnectAttempts < maxAttempts) {
          const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectTimeout = setTimeout(() => { reconnectAttempts++; connect(); }, delay);
        }
      };
      
      ws.onerror = () => {};
    };

    connect();
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  useEffect(() => { return connectWebSocket(); }, [connectWebSocket]);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    
    async function cargar() {
      setLoading(true);
      setError(null);
      try {
        const resp = await Promise.race([
          fetch(`${API_URL}/api/convocatorias?limit=500`, { signal: ctrl.signal }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
        ]);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON from backend'); }
        const data: { data: Convocatoria[] } = parsed;
        if (!cancelled) setConvocatorias(data.data || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    cargar();
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  const convocatoriasFiltradas = useMemo(() => {
    const searchLower = search.toLowerCase();
    return convocatorias.filter(c => {
      const sectoresArr = parseJson<string[]>(c.sectores, []);
      const matchesSearch = c.titulo.toLowerCase().includes(searchLower) || 
                           c.donante.toLowerCase().includes(searchLower) ||
                           sectoresArr.some(s => s.toLowerCase().includes(searchLower));
      const matchesTipo = filtroTipo === 'todos' || c.estado?.toLowerCase() === filtroTipo;
      const matchesFuente = filtroFuente === 'todos' || c.fuente.toLowerCase() === filtroFuente;
      return matchesSearch && matchesTipo && matchesFuente;
    });
  }, [convocatorias, search, filtroTipo, filtroFuente]);

  const stats = useMemo(() => ({
    total: convocatoriasFiltradas.length,
    montoTotal: convocatoriasFiltradas.reduce((acc, c) => acc + (c.monto_max || 0), 0),
    promedio:convocatoriasFiltradas.length > 0 ? convocatoriasFiltradas.reduce((acc, c) => acc + (c.monto_max || 0), 0) / convocatoriasFiltradas.length : 0
  }), [convocatoriasFiltradas]);

  const fuentesUnicas = useMemo(() => ['todos', ...new Set(convocatorias.map(c => c.fuente))].sort(), [convocatorias]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Radar Fondos 360
            </h1>
            <p className="text-slate-400 mt-1">Monitoreo de Convocatorias Internacionales</p>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${wsConnected ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
            {wsConnected ? <Wifi size={18} className="text-emerald-400" /> : <WifiOff size={18} className="text-red-400" />}
            <span className={`text-sm font-medium ${wsConnected ? 'text-emerald-400' : 'text-red-400'}`}>
              {wsConnected ? 'Tiempo Real' : 'Reconectando...'}
            </span>
          </div>
        </header>

        {newCount > 0 && (
          <div className="mb-4 px-4 py-3 bg-emerald-500/20 border border-emerald-500/30 rounded-lg flex items-center gap-3 animate-pulse">
            <ArrowUp className="text-emerald-400" size={20} />
            <span className="text-emerald-300 font-medium">{newCount} nueva{newCount > 1 ? 's' : ''} convocatoria{newCount > 1 ? 's' : ''} detectada{newCount > 1 ? 's' : ''}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/20 rounded-lg"><TrendingUp size={20} className="text-blue-400" /></div>
              <span className="text-slate-400 text-sm">Total Convocatorias</span>
            </div>
            <p className="text-3xl font-bold text-white">{stats.total}</p>
          </div>
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-500/20 rounded-lg"><DollarSign size={20} className="text-emerald-400" /></div>
              <span className="text-slate-400 text-sm">Monto Disponible</span>
            </div>
            <p className="text-2xl font-bold text-white">${Math.round(stats.montoTotal / 1000000)}M</p>
          </div>
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-500/20 rounded-lg"><Calendar size={20} className="text-purple-400" /></div>
              <span className="text-slate-400 text-sm">Promedio</span>
            </div>
            <p className="text-2xl font-bold text-white">${Math.round(stats.promedio / 1000)}K</p>
          </div>
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-cyan-500/20 rounded-lg"><Building2 size={20} className="text-cyan-400" /></div>
              <span className="text-slate-400 text-sm">Fuentes</span>
            </div>
            <p className="text-3xl font-bold text-white">{fuentesUnicas.length - 1}</p>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Buscar por título, donante o sector..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
              />
            </div>
            <div className="flex gap-3">
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                className="px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-500/50"
              >
                <option value="todos">Todos los estados</option>
                <option value="nueva">Nueva</option>
                <option value="abierta">Abierta</option>
                <option value="pendiente">Pendiente</option>
                <option value="cerrada">Cerrada</option>
              </select>
              <select
                value={filtroFuente}
                onChange={(e) => setFiltroFuente(e.target.value)}
                className="px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-500/50"
              >
                {fuentesUnicas.map(f => (
                  <option key={f} value={f}>{f === 'todos' ? 'Todas las fuentes' : f}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-4 text-slate-400">Cargando convocatorias...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center">
              <AlertCircle className="mx-auto text-red-400 mb-4" size={48} />
              <p className="text-red-400">{error}</p>
               <p className="text-slate-500 mt-2 text-sm">Verifica que el backend esté activo en el puerto configurado (VITE_API_URL)</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-900/50 border-b border-slate-700/50">
                  <tr>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Título</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Monto</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Sector</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Entidad</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Fecha Límite</th>
                    <th className="px-4 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {convocatoriasFiltradas.map((c, idx) => {
                    const sectoresArr = parseJson<string[]>(c.sectores, []);
                    const isNew = idx === 0 && newCount > 0;
                    return (
                      <tr key={c.externo_id || c.id} className={`hover:bg-slate-700/20 transition-all ${isNew ? 'bg-emerald-500/5 animate-highlight' : ''}`}>
                        <td className="px-4 py-4">
                          <div className="max-w-xs">
                            <p className="text-sm font-medium text-slate-100 truncate">{c.titulo}</p>
                            <p className="text-xs text-slate-500 truncate mt-1">{c.descripcion}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-sm font-semibold text-emerald-400">{formatMoney(c.monto_max, c.moneda)}</span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1">
                            {sectoresArr.slice(0, 2).map((s: string) => (
                              <span key={s} className="px-2 py-1 text-xs bg-slate-700/50 text-slate-300 rounded-full">{s}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-sm text-slate-300">{c.donante}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-sm text-slate-400">{c.fecha_limite || 'N/A'}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getBadgeColor(c.estado)}`}>
                            {c.estado}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {convocatoriasFiltradas.length === 0 && (
                <div className="p-12 text-center text-slate-400">
                  No se encontraron convocatorias con los filtros aplicados
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="mt-8 text-center text-slate-500 text-sm">
          <p>Radar Fondos 360 © 2026 • {convocatorias.length} registros en base de datos</p>
        </footer>
      </div>
      
      <style>{`
        @keyframes highlight {
          0% { background: rgba(34, 197, 94, 0.15); }
          100% { background: transparent; }
        }
        .animate-highlight { animation: highlight 2s ease-out; }
      `}</style>
    </div>
  );
}