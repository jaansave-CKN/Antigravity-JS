import { useEffect, useState } from 'react';

/**
 * CountdownReset — reloj de cuenta regresiva + hora exacta de reset.
 * Mandato del usuario (2026-08-24): "cada vez q aparezca ese texto [límite de
 * IA agotado] dentro de todo RADFOR-360 coloca un reloj con conteo de
 * reversa del tiempo q falta y la hora en q se restablece". Reutilizable en
 * cualquier página que muestre un error de cuota de IA — recibe `retryAt`
 * (ISO string) del body de la respuesta 429 (ver backend/routes/entradaIA.routes.js
 * y backend/services/geminiCircuitBreaker.js::getEarliestRetryAt, que calculan
 * el momento REAL reportado por Google, no una espera fija inventada).
 *
 * FIX (2026-09-06, "el banner engaña al usuario"): esa última frase dejó de
 * ser cierta en todos los casos — cuando Google no reporta un retryDelay
 * real, el backend cae a un cooldown FIJO de sondeo (5 min) que no tiene
 * relación con cuándo la cuota real se libera (si la causa es cuota DIARIA
 * agotada, se libera a medianoche UTC, no en 5 min). Mostrar una cuenta
 * regresiva con "se restablece a las HH:MM:SS" sobre una estimación es una
 * promesa falsa: al llegar a 00:00 el siguiente intento vuelve a fallar y el
 * ciclo se repite. Con `esEstimado=true`, este componente ya NO cuenta hacia
 * atrás ni promete una hora — muestra un aviso honesto y un botón de
 * reintento manual que re-consulta el estado real (`onReintentar`).
 *
 * Se oculta sola (onExpire) cuando el conteo llega a 0 — el caller decide qué
 * hacer (ej. limpiar el error, dejar que el usuario reintente). onExpire NO
 * debe asumir que ya está disponible: debe re-verificar contra el servidor
 * (ver useAiQuotaStatus.verificarYActualizar) antes de reabilitar cualquier
 * acción. `onReintentar` solo se usa en la rama `esEstimado` (sin cronómetro):
 * no es un "reintentar la misma llamada" genérico, es la acción real
 * disponible en esta app cuando el pool del servidor está agotado sin fecha
 * de recuperación confiable — conectar la llave propia del usuario (BYOK,
 * ver dispararRescateBYOK en EntradaPage.tsx).
 */
export default function CountdownReset({
  retryAt, esEstimado, onExpire, onReintentar,
}: {
  retryAt: string;
  esEstimado?: boolean;
  onExpire?: () => void;
  onReintentar?: () => void;
}) {
  const [msRestante, setMsRestante] = useState(() => new Date(retryAt).getTime() - Date.now());

  useEffect(() => {
    if (esEstimado) return; // sin cuenta regresiva sobre una estimación — nada que temporizar
    setMsRestante(new Date(retryAt).getTime() - Date.now());
    const id = setInterval(() => {
      const restante = new Date(retryAt).getTime() - Date.now();
      setMsRestante(restante);
      if (restante <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryAt, esEstimado]);

  if (esEstimado) {
    // Cuota agotada sin un retryDelay real de Google (no un rate-limit
    // temporal corto) — mensaje estático y definitivo, sin cronómetro ni
    // hora de reset prometida. La única acción real disponible en esta app
    // para no esperar es BYOK (conectar la llave propia del usuario, ver
    // dispararRescateBYOK en EntradaPage.tsx) — no existe un botón de
    // "recargar saldo" porque el free tier de Gemini no es un modelo
    // prepago, es una cuota que se libera con el tiempo.
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#b45309' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>error</span>
        Créditos de IA agotados por ahora — no hay una hora de reset garantizada.
        {onReintentar && (
          <button
            type="button"
            onClick={onReintentar}
            style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: 'transparent', border: '1px solid #b45309', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}
          >
            Conectar mi llave de IA
          </button>
        )}
      </span>
    );
  }

  if (msRestante <= 0) return null;

  const totalSeg = Math.ceil(msRestante / 1000);
  const mm = String(Math.floor(totalSeg / 60)).padStart(2, '0');
  const ss = String(totalSeg % 60).padStart(2, '0');
  const horaReset = new Date(retryAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#b45309', fontVariantNumeric: 'tabular-nums' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>schedule</span>
      {mm}:{ss} — se restablece a las {horaReset}
    </span>
  );
}
