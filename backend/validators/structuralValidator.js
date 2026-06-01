export const CIRCULATION_ZONE_KEYWORDS = Object.freeze([
  'pasillo', 'corredor', 'hall', 'vestibulo', 'vestíbulo',
  'via de evacuacion', 'vía de evacuación', 'zona de circulacion',
  'zona de circulación', 'lobby', 'escalera', 'rampa de evacuacion',
]);

export const STRUCTURAL_VERTICAL_ELEMENTS = Object.freeze([
  'columna', 'pilar', 'poste estructural', 'muro de carga puntual',
  'soporte vertical', 'structural column', 'pillar',
]);

function normalize(str) {
  return String(str).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Evalúa si un elemento estructural colisiona con una zona de circulación.
 * @param {{ ubicacion: string, tipo: string, zona: string }} elemento
 * @returns {{ violated: boolean, reason: string }}
 */
function evaluateElement(elemento) {
  const loc = normalize(elemento.ubicacion || '') + ' ' + normalize(elemento.zona || '');
  const tipo = normalize(elemento.tipo || '');
  const isVertical = STRUCTURAL_VERTICAL_ELEMENTS.some(e => tipo.includes(normalize(e)));
  const isCirculation = CIRCULATION_ZONE_KEYWORDS.some(k => loc.includes(normalize(k)));
  if (isVertical && isCirculation) {
    return {
      violated: true,
      reason: `Elemento "${elemento.tipo}" detectado en zona de circulación: "${elemento.ubicacion || elemento.zona}"`,
    };
  }
  return { violated: false, reason: null };
}

/**
 * Valida un array de elementos estructurales del proyecto.
 * Dispara CRITICAL_DESIGN_EXCEPTION si hay violaciones.
 * @param {Array} elementos
 * @param {string} proyectoId
 * @returns {{ valid: boolean, exceptions: Array }}
 */
export function validateStructuralElements(elementos = [], proyectoId) {
  const exceptions = [];
  for (const el of elementos) {
    const result = evaluateElement(el);
    if (result.violated) {
      exceptions.push({ proyectoId, elemento: el, reason: result.reason, timestamp: new Date().toISOString() });
    }
  }
  if (exceptions.length > 0) {
    console.error('[CRITICAL_DESIGN_EXCEPTION]', JSON.stringify({ proyectoId, count: exceptions.length, exceptions }));
  }
  return { valid: exceptions.length === 0, exceptions };
}
