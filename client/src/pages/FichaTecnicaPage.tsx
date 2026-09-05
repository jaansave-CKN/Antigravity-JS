import { useEffect, useMemo, useState } from 'react';
import { http, getAuthHeaders } from '../lib/apiClient';

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

interface ProblematicaOpcion { problema: string; deficit_valor: number | null; deficit_unidad: string | null }
interface ContextoMetaState { problematicas: ProblematicaOpcion[]; problemaSeleccionado: string; beneficiarios: string; tipoFormulacion: string }
interface EntradaState {
  nombre: string; enfoque: string; tipoConvocatoria: string;
  nivelProyecto: string; metodologias: string[]; formatoFinanciador: string;
  numeroBeneficiarios: string; coberturaGeografica: string;
  sectores: string[]; municipio: string; vereda: string;
  // MANDATO (2026-08-23, corrección de arquitectura confirmada con el
  // usuario): el "Contexto y Diagnóstico" real del proyecto vive AQUÍ
  // (Sección "Contexto del Problema" de EntradaPage: A-G + Campo C), no en
  // ficha_tecnica.contexto_narrativo (ContextoPage/"/contexto") — esa página
  // es legacy, confirmado explícitamente, nunca se llena, y por eso la
  // Sección 02 de Ficha Técnica SIEMPRE mostraba "Sin definir" pese a tener
  // contenido real acá.
  contexto: Record<string, string>;
  contextoMeta: ContextoMetaState;
}
interface DialecticaState { selecciones: Record<string, string>; adicionales: string[] }
interface Tramo { origen: string; destino: string; duracion: string; medio?: string }
interface LogisticaState { tramos: Tramo[]; observaciones: string }
interface Soporte { descripcion: string; texto: string; anexo: string; link: string }

// FIX (2026-08-23, auditoría real con evidencia — ver hallazgo del usuario):
// esta página leía TODO (Entrada/Contexto/Dialéctica/Logística/Anexos) desde
// localStorage bajo claves legacy, calculadas UNA vez con useMemo(..., []) y
// nunca refrescadas. "radar360_anexos_calco" en particular es la clave de
// CACHÉ LOCAL de AnexosCalcoView.tsx (componente real detrás de
// AnexosPage.tsx — CORRECCIÓN 2026-08-24: no es huérfano, AnexosPage.tsx
// hace `return <AnexosCalcoView />`; la afirmación anterior de "componente
// no ruteado" era incorrecta) — pero esa clave solo guarda un borrador
// offline/pre-login, la fuente real con proyecto activo es siempre
// project_anexos vía /api/proyectos/:id/anexos, nunca ese localStorage. Por
// eso la Sección 05 SIEMPRE mostraba "Sin soportes cargados" sin importar
// cuántos anexos reales hubiera (verificado en vivo: 5 anexos reales en BD
// para el proyecto de prueba,
// contra 0 mostrados en pantalla). Mismo problema con "Nombre del Proyecto"
// (entrada.nombre nunca se llena — el nombre real vive en la columna
// proyectos.nombre, no en el estado local de EntradaPage) y con Contexto
// (si el usuario llenó/guardó Contexto en otro navegador/pestaña, o si el
// caché local se perdió, esta página no tenía forma de recuperarlo del
// servidor). Reemplazado por fetch real a las MISMAS fuentes de verdad que
// ya usan Entrada/Contexto/Dialéctica/Logística/Anexos — nada de localStorage.
interface ProyectoApiResponse {
  success: boolean;
  data?: { nombre: string; ficha_tecnica?: { entrada_completa?: Partial<EntradaState> } };
}
interface MotorDialecticoApiResp {
  success: boolean;
  data?: { tono?: string; interlocutor?: string; enfoque?: string; humanizacion?: string };
}
interface TramoApi { origen: string; destino: string; duracion: string; medio?: string }
interface LogisticaApiResp { success: boolean; data?: TramoApi[] }
interface AnexoApi { descripcion?: string; nombre_archivo?: string; link?: string }
interface AnexosApiResp { success: boolean; data?: AnexoApi[] }
interface ResumenRaci {
  totalTareas: number; totalRoles: number; totalAsignaciones: number; celdasPosibles: number; porcentajeCompletitud: number;
  tareasSinA: { id: string; nombre: string }[]; tareasConMultiplesA: { id: string; nombre: string }[];
  tareasSinR: { id: string; nombre: string }[]; rolesSinAsignacion: { id: string; nombre: string }[];
}
interface RaciResumenApiResp { success: boolean; data?: ResumenRaci }

// Mismos ids/labels que CONTEXTO_CAMPOS en EntradaPage.tsx (A,B,D,E,F,G — C
// se maneja aparte, es un objeto estructurado, no un string plano).
const CONTEXTO_LABELS: Record<string, string> = {
  situacion_actual: 'A. Situación Actual sin Proyecto',
  linea_base: 'B. Indicador de Línea Base Cuantificable',
  justificacion: 'D. Justificación de Prioridad',
  sociocultural: 'E. Análisis Sociocultural para la Pertinencia',
  problema_urgente: 'F. ¿Qué Problema Percibe como Más Urgente?',
  incertidumbre: 'G. Condición Crítica de Incertidumbre Logística',
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

// MANDATO (2026-08-23, "que se vea como un proyecto formulado, no como un
// copy-paste de la página"): estos 3 componentes se rediseñaron de "controles
// de formulario" (cajas grises con borde, píldoras con punto de color) a
// "campos de documento" — etiqueta pequeña en mayúsculas + valor en texto
// limpio sobre una regla inferior fina, sin fondo ni borde de caja. Mismo
// lenguaje visual en los tres para que toda la ficha se lea como un solo
// documento formal, no como una pantalla de app. Sin fuente Stitch propia
// (comportamiento visual pedido en chat, no en el snapshot) — reutiliza los
// mismos tokens T.* ya existentes, solo cambia la composición.
function Campo({ label, value }: { label: string; value: string | number }) {
  const vacio = value === '' || value === null || value === undefined;
  return (
    <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 10 }}>
      <p style={{ margin: '0 0 4px', fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: vacio ? T.textHint : T.text, fontStyle: vacio ? 'italic' : 'normal', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {vacio ? 'Sin definir' : value}
      </p>
    </div>
  );
}

/** Campo de selección única (capítulos 1–3 de Entrada / Motor Dialéctico) —
 * mismo lenguaje de "campo de documento" que Campo, con el valor en azul
 * institucional para distinguir visualmente una categoría elegida de un
 * texto libre, sin recurrir a una píldora de botón. */
function ChipUnico({ label, value }: { label: string; value: string }) {
  const vacio = !value;
  return (
    <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 10 }}>
      <p style={{ margin: '0 0 4px', fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: vacio ? T.textHint : T.primary, fontStyle: vacio ? 'italic' : 'normal' }}>
        {vacio ? 'Sin seleccionar' : value}
      </p>
    </div>
  );
}

/** Lista de etiquetas multivalor (p. ej. Sectores) — se listan como texto
 * corrido separado por punto medio, como leería un documento impreso, en
 * vez de chips de color sólido. */
function TagList({ label, values }: { label: string; values: string[] }) {
  return (
    <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 10 }}>
      <p style={{ margin: '0 0 4px', fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: values.length === 0 ? T.textHint : T.text, fontStyle: values.length === 0 ? 'italic' : 'normal', lineHeight: 1.6 }}>
        {values.length === 0 ? 'Sin definir' : values.join('  ·  ')}
      </p>
    </div>
  );
}

export default function FichaTecnicaPage() {
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);

  const [nombreProyecto, setNombreProyecto] = useState('');
  const [entrada, setEntrada]       = useState<Partial<EntradaState> | null>(null);
  const [dialectica, setDialectica] = useState<DialecticaState | null>(null);
  const [logistica, setLogistica]   = useState<LogisticaState | null>(null);
  const [anexos, setAnexos]         = useState<Soporte[]>([]);
  const [raciResumen, setRaciResumen] = useState<ResumenRaci | null>(null);

  const anexosValidos = anexos.filter(s => s.descripcion && (s.anexo || s.link));
  const tramosValidos = (logistica?.tramos || []).filter(t => t.origen && t.destino && t.duracion);

  // MANDATO (2026-08-24, "el botón no audita no revisa, solo genera un PDF
  // con la información completa de todos los campos, si hay un campo vacío
  // no puede generar el documento"): reemplaza el gate legal (F-Legal-01,
  // riesgo jurídico) por un gate de COMPLETITUD puro sobre las 5 secciones
  // que el propio resumen muestra — ni más ni menos. El sello SHA-256/
  // M12 sigue existiendo en el backend para quien lo necesite, pero este
  // botón ya no lo toca en absoluto.
  const entradaCompleta = !!nombreProyecto && !!entrada?.municipio && !!entrada?.numeroBeneficiarios && !!entrada?.coberturaGeografica
    && !!entrada?.enfoque && !!entrada?.tipoConvocatoria && !!entrada?.nivelProyecto && !!entrada?.formatoFinanciador
    && (entrada?.metodologias?.length || 0) > 0 && (entrada?.sectores?.length || 0) > 0;
  const contextoCompleto = !!entrada?.contextoMeta?.problemaSeleccionado && !!entrada?.contextoMeta?.beneficiarios && !!entrada?.contextoMeta?.tipoFormulacion
    && Object.keys(CONTEXTO_LABELS).every(id => !!entrada?.contexto?.[id]?.trim());
  const dialecticaCompleta = !!dialectica?.selecciones?.interlocutor && !!dialectica?.selecciones?.tono
    && !!dialectica?.selecciones?.enfoque && !!dialectica?.selecciones?.humanizacion;
  const logisticaCompleta = tramosValidos.length > 0;
  const anexosCompletos = anexosValidos.length > 0;
  const raciCompleta = !!raciResumen && raciResumen.totalTareas > 0 && raciResumen.totalRoles > 0;

  const listoParaGenerarPDF = !!proyectoId && entradaCompleta && contextoCompleto && dialecticaCompleta && logisticaCompleta && anexosCompletos && raciCompleta;

  // Carga real desde el servidor — reemplaza las 5 lecturas de localStorage
  // que había antes (ver nota junto a las interfaces de arriba). Fuentes:
  // GET /api/proyectos/:id (nombre real + ficha_tecnica.entrada_completa,
  // que incluye contexto/contextoMeta — el Contexto del Problema REAL),
  // /api/m4/config/:id (DialecticaPage), /api/proyectos/:id/logistica-tramos
  // (LogisticaPage), /api/proyectos/:id/anexos (AnexosPage, la página REAL).
  // Peticiones en paralelo e independientes (Promise.allSettled): si UNA
  // falla, las demás secciones igual muestran sus datos reales — no todo o
  // nada. Sin fallback a localStorage a propósito: mostrar "no disponible"
  // es más honesto que reintroducir el dato viejo/desconectado que causó
  // este bug.
  useEffect(() => {
    if (!proyectoId) { setCargandoDatos(false); return; }
    let cancelled = false;
    (async () => {
      const [proyectoR, dialecticaR, logisticaR, anexosR, raciR] = await Promise.allSettled([
        http.get<ProyectoApiResponse>(`/api/proyectos/${proyectoId}`),
        http.get<MotorDialecticoApiResp>(`/api/m4/config/${proyectoId}`),
        http.get<LogisticaApiResp>(`/api/proyectos/${proyectoId}/logistica-tramos`),
        http.get<AnexosApiResp>(`/api/proyectos/${proyectoId}/anexos`),
        http.get<RaciResumenApiResp>(`/api/proyectos/${proyectoId}/raci/resumen`),
      ]);
      if (cancelled) return;

      if (proyectoR.status === 'fulfilled') {
        const d = proyectoR.value.data;
        setNombreProyecto(d?.nombre || '');
        setEntrada(d?.ficha_tecnica?.entrada_completa || null);
      } else {
        setError('No se pudo cargar Entrada/Contexto del proyecto — intenta recargar la página.');
      }

      if (dialecticaR.status === 'fulfilled') {
        const row = dialecticaR.value.data;
        if (row) setDialectica({ selecciones: { tono: row.tono || '', interlocutor: row.interlocutor || '', enfoque: row.enfoque || '', humanizacion: row.humanizacion || '' }, adicionales: [] });
      }

      if (logisticaR.status === 'fulfilled') {
        const rows = logisticaR.value.data || [];
        setLogistica({ tramos: rows.map(t => ({ origen: t.origen, destino: t.destino, duracion: t.duracion, medio: t.medio })), observaciones: '' });
      }

      if (anexosR.status === 'fulfilled') {
        const rows = anexosR.value.data || [];
        setAnexos(rows.map(a => ({ descripcion: a.descripcion || a.nombre_archivo || '', texto: '', anexo: a.nombre_archivo || '', link: a.link || '' })));
      }

      if (raciR.status === 'fulfilled') {
        setRaciResumen(raciR.value.data || null);
      }

      setCargandoDatos(false);
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  // MANDATO (2026-08-24): "Generar Ficha Técnica" ya no audita ni sella nada
  // (eso vivía en POST /api/m12/ficha/:id, con el Hard-Lock legal F-Legal-01
  // — sigue existiendo en el backend, solo que este botón dejó de invocarlo)
  // — descarga el PDF real (mismo endpoint que "Reporte Maestro" en
  // /exportacion, GET /api/modulo9/reporte/:id, ahora corregido para incluir
  // Contexto/Dialéctico/Logística/Anexos con los datos reales del proyecto).
  const descargarFichaTecnica = async () => {
    if (!proyectoId) {
      setError('No hay un proyecto activo — vuelve a Entrada y crea/selecciona un proyecto primero.');
      return;
    }
    setDescargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/modulo9/reporte/${proyectoId}`, { headers: { ...getAuthHeaders() }, credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Error al generar el PDF (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `FichaTecnica_${proyectoId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el PDF de la Ficha Técnica.');
    } finally {
      setDescargando(false);
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
        <button
          onClick={descargarFichaTecnica}
          disabled={!listoParaGenerarPDF || descargando}
          title={listoParaGenerarPDF ? 'Descarga el PDF de la Ficha Técnica con los datos actuales' : (!proyectoId ? 'No hay proyecto activo — completa Entrada primero' : 'Completa todos los campos de Entrada, Contexto, Motor Dialéctico, Anexos, Logística y Matriz RACI (al menos 1 tarea y 1 rol) para poder generar el documento')}
          style={{
            padding: '10px 22px', background: listoParaGenerarPDF ? T.primary : T.border,
            border: 'none', borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 700,
            cursor: listoParaGenerarPDF && !descargando ? 'pointer' : 'not-allowed', letterSpacing: '0.04em', fontFamily: T.font,
          }}
        >
          {descargando ? 'Generando…' : 'Generar Ficha Técnica'}
        </button>
      </div>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

        <p style={{ margin: 0, fontSize: 12, color: T.textHint, maxWidth: 640 }}>
          Este es el resumen de todo lo entregado en Entrada, Contexto, Motor Dialéctico, Anexos, Logística y Matriz RACI —
          la base con la que la app inicia la formulación del proyecto.
        </p>

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#b91c1c' }} role="alert">
            {error}
          </div>
        )}

        {cargandoDatos ? (
          <p style={{ margin: 0, fontSize: 12, color: T.textHint, fontStyle: 'italic' }}>Cargando datos reales del proyecto…</p>
        ) : (
        <>
        {/* ── 01 Entrada ───────────────────────────────────────────────── */}
        <Section badge="01" title="Entrada" hint="Datos generales, tipo de proyecto, financiación, nivel y metodologías.">
          {/* Nombre en su propia fila horizontal completa (pedido explícito
              2026-08-23) — un nombre de proyecto largo no debe competir por
              ancho con Municipio/Beneficiarios/Cobertura en la misma grilla. */}
          <div style={{ marginBottom: 14 }}>
            <Campo label="Nombre del Proyecto" value={nombreProyecto} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
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
        <Section badge="02" title="Contexto y Diagnóstico" hint="Contexto del Problema construido en Entrada — situación actual, línea base, meta esperada, justificación y demás.">
          {(() => {
            const cm = entrada?.contextoMeta;
            const sel = cm?.problematicas?.find(p => p.problema === cm.problemaSeleccionado);
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
                <Campo label="C. Problemática (Meta Esperada)" value={cm?.problemaSeleccionado || ''} />
                <Campo label="C. Déficit Asociado" value={sel?.deficit_valor != null ? `${sel.deficit_valor} ${sel.deficit_unidad || ''}`.trim() : ''} />
                <Campo label="C. Beneficiarios" value={cm?.beneficiarios || ''} />
                <Campo label="C. Tipo de Formulación" value={cm?.tipoFormulacion || ''} />
              </div>
            );
          })()}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(CONTEXTO_LABELS).map(([k, label]) => (
              <Campo key={k} label={label} value={entrada?.contexto?.[k] || ''} />
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

        {/* MANDATO (2026-08-24, "mismo orden en que se encuentran las
            ventanas"): reordenado para calzar con TopNavBar.tsx (Entrada ·
            Dialéctica · Anexos · Biblioteca · Logística · Matriz RACI ·
            Ficha Técnica · ...) — Anexos antes que Logística. */}
        {/* ── 04 Anexos ────────────────────────────────────────────────── */}
        <Section badge="04" title="Anexos" hint="Soportes documentales y enlaces de respaldo.">
          {anexosValidos.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: T.textHint, fontStyle: 'italic' }}>Sin soportes cargados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {anexosValidos.map((s) => (
                <div key={`${s.descripcion}-${s.anexo || s.link}`} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '9px 14px', fontSize: 12.5, color: T.text, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>{s.descripcion}</span>
                  <span style={{ color: T.textMuted, fontSize: 11 }}>{s.anexo || s.link}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── 05 Logística ─────────────────────────────────────────────── */}
        <Section badge="05" title="Logística" hint="Tramos de ejecución registrados y observaciones.">
          {tramosValidos.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: T.textHint, fontStyle: 'italic' }}>Sin tramos registrados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tramosValidos.map((t) => (
                <div key={`${t.origen}-${t.destino}-${t.duracion}`} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '9px 14px', fontSize: 12.5, color: T.text }}>
                  <strong>{t.origen}</strong> → <strong>{t.destino}</strong> · {t.duracion}{t.medio ? ` · ${t.medio}` : ''}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* MANDATO (2026-08-24, "en el mismo orden en que se encuentran las
            ventanas"): Matriz RACI va después de Logística, calzando con
            TopNavBar.tsx. Mismo cálculo de validación que consume el PDF
            (GET /api/proyectos/:id/raci/resumen, backend/services/
            raciService.js) — nunca reimplementado aquí. */}
        {/* ── 06 Matriz RACI ───────────────────────────────────────────── */}
        <Section badge="06" title="Matriz RACI" hint="Roles y responsabilidades por tarea/actividad del proyecto.">
          {!raciResumen || raciResumen.totalTareas === 0 || raciResumen.totalRoles === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: T.textHint, fontStyle: 'italic' }}>Sin tareas/roles registrados en la Matriz RACI</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
                <Campo label="Tareas Registradas" value={raciResumen.totalTareas} />
                <Campo label="Roles Registrados" value={raciResumen.totalRoles} />
                <Campo label="Completitud de la Matriz" value={`${raciResumen.porcentajeCompletitud}% (${raciResumen.totalAsignaciones} de ${raciResumen.celdasPosibles})`} />
              </div>
              {([
                ['Tareas sin Aprobador (A)', raciResumen.tareasSinA],
                ['Tareas con más de un Aprobador (A)', raciResumen.tareasConMultiplesA],
                ['Tareas sin Responsable (R)', raciResumen.tareasSinR],
                ['Roles sin ninguna asignación', raciResumen.rolesSinAsignacion],
              ] as const).map(([titulo, items]) => (
                <div key={titulo}>
                  <p style={{ margin: '0 0 4px', fontSize: 11.5, fontWeight: 700, color: items.length ? '#b91c1c' : '#15803d' }}>{titulo} ({items.length})</p>
                  {items.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12, color: T.textHint, fontStyle: 'italic' }}>Ninguna.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: T.text }}>
                      {items.map(it => <li key={it.id}>{it.nombre}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
        </>
        )}

      </div>
    </div>
  );
}
