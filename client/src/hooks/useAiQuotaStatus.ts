import { useCallback, useEffect, useState } from 'react';
import { http } from '../lib/apiClient';

/**
 * useAiQuotaStatus — mandato 2026-08-24 ("cronómetro desincronizado tras F5"):
 * antes retryAt vivía solo en un useState de página, alimentado únicamente
 * por un 429 en vivo — al recargar la página a mitad de la penalización, el
 * frontend perdía el dato y los botones ✨ volvían a habilitarse aunque el
 * servidor siguiera rechazando. Este hook consulta GET /api/ia/estado-cuota
 * (diseño verificado con `architect`, agentId a08a8feda6c34f832) al montar,
 * para restaurar el estado real ANTES de que el usuario pueda volver a hacer
 * clic. El 429 en vivo (ver reportarErrorCuota) sigue siendo la señal más
 * fresca y gana sobre lo que devuelva este poll.
 *
 * FIX (2026-09-06, "el banner engaña al usuario"): retryAt podía ser una
 * ESTIMACIÓN (cooldown fijo de 5 min cuando Google no reportó un retryDelay
 * real — típico de cuota DIARIA agotada, que en realidad se libera a
 * medianoche UTC, no en 5 min) y la UI la mostraba como una hora de reset
 * garantizada. Al expirar el conteo, el botón se rehabilitaba solo porque el
 * timer local llegó a 0 — no porque el servidor confirmara disponibilidad
 * real — así que el siguiente clic volvía a fallar con el mismo 429,
 * repitiendo el ciclo indefinidamente. Ahora se expone `esEstimado` (la UI
 * no promete una hora cuando es una estimación) y `verificarYActualizar()`
 * (re-consulta el estado REAL antes de reabilitar cualquier botón).
 */

const BUFFER_MS = 3000;

/** +3s de margen sobre el retryAt real — compensa drift de reloj/red entre
 *  cliente y servidor, para que el "00:00" visual no llegue antes de que el
 *  bucket del servidor ya se haya vaciado de verdad. Único punto donde se
 *  aplica (tanto para el poll como para el 429 en vivo, vía reportarErrorCuota)
 *  — nunca se infla en el backend, eso movería el cooldown real del propio
 *  circuit breaker para TODOS los llamantes, no solo la UI. */
export function construirRetryAtConBuffer(retryAt: string | null): string | null {
  if (!retryAt) return null;
  return new Date(new Date(retryAt).getTime() + BUFFER_MS).toISOString();
}

interface EstadoCuota {
  exhausted: boolean;
  retryAt: string | null;
  esEstimado: boolean;
}

export function useAiQuotaStatus() {
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [esEstimado, setEsEstimado] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const resp = await http.get<{ success: boolean; data?: EstadoCuota }>('/api/ia/estado-cuota');
      const data = resp?.data;
      if (data?.exhausted && data.retryAt) {
        setRetryAt(construirRetryAtConBuffer(data.retryAt));
        setEsEstimado(!!data.esEstimado);
      } else {
        setRetryAt(null);
        setEsEstimado(false);
      }
      return !data?.exhausted;
    } catch {
      // silencioso: si el status-check falla, no bloquea la UI — el 429 real
      // (si de verdad sigue agotado) sigue siendo la fuente de verdad final.
      return null;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Mandato 2026-08-24 ("ModalBYOK — al guardar, forzar un refresco del
  // cronómetro"): ByokRequiredModal.tsx vive montado una sola vez a nivel
  // global (main.tsx), no dentro de esta página — no puede llamar a este
  // `refresh` directamente. Dispara este evento global al guardar una llave
  // con éxito; cualquier página con este hook montado se refresca sola.
  useEffect(() => {
    window.addEventListener('ai-quota-refresh', refresh);
    return () => window.removeEventListener('ai-quota-refresh', refresh);
  }, [refresh]);

  /** Llamar desde el catch de una llamada de IA real cuando el backend
   *  reporta un retryAt en el body del 429 — gana sobre lo que haya puesto
   *  el poll, es la señal más fresca posible. */
  const reportarErrorCuota = useCallback((retryAtCrudo: string | null | undefined, esEstimadoCrudo?: boolean) => {
    setRetryAt(construirRetryAtConBuffer(retryAtCrudo ?? null));
    setEsEstimado(!!esEstimadoCrudo);
  }, []);

  const limpiar = useCallback(() => { setRetryAt(null); setEsEstimado(false); }, []);

  /** FIX (2026-09-06): reemplaza el viejo patrón "el timer local llega a 0 →
   *  se asume disponible". Re-consulta el estado REAL del servidor: si ya
   *  está disponible, limpia retryAt y devuelve true (el caller puede
   *  limpiar su propio mensaje de error); si sigue agotado, ACTUALIZA
   *  retryAt/esEstimado con el estado real más reciente (puede ser un nuevo
   *  cooldown, real o estimado) en vez de reabilitar el botón a ciegas. */
  const verificarYActualizar = useCallback(async (): Promise<boolean> => {
    const disponible = await refresh();
    return disponible === true;
  }, [refresh]);

  return { retryAt, esEstimado, refresh, reportarErrorCuota, limpiar, verificarYActualizar };
}
