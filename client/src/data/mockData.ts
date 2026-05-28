import { Convocatoria, EstadisticasRadar, Entidad } from '../types';

export const sectorColors: Record<string, string> = {
  'Saneamiento': '#00B8D9',
  'Energia': '#FFAB00',
  'Infraestructura': '#36B37E',
  'Desarrollo Social': '#6554C0',
  'Salud': '#FF5630',
  'Educacion': '#0066FF',
  'Ambiente': '#00875A',
  'Agua y Saneamiento': '#00BCD4',
  'Cambio Climatico': '#4CAF50',
  'Desarrollo Urbano': '#9C27B0',
  'Vivienda': '#FF9800',
  'Agricultura': '#8BC34A',
  'Tecnologia': '#2196F3',
  'Innovacion': '#673AB7',
  'Emprendimiento': '#FF5722',
};

export const fuenteLogos: Record<string, string> = {
  'USAID': '🇺🇸',
  'UN-Habitat': '🇺🇳',
  'COSUDE': '🇨🇭',
  'JICA': '🇯🇵',
  'Banco Mundial': '🌐',
  'GIZ': '🇩🇪',
  'BID': '💰',
  'FAO': '🌾',
  'UE': '🇪🇺',
};

export const convocatorias: Convocatoria[] = [];

export const hallazgosPendientes: Convocatoria[] = [];

export const estadisticas: EstadisticasRadar = {
  totalConvocatorias: 0,
  convocatoriasAbiertas: 0,
  montoTotalDisponible: 0,
  promedioCompatibilidad: 0,
  nuevasUltimas24h: 0,
  fuentesActivas: 0,
  probabilidadPromedio: 0,
};

export const alertasSenales: any[] = [];

export const entidadesMock: Entidad[] = [];