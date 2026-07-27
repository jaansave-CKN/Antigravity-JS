/**
 * ExtractorService.js — "Pieza Cero": convierte un Excel de presupuesto/APU
 * subido en Anexos en filas estructuradas de project_apu_lineas (COP).
 *
 * Diseño (revisado tras auditoría de una directiva externa):
 *   - Los hallazgos de auditoría a nivel de proyecto (ej. "no hay presupuesto
 *     de seguridad industrial") NO viven en project_apu_lineas — no se puede
 *     hacer UPDATE sobre filas que no existen cuando la categoría está
 *     completamente ausente. Viven en project_hallazgos.
 *   - El etiquetado HSEQ es una alerta técnica heurística (regex), no una
 *     certificación legal. No se citan artículos de ley automáticamente.
 *   - Lectura de valores evaluados: sheet_to_json ya devuelve el valor
 *     calculado de una celda con fórmula (propiedad .v), no la fórmula en sí
 *     — no requiere configuración especial de xlsx.
 */
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '../config/supabase.config.js';

const CHUNK_SIZE = 500;
const MAX_HEADER_SCAN_ROWS = 30;

const HEADER_ALIASES = {
  codigo_item:        [/^(í|i)tem$/i, /^c(ó|o)digo$/i],
  descripcion:        [/^descripci(ó|o)n$/i, /^actividad$/i, /^detalle$/i],
  unidad:             [/^unidad$/i, /^und\.?$/i, /^un\.?$/i],
  cantidad:           [/^cantidad$/i, /^metrado$/i, /^q$/i],
  valor_unitario_cop: [/^valor\s*unit/i, /^precio\s*unit/i, /^vr\.?\s*unit/i, /^v\.?\s*unitario$/i],
  valor_total_cop:    [/^valor\s*total$/i, /^subtotal$/i, /^total$/i],
};

const HSEQ_RULES = [
  { categoria: 'EPP',           regex: /casco|arn(é|e)s|\bepp\b|botas|guantes?|protecci(ó|o)n/i },
  { categoria: 'SEÑALIZACION',  regex: /cinta|cono|se(ñ|n)alizaci|valla|barricada|paleta/i },
  { categoria: 'SST',           regex: /\bsst\b|hseq|salud ocupacional|seguridad industrial|v(í|i)gia|inspector/i },
  { categoria: 'AMBIENTAL',     regex: /residuos?|ambiental|escombros?|mitigaci(ó|o)n|disposici(ó|o)n final|impacto/i },
];

const MONEDA_EXTRANJERA_RX = /\b(USD|EUR|GBP|CAD|MXN)\b|[€£]/;

class ExtractorError extends Error {
  constructor(message) { super(message); this.status = 422; }
}

// ── Selección de hoja: prioriza nombres reconocidos, si no, la más densa ─────
function pickSheet(workbook) {
  const preferred = workbook.SheetNames.find(name => /presupuesto|apu|costos|resumen/i.test(name));
  if (preferred) return preferred;

  let best = workbook.SheetNames[0];
  let bestScore = -1;
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null });
    const score = rows.reduce((acc, row) => acc + row.filter(c => typeof c === 'number').length, 0);
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
}

// ── Detección dinámica de la fila de encabezado (ignora logos/títulos) ──────
function detectHeaderRow(rows) {
  const limit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const row = (rows[i] || []).map(c => String(c ?? '').trim());
    const matches = Object.keys(HEADER_ALIASES).filter(field =>
      row.some(cell => HEADER_ALIASES[field].some(rx => rx.test(cell)))
    );
    if (matches.length >= 3) return i;
  }
  return -1;
}

function mapColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, idx) => {
    const text = String(cell ?? '').trim();
    for (const [field, patterns] of Object.entries(HEADER_ALIASES)) {
      if (!(field in map) && patterns.some(rx => rx.test(text))) map[field] = idx;
    }
  });
  return map;
}

function detectMonedaExtranjera(rows) {
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell === 'string') {
        const m = cell.match(MONEDA_EXTRANJERA_RX);
        if (m) return m[0];
      }
    }
  }
  return null;
}

// ── Parseo de números en formato colombiano ($1.250.000,50 → 1250000.50) ────
function parseNumeroCOP(value) {
  if (typeof value === 'number') return value;
  if (value == null) return 0;
  let s = String(value).trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  } else if (s.includes('.')) {
    // Formato colombiano: un solo punto con exactamente 3 dígitos después
    // (45.000) es separador de miles, no decimal — a diferencia del formato
    // anglosajón. Varios puntos (1.250.000) también son siempre miles.
    const parts = s.split('.');
    const esMiles = parts.length > 2 || parts[parts.length - 1].length === 3;
    if (esMiles) s = parts.join('');
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Extrae, sanitiza e inserta (idempotente, por lotes) las líneas de un
 * presupuesto/APU adjunto. Lanza ExtractorError (HTTP 422) ante archivos
 * inválidos o moneda extranjera.
 */
export async function parseAndSanitizeExcel(buffer, { projectId, orgId, anexoId, anexoIdsAnteriores = [] }) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = pickSheet(workbook);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });

  const monedaExtranjera = detectMonedaExtranjera(rows);
  if (monedaExtranjera) {
    throw new ExtractorError(`Moneda no válida detectada ("${monedaExtranjera}"). RadFor-360 opera estricta y exclusivamente en Pesos Colombianos (COP).`);
  }

  const headerIdx = detectHeaderRow(rows);
  if (headerIdx === -1) {
    throw new ExtractorError('No se pudo identificar una tabla de presupuesto/APU válida en el archivo (encabezados no reconocidos).');
  }

  const colMap = mapColumns(rows[headerIdx]);
  if (!('descripcion' in colMap)) {
    throw new ExtractorError('El archivo no tiene una columna de Descripción/Actividad reconocible.');
  }

  const lineas = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c == null || c === '')) continue;

    const descripcion = String(row[colMap.descripcion] ?? '').trim();
    if (!descripcion) continue;

    const cantidad       = 'cantidad' in colMap ? parseNumeroCOP(row[colMap.cantidad]) : 0;
    const valorUnitario  = 'valor_unitario_cop' in colMap ? parseNumeroCOP(row[colMap.valor_unitario_cop]) : 0;
    let valorTotal        = 'valor_total_cop' in colMap ? parseNumeroCOP(row[colMap.valor_total_cop]) : 0;
    if (!valorTotal && cantidad && valorUnitario) valorTotal = cantidad * valorUnitario;

    const categoria = HSEQ_RULES.find(r => r.regex.test(descripcion))?.categoria || 'NINGUNA';

    lineas.push({
      project_id: projectId,
      anexo_id: anexoId,
      org_id: orgId,
      codigo_item: 'codigo_item' in colMap ? (String(row[colMap.codigo_item] ?? '').trim() || null) : null,
      descripcion,
      unidad: 'unidad' in colMap ? (String(row[colMap.unidad] ?? '').trim() || null) : null,
      cantidad,
      valor_unitario_cop: valorUnitario,
      valor_total_cop: valorTotal,
      categoria_hseq: categoria,
    });
  }

  if (!lineas.length) {
    throw new ExtractorError('No se encontraron filas de datos válidas en el archivo.');
  }

  // Idempotencia: cada subida crea un anexo_id NUEVO (no hay endpoint de
  // "reemplazar archivo"), así que si solo se borrara por este anexo_id nunca
  // encontraría nada que limpiar — el presupuesto corregido se duplicaría con
  // el anterior. anexosIdsAnteriores llega desde anexos.routes.js (anexos
  // previos con el mismo nombre de archivo en este proyecto) para que la
  // limpieza alcance también esas versiones antiguas.
  const idsABorrar = [anexoId, ...anexoIdsAnteriores];
  const { error: delErr } = await supabaseAdmin
    .from('project_apu_lineas')
    .delete()
    .eq('project_id', projectId)
    .in('anexo_id', idsABorrar);
  if (delErr) throw new Error(`No se pudo limpiar la versión anterior del presupuesto: ${delErr.message}`);

  // Chunking: nunca un INSERT masivo único — protege memoria/timeout con
  // presupuestos de miles de filas (acueductos, colegios, vías).
  for (let i = 0; i < lineas.length; i += CHUNK_SIZE) {
    const chunk = lineas.slice(i, i + CHUNK_SIZE);
    const { error } = await supabaseAdmin.from('project_apu_lineas').insert(chunk);
    if (error) throw new Error(`Error insertando líneas de presupuesto (lote ${i}-${i + chunk.length}): ${error.message}`);
  }

  // Los hallazgos de auditoría (HSEQ ausente, descuadres aritméticos) ya NO
  // se generan aquí — esa responsabilidad es de AuditorForenseService.js
  // (Sprint 2), que se llama después de esta función con las líneas recién
  // insertadas. Evita duplicar/competir la escritura en project_hallazgos.
  return { totalLineas: lineas.length, sheetUsada: sheetName, lineas };
}
