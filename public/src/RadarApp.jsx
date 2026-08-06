import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Bot, Database, Sparkles, Loader } from 'lucide-react';
import MiniMaxChat from './MiniMaxChat';
import KPICards  from './modules/radar/KPICards';
import FilterBar from './modules/radar/FilterBar';
import DataTable from './modules/radar/DataTable';
import { getIdToken } from './lib/firebase';

// Detecta protocolo (wss en HTTPS, ws en HTTP) y usa el mismo host que el frontend.
// En dev, Vite proxia /api → localhost:5000, pero WS no se proxia → apunta directo a Express.
const _proto  = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const _host   = typeof window !== 'undefined' ? window.location.host : 'localhost:5000';
const WS_URL  = import.meta.env.VITE_WS_URL  || `${_proto}//${_host}/ws/live_radar`;
const API_URL = import.meta.env.VITE_CONV_URL || '/api/convocatorias';
const RETRY_MS = 4000;
const FLASH_DURATION = 2100;

export default function RadarApp() {
  const [tab,        setTab]       = useState('radar');
  const [data,       setData]      = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [status,     setStatus]    = useState('Conectando...');
  const [query,      setQuery]     = useState('');
  const [sector,     setSector]    = useState('');
  const [flashIds,   setFlashIds]  = useState(new Set());
  const [newItemIds, setNewItemIds]= useState(new Set());
  const [aiQuery,    setAiQuery]   = useState('');
  const [aiLoading,  setAiLoading] = useState(false);
  const [aiError,    setAiError]   = useState(null);
  const ws = useRef(null);

  /* ── Flash helpers ── */
  const addFlash = useCallback((id, isNew = false) => {
    if (isNew) {
      setNewItemIds(prev => new Set([...prev, id]));
      setTimeout(() => setNewItemIds(prev => { const s = new Set(prev); s.delete(id); return s; }), FLASH_DURATION);
    } else {
      setFlashIds(prev => new Set([...prev, id]));
      setTimeout(() => setFlashIds(prev => { const s = new Set(prev); s.delete(id); return s; }), FLASH_DURATION);
    }
  }, []);

  /* ── Data mutator ── */
  const upsertRow = useCallback((item, isNew = false) => {
    setData(prev => {
      const idx = prev.findIndex(d => d.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [item, ...prev];
    });
    addFlash(item.id, isNew);
  }, [addFlash]);

  /* ── REST initial fetch (fallback) ── */
  const fetchData = async () => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error();
      setData(await res.json());
      setLoading(false);
      if (status !== 'Live & Online') setStatus('REST – Sin WS');
    } catch {
      setLoading(false);
      setStatus('Sin conexión al servidor');
    }
  };

  /* ── WebSocket ── */
  const connectWS = useCallback(() => {
    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen    = () => setStatus('Live & Online');

    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      if (msg.event === 'INITIAL_DATA') {
        setData(msg.data);
        setLoading(false);
        setStatus('Live & Online');
        return;
      }
      if (msg.event === 'NEW_FUND_DETECTED') {
        upsertRow(msg.data, true);
        return;
      }
      if (msg.event === 'STATUS_UPDATE') {
        upsertRow(msg.data, false);
      }
    };

    socket.onclose = () => {
      setStatus('Reconectando...');
      setTimeout(connectWS, RETRY_MS);
    };
    socket.onerror = () => socket.close();
  }, [upsertRow]);

  useEffect(() => {
    fetchData();
    connectWS();
    return () => ws.current?.close();
  }, []);

  /* ── Búsqueda IA on-demand — costo real por click, nunca automática (ver
     docs/RADFOR360_ARQUITECTURA_OPTIMIZACION.md §2: opción preferida bajo
     criterio de economía sobre push automático) ── */
  const runAiSearch = useCallback(async () => {
    if (!aiQuery.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/radar/search', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query: aiQuery.trim(), filters: sector ? { sector } : {} }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Cuota diaria de búsquedas agotada.');
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error ${res.status} en la búsqueda`);
      }
      const result = await res.json();
      const oportunidades = result.oportunidades || [];
      oportunidades.forEach((op, i) => {
        upsertRow({
          id:          `ia-${result.meta?.cacheKey ?? Date.now()}-${i}`,
          entidad:     op.entidad     ?? 'Por confirmar',
          objeto:      op.titulo      ?? 'Sin título',
          monto:       op.monto       ?? 'Por confirmar',
          sector:      op.sector      ?? 'Sin clasificar',
          region:      op.cobertura   ?? 'Nacional',
          status:      'Abierta',
          fechaCierre: op.fechaCierre ?? 'Por confirmar',
          _fuenteIA:   true,
          _fromCache:  !!result.fromCache,
        }, true);
      });
      setStatus(`IA: ${oportunidades.length} resultado(s)${result.fromCache ? ' (cache)' : ''}`);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }, [aiQuery, aiLoading, sector, upsertRow]);

  /* ── Client-side filter ── */
  const filtered = useMemo(() => {
    let rows = data;
    if (query)  rows = rows.filter(d =>
      [d.id, d.entidad, d.objeto, d.region, d.sector].some(f =>
        f?.toLowerCase().includes(query.toLowerCase())
      )
    );
    if (sector) rows = rows.filter(d =>
      d.sector?.toLowerCase().includes(sector.toLowerCase())
    );
    return rows;
  }, [data, query, sector]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0b1326', color: '#dae2fd', fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>

      {/* ── KPI Cards ── */}
      <KPICards data={data} status={status} loading={loading} />

      {/* ── Tab Navigation ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #3e484f', background: '#131b2e', marginTop: 16 }}>
        {[
          { id: 'radar',   label: 'Radar Fondos 360',  Icon: Database, color: '#3b82f6' },
          { id: 'minimax', label: 'MiniMax M2.5 AI',   Icon: Bot,      color: '#a855f7' },
        ].map(({ id, label, Icon, color }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '11px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${active ? color : 'transparent'}`,
              color: active ? color : '#6b7280',
              transition: 'color 0.15s, border-color 0.15s',
            }}>
              <Icon size={16} />
              {label}
              {id === 'radar' && data.length > 0 && (
                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: active ? `${color}25` : 'rgba(100,116,139,0.2)', color: active ? color : '#6b7280', fontWeight: 700 }}>
                  {data.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Radar Tab ── */}
      {tab === 'radar' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 20px', background: '#131b2e', borderBottom: '1px solid #3e484f' }}>
            <Sparkles size={15} style={{ color: '#a855f7', flexShrink: 0 }} />
            <input
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runAiSearch()}
              placeholder="Buscar con IA en tiempo real (Claude + Tavily) — ej. 'vivienda rural Boyacá'"
              style={{ flex: 1, background: '#0b1326', border: '1px solid #3e484f', borderRadius: 6, padding: '7px 12px', fontSize: 12.5, color: '#dae2fd', outline: 'none' }}
            />
            <button
              onClick={runAiSearch}
              disabled={aiLoading || !aiQuery.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 6, border: 'none',
                background: aiLoading || !aiQuery.trim() ? '#374151' : '#a855f7', color: '#fff',
                fontSize: 12.5, fontWeight: 600, cursor: aiLoading || !aiQuery.trim() ? 'default' : 'pointer',
              }}
            >
              {aiLoading ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {aiLoading ? 'Buscando…' : 'Buscar con IA'}
            </button>
          </div>
          {aiError && (
            <div style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 12.5, borderBottom: '1px solid #3e484f' }}>
              {aiError}
            </div>
          )}
          <FilterBar
            query={query}
            sector={sector}
            onQuery={setQuery}
            onSector={setSector}
            onClear={() => { setQuery(''); setSector(''); }}
          />
          <DataTable
            data={filtered}
            loading={loading}
            flashIds={flashIds}
            newItemIds={newItemIds}
          />
        </div>
      )}

      {/* ── MiniMax Tab ── */}
      {tab === 'minimax' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <MiniMaxChat />
        </div>
      )}
    </div>
  );
}
