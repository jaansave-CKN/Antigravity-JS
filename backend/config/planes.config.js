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

/**
 * Techo de gasto de IA POR PLAN, en USD (2026-10-12).
 *
 * PROBLEMA QUE RESUELVE: hasta aquí el tope era UNO SOLO para todos
 * (LLM_TOPE_USD_DIA / LLM_TOPE_USD_MES del entorno). Con un tope plano de
 * USD 30/mes, un usuario del plan Radar —que paga ~USD 37— podía consumir el
 * 81 % de su propio ingreso en un solo insumo, mientras que en Suite (~USD 125)
 * el mismo tope era apenas el 24 %. El techo no guardaba ninguna relación con
 * lo que cada plan paga.
 *
 * REGLA APLICADA: el costo de IA de un usuario no debe pasar del 20 % de lo
 * que ese usuario paga — guardarraíl estándar de margen bruto en SaaS. Los
 * valores de abajo son ese 20 % del precio del plan convertido a USD, y el
 * tope diario es ~1/3 del mensual para permitir días de uso intenso sin
 * agotar el mes.
 *
 * `free` NO es cero a propósito: sin una cortesía de arranque nadie puede
 * probar el producto. Es un costo de adquisición acotado y deliberado.
 *
 * CÓMO CAMBIARLOS: son una decisión de negocio, no técnica. Se editan aquí
 * (una línea por plan) o se sobreescriben por usuario en la tabla
 * ai_tope_usuario (migración 073), que tiene prioridad sobre esto.
 * Orden de resolución en iaPresupuesto.js:
 *   ai_tope_usuario (por usuario) → este tope por plan → entorno → respaldo duro.
 */
export const USD_COP_REF = Number(process.env.USD_COP_REF) || 4000;
const FRACCION_MAXIMA = Number(process.env.LLM_FRACCION_INGRESO) || 0.20;

const topeMensualUsd = (precioCop) => Math.round((precioCop / USD_COP_REF) * FRACCION_MAXIMA * 100) / 100;

export const TOPES_IA_POR_PLAN = Object.freeze({
  // free: cortesía de arranque fija, no derivada del precio (que es 0).
  free:       { dia: 0.25, mes: 2.00 },
  radar:      { dia: Math.round((topeMensualUsd(PLANES.radar.precio) / 3) * 100) / 100,      mes: topeMensualUsd(PLANES.radar.precio) },
  formulador: { dia: Math.round((topeMensualUsd(PLANES.formulador.precio) / 3) * 100) / 100, mes: topeMensualUsd(PLANES.formulador.precio) },
  suite:      { dia: Math.round((topeMensualUsd(PLANES.suite.precio) / 3) * 100) / 100,      mes: topeMensualUsd(PLANES.suite.precio) },
});

/** Topes del plan indicado, o null si el plan no está en el catálogo. */
export function topesDePlan(plan) {
  return TOPES_IA_POR_PLAN[String(plan || '').toLowerCase()] ?? null;
}
