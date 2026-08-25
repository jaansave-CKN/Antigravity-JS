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
 * Se oculta sola (onExpire) cuando el conteo llega a 0 — el caller decide qué
 * hacer (ej. limpiar el error, dejar que el usuario reintente).
 */
export default function CountdownReset({ retryAt, onExpire }: { retryAt: string; onExpire?: () => void }) {
  const [msRestante, setMsRestante] = useState(() => new Date(retryAt).getTime() - Date.now());

  useEffect(() => {
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
  }, [retryAt]);

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
