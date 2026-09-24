/**
 * EvaluacionFinancieraPage — /evaluacion-financiera (2026-09-24)
 *
 * Agrupa en una sola vista la evaluación financiera del proyecto activo:
 *   F-06  Montecarlo de VAN/TIR   — POST/GET /api/proyectos/:id/montecarlo
 *   F-11  SROI (restaurado)       — POST /api/proyectos/:id/calcular-sroi · GET .../impacto-social
 *   F-11  Estrés financiero       — POST/GET /api/proyectos/:id/estres-financiero
 *
 * Diseño: no existe pantalla Stitch para esta vista. El dueño autorizó
 * diseñarla heredando el design system aprobado — se reutilizan 1:1 los
 * tokens "Institutional Precision" de ViabilidadFinancieraPage.tsx (misma
 * tarjeta, tipografías, bordes, sombras y botones), sin valores nuevos.
 *
 * AXIOMA COP: todo formateo de moneda usa `cop` (lib/currencyFormat).
 * Campos vacíos NO se envían como 0 (fiscalización architect 2026-09-24):
 * un beneficio vacío que viajara como 0 pasaría la validación y daría un VAN
 * falso — se exige el dato en pantalla antes de llamar al backend.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { http, ApiError } from '../lib/apiClient';
import ProyectoSelectorModal from '../components/ProyectoSelectorModal';
import { cop as COP } from '../lib/currencyFormat';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

// Tokens idénticos a ViabilidadFinancieraPage.tsx (design system aprobado).
const T = {
  bg: '#f7f9fb', card: '#ffffff', cardLow: '#f2f3fc', border: '#e0e3e5', dividerBorder: '#c2c6d5',
  text: '#191b22', textMuted: '#424753', primary: '#0058be', onPrimary: '#ffffff',
  successBg: 'rgba(46,125,50,0.1)', success: '#2e7d32',
  warnBg: '#ffdbcd', warnText: '#7c2e00', warnBorder: '#ffb596',
  error: '#ba1a1a',
  cardShadow: '0px 2px 4px rgba(25,28,30,0.04), 0px 8px 16px rgba(25,28,30,0.06)',
  fontHeadline: "'Hanken Grotesk', sans-serif",
  fontData: "'JetBrains Mono', monospace",
};

const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: T.cardShadow, padding: 20 };
const h3: React.CSSProperties = { fontSize: 20, fontWeight: 600, margin: 0, paddingBottom: 12, borderBottom: `1px solid ${T.dividerBorder}` };
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontFamily: T.fontData, fontSize: 14, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text };
const inputCop: React.CSSProperties = { ...input, padding: '8px 12px 8px 28px' };
const nota: React.CSSProperties = { fontSize: 12, color: T.textMuted, fontStyle: 'italic', margin: '4px 0 0' };
const boxLow: React.CSSProperties = { background: T.cardLow, border: `1px solid ${T.border}`, borderRadius: 4, padding: 12 };
const boton = (activo: boolean): React.CSSProperties => ({ background: T.primary, color: T.onPrimary, fontSize: 12, fontWeight: 600, padding: '10px 24px', borderRadius: 4, border: 'none', cursor: activo ? 'pointer' : 'not-allowed', opacity: activo ? 1 : 0.6 });

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`);

// ── Tipos de respuesta del backend ───────────────────────────────────────────
interface ResultadoMontecarlo {
  moneda: 'COP'; tasa_descuento: number; iteraciones: number; semilla: number; supuesto: string;
  van_escenario_probable_cop: number; tir_escenario_probable: number | null;
  van: { media_cop: number; p10_cop: number; p50_cop: number; p90_cop: number; min_cop: number; max_cop: number };
  probabilidad_van_positivo: number;
  tir: { p10: number | null; p50: number | null; p90: number | null; iteraciones_sin_tir: number };
  histograma_van: Array<{ desde: number; hasta: number; frecuencia: number }>;
}
interface CorridaMontecarlo {
  id: string; inversion_cop: number; inversion_fuente: string; horizonte_anios: number;
  beneficio_min_cop: number; beneficio_probable_cop: number; beneficio_max_cop: number;
  resultado: ResultadoMontecarlo; created_at: string; obsoleta: boolean; inversion_actual_cop: number;
}
interface MontecarloGet { success: boolean; data: CorridaMontecarlo | null; inversion_actual_cop: number }
interface MontecarloPost { success: boolean; data: CorridaMontecarlo }
interface Sroi { inversion_total_cop: string | number; ratio_conversion: string | number; valor_social_generado_cop: string | number; costo_mano_obra_detectado_cop: string | number; empleos_persona_mes_estimados: number; created_at: string }
interface Ods { ods_numero: number; meta_asociada: string; monto_asociado_cop: string | number; porcentaje_contribucion: string | number }
interface ImpactoGet { success: boolean; data: { sroi: Sroi | null; ods: Ods[] } }
interface SroiPost { success: boolean; data: { sroi: Sroi; ods: Ods[] } }
interface Escenario { id: string; nombre_escenario: string; porcentaje_incremento_insumos: string | number; valor_base_cop: string | number; impacto_total_calculado_cop: string | number; viabilidad_resultado: 'VIABLE' | 'EN RIESGO' | 'CRITICO'; observaciones_red_teaming: string; created_at: string }
interface EscenariosGet { success: boolean; data: Escenario[] }

function mensajeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Tu sesión expiró — inicia sesión de nuevo.';
    if (e.status === 404) return 'El proyecto activo ya no existe o no te pertenece.';
    if (e.status === 409) return 'El proyecto está Finalizado — no puede modificarse.';
    return `${e.message} (HTTP ${e.status})`;
  }
  return 'No se pudo conectar con el servidor.';
}

// Convierte un campo de texto a número SIN convertir el vacío en 0.
function numeroONull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function CampoCop({ id, texto, valor, onChange }: { id: string; texto: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} style={label}>{texto}</label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontFamily: T.fontData }}>$</span>
        <input id={id} type="number" min={0} placeholder="0" value={valor} onChange={e => onChange(e.target.value)} style={inputCop} />
      </div>
    </div>
  );
}

function Metrica({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div style={boxLow}>
      <div style={{ fontSize: 12, color: T.textMuted }}>{titulo}</div>
      <div style={{ fontFamily: T.fontData, fontSize: destacado ? 24 : 16, fontWeight: 700, color: destacado ? T.primary : T.text, marginTop: 2 }}>{valor}</div>
    </div>
  );
}

function BadgeViabilidad({ v }: { v: Escenario['viabilidad_resultado'] }) {
  const estilo = v === 'VIABLE'
    ? { background: T.successBg, color: T.success, border: `1px solid ${T.success}` }
    : v === 'EN RIESGO'
      ? { background: T.warnBg, color: T.warnText, border: `1px solid ${T.warnBorder}` }
      : { background: 'rgba(186,26,26,0.08)', color: T.error, border: `1px solid ${T.error}` };
  return <span style={{ ...estilo, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>{v}</span>;
}

export default function EvaluacionFinancieraPage() {
  const [proyectoId, setProyectoId] = useState<string | null>(() => localStorage.getItem(ACTIVE_PROJECT_KEY));
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  useEffect(() => {
    const onStorage = () => setProyectoId(localStorage.getItem(ACTIVE_PROJECT_KEY));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Montecarlo
  const [inversionActual, setInversionActual] = useState(0);
  const [corrida, setCorrida] = useState<CorridaMontecarlo | null>(null);
  const [bMin, setBMin] = useState('');
  const [bProb, setBProb] = useState('');
  const [bMax, setBMax] = useState('');
  const [horizonte, setHorizonte] = useState('');
  const [simulando, setSimulando] = useState(false);
  const simulandoRef = useRef(false);

  // SROI
  const [ratio, setRatio] = useState('');
  const [sroi, setSroi] = useState<Sroi | null>(null);
  const [ods, setOds] = useState<Ods[]>([]);
  const [calculandoSroi, setCalculandoSroi] = useState(false);
  const sroiRef = useRef(false);

  // Estrés
  const [nombreEscenario, setNombreEscenario] = useState('');
  const [porcentaje, setPorcentaje] = useState('');
  const [escenarios, setEscenarios] = useState<Escenario[]>([]);
  const [simulandoEstres, setSimulandoEstres] = useState(false);
  const estresRef = useRef(false);

  const cargar = useCallback(async () => {
    if (!proyectoId) { setCargando(false); return; }
    setCargando(true);
    setError(null);
    try {
      const [mc, imp, esc] = await Promise.all([
        http.get<MontecarloGet>(`/api/proyectos/${proyectoId}/montecarlo`),
        http.get<ImpactoGet>(`/api/proyectos/${proyectoId}/impacto-social`),
        http.get<EscenariosGet>(`/api/proyectos/${proyectoId}/estres-financiero`),
      ]);
      setInversionActual(mc.inversion_actual_cop || 0);
      setCorrida(mc.data);
      if (mc.data) {
        setBMin(String(mc.data.beneficio_min_cop));
        setBProb(String(mc.data.beneficio_probable_cop));
        setBMax(String(mc.data.beneficio_max_cop));
        setHorizonte(String(mc.data.horizonte_anios));
      }
      setSroi(imp.data?.sroi ?? null);
      setOds(imp.data?.ods ?? []);
      if (imp.data?.sroi) setRatio(String(Number(imp.data.sroi.ratio_conversion)));
      setEscenarios(esc.data ?? []);
    } catch (e) {
      console.error('[EvaluacionFinanciera] Error cargando:', e);
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

  const simular = async () => {
    if (!proyectoId) { setSelectorAbierto(true); return; }
    if (simulandoRef.current) return;
    const min = numeroONull(bMin), prob = numeroONull(bProb), max = numeroONull(bMax), n = numeroONull(horizonte);
    if (min === null || prob === null || max === null || n === null) {
      setError('Completa los tres valores de beneficio anual (COP) y el horizonte en años antes de simular.');
      return;
    }
    simulandoRef.current = true;
    setSimulando(true);
    setError(null);
    try {
      const r = await http.post<MontecarloPost>(`/api/proyectos/${proyectoId}/montecarlo`, {
        beneficioMin: min, beneficioProbable: prob, beneficioMax: max, horizonteAnios: n,
      });
      setCorrida(r.data);
      setInversionActual(r.data.inversion_actual_cop);
    } catch (e) {
      console.error('[EvaluacionFinanciera] Error simulando:', e);
      setError(mensajeError(e));
    } finally {
      simulandoRef.current = false;
      setSimulando(false);
    }
  };

  const calcularSroi = async () => {
    if (!proyectoId) { setSelectorAbierto(true); return; }
    if (sroiRef.current) return;
    const r = numeroONull(ratio);
    if (r === null || r <= 0) { setError('Indica el ratio de conversión (COP de valor social por cada COP invertido), mayor que 0.'); return; }
    sroiRef.current = true;
    setCalculandoSroi(true);
    setError(null);
    try {
      const res = await http.post<SroiPost>(`/api/proyectos/${proyectoId}/calcular-sroi`, { ratioConversion: r });
      setSroi(res.data.sroi);
      setOds(res.data.ods ?? []);
    } catch (e) {
      console.error('[EvaluacionFinanciera] Error SROI:', e);
      setError(mensajeError(e));
    } finally {
      sroiRef.current = false;
      setCalculandoSroi(false);
    }
  };

  const simularEstres = async () => {
    if (!proyectoId) { setSelectorAbierto(true); return; }
    if (estresRef.current) return;
    const p = numeroONull(porcentaje);
    if (!nombreEscenario.trim() || p === null || p < 0) { setError('Indica el nombre del escenario y el % de incremento (≥ 0).'); return; }
    estresRef.current = true;
    setSimulandoEstres(true);
    setError(null);
    try {
      await http.post(`/api/proyectos/${proyectoId}/estres-financiero`, { nombreEscenario: nombreEscenario.trim(), porcentajeIncremento: p });
      const esc = await http.get<EscenariosGet>(`/api/proyectos/${proyectoId}/estres-financiero`);
      setEscenarios(esc.data ?? []);
      setNombreEscenario('');
      setPorcentaje('');
    } catch (e) {
      console.error('[EvaluacionFinanciera] Error estrés:', e);
      setError(mensajeError(e));
    } finally {
      estresRef.current = false;
      setSimulandoEstres(false);
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

  const res = corrida?.resultado;
  const histograma = (res?.histograma_van ?? []).map(h => ({ rango: COP.format((h.desde + h.hasta) / 2), frecuencia: h.frecuencia }));

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.fontHeadline, minHeight: 'calc(100vh - 48px)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>Evaluación Financiera</h1>
          <p style={{ margin: '4px 0 0', fontSize: 18, color: T.textMuted }}>VAN y TIR con simulación Montecarlo, SROI y estrés financiero (COP)</p>
        </div>
        <button onClick={() => setSelectorAbierto(true)} style={{ fontSize: 12, color: T.primary, background: 'rgba(0,88,190,0.08)', border: `1px solid ${T.primary}33`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Cambiar proyecto
        </button>
      </div>

      {error && <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">{error}</div>}
      {cargando && <div style={{ fontSize: 12.5, color: T.textMuted }}>Cargando…</div>}

      {/* ── F-06: Montecarlo VAN/TIR ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div style={card}>
          <h3 style={h3}>Simulación Montecarlo</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
            <div style={{ ...boxLow, padding: 16 }}>
              <span style={label}>Inversión Inicial</span>
              <div style={{ fontFamily: T.fontData, fontSize: 28, fontWeight: 700 }}>{COP.format(inversionActual)}</div>
              <p style={nota}>{inversionActual > 0
                ? 'Tomada automáticamente del presupuesto APU real adjunto en Anexos.'
                : 'Sin presupuesto APU: sube tu presupuesto en Anexos para poder simular.'}</p>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Beneficios / Ahorros Anuales (COP)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
              <CampoCop id="mc-min" texto="Mínimo" valor={bMin} onChange={setBMin} />
              <CampoCop id="mc-prob" texto="Probable" valor={bProb} onChange={setBProb} />
              <CampoCop id="mc-max" texto="Máximo" valor={bMax} onChange={setBMax} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div>
                <label htmlFor="mc-horizonte" style={label}>Horizonte (años)</label>
                <input id="mc-horizonte" type="number" min={1} max={50} step={1} placeholder="1 – 50" value={horizonte} onChange={e => setHorizonte(e.target.value)} style={input} />
              </div>
              <div>
                <span style={label}>Tasa de descuento</span>
                <div style={{ ...input, background: T.cardLow }}>12 % <span style={{ fontFamily: T.fontHeadline, fontSize: 12, color: T.textMuted }}>(tasa social)</span></div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={simular} disabled={simulando || inversionActual <= 0} style={boton(!simulando && inversionActual > 0)}>
                {simulando ? 'Simulando…' : 'Simular VAN / TIR'}
              </button>
            </div>
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...h3 }}>
            <span>Resultado</span>
            {res && (res.probabilidad_van_positivo >= 0.5
              ? <span style={{ background: T.successBg, color: T.success, border: `1px solid ${T.success}`, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999 }}>Rentable {pct(res.probabilidad_van_positivo)}</span>
              : <span style={{ background: T.warnBg, color: T.warnText, border: `1px solid ${T.warnBorder}`, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999 }}>Rentable {pct(res.probabilidad_van_positivo)}</span>)}
          </div>
          {corrida?.obsoleta && (
            <div style={{ background: T.warnBg, color: T.warnText, border: `1px solid ${T.warnBorder}`, borderRadius: 4, padding: '8px 12px', fontSize: 12.5, marginTop: 12 }} role="status">
              El presupuesto cambió desde esta simulación ({COP.format(corrida.inversion_cop)} → {COP.format(corrida.inversion_actual_cop)}). Vuelve a simular.
            </div>
          )}
          {res ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <Metrica titulo="VAN mediano (P50)" valor={COP.format(res.van.p50_cop)} destacado />
                <Metrica titulo="TIR mediana (P50)" valor={pct(res.tir.p50)} destacado />
                <Metrica titulo="VAN rango P10 – P90" valor={`${COP.format(res.van.p10_cop)} – ${COP.format(res.van.p90_cop)}`} />
                <Metrica titulo="TIR rango P10 – P90" valor={`${pct(res.tir.p10)} – ${pct(res.tir.p90)}`} />
                <Metrica titulo="VAN escenario probable (determinista)" valor={COP.format(res.van_escenario_probable_cop)} />
                <Metrica titulo="VAN media simulada" valor={COP.format(res.van.media_cop)} />
              </div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histograma} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                    <XAxis dataKey="rango" tick={false} label={{ value: 'Distribución del VAN (COP)', position: 'insideBottom', fontSize: 12, fill: T.textMuted }} />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <Tooltip formatter={(v) => [`${v} iteraciones`, 'Frecuencia']} labelFormatter={(l) => `VAN ≈ ${l}`} />
                    <Bar dataKey="frecuencia" fill={T.primary} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p style={{ ...nota, fontStyle: 'normal' }}>
                {res.iteraciones.toLocaleString('es-CO')} iteraciones · distribución triangular por año (independiente) · horizonte {corrida?.horizonte_anios} años · tasa 12 % · semilla {res.semilla}
                {res.tir.iteraciones_sin_tir > 0 && ` · ${res.tir.iteraciones_sin_tir} iteraciones sin TIR definida`}
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: T.textMuted, marginTop: 16 }}>Ingresa los beneficios anuales y el horizonte, y simula para ver la distribución real del VAN y la TIR.</p>
          )}
        </div>
      </div>

      {/* ── F-11: SROI y Estrés financiero ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div style={card}>
          <h3 style={h3}>Retorno Social (SROI)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
            <div>
              <label htmlFor="sroi-ratio" style={label}>Ratio de conversión (COP de valor social por cada COP invertido)</label>
              <input id="sroi-ratio" type="number" min={0} step="0.01" placeholder="Según tus estudios o lineamientos" value={ratio} onChange={e => setRatio(e.target.value)} style={input} />
              <p style={nota}>Sin valor por defecto: debe salir de tus propios estudios.</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={calcularSroi} disabled={calculandoSroi} style={boton(!calculandoSroi)}>{calculandoSroi ? 'Calculando…' : 'Calcular SROI'}</button>
            </div>
            {sroi ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  <Metrica titulo="Valor social generado" valor={COP.format(Number(sroi.valor_social_generado_cop))} destacado />
                  <Metrica titulo="Inversión total" valor={COP.format(Number(sroi.inversion_total_cop))} />
                  <Metrica titulo="Mano de obra detectada" valor={COP.format(Number(sroi.costo_mano_obra_detectado_cop))} />
                  <Metrica titulo="Empleo estimado" valor={`${sroi.empleos_persona_mes_estimados} persona-mes`} />
                </div>
                {ods.length > 0 && (
                  <div style={boxLow}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Contribución a ODS</div>
                    {ods.map(o => (
                      <div key={o.ods_numero} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                        <span>ODS {o.ods_numero} · {o.meta_asociada}</span>
                        <span style={{ fontFamily: T.fontData }}>{Number(o.porcentaje_contribucion).toLocaleString('es-CO')} %</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: 12.5, color: T.textMuted, margin: 0 }}>Aún no se ha calculado el SROI de este proyecto.</p>
            )}
          </div>
        </div>

        <div style={card}>
          <h3 style={h3}>Estrés Financiero</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div>
                <label htmlFor="estres-nombre" style={label}>Escenario</label>
                <input id="estres-nombre" type="text" maxLength={200} placeholder="Ej. Alza del SMMLV" value={nombreEscenario} onChange={e => setNombreEscenario(e.target.value)} style={{ ...input, fontFamily: T.fontHeadline }} />
              </div>
              <div>
                <label htmlFor="estres-pct" style={label}>Incremento (%)</label>
                <input id="estres-pct" type="number" min={0} step="0.1" placeholder="0" value={porcentaje} onChange={e => setPorcentaje(e.target.value)} style={input} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={simularEstres} disabled={simulandoEstres} style={boton(!simulandoEstres)}>{simulandoEstres ? 'Simulando…' : 'Simular escenario'}</button>
            </div>
            {escenarios.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {escenarios.map(e => (
                  <div key={e.id} style={boxLow}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{e.nombre_escenario} · +{Number(e.porcentaje_incremento_insumos).toLocaleString('es-CO')} %</span>
                      <BadgeViabilidad v={e.viabilidad_resultado} />
                    </div>
                    <div style={{ fontFamily: T.fontData, fontSize: 13, marginTop: 4 }}>Sobrecosto {COP.format(Number(e.impacto_total_calculado_cop))} sobre {COP.format(Number(e.valor_base_cop))}</div>
                    <p style={{ fontSize: 12, color: T.textMuted, margin: '4px 0 0' }}>{e.observaciones_red_teaming}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 12.5, color: T.textMuted, margin: 0 }}>Aún no hay escenarios simulados.</p>
            )}
          </div>
        </div>
      </div>

      {selectorAbierto && <ProyectoSelectorModal onClose={() => setSelectorAbierto(false)} />}
    </div>
  );
}
