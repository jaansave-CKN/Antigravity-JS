/**
 * PresupuestoPage — Módulo 4: Análisis de Precios Unitarios (APU)
 * Consume los endpoints huérfanos verificados 2026-08-06 (auditoría Grupo Elite):
 *   GET  /api/rendimientos                — catálogo de rendimientos estándar
 *   GET  /api/proyectos/:id/presupuesto   — items APU ya guardados del proyecto
 *   POST /api/proyectos/:id/presupuesto   — calcula (mano de obra+materiales+equipos+AIU) y persiste
 * Sin fuente Stitch — paleta consistente con ExportacionPage/LogisticaPage.
 *
 * AXIOMA COP: todo formateo de moneda usa Intl.NumberFormat('es-CO', { currency: 'COP' }).
 * Nunca USD ni símbolos genéricos ($ suelto sin locale es tratado como error de estilo).
 *
 * Limitación conocida, no oculta: materiales[]/equipos[] del motor APU (apuEngine.js)
 * se envían vacíos en esta primera versión — el motor los soporta, pero un editor de
 * líneas de materiales/equipos por ítem es una pieza de UI separada, no construida aún.
 * costo_materiales/costo_equipos quedan en 0 hasta que exista ese editor.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { http, ApiError } from '../lib/apiClient';
import ProyectoSelectorModal from '../components/ProyectoSelectorModal';
import { cop as COP } from '../lib/currencyFormat';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.55)', primary: '#0058be', primarySoft: 'rgba(0,88,190,0.08)',
  error: '#ba1a1a', warn: '#b45309',
  // FIX (2026-08-24, "salto visual" del botón SAVE al cambiar de ventana):
  // 'Manrope' nunca se cargó en la app — caía al sans-serif genérico del
  // sistema, con métricas de line-height distintas a 'Public Sans' (la
  // fuente real de las otras 6 ventanas), desplazando la altura real del
  // botón dentro de la barra de 72px aunque el padding fuera igual.
  // success también se alinea al mismo verde exacto que usan las demás
  // ventanas (antes #2e7d32, ahora #15803d).
  success: '#15803d', font: "'Public Sans', sans-serif",
};

type Fase = 'NEGRA' | 'GRIS' | 'BLANCA';
const FASES: Fase[] = ['NEGRA', 'GRIS', 'BLANCA'];
const FASE_COLOR: Record<Fase, string> = { NEGRA: '#3f3f46', GRIS: '#6b7280', BLANCA: '#0058be' };

interface Rendimiento { clave: string; descripcion?: string; fase: Fase; unidad: string; valor: number }
interface ItemForm {
  fase: Fase; capitulo: string; item: string; unidad: string; cantidad: string;
  rendimiento_std: string; rendimiento_real: string; costo_jornal_dia: string; aiu: string;
  // Identidad local estable para la key de React — nunca se envía al backend
  // (guardar() reconstruye el payload campo por campo, ver más abajo).
  _localKey: string;
}
interface ItemGuardado {
  id?: string; fase: Fase; capitulo: string; item: string; unidad: string;
  cantidad: number; costo_mano_obra: number; costo_materiales: number; costo_equipos: number;
  costo_directo: number; aiu: number; valor_total: number;
}
interface RendimientosResponse { success: boolean; data: Rendimiento[] }
interface PresupuestoResponse { success: boolean; data: ItemGuardado[]; porFase: Record<Fase, number>; total: number }
interface GuardarResponse { success: boolean; message: string; porFase: Record<Fase, number>; total: number; alertas: unknown[]; items: number }

const NUEVO_VACIO: Omit<ItemForm, '_localKey'> = {
  fase: 'NEGRA', capitulo: '', item: '', unidad: 'm2', cantidad: '',
  rendimiento_std: '', rendimiento_real: '', costo_jornal_dia: '', aiu: '0.28',
};
const nuevaFila = (): ItemForm => ({ ...NUEVO_VACIO, _localKey: crypto.randomUUID() });

function mensajeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Tu sesión expiró — inicia sesión de nuevo.';
    if (e.status === 404) return 'El proyecto activo ya no existe o no te pertenece.';
    if (e.status === 409) return 'El proyecto está Finalizado — el presupuesto es inmutable.';
    return `${e.message} (HTTP ${e.status})`;
  }
  return 'No se pudo conectar con el servidor.';
}

export default function PresupuestoPage() {
  const [proyectoId, setProyectoId] = useState<string | null>(() => localStorage.getItem(ACTIVE_PROJECT_KEY));
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  useEffect(() => {
    const onStorage = () => setProyectoId(localStorage.getItem(ACTIVE_PROJECT_KEY));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [rendimientos, setRendimientos] = useState<Rendimiento[]>([]);
  const [itemsGuardados, setItemsGuardados] = useState<ItemGuardado[]>([]);
  const [porFase, setPorFase] = useState<Record<Fase, number>>({ NEGRA: 0, GRIS: 0, BLANCA: 0 });
  const [total, setTotal] = useState(0);
  const [borrador, setBorrador] = useState<ItemForm[]>([nuevaFila()]);

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): guardar() no tenía ninguna guarda contra un segundo
  // disparo mientras el POST anterior seguía en vuelo.
  const guardandoRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [limpiado, setLimpiado] = useState(false);

  const cargar = useCallback(async () => {
    if (!proyectoId) { setCargando(false); return; }
    setCargando(true);
    setError(null);
    try {
      const [rend, pres] = await Promise.all([
        http.get<RendimientosResponse>('/api/rendimientos'),
        http.get<PresupuestoResponse>(`/api/proyectos/${proyectoId}/presupuesto`),
      ]);
      setRendimientos(rend.data || []);
      setItemsGuardados(pres.data || []);
      setPorFase(pres.porFase || { NEGRA: 0, GRIS: 0, BLANCA: 0 });
      setTotal(pres.total || 0);
    } catch (e) {
      console.error('[Presupuesto] Error cargando:', e);
      setError(mensajeError(e));
      if (e instanceof ApiError && e.status === 404) {
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
        setProyectoId(null);
        setSelectorAbierto(true);
      }
    } finally {
      setCargando(false);
    }
  }, [proyectoId]);

  useEffect(() => { cargar(); }, [cargar]);

  // MANDATO (2026-08-24, "indicador de cambios sin guardar", verde/rojo puro
  // en TODAS las ventanas sin excepción, sin estado neutral) — esta página
  // no encaja 1:1 en el patrón "editar estado persistente y volver a
  // guardarlo" de Entrada/Contexto/Logística/Dialéctica: aquí SAVE es
  // "confirmar el borrador" (lo envía y el borrador vuelve a una fila en
  // blanco). Igual se aplica la misma regla de dos estados: rojo mientras el
  // borrador tiene contenido sin confirmar, verde cuando está vacío (nada
  // pendiente) — nunca el azul neutral de antes.
  const hayBorradorSinGuardar = borrador.some(r =>
    r.capitulo.trim() || r.item.trim() || r.cantidad || r.rendimiento_std || r.rendimiento_real || r.costo_jornal_dia
  );

  const actualizarFila = (idx: number, campo: keyof ItemForm, valor: string) => {
    setBorrador(rows => rows.map((r, i) => i === idx ? { ...r, [campo]: valor } : r));
  };
  const agregarFila = () => setBorrador(rows => [...rows, nuevaFila()]);
  const quitarFila = (idx: number) => setBorrador(rows => rows.filter((_, i) => i !== idx));

  // LIMPIAR — mismo botón que ya tienen las demás ventanas del Formulador,
  // agregado aquí (2026-08-24, "misma ubicación perfecta que Entrada") junto
  // con SAVE, que antes vivía abajo pegado a "+ Agregar fila". Solo resetea
  // el borrador visible a una fila en blanco — nunca borra ítems ya
  // guardados en el servidor (eso ya se hace fila por fila con "✕").
  const limpiar = () => {
    if (hayBorradorSinGuardar && !window.confirm('Esto va a borrar las filas del borrador que aún no has guardado. ¿Seguro que quieres continuar?')) {
      return;
    }
    setBorrador([nuevaFila()]);
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  const guardar = async () => {
    if (!proyectoId) { setSelectorAbierto(true); return; }
    if (guardandoRef.current) return;
    const items = borrador
      .filter(r => r.item.trim() && r.cantidad && r.rendimiento_real)
      .map(r => ({
        fase: r.fase, capitulo: r.capitulo.trim(), item: r.item.trim(), unidad: r.unidad,
        cantidad: parseFloat(r.cantidad) || 0,
        rendimiento_std: r.rendimiento_std || undefined,
        rendimiento_real: parseFloat(r.rendimiento_real) || 0,
        costo_jornal_dia: parseFloat(r.costo_jornal_dia) || 0,
        aiu: parseFloat(r.aiu) || 0.28,
        materiales: [], equipos: [],
      }));
    if (items.length === 0) { setError('Agrega al menos un ítem con cantidad y rendimiento real antes de guardar.'); return; }

    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const result = await http.post<GuardarResponse>(`/api/proyectos/${proyectoId}/presupuesto`, { items });
      setMensaje(result.message);
      setBorrador([nuevaFila()]);
      await cargar();
    } catch (e) {
      console.error('[Presupuesto] Error guardando:', e);
      setError(mensajeError(e));
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  if (!proyectoId) {
    return (
      <div style={{ padding: 32, fontFamily: T.font, color: T.textMuted }}>
        No hay un proyecto activo — completa el módulo Entrada primero, o{' '}
        <button onClick={() => setSelectorAbierto(true)} style={{ color: T.primary, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}>
          selecciona un proyecto
        </button>.
        {selectorAbierto && <ProyectoSelectorModal onClose={() => setSelectorAbierto(false)} />}
      </div>
    );
  }

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.font, minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Topbar — misma barra sticky que EntradaPage.tsx (.entr__topbar):
          72px, padding 0 32px, centrado vertical (pedido explícito 2026-08-24,
          "misma ubicación perfecta que Entrada en todas las páginas"). Esta
          página no tiene archivo .css propio (todo inline vía el objeto T,
          diseño original de PresupuestoPage) — se replica la MISMA receta de
          valores en línea en vez de crear una hoja de estilos nueva solo
          para esto. Título a 28px (no 32 como Entrada) porque ya era así
          desde el diseño original — es más largo que "Datos de Entrada" y
          32px lo desbordaría junto a 3 botones en una sola fila. */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#ffffff', borderBottom: `1px solid ${T.border}`,
        height: 72, padding: '0 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 16, flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: T.text, letterSpacing: '-0.02em', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Presupuesto — Análisis de Precios Unitarios
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setSelectorAbierto(true)} style={{ fontSize: 12, color: T.primary, background: T.primarySoft, border: `1px solid ${T.primary}33`, borderRadius: 8, padding: '9px 14px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: T.font, fontWeight: 700 }}>
            Cambiar proyecto
          </button>
          <button
            onClick={limpiar}
            style={{ padding: '10px 20px', background: '#fff', color: '#64748b', border: '1px solid #c6c6cd', borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', fontFamily: T.font, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            title={hayBorradorSinGuardar ? 'Hay cambios sin guardar' : undefined}
            style={{ padding: '10px 28px', background: hayBorradorSinGuardar ? T.error : T.success, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', fontFamily: T.font, cursor: guardando ? 'not-allowed' : 'pointer', opacity: guardando ? 0.6 : 1, whiteSpace: 'nowrap' }}
          >
            {guardando ? 'Guardando…' : hayBorradorSinGuardar ? 'SAVE' : '✓ GUARDADO'}
          </button>
        </div>
      </header>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

      <p style={{ margin: 0, fontSize: 12.5, color: T.textMuted, maxWidth: 680 }}>
        Costos en Pesos Colombianos (COP). El servidor calcula mano de obra, AIU y el total por fase
        (Negra/Gris/Blanca) a partir de cantidad, rendimiento real y jornal — nunca se fabrica una cifra en el cliente.
      </p>

      {error && <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">{error}</div>}
      {mensaje && <div style={{ background: 'rgba(46,125,50,0.08)', border: '1px solid rgba(46,125,50,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.success }}>{mensaje}</div>}

      {/* Totales por fase */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {FASES.map(f => (
          <div key={f} style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `4px solid ${FASE_COLOR[f]}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Fase {f}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{COP.format(porFase[f] || 0)}</div>
          </div>
        ))}
        <div style={{ background: T.primary, borderRadius: 10, padding: 14, color: '#fff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.85 }}>Total General</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{COP.format(total)}</div>
        </div>
      </div>

      {/* Items ya guardados */}
      <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.border}`, fontWeight: 700, fontSize: 14 }}>
          Ítems guardados {cargando && <span style={{ fontWeight: 400, color: T.textMuted }}> — cargando…</span>}
        </div>
        {itemsGuardados.length === 0 && !cargando ? (
          <div style={{ padding: 20, fontSize: 12.5, color: T.textMuted }}>Sin ítems de presupuesto todavía.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#f2f4f6', textAlign: 'left' }}>
                  {['Fase', 'Capítulo', 'Ítem', 'Cant.', 'M. Obra', 'Materiales', 'Equipos', 'AIU', 'Valor Total'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', fontWeight: 700, color: T.textMuted, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itemsGuardados.map((it, i) => (
                  <tr key={it.id || i} style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ padding: '8px 10px' }}><span style={{ color: FASE_COLOR[it.fase], fontWeight: 700 }}>{it.fase}</span></td>
                    <td style={{ padding: '8px 10px' }}>{it.capitulo}</td>
                    <td style={{ padding: '8px 10px' }}>{it.item} <span style={{ color: T.textMuted }}>({it.unidad})</span></td>
                    <td style={{ padding: '8px 10px' }}>{it.cantidad}</td>
                    <td style={{ padding: '8px 10px' }}>{COP.format(it.costo_mano_obra)}</td>
                    <td style={{ padding: '8px 10px' }}>{COP.format(it.costo_materiales)}</td>
                    <td style={{ padding: '8px 10px' }}>{COP.format(it.costo_equipos)}</td>
                    <td style={{ padding: '8px 10px' }}>{(it.aiu * 100).toFixed(0)}%</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{COP.format(it.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Editor de nuevos items */}
      <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Agregar ítems APU</div>
        {borrador.map((row, idx) => (
          <div key={row._localKey} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 70px 90px 1fr 90px 90px 70px 28px', gap: 6, alignItems: 'center' }}>
            <select value={row.fase} onChange={e => actualizarFila(idx, 'fase', e.target.value)} style={campoStyle}>
              {FASES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <input aria-label="Capítulo" placeholder="Capítulo" value={row.capitulo} onChange={e => actualizarFila(idx, 'capitulo', e.target.value)} style={campoStyle} />
            <input aria-label="Ítem" placeholder="Ítem" value={row.item} onChange={e => actualizarFila(idx, 'item', e.target.value)} style={campoStyle} />
            <input aria-label="Unidad" placeholder="Unidad" value={row.unidad} onChange={e => actualizarFila(idx, 'unidad', e.target.value)} style={campoStyle} />
            <input aria-label="Cantidad" placeholder="Cantidad" type="number" value={row.cantidad} onChange={e => actualizarFila(idx, 'cantidad', e.target.value)} style={campoStyle} />
            <select value={row.rendimiento_std} onChange={e => actualizarFila(idx, 'rendimiento_std', e.target.value)} style={campoStyle}>
              <option value="">Rend. estándar (opcional)</option>
              {rendimientos.map(r => <option key={r.clave} value={r.clave}>{r.descripcion || r.clave} ({r.valor}/{r.unidad})</option>)}
            </select>
            <input aria-label="Rendimiento real" placeholder="Rend. real *" type="number" value={row.rendimiento_real} onChange={e => actualizarFila(idx, 'rendimiento_real', e.target.value)} style={campoStyle} title="Requerido — unidades/jornal" />
            <input aria-label="Costo del jornal (COP)" placeholder="Jornal (COP)" type="number" value={row.costo_jornal_dia} onChange={e => actualizarFila(idx, 'costo_jornal_dia', e.target.value)} style={campoStyle} />
            <input aria-label="AIU" placeholder="AIU" type="number" step="0.01" value={row.aiu} onChange={e => actualizarFila(idx, 'aiu', e.target.value)} style={campoStyle} title="Fracción, ej. 0.28 = 28%" />
            <button onClick={() => quitarFila(idx)} disabled={borrador.length === 1} style={{ background: 'none', border: 'none', color: borrador.length === 1 ? T.border : T.error, cursor: borrador.length === 1 ? 'not-allowed' : 'pointer', fontSize: 16 }} title="Quitar fila">✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={agregarFila} style={{ padding: '8px 14px', background: T.primarySoft, color: T.primary, border: `1px solid ${T.primary}33`, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            + Agregar fila
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: T.textMuted, alignSelf: 'center' }}>
            Usa el botón SAVE de la barra superior para calcular y guardar el presupuesto.
          </span>
        </div>
      </section>

      {selectorAbierto && <ProyectoSelectorModal onClose={() => setSelectorAbierto(false)} />}
      </div>
    </div>
  );
}

const campoStyle: React.CSSProperties = {
  fontSize: 11.5, padding: '6px 8px', border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontFamily: T.font, width: '100%', boxSizing: 'border-box',
};
