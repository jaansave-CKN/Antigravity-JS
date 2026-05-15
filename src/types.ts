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
  | 'poblacion_migrante';

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
  | 'admin'
  | 'alertas';

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
