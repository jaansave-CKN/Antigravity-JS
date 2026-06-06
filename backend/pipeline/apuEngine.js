import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const ALERTA_DESVIACION_PCT = 0.30;

export const RENDIMIENTOS_CATALOGO = Object.freeze({
  descapote:             { fase: 'NEGRA',  unidad: 'm2',  valor: 250.00 },
  excavacion_manual:     { fase: 'NEGRA',  unidad: 'm3',  valor:   2.00 },
  excavacion_mecanica:   { fase: 'NEGRA',  unidad: 'm3',  valor:  50.00 },
  relleno_compactado:    { fase: 'NEGRA',  unidad: 'm3',  valor:   4.00 },
  concreto_cimentacion:  { fase: 'NEGRA',  unidad: 'm3',  valor:   1.50 },
  mamposteria_cimientos: { fase: 'NEGRA',  unidad: 'm2',  valor:   6.00 },
  encofrado_cimientos:   { fase: 'NEGRA',  unidad: 'm2',  valor:   8.00 },
  concreto_columnas:     { fase: 'GRIS',   unidad: 'm3',  valor:   1.20 },
  concreto_vigas:        { fase: 'GRIS',   unidad: 'm3',  valor:   1.50 },
  placa_entrepiso:       { fase: 'GRIS',   unidad: 'm2',  valor:   5.00 },
  mamposteria_bloque:    { fase: 'GRIS',   unidad: 'm2',  valor:   8.00 },
  panete_rustico:        { fase: 'GRIS',   unidad: 'm2',  valor:  10.00 },
  panete_liso:           { fase: 'GRIS',   unidad: 'm2',  valor:   8.00 },
  instalacion_hidro:     { fase: 'GRIS',   unidad: 'pto', valor:   1.50 },
  instalacion_electrica: { fase: 'GRIS',   unidad: 'pto', valor:   2.00 },
  enchape_piso:          { fase: 'BLANCA', unidad: 'm2',  valor:   5.00 },
  enchape_muro:          { fase: 'BLANCA', unidad: 'm2',  valor:   4.00 },
  pintura_interior:      { fase: 'BLANCA', unidad: 'm2',  valor:  20.00 },
  pintura_exterior:      { fase: 'BLANCA', unidad: 'm2',  valor:  15.00 },
  cielo_raso_drywall:    { fase: 'BLANCA', unidad: 'm2',  valor:   8.00 },
  piso_vinilo:           { fase: 'BLANCA', unidad: 'm2',  valor:  12.00 },
  piso_madera:           { fase: 'BLANCA', unidad: 'm2',  valor:   6.00 },
  carpinteria_madera:    { fase: 'BLANCA', unidad: 'm2',  valor:   3.00 },
  aparatos_sanitarios:   { fase: 'BLANCA', unidad: 'und', valor:   3.00 },
});

function r2(n) { return Math.round(n * 100) / 100; }

function sumMateriales(mats = []) {
  return mats.reduce((s, m) => s + Number(m.cantidad || 0) * Number(m.precio_unitario || 0), 0);
}

function sumEquipos(eqs = [], cantidad, rend) {
  return eqs.reduce((s, e) => {
    const re = Number(e.rendimiento || rend || 1);
    return s + (re > 0 ? cantidad / re : 0) * Number(e.costo_dia || 0);
  }, 0);
}

export async function getRendimientoRef(clave, getRow = null) {
  if (getRow) {
    try {
      const row = await getRow('SELECT valor, unidad FROM catalogo_rendimientos WHERE clave = ? AND activo = TRUE', [clave]);
      if (row) return { valor: Number(row.valor), unidad: row.unidad };
    } catch (e) {
      logger.warn('[APU] Fallo consultando catalogo_rendimientos — usando catálogo local', { clave, err: e.message });
    }
  }
  const loc = RENDIMIENTOS_CATALOGO[clave];
  return loc ? { valor: loc.valor, unidad: loc.unidad } : null;
}

export async function calcularAPU(item, getRow = null) {
  const cantidad    = Number(item.cantidad        || 0);
  const rendReal    = Number(item.rendimiento_real || 0);
  const costoJornal = Number(item.costo_jornal_dia || 0);
  const aiu         = Number(item.aiu ?? 0.28);

  if (cantidad <= 0) throw new Error('APU_ERROR: cantidad debe ser > 0');
  if (rendReal <= 0) throw new Error('APU_ERROR: rendimiento_real debe ser > 0');

  const ref           = await getRendimientoRef(item.rendimiento_std, getRow);
  const rendRef       = ref?.valor ?? rendReal;
  const desviacionPct = r2(((rendReal - rendRef) / rendRef) * 100);
  const alerta        = Math.abs(desviacionPct / 100) > ALERTA_DESVIACION_PCT;

  const jornadas        = r2(cantidad / rendReal);
  const costoManoObra   = r2(jornadas * costoJornal);
  const costoMateriales = r2(sumMateriales(item.materiales));
  const costoEquipos    = r2(sumEquipos(item.equipos || [], cantidad, rendReal));
  const costoDirecto    = r2(costoManoObra + costoMateriales + costoEquipos);
  const valorTotal      = r2(costoDirecto * (1 + aiu));

  return { rendimiento_ref: rendRef, desviacion_pct: desviacionPct, alerta_rendimiento: alerta,
           jornales: jornadas, costo_mano_obra: costoManoObra, costo_materiales: costoMateriales,
           costo_equipos: costoEquipos, costo_directo: costoDirecto,
           aiu_valor: r2(costoDirecto * aiu), valor_total: valorTotal };
}

export async function procesarPresupuesto(items = [], getRow = null) {
  const procesados = await Promise.all(items.map(it => calcularAPU(it, getRow).then(apu => ({ ...it, ...apu }))));
  const porFase = { NEGRA: 0, GRIS: 0, BLANCA: 0 };
  const alertas = [];
  for (const it of procesados) {
    const fase = String(it.fase || '').toUpperCase();
    if (fase in porFase) porFase[fase] = r2(porFase[fase] + it.valor_total);
    if (it.alerta_rendimiento) alertas.push({ item: it.item, fase: it.fase, rendimiento_real: it.rendimiento_real, rendimiento_ref: it.rendimiento_ref, desviacion_pct: it.desviacion_pct });
  }
  const total = r2(Object.values(porFase).reduce((s, v) => s + v, 0));
  return { items: procesados, porFase, total, alertas };
}
