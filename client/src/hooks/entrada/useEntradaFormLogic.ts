import { useEntradaEstado } from './useEntradaEstado';
import { useEntradaIAEstado } from './useEntradaIAEstado';
import { useEntradaPersistencia } from './useEntradaPersistencia';
import { useEntradaGeneracionIA } from './useEntradaGeneracionIA';
import { useEntradaReglasCampoC } from './useEntradaReglasCampoC';

/**
 * useEntradaFormLogic — toda la lógica de EntradaPage (refactor 2026-09-28,
 * dictamen architect APROBADO CON CAMBIOS).
 *
 * CONTRATO DE ORDEN (no reordenar): React ejecuta los efectos en el orden de
 * llamada de los hooks, y la página depende de esta secuencia exacta:
 *   (a) estado base (sin efectos) → (b) cuota IA (useAiQuotaStatus) →
 *   (c-f) E1 borrador local → E2 hidratación → E3 sync nombre → useAutoSave →
 *   (g) E4 auto-carga C1 → (h) E5-E9 reglas derivadas.
 * Sin condicionales ni retornos antes del último hook. `st`, `setSt` y los
 * refs pasan por identidad (nunca copias), ver bug del 2026-09-08.
 */
export function useEntradaFormLogic() {
  const estado = useEntradaEstado();
  const { st, setSt } = estado;
  const ia = useEntradaIAEstado();
  const persistencia = useEntradaPersistencia({
    st, setSt,
    hidratacionListaRef: estado.hidratacionListaRef,
    ultimoGuardadoRef: estado.ultimoGuardadoRef,
    sincronizarTrasNombreIA: ia.sincronizarTrasNombreIA,
    setVoiceField: estado.setVoiceField,
    recRef: estado.recRef,
    mainRef: estado.mainRef,
    setLimpiado: estado.setLimpiado,
  });
  const generacion = useEntradaGeneracionIA({ st, setSt, ia });
  useEntradaReglasCampoC({ st, setSt });

  const toggleSector = (s: string) =>
    setSt(p => ({ ...p, sectores: p.sectores.includes(s) ? p.sectores.filter(x => x !== s) : [...p.sectores, s] }));

  const toggleDetalle = (s: string) =>
    setSt(p => ({ ...p, detallePoblacion: p.detallePoblacion.includes(s) ? p.detallePoblacion.filter(x => x !== s) : [...p.detallePoblacion, s] }));

  const toggleMetodologia = (m: string) =>
    setSt(p => ({ ...p, metodologias: p.metodologias.includes(m) ? p.metodologias.filter(x => x !== m) : [...p.metodologias, m] }));

  // Sets en vez de re-escanear el array por cada opción renderizada
  // (react-doctor/js-set-map-lookups) — mismo resultado, O(1) lookup.
  const sectoresSet = new Set(st.sectores);
  const detallePoblacionSet = new Set(st.detallePoblacion);

  const aviso = {
    errorIA: ia.errorIA, retryAtIA: ia.retryAtIA, esEstimadoIA: ia.esEstimadoIA, mensajeCuota: ia.MENSAJE_CUOTA_AGOTADA,
    onExpire: ia.reintentarCuotaIA, onReintentar: ia.dispararRescateBYOK,
  };

  return {
    ...estado, ...ia, ...persistencia, ...generacion,
    toggleSector, toggleDetalle, toggleMetodologia, sectoresSet, detallePoblacionSet, aviso,
  };
}
