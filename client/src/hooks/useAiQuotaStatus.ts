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
}

export function useAiQuotaStatus() {
  const [retryAt, setRetryAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const resp = await http.get<{ success: boolean; data?: EstadoCuota }>('/api/ia/estado-cuota');
      const data = resp?.data;
      setRetryAt(data?.exhausted && data.retryAt ? construirRetryAtConBuffer(data.retryAt) : null);
    } catch {
      // silencioso: si el status-check falla, no bloquea la UI — el 429 real
      // (si de verdad sigue agotado) sigue siendo la fuente de verdad final.
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
  const reportarErrorCuota = useCallback((retryAtCrudo: string | null | undefined) => {
    setRetryAt(construirRetryAtConBuffer(retryAtCrudo ?? null));
  }, []);

  const limpiar = useCallback(() => setRetryAt(null), []);

  return { retryAt, refresh, reportarErrorCuota, limpiar };
}
