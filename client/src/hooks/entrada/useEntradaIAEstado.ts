import { useCallback, useRef, useState } from 'react';
import { useAiQuotaStatus } from '../useAiQuotaStatus';

/**
 * (b) Estado de IA y cuota de EntradaPage — extraído LITERAL de
 * pages/EntradaPage.tsx (refactor 2026-09-28). Única instancia de
 * useAiQuotaStatus de la página (sus 2 efectos corren antes que E1/E2).
 */
export function useEntradaIAEstado() {
  // REFACTOR (2026-08-22): reemplaza el generandoIA global (bloqueaba TODA
  // la sección) — ahora guarda el id del campo en generación ('situacion_actual'…
  // 'incertidumbre', o 'C1' para la lista de problemáticas), null si ninguno.
  const [generandoCampo, setGenerandoCampo] = useState<string | null>(null);
  const [errorIA, setErrorIA] = useState<string | null>(null);
  // Mandato 2026-08-24 ("cronómetro desincronizado tras F5"): retryAtIA ya no
  // es un useState de página — el hook consulta GET /api/ia/estado-cuota al
  // montar, restaurando el bloqueo real si el usuario recarga a mitad de la
  // penalización (antes se perdía y los botones ✨ volvían a habilitarse).
  const { retryAt: retryAtIA, esEstimado: esEstimadoIA, reportarErrorCuota, verificarYActualizar } = useAiQuotaStatus();
  const cuotaAgotada = !!retryAtIA;
  // FIX (2026-09-06, "el banner engaña al usuario"): reemplaza el viejo
  // onExpire={() => { setErrorIA(null); limpiarRetryAtIA(); }} — ese patrón
  // reabilitaba el botón solo porque el timer LOCAL llegó a 0, sin preguntarle
  // al servidor si la cuota real ya está disponible. Si el cooldown mostrado
  // era una estimación (cuota diaria agotada, no un retryDelay real de
  // Google), el siguiente clic volvía a fallar con el mismo 429 — ciclo
  // infinito. Ahora se re-consulta el estado real (verificarYActualizar);
  // solo se limpia el mensaje de error si el servidor confirma disponibilidad.
  // Si sigue agotado, el hook ya actualizó retryAtIA/esEstimadoIA con el
  // cooldown real más reciente — el banner se refresca solo, sin mentir.
  const reintentarCuotaIA = useCallback(async () => {
    const disponible = await verificarYActualizar();
    if (disponible) setErrorIA(null);
  }, [verificarYActualizar]);
  // Mismo texto que EntradaIAService.js (rewrap de GeminiPoolExhaustedError) —
  // se muestra cuando retryAtIA llegó por el poll on-mount (F5 a mitad de la
  // penalización) y todavía no hay un errorIA fresco de un clic real.
  // FIX (2026-09-06, "el banner engaña al usuario"): el texto ya no es fijo —
  // "intenta de nuevo en unos minutos" es una promesa de tiempo que solo es
  // cierta cuando Google reportó un retryDelay real (rate-limit temporal,
  // esEstimadoIA=false). Cuando es una estimación (cuota agotada sin fecha de
  // recuperación confiable), el mensaje debe ser definitivo y accionable —
  // ver CountdownReset.tsx para el mismo criterio en el sub-mensaje.
  const MENSAJE_CUOTA_AGOTADA = esEstimadoIA
    ? 'La IA del servidor no está disponible por ahora — no hay una hora de reset garantizada. Puedes llenar el formulario manualmente o intentar más tarde (opcional: conectar tu propia llave de Gemini como respaldo).'
    : 'El límite de uso de IA está agotado por ahora — intenta de nuevo en unos segundos, o llena el formulario manualmente.';
  // Mandato 2026-08-24 ("ModalBYOK — interceptar el bloqueo"): los botones ✨
  // ya NO quedan 100% inactivos durante cuotaAgotada — siguen siendo
  // clicables (ver className `--cooldown` en vez de `disabled`), y el clic
  // dispara este modal de rescate en vez de intentar la generación real.
  // ByokRequiredModal.tsx (montado global en main.tsx) escucha este evento.
  const dispararRescateBYOK = useCallback(() => {
    window.dispatchEvent(new CustomEvent('byok-rescate'));
  }, []);
  // Guarda de re-entrada real (2026-08-25, "sigue quemando tokens sin razón"):
  // evidencia dura en ai_token_logs mostró 2 llamadas reales completas a
  // Gemini con 318ms de diferencia — imposible como doble clic humano. Los
  // `generando*` de useState NO bloquean esto de forma confiable: el atributo
  // `disabled` del botón solo se aplica al DOM después de que React
  // re-renderiza, dejando una ventana real donde un segundo disparo (doble
  // clic, evento duplicado, lo que sea la causa exacta) todavía ve el botón
  // habilitado. Este Set vive en un ref — se marca/revisa de forma síncrona,
  // sin esperar ningún render, así que ninguna llamada real a Gemini puede
  // duplicarse sin importar de dónde venga el segundo disparo.
  const enVueloRef = useRef<Set<string>>(new Set());
  // useCallback([]): solo tocan el ref, así que su identidad es estable y
  // pueden declararse como dependencias sin cambiar cuándo corre nada.
  const marcarEnVuelo = useCallback((clave: string): boolean => {
    if (enVueloRef.current.has(clave)) return false;
    enVueloRef.current.add(clave);
    return true;
  }, []);
  const liberarEnVuelo = useCallback((clave: string) => { enVueloRef.current.delete(clave); }, []);
  const [generandoNombre, setGenerandoNombre] = useState(false);
  // Flag para el efecto E3 (useEntradaPersistencia): sincronizarProyectoActivo()
  // lee `st.nombre` de SU PROPIO closure (useCallback con dep [st.nombre]) —
  // llamarlo justo después de un setSt() en la misma función seguiría viendo
  // el nombre VIEJO (closure de este render, antes de que React re-renderice
  // con el nuevo st.nombre). Este ref le avisa al efecto que corra recién
  // cuando st.nombre YA cambió (siguiente render, closure fresco).
  const sincronizarTrasNombreIA = useRef(false);
  // Pitch (mandato 2026-08-24, campo nuevo debajo de Nombre) — a diferencia
  // de nombre, pitch NO tiene columna propia en `proyectos` (verificado por
  // architect: no existe en ningún esquema/migración) — vive solo dentro de
  // `ficha_tecnica.entrada_completa`, se persiste con el SAVE normal de esta
  // página, sin ningún mecanismo de sincronización especial.
  const [generandoPitch, setGenerandoPitch] = useState(false);

  return {
    generandoCampo, setGenerandoCampo, errorIA, setErrorIA, retryAtIA, esEstimadoIA, reportarErrorCuota,
    cuotaAgotada, reintentarCuotaIA, MENSAJE_CUOTA_AGOTADA, dispararRescateBYOK, marcarEnVuelo, liberarEnVuelo,
    generandoNombre, setGenerandoNombre, sincronizarTrasNombreIA, generandoPitch, setGenerandoPitch,
  };
}
