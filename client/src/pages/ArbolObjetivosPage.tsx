/**
 * ArbolObjetivosPage — Motor de Coherencia Lógica (Fase 2)
 * Genera el árbol de objetivos con IA, permite registrar indicadores y
 * Teoría de Cambio, y confirma la coherencia del proyecto contra reglas
 * reales validadas en el servidor (no un placebo que siempre aprueba).
 *
 * Sin fuente Stitch — página nueva, paleta consistente con el resto del
 * Formulador (primary #0058be, bg #f7f9fb, card #ffffff, border #e0e3e5).
 */
import { useEffect, useState } from 'react';
import { http, ApiError } from '../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.55)', primary: '#0058be', primarySoft: 'rgba(0,88,190,0.08)',
  success: '#15803d', successSoft: 'rgba(21,128,61,0.08)', successBorder: 'rgba(21,128,61,0.3)',
  error: '#ba1a1a', errorSoft: 'rgba(186,26,26,0.08)', errorBorder: 'rgba(186,26,26,0.3)',
  font: "'Manrope', sans-serif",
};

interface Nodo {
  id: string; tipo: string; nivel: number; texto: string; parent_id: string | null;
  confirmado: number; supuestos: string | null;
}
interface Indicador {
  id: string; nombre: string; tipo: string; linea_base: number; meta_total: number;
  unidad_medida: string; fuente_verificacion: string | null;
}
type ConfirmResult = { ok: true } | { ok: false; detail: string[] };

const TIPO_LABEL: Record<string, string> = {
  CENTRAL: 'Objetivo Central', ESPECIFICO: 'Objetivo Específico',
  RESULTADO: 'Resultado', ACTIVIDAD: 'Actividad',
};

export default function ArbolObjetivosPage() {
  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);

  const [objetivoCentral, setObjetivoCentral] = useState('');
  const [nodos, setNodos] = useState<Nodo[]>([]);
  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [generando, setGenerando] = useState(false);
  const [cargando, setCargando] = useState(!!proyectoId);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nuevoInd, setNuevoInd] = useState({ nombre: '', tipo: 'Producto', linea_base: '0', meta_total: '', unidad_medida: '', fuente_verificacion: '' });

  useEffect(() => {
    if (!proyectoId) { setCargando(false); return; }
    (async () => {
      try {
        const [arbolBody, indBody] = await Promise.all([
          http.get<{ success: boolean; data?: Nodo[] }>(`/api/proyectos/${proyectoId}/arbol`),
          http.get<{ success: boolean; data?: Indicador[] }>(`/api/proyectos/${proyectoId}/indicadores`),
        ]);
        setNodos(arbolBody.data || []);
        setIndicadores(indBody.data || []);
      } catch {
        setError('No se pudo cargar el árbol de objetivos guardado.');
      } finally {
        setCargando(false);
      }
    })();
  }, [proyectoId]);

  const generar = async () => {
    if (!proyectoId || !objetivoCentral.trim()) return;
    setGenerando(true);
    setError(null);
    setConfirmResult(null);
    try {
      const body = await http.post<{ success: boolean; data?: Nodo[]; message?: string }>('/api/modulo3b/arbol/generar', {
        proyectoId, objetivoCentral: objetivoCentral.trim(),
      });
      setNodos(body.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el árbol de objetivos');
    } finally {
      setGenerando(false);
    }
  };

  const agregarIndicador = async () => {
    if (!proyectoId || !nuevoInd.nombre.trim() || !nuevoInd.meta_total || !nuevoInd.unidad_medida.trim()) return;
    try {
      const resp = await http.post<{ success: boolean; data?: { id: string } }>(`/api/proyectos/${proyectoId}/indicadores`, {
        nombre: nuevoInd.nombre.trim(), tipo: nuevoInd.tipo,
        linea_base: Number(nuevoInd.linea_base) || 0, meta_total: Number(nuevoInd.meta_total),
        unidad_medida: nuevoInd.unidad_medida.trim(), fuente_verificacion: nuevoInd.fuente_verificacion.trim(),
      });
      if (resp.data?.id) {
        setIndicadores(prev => [...prev, { id: resp.data!.id, nombre: nuevoInd.nombre.trim(), tipo: nuevoInd.tipo, linea_base: Number(nuevoInd.linea_base) || 0, meta_total: Number(nuevoInd.meta_total), unidad_medida: nuevoInd.unidad_medida.trim(), fuente_verificacion: nuevoInd.fuente_verificacion.trim() }]);
        setNuevoInd({ nombre: '', tipo: 'Producto', linea_base: '0', meta_total: '', unidad_medida: '', fuente_verificacion: '' });
      }
    } catch {
      setError('No se pudo guardar el indicador');
    }
  };

  const eliminarIndicador = async (id: string) => {
    if (!proyectoId) return;
    setIndicadores(prev => prev.filter(i => i.id !== id));
    try { await http.delete(`/api/proyectos/${proyectoId}/indicadores/${id}`); } catch { /* best-effort */ }
  };

  const confirmarCoherencia = async () => {
    if (!proyectoId) return;
    setConfirmando(true);
    setConfirmResult(null);
    try {
      await http.post(`/api/modulo3b/arbol/${proyectoId}/confirmar`);
      setConfirmResult({ ok: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const detail = (e.body as { detail?: string[] } | undefined)?.detail || [e.message];
        setConfirmResult({ ok: false, detail });
      } else {
        setConfirmResult({ ok: false, detail: [e instanceof Error ? e.message : 'Error al confirmar coherencia'] });
      }
    } finally {
      setConfirmando(false);
    }
  };

  if (!proyectoId) {
    return (
      <div style={{ padding: 32, fontFamily: T.font, color: T.textMuted }}>
        No hay un proyecto activo — completa el módulo Entrada primero para poder construir el árbol de objetivos.
      </div>
    );
  }

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.font, minHeight: 'calc(100vh - 48px)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Árbol de Objetivos y Coherencia Lógica</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: T.textMuted, maxWidth: 680 }}>
        Genera el árbol de objetivos con IA, registra los indicadores verificables de cada nivel, y confirma
        la coherencia del proyecto — la confirmación valida de verdad la estructura (1 objetivo central, sin
        nodos huérfanos ni ciclos, y al menos un indicador registrado).
      </p>

      {error && (
        <div style={{ background: T.errorSoft, border: `1px solid ${T.errorBorder}`, borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">
          {error}
        </div>
      )}

      {/* Generación del árbol */}
      <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.primary, margin: '0 0 12px' }}>1 · Generar árbol de objetivos</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            value={objetivoCentral}
            onChange={e => setObjetivoCentral(e.target.value)}
            placeholder="Objetivo central del proyecto (ej: Mejorar el acceso a agua potable en zona rural X)"
            style={{ flex: 1, minWidth: 280, padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: T.font }}
          />
          <button
            onClick={generar}
            disabled={generando || !objetivoCentral.trim()}
            style={{ padding: '10px 20px', background: T.primary, border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, cursor: generando ? 'not-allowed' : 'pointer', opacity: generando ? 0.6 : 1 }}
          >
            {generando ? 'Generando…' : 'Generar con IA'}
          </button>
        </div>

        {cargando ? (
          <p style={{ fontSize: 12.5, color: T.textMuted, marginTop: 16 }}>Cargando árbol guardado…</p>
        ) : nodos.length === 0 ? (
          <p style={{ fontSize: 12.5, color: T.textMuted, fontStyle: 'italic', marginTop: 16 }}>Aún no se ha generado un árbol para este proyecto.</p>
        ) : (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {nodos.map(n => (
              <div key={n.id} style={{ marginLeft: n.nivel * 24, display: 'flex', alignItems: 'center', gap: 8, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 12px' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: T.primary, background: T.primarySoft, padding: '2px 8px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {TIPO_LABEL[n.tipo] || n.tipo}
                </span>
                <span style={{ fontSize: 13 }}>{n.texto}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Indicadores */}
      <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.primary, margin: '0 0 12px' }}>2 · Indicadores verificables</h2>
        {indicadores.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {indicadores.map(i => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 12.5 }}>
                <strong>{i.nombre}</strong>
                <span style={{ color: T.textMuted }}>{i.tipo} · LB {i.linea_base} → Meta {i.meta_total} {i.unidad_medida}</span>
                {i.fuente_verificacion && <span style={{ color: T.textMuted, fontStyle: 'italic' }}>· {i.fuente_verificacion}</span>}
                <button onClick={() => eliminarIndicador(i.id)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: T.error, cursor: 'pointer', fontSize: 12 }}>Eliminar</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <input placeholder="Nombre del indicador" value={nuevoInd.nombre} onChange={e => setNuevoInd(v => ({ ...v, nombre: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12.5 }} />
          <select value={nuevoInd.tipo} onChange={e => setNuevoInd(v => ({ ...v, tipo: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12.5 }}>
            <option>Producto</option><option>Resultado</option><option>Impacto</option><option>Gestión</option>
          </select>
          <input type="number" placeholder="Línea base" value={nuevoInd.linea_base} onChange={e => setNuevoInd(v => ({ ...v, linea_base: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12.5 }} />
          <input type="number" placeholder="Meta *" value={nuevoInd.meta_total} onChange={e => setNuevoInd(v => ({ ...v, meta_total: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12.5 }} />
          <input placeholder="Unidad de medida *" value={nuevoInd.unidad_medida} onChange={e => setNuevoInd(v => ({ ...v, unidad_medida: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12.5 }} />
          <input placeholder="Fuente de verificación" value={nuevoInd.fuente_verificacion} onChange={e => setNuevoInd(v => ({ ...v, fuente_verificacion: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 12.5 }} />
        </div>
        <button
          onClick={agregarIndicador}
          disabled={!nuevoInd.nombre.trim() || !nuevoInd.meta_total || !nuevoInd.unidad_medida.trim()}
          style={{ marginTop: 10, padding: '8px 16px', background: T.primarySoft, border: `1px solid ${T.primary}`, borderRadius: 6, color: T.primary, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >
          + Agregar indicador
        </button>
      </section>

      {/* Confirmación de coherencia */}
      <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: T.primary, margin: '0 0 12px' }}>3 · Confirmar coherencia</h2>
        <button
          onClick={confirmarCoherencia}
          disabled={confirmando}
          style={{ padding: '10px 20px', background: T.success, border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, cursor: confirmando ? 'not-allowed' : 'pointer', opacity: confirmando ? 0.6 : 1 }}
        >
          {confirmando ? 'Validando…' : 'Confirmar coherencia del árbol'}
        </button>

        {confirmResult && (
          confirmResult.ok ? (
            <div style={{ marginTop: 14, background: T.successSoft, border: `1px solid ${T.successBorder}`, borderRadius: 8, padding: '12px 16px', color: T.success, fontSize: 13, fontWeight: 700 }}>
              ✓ Árbol confirmado — coherencia verificada por el servidor.
            </div>
          ) : (
            <div style={{ marginTop: 14, background: T.errorSoft, border: `1px solid ${T.errorBorder}`, borderRadius: 8, padding: '12px 16px' }}>
              <p style={{ margin: '0 0 8px', color: T.error, fontWeight: 700, fontSize: 13 }}>✗ El árbol no pasa la validación de coherencia:</p>
              <ul style={{ margin: 0, paddingLeft: 18, color: T.error, fontSize: 12.5 }}>
                {confirmResult.detail.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )
        )}
      </section>
    </div>
  );
}
