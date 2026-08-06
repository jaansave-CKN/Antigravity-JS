/**
 * ConfigProponente — Módulo 5: datos del proponente/entidad y equipo directivo.
 * Consume GET/POST /api/m5/logistica/:proyectoId (backend/routes/configLogistica.routes.js),
 * huérfano hasta 2026-08-06 (auditoría Grupo Elite, Operación Sinaosis Fase 3) — dominio
 * distinto de logistica-tramos (que sí tenía consumidor): datos de proponente/NIT/equipo,
 * no rutas de transporte.
 */
import { useState, useEffect, useCallback } from 'react';
import { http, ApiError } from '../lib/apiClient';

interface ConfigLogistica {
  proponente_nombre: string; proponente_nit: string; tipo_entidad: string;
  departamento: string; municipio: string; zona: 'Urbana' | 'Rural' | 'Mixta';
  fecha_inicio: string; duracion_meses: number;
  equipo_director: string; equipo_coordinador: string;
}
interface ConfigResponse { success: boolean; data: (ConfigLogistica & { id?: string }) | null }

const VACIO: ConfigLogistica = {
  proponente_nombre: '', proponente_nit: '', tipo_entidad: '',
  departamento: '', municipio: '', zona: 'Urbana',
  fecha_inicio: '', duracion_meses: 0,
  equipo_director: '', equipo_coordinador: '',
};

const campo: React.CSSProperties = { fontSize: 13, padding: '8px 10px', border: '1px solid #c4c5d7', borderRadius: 6, fontFamily: "'Public Sans', sans-serif", width: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#434655', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' };

export default function ConfigProponente({ proyectoId }: { proyectoId: string | null }) {
  const [config, setConfig] = useState<ConfigLogistica>(VACIO);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!proyectoId) return;
    setCargando(true);
    setError(null);
    try {
      const res = await http.get<ConfigResponse>(`/api/m5/logistica/${proyectoId}`);
      if (res.data) setConfig({ ...VACIO, ...res.data });
      else setConfig(VACIO);
    } catch (e) {
      setError(e instanceof ApiError ? `No se pudo cargar la configuración (${e.status})` : 'No se pudo cargar la configuración del proponente.');
    } finally {
      setCargando(false);
    }
  }, [proyectoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    if (!proyectoId) return;
    setGuardando(true);
    setError(null);
    try {
      await http.post(`/api/m5/logistica/${proyectoId}`, config);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2200);
    } catch (e) {
      setError(e instanceof ApiError ? `No se pudo guardar (${e.status})` : 'No se pudo guardar la configuración.');
    } finally {
      setGuardando(false);
    }
  };

  const set = <K extends keyof ConfigLogistica>(k: K, v: ConfigLogistica[K]) => setConfig(c => ({ ...c, [k]: v }));

  if (!proyectoId) return null;

  return (
    <section style={{ background: '#fff', border: '1px solid #e0e3e5', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#191c1e' }}>
          Proponente y Equipo {cargando && <span style={{ fontWeight: 400, color: '#76777d', fontSize: 12 }}> — cargando…</span>}
        </h3>
        <button
          onClick={guardar}
          disabled={guardando}
          style={{ fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 8, border: 'none', cursor: guardando ? 'not-allowed' : 'pointer', background: guardado ? '#2e7d32' : '#0037b0', color: '#fff', opacity: guardando ? 0.6 : 1 }}
        >
          {guardando ? 'Guardando…' : guardado ? '✓ Guardado' : 'Guardar'}
        </button>
      </div>

      {error && <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#ba1a1a', marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div><label style={label}>Nombre del proponente</label><input style={campo} value={config.proponente_nombre} onChange={e => set('proponente_nombre', e.target.value)} placeholder="Alcaldía / ONG / entidad" /></div>
        <div><label style={label}>NIT</label><input style={campo} value={config.proponente_nit} onChange={e => set('proponente_nit', e.target.value)} placeholder="900.000.000-0" /></div>
        <div><label style={label}>Tipo de entidad</label><input style={campo} value={config.tipo_entidad} onChange={e => set('tipo_entidad', e.target.value)} placeholder="Pública / Privada / ONG" /></div>
        <div><label style={label}>Departamento</label><input style={campo} value={config.departamento} onChange={e => set('departamento', e.target.value)} /></div>
        <div><label style={label}>Municipio</label><input style={campo} value={config.municipio} onChange={e => set('municipio', e.target.value)} /></div>
        <div>
          <label style={label}>Zona</label>
          <select style={campo} value={config.zona} onChange={e => set('zona', e.target.value as ConfigLogistica['zona'])}>
            <option>Urbana</option><option>Rural</option><option>Mixta</option>
          </select>
        </div>
        <div><label style={label}>Fecha de inicio</label><input style={campo} type="date" value={config.fecha_inicio} onChange={e => set('fecha_inicio', e.target.value)} /></div>
        <div><label style={label}>Duración (meses)</label><input style={campo} type="number" value={config.duracion_meses} onChange={e => set('duracion_meses', parseInt(e.target.value) || 0)} /></div>
        <div><label style={label}>Director del proyecto</label><input style={campo} value={config.equipo_director} onChange={e => set('equipo_director', e.target.value)} /></div>
        <div><label style={label}>Coordinador</label><input style={campo} value={config.equipo_coordinador} onChange={e => set('equipo_coordinador', e.target.value)} /></div>
      </div>
    </section>
  );
}
