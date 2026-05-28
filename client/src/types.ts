export type EstadoConvocatoria = 'abierta' | 'proxima' | 'cerrada' | 'pendiente_revision';

export type CategoriaGestion = 
  | 'importante' 
  | 'facil_victoria' 
  | 'complicada' 
  | 'estratégica' 
  | 'sin_clasificar';

export type Sector =
  | 'Vivienda'
  | 'Ambiente'
  | 'Medio Ambiente'
  | 'Ciencia'
  | 'Tecnologia e Innovacion'
  | 'Infraestructura'
  | 'Educacion'
  | 'Salud'
  | 'Desarrollo Social'
  | 'Saneamiento'
  | 'Saneamiento Basico'
  | 'Energia'
  | 'Energias Renovables'
  | 'Agricultura'
  | 'Agricola'
  | 'Agroindustria'
  | 'Tecnologia'
  | 'Agua y Saneamiento'
  | 'Cambio Climatico'
  | 'Desarrollo Urbano'
  | 'Gestion de Riesgos'
  | 'Desarrollo Economico'
  | 'Empresarial'
  | 'Comercio'
  | 'Emprendimiento'
  | 'Innovacion'
  | 'Ayuda Humanitaria'
  | 'Seguridad Alimentaria'
  | 'Desarrollo Rural'
  | 'Energia Renovable'
  | 'Biodiversidad'
  | 'Desarrollo Digital'
  | 'Capacitacion'
  | 'Investigacion'
  | 'Desarrollo Comunitario'
  | 'Cooperativismo'
  | 'Cultura'
  | 'Primera Infancia'
  | 'Turismo'
  | 'Derechos Humanos'
  | 'Agua'
  | 'Construccion'
  | 'Transporte'
  | 'Ordenamiento Territorial'
  | 'Desarrollo Local'
  | 'Poblacion Vulnerable'
  | 'Empleo'
  | 'Productividad'
  | 'Mercados'
  | 'Gestion Publica'
  | 'Desarrollo Sostenible'
  | 'Resiliencia'
  | 'Infraestructura Social'
  | 'Paz'
  | 'Genero'
  | 'Igualdad de Genero'
  | 'Impacto Social'
  | 'Deporte'
  | 'Justicia'
  | 'Agro'
  | 'Emprendimiento y Cooperativismo'
  | 'Ciencia, Tecnologia e Innovacion'
  | 'Tecnologias'
  | 'Integracion Regional'
  | 'Transicion Verde'
  | 'Gobernabilidad'
  | 'Fortalecimiento Institucional'
  | 'Inclusion Financiera'
  | 'Cambio Social'
  | 'ODS'
  | 'Sostenibilidad'
  | 'Formacion'
  | 'Recursos Naturales'
  | 'Patrimonio'
  | 'Gobernanza'
  | 'Accion Social'
  | 'Visibilidad'
  | 'Competitividad Economica'
  | 'Comunicacion';

export type Fuente =
  | 'Grants.gov'
  | 'EU SEDIA'
  | 'UN Global'
  | 'World Bank'
  | 'APC Colombia'
  | 'Embajada Japon'
  | 'Embajada Alemania'
  | 'Embajada EE.UU.'
  | 'GEF'
  | 'BID'
  | 'USAID'
  | 'UNGM'
  | 'UN-Habitat'
  | 'COSUDE'
  | 'Banco Mundial'
  | 'FAO'
  | 'GIZ'
  | 'EU Funding & Tenders'
  | 'UNESCO'
  | 'PNUD'
  | 'UN Women'
  | 'OIM'
  | 'CAF'
  | 'AECID'
  | 'AFD'
  | 'JICA'
  | 'SENA'
  | 'iNNpulsa'
  | 'Google'
  | 'Scotiabank'
  | 'IKEA Foundation'
  | 'Avina Foundation'
  | 'FONTAGRO'
  | 'KOICA'
  | 'SIDA'
  | 'IDRC'
  | 'UNESCO'
  | 'PNUD'
  | 'UN Women'
  | 'OIM'
  | 'CAF'
  | 'AECID'
  | 'AFD'
  | 'JICA'
  | 'SENA'
  | 'iNNpulsa'
  | 'Google'
  | 'Scotiabank'
  | 'IKEA Foundation'
  | 'Avina Foundation'
  | 'FONTAGRO'
  | 'KOICA'
  | 'SIDA';

export interface AlertaSenal {
  id: string;
  tipo: 'presupuestal' | 'politica' | 'tendencia';
  titulo: string;
  descripcion: string;
  fecha: string;
  impacto: 'alto' | 'medio' | 'bajo';
  fuente: string;
}

export type PoblacionObjetivo =
  | 'primera_infancia'
  | 'adulto_mayor'
  | 'madres_cabeza_hogar'
  | 'indigenas'
  | 'afrocolombianos'
  | 'raizales'
  | 'palenqueros'
  | 'rrom'
  | 'victimas_violencia'
  | 'poblacion_desplazada'
  | 'reincorporacion'
  | 'desastres_naturales'
  | 'situacion_calle'
  | 'salud_especial'
  | 'consumo_sustancias'
  | 'pobreza_extrema'
  | 'poblacion_migrante'
  | 'grupos_etnicos'
  | 'otros_etnicos'
  | 'otros_justicia_paz'
  | 'otros_vulnerabilidad';

export interface Convocatoria {
  id: string;
  titulo: string;
  donante: string;
  montoMax: number;
  moneda: string;
  fechaCierre: string;
  fechaPublicacion: string;
  paisesElegibles: string[];
  sectores: Sector[];
  probabilidadExito: number;
  requisitosClave: string[];
  estado: EstadoConvocatoria;
  fuente: Fuente;
  descripcion: string;
  urlOriginal: string;
  urlConvocatoria?: string;
  urlTerminos?: string;
  favorito: boolean;
  compatibilidadPerfil: number;
  categoriaGestion?: CategoriaGestion;
  poblacionesObjetivo?: PoblacionObjetivo[];
}

export interface FiltroActivo {
  sectores: Sector[];
  fuentes: Fuente[];
  montoMin: number;
  montoMax: number;
  soloElegibleColombia: boolean;
  soloFavoritos: boolean;
  busqueda: string;
  estado: EstadoConvocatoria[];
  categoriaGestion?: CategoriaGestion;
  poblacionesObjetivo: PoblacionObjetivo[];
}

export interface EstadisticasRadar {
  totalConvocatorias: number;
  convocatoriasAbiertas: number;
  montoTotalDisponible: number;
  promedioCompatibilidad: number;
  nuevasUltimas24h: number;
  fuentesActivas: number;
  probabilidadPromedio?: number;
}

export interface Entidad {
  id: string;
  nombre: string;
  sigla: string;
  tipo: 'gobierno' | 'multilateral' | 'bilateral' | 'ong' | 'privado' | 'academia';
  pais: string;
  bandera: string;
  sectores: Sector[];
  sitioWeb: string;
  urlConvocatorias?: string;
  contacto: string;
  emailContacto: string;
  convocatoriasActivas: number;
  montoTotalDisponible: number;
  moneda: string;
  frecuencia: 'mensual' | 'trimestral' | 'semestral' | 'anual' | 'variable' | 'continua';
  ultimaConvocatoria: string;
  notas: string;
  locked: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

export type ModuloActivo =
  | 'radar'
  | 'historico'
  | 'riesgos'
  | 'consorcios'
  | 'favoritos'
  | 'entidades'
  | 'inbox'
  | 'chat'
  | 'inteligencia'
  | 'anexos'
  | 'alertas'
  | 'admin'
  | 'prueba'
  | 'realtime'
  | 'configuracion'
  | 'dashboard'
  | 'convocatorias'
  | 'directorio'
  | 'directoriogrid'
  | 'credenciales'
  | 'tablero-beneficiarios'
  | 'panel-control'
  | 'directorio'
  | 'directoriogrid'
  | 'credenciales'
  | 'convocatorias'
  | 'tablero-beneficiarios'
  | 'panel-control';

export interface Alert {
  id: string;
  type: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  data: Record<string, any>;
  timestamp: string;
  acknowledged: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  escalation_level: number;
}

export interface AlertStats {
  active: number;
  resolved: number;
  critical: number;
  high: number;
  last_24h: number;
}

// ============================================================
// TIPOS MULTI-TENANT - RADAR 360
// ============================================================

export interface Organizacion {
  id: string;
  nombre: string;
  pais?: string;
  email_admin?: string;
  api_key_google?: string;
  notebook_google?: string;
  limite_prospectos: number;
  activa: boolean;
  plan: 'basico' | 'profesional' | 'enterprise';
  created_at?: string;
  updated_at?: string;
}

export interface UsuarioOrg {
  id: string;
  org_id: string;
  email: string;
  rol: 'admin' | 'editor' | 'viewer';
  nombre?: string;
  ultimo_login?: string;
}

export interface Proyecto {
  id: string;
  org_id: string;
  nombre: string;
  descripcion?: string;
  palabras_clave: string[];
  estado: 'activo' | 'pausado' | 'completado';
  creado_en?: string;
  actualizado_en?: string;
}

export interface DocumentoContexto {
  id: string;
  proyecto_id: string;
  nombre: string;
  tipo: 'pdf' | 'doc' | 'txt' | 'url';
  uploaded_en?: string;
}

// ============================================================
// FLUJO DE 3 AGENTES
// ============================================================

export type EstadoValidacion = 'Pendiente' | 'Aprobado' | 'Descartado';

export interface ItemColaValidacion {
  id: string;
  org_id: string;
  titulo: string;
  donante?: string;
  url_fuente?: string;
  descripcion?: string;
  monto_estimado?: number;
  fecha_cierre?: string;
  paises_elegibles: string[];
  sectores: string[];
  score_encontrado: number;
  fuente?: string;
  estado: EstadoValidacion;
  fecha_ingreso?: string;
  revisado_por?: string;
  decision?: string;
  decision_notas?: string;
}

export interface EntidadIndexada {
  id: string;
  org_id: string;
  titulo: string;
  donante?: string;
  descripcion?: string;
  monto_min: number;
  monto_max: number;
  moneda: string;
  url_convocatoria?: string;
  url_fuente?: string;
  fecha_cierre?: string;
  fecha_publicacion?: string;
  paises_elegibles: string[];
  sectores: string[];
  poblacion_objetivo: string[];
  tipo_fondo?: string;
  requisitos: string[];
  tags: string[];
  score_compatibilidad: number;
  estado: 'activa' | 'cerrada' | 'archivada';
  origen?: string;
  proyecto_id?: string;
  fecha_indexacion?: string;
}

// ============================================================
// RADARGRID - FILTROS CRUZADOS
// ============================================================

export interface FiltrosRadarGrid {
  isGlobal: boolean;
  targetCountry?: string;
  localRegion?: string;
  fundingType?: FundingType;
  sectors: SectorRadar[];
  targetPopulation: TargetPopulationRadar[];
  monto_min?: number;
  monto_max?: number;
}

export type TipoFondo = 
  | 'donacion' 
  | 'subvencion' 
  | 'financiacion' 
  | 'credito_condonable' 
  | 'beca' 
  | 'cooperacion';

export type PoblacionFilter = 
  | 'areas_rurales' 
  | 'municipios_cat_5_6'
  | 'asociaciones_agropecuarias'
  | 'ongs'
  | 'pymes'
  | 'mujeres_cabeza_hogar'
  | 'jovenes'
  | 'indigenas'
  | 'afrodescendientes';

// ============================================================
// ESTADÍSTICAS ORGANIZACIÓN
// ============================================================

export interface EstadisticasOrg {
  entidadesIndexadas: number;
  pendienteValidacion: number;
  proyectosActivos: number;
  documentosContexto: number;
}

// ============================================================
// MOTOR B - BÚSQUEDA SEMÁNTICA
// ============================================================

export interface ResultadoBusquedaSemantica {
  entidad: EntidadIndexada;
  score_similitud: number;
  coincidencias: string[];
}

// ============================================================
// ESQUEMA ESTANDARIZADO RADAR 360 - Convocatoria (GrantEntity)
// ============================================================

export type FundingType = 
  | "Subvención" 
  | "Donación" 
  | "Financiación" 
  | "Crédito Condonable" 
  | "Cooperación Internacional";

export type SectorRadar = 
  | "Saneamiento Básico" 
  | "Infraestructura" 
  | "Educación" 
  | "Agroindustria" 
  | "Medio Ambiente" 
  | "Salud"
  | "Tecnología"
  | "Energía"
  | "Desarrollo Rural"
  | "Vivienda";

export type TargetPopulationRadar = 
  | "Rural" 
  | "Urbanización" 
  | "Municipios Cat 5 y 6" 
  | "Asociaciones Agropecuarias" 
  | "ONGs" 
  | "Comunidades Étnicas"
  | "Mujeres Cabeza de Hogar"
  | "Jóvenes"
  | "Población Vulnerable";

export type ValidationStatus = "Pendiente" | "Aprobado" | "Descartado";

export interface ConvocatoriaEstandarizada {
  // Identificador único
  id: string;
  org_id: string;

  // Información básica
  titulo: string;
  donante: string;
  descripcion: string;
  url_convocatoria: string;
  url_fuente: string;

  // Fechas
  fecha_publicacion?: string;
  fecha_cierre?: string;

  // --- ÁMBITO GEOGRÁFICO ---
  isGlobal: boolean;
  targetCountry: string;
  localRegion?: string;
  paises_elegibles: string[];

  // --- TIPO DE FONDO ---
  fundingType: FundingType;

  // --- SECTOR ESTRATÉGICO ---
  sectors: SectorRadar[];

  // --- POBLACIÓN OBJETIVO ---
  targetPopulation: TargetPopulationRadar[];

  // Montos
  monto_min?: number;
  monto_max?: number;
  moneda: string;

  // Requisitos
  requisitos: string[];
  tags: string[];

  // Métricas
  score_compatibilidad: number;
  probabilidad_exito?: number;

  // Estado
  estado: "activa" | "cerrada" | "archivada";
  categoria_gestion?: string;

  // --- LOG DE AUDITORÍA DE AGENTES ---
  sourceMiner: string; // Identificador del minero o API del usuario
  validationStatus: ValidationStatus;
  validado_por?: string;
  fecha_validacion?: string;
  
  // Metadata
  origen?: string;
  proyecto_id?: string;
  fecha_indexacion: string;
  actualizada_en: string;
}

// ============================================================
// FILTROS RADARGRID (4 NIVELES CRUZADOS)
// ============================================================

export interface RadarGridFilters {
  // Nivel 1: Ámbito Geográfico
  isGlobal: boolean;
  targetCountry: string;
  localRegion?: string;

  // Nivel 2: Tipo de Fondo
  fundingType?: FundingType;

  // Nivel 3: Sector
  sectors: SectorRadar[];

  // Nivel 4: Población Objetivo
  targetPopulation: TargetPopulationRadar[];

  // Rangos de monto
  monto_min?: number;
  monto_max?: number;
}

// ============================================================
// AI AUTONOMOUS AGENTS - LOCAL INTELLIGENCE ENGINE
// ============================================================

export type AIAgentTaskType = 'architecture' | 'typing' | 'compilation' | 'refactor' | 'analysis' | 'general';

export type AIAgentPriority = 'critical' | 'high' | 'medium' | 'low';

export type AITaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AITaskContext {
  filePath?: string;
  language?: string;
  taskType?: string;
  errorMessage?: string;
}

export interface AITaskResult {
  success: boolean;
  taskId: string;
  result?: string;
  error?: string;
  metadata?: {
    model?: string;
    tokens?: number;
    duration?: number;
    timestamp: string;
  };
}

export interface AIAgentTask {
  id: string;
  type: AIAgentTaskType;
  priority: AIAgentPriority;
  prompt: string;
  context?: AITaskContext;
  status: AITaskStatus;
  result?: AITaskResult;
  createdAt: Date;
  completedAt?: Date;
  agentId?: string;
}

export interface AIAgentContext {
  agentId: string;
  taskTypes: string[];
  currentTask?: AIAgentTask;
  pendingTasks: number;
}

export interface AIOrchestratorConfig {
  maxConcurrentAgents: number;
  taskRetryAttempts: number;
  pollIntervalMs: number;
  defaultPriority: AIAgentPriority;
  enableBackgroundProcessing: boolean;
}

export const DEFAULT_AI_CONFIG: AIOrchestratorConfig = {
  maxConcurrentAgents: 3,
  taskRetryAttempts: 3,
  pollIntervalMs: 2000,
  defaultPriority: 'medium',
  enableBackgroundProcessing: true,
};

// ============================================================
// FASE 4 - CENTRO DE COMANDO C3
// ============================================================

export type APICredentialType = 'google' | 'notebooklm' | 'perplexity' | 'openai' | 'gemini';

export interface APICredential {
  id?: string;
  org_id?: string;
  type: APICredentialType;
  name: string;
  encrypted_key: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface APICredentialInput {
  google?: string;
  notebooklm?: string;
  perplexity?: string;
  openai?: string;
  gemini?: string;
}

export interface TrackingSource {
  id: string;
  org_id?: string;
  name: string;
  url: string;
  type: 'api' | 'scraper' | 'rss';
  api_credential_id?: string;
  enabled: boolean;
  last_run?: string;
  created_at?: string;
}

export interface TrackingRun {
  id: string;
  source_id: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed';
  convocatorias_found: number;
  errors?: string;
}

export interface SchedulerStatus {
  last_run?: string;
  next_run?: string;
  interval_hours: number;
  sources_count: number;
  active: boolean;
}
