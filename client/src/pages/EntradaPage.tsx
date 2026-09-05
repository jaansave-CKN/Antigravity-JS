/**
 * EntradaPage — Calco estricto Stitch screen "Pestaña #1: Datos de Entrada (Fondo Blanco)"
 * Screen ID: projects/3791086755596777919/screens/5142894009029579964
 * Tokens: bg #f7f9fb · card #ffffff · border #e0e3e5 · text #191c1e · primary #0058be
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthHeaders, http, ApiError } from '../lib/apiClient';
import CountdownReset from '../components/CountdownReset';
import { useAiQuotaStatus } from '../hooks/useAiQuotaStatus';
import './EntradaPage.css';

// FIX (react-doctor client-localstorage-no-version, 2026-09-05): clave
// versionada para que un futuro cambio de forma del estado (ESTADO_INICIAL)
// pueda ignorar datos viejos en vez de romper JSON.parse — NUNCA un renombre
// ciego: este formulario está bajo mandato explícito de cero pérdida de
// datos, así que leerEntradaStorage() migra la clave vieja sin tocar nada
// visible para el usuario.
const STORAGE_KEY = 'radar360_entrada_m1:v1';
const STORAGE_KEY_LEGACY = 'radar360_entrada_m1';
function leerEntradaStorage(): string | null {
  const actual = localStorage.getItem(STORAGE_KEY);
  if (actual) return actual;
  const legado = localStorage.getItem(STORAGE_KEY_LEGACY);
  if (legado) {
    localStorage.setItem(STORAGE_KEY, legado);
    localStorage.removeItem(STORAGE_KEY_LEGACY);
  }
  return legado;
}
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

// REFACTOR (2026-08-22, "flujo secuencial y Campo C multi-componente"): el
// campo 'meta' (C) sale de este array plano — se reemplaza por 4 sub-campos
// interconectados (ver ContextoMetaState/CampoCBlock más abajo). Este array
// queda con 6 entradas (A,B,D,E,F,G) en orden — el índice se usa para la
// máquina de estados de bloqueo secuencial (estaDesbloqueado()). DEBE
// mantenerse sincronizado a mano con CAMPOS_INDIVIDUALES de
// EntradaIAService.js (backend) — si se agrega/quita un campo aquí, también
// allá, o el botón ✨ individual devolverá 400.
const CONTEXTO_CAMPOS = [
  { id: 'situacion_actual', label: 'A. SITUACION ACTUAL SIN PROYECTO', ph: "ej: 'El 80% de las familias consumen agua no potable'" },
  { id: 'linea_base', label: 'B. INDICADOR DE LINEA BASE CUANTIFICABLE', ph: "ej: % de familias sin acceso a energía — Valor actual: 80 — Unidad: %" },
  { id: 'justificacion', label: 'D. JUSTIFICACION DE PRIORIDAD', ph: 'Define la relevancia estratégica del proyecto...' },
  { id: 'sociocultural', label: 'E. ANALISIS SOCIOCULTURAL PARA LA PERTINENCIA', ph: 'Demuestra que la solución es culturalmente pertinente...' },
  { id: 'problema_urgente', label: 'F. ¿QUE PROBLEMA PERCIBE COMO MAS URGENTE?', ph: 'Qué problema percibe como urgente...' },
  { id: 'incertidumbre', label: 'G. CONDICION CRÍTICA DE INCERTIDUMBRE LOGÍSTICA', ph: 'Describa la condición crítica...' },
];

// ── Campo C rediseñado: problemática (IA) + déficit (derivado) + beneficiarios
// (manual, hereda de Sección 06) + % (JS puro, cero IA) ─────────────────────
interface ProblematicaOpcion { problema: string; deficit_valor: number | null; deficit_unidad: string | null }
interface ContextoMetaState {
  problematicas: ProblematicaOpcion[];
  problemaSeleccionado: string;
  beneficiarios: string;
  tipoFormulacion: string;
}

// C-nuevo — modalidad de formulación (MANDATO 2026-08-23): se inserta entre
// Beneficiarios (C3) y % Calculado (C4). Puro estado de formulario + contexto
// para la IA de D/E (buildSystemPromptCampoIndividual) — no participa en
// calcularPorcentajeC4, que sigue siendo JS puro sobre beneficiarios/déficit.
const OPCIONES_TIPO_FORMULACION = ['Proyecto Integral (100%)', 'Prueba Piloto', 'Formulado por Etapas'] as const;
const MODALIDAD_INTEGRAL = OPCIONES_TIPO_FORMULACION[0];

// Sección 11 "Soluciones con AI" (MANDATO 2026-08-24) — hasta 9 propuestas
// generadas por IA (editables, se reemplazan al volver a generar) + 1
// propuesta manual fija que el botón nunca toca. Selección única (radio, no
// checklist múltiple: "escogerá solo 1 de las 10") — unión discriminada en
// vez de un índice plano para no confundir "IA #3" con "manual" por un
// off-by-one si propuestasIA cambia de tamaño entre generaciones.
type SeleccionSolucion = { tipo: 'ia'; index: number } | { tipo: 'manual' } | null;
interface SolucionesState {
  propuestasIA: string[];
  propuestaManual: string;
  seleccion: SeleccionSolucion;
}

function campoTieneContenidoReal(valor: string | undefined): boolean {
  return !!valor?.trim() && valor !== ALERTA_ND;
}

/** Máquina de estados de bloqueo secuencial — index sobre CONTEXTO_CAMPOS
 * (0=A,1=B,2=D,3=E,4=F,5=G). El Campo C se evalúa aparte (campoCDesbloqueado/
 * campoCCompleto) porque ya no vive en este array. */
function estaDesbloqueado(index: number, contexto: Record<string, string>, metaCompleto: boolean): boolean {
  if (index === 0) return true; // A siempre abierto
  if (index === 1) return campoTieneContenidoReal(contexto[CONTEXTO_CAMPOS[0].id]); // B ← A
  if (index === 2) return metaCompleto; // D ← Campo C completo
  return campoTieneContenidoReal(contexto[CONTEXTO_CAMPOS[index - 1].id]); // E,F,G ← anterior
}
function campoCDesbloqueado(contexto: Record<string, string>): boolean {
  return campoTieneContenidoReal(contexto[CONTEXTO_CAMPOS[1].id]); // C ← B
}
function campoCCompleto(contextoMeta: ContextoMetaState): boolean {
  return !!contextoMeta.problemaSeleccionado && !!contextoMeta.beneficiarios?.trim();
}
/** C4 — 100% JS, cero IA. 'N/D' si no hay déficit real o beneficiarios inválido — nunca NaN/Infinity. */
function calcularPorcentajeC4(beneficiarios: string, deficitValor: number | null): string {
  const benefNum = Number(beneficiarios);
  if (!beneficiarios?.trim() || !Number.isFinite(benefNum) || benefNum <= 0) return 'N/D';
  if (deficitValor === null || deficitValor === 0) return 'N/D';
  return `${((benefNum / deficitValor) * 100).toFixed(1)}%`;
}


// ── Estado ─────────────────────────────────────────────────────────────────────

interface EntradaState {
  nombre: string;
  pitch: string;
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
  // Campo C rediseñado (2026-08-22) — dato viejo `contexto.meta` de
  // proyectos ya guardados en producción (string plano) se deja intacto,
  // sin migrar ni mostrar: decisión explícita, C1-C3 arrancan vacíos.
  contextoMeta: ContextoMetaState;
  soluciones: SolucionesState;
  // Candado por campo (mandato 2026-08-24) — protege texto ya generado por
  // IA o escrito a mano contra ediciones accidentales, propias o de una
  // regeneración con IA. Se persiste como cualquier otro campo del
  // formulario (localStorage + SAVE) — un candado cerrado sobrevive a un F5
  // o a volver más tarde, no es solo un estado visual de la sesión.
  camposBloqueados: Record<string, boolean>;
}

const ESTADO_INICIAL: EntradaState = {
  nombre: '', pitch: '', enfoque: '', tipoConvocatoria: '',
  nivelProyecto: '', metodologias: [METODOLOGIA_OBLIGATORIA], formatoFinanciador: '',
  numeroBeneficiarios: '', coberturaGeografica: '',
  sectores: [], sectorOtro: {}, categoriaPoblacion: '', categoriaOtro: {},
  detallePoblacion: [], municipio: '', vereda: '', contexto: {},
  contextoMeta: { problematicas: [], problemaSeleccionado: '', beneficiarios: '', tipoFormulacion: OPCIONES_TIPO_FORMULACION[0] },
  soluciones: { propuestasIA: [], propuestaManual: '', seleccion: null },
  camposBloqueados: {},
};

export default function EntradaPage() {
  const [st, setSt] = useState<EntradaState>(() => {
    try {
      const raw = leerEntradaStorage();
      if (!raw) return ESTADO_INICIAL;
      const parsed = JSON.parse(raw);
      // Merge profundo de contextoMeta/soluciones: una sesión guardada ANTES
      // de estos mandatos (2026-08-23/24) no trae tipoFormulacion ni
      // soluciones — un spread superficial dejaría undefined en vez de
      // heredar el default.
      return {
        ...ESTADO_INICIAL, ...parsed,
        contextoMeta: { ...ESTADO_INICIAL.contextoMeta, ...(parsed.contextoMeta || {}) },
        soluciones: { ...ESTADO_INICIAL.soluciones, ...(parsed.soluciones || {}) },
      };
    } catch { return ESTADO_INICIAL; }
  });
  const [limpiado, setLimpiado] = useState(false);
  // MANDATO (2026-08-24, "indicador de cambios sin guardar", aplica a todas
  // las ventanas del Formulador): dirty-tracking real por comparación de
  // snapshot, no el flash cosmético de 2.2s que había antes (ese no sabía
  // distinguir "nada cambió" de "cambié algo justo después de guardar").
  // ultimoGuardadoRef arranca en null y se fija UNA vez con el guard de abajo
  // (no con el 2º argumento de useRef, que se re-evaluaría — y re-stringify-
  // aría todo el estado — en cada render sin usarse). Se actualiza de nuevo
  // solo cuando: (a) la hidratación async desde servidor trae datos (líneas
  // más abajo) o (b) un guardar() exitoso — nunca de forma optimista.
  const ultimoGuardadoRef = useRef<string | null>(null);
  if (ultimoGuardadoRef.current === null) ultimoGuardadoRef.current = JSON.stringify(st);
  const sinGuardar = JSON.stringify(st) !== ultimoGuardadoRef.current;
  // REFACTOR (2026-08-22): reemplaza el generandoIA global (bloqueaba TODA
  // la sección) — ahora guarda el id del campo en generación ('situacion_actual'…
  // 'incertidumbre', o 'C1' para la lista de problemáticas), null si ninguno.
  const [generandoCampo, setGenerandoCampo] = useState<string | null>(null);
  const [errorIA, setErrorIA] = useState<string | null>(null);
  // Mandato 2026-08-24 ("cronómetro desincronizado tras F5"): retryAtIA ya no
  // es un useState de página — el hook consulta GET /api/ia/estado-cuota al
  // montar, restaurando el bloqueo real si el usuario recarga a mitad de la
  // penalización (antes se perdía y los botones ✨ volvían a habilitarse).
  const { retryAt: retryAtIA, reportarErrorCuota, limpiar: limpiarRetryAtIA } = useAiQuotaStatus();
  const cuotaAgotada = !!retryAtIA;
  // Mismo texto que EntradaIAService.js (rewrap de GeminiPoolExhaustedError) —
  // se muestra cuando retryAtIA llegó por el poll on-mount (F5 a mitad de la
  // penalización) y todavía no hay un errorIA fresco de un clic real.
  const MENSAJE_CUOTA_AGOTADA = 'El límite de uso de IA está agotado por ahora — intenta de nuevo en unos minutos, o llena el formulario manualmente.';
  // Mandato 2026-08-24 ("ModalBYOK — interceptar el bloqueo"): los botones ✨
  // ya NO quedan 100% inactivos durante cuotaAgotada — siguen siendo
  // clicables (ver className `--cooldown` en vez de `disabled`), y el clic
  // dispara este modal de rescate en vez de intentar la generación real.
  // ByokRequiredModal.tsx (montado global en main.tsx) escucha este evento.
  const dispararRescateBYOK = useCallback(() => {
    window.dispatchEvent(new CustomEvent('byok-rescate'));
  }, []);
  // Guarda de re-entrada real (2026-08-25, "sigue quemando tokens sin razón"):
  // evidencia dura en ai_token_logs mostró 2 llamadas reales completas a
  // Gemini con 318ms de diferencia — imposible como doble clic humano. Los
  // `generando*` de useState NO bloquean esto de forma confiable: el atributo
  // `disabled` del botón solo se aplica al DOM después de que React
  // re-renderiza, dejando una ventana real donde un segundo disparo (doble
  // clic, evento duplicado, lo que sea la causa exacta) todavía ve el botón
  // habilitado. Este Set vive en un ref — se marca/revisa de forma síncrona,
  // sin esperar ningún render, así que ninguna llamada real a Gemini puede
  // duplicarse sin importar de dónde venga el segundo disparo.
  const enVueloRef = useRef<Set<string>>(new Set());
  const marcarEnVuelo = (clave: string): boolean => {
    if (enVueloRef.current.has(clave)) return false;
    enVueloRef.current.add(clave);
    return true;
  };
  const liberarEnVuelo = (clave: string) => { enVueloRef.current.delete(clave); };
  const [generandoNombre, setGenerandoNombre] = useState(false);
  // Flag para el useEffect de abajo: sincronizarProyectoActivo() lee `st.nombre`
  // de SU PROPIO closure (useCallback con dep [st.nombre]) — llamarlo justo
  // después de un setSt() en la misma función seguiría viendo el nombre
  // VIEJO (closure de este render, antes de que React re-renderice con el
  // nuevo st.nombre). Este ref le avisa al efecto que corra recién cuando
  // st.nombre YA cambió (siguiente render, closure fresco).
  const sincronizarTrasNombreIA = useRef(false);
  // Pitch (mandato 2026-08-24, campo nuevo debajo de Nombre) — a diferencia
  // de nombre, pitch NO tiene columna propia en `proyectos` (verificado por
  // architect: no existe en ningún esquema/migración) — vive solo dentro de
  // `ficha_tecnica.entrada_completa`, se persiste con el SAVE normal de esta
  // página, sin ningún mecanismo de sincronización especial.
  const [generandoPitch, setGenerandoPitch] = useState(false);
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

  // Candado por campo (mandato 2026-08-24) — bloquea/desbloquea un campo
  // contra ediciones manuales Y contra regeneración con IA. `campoBloqueado`
  // es derivado (nunca estado separado) para que siempre refleje `st` sin
  // riesgo de desincronizarse.
  const campoBloqueado = (id: string) => !!st.camposBloqueados[id];
  const toggleBloqueo = (id: string) =>
    setSt(p => ({ ...p, camposBloqueados: { ...p.camposBloqueados, [id]: !p.camposBloqueados[id] } }));

  // Auto-save: persiste cada cambio sin necesidad de presionar SAVE
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  }, [st]);

  // Hidratación desde servidor SOLO si no había nada en localStorage (ej.
  // primera vez en este navegador/dispositivo) — evita pisar ediciones en
  // curso con una copia potencialmente más vieja del servidor.
  useEffect(() => {
    if (leerEntradaStorage()) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) return;
    (async () => {
      try {
        const body = await fetch(`/api/proyectos/${proyectoId}`, { headers: { ...getAuthHeaders() }, credentials: 'include' })
          .then(r => r.json());
        const entrada = body?.data?.ficha_tecnica?.entrada_completa;
        // Mismo merge profundo que la hidratación desde localStorage arriba
        // (FIX 2026-08-24) — este camino solo corre cuando NO hay nada en
        // localStorage (primera vez en el navegador), pero el objeto que
        // llega del servidor puede ser igual de viejo/incompleto.
        // FIX (react-doctor no-impure-state-updater, 2026-09-05): el merge y
        // la escritura del ref vivían dentro del updater de setSt — React
        // puede reintentar/descartar un updater, así que un side effect ahí
        // (el ref write) no es seguro. Este efecto corre una sola vez
        // ([] deps) al montar, así que `st` del closure es equivalente a
        // `prev` en la ejecución real — se calcula el merge fuera y se llama
        // setSt con el valor ya resuelto.
        if (entrada) {
          const merged = {
            ...st, ...entrada,
            contextoMeta: { ...st.contextoMeta, ...(entrada.contextoMeta || {}) },
            soluciones: { ...st.soluciones, ...(entrada.soluciones || {}) },
          };
          // Esto ES la última copia sincronizada con el servidor — fijarla
          // como línea base de "guardado" para que el botón no aparezca en
          // rojo (sinGuardar) apenas termina de cargar, sin que el usuario
          // haya tocado nada todavía.
          ultimoGuardadoRef.current = JSON.stringify(merged);
          setSt(merged);
        }
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
  // FIX (2026-08-24, "diferenciar Nombre del Proyecto de Nombre del
  // Archivo"): antes el dedup de este blur comparaba contra
  // ACTIVE_PROJECT_NAME_KEY — esa key ahora es propiedad exclusiva de
  // ProyectoSelectorModal.tsx (guarda nombre_archivo, el identificador
  // corto), así que compararla contra el nombre largo de este campo nunca
  // coincidiría. Este ref lleva su propio registro de "último nombre de
  // proyecto (el texto largo) sincronizado con el servidor" — arranca en
  // null a propósito: el primer blur después de cargar la página siempre
  // dispara un PATCH idempotente (mismo valor ya guardado, sin efecto real),
  // que es preferible a intentar adivinar el valor server-side sin haberlo
  // leído todavía.
  const ultimoNombreProyectoSincronizadoRef = useRef<string | null>(null);

  const sincronizarProyectoActivo = useCallback(async () => {
    const nombre = st.nombre.trim();
    if (!nombre || sincronizandoProyectoRef.current) return;
    if (nombre === ultimoNombreProyectoSincronizadoRef.current) return; // nada que sincronizar

    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);

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
        // Proyecto recién creado: todavía no tiene un "Nombre de Archivo"
        // propio (se edita desde ProyectoSelectorModal.tsx) — se siembra UNA
        // vez con el valor que el propio backend derivó (nombre truncado a
        // 60 chars, ver proyectos.routes.js) para que el header "Archivo:"
        // no quede vacío hasta que el usuario abra el selector.
        localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, body.nombreArchivo || nombre);
      } else {
        const res = await fetch(`/api/proyectos/${proyectoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          credentials: 'include',
          body: JSON.stringify({ nombre }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo actualizar el nombre del proyecto.');
        // NO se toca ACTIVE_PROJECT_NAME_KEY aquí — "Nombre de Archivo" es
        // propiedad exclusiva de ProyectoSelectorModal.tsx desde este fix;
        // pisarlo con el nombre largo en cada blur era justo el bug
        // reportado por el usuario.
      }
      ultimoNombreProyectoSincronizadoRef.current = nombre;
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

  // Ver comentario de sincronizarTrasNombreIA arriba — corre en el render
  // SIGUIENTE al setSt del nombre generado por IA, cuando sincronizarProyectoActivo
  // ya tiene el st.nombre nuevo en su closure.
  useEffect(() => {
    if (sincronizarTrasNombreIA.current) {
      sincronizarTrasNombreIA.current = false;
      sincronizarProyectoActivo();
    }
  }, [st.nombre, sincronizarProyectoActivo]);

  const [errorEntradaCompleta, setErrorEntradaCompleta] = useState<string | null>(null);
  // FIX (2026-08-24, "audita la demora — el botón no da ninguna señal de que
  // el clic se registró"): guardar() no tenía NINGÚN estado de "en curso" —
  // el botón se quedaba diciendo "SAVE" en rojo, sin diferencia visual entre
  // "no he tocado nada" y "hay un PATCH en vuelo". Mismo patrón ya usado en
  // ContextoPage.tsx/PresupuestoPage.tsx (botón deshabilitado + "Guardando…"
  // mientras dura la petición).
  const [guardando, setGuardando] = useState(false);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): `if (guardando) return` leía estado de React, que no se
  // actualiza sincrónicamente entre 2 invocaciones en el mismo tick (antes
  // del primer re-render) — un ref sí protege contra eso.
  const guardandoRef = useRef(false);

  const guardar = async () => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));

    // Antes SAVE solo escribía localStorage — de las 11 secciones de Entrada
    // solo "nombre" llegaba al servidor (vía sincronizarProyectoActivo). Aquí
    // se persiste el resto (enfoque, sectores, población, contexto, etc.)
    // como una clave dentro de ficha_tecnica, igual que ya hace ContextoPage.
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    // FIX (2026-08-24, "SAVE se queda en rojo sin ningún aviso"): antes esto
    // era un `return` mudo — sin proyecto activo, el botón se quedaba rojo
    // para siempre sin ninguna pista de por qué. Ahora se avisa explícito,
    // igual que el catch de abajo cuando el PATCH sí se intenta y falla.
    if (!proyectoId) {
      setErrorEntradaCompleta('No hay proyecto activo — se guardó localmente, pero no se pudo sincronizar con el servidor.');
      guardandoRef.current = false;
      setGuardando(false);
      return;
    }
    try {
      await http.patch(`/api/proyectos/${proyectoId}/ficha-tecnica-merge`, { key: 'entrada_completa', value: st });
      // FIX (2026-08-24, "verde/rojo puro, sin estado neutral"): actualizar
      // ultimoGuardadoRef tras éxito confirmado es LO ÚNICO que hace falta —
      // sinGuardar (derivado, ver arriba) pasa a false solo. Si el PATCH
      // falla, ultimoGuardadoRef NO se actualiza, así que sinGuardar sigue en
      // true (rojo) — refleja la realidad: el servidor no tiene la última
      // versión todavía.
      ultimoGuardadoRef.current = JSON.stringify(st);
      setErrorEntradaCompleta(null);
    } catch {
      setErrorEntradaCompleta('Se guardó localmente, pero no se pudo sincronizar con el servidor.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const limpiar = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_LEGACY);
    // Limpieza total: incluso las metodologías con valor por defecto (Marco Lógico)
    // quedan sin marcar — LIMPIAR deja el formulario completamente en blanco.
    setSt({ ...JSON.parse(JSON.stringify(ESTADO_INICIAL)), metodologias: [] });
    setVoiceField(null);
    recRef.current?.stop();
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  // Mensaje de error uniforme para las 3 llamadas de IA de esta sección —
  // mismo criterio ya establecido (2026-08-22): un 401 aquí es señal de
  // sesión realmente perdida (auth.middleware.js solo responde "Token
  // requerido"/similar), nunca se muestra el string crudo del backend.
  const manejarErrorIA = useCallback((e: unknown) => {
    // retryAt (mandato 2026-08-24, "reloj con cuenta regresiva y hora exacta
    // de reset"): viene en el body del 429 cuando el backend lo tiene (ver
    // entradaIA.routes.js) — momento real reportado por Google, no una
    // espera fija inventada.
    const body = e instanceof ApiError ? e.body as { retryAt?: string } | undefined : undefined;
    if (body?.retryAt) reportarErrorCuota(body.retryAt);
    if (e instanceof ApiError && e.status === 401) {
      setErrorIA('Tu sesión no es válida o expiró. Recarga la página e inicia sesión de nuevo.');
    } else {
      setErrorIA(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'No se pudo generar con IA — inténtalo de nuevo.'));
    }
  }, [reportarErrorCuota]);

  // Botón ✨ individual (REFACTOR 2026-08-22, reemplaza al botón global) —
  // genera SOLO el campo indicado (A,B,D,E,F,G — nunca 'meta'/C, que tiene su
  // propio flujo abajo). Manda el contexto previo ya escrito y la demografía
  // de Sección 06 al backend, tal como exige el mandato. Sobrescribe el valor
  // actual del campo (acción explícita del usuario al pulsar el botón de ESE
  // campo específico) — distinto del viejo merge "solo si está vacío".
  const generarCampoConIA = async (campoId: string) => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo(`campo:${campoId}`)) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo(`campo:${campoId}`); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoCampo(campoId);
    setErrorIA(null);
    try {
      const resp = await http.post<{ success: boolean; data?: { valor: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-campo`,
        {
          campo: campoId,
          contextoPrevio: st.contexto,
          demografia: {
            beneficiarios: st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      if (!resp.data) throw new Error(resp.message || 'La IA no devolvió datos.');
      const valor = resp.data.valor;
      setSt(prev => ({
        ...prev,
        contexto: { ...prev.contexto, [campoId]: valor === ND_INVESTIGACION ? ALERTA_ND : (valor || '') },
      }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoCampo(null);
      liberarEnVuelo(`campo:${campoId}`);
    }
  };

  // "Generar con AI" del Nombre del Proyecto (mandato 2026-08-24) — combina
  // Diálectica (tono/lista de oro/lista negra) + Evaluación de Impacto
  // Integral + lo ya escrito en Entrada. Sobrescribe el nombre actual (acción
  // explícita del usuario, mismo criterio que generarCampoConIA) y dispara
  // sincronizarProyectoActivo() (vía el efecto de arriba) para que la columna
  // real `proyectos.nombre` quede al día, no solo el estado local — sin esto
  // el nombre generado por IA se ve en pantalla pero no llega al servidor
  // hasta el próximo blur manual del campo.
  const generarNombreConIA = async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('nombre')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('nombre'); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoNombre(true);
    setErrorIA(null);
    try {
      const problematica = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado) || null;
      const resp = await http.post<{ success: boolean; data?: { nombre: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-nombre`,
        {
          contextoPrevio: st.contexto,
          problematica: problematica ? { problema: problematica.problema, deficit_valor: problematica.deficit_valor, deficit_unidad: problematica.deficit_unidad } : null,
          demografia: {
            beneficiarios: st.contextoMeta.beneficiarios || st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      if (!resp.data?.nombre) throw new Error(resp.message || 'La IA no devolvió un nombre.');
      sincronizarTrasNombreIA.current = true;
      setSt(prev => ({ ...prev, nombre: resp.data!.nombre }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoNombre(false);
      liberarEnVuelo('nombre');
    }
  };

  // "Generar con AI" del Pitch (mandato 2026-08-24) — mismas fuentes que
  // generarNombreConIA. A diferencia del nombre, pitch no toca
  // sincronizarProyectoActivo() (no tiene columna propia, ver comentario en
  // su useState) — el setSt es suficiente, se persiste con el SAVE normal.
  const generarPitchConIA = async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('pitch')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('pitch'); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoPitch(true);
    setErrorIA(null);
    try {
      const problematica = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado) || null;
      const resp = await http.post<{ success: boolean; data?: { pitch: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-pitch`,
        {
          contextoPrevio: st.contexto,
          problematica: problematica ? { problema: problematica.problema, deficit_valor: problematica.deficit_valor, deficit_unidad: problematica.deficit_unidad } : null,
          demografia: {
            beneficiarios: st.contextoMeta.beneficiarios || st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      if (!resp.data?.pitch) throw new Error(resp.message || 'La IA no devolvió un pitch.');
      setSt(prev => ({ ...prev, pitch: resp.data!.pitch }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoPitch(false);
      liberarEnVuelo('pitch');
    }
  };

  // FIX CRÍTICO (2026-08-23, auditoría "gasto injustificado de token"): la
  // versión anterior de este auto-disparo dependía de `st.contexto.linea_base`
  // — cambia en CADA tecla que el usuario escribe en el Campo B. Su única
  // guarda ("problematicas.length === 0") NO distingue "nunca se intentó" de
  // "se intentó y falló" (429, red, etc.) — con Gemini agotado, cada tecla
  // siguiente en B volvía a disparar una llamada real a Gemini en silencio,
  // sin que el usuario lo pidiera. `intentoAutoCargaRef` marca el intento
  // apenas arranca (no solo si tuvo éxito) y sobrevive a errores.
  //
  // FIX #2 (2026-08-24, auditoría de RAÍZ pedida tras "falta de saldo cuando
  // sí hay"): el fix de arriba solo cubría "una vez por MONTAJE del
  // componente" — un `useRef` se reinicia en cada recarga/navegación. En una
  // sesión con muchos F5 (como cualquier sesión de prueba real), cada recarga
  // volvía a disparar una llamada real a Gemini en silencio, sin ningún clic
  // — consumo invisible que no aparecía como "algo que el usuario pidió"
  // pero sí contaba contra el mismo cupo de 20 req/min compartido. Ahora
  // persiste en localStorage por proyecto: una sola vez por proyecto, para
  // siempre, hasta que el usuario reintente a mano con "🔄 Volver a leer".
  const intentoAutoCargaRef = useRef(false);
  const claveAutoCarga = (proyectoId: string) => `radar360_c1_autocarga_${proyectoId}`;

  // C1 — lista de problemáticas + déficit detectadas en Anexos/Investigación.
  // Se auto-dispara la primera vez que el Campo C se desbloquea (useEffect
  // abajo); el botón "🔄 Volver a leer" permite regenerarla a mano.
  const cargarProblematicas = useCallback(async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('C1')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('C1'); return; }
    setGenerandoCampo('C1');
    setErrorIA(null);
    try {
      const resp = await http.post<{ success: boolean; data?: { problematicas: ProblematicaOpcion[] }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-problematicas`,
        { demografia: { beneficiarios: st.numeroBeneficiarios, cobertura: st.coberturaGeografica } }
      );
      setSt(prev => ({ ...prev, contextoMeta: { ...prev.contextoMeta, problematicas: resp.data?.problematicas || [] } }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoCampo(null);
      liberarEnVuelo('C1');
    }
  }, [st.numeroBeneficiarios, st.coberturaGeografica, cuotaAgotada, dispararRescateBYOK, manejarErrorIA]);

  // Sección 11 "Soluciones con AI" (MANDATO 2026-08-24) — hasta 9 propuestas
  // candidatas; la 10ª (manual) NUNCA se toca aquí. Regenerar reemplaza SOLO
  // propuestasIA (mismo criterio que generarCampoConIA: sobrescribe al
  // pulsar el botón, acción explícita del usuario) y limpia la selección si
  // apuntaba a un slot de IA — el texto que tenía seleccionado ya no existe.
  const generarSoluciones = async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('SOLUCIONES')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('SOLUCIONES'); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoCampo('SOLUCIONES');
    setErrorIA(null);
    try {
      const resp = await http.post<{ success: boolean; data?: { soluciones: string[] }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-soluciones`,
        {
          contextoPrevio: st.contexto,
          demografia: {
            beneficiarios: st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      const nuevas = resp.data?.soluciones || [];
      setSt(prev => ({
        ...prev,
        soluciones: {
          ...prev.soluciones,
          propuestasIA: nuevas,
          seleccion: prev.soluciones.seleccion?.tipo === 'ia' ? null : prev.soluciones.seleccion,
        },
      }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoCampo(null);
      liberarEnVuelo('SOLUCIONES');
    }
  };

  // Auto-carga de problemáticas apenas el Campo C se desbloquea (B tiene
  // contenido real) — UNA SOLA VEZ por sesión de la pestaña, éxito o fracaso
  // (ver fix arriba). El usuario puede recargar a mano con el botón 🔄.
  useEffect(() => {
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const yaAutoIntentado = intentoAutoCargaRef.current || (proyectoId && localStorage.getItem(claveAutoCarga(proyectoId)) === '1');
    if (campoCDesbloqueado(st.contexto) && !yaAutoIntentado && generandoCampo !== 'C1') {
      intentoAutoCargaRef.current = true;
      if (proyectoId) localStorage.setItem(claveAutoCarga(proyectoId), '1');
      cargarProblematicas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.contexto.linea_base]);

  // AJUSTE (2026-08-23, pedido explícito con captura): el módulo 06
  // "Población Objetivo" (input dedicado de Beneficiarios/Cobertura)
  // desaparece de la UI — Beneficiarios ahora se escribe una sola vez en C3
  // (Contexto del Problema), y Cobertura ya vive en el módulo 10 (Municipio/
  // Vereda, más granular). numeroBeneficiarios/coberturaGeografica de
  // EntradaState SIGUEN existiendo (server.js, viabilidadAgent.js y
  // FichaTecnicaPage.tsx los leen) — ya no tienen input propio, se
  // sincronizan en un solo sentido desde sus nuevas fuentes reales.
  useEffect(() => {
    if (st.contextoMeta.beneficiarios !== st.numeroBeneficiarios) {
      setSt(prev => ({ ...prev, numeroBeneficiarios: prev.contextoMeta.beneficiarios }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.contextoMeta.beneficiarios]);

  // FIX (2026-08-24, pedido explícito con captura): si el usuario edita
  // cualquier sub-campo de C (problemática, beneficiarios o tipoFormulacion)
  // DESPUÉS de que D/E/F/G ya tienen respuesta, ese texto quedó redactado
  // sobre datos viejos de Meta Esperada — se borra para forzar una
  // regeneración explícita en vez de dejar una respuesta desactualizada.
  // camposCPrevRef arranca en null y en el primer render solo GUARDA la
  // firma sin borrar nada — evita que la restauración desde localStorage
  // (que también "cambia" estos valores al montar) dispare un borrado.
  const camposCPrevRef = useRef<string | null>(null);
  useEffect(() => {
    const firma = JSON.stringify([
      st.contextoMeta.problemaSeleccionado,
      st.contextoMeta.beneficiarios,
      st.contextoMeta.tipoFormulacion,
    ]);
    if (camposCPrevRef.current === null) {
      camposCPrevRef.current = firma;
      return;
    }
    if (camposCPrevRef.current !== firma) {
      camposCPrevRef.current = firma;
      const idsDependientesDeC = ['justificacion', 'sociocultural', 'problema_urgente', 'incertidumbre']; // D,E,F,G
      setSt(prev => {
        const nuevoContexto = { ...prev.contexto };
        let tocoContexto = false;
        idsDependientesDeC.forEach(id => {
          if (nuevoContexto[id]?.trim()) { delete nuevoContexto[id]; tocoContexto = true; }
        });
        // EXTENSIÓN (2026-08-24, pedido explícito con captura): "el
        // planteamiento y/o las opciones del punto C cambia todo" — las 10
        // propuestas de Soluciones (9 IA + la manual) también se redactaron
        // sobre el C viejo, así que se borran igual que D-G, sin excepción
        // para la manual (a diferencia de "regenerar con IA", que sí la
        // preserva — aquí el usuario pidió borrar las 10 sin distinción).
        const huboSoluciones = prev.soluciones.propuestasIA.length > 0 || !!prev.soluciones.propuestaManual.trim() || prev.soluciones.seleccion !== null;
        if (!tocoContexto && !huboSoluciones) return prev;
        return {
          ...prev,
          contexto: nuevoContexto,
          soluciones: huboSoluciones ? { propuestasIA: [], propuestaManual: '', seleccion: null } : prev.soluciones,
        };
      });
    }
  }, [st.contextoMeta.problemaSeleccionado, st.contextoMeta.beneficiarios, st.contextoMeta.tipoFormulacion]);

  // FIX (2026-08-24, pedido explícito con captura): en modalidad "Proyecto
  // Integral (100%)" Beneficiarios deja de ser manual — se iguala SIEMPRE al
  // déficit de la problemática elegida (por eso el % de C4 da exactamente
  // 100%). Se recalcula si cambia la problemática (déficit distinto) sin que
  // el usuario tenga que volver a tocar el selector de modalidad. Si el
  // déficit es ND (null), no hay cifra real que copiar — el campo se deja en
  // blanco/manual en vez de inventar un número.
  useEffect(() => {
    if (st.contextoMeta.tipoFormulacion !== MODALIDAD_INTEGRAL) return;
    const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
    const deficit = sel?.deficit_valor ?? null;
    const deseado = deficit !== null ? String(deficit) : '';
    if (st.contextoMeta.beneficiarios !== deseado) {
      setSt(prev => ({ ...prev, contextoMeta: { ...prev.contextoMeta, beneficiarios: deseado } }));
    }
  }, [st.contextoMeta.tipoFormulacion, st.contextoMeta.problemaSeleccionado, st.contextoMeta.problematicas, st.contextoMeta.beneficiarios]);

  // FIX (2026-08-24, pedido explícito con captura): en "Formulado por Etapas"
  // el % de C4 NUNCA puede llegar a 100% — por definición esta modalidad
  // cubre el déficit en fases, nunca de una sola vez. Si Beneficiarios llega
  // a igualar o superar el déficit (ya sea tecleado a mano o heredado de un
  // cambio previo de modalidad, ej. venir de "Proyecto Integral"), se topa
  // en déficit-1 — el mínimo ajuste que garantiza <100% sin inventar un tope
  // arbitrario (ej. 95%) que nadie pidió.
  useEffect(() => {
    if (st.contextoMeta.tipoFormulacion !== 'Formulado por Etapas') return;
    const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
    const deficit = sel?.deficit_valor ?? null;
    if (deficit === null) return; // sin déficit real (ND), nada que topar
    const actual = Number(st.contextoMeta.beneficiarios);
    if (!Number.isFinite(actual) || actual < deficit) return;
    const topado = String(Math.max(0, deficit - 1));
    if (st.contextoMeta.beneficiarios !== topado) {
      setSt(prev => ({ ...prev, contextoMeta: { ...prev.contextoMeta, beneficiarios: topado } }));
    }
  }, [st.contextoMeta.tipoFormulacion, st.contextoMeta.problemaSeleccionado, st.contextoMeta.problematicas, st.contextoMeta.beneficiarios]);

  useEffect(() => {
    const cobertura = [st.municipio.trim(), st.vereda.trim()].filter(Boolean).join(', ');
    if (cobertura && cobertura !== st.coberturaGeografica) {
      setSt(prev => ({ ...prev, coberturaGeografica: cobertura }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.municipio, st.vereda]);

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
            className={`entr__save${sinGuardar ? ' entr__save--dirty' : ' entr__save--saved'}`}
            onClick={guardar}
            disabled={guardando}
            style={{ opacity: guardando ? 0.6 : 1, cursor: guardando ? 'not-allowed' : 'pointer' }}
            title={sinGuardar ? 'Hay cambios sin guardar' : undefined}
          >
            {guardando ? 'Guardando…' : sinGuardar ? 'SAVE' : '✓ GUARDADO'}
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
              <div className="entr__textarea-wrap">
                <textarea
                  id="entr-nombre"
                  className="entr__input entr__input--nombre"
                  rows={3}
                  placeholder="Escriba el nombre del proyecto..."
                  value={st.nombre}
                  disabled={campoBloqueado('nombre')}
                  onChange={e => setSt(p => ({ ...p, nombre: e.target.value }))}
                  onBlur={sincronizarProyectoActivo}
                />
                <button
                  type="button"
                  className={`entr__lock-btn entr__lock-btn--solo${campoBloqueado('nombre') ? ' entr__lock-btn--locked' : ''}`}
                  onClick={() => toggleBloqueo('nombre')}
                  title={campoBloqueado('nombre') ? 'Desbloquear campo' : 'Bloquear campo (protege el texto contra edición o regeneración con IA)'}
                >
                  <span className="material-symbols-outlined">{campoBloqueado('nombre') ? 'lock' : 'lock_open'}</span>
                </button>
                <button
                  type="button"
                  className={`entr__ai-btn-sm entr__ai-btn-sm--solo${cuotaAgotada ? ' entr__ai-btn-sm--cooldown' : ''}`}
                  disabled={generandoNombre || campoBloqueado('nombre')}
                  onClick={generarNombreConIA}
                  title="Generar nombre con IA (usa Diálectica, Impacto Integral y lo ya escrito en Entrada)"
                >
                  <span className="material-symbols-outlined">{generandoNombre ? 'progress_activity' : 'auto_awesome'}</span>
                </button>
              </div>
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
              {(errorIA || retryAtIA) && (
                <span role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                  {errorIA || MENSAJE_CUOTA_AGOTADA}
                  {retryAtIA && <><br /><CountdownReset retryAt={retryAtIA} onExpire={() => { setErrorIA(null); limpiarRetryAtIA(); }} /></>}
                </span>
              )}
            </div>

            {/* ── PITCH DEL PROYECTO (mandato 2026-08-24) ── */}
            <div className="entr__card" id="sec-pitch">
              <label className="entr__nombre-label" htmlFor="entr-pitch">
                PITCH DEL PROYECTO
              </label>
              <div className="entr__textarea-wrap">
                <textarea
                  id="entr-pitch"
                  className="entr__textarea"
                  rows={4}
                  placeholder="Escriba el pitch del proyecto..."
                  value={st.pitch}
                  disabled={campoBloqueado('pitch')}
                  onChange={e => setSt(p => ({ ...p, pitch: e.target.value }))}
                />
                <button
                  type="button"
                  className={`entr__lock-btn entr__lock-btn--solo${campoBloqueado('pitch') ? ' entr__lock-btn--locked' : ''}`}
                  onClick={() => toggleBloqueo('pitch')}
                  title={campoBloqueado('pitch') ? 'Desbloquear campo' : 'Bloquear campo (protege el texto contra edición o regeneración con IA)'}
                >
                  <span className="material-symbols-outlined">{campoBloqueado('pitch') ? 'lock' : 'lock_open'}</span>
                </button>
                <button
                  type="button"
                  className={`entr__ai-btn-sm entr__ai-btn-sm--solo${cuotaAgotada ? ' entr__ai-btn-sm--cooldown' : ''}`}
                  disabled={generandoPitch || campoBloqueado('pitch')}
                  onClick={generarPitchConIA}
                  title="Generar pitch con IA (usa Diálectica, Impacto Integral y lo ya escrito en Entrada)"
                >
                  <span className="material-symbols-outlined">{generandoPitch ? 'progress_activity' : 'auto_awesome'}</span>
                </button>
              </div>
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

            {/* AJUSTE (2026-08-23, pedido explícito con captura): el módulo
                06 "Población Objetivo" (input de Beneficiarios/Cobertura)
                se elimina de la UI — desde aquí en adelante Beneficiarios se
                escribe una sola vez en C3 (Contexto del Problema, más abajo)
                y Cobertura ya vive en el módulo 10 (Municipio/Vereda). Los
                datos de numeroBeneficiarios/coberturaGeografica se siguen
                sincronizando en el estado (ver useEffect junto a
                cargarProblematicas) para no romper server.js/
                viabilidadAgent.js/FichaTecnicaPage.tsx, que sí los leen. */}

            {/* ── 06 SECTOR ── */}
            <div className="entr__card" id="sec-sector">
              <div className="entr__card-header">
                <span className="entr__step-badge">06</span>
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

            {/* ── 07 CATEGORÍA POBLACIÓN ── */}
            <div className="entr__card" id="sec-poblacion">
              <div className="entr__card-header">
                <span className="entr__step-badge">07</span>
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

            {/* ── 08 DETALLE POBLACIÓN ── */}
            <div className="entr__card" id="sec-detalle">
              <div className="entr__card-header">
                <span className="entr__step-badge">08</span>
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

            {/* ── 09 UBICACIÓN GEOGRÁFICA ── */}
            <div className="entr__card" id="sec-geo">
              <div className="entr__card-header">
                <span className="entr__step-badge">09</span>
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

            {/* ── 10 CONTEXTO DEL PROBLEMA ──
                REFACTOR (2026-08-22, "flujo secuencial y Campo C multi-
                componente"): sin botón global — cada campo A,B,D,E,F,G tiene
                su propio botón ✨, y se habilita solo cuando el anterior en
                el orden MGA (A→B→C→D→E→F→G) ya tiene contenido real. Sin
                fuente Stitch propia para esta estructura (ver comentarios de
                estaDesbloqueado/.entr__ai-btn-sm/.entr__campo-c-grid) —
                reutiliza tokens ya existentes de esta misma hoja de estilos. */}
            <div className="entr__card" id="sec-contexto">
              <div className="entr__card-header">
                <span className="entr__step-badge">10</span>
                <h2 className="entr__section-heading">Contexto del Problema</h2>
              </div>
              {(errorIA || retryAtIA) && (
                <div role="alert" style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '6px 10px', borderRadius: 6, marginBottom: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span>{errorIA || MENSAJE_CUOTA_AGOTADA}</span>
                  {retryAtIA && <CountdownReset retryAt={retryAtIA} onExpire={() => { setErrorIA(null); limpiarRetryAtIA(); }} />}
                </div>
              )}
              <p className="entr__section-hint">Caracterice la situación problemática que el proyecto busca resolver — complete cada paso en orden; el siguiente se habilita al llenar el actual.</p>
              <div className="entr__context-list">
                {/* A, B */}
                {CONTEXTO_CAMPOS.slice(0, 2).map((c, i) => {
                  const desbloqueado = estaDesbloqueado(i, st.contexto, campoCCompleto(st.contextoMeta));
                  const bloqueado = campoBloqueado(c.id);
                  return (
                    <div key={c.id}>
                      <label className="entr__field-label" htmlFor={`entr-${c.id}`}>{c.label}</label>
                      <div className="entr__textarea-wrap">
                        <textarea
                          id={`entr-${c.id}`}
                          className={`entr__textarea entr__textarea--con-candado${st.contexto[c.id] === ALERTA_ND ? ' entr__textarea--alerta' : ''}`}
                          rows={1}
                          placeholder={c.ph}
                          value={st.contexto[c.id] || ''}
                          disabled={!desbloqueado || bloqueado}
                          onChange={e => setSt(p => ({ ...p, contexto: { ...p.contexto, [c.id]: e.target.value } }))}
                        />
                        <button
                          type="button"
                          className={`entr__lock-btn${bloqueado ? ' entr__lock-btn--locked' : ''}`}
                          disabled={!desbloqueado}
                          onClick={() => toggleBloqueo(c.id)}
                          title={bloqueado ? 'Desbloquear campo' : 'Bloquear campo (protege el texto contra edición o regeneración con IA)'}
                        >
                          <span className="material-symbols-outlined">{bloqueado ? 'lock' : 'lock_open'}</span>
                        </button>
                        <button
                          type="button"
                          className={`entr__ai-btn-sm${cuotaAgotada ? ' entr__ai-btn-sm--cooldown' : ''}`}
                          disabled={!desbloqueado || bloqueado || generandoCampo === c.id}
                          onClick={() => generarCampoConIA(c.id)}
                          title="Generar con IA (lee Anexos/Investigación)"
                        >
                          <span className="material-symbols-outlined">{generandoCampo === c.id ? 'progress_activity' : 'auto_awesome'}</span>
                        </button>
                        <button
                          type="button"
                          className={`entr__mic${voiceField === c.id ? ' entr__mic--on' : ''}`}
                          disabled={!desbloqueado || bloqueado}
                          onClick={() => toggleVoice(c.id)}
                          title={voiceField === c.id ? 'Detener grabación' : 'Dictar con micrófono'}
                        >
                          <span className="material-symbols-outlined">
                            {voiceField === c.id ? 'mic_off' : 'mic'}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Campo C — 5 sub-campos interconectados (Problemática, Déficit,
                    Beneficiarios, Tipo de formulación, % Calculado) */}
                <div>
                  <label className="entr__field-label">C. META ESPERADA — PROBLEMÁTICA, DÉFICIT Y COBERTURA</label>
                  <div className="entr__campo-c-grid">
                    <select
                      className="entr__campo-c-select"
                      disabled={!campoCDesbloqueado(st.contexto)}
                      value={st.contextoMeta.problemaSeleccionado}
                      onChange={e => setSt(p => ({
                        ...p,
                        // FIX (2026-08-24, pedido explícito con captura): cambiar
                        // de problemática borra Beneficiarios — los beneficiarios
                        // de un déficit de acueducto no pueden seguir puestos al
                        // cambiar a un déficit de infraestructura educativa (ej.
                        // el bug reportado: 100 beneficiarios sobre un déficit de
                        // 4 aulas = 2500%). En modalidad "Proyecto Integral" esto
                        // no deja el campo vacío de verdad: el efecto de
                        // autocompletado de arriba lo vuelve a llenar de inmediato
                        // con el déficit de la problemática nueva.
                        contextoMeta: { ...p.contextoMeta, problemaSeleccionado: e.target.value, beneficiarios: '' },
                      }))}
                      title="C1 — Problemática detectada por IA en Anexos/Investigación"
                    >
                      <option value="">{generandoCampo === 'C1' ? 'Cargando problemáticas…' : 'Selecciona una problemática…'}</option>
                      {st.contextoMeta.problematicas.map(p => (
                        <option key={p.problema} value={p.problema}>{p.problema}</option>
                      ))}
                    </select>
                    <div
                      className="entr__campo-c-readonly"
                      title="C2 — Déficit total asociado a la problemática elegida (automático, no editable)"
                    >
                      {(() => {
                        const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
                        if (!sel) return '—';
                        return sel.deficit_valor !== null ? `${sel.deficit_valor} ${sel.deficit_unidad || ''}`.trim() : ND_INVESTIGACION;
                      })()}
                    </div>
                    {(() => {
                      const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
                      const autoIntegral = st.contextoMeta.tipoFormulacion === MODALIDAD_INTEGRAL && (sel?.deficit_valor ?? null) !== null;
                      return (
                        <input
                          className="entr__campo-c-input"
                          type="number"
                          placeholder="Beneficiarios"
                          title={autoIntegral
                            ? 'C3 — Beneficiarios (automático: igual al déficit total en modalidad "Proyecto Integral")'
                            : 'C3 — Beneficiarios (hereda de Sección 06, editable)'}
                          disabled={!campoCDesbloqueado(st.contexto) || autoIntegral}
                          value={st.contextoMeta.beneficiarios}
                          onChange={e => setSt(p => ({ ...p, contextoMeta: { ...p.contextoMeta, beneficiarios: e.target.value } }))}
                        />
                      );
                    })()}
                    <select
                      className="entr__campo-c-select"
                      disabled={!campoCDesbloqueado(st.contexto)}
                      value={st.contextoMeta.tipoFormulacion}
                      onChange={e => {
                        const nuevoTipo = e.target.value;
                        // FIX (2026-08-24, pedido explícito con captura): elegir
                        // Piloto o Etapas borra Beneficiarios para que el usuario
                        // lo escriba a mano — decisión confirmada explícitamente:
                        // "Proyecto Integral" NO entra aquí, sigue autocompletando
                        // con el déficit (efecto de arriba, sin tocar este cambio).
                        const debeBorrarBeneficiarios = nuevoTipo === OPCIONES_TIPO_FORMULACION[1] || nuevoTipo === OPCIONES_TIPO_FORMULACION[2];
                        setSt(p => ({
                          ...p,
                          contextoMeta: {
                            ...p.contextoMeta,
                            tipoFormulacion: nuevoTipo,
                            beneficiarios: debeBorrarBeneficiarios ? '' : p.contextoMeta.beneficiarios,
                          },
                        }));
                      }}
                      title="Modalidad de formulación — contexto para la IA al redactar Justificación (D) y Análisis Sociocultural (E)"
                    >
                      {OPCIONES_TIPO_FORMULACION.map(op => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                    <div className="entr__campo-c-readonly" title="C4 — % Beneficiarios/Déficit, calculado en JS puro (cero IA)">
                      {calcularPorcentajeC4(
                        st.contextoMeta.beneficiarios,
                        st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado)?.deficit_valor ?? null
                      )}
                    </div>
                  </div>
                  {campoCDesbloqueado(st.contexto) && (
                    <button
                      type="button"
                      onClick={cargarProblematicas}
                      disabled={generandoCampo === 'C1'}
                      style={{ marginTop: 6, background: 'none', border: 'none', color: cuotaAgotada ? '#b45309' : '#7c3aed', fontSize: 11, cursor: generandoCampo === 'C1' ? 'default' : 'pointer', padding: 0 }}
                    >
                      {generandoCampo === 'C1' ? 'Cargando…' : '🔄 Volver a leer Anexos/Investigación'}
                    </button>
                  )}
                </div>

                {/* D, E, F, G */}
                {CONTEXTO_CAMPOS.slice(2).map((c, i) => {
                  const index = i + 2;
                  const desbloqueado = estaDesbloqueado(index, st.contexto, campoCCompleto(st.contextoMeta));
                  const bloqueado = campoBloqueado(c.id);
                  return (
                    <div key={c.id}>
                      <label className="entr__field-label" htmlFor={`entr-${c.id}`}>{c.label}</label>
                      <div className="entr__textarea-wrap">
                        <textarea
                          id={`entr-${c.id}`}
                          className={`entr__textarea entr__textarea--con-candado${st.contexto[c.id] === ALERTA_ND ? ' entr__textarea--alerta' : ''}`}
                          rows={1}
                          placeholder={c.ph}
                          value={st.contexto[c.id] || ''}
                          disabled={!desbloqueado || bloqueado}
                          onChange={e => setSt(p => ({ ...p, contexto: { ...p.contexto, [c.id]: e.target.value } }))}
                        />
                        <button
                          type="button"
                          className={`entr__lock-btn${bloqueado ? ' entr__lock-btn--locked' : ''}`}
                          disabled={!desbloqueado}
                          onClick={() => toggleBloqueo(c.id)}
                          title={bloqueado ? 'Desbloquear campo' : 'Bloquear campo (protege el texto contra edición o regeneración con IA)'}
                        >
                          <span className="material-symbols-outlined">{bloqueado ? 'lock' : 'lock_open'}</span>
                        </button>
                        <button
                          type="button"
                          className={`entr__ai-btn-sm${cuotaAgotada ? ' entr__ai-btn-sm--cooldown' : ''}`}
                          disabled={!desbloqueado || bloqueado || generandoCampo === c.id}
                          onClick={() => generarCampoConIA(c.id)}
                          title="Generar con IA (lee Anexos/Investigación)"
                        >
                          <span className="material-symbols-outlined">{generandoCampo === c.id ? 'progress_activity' : 'auto_awesome'}</span>
                        </button>
                        <button
                          type="button"
                          className={`entr__mic${voiceField === c.id ? ' entr__mic--on' : ''}`}
                          disabled={!desbloqueado || bloqueado}
                          onClick={() => toggleVoice(c.id)}
                          title={voiceField === c.id ? 'Detener grabación' : 'Dictar con micrófono'}
                        >
                          <span className="material-symbols-outlined">
                            {voiceField === c.id ? 'mic_off' : 'mic'}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── 11 POSIBLES SOLUCIONES IA ── */}
            <div className="entr__ia-card" id="sec-ia">
              <div className="entr__card-header">
                <span className="entr__step-badge">11</span>
                <h2 className="entr__ia-heading" style={{ margin: 0 }}>Posibles Soluciones (A.I. 7.0)</h2>
              </div>
              <p className="entr__ia-hint">
                Al guardar, el pipeline M1–M9 del Formulador AI procesará estos datos de entrada
                y generará automáticamente el análisis de soluciones, marco lógico y presupuesto base.
              </p>
              {/* MANDATO (2026-08-24, "Soluciones con AI") — reemplaza el
                  bloque decorativo "Hablar con un experto" (no hacía nada).
                  9 propuestas de IA (lee Anexos/Investigación + contexto A-G
                  ya escrito, misma regla anti-alucinación que el resto de
                  esta página: si el material no sustenta 9, devuelve menos,
                  nunca rellena con relleno inventado) + 1 propuesta manual
                  fija (#10, el botón nunca la toca). Selección única tipo
                  radio ("solo 1 de las 10 para ser formulada"). Sin fuente
                  Stitch propia — reutiliza el mismo estilo de botón outline
                  azul que ya tenía "Hablar con un experto" y los tokens de
                  .entr__campo-c-input para las cajas de texto. */}
              {(errorIA || retryAtIA) && (
                <div role="alert" style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '6px 10px', borderRadius: 6, marginBottom: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span>{errorIA || MENSAJE_CUOTA_AGOTADA}</span>
                  {retryAtIA && <CountdownReset retryAt={retryAtIA} onExpire={() => { setErrorIA(null); limpiarRetryAtIA(); }} />}
                </div>
              )}
              <div className="entr__soluciones-header">
                <button
                  type="button"
                  className={`entr__soluciones-ai-btn${cuotaAgotada ? ' entr__soluciones-ai-btn--cooldown' : ''}`}
                  disabled={generandoCampo === 'SOLUCIONES'}
                  onClick={generarSoluciones}
                >
                  <span className="material-symbols-outlined">{generandoCampo === 'SOLUCIONES' ? 'progress_activity' : 'auto_awesome'}</span>
                  {generandoCampo === 'SOLUCIONES' ? 'Generando…' : 'Soluciones con AI'}
                </button>
                {st.soluciones.propuestasIA.length > 0 && (
                  <span className="entr__soluciones-count">{st.soluciones.propuestasIA.length} de 9 generadas por IA</span>
                )}
              </div>
              <div className="entr__soluciones-lista">
                {st.soluciones.propuestasIA.length === 0 && (
                  <p className="entr__soluciones-empty">Aún no hay propuestas de IA — usa el botón de arriba, o escribe tu propia propuesta en la casilla #10.</p>
                )}
                {st.soluciones.propuestasIA.map((texto, i) => (
                  <div className="entr__solucion-item" key={`ia-${i}`}>
                    <input
                      type="radio"
                      name="solucion-elegida"
                      className="entr__solucion-radio"
                      checked={st.soluciones.seleccion?.tipo === 'ia' && st.soluciones.seleccion.index === i}
                      onChange={() => setSt(p => ({ ...p, soluciones: { ...p.soluciones, seleccion: { tipo: 'ia', index: i } } }))}
                      title={`Elegir la propuesta ${i + 1} para ser formulada`}
                    />
                    <span className="entr__solucion-num">{i + 1}</span>
                    <textarea
                      className="entr__solucion-textarea"
                      value={texto}
                      onChange={e => setSt(p => {
                        const propuestasIA = [...p.soluciones.propuestasIA];
                        propuestasIA[i] = e.target.value;
                        return { ...p, soluciones: { ...p.soluciones, propuestasIA } };
                      })}
                    />
                  </div>
                ))}
                <div className="entr__solucion-item">
                  <input
                    type="radio"
                    name="solucion-elegida"
                    className="entr__solucion-radio"
                    checked={st.soluciones.seleccion?.tipo === 'manual'}
                    onChange={() => setSt(p => ({ ...p, soluciones: { ...p.soluciones, seleccion: { tipo: 'manual' } } }))}
                    title="Elegir tu propuesta manual para ser formulada"
                  />
                  <span className="entr__solucion-num">10</span>
                  <textarea
                    className="entr__solucion-textarea"
                    placeholder="Escribe tu propia propuesta de solución…"
                    value={st.soluciones.propuestaManual}
                    onChange={e => setSt(p => ({ ...p, soluciones: { ...p.soluciones, propuestaManual: e.target.value } }))}
                  />
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
