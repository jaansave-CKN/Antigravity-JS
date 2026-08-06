/**
 * planes.config.js — catálogo único de planes/precios (COP).
 *
 * Extraído de subscriptions.routes.js para que backend/payments/wompiProvider.js
 * pueda leer los precios sin crear un import circular (subscriptions.routes.js
 * → payments/index.js → wompiProvider.js → subscriptions.routes.js). Fuente
 * de verdad única — el frontend (PlanesPage.tsx) consume GET /api/plans, no
 * mantiene su propia copia de estos números. Ver docs/PRECIOS.md.
 */
export const PLANES = {
  free:        { nombre: 'Gratis',     access_radar: 0, access_formulador: 0, precio: 0,       moneda: 'COP', descripcion: 'Acceso de exploración limitado' },
  radar:       { nombre: 'Radar',      access_radar: 1, access_formulador: 0, precio: 149000,  moneda: 'COP', descripcion: 'M1 Radar de Oportunidades + M2 Puente (solo vista)' },
  formulador:  { nombre: 'Formulador', access_radar: 0, access_formulador: 1, precio: 399000,  moneda: 'COP', descripcion: 'M3–M12 Caja Negra de Formulación completa' },
  suite:       { nombre: 'Suite',      access_radar: 1, access_formulador: 1, precio: 499000,  moneda: 'COP', descripcion: 'Acceso total al ecosistema Radar + Formulador' },
};
