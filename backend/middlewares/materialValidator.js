export const REJECTED_MATERIALS_VOCAB = Object.freeze([
  'material reciclado', 'materiales reciclados', 'reciclado', 'reciclados',
  'reclaimed', 'recycled material', 'recycled materials',
  'material recuperado', 'materiales recuperados',
  'residuos como material', 'scrap material',
]);

// Normaliza: minúsculas, sin tildes, colapsa espacios
function normalizeText(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsRejectedMaterial(value) {
  if (typeof value === 'string') {
    const norm = normalizeText(value);
    return REJECTED_MATERIALS_VOCAB.some(term => norm.includes(normalizeText(term)));
  }
  if (Array.isArray(value)) return value.some(containsRejectedMaterial);
  if (value && typeof value === 'object') return Object.values(value).some(containsRejectedMaterial);
  return false;
}

export function rejectMaterialsInput(req, res, next) {
  if (containsRejectedMaterial(req.body)) {
    console.warn('[SECURITY] INPUT_REJECTED_MATERIALS — userId:', req.userId, 'path:', req.path);
    return res.status(422).json({
      success: false,
      code: 'INPUT_REJECTED_MATERIALS',
      message: 'El input contiene referencias a materiales no elegibles para financiación. Revisa las especificaciones del proyecto.',
    });
  }
  next();
}
