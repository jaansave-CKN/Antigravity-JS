/**
 * LogisticaPage — Calco estricto Stitch screen
 * "Información Logística - Escritorio (Sidebar Eliminado)"
 * Fuente: projects/3791086755596777919/screens/17fe54a294f94000a1a3b27db935bbb8
 *
 * Tokens fuente:
 *   bg/surface #f7f9fb · primary #0037b0 · on-primary #ffffff
 *   primary-container #1d4ed8 · secondary #455b9d · success #2e7d32
 *   error #ba1a1a · outline-variant #c4c5d7 · on-surface #191c1e
 *   on-surface-variant #434655 · surface-container #eceef0
 *   surface-container-low #f2f4f6 · font Public Sans
 *   glass-card: rgba(255,255,255,0.7) blur(10px) border rgba(255,255,255,0.3)
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import './LogisticaPage.css';
import { http } from '../lib/apiClient';

const STORAGE_KEY = 'radar360_logistica_tramos';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

interface TramoApi {
  id: string; numero: number; origen: string; destino: string; duracion: string;
  distancia_km: number; medio: string; estado_via: string; calidad: string;
  tipo_transporte: string; orden_publico: string; seleccionado: number;
}
interface TramosApiResponse { success: boolean; data?: TramoApi[]; message?: string }

type EstadoVia = 'Pavimentada' | 'Montaña' | 'Destapada' | 'Mixta';
type CalidadVia = 'Óptimo' | 'Regular' | 'Crítico';

interface Tramo {
  id: string;
  numero: string;
  origen: string;
  destino: string;
  duracion: string;
  distancia_km: number;
  medio: string;
  estado_via: EstadoVia;
  calidad: CalidadVia;
  tipo_transporte: string;
  orden_publico: string;
  seleccionado: boolean;
}

const TRAMOS_INICIALES: Tramo[] = [
  { id: 't1', numero: '01', origen: 'Cali', destino: 'Buenaventura', duracion: '03h 15m', distancia_km: 121.5, medio: 'Camión Turbo', estado_via: 'Pavimentada', calidad: 'Óptimo', tipo_transporte: 'Carga Pesada', orden_publico: 'No', seleccionado: false },
  { id: 't2', numero: '02', origen: 'Buenaventura', destino: 'Villavicencio', duracion: '05h 30m', distancia_km: 95.0, medio: 'Doble Troque', estado_via: 'Montaña', calidad: 'Regular', tipo_transporte: 'Granel Líquido', orden_publico: 'No', seleccionado: false },
];

const CALIDAD_COLOR: Record<CalidadVia, string> = {
  'Óptimo': '#2e7d32',
  'Regular': '#f59e0b',
  'Crítico': '#ba1a1a',
};

// Proxy real de eficiencia de ruta a partir de la calidad de vía de cada
// tramo — no existe una métrica de "eficiencia" medida en el modelo de datos,
// así que se deriva de un dato que sí es real (calidad) en vez de un literal.
const CALIDAD_EFICIENCIA: Record<CalidadVia, number> = {
  'Óptimo': 100,
  'Regular': 65,
  'Crítico': 30,
};

export default function LogisticaPage() {
  const NUEVO_VACIO = { origen: '', destino: '', duracion: '', distancia: '', medio: 'Camión Turbo', estado_via: 'Pavimentada' as EstadoVia, calidad: 'Óptimo' as CalidadVia, tipo_transporte: 'Carga Pesada', orden_publico: 'No' };

  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);

  const [tramos, setTramos] = useState<Tramo[]>(() => {
    if (proyectoId) return []; // se hidrata desde el servidor abajo
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) { const p = JSON.parse(s); return p.tramos ?? TRAMOS_INICIALES; }
    } catch { /* ignore */ }
    return TRAMOS_INICIALES;
  });
  const [observaciones, setObservaciones] = useState<string>(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) { const p = JSON.parse(s); return p.observaciones ?? ''; }
    } catch { /* ignore */ }
    return '';
  });
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(NUEVO_VACIO);
  const [cargando, setCargando] = useState(!!proyectoId);
  const [guardando, setGuardando] = useState(false);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  const hidratado = useRef(false);

  // Hidrata desde el backend real (fuente de verdad) si hay un proyecto activo.
  useEffect(() => {
    if (!proyectoId) return;
    let cancelled = false;
    (async () => {
      try {
        const body = await http.get<TramosApiResponse>(`/api/proyectos/${proyectoId}/logistica-tramos`);
        if (cancelled) return;
        if (body.data && body.data.length > 0) {
          setTramos(body.data.map(t => ({
            id: t.id, numero: String(t.numero).padStart(2, '0'), origen: t.origen, destino: t.destino,
            duracion: t.duracion, distancia_km: Number(t.distancia_km), medio: t.medio,
            estado_via: t.estado_via as EstadoVia, calidad: t.calidad as CalidadVia,
            tipo_transporte: t.tipo_transporte, orden_publico: t.orden_publico, seleccionado: false,
          })));
        }
      } catch {
        setErrorSync('No se pudo cargar la logística guardada — se muestran los últimos datos locales.');
      } finally {
        if (!cancelled) { setCargando(false); hidratado.current = true; }
      }
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  // Cache local instantánea (sigue funcionando sin conexión / sin proyecto activo).
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tramos, observaciones }));
  }, [tramos, observaciones]);

  // Sincronización real al backend — extraída para reusarse tanto en el
  // debounce automático como en el botón SAVE manual.
  const sincronizar = useCallback(async () => {
    if (!proyectoId) return;
    setGuardando(true);
    setErrorSync(null);
    try {
      await http.post(`/api/proyectos/${proyectoId}/logistica-tramos`, { tramos });
    } catch {
      setErrorSync('No se pudo sincronizar la logística con el servidor.');
    } finally {
      setGuardando(false);
    }
  }, [proyectoId, tramos]);

  // Sincronización automática al backend (debounced) — reemplaza el array completo.
  useEffect(() => {
    if (!proyectoId || cargando) return; // no sincronizar antes de hidratar (evita sobreescribir con [])
    const t = setTimeout(sincronizar, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tramos, proyectoId, cargando]);

  const [guardado, setGuardado] = useState(false);
  const [limpiado, setLimpiado] = useState(false);

  const guardar = async () => {
    await sincronizar();
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2200);
  };

  const limpiar = () => {
    localStorage.removeItem(STORAGE_KEY);
    setTramos([]);
    setObservaciones('');
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  const kmsTotales = tramos.reduce((s, t) => s + t.distancia_km, 0);
  const alertasOrdenPublico = tramos.filter(t => t.orden_publico === 'Sí').length;
  const eficienciaMedia = tramos.length > 0
    ? Math.round(tramos.reduce((s, t) => s + (CALIDAD_EFICIENCIA[t.calidad] ?? 0), 0) / tramos.length)
    : 0;
  const todosSel = tramos.length > 0 && tramos.every(t => t.seleccionado);
  const haySel = tramos.some(t => t.seleccionado);
  const seleccionados = tramos.filter(t => t.seleccionado);

  const toggleTodos = () => setTramos(ts => ts.map(t => ({ ...t, seleccionado: !todosSel })));
  const toggleUno = (id: string) => setTramos(ts => ts.map(t => t.id === id ? { ...t, seleccionado: !t.seleccionado } : t));

  const eliminarSeleccionados = () => {
    if (!haySel) return;
    setTramos(ts => ts.filter(t => !t.seleccionado).map((t, i) => ({ ...t, numero: String(i + 1).padStart(2, '0') })));
  };

  const abrirEdicion = () => {
    if (seleccionados.length !== 1) return;
    const t = seleccionados[0];
    setEditandoId(t.id);
    setNuevo({ origen: t.origen, destino: t.destino, duracion: t.duracion === '—' ? '' : t.duracion, distancia: String(t.distancia_km), medio: t.medio, estado_via: t.estado_via, calidad: t.calidad, tipo_transporte: t.tipo_transporte, orden_publico: t.orden_publico });
    setModalAbierto(true);
  };

  const cerrarModal = () => { setModalAbierto(false); setEditandoId(null); setNuevo(NUEVO_VACIO); };

  const guardarTramo = useCallback(() => {
    if (!nuevo.origen.trim() || !nuevo.destino.trim() || !nuevo.distancia) return;
    if (editandoId) {
      setTramos(ts => ts.map(t => t.id === editandoId ? { ...t, origen: nuevo.origen.trim(), destino: nuevo.destino.trim(), duracion: nuevo.duracion.trim() || '—', distancia_km: parseFloat(nuevo.distancia) || 0, medio: nuevo.medio, estado_via: nuevo.estado_via, calidad: nuevo.calidad, tipo_transporte: nuevo.tipo_transporte, orden_publico: nuevo.orden_publico, seleccionado: false } : t));
    } else {
      const t: Tramo = { id: `t${Date.now()}`, numero: String(tramos.length + 1).padStart(2, '0'), origen: nuevo.origen.trim(), destino: nuevo.destino.trim(), duracion: nuevo.duracion.trim() || '—', distancia_km: parseFloat(nuevo.distancia) || 0, medio: nuevo.medio, estado_via: nuevo.estado_via, calidad: nuevo.calidad, tipo_transporte: nuevo.tipo_transporte, orden_publico: nuevo.orden_publico, seleccionado: false };
      setTramos(ts => [...ts, t]);
    }
    cerrarModal();
  }, [nuevo, tramos.length, editandoId]);

  const exportarReporte = () => {
    const payload = {
      modulo: 'logistica',
      generado: new Date().toISOString(),
      kpis: { tramos_activos: tramos.length, kms_totales: kmsTotales, alertas_orden_publico: alertasOrdenPublico, eficiencia_media: `${eficienciaMedia}%` },
      tramos: tramos.map(({ seleccionado: _s, ...t }) => t),
      observaciones,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `logistica_reporte_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className="logx">
      {/* Header */}
      <header className="logx__header">
        <div>
          <h2 className="logx__title">LOGÍSTICA</h2>
          <nav className="logx__breadcrumb">
            <span>Logística</span>
            <span className="logx__bc-sep">/</span>
            <span className="logx__bc-active">Tramos y Recorridos</span>
          </nav>
        </div>
        <div className="logx__topbar-right">
          {(cargando || guardando || errorSync) && (
            <span style={{ fontSize: 12, color: errorSync ? '#ba1a1a' : '#434655', fontWeight: 600 }}>
              {errorSync ? errorSync : cargando ? 'Cargando tramos…' : 'Guardando…'}
            </span>
          )}
          <button
            className={`logx__clear${limpiado ? ' logx__clear--done' : ''}`}
            onClick={limpiar}
          >
            {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
          </button>
          <button
            className={`logx__save${guardado ? ' logx__save--saved' : ''}`}
            onClick={guardar}
          >
            {guardado ? '✓ GUARDADO' : 'SAVE'}
          </button>
        </div>
      </header>

      <div className="logx__content">
      {/* Summary Cards (Bento) — layout horizontal compacto */}
      <section className="logx__bento">
        {/* Tramos Activos */}
        <div className="logx__card logx__card--primary-border">
          <span className="logx__card-title">Tramos Activos</span>
          <div className="logx__card-mid">
            <span className="logx__card-icon logx__card-icon--primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H12"/></svg>
            </span>
            <p className="logx__card-value">{tramos.length}</p>
            <span className="logx__badge-success">+{Math.max(tramos.length - 2, 0) || 2} hoy</span>
          </div>
          <span className="logx__card-sub">Tramos activos del período</span>
        </div>

        {/* Kms Totales */}
        <div className="logx__card">
          <span className="logx__card-title">Kms Totales</span>
          <div className="logx__card-mid">
            <span className="logx__card-icon logx__card-icon--primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </span>
            <p className="logx__card-value">
              {kmsTotales.toLocaleString('es-CO', { minimumFractionDigits: 1 })}
              <span className="logx__card-unit">km</span>
            </p>
          </div>
          <span className="logx__card-sub">Acumulado semanal</span>
        </div>

        {/* Alertas Orden Público */}
        <div className="logx__card logx__card--error-border">
          <span className="logx__card-title">Alertas Orden Público</span>
          <div className="logx__card-mid">
            <span className="logx__card-icon logx__card-icon--error">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </span>
            <p className="logx__card-value" style={{ color: '#ba1a1a' }}>
              {tramos.filter(t => t.orden_publico === 'Sí').length.toString().padStart(2, '0')}
            </p>
            <span className="logx__pulse" style={{ marginLeft: 'auto' }} />
          </div>
          <span className="logx__card-sub">Zonas con restricción activa</span>
        </div>

        {/* Eficiencia Media */}
        <div className="logx__card logx__card--gradient">
          <span className="logx__card-title logx__card-title--inv">Eficiencia Media</span>
          <div className="logx__card-mid">
            <span className="logx__card-icon--speed">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>
            </span>
            <p className="logx__card-value logx__card-value--inv">{eficienciaMedia}%</p>
          </div>
          <span className="logx__card-sub logx__card-sub--inv">Promedio de rutas completadas</span>
        </div>
      </section>

      {/* Main Logistics Table */}
      <section className="logx__table-wrap">
        <div className="logx__table-scroll">
          <table className="logx__table">
            <thead>
              <tr>
                <th className="logx__th logx__th--check">
                  <input type="checkbox" checked={todosSel} onChange={toggleTodos} className="logx__checkbox" />
                </th>
                <th className="logx__th">Tramo</th>
                <th className="logx__th">Recorrido</th>
                <th className="logx__th">DURACION</th>
                <th className="logx__th logx__th--center">Distancia (KM)</th>
                <th className="logx__th">Medio Transp.</th>
                <th className="logx__th">Estado / Tipo Vía</th>
                <th className="logx__th">Tipo Transp.</th>
                <th className="logx__th logx__th--center">ORDEN PUBLICO</th>
              </tr>
            </thead>
            <tbody>
              {tramos.map(t => (
                <tr key={t.id} className="logx__tr">
                  <td className="logx__td"><input type="checkbox" checked={t.seleccionado} onChange={() => toggleUno(t.id)} className="logx__checkbox" /></td>
                  <td className="logx__td"><span className="logx__pill-num">{t.numero}</span></td>
                  <td className="logx__td">
                    <div className="logx__route">
                      <div className="logx__route-line">
                        <div className="logx__route-dot logx__route-dot--filled" />
                        <div className="logx__route-bar" />
                        <div className="logx__route-dot logx__route-dot--outline" />
                      </div>
                      <div className="logx__route-names">
                        <span className="logx__route-origin">{t.origen}</span>
                        <span className="logx__route-dest">{t.destino}</span>
                      </div>
                    </div>
                  </td>
                  <td className="logx__td logx__td--duracion">{t.duracion}</td>
                  <td className="logx__td logx__td--center"><span className="logx__km">{t.distancia_km.toFixed(1)}</span></td>
                  <td className="logx__td">
                    <div className="logx__medio">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#455b9d" strokeWidth="2"><path d="M5 18H3c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v11"/><path d="M14 9h4l4 4v4c0 .6-.4 1-1 1h-2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
                      <span>{t.medio}</span>
                    </div>
                  </td>
                  <td className="logx__td">
                    <div className="logx__via">
                      <span className="logx__via-tipo">{t.estado_via}</span>
                      <span className="logx__via-calidad" style={{ color: CALIDAD_COLOR[t.calidad] }}>{t.calidad}</span>
                    </div>
                  </td>
                  <td className="logx__td"><span className="logx__chip">{t.tipo_transporte}</span></td>
                  <td className="logx__td logx__td--center">
                    <span className="logx__chip" style={{ background: t.orden_publico === 'Sí' ? '#fde8e8' : '#e8f5e9', color: t.orden_publico === 'Sí' ? '#ba1a1a' : '#2e7d32', fontWeight: 700 }}>
                      {t.orden_publico === 'Sí' ? 'SÍ' : 'NO'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Action Buttons */}
      <div className="logx__actions">
        <button className="logx__btn logx__btn--primary" onClick={() => {
          const ultimo = tramos[tramos.length - 1];
          setNuevo({ ...NUEVO_VACIO, origen: ultimo ? ultimo.destino : '' });
          setEditandoId(null);
          setModalAbierto(true);
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          <span>Añadir Tramo</span>
        </button>
        <button className="logx__btn logx__btn--neutral" onClick={abrirEdicion} disabled={seleccionados.length !== 1} title={seleccionados.length === 1 ? 'Editar tramo seleccionado' : 'Seleccione exactamente 1 tramo'}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>Editar Tramo</span>
        </button>
        <button className="logx__btn logx__btn--danger" onClick={eliminarSeleccionados} disabled={!haySel} title={haySel ? 'Eliminar seleccionados' : 'Seleccione tramos primero'}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Eliminar Tramo</span>
        </button>
        <button className="logx__btn logx__btn--neutral" onClick={exportarReporte}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Exportar Reporte</span>
        </button>
      </div>

      {/* Observations */}
      <section className="logx__obs">
        <label className="logx__obs-label" htmlFor="observaciones-logistica">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0041a3" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Observaciones
        </label>
        <textarea
          id="observaciones-logistica"
          className="logx__obs-textarea"
          placeholder="Ingrese notas adicionales sobre el despacho o la ruta..."
          rows={3}
          value={observaciones}
          onChange={e => setObservaciones(e.target.value)}
        />
      </section>
      </div>

      {/* Modal Añadir / Editar Tramo */}
      {modalAbierto && (() => {
        const idxEditando = editandoId ? tramos.findIndex(t => t.id === editandoId) : -1;
        const tramoAnterior = editandoId ? tramos[idxEditando - 1] : tramos[tramos.length - 1];
        const tramoSiguiente = editandoId ? tramos[idxEditando + 1] : null;
        const origenBloqueado = !!tramoAnterior; // siempre bloqueado si hay tramo previo
        const destinoBloqueado = !!tramoSiguiente; // bloqueado si hay tramo siguiente (al editar)
        const LOCK_STYLE = { background: '#f0f2f4', color: '#76777d', cursor: 'not-allowed', border: '1px solid #e0e3e5' };
        const LockChip = () => (
          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#0041a3', background: '#e8edf7', padding: '1px 6px', borderRadius: 4, letterSpacing: '0.04em' }}>
            🔒 ENCADENADO
          </span>
        );
        return (
        <div className="logx__modal-overlay" onClick={cerrarModal}>
          <div className="logx__modal" onClick={e => e.stopPropagation()}>
            <h3 className="logx__modal-title">{editandoId ? 'Editar Tramo' : 'Añadir Tramo'}</h3>
            <div className="logx__modal-grid">
              <div className="logx__field">
                <label>Origen * {origenBloqueado && <LockChip />}</label>
                <input
                  value={nuevo.origen}
                  readOnly={origenBloqueado}
                  style={origenBloqueado ? LOCK_STYLE : {}}
                  onChange={e => !origenBloqueado && setNuevo(n => ({ ...n, origen: e.target.value }))}
                  placeholder="Cali"
                  title={origenBloqueado ? `Enlazado al destino del tramo anterior: ${tramoAnterior?.destino}` : ''}
                />
              </div>
              <div className="logx__field">
                <label>Destino * {destinoBloqueado && <LockChip />}</label>
                <input
                  value={nuevo.destino}
                  readOnly={destinoBloqueado}
                  style={destinoBloqueado ? LOCK_STYLE : {}}
                  onChange={e => !destinoBloqueado && setNuevo(n => ({ ...n, destino: e.target.value }))}
                  placeholder="Buenaventura"
                  title={destinoBloqueado ? `Enlazado al origen del siguiente tramo: ${tramoSiguiente?.origen}` : ''}
                />
              </div>
              <div className="logx__field">
                <label>Duración</label>
                <input value={nuevo.duracion} onChange={e => setNuevo(n => ({ ...n, duracion: e.target.value }))} placeholder="03h 15m" />
              </div>
              <div className="logx__field">
                <label>Distancia (km) *</label>
                <input type="number" value={nuevo.distancia} onChange={e => setNuevo(n => ({ ...n, distancia: e.target.value }))} placeholder="121.5" />
              </div>
              <div className="logx__field">
                <label>Medio Transp.</label>
                <select value={nuevo.medio} onChange={e => setNuevo(n => ({ ...n, medio: e.target.value }))}>
                  <option>Camión Turbo</option><option>Doble Troque</option><option>Tractomula</option><option>Lancha / Fluvial</option><option>Mula / Trocha</option>
                </select>
              </div>
              <div className="logx__field">
                <label>Estado / Tipo Vía</label>
                <select value={nuevo.estado_via} onChange={e => setNuevo(n => ({ ...n, estado_via: e.target.value as EstadoVia }))}>
                  <option>Pavimentada</option><option>Montaña</option><option>Destapada</option><option>Mixta</option>
                </select>
              </div>
              <div className="logx__field">
                <label>Calidad</label>
                <select value={nuevo.calidad} onChange={e => setNuevo(n => ({ ...n, calidad: e.target.value as CalidadVia }))}>
                  <option>Óptimo</option><option>Regular</option><option>Crítico</option>
                </select>
              </div>
              <div className="logx__field">
                <label>Tipo Transp.</label>
                <select value={nuevo.tipo_transporte} onChange={e => setNuevo(n => ({ ...n, tipo_transporte: e.target.value }))}>
                  <option>Carga Pesada</option><option>Granel Líquido</option><option>Carga Refrigerada</option><option>Pasajeros</option>
                </select>
              </div>
              <div className="logx__field">
                <label>Problemas de Orden Público</label>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  {(['Sí', 'No'] as const).map(op => (
                    <label key={op} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14, fontWeight: nuevo.orden_publico === op ? 700 : 400, color: nuevo.orden_publico === op ? (op === 'Sí' ? '#ba1a1a' : '#2e7d32') : '#434655' }}>
                      <input type="radio" name="orden_publico" value={op} checked={nuevo.orden_publico === op} onChange={() => setNuevo(n => ({ ...n, orden_publico: op }))} style={{ accentColor: op === 'Sí' ? '#ba1a1a' : '#2e7d32' }} />
                      {op}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="logx__modal-actions">
              <button className="logx__btn logx__btn--neutral" onClick={cerrarModal}>Cancelar</button>
              <button className="logx__btn logx__btn--primary" onClick={guardarTramo} disabled={!nuevo.origen.trim() || !nuevo.destino.trim() || !nuevo.distancia}>
                {editandoId ? 'Actualizar Tramo' : 'Guardar Tramo'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </main>
  );
}
