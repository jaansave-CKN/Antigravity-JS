/**
 * entradaModelo.ts — datos, tipos y funciones puras de EntradaPage.
 * Extraído LITERAL de pages/EntradaPage.tsx (refactor 2026-09-28, sin cambio
 * de comportamiento): mismas claves de storage, mismo ESTADO_INICIAL, mismas
 * reglas de desbloqueo secuencial y cálculo C4.
 */
// FIX (react-doctor client-localstorage-no-version, 2026-09-05): clave
// versionada para que un futuro cambio de forma del estado (ESTADO_INICIAL)
// pueda ignorar datos viejos en vez de romper JSON.parse.
//
// FIX (2026-09-07, "se perdió la información que ya tenía guardada"): esta
// clave era GLOBAL (una sola para TODOS los proyectos del navegador). Al
// abrir un proyecto distinto al último editado, la hidratación de abajo veía
// "ya hay algo en localStorage" (el draft del OTRO proyecto, o uno vacío) y
// por diseño NUNCA volvía a pedirle los datos reales al servidor — el
// formulario se veía vacío/desactualizado aunque la BD tuviera todo intacto
// (verificado en vivo contra la BD real: los datos nunca se borraron). Ahora
// la clave incluye el proyectoId — mismo patrón que `claveAutoCarga` más
// abajo — así cada proyecto tiene su propio draft y nunca pisa el de otro.
export const STORAGE_KEY_BASE = 'radar360_entrada_m1:v1';
export const STORAGE_KEY_LEGACY = 'radar360_entrada_m1'; // sin versión, anterior a 2026-09-05
export const STORAGE_KEY_LEGACY_GLOBAL = STORAGE_KEY_BASE; // sin proyectoId, anterior a 2026-09-07
export const claveEntrada = (proyectoId: string | null) => proyectoId ? `${STORAGE_KEY_BASE}:${proyectoId}` : STORAGE_KEY_BASE;
export function leerEntradaStorage(proyectoId: string | null): string | null {
  const actual = localStorage.getItem(claveEntrada(proyectoId));
  if (actual) return actual;
  const legado = localStorage.getItem(STORAGE_KEY_LEGACY);
  if (legado) {
    localStorage.setItem(claveEntrada(proyectoId), legado);
    localStorage.removeItem(STORAGE_KEY_LEGACY);
    return legado;
  }
  return null;
}
export const ACTIVE_PROJECT_KEY      = 'rf360_proyecto_activo';
export const ACTIVE_PROJECT_NAME_KEY = 'rf360_proyecto_nombre';

// FIX (2026-09-08, mismo hallazgo que hidratacionListaRef en el componente):
// el bug de la condición de carrera ya dejó borradores VACÍOS grabados bajo
// la clave por-proyecto en navegadores reales (el auto-save alcanzó a
// escribir ESTADO_INICIAL antes de que existiera este fix). Ese borrador
// fantasma sigue ahí y, sin este chequeo, `leerEntradaStorage` lo trataría
// como un draft real y bloquearía el fetch al servidor PARA SIEMPRE — el fix
// de la carrera por sí solo no limpia lo que el bug viejo ya escribió. Un
// borrador se considera "vacío" (no confiable como línea base) si ninguno de
// estos campos de contenido real tiene algo — coincide exactamente con
// ESTADO_INICIAL salvo por metodologias, que siempre trae el default.
export function borradorEstaVacio(parsed: Record<string, unknown>): boolean {
  const s = parsed as Partial<EntradaState>;
  return !s.nombre && !s.pitch && !s.enfoque && !s.municipio && !s.vereda &&
    !s.categoriaPoblacion && !(s.sectores?.length) && !(s.detallePoblacion?.length) &&
    !s.numeroBeneficiarios && !s.coberturaGeografica;
}

// ── Catálogos ─────────────────────────────────────────────────────────────────

export const ENFOQUES: { label: string; icon: string }[] = [
  { label: 'INFRAESTRUCTURA', icon: 'construction' },
  { label: 'SOCIAL',          icon: 'group' },
  { label: 'PRODUCTIVO',      icon: 'agriculture' },
  { label: 'INSTITUCIONAL',   icon: 'account_balance' },
];

export const TIPOS_CONVOCATORIA: { label: string; icon: string }[] = [
  { label: 'Subvención internacional', icon: 'public' },
  { label: 'Cofinanciación',           icon: 'foundation' },
  { label: 'MGA / SGR',                icon: 'account_balance_wallet' },
  { label: 'APP / OXI',                icon: 'gavel' },
  { label: 'Banca multilateral',       icon: 'account_balance' },
];

export const NIVELES_PROYECTO: { label: string; icon: string }[] = [
  { label: 'Idea',            icon: 'lightbulb' },
  { label: 'Perfil',          icon: 'description' },
  { label: 'Prefactibilidad', icon: 'fact_check' },
  { label: 'Factibilidad',    icon: 'verified' },
];

export const METODOLOGIA_OBLIGATORIA = 'Marco Lógico';
export const METODOLOGIAS: string[] = [
  METODOLOGIA_OBLIGATORIA,
  'Teoría del Cambio',
  'PMI',
  'MEL',
  'Salvaguardas',
];

export const FORMATO_FINANCIADOR: { label: string; icon: string }[] = [
  { label: 'ONU / BID / UE', icon: 'public' },
  { label: 'MGA Web',        icon: 'account_balance_wallet' },
  { label: 'Formato propio', icon: 'description' },
];

export const SECTORES_SUB: { grupo: string; sub: { titulo: string; opciones: string[] }[] }[] = [
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

export const CATEGORIAS_POBLACION = [
  { id: 'A', titulo: 'A. FORTALECIMIENTO INSTITUCIONAL Y GUBERNAMENTAL', opciones: ['Alcaldías / Municipios', 'Gobernaciones', 'Cuerpos de Socorro y Emergencia', 'Instituciones Educativas', 'Otros:'] },
  { id: 'B', titulo: 'B. ORGANIZACIONES COMUNITARIAS Y DE BASE', opciones: ['Juntas de Acción Comunal (JAC)', 'Centros de Bienestar', 'Grupos de Voluntariado y Minga', 'Otros:'] },
  { id: 'C', titulo: 'C. DESARROLLO PRODUCTIVO Y RURAL', opciones: ['Campesinos', 'Asociaciones productivas', 'Emprendedores y microempresarios', 'Otros:'] },
];

export const DETALLE_POBLACION = [
  { grupo: 'A. INCLUSIÓN SOCIAL Y CICLO DE VIDA', opciones: ['Primera infancia y niñez.', 'Adulto mayor.', 'Madres Cabeza de Hogar', 'Población General.'] },
  { grupo: 'B. COMUNIDADES ÉTNICAS', opciones: ['Comunidades Indígenas', 'Comunidades Afrocolombianas', 'Comunidades Raizales y Palenqueras', 'Pueblo Rrom'] },
  { grupo: 'C. JUSTICIA, PAZ Y RESTITUCIÓN DE DERECHOS', opciones: ['Víctimas del conflicto', 'Reincorporados / Reintegrados', 'Población carcelaria y pospenados'] },
  { grupo: 'D. VULNERABILIDAD CRÍTICA, SALUD Y RESILIENCIA', opciones: ['Personas con discapacidad', 'Población migrante', 'Población en pobreza extrema', 'Damnificados por desastres'] },
];

// Debe coincidir literal con el marcador que devuelve el prompt de
// EntradaIAService.js (regla 2, backend) cuando un campo crítico no tiene
// dato en el material de investigación.
export const ND_INVESTIGACION = 'ND (No Disponible en la investigación)';
export const ALERTA_ND = '⚠️ REQUERIDO: FALTA INFORMACIÓN EN ANEXOS';

// REFACTOR (2026-08-22, "flujo secuencial y Campo C multi-componente"): el
// campo 'meta' (C) sale de este array plano — se reemplaza por 4 sub-campos
// interconectados (ver ContextoMetaState/CampoCBlock más abajo). Este array
// queda con 6 entradas (A,B,D,E,F,G) en orden — el índice se usa para la
// máquina de estados de bloqueo secuencial (estaDesbloqueado()). DEBE
// mantenerse sincronizado a mano con CAMPOS_INDIVIDUALES de
// EntradaIAService.js (backend) — si se agrega/quita un campo aquí, también
// allá, o el botón ✨ individual devolverá 400.
export const CONTEXTO_CAMPOS = [
  { id: 'situacion_actual', label: 'A. SITUACION ACTUAL SIN PROYECTO', ph: "ej: 'El 80% de las familias consumen agua no potable'" },
  { id: 'linea_base', label: 'B. INDICADOR DE LINEA BASE CUANTIFICABLE', ph: "ej: % de familias sin acceso a energía — Valor actual: 80 — Unidad: %" },
  { id: 'justificacion', label: 'D. JUSTIFICACION DE PRIORIDAD', ph: 'Define la relevancia estratégica del proyecto...' },
  { id: 'sociocultural', label: 'E. ANALISIS SOCIOCULTURAL PARA LA PERTINENCIA', ph: 'Demuestra que la solución es culturalmente pertinente...' },
  { id: 'problema_urgente', label: 'F. ¿QUE PROBLEMA PERCIBE COMO MAS URGENTE?', ph: 'Qué problema percibe como urgente...' },
  { id: 'incertidumbre', label: 'G. CONDICION CRÍTICA DE INCERTIDUMBRE LOGÍSTICA', ph: 'Describa la condición crítica...' },
];

// ── Campo C rediseñado: problemática (IA) + déficit (derivado) + beneficiarios
// (manual, hereda de Sección 06) + % (JS puro, cero IA) ─────────────────────
export interface ProblematicaOpcion { problema: string; deficit_valor: number | null; deficit_unidad: string | null }
export interface ContextoMetaState {
  problematicas: ProblematicaOpcion[];
  problemaSeleccionado: string;
  beneficiarios: string;
  tipoFormulacion: string;
}

// C-nuevo — modalidad de formulación (MANDATO 2026-08-23): se inserta entre
// Beneficiarios (C3) y % Calculado (C4). Puro estado de formulario + contexto
// para la IA de D/E (buildSystemPromptCampoIndividual) — no participa en
// calcularPorcentajeC4, que sigue siendo JS puro sobre beneficiarios/déficit.
export const OPCIONES_TIPO_FORMULACION = ['Proyecto Integral (100%)', 'Prueba Piloto', 'Formulado por Etapas'] as const;
export const MODALIDAD_INTEGRAL = OPCIONES_TIPO_FORMULACION[0];

// Sección 11 "Soluciones con AI" (MANDATO 2026-08-24) — hasta 9 propuestas
// generadas por IA (editables, se reemplazan al volver a generar) + 1
// propuesta manual fija que el botón nunca toca. Selección única (radio, no
// checklist múltiple: "escogerá solo 1 de las 10") — unión discriminada en
// vez de un índice plano para no confundir "IA #3" con "manual" por un
// off-by-one si propuestasIA cambia de tamaño entre generaciones.
export type SeleccionSolucion = { tipo: 'ia'; index: number } | { tipo: 'manual' } | null;
export interface SolucionesState {
  propuestasIA: string[];
  propuestaManual: string;
  seleccion: SeleccionSolucion;
}

export function campoTieneContenidoReal(valor: string | undefined): boolean {
  return !!valor?.trim() && valor !== ALERTA_ND;
}

/** Máquina de estados de bloqueo secuencial — index sobre CONTEXTO_CAMPOS
 * (0=A,1=B,2=D,3=E,4=F,5=G). El Campo C se evalúa aparte (campoCDesbloqueado/
 * campoCCompleto) porque ya no vive en este array. */
export function estaDesbloqueado(index: number, contexto: Record<string, string>, metaCompleto: boolean): boolean {
  if (index === 0) return true; // A siempre abierto
  if (index === 1) return campoTieneContenidoReal(contexto[CONTEXTO_CAMPOS[0].id]); // B ← A
  if (index === 2) return metaCompleto; // D ← Campo C completo
  return campoTieneContenidoReal(contexto[CONTEXTO_CAMPOS[index - 1].id]); // E,F,G ← anterior
}
export function campoCDesbloqueado(contexto: Record<string, string>): boolean {
  return campoTieneContenidoReal(contexto[CONTEXTO_CAMPOS[1].id]); // C ← B
}
export function campoCCompleto(contextoMeta: ContextoMetaState): boolean {
  return !!contextoMeta.problemaSeleccionado && !!contextoMeta.beneficiarios?.trim();
}
/** C4 — 100% JS, cero IA. 'N/D' si no hay déficit real o beneficiarios inválido — nunca NaN/Infinity. */
export function calcularPorcentajeC4(beneficiarios: string, deficitValor: number | null): string {
  const benefNum = Number(beneficiarios);
  if (!beneficiarios?.trim() || !Number.isFinite(benefNum) || benefNum <= 0) return 'N/D';
  if (deficitValor === null || deficitValor === 0) return 'N/D';
  return `${((benefNum / deficitValor) * 100).toFixed(1)}%`;
}


// ── Estado ─────────────────────────────────────────────────────────────────────

export interface EntradaState {
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

export const ESTADO_INICIAL: EntradaState = {
  nombre: '', pitch: '', enfoque: '', tipoConvocatoria: '',
  nivelProyecto: '', metodologias: [METODOLOGIA_OBLIGATORIA], formatoFinanciador: '',
  numeroBeneficiarios: '', coberturaGeografica: '',
  sectores: [], sectorOtro: {}, categoriaPoblacion: '', categoriaOtro: {},
  detallePoblacion: [], municipio: '', vereda: '', contexto: {},
  contextoMeta: { problematicas: [], problemaSeleccionado: '', beneficiarios: '', tipoFormulacion: OPCIONES_TIPO_FORMULACION[0] },
  soluciones: { propuestasIA: [], propuestaManual: '', seleccion: null },
  camposBloqueados: {},
};

// Pura, sin estado del componente — a nivel de módulo
// (react-doctor/prefer-module-scope-pure-function).
export const claveAutoCarga = (proyectoId: string) => `radar360_c1_autocarga_${proyectoId}`;
