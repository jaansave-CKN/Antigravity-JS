import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { http, ApiError } from '../lib/apiClient';

/**
 * FichaTecnicaPage — Resumen consolidado de todo lo entregado en Entrada,
 * Contexto, Motor Dialéctico, Logística y Anexos, listo para iniciar la
 * formulación. El sello se genera server-side (POST /api/m12/ficha/:proyectoId)
 * — el servidor recopila motor_dialectico/compliance/marco_normativo/
 * config_logistica reales, calcula el hash SHA-256 e inserta la versión
 * inmutable en versiones_proyecto, marcando el proyecto como Finalizado.
 *
 * Tokens fuente: EntradaPage.css — bg #f7f9fb · card #ffffff · border #e0e3e5
 * · text #191c1e · primary #0058be · Manrope.
 */

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

interface EntradaState {
  nombre: string; enfoque: string; tipoConvocatoria: string;
  nivelProyecto: string; metodologias: string[]; formatoFinanciador: string;
  numeroBeneficiarios: string; coberturaGeografica: string;
  sectores: string[]; municipio: string; vereda: string;
}
interface ContextoState { [k: string]: string }
interface DialecticaState { selecciones: Record<string, string>; adicionales: string[] }
interface Tramo { origen: string; destino: string; duracion: string; medio?: string }
interface LogisticaState { tramos: Tramo[]; observaciones: string }
interface Soporte { descripcion: string; texto: string; anexo: string; link: string }
interface Sello { hash: string; version: number; firmado_en: string }
interface FichaApiResponse {
  success: boolean;
  message?: string;
  data?: { id: string; version_num: number; hash_sha256: string; contenido_resumido: string; firmado_en: string; sello: unknown };
}
interface FichaHistorialResponse {
  success: boolean;
  data?: Array<{ version_num: number; hash_sha256: string; firmado_en: string }>;
}

const CONTEXTO_LABELS: Record<string, string> = {
  A_diagnostico: 'Diagnóstico del Problema',
  B_kpis: 'Indicadores Clave (KPIs)',
  C_meta: 'Meta SMART',
  D_alineacion: 'Alineación Estratégica / Teoría del Cambio',
  E_pertinencia: 'Pertinencia y Gobernanza Local',
  F_priorizacion: 'Priorización Crítica',
  G_logistica: 'Viabilidad Logística',
};

const DIALECTICA_LABELS: Record<string, string> = {
  interlocutor: 'Interlocutor', tono: 'Tono', enfoque: 'Enfoque', humanizacion: 'Humanización',
};

// ── Tokens calco — sistema de diseño "azul ideal / ProForma Institutional"
// (Stitch, mismo usado por Entrada/Anexos/Dialéctica/Logística) ────────────
const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.50)', textHint: 'rgba(25,28,30,0.45)',
  primary: '#0058be', primarySoft: 'rgba(0,88,190,0.10)', primaryBorder: 'rgba(0,88,190,0.30)',
  secondaryBg: '#dae2fd', secondaryText: '#565e74',
  success: '#15803d', successSoft: 'rgba(21,128,61,0.08)', successBorder: 'rgba(21,128,61,0.30)',
  font: "'Manrope', sans-serif",
};

function Section({ badge, title, hint, children }: { badge: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{
          width: 24, height: 24, borderRadius: 9999, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: T.primarySoft, border: `1px solid ${T.primaryBorder}`,
          color: T.primary, fontSize: 10.5, fontWeight: 700, fontFamily: "'Inter', sans-serif",
        }}>{badge}</span>
        <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 700, color: T.primary, letterSpacing: '0.01em' }}>
          {title}
        </h2>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 11, color: T.textHint }}>{hint}</p>
      {children}
    </div>
  );
}

function Campo({ label, value }: { label: string; value: string | number }) {
  const vacio = value === '' || value === null || value === undefined;
  return (
    <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '10px 14px' }}>
      <p style={{ margin: '0 0 3px', fontSize: 9.5, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 13, color: vacio ? T.textHint : T.text, fontStyle: vacio ? 'italic' : 'normal', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {vacio ? 'Sin definir' : value}
      </p>
    </div>
  );
}

/** Campo de selección única (capítulos 1–3 de Entrada / Motor Dialéctico):
 * se representa como un chip sólido, distinto de las etiquetas multivalor,
 * para dejar visualmente claro que solo admite una opción elegida. */
function ChipUnico({ label, value }: { label: string; value: string }) {
  const vacio = !value;
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 9.5, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 9999,
        background: vacio ? T.bg : T.primarySoft,
        border: `1.5px solid ${vacio ? T.border : T.primary}`,
        fontSize: 12.5, fontWeight: 700, color: vacio ? T.textHint : T.primary,
        fontStyle: vacio ? 'italic' : 'normal', maxWidth: '100%',
      }}>
        {!vacio && <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.primary, flexShrink: 0 }} />}
        {vacio ? 'Sin seleccionar' : value}
      </span>
    </div>
  );
}

/** Lista de etiquetas multivalor (p. ej. Sectores) — deliberadamente más
 * ligera que ChipUnico para no confundirse con un campo de opción única. */
function TagList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 9.5, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      {values.length === 0 ? (
        <span style={{ fontSize: 12.5, color: T.textHint, fontStyle: 'italic' }}>Sin definir</span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {values.map(v => (
            <span key={v} style={{
              padding: '4px 10px', borderRadius: 4,
              background: T.secondaryBg, color: T.secondaryText,
              fontSize: 11.5, fontWeight: 600,
            }}>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FichaTecnicaPage() {
  const navigate = useNavigate();
  const [sello, setSello] = useState<Sello | null>(null);
  const [sellando, setSellando] = useState(false);
  const [cargandoHistorial, setCargandoHistorial] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);

  const entrada    = useMemo(() => readJSON<EntradaState>('radar360_entrada_m1'), []);
  const contexto   = useMemo(() => readJSON<ContextoState>('radar360_contexto_problema'), []);
  const dialectica = useMemo(() => readJSON<DialecticaState>('radar360_dialectica_config'), []);
  const logistica  = useMemo(() => readJSON<LogisticaState>('radar360_logistica_tramos'), []);
  const anexos     = useMemo(() => readJSON<Soporte[]>('radar360_anexos_calco') || [], []);

  const anexosValidos = anexos.filter(s => s.descripcion && (s.anexo || s.link));
  const tramosValidos = (logistica?.tramos || []).filter(t => t.origen && t.destino && t.duracion);

  const listoParaFormular =
    !!proyectoId && !!entrada?.nombre && !!entrada?.formatoFinanciador &&
    !!contexto?.A_diagnostico && !!dialectica?.selecciones?.interlocutor;

  // Carga el sello ya sellado (si existe) desde el historial real del servidor.
  useEffect(() => {
    let cancelled = false;
    if (!proyectoId) { setCargandoHistorial(false); return; }
    (async () => {
      try {
        const body = await http.get<FichaHistorialResponse>(`/api/m12/ficha/${proyectoId}`);
        const ultima = body.data?.[0];
        if (!cancelled && ultima) {
          setSello({ hash: ultima.hash_sha256, version: ultima.version_num, firmado_en: ultima.firmado_en });
        }
      } catch {
        // Sin historial previo o error de red — se trata igual que "aún no sellado".
      } finally {
        if (!cancelled) setCargandoHistorial(false);
      }
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  const generarFicha = async () => {
    if (!proyectoId) {
      setError('No hay un proyecto activo — vuelve a Entrada y crea/selecciona un proyecto primero.');
      return;
    }
    setSellando(true);
    setError(null);
    try {
      const body = await http.post<FichaApiResponse>(`/api/m12/ficha/${proyectoId}`);
      if (!body.data) throw new Error(body.message || 'El servidor no devolvió el sello');
      setSello({ hash: body.data.hash_sha256, version: body.data.version_num, firmado_en: body.data.firmado_en });
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'PROYECTO_BLOQUEADO'
        ? 'El proyecto está bloqueado — resuelve los errores de validación antes de sellar la Ficha Técnica.'
        : e instanceof Error ? e.message : 'Error al generar la Ficha Técnica';
      setError(msg);
    } finally {
      setSellando(false);
    }
  };

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.font, minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: T.card, borderBottom: `1px solid ${T.border}`,
        height: 72, padding: '0 32px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: T.text, margin: 0, letterSpacing: '-0.02em' }}>
          Ficha Técnica
        </h1>
        {cargandoHistorial ? (
          <span style={{ fontSize: 12, color: T.textHint }}>Consultando historial…</span>
        ) : sello ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.successSoft, border: `1px solid ${T.successBorder}`, borderRadius: 9999, padding: '7px 16px' }}>
            <span style={{ fontSize: 13 }}>🔒</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.success }}>
              Sellada · v{sello.version} · {sello.hash.slice(0, 12)}…
            </span>
          </div>
        ) : (
          <button
            onClick={generarFicha}
            disabled={!listoParaFormular || sellando}
            title={listoParaFormular ? 'Genera el sello en el servidor a partir de los datos actuales' : (!proyectoId ? 'No hay proyecto activo — completa Entrada primero' : 'Completa al menos Entrada, Contexto y Motor Dialéctico')}
            style={{
              padding: '10px 22px', background: listoParaFormular ? T.primary : T.border,
              border: 'none', borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 700,
              cursor: listoParaFormular && !sellando ? 'pointer' : 'not-allowed', letterSpacing: '0.04em', fontFamily: T.font,
            }}
          >
            {sellando ? 'Generando…' : 'Generar Ficha Técnica'}
          </button>
        )}
      </div>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

        <p style={{ margin: 0, fontSize: 12, color: T.textHint, maxWidth: 640 }}>
          Este es el resumen de todo lo entregado en Entrada, Contexto, Motor Dialéctico, Logística y Anexos —
          la base con la que la app inicia la formulación del proyecto.
        </p>

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#b91c1c' }} role="alert">
            {error}
          </div>
        )}

        {/* ── 01 Entrada ───────────────────────────────────────────────── */}
        <Section badge="01" title="Entrada" hint="Datos generales, tipo de proyecto, financiación, nivel y metodologías.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <Campo label="Nombre del Proyecto" value={entrada?.nombre || ''} />
            <Campo label="Municipio" value={entrada?.municipio || ''} />
            <Campo label="Número de Beneficiarios" value={entrada?.numeroBeneficiarios || ''} />
            <Campo label="Cobertura Geográfica" value={entrada?.coberturaGeografica || ''} />
          </div>

          <p style={{ margin: '18px 0 12px', fontSize: 9.5, fontWeight: 700, color: T.primary, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Capítulos 1, 2, 3 y 5 · selección única
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
            <ChipUnico label="1 · Tipo de Proyecto" value={entrada?.enfoque || ''} />
            <ChipUnico label="2 · Fuente de Financiación" value={entrada?.tipoConvocatoria || ''} />
            <ChipUnico label="3 · Nivel del Proyecto" value={entrada?.nivelProyecto || ''} />
            <ChipUnico label="5 · Formato del Financiador" value={entrada?.formatoFinanciador || ''} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <TagList label="4 · Metodologías (selección múltiple)" values={entrada?.metodologias || []} />
            <TagList label="7 · Sectores (selección múltiple)" values={entrada?.sectores || []} />
          </div>
        </Section>

        {/* ── 02 Contexto ──────────────────────────────────────────────── */}
        <Section badge="02" title="Contexto y Diagnóstico" hint="Diagnóstico, KPIs, meta SMART y teoría del cambio.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(CONTEXTO_LABELS).map(([k, label]) => (
              <Campo key={k} label={label} value={contexto?.[k] || ''} />
            ))}
          </div>
        </Section>

        {/* ── 03 Motor Dialéctico ──────────────────────────────────────── */}
        <Section badge="03" title="Motor Dialéctico" hint="Interlocutor, tono, enfoque y humanización del documento — cada categoría admite una sola opción.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            {Object.entries(DIALECTICA_LABELS).map(([k, label]) => (
              <ChipUnico key={k} label={label} value={dialectica?.selecciones?.[k] || ''} />
            ))}
          </div>
        </Section>

        {/* ── 04 Logística ─────────────────────────────────────────────── */}
        <Section badge="04" title="Logística" hint="Tramos de ejecución registrados y observaciones.">
          {tramosValidos.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: T.textHint, fontStyle: 'italic' }}>Sin tramos registrados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tramosValidos.map((t, i) => (
                <div key={i} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '9px 14px', fontSize: 12.5, color: T.text }}>
                  <strong>{t.origen}</strong> → <strong>{t.destino}</strong> · {t.duracion}{t.medio ? ` · ${t.medio}` : ''}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── 05 Anexos ────────────────────────────────────────────────── */}
        <Section badge="05" title="Anexos" hint="Soportes documentales y enlaces de respaldo.">
          {anexosValidos.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: T.textHint, fontStyle: 'italic' }}>Sin soportes cargados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {anexosValidos.map((s, i) => (
                <div key={i} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '9px 14px', fontSize: 12.5, color: T.text, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>{s.descripcion}</span>
                  <span style={{ color: T.textMuted, fontSize: 11 }}>{s.anexo || s.link}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {sello && (
          <div style={{ background: T.successSoft, border: `1px solid ${T.successBorder}`, borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: 12.5, color: T.success }}>
              🔒 Ficha sellada el {new Date(sello.firmado_en).toLocaleString('es-CO')} · Hash SHA-256 completo: <code style={{ fontSize: 11 }}>{sello.hash}</code>
            </p>
            <button
              onClick={() => navigate('/checklist')}
              style={{ padding: '7px 14px', background: T.success, border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              Ver Check-List
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
