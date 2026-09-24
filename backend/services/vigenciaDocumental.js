/**
 * vigenciaDocumental.js — F-10: vigencia de documentos de Anexos.
 *
 * Reglas del dueño (2026-09-24):
 *   libertad_tradicion → obsoleto a los 30 días de expedido
 *   apu_cotizacion     → obsoleto a los 6 meses (calendario)
 *   general            → sin caducidad; advertencia si supera 1 año
 *
 * Puro y determinista: recibe "hoy" como 'YYYY-MM-DD' (hoyBogota() lo da en
 * la zona America/Bogota). Toda la aritmética es de fechas civiles en UTC a
 * mediodía-agnóstica (Date.UTC), sin horas: no hay corrimientos por zona.
 *
 * Límite conocido (documentado a pedido de architect): solo un Excel marcado
 * como técnico nace 'presupuesto_apu' → 'apu_cotizacion' (migración 069); una
 * cotización en PDF queda 'general' hasta que el usuario elija el tipo en la
 * tabla de Anexos — por eso el selector manual existe.
 */

export const TIPOS_VIGENCIA = Object.freeze(['libertad_tradicion', 'apu_cotizacion', 'general']);
const DIA_MS = 86_400_000;

export function hoyBogota(ahora = new Date()) {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

function parseFecha(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  // Rechaza fechas imposibles (2026-02-30 → marzo): la fecha debe "sobrevivir".
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

const aIso = (t) => new Date(t).toISOString().slice(0, 10);

// Suma meses calendario con recorte a fin de mes: 31-ago + 6 meses = 28/29-feb.
function sumarMeses(t, meses) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + meses, dia = d.getUTCDate();
  const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(dia, ultimoDia));
}

export function esFechaValida(iso) { return parseFecha(iso) !== null; }

/**
 * @returns {{ estado: 'sin_fecha'|'vigente'|'vencido'|'advertencia'|'fecha_invalida',
 *             tipo_vigencia: string, fecha_documento: string|null,
 *             vence_el: string|null, revisar_desde: string|null,
 *             dias_desde_emision: number|null, dias_restantes: number|null }}
 */
export function calcularVigencia({ tipo_vigencia, fecha_documento }, hoyIso) {
  const tipo = TIPOS_VIGENCIA.includes(tipo_vigencia) ? tipo_vigencia : 'general';
  const base = { tipo_vigencia: tipo, fecha_documento: fecha_documento || null, vence_el: null, revisar_desde: null, dias_desde_emision: null, dias_restantes: null };
  if (!fecha_documento) return { ...base, estado: 'sin_fecha' };

  const emision = parseFecha(String(fecha_documento).slice(0, 10));
  const hoy = parseFecha(hoyIso);
  if (emision === null || hoy === null) return { ...base, estado: 'fecha_invalida' };

  const diasDesde = Math.round((hoy - emision) / DIA_MS);
  if (tipo === 'general') {
    const revisar = sumarMeses(emision, 12);
    return { ...base, dias_desde_emision: diasDesde, revisar_desde: aIso(revisar), estado: hoy > revisar ? 'advertencia' : 'vigente' };
  }
  const vence = tipo === 'libertad_tradicion' ? emision + 30 * DIA_MS : sumarMeses(emision, 6);
  return {
    ...base,
    dias_desde_emision: diasDesde,
    vence_el: aIso(vence),
    dias_restantes: Math.round((vence - hoy) / DIA_MS),
    estado: hoy > vence ? 'vencido' : 'vigente',
  };
}
