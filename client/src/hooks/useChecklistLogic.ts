import { useMemo } from 'react';
import { ACTIVE_PROJECT_KEY, MODULOS, getFormato } from '../components/checklist/checklistModulos';
import { useFormulacionIntegral } from './useFormulacionIntegral';
import { useRadicacion } from './useRadicacion';

/**
 * useChecklistLogic — toda la lógica de ChecklistPage (refactor 2026-09-28,
 * dictamen architect: APROBADO CON CAMBIOS). Semántica conservada a propósito:
 * - formato y proyectoId se leen de localStorage en CADA render (sin estado ni
 *   memo), igual que antes.
 * - estados se calcula UNA vez por montaje (useMemo con []), igual que antes.
 */
export function useChecklistLogic() {
  const formato = getFormato();

  const estados = useMemo(() => MODULOS.map(m => ({ ...m, status: m.compute() })), []);
  const doneCount = estados.filter(e => e.status.percent === 100).length;
  const progress  = Math.round(estados.reduce((sum, e) => sum + e.status.percent, 0) / estados.length);

  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const radicacion = useRadicacion(proyectoId);
  const formulacion = useFormulacionIntegral(proyectoId);

  return { formato, estados, doneCount, progress, proyectoId, radicacion, formulacion };
}
