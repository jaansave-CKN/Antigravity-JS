// Archivo legado - datos ahora en convocatoriasReales.ts
import type { Convocatoria, EstadisticasRadar } from '../types';

export const realConvocatorias: Convocatoria[] = [];

export const realEstadisticas: EstadisticasRadar = {
  totalConvocatorias: 0,
  convocatoriasAbiertas: 0,
  montoTotalDisponible: 0,
  promedioCompatibilidad: 0,
  nuevasUltimas24h: 0,
  fuentesActivas: 0,
  probabilidadPromedio: 0
};

export const entidadesVerificadas = [];