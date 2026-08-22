/**
 * EntradaPage — Calco estricto Stitch screen "Pestaña #1: Datos de Entrada (Fondo Blanco)"
 * Screen ID: projects/3791086755596777919/screens/5142894009029579964
 * Tokens: bg #f7f9fb · card #ffffff · border #e0e3e5 · text #191c1e · primary #0058be
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthHeaders, http, ApiError } from '../lib/apiClient';
import './EntradaPage.css';

const STORAGE_KEY = 'radar360_entrada_m1';
const ACTIVE_PROJECT_KEY      = 'rf360_proyecto_activo';
const ACTIVE_PROJECT_NAME_KEY = 'rf360_proyecto_nombre';

// ── Catálogos ─────────────────────────────────────────────────────────────────

const ENFOQUES: { label: string; icon: string }[] = [
  { label: 'INFRAESTRUCTURA', icon: 'construction' },
  { label: 'SOCIAL',          icon: 'group' },
  { label: 'PRODUCTIVO',      icon: 'agriculture' },
  { label: 'INSTITUCIONAL',   icon: 'account_balance' },
];

const TIPOS_CONVOCATORIA: { label: string; icon: string }[] = [
  { label: 'Subvención internacional', icon: 'public' },
  { label: 'Cofinanciación',           icon: 'foundation' },
  { label: 'MGA / SGR',                icon: 'account_balance_wallet' },
  { label: 'APP / OXI',                icon: 'gavel' },
  { label: 'Banca multilateral',       icon: 'account_balance' },
];

const NIVELES_PROYECTO: { label: string; icon: string }[] = [
  { label: 'Idea',            icon: 'lightbulb' },
  { label: 'Perfil',          icon: 'description' },
  { label: 'Prefactibilidad', icon: 'fact_check' },
  { label: 'Factibilidad',    icon: 'verified' },
];

const METODOLOGIA_OBLIGATORIA = 'Marco Lógico';
const METODOLOGIAS: string[] = [
  METODOLOGIA_OBLIGATORIA,
  'Teoría del Cambio',
  'PMI',
  'MEL',
  'Salvaguardas',
];

const FORMATO_FINANCIADOR: { label: string; icon: string }[] = [
  { label: 'ONU / BID / UE', icon: 'public' },
  { label: 'MGA Web',        icon: 'account_balance_wallet' },
  { label: 'Formato propio', icon: 'description' },
];

const SECTORES_SUB: { grupo: string; sub: { titulo: string; opciones: string[] }[] }[] = [
  {
    grupo: 'Hábitat y Territorio',
    sub: [
      { titulo: 'Construcción y Espacios', opciones: ['Infraestructura Social', 'Espacios Públicos', 'Centros de Integración Ciudadana'] },
      { titulo: 'Vivienda', opciones: ['Vivienda VIS', 'Vivienda VIP', 'Mejoramiento de vivienda'] },
      { titulo: 'Transporte', opciones: ['Modo de transporte Fluvial', 'Movilidad Sostenible'] },
      { titulo: 'Ordenamiento Territorial', opciones: ['Catastro Multipropósito', 'Planes de Ordenamiento Territorial', 'Legalización de Predios', 'Caminos Vecinales'] },
    ],
  },
  {
    grupo: 'Soberanía y Vida',
    sub: [
      { titulo: 'Agua y Saneamiento', opciones: ['Acueductos', 'Sistema de Potabilización', 'Recoleccion de Aguas Lluvias', 'Baterías Sanitarias', 'Alcantarillado', 'Tratamiento de agua Residual'] },
      { titulo: 'Salud', opciones: ['Infra. Hospitalaria', 'Puestos de salud Rurales', 'Dotación Médica emergencia'] },
      { titulo: 'Medio Ambiente', opciones: ['Reforestación', 'Proteccion de Cuencas Hídricas', 'Economía Circular y residuos', 'Mitigación de Desastres', 'Muros de Contención', 'Reubicación por Riesgo Geologico'] },
      { titulo: 'Energía', opciones: ['Energia Solar Fotovoltaica', 'Microcentrales Hidroelectricas', 'Biogás'] },
    ],
  },
  {
    grupo: 'Paz y Sociedad',
    sub: [
      { titulo: 'Justicia y Paz', opciones: ['Protección a Víctimas', 'Restitución de Tierras', 'Equidad de Género'] },
      { titulo: 'Cultura y Deporte', opciones: ['Casas de Cultura', 'Patrimonio', 'Escuelas de Formación Artística', 'Complejos deportivos', 'Parques Biosaludables', 'Escuelas de Deporte Social'] },
      { titulo: 'Institucional', opciones: ['Casas de la Justicia', 'Centro de Conciliación', 'Fortalecimiento Institucional'] },
      { titulo: 'Migración y Emergencia', opciones: ['Atencion a Poblacion Migrantes', 'Albergues Temporales', 'Seguridad Alimentaria de emergencia.'] },
    ],
  },
  {
    grupo: 'Autonomía Económica',
    sub: [
      { titulo: 'Agropecuario', opciones: ['Distritos de Riego', 'Centros de Acopio Agropecuarios', 'Maquinaria y equipos', 'Plantas de Transformacion', 'Proyectos Productivos Campesinos'] },
      { titulo: 'Turismo', opciones: ['Infraestructura Turística', 'Agroturismo', 'Turismo de Naturaleza Sostenible'] },
      { titulo: 'Empresarial', opciones: ['Capital Semilla', 'Formalización Empresarial'] },
    ],
  },
  {
    grupo: 'Futuro y Conocimiento',
    sub: [
      { titulo: 'Educación', opciones: ['Comedores Escolares', 'Educación Digital'] },
      { titulo: 'Innovación', opciones: ['Investigación Aplicada (materiales)', 'Lab. de Innovación', 'Patentes y Prototipos'] },
      { titulo: 'Digital', opciones: ['Conectividad Rural', 'Software de Gestion Público', 'Ciberseguridad'] },
    ],
  },
];

const CATEGORIAS_POBLACION = [
  { id: 'A', titulo: 'A. FORTALECIMIENTO INSTITUCIONAL Y GUBERNAMENTAL', opciones: ['Alcaldías / Municipios', 'Gobernaciones', 'Cuerpos de Socorro y Emergencia', 'Instituciones Educativas', 'Otros:'] },
  { id: 'B', titulo: 'B. ORGANIZACIONES COMUNITARIAS Y DE BASE', opciones: ['Juntas de Acción Comunal (JAC)', 'Centros de Bienestar', 'Grupos de Voluntariado y Minga', 'Otros:'] },
  { id: 'C', titulo: 'C. DESARROLLO PRODUCTIVO Y RURAL', opciones: ['Campesinos', 'Asociaciones productivas', 'Emprendedores y microempresarios', 'Otros:'] },
];

const DETALLE_POBLACION = [
  { grupo: 'A. INCLUSIÓN SOCIAL Y CICLO DE VIDA', opciones: ['Primera infancia y niñez.', 'Adulto mayor.', 'Madres Cabeza de Hogar', 'Población General.'] },
  { grupo: 'B. COMUNIDADES ÉTNICAS', opciones: ['Comunidades Indígenas', 'Comunidades Afrocolombianas', 'Comunidades Raizales y Palenqueras', 'Pueblo Rrom'] },
  { grupo: 'C. JUSTICIA, PAZ Y RESTITUCIÓN DE DERECHOS', opciones: ['Víctimas del conflicto', 'Reincorporados / Reintegrados', 'Población carcelaria y pospenados'] },
  { grupo: 'D. VULNERABILIDAD CRÍTICA, SALUD Y RESILIENCIA', opciones: ['Personas con discapacidad', 'Población migrante', 'Población en pobreza extrema', 'Damnificados por desastres'] },
];

// Debe coincidir literal con el marcador que devuelve el prompt de
// EntradaIAService.js (regla 2, backend) cuando un campo crítico no tiene
// dato en el material de investigación.
const ND_INVESTIGACION = 'ND (No Disponible en la investigación)';
const ALERTA_ND = '⚠️ REQUERIDO: FALTA INFORMACIÓN EN ANEXOS';

const CONTEXTO_CAMPOS = [
  { id: 'situacion_actual', label: 'A. SITUACION ACTUAL SIN PROYECTO', ph: "ej: 'El 80% de las familias consumen agua no potable'" },
  { id: 'linea_base', label: 'B. INDICADOR DE LINEA BASE CUANTIFICABLE', ph: "ej: % de familias sin acceso a energía — Valor actual: 80 — Unidad: %" },
  { id: 'meta', label: 'C. META ESPERADA (NÚMERO Y UNIDAD)', ph: "ej: Valor meta: 5 — Unidad: %" },
  { id: 'justificacion', label: 'D. JUSTIFICACION DE PRIORIDAD', ph: 'Define la relevancia estratégica del proyecto...' },
  { id: 'sociocultural', label: 'E. ANALISIS SOCIOCULTURAL PARA LA PERTINENCIA', ph: 'Demuestra que la solución es culturalmente pertinente...' },
  { id: 'problema_urgente', label: 'F. ¿QUE PROBLEMA PERCIBE COMO MAS URGENTE?', ph: 'Qué problema percibe como urgente...' },
  { id: 'incertidumbre', label: 'G. CONDICION CRÍTICA DE INCERTIDUMBRE LOGÍSTICA', ph: 'Describa la condición crítica...' },
];


// ── Estado ─────────────────────────────────────────────────────────────────────

interface EntradaState {
  nombre: string;
  enfoque: string;
  tipoConvocatoria: string;
  nivelProyecto: string;
  metodologias: string[];
  formatoFinanciador: string;
  numeroBeneficiarios: string;
  coberturaGeografica: string;
  sectores: string[];
  sectorOtro: Record<string, string>;
  categoriaPoblacion: string;
  categoriaOtro: Record<string, string>;
  detallePoblacion: string[];
  municipio: string;
  vereda: string;
  contexto: Record<string, string>;
}

const ESTADO_INICIAL: EntradaState = {
  nombre: '', enfoque: '', tipoConvocatoria: '',
  nivelProyecto: '', metodologias: [METODOLOGIA_OBLIGATORIA], formatoFinanciador: '',
  numeroBeneficiarios: '', coberturaGeografica: '',
  sectores: [], sectorOtro: {}, categoriaPoblacion: '', categoriaOtro: {},
  detallePoblacion: [], municipio: '', vereda: '', contexto: {},
};

// ── "Generar con AI" (EXTENSIÓN 2026-08-17, acotado al módulo 11 el mismo
// día por pedido explícito del usuario con captura real: "el botón de
// generar con ai es solo para el módulo 11") ────────────────────────────────
// Fusiona SOLO los 7 campos de "Contexto del Problema" sobre el estado
// actual, sin perder nada que el usuario ya haya escrito — cada campo se
// llena únicamente si está vacío; si ya tiene texto, se conserva tal cual.
function fusionarContextoIA(actual: EntradaState, contextoSugerido: Partial<Record<string, string>>): EntradaState {
  return {
    ...actual,
    contexto: Object.fromEntries(
      CONTEXTO_CAMPOS.map(c => {
        if (actual.contexto[c.id]?.trim()) return [c.id, actual.contexto[c.id]];
        const sugerido = contextoSugerido[c.id] || actual.contexto[c.id] || '';
        // ND del backend → alarma visual estandarizada en el estado del
        // formulario (no solo estilo en el render) — se apaga sola en el
        // próximo "Generar con AI" si el usuario ya completó los Anexos y
        // la IA encuentra el dato real.
        return [c.id, sugerido === ND_INVESTIGACION ? ALERTA_ND : sugerido];
      })
    ),
  };
}

export default function EntradaPage() {
  const [st, setSt] = useState<EntradaState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...ESTADO_INICIAL, ...JSON.parse(raw) } : ESTADO_INICIAL;
    } catch { return ESTADO_INICIAL; }
  });
  const [guardado, setGuardado] = useState(false);
  const [limpiado, setLimpiado] = useState(false);
  const [generandoIA, setGenerandoIA] = useState(false);
  const [errorIA, setErrorIA] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [voiceField, setVoiceField] = useState<string | null>(null);
  const recRef = useRef<any>(null);

  const toggleVoice = useCallback((fieldId: string) => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Usa Chrome para activar el micrófono.'); return; }

    if (voiceField === fieldId) {
      recRef.current?.stop();
      setVoiceField(null);
      return;
    }

    recRef.current?.stop();
    const rec = new SR();
    rec.lang = 'es-CO';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
      }
      if (finalText.trim()) {
        setSt(p => ({ ...p, contexto: { ...p.contexto, [fieldId]: ((p.contexto[fieldId] || '') + ' ' + finalText.trim()).trimStart() } }));
      }
    };
    rec.onerror = () => setVoiceField(null);
    rec.onend   = () => setVoiceField(null);
    rec.start();
    recRef.current = rec;
    setVoiceField(fieldId);
  }, [voiceField]);

  // Auto-save: persiste cada cambio sin necesidad de presionar SAVE
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  }, [st]);

  // Hidratación desde servidor SOLO si no había nada en localStorage (ej.
  // primera vez en este navegador/dispositivo) — evita pisar ediciones en
  // curso con una copia potencialmente más vieja del servidor.
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) return;
    (async () => {
      try {
        const body = await fetch(`/api/proyectos/${proyectoId}`, { headers: { ...getAuthHeaders() }, credentials: 'include' })
          .then(r => r.json());
        const entrada = body?.data?.ficha_tecnica?.entrada_completa;
        if (entrada) setSt(prev => ({ ...prev, ...entrada }));
      } catch { /* sin conexión — se queda con ESTADO_INICIAL */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Proyecto activo — persistencia real en BD (POST /api/proyectos) ─────────
  // M1 (Entrada) es donde el usuario nombra su proyecto por primera vez en el
  // wizard del Formulador. Al salir del campo "nombre":
  //   - si no hay proyecto activo aún, se crea uno real vía POST /api/proyectos
  //     y se guarda el id devuelto por la BD (nunca un UUID generado en cliente).
  //   - si ya existe y el nombre cambió, se sincroniza vía PATCH /api/proyectos/:id.
  // El resto de la app (header del Dashboard Formulador, AnexosView, etc.) lee
  // rf360_proyecto_activo/rf360_proyecto_nombre y por lo tanto siempre apunta
  // a un proyecto que realmente existe en la tabla `projects`.
  const sincronizandoProyectoRef = useRef(false);
  const [sincronizandoProyecto, setSincronizandoProyecto] = useState(false);
  const [errorProyecto, setErrorProyecto] = useState<string | null>(null);

  const sincronizarProyectoActivo = useCallback(async () => {
    const nombre = st.nombre.trim();
    if (!nombre || sincronizandoProyectoRef.current) return;

    const proyectoId      = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const nombreGuardado  = localStorage.getItem(ACTIVE_PROJECT_NAME_KEY);
    if (proyectoId && nombre === nombreGuardado) return; // nada que sincronizar

    sincronizandoProyectoRef.current = true;
    setSincronizandoProyecto(true);
    setErrorProyecto(null);
    try {
      if (!proyectoId) {
        const res = await fetch('/api/proyectos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          credentials: 'include',
          body: JSON.stringify({ nombre }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo crear el proyecto.');

        const idReal = body.id ?? body.proyectoId;
        if (!idReal) throw new Error('La respuesta del servidor no incluyó un id de proyecto.');

        localStorage.setItem(ACTIVE_PROJECT_KEY, idReal);
        localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, nombre);
      } else {
        const res = await fetch(`/api/proyectos/${proyectoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          credentials: 'include',
          body: JSON.stringify({ nombre }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo actualizar el nombre del proyecto.');

        localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, nombre);
      }
      // Notifica a componentes hermanos montados en la misma pestaña (ej. el
      // Dashboard Formulador embebido en FormuladorLayout) — el evento nativo
      // "storage" solo dispara en OTRAS pestañas, así que se despacha a mano.
      window.dispatchEvent(new StorageEvent('storage', { key: ACTIVE_PROJECT_KEY }));
    } catch (err: any) {
      setErrorProyecto(err?.message ?? 'Error al sincronizar el proyecto con el servidor.');
    } finally {
      sincronizandoProyectoRef.current = false;
      setSincronizandoProyecto(false);
    }
  }, [st.nombre]);

  const [errorEntradaCompleta, setErrorEntradaCompleta] = useState<string | null>(null);

  const guardar = async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2200);

    // Antes SAVE solo escribía localStorage — de las 11 secciones de Entrada
    // solo "nombre" llegaba al servidor (vía sincronizarProyectoActivo). Aquí
    // se persiste el resto (enfoque, sectores, población, contexto, etc.)
    // como una clave dentro de ficha_tecnica, igual que ya hace ContextoPage.
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) return;
    try {
      await http.patch(`/api/proyectos/${proyectoId}/ficha-tecnica-merge`, { key: 'entrada_completa', value: st });
      setErrorEntradaCompleta(null);
    } catch {
      setErrorEntradaCompleta('Se guardó localmente, pero no se pudo sincronizar con el servidor.');
    }
  };

  const limpiar = () => {
    localStorage.removeItem(STORAGE_KEY);
    // Limpieza total: incluso las metodologías con valor por defecto (Marco Lógico)
    // quedan sin marcar — LIMPIAR deja el formulario completamente en blanco.
    setSt({ ...JSON.parse(JSON.stringify(ESTADO_INICIAL)), metodologias: [] });
    setVoiceField(null);
    recRef.current?.stop();
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  // "Generar con AI" (módulo 11 — Contexto del Problema, ver comentario de
  // fusionarContextoIA): lee la carpeta "Investigación" de Anexos del
  // proyecto activo y sugiere SOLO estos 7 campos — el usuario puede seguir
  // llenándolos a mano igual que siempre, esto es una ayuda opcional. "A
  // prueba de errores": cada fallo posible (sin proyecto activo, sin
  // carpeta, carpeta vacía, IA sin responder, JSON inválido) muestra un
  // mensaje claro y deja el formulario exactamente como estaba.
  const generarConIA = async () => {
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoIA(true);
    setErrorIA(null);
    try {
      const resp = await http.post<{ success: boolean; data?: Partial<Record<string, string>>; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai`, {}
      );
      if (!resp.data) throw new Error(resp.message || 'La IA no devolvió datos.');
      setSt(prev => fusionarContextoIA(prev, resp.data!));
    } catch (e) {
      setErrorIA(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'No se pudo generar con IA — inténtalo de nuevo.'));
    } finally {
      setGenerandoIA(false);
    }
  };

  const toggleSector = (s: string) =>
    setSt(p => ({ ...p, sectores: p.sectores.includes(s) ? p.sectores.filter(x => x !== s) : [...p.sectores, s] }));

  const toggleDetalle = (s: string) =>
    setSt(p => ({ ...p, detallePoblacion: p.detallePoblacion.includes(s) ? p.detallePoblacion.filter(x => x !== s) : [...p.detallePoblacion, s] }));

  const toggleMetodologia = (m: string) =>
    setSt(p => ({ ...p, metodologias: p.metodologias.includes(m) ? p.metodologias.filter(x => x !== m) : [...p.metodologias, m] }));

  return (
    <div className="entr">
      {/* ── Topbar ── */}
      <header className="entr__topbar">
        <h1 className="entr__h1">Datos de Entrada</h1>
        <div className="entr__topbar-right">
          <button
            className={`entr__clear${limpiado ? ' entr__clear--done' : ''}`}
            onClick={limpiar}
          >
            {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
          </button>
          <button
            className={`entr__save${guardado ? ' entr__save--saved' : ''}`}
            onClick={guardar}
          >
            {guardado ? '✓ GUARDADO' : 'SAVE'}
          </button>
        </div>
      </header>
      {errorEntradaCompleta && (
        <div role="alert" style={{ fontSize: 11, color: '#dc2626', padding: '4px 24px' }}>{errorEntradaCompleta}</div>
      )}

      {/* ── Layout ── */}
      <div className="entr__layout">

        {/* ── Main ── */}
        <main className="entr__main" ref={mainRef}>
          <div className="entr__form">

            {/* ── NOMBRE DEL PROYECTO ── */}
            <div className="entr__card" id="sec-nombre">
              <label className="entr__nombre-label" htmlFor="entr-nombre">
                NOMBRE DEL PROYECTO
              </label>
              <input
                id="entr-nombre"
                className="entr__input"
                placeholder="Escriba el nombre del proyecto..."
                value={st.nombre}
                onChange={e => setSt(p => ({ ...p, nombre: e.target.value }))}
                onBlur={sincronizarProyectoActivo}
              />
              {sincronizandoProyecto && (
                <span style={{ fontSize: 11, color: '#6b7280', marginTop: 4, display: 'block' }}>
                  Guardando proyecto…
                </span>
              )}
              {errorProyecto && (
                <span role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                  {errorProyecto}
                </span>
              )}
            </div>

            {/* ── 01 ENFOQUE ── */}
            <div className="entr__card" id="sec-enfoque">
              <div className="entr__card-header">
                <span className="entr__step-badge">01</span>
                <h2 className="entr__section-heading entr__section-heading--title">Tipo de Proyecto</h2>
              </div>
              <div className="entr__enfoque-cards">
                {ENFOQUES.map(e => (
                  <label
                    key={e.label}
                    className={`entr__enfoque-card${st.enfoque === e.label ? ' entr__enfoque-card--on' : ''}`}
                  >
                    <input type="radio" name="enfoque" checked={st.enfoque === e.label}
                      onChange={() => setSt(p => ({ ...p, enfoque: e.label }))} />
                    <span className="material-symbols-outlined">{e.icon}</span>
                    {e.label}
                  </label>
                ))}
              </div>
            </div>

            {/* ── 02 TIPO DE CONVOCATORIA ── */}
            <div className="entr__card" id="sec-tipo">
              <div className="entr__card-header">
                <span className="entr__step-badge">02</span>
                <h2 className="entr__section-heading">Fuente de Financiación</h2>
              </div>
              <div className="entr__tipo-grid">
                {TIPOS_CONVOCATORIA.map(tc => (
                  <label
                    key={tc.label}
                    className={`entr__tipo-card${st.tipoConvocatoria === tc.label ? ' entr__tipo-card--on' : ''}`}
                  >
                    <input type="radio" name="tipoconv" checked={st.tipoConvocatoria === tc.label}
                      onChange={() => setSt(p => ({ ...p, tipoConvocatoria: tc.label }))} />
                    <span className="material-symbols-outlined">{tc.icon}</span>
                    {tc.label}
                  </label>
                ))}
              </div>
            </div>

            {/* ── 03/04/05 NIVEL · METODOLOGÍAS · FORMATO FINANCIADOR (compacto, 3 columnas) ── */}
            <div className="entr__card" id="sec-nivel-metodologias-formato">
              <div className="entr__combo3-grid">

                {/* 03 Nivel del Proyecto */}
                <div className="entr__combo3-col">
                  <div className="entr__card-header">
                    <span className="entr__step-badge">03</span>
                    <h2 className="entr__section-heading">Nivel del Proyecto</h2>
                  </div>
                  <p className="entr__section-hint">Etapa de maduración del proyecto.</p>
                  <div className="entr__combo3-list">
                    {NIVELES_PROYECTO.map(n => (
                      <label
                        key={n.label}
                        className={`entr__radio-row${st.nivelProyecto === n.label ? ' entr__radio-row--on' : ''}`}
                      >
                        <input type="radio" name="nivelproyecto" checked={st.nivelProyecto === n.label}
                          onChange={() => setSt(p => ({ ...p, nivelProyecto: n.label }))} />
                        {n.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 04 Metodologías */}
                <div className="entr__combo3-col">
                  <div className="entr__card-header">
                    <span className="entr__step-badge">04</span>
                    <h2 className="entr__section-heading">Metodologías</h2>
                  </div>
                  <p className="entr__section-hint">Marco Lógico viene preseleccionado por defecto.</p>
                  <div className="entr__combo3-list">
                    {METODOLOGIAS.map(m => {
                      const esObligatoria = m === METODOLOGIA_OBLIGATORIA;
                      return (
                        <label
                          key={m}
                          className={`entr__check-row${st.metodologias.includes(m) ? ' entr__radio-row--on' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={st.metodologias.includes(m)}
                            onChange={() => toggleMetodologia(m)}
                          />
                          <span>{m}{esObligatoria ? ' (por defecto)' : ''}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 05 Formato del Financiador */}
                <div className="entr__combo3-col">
                  <div className="entr__card-header">
                    <span className="entr__step-badge">05</span>
                    <h2 className="entr__section-heading">Formato del Financiador</h2>
                  </div>
                  <p className="entr__section-hint">Formato exigido por el financiador.</p>
                  <div className="entr__combo3-list">
                    {FORMATO_FINANCIADOR.map(f => (
                      <label
                        key={f.label}
                        className={`entr__radio-row${st.formatoFinanciador === f.label ? ' entr__radio-row--on' : ''}`}
                      >
                        <input type="radio" name="formatofinanciador" checked={st.formatoFinanciador === f.label}
                          onChange={() => setSt(p => ({ ...p, formatoFinanciador: f.label }))} />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            {/* ── 06 POBLACIÓN OBJETIVO (resumen) ── */}
            <div className="entr__card" id="sec-poblacion-resumen">
              <div className="entr__card-header">
                <span className="entr__step-badge">06</span>
                <h2 className="entr__section-heading">Población Objetivo</h2>
              </div>
              <p className="entr__section-hint">Dimensione el alcance del proyecto.</p>
              <div className="entr__geo-grid">
                <div>
                  <label className="entr__field-label" htmlFor="entr-beneficiarios">
                    NÚMERO DE BENEFICIARIOS
                  </label>
                  <input
                    id="entr-beneficiarios"
                    className="entr__input"
                    type="number"
                    min={0}
                    placeholder="Ej: 2500"
                    value={st.numeroBeneficiarios}
                    onChange={e => setSt(p => ({ ...p, numeroBeneficiarios: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="entr__field-label" htmlFor="entr-cobertura">
                    COBERTURA GEOGRÁFICA
                  </label>
                  <input
                    id="entr-cobertura"
                    className="entr__input"
                    placeholder="Ej: 3 veredas del municipio de Tumaco"
                    value={st.coberturaGeografica}
                    onChange={e => setSt(p => ({ ...p, coberturaGeografica: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* ── 07 SECTOR ── */}
            <div className="entr__card" id="sec-sector">
              <div className="entr__card-header">
                <span className="entr__step-badge">07</span>
                <h2 className="entr__section-heading">Sector</h2>
              </div>
              <p className="entr__section-hint">Seleccione todos los sectores de intervención del proyecto.</p>
              <div className="entr__sector-block">
                {SECTORES_SUB.map(s => (
                  <div key={s.grupo} className="entr__sector-table" style={{ marginBottom: 10 }}>
                    <div className="entr__sector-thead">
                      <p className="entr__sector-thead-title">{s.grupo}</p>
                    </div>
                    <div
                      className="entr__sector-cols"
                      style={{ gridTemplateColumns: `repeat(${s.sub.length}, 1fr)` }}
                    >
                      {s.sub.map(sub => (
                        <div key={sub.titulo} className="entr__sector-col">
                          <p className="entr__sector-col-title">{sub.titulo}</p>
                          {sub.opciones.map(op => (
                            <label key={op} className="entr__check-row">
                              <input
                                type="checkbox"
                                checked={st.sectores.includes(op)}
                                onChange={() => toggleSector(op)}
                              />
                              <span>{op}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="entr__sector-otro">
                      <span className="entr__sector-otro-label">Otro:</span>
                      <input
                        className="entr__sector-otro-input"
                        placeholder="Especifique otro sector..."
                        value={st.sectorOtro[s.grupo] || ''}
                        onChange={e => setSt(p => ({ ...p, sectorOtro: { ...p.sectorOtro, [s.grupo]: e.target.value } }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 08 CATEGORÍA POBLACIÓN ── */}
            <div className="entr__card" id="sec-poblacion">
              <div className="entr__card-header">
                <span className="entr__step-badge">08</span>
                <h2 className="entr__section-heading">Categoría de la Población Objetivo</h2>
              </div>
              <p className="entr__section-hint">Identifique a quién va dirigido el proyecto.</p>
              <div className="entr__combo3-grid">
                {CATEGORIAS_POBLACION.map(cat => (
                  <div key={cat.id} className="entr__combo3-col">
                    <p className="entr__subheading">{cat.titulo}</p>
                    <div className="entr__combo3-list">
                      {cat.opciones.map(op => {
                        const key = `${cat.id}:${op}`;
                        const esOtro = op.startsWith('Otros');
                        return (
                          <div key={key}>
                            <label
                              className={`entr__radio-row${st.categoriaPoblacion === key ? ' entr__radio-row--on' : ''}`}
                            >
                              <input type="radio" name="catpob"
                                checked={st.categoriaPoblacion === key}
                                onChange={() => setSt(p => ({ ...p, categoriaPoblacion: key }))} />
                              {op}
                            </label>
                            {esOtro && st.categoriaPoblacion === key && (
                              <input
                                className="entr__sub-input"
                                placeholder="Escribir aquí..."
                                autoFocus
                                value={st.categoriaOtro[cat.id] || ''}
                                onChange={e => setSt(p => ({
                                  ...p,
                                  categoriaOtro: { ...p.categoriaOtro, [cat.id]: e.target.value },
                                }))}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 09 DETALLE POBLACIÓN ── */}
            <div className="entr__card" id="sec-detalle">
              <div className="entr__card-header">
                <span className="entr__step-badge">09</span>
                <h2 className="entr__section-heading">Detalle de la Población</h2>
              </div>
              <p className="entr__section-hint">Especifique los grupos poblacionales prioritarios.</p>
              {DETALLE_POBLACION.map(d => (
                <div key={d.grupo} className="entr__detalle-grupo">
                  <p className="entr__subheading">{d.grupo}</p>
                  <div className="entr__detalle-grid">
                    {d.opciones.map(op => (
                      <label
                        key={op}
                        className={`entr__check-card${st.detallePoblacion.includes(op) ? ' entr__check-card--on' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={st.detallePoblacion.includes(op)}
                          onChange={() => toggleDetalle(op)}
                        />
                        <span>{op}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── 10 UBICACIÓN GEOGRÁFICA ── */}
            <div className="entr__card" id="sec-geo">
              <div className="entr__card-header">
                <span className="entr__step-badge">10</span>
                <h2 className="entr__section-heading">Ubicación Geográfica</h2>
              </div>
              <p className="entr__section-hint">Localización del área de intervención del proyecto.</p>
              <div className="entr__geo-grid">
                <div>
                  <label className="entr__field-label" htmlFor="entr-municipio">
                    MUNICIPIO / DEPARTAMENTO
                  </label>
                  <input
                    id="entr-municipio"
                    className="entr__input"
                    placeholder="Ej: Medellín, Antioquia"
                    value={st.municipio}
                    onChange={e => setSt(p => ({ ...p, municipio: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="entr__field-label" htmlFor="entr-vereda">
                    VEREDA / CORREGIMIENTO
                  </label>
                  <input
                    id="entr-vereda"
                    className="entr__input"
                    placeholder="Opcional"
                    value={st.vereda}
                    onChange={e => setSt(p => ({ ...p, vereda: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* ── 11 CONTEXTO DEL PROBLEMA ── */}
            <div className="entr__card" id="sec-contexto">
              <div className="entr__card-header">
                <span className="entr__step-badge">11</span>
                <h2 className="entr__section-heading">Contexto del Problema</h2>
                <button
                  className="entr__ai-btn"
                  style={{ marginLeft: 'auto' }}
                  onClick={generarConIA}
                  disabled={generandoIA}
                  title="Lee la carpeta 'Investigación' de Anexos y sugiere estos 7 campos — nunca sobrescribe lo que ya escribiste a mano."
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_awesome</span>
                  {generandoIA ? 'Generando…' : 'Generar con AI'}
                </button>
              </div>
              {errorIA && (
                <div role="alert" style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '6px 10px', borderRadius: 6, marginBottom: 10 }}>{errorIA}</div>
              )}
              <p className="entr__section-hint">Caracterice la situación problemática que el proyecto busca resolver.</p>
              <div className="entr__context-list">
                {CONTEXTO_CAMPOS.map(c => (
                  <div key={c.id}>
                    <label className="entr__field-label" htmlFor={`entr-${c.id}`}>{c.label}</label>
                    <div className="entr__textarea-wrap">
                      <textarea
                        id={`entr-${c.id}`}
                        className={`entr__textarea${st.contexto[c.id] === ALERTA_ND ? ' entr__textarea--alerta' : ''}`}
                        rows={1}
                        placeholder={c.ph}
                        value={st.contexto[c.id] || ''}
                        onChange={e => setSt(p => ({ ...p, contexto: { ...p.contexto, [c.id]: e.target.value } }))}

                      />
                      <button
                        type="button"
                        className={`entr__mic${voiceField === c.id ? ' entr__mic--on' : ''}`}
                        onClick={() => toggleVoice(c.id)}
                        title={voiceField === c.id ? 'Detener grabación' : 'Dictar con micrófono'}
                      >
                        <span className="material-symbols-outlined">
                          {voiceField === c.id ? 'mic_off' : 'mic'}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── POSIBLES SOLUCIONES IA ── */}
            <div className="entr__ia-card" id="sec-ia">
              <h2 className="entr__ia-heading">Posibles Soluciones (A.I. 7.0)</h2>
              <p className="entr__ia-hint">
                Al guardar, el pipeline M1–M9 del Formulador AI procesará estos datos de entrada
                y generará automáticamente el análisis de soluciones, marco lógico y presupuesto base.
              </p>
              <div className="entr__contact-block">
                <p className="entr__contact-title">CONTACTO</p>
                <p className="entr__contact-sub">¿Necesitas ayuda técnica?</p>
                <button className="entr__expert-btn">Hablar con un experto</button>
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="entr__footer">
              <button
                className={`entr__save entr__save--lg${guardado ? ' entr__save--saved' : ''}`}
                onClick={guardar}
              >
                {guardado ? '✓ GUARDADO' : 'SAVE'}
              </button>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
