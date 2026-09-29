import * as XLSX from 'xlsx';
import type { APIRequestContext } from '@playwright/test';

/**
 * Planilla APU de prueba en COP (4 líneas, incluye un ítem EPP) — compartida
 * por formulador-financiero.spec.ts y lote5-config-logistica.spec.ts para que
 * cada spec pueda sembrar su presupuesto sin depender del orden de ejecución.
 */
export function generarExcelApuCOP(): Buffer {
  const filas = [
    ['Item', 'Descripción', 'Unidad', 'Cantidad', 'Valor Unitario', 'Valor Total'],
    ['1', 'Excavación manual en material común', 'm3', 120, 45000, 5400000],
    ['2', 'Suministro e instalación de tubería PVC 6"', 'ml', 300, 82000, 24600000],
    ['3', 'Casco de seguridad industrial (EPP)', 'und', 15, 38000, 570000],
    ['4', 'Señalización y cerramiento de obra', 'gl', 1, 3200000, 3200000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Presupuesto');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Sube la planilla APU por la API REAL de Anexos (mismo camino que usa la UI). */
export async function subirApuPorApi(api: APIRequestContext, proyectoId: string) {
  return api.post(`/api/proyectos/${proyectoId}/anexos`, {
    multipart: {
      categoria: 'presupuesto_apu',
      file: {
        name: 'presupuesto-apu.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: generarExcelApuCOP(),
      },
    },
  });
}
