/**
 * ViabilidadFinancieraPage — Punto de Equilibrio y Reinversión
 * Consume los endpoints reales del backend (commits ba06231, a77ff33, 47d4f32):
 *   GET  /api/proyectos/:id                          — ficha_tecnica.viabilidad_financiera (preview + toggle previos)
 *   POST /api/proyectos/:id/viabilidad-financiera     — calcula punto de equilibrio (costos_variables_totales EN VIVO desde project_apu_lineas)
 *   PUT  /api/proyectos/:id/etapa-construccion        — marca manual de fin de obra física (gatea reinversion.habilitada)
 *
 * Fuente Stitch (Plano de Obra): proyecto 3791086755596777919, pantalla
 * "Viabilidad Financiera - Punto de Equilibrio" (screens/8ad32fc45e2540d8a05904476789ae72,
 * tema claro) + variante "No Alcanzado" (screens/817b3807d1ae44c38778f5e648fd84c9) —
 * design system "Institutional Precision" (assets/9c3403c5399b4d42b277a1a0c38a0c83),
 * generado 2026-08-10 tras confirmar que el design system "RadFor 360" (oscuro) NO
 * corresponde al tema realmente aprobado en este repo (ver comentario de PresupuestoPage.tsx).
 * Cuadro comparativo de fidelidad CSS entregado en el chat junto con este archivo.
 *
 * AXIOMA COP: todo formateo de moneda usa Intl.NumberFormat('es-CO', { currency: 'COP' }).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { http, ApiError } from '../lib/apiClient';
import ProyectoSelectorModal from '../components/ProyectoSelectorModal';
import { cop as COP } from '../lib/currencyFormat';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

// Tokens 1:1 desde el HTML real generado por Stitch — ver cuadro comparativo.
const T = {
  bg: '#f7f9fb', card: '#ffffff', cardLow: '#f2f3fc', border: '#e0e3e5', dividerBorder: '#c2c6d5',
  text: '#191b22', textMuted: '#424753', primary: '#0058be', onPrimary: '#ffffff',
  successBg: 'rgba(46,125,50,0.1)', success: '#2e7d32',
  warnBg: '#ffdbcd', warnText: '#7c2e00', warnBorder: '#ffb596',
  disabledBg: '#e1e2eb', disabledText: '#424753', disabledBorder: '#c2c6d5',
  error: '#ba1a1a',
  cardShadow: '0px 2px 4px rgba(25,28,30,0.04), 0px 8px 16px rgba(25,28,30,0.06)',
  fontHeadline: "'Hanken Grotesk', sans-serif",
  fontData: "'JetBrains Mono', monospace",
};

interface ViabilidadFinancieraData {
  costos_fijos_proyectados: number | null;
  ventas_totales_proyectadas: number | null;
  costos_variables_totales: number;
  costos_variables_totales_fuente?: string;
  break_even_point_cop: number | null;
  is_break_even_reached: boolean | null;
  metodo_calculo: string | null;
  reinversion: { habilitada: boolean; modalidades_permitidas: string[] } | null;
}
interface ProyectoDetalle {
  success: boolean;
  data: { ficha_tecnica: { viabilidad_financiera?: ViabilidadFinancieraData; etapa_construccion_finalizada?: boolean } };
}
interface ViabilidadResponse { success: boolean; data: ViabilidadFinancieraData }
interface EtapaResponse { success: boolean; data: { etapa_construccion_finalizada: boolean } }

function mensajeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Tu sesión expiró — inicia sesión de nuevo.';
    if (e.status === 404) return 'El proyecto activo ya no existe o no te pertenece.';
    if (e.status === 409) return 'El proyecto está Finalizado — no puede modificarse.';
    return `${e.message} (HTTP ${e.status})`;
  }
  return 'No se pudo conectar con el servidor.';
}

export default function ViabilidadFinancieraPage() {
  const [proyectoId, setProyectoId] = useState<string | null>(() => localStorage.getItem(ACTIVE_PROJECT_KEY));
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  useEffect(() => {
    const onStorage = () => setProyectoId(localStorage.getItem(ACTIVE_PROJECT_KEY));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [costosFijos, setCostosFijos] = useState('');
  const [ventasTotales, setVentasTotales] = useState('');
  const [costosVariablesPreview, setCostosVariablesPreview] = useState(0);
  const [costosVariablesFuente, setCostosVariablesFuente] = useState('');
  const [etapaFinalizada, setEtapaFinalizada] = useState(false);
  const [resultado, setResultado] = useState<ViabilidadFinancieraData | null>(null);

  const [cargando, setCargando] = useState(true);
  const [calculando, setCalculando] = useState(false);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): calcular() no tenía ninguna guarda contra un segundo
  // disparo mientras el POST anterior seguía en vuelo.
  const calculandoRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!proyectoId) { setCargando(false); return; }
    setCargando(true);
    setError(null);
    try {
      const proyecto = await http.get<ProyectoDetalle>(`/api/proyectos/${proyectoId}`);
      const vf = proyecto.data.ficha_tecnica?.viabilidad_financiera;
      if (vf) {
        setCostosVariablesPreview(vf.costos_variables_totales || 0);
        setCostosVariablesFuente(vf.costos_variables_totales_fuente || '');
        if (vf.costos_fijos_proyectados != null) setCostosFijos(String(vf.costos_fijos_proyectados));
        if (vf.ventas_totales_proyectadas != null) setVentasTotales(String(vf.ventas_totales_proyectadas));
        if (vf.break_even_point_cop != null) setResultado(vf);
      }
      setEtapaFinalizada(proyecto.data.ficha_tecnica?.etapa_construccion_finalizada === true);
    } catch (e) {
      console.error('[ViabilidadFinanciera] Error cargando:', e);
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

  const calcular = async () => {
    if (!proyectoId) { setSelectorAbierto(true); return; }
    if (calculandoRef.current) return;
    calculandoRef.current = true;
    setCalculando(true);
    setError(null);
    try {
      const body: Record<string, number> = {
        costos_fijos_proyectados: parseFloat(costosFijos) || 0,
        ventas_totales_proyectadas: parseFloat(ventasTotales) || 0,
      };
      const result = await http.post<ViabilidadResponse>(`/api/proyectos/${proyectoId}/viabilidad-financiera`, body);
      setResultado(result.data);
      setCostosVariablesPreview(result.data.costos_variables_totales);
      setCostosVariablesFuente(result.data.costos_variables_totales_fuente || '');
    } catch (e) {
      console.error('[ViabilidadFinanciera] Error calculando:', e);
      setError(mensajeError(e));
    } finally {
      calculandoRef.current = false;
      setCalculando(false);
    }
  };

  const cambiarEtapaFinalizada = async (nuevoValor: boolean) => {
    if (!proyectoId) return;
    setEtapaFinalizada(nuevoValor);
    try {
      await http.put<EtapaResponse>(`/api/proyectos/${proyectoId}/etapa-construccion`, { etapa_construccion_finalizada: nuevoValor });
      // Si ya había un cálculo previo, se re-ejecuta para que reinversion.habilitada
      // refleje el nuevo estado de la etapa de inmediato — el backend solo la
      // recalcula dentro de POST /viabilidad-financiera, no al guardar el toggle.
      if (resultado && costosFijos && ventasTotales) await calcular();
    } catch (e) {
      console.error('[ViabilidadFinanciera] Error guardando etapa de construcción:', e);
      setError(mensajeError(e));
      setEtapaFinalizada(!nuevoValor);
    }
  };

  if (!proyectoId) {
    return (
      <div style={{ padding: 32, fontFamily: T.fontHeadline, color: T.textMuted }}>
        No hay un proyecto activo — completa el módulo Entrada primero, o{' '}
        <button onClick={() => setSelectorAbierto(true)} style={{ color: T.primary, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit' }}>
          selecciona un proyecto
        </button>.
        {selectorAbierto && <ProyectoSelectorModal onClose={() => setSelectorAbierto(false)} />}
      </div>
    );
  }

  const alcanzado = resultado?.is_break_even_reached === true;
  const reinversionHabilitada = resultado?.reinversion?.habilitada === true;

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.fontHeadline, minHeight: 'calc(100vh - 48px)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>Viabilidad Financiera</h1>
          <p style={{ margin: '4px 0 0', fontSize: 18, color: T.textMuted }}>Punto de equilibrio y reinversión</p>
        </div>
        <button onClick={() => setSelectorAbierto(true)} style={{ fontSize: 12, color: T.primary, background: 'rgba(0,88,190,0.08)', border: `1px solid ${T.primary}33`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Cambiar proyecto
        </button>
      </div>

      {error && <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">{error}</div>}
      {cargando && <div style={{ fontSize: 12.5, color: T.textMuted }}>Cargando…</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: 16, alignItems: 'start' }}>
        {/* Datos de Entrada */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: T.cardShadow, padding: 20 }}>
          <h3 style={{ fontSize: 20, fontWeight: 600, margin: 0, paddingBottom: 12, borderBottom: `1px solid ${T.dividerBorder}` }}>Datos de Entrada</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
            <div>
              <label htmlFor="viab-costos-fijos" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 4 }}>Costos Fijos Proyectados (COP)</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontFamily: T.fontData }}>$</span>
                <input id="viab-costos-fijos" type="number" placeholder="0" value={costosFijos} onChange={e => setCostosFijos(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 28px', fontFamily: T.fontData, fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text }} />
              </div>
            </div>
            <div style={{ background: T.cardLow, border: `1px solid ${T.border}`, borderRadius: 4, padding: 16 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 4 }}>Costos Variables Totales</span>
              <div style={{ fontFamily: T.fontData, fontSize: 32, fontWeight: 700, color: T.text }}>{COP.format(costosVariablesPreview)}</div>
              <p style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', margin: '4px 0 0' }}>
                {costosVariablesFuente === 'manual'
                  ? 'Sobrescrito manualmente en el último cálculo.'
                  : 'Calculado automáticamente del presupuesto APU real adjunto en Anexos.'}
              </p>
            </div>
            <div>
              <label htmlFor="viab-ventas-totales" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 4 }}>Ventas Totales Proyectadas / Fondeo Total (COP)</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontFamily: T.fontData }}>$</span>
                <input id="viab-ventas-totales" type="number" placeholder="0" value={ventasTotales} onChange={e => setVentasTotales(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 28px', fontFamily: T.fontData, fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
              <button onClick={calcular} disabled={calculando} style={{ background: T.primary, color: T.onPrimary, fontSize: 12, fontWeight: 600, padding: '10px 24px', borderRadius: 4, border: 'none', cursor: calculando ? 'not-allowed' : 'pointer', opacity: calculando ? 0.6 : 1 }}>
                {calculando ? 'Calculando…' : 'Calcular Punto de Equilibrio'}
              </button>
            </div>
          </div>
        </div>

        {/* Columna derecha: Resultado + Reinversión */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: T.cardShadow, padding: 20, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: `1px solid ${T.dividerBorder}`, marginBottom: 16, textAlign: 'left' }}>
              <h3 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Resultado</h3>
              {resultado && (
                alcanzado ? (
                  <span style={{ background: T.successBg, color: T.success, border: `1px solid ${T.success}`, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999 }}>Alcanzado</span>
                ) : (
                  <span style={{ background: T.warnBg, color: T.warnText, border: `1px solid ${T.warnBorder}`, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999 }}>No Alcanzado</span>
                )
              )}
            </div>
            {resultado ? (
              <>
                <div style={{ fontFamily: T.fontData, fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', color: T.primary }}>{COP.format(resultado.break_even_point_cop || 0)}</div>
                <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>Punto de Equilibrio Estimado</div>
                <div style={{ background: T.cardLow, border: `1px solid ${T.border}`, borderRadius: 4, padding: 12, marginTop: 16, textAlign: 'left' }}>
                  <p style={{ fontSize: 14, color: T.textMuted, margin: 0 }}><span style={{ fontWeight: 700 }}>Nota:</span> Esta es una proyección de punto único, no un cruce temporal real.</p>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 12.5, color: T.textMuted }}>Completa los datos de entrada y calcula para ver el resultado.</p>
            )}
          </div>

          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: T.cardShadow, padding: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 600, margin: 0, paddingBottom: 12, borderBottom: `1px solid ${T.dividerBorder}` }}>Reinversión de Inversionistas</h3>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 24 }}>
              <span style={{ fontSize: 14, color: T.text }}>Etapa de Construcción Finalizada</span>
              <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', width: 44, height: 24 }}>
                <input type="checkbox" checked={etapaFinalizada} onChange={e => cambiarEtapaFinalizada(e.target.checked)} aria-label="Etapa de construcción finalizada"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer', zIndex: 1 }} />
                <span style={{ position: 'absolute', inset: 0, background: etapaFinalizada ? T.primary : '#e1e2eb', borderRadius: 999, transition: 'background 0.15s', pointerEvents: 'none' }} />
                <span style={{ position: 'absolute', top: 2, left: etapaFinalizada ? 22 : 2, width: 20, height: 20, background: '#ffffff', borderRadius: '50%', transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)', pointerEvents: 'none' }} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <button disabled={!reinversionHabilitada} style={{
                background: reinversionHabilitada ? T.primary : T.disabledBg,
                color: reinversionHabilitada ? T.onPrimary : T.disabledText,
                border: `1px solid ${reinversionHabilitada ? T.primary : T.disabledBorder}`,
                fontSize: 12, fontWeight: 600, padding: '10px 0', borderRadius: 4,
                cursor: reinversionHabilitada ? 'pointer' : 'not-allowed',
                opacity: reinversionHabilitada ? 1 : 0.5,
              }}>Conversión Total</button>
              <button disabled={!reinversionHabilitada} style={{
                background: reinversionHabilitada ? T.primary : T.disabledBg,
                color: reinversionHabilitada ? T.onPrimary : T.disabledText,
                border: `1px solid ${reinversionHabilitada ? T.primary : T.disabledBorder}`,
                fontSize: 12, fontWeight: 600, padding: '10px 0', borderRadius: 4,
                cursor: reinversionHabilitada ? 'pointer' : 'not-allowed',
                opacity: reinversionHabilitada ? 1 : 0.5,
              }}>Conversión Parcial</button>
            </div>
            <p style={{ fontSize: 11, color: T.textMuted, textAlign: 'center', margin: 0 }}>
              {reinversionHabilitada
                ? 'Habilitado al alcanzar punto de equilibrio con obra en curso.'
                : 'Disponible solo tras alcanzar el punto de equilibrio y antes de finalizar la etapa de construcción.'}
            </p>
          </div>
        </div>
      </div>

      {selectorAbierto && <ProyectoSelectorModal onClose={() => setSelectorAbierto(false)} />}
    </div>
  );
}
