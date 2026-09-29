import { useCallback, useRef, useState } from 'react';
import {
  ACTIVE_PROJECT_KEY, ESTADO_INICIAL, borradorEstaVacio, leerEntradaStorage, type EntradaState,
} from '../../components/entrada/entradaModelo';

/**
 * (a) Estado base de EntradaPage — extraído LITERAL de pages/EntradaPage.tsx
 * (refactor 2026-09-28, dictamen architect APROBADO CON CAMBIOS). SIN efectos:
 * el orden de efectos de la página lo fija useEntradaFormLogic (a→h).
 */
export function useEntradaEstado() {
  // FIX (2026-09-08, "sigue vacío incluso tras el fix de la clave por
  // proyecto" — causa raíz real encontrada con logs del backend en vivo: CERO
  // peticiones a GET /api/proyectos/:id llegaron al servidor, ni una sola,
  // pese a recargas reales del usuario). El efecto de auto-save (más abajo)
  // corre en CADA montaje, incluido el primero, con `st = ESTADO_INICIAL`
  // (nada hidratado todavía) — y React ejecuta los efectos en el orden en que
  // se declaran, así que ese auto-save se dispara ANTES que el efecto de
  // hidratación de abajo. Sin este guard, el auto-save escribía el estado
  // vacío en la clave por-proyecto (ya) EN EL PRIMER RENDER, y cuando la
  // hidratación preguntaba "¿ya hay draft local de este proyecto?" encontraba
  // ese vacío recién escrito por sí misma un instante antes — se autoengañaba
  // y JAMÁS llegaba a hacer el fetch al servidor. 100% reproducible en
  // cualquier proyecto sin draft local previo, no una condición de carrera
  // esporádica. `hidratacionListaRef` bloquea el auto-save hasta que la
  // hidratación (de localStorage YA existente, o del fetch al servidor) haya
  // corrido al menos una vez.
  const hidratacionListaRef = useRef(false);
  const [st, setSt] = useState<EntradaState>(() => {
    try {
      const raw = leerEntradaStorage(localStorage.getItem(ACTIVE_PROJECT_KEY));
      if (!raw) return ESTADO_INICIAL;
      const parsed = JSON.parse(raw);
      // Un draft "vacío" ya escrito por el bug de la carrera (ver comentario
      // de arriba) NO cuenta como hidratación real — si se marcara aquí, la
      // hidratación de abajo nunca volvería a preguntarle al servidor y el
      // usuario quedaría atascado viendo el formulario en blanco para
      // siempre, incluso con este fix ya desplegado.
      if (!borradorEstaVacio(parsed)) hidratacionListaRef.current = true;
      // Merge profundo de contextoMeta/soluciones: una sesión guardada ANTES
      // de estos mandatos (2026-08-23/24) no trae tipoFormulacion ni
      // soluciones — un spread superficial dejaría undefined en vez de
      // heredar el default.
      return {
        ...ESTADO_INICIAL, ...parsed,
        contextoMeta: { ...ESTADO_INICIAL.contextoMeta, ...(parsed.contextoMeta || {}) },
        soluciones: { ...ESTADO_INICIAL.soluciones, ...(parsed.soluciones || {}) },
      };
    } catch { return ESTADO_INICIAL; }
  });
  const [limpiado, setLimpiado] = useState(false);
  // MANDATO (2026-08-24, "indicador de cambios sin guardar", aplica a todas
  // las ventanas del Formulador): dirty-tracking real por comparación de
  // snapshot, no el flash cosmético de 2.2s que había antes (ese no sabía
  // distinguir "nada cambió" de "cambié algo justo después de guardar").
  // ultimoGuardadoRef arranca en null y se fija UNA vez con el guard de abajo
  // (no con el 2º argumento de useRef, que se re-evaluaría — y re-stringify-
  // aría todo el estado — en cada render sin usarse). Se actualiza de nuevo
  // solo cuando: (a) la hidratación async desde servidor trae datos o (b) un
  // guardar() exitoso — nunca de forma optimista.
  const ultimoGuardadoRef = useRef<string | null>(null);
  if (ultimoGuardadoRef.current === null) ultimoGuardadoRef.current = JSON.stringify(st);
  const sinGuardar = JSON.stringify(st) !== ultimoGuardadoRef.current;

  const mainRef = useRef<HTMLElement>(null);
  const [voiceField, setVoiceField] = useState<string | null>(null);
  const recRef = useRef<any>(null);

  const toggleVoice = useCallback((fieldId: string) => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Usa Chrome para activar el micrófono.'); return; }

    if (voiceField === fieldId) {
      recRef.current?.stop();
      setVoiceField(null);
      return;
    }

    recRef.current?.stop();
    const rec = new SR();
    rec.lang = 'es-CO';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
      }
      if (finalText.trim()) {
        setSt(p => ({ ...p, contexto: { ...p.contexto, [fieldId]: ((p.contexto[fieldId] || '') + ' ' + finalText.trim()).trimStart() } }));
      }
    };
    rec.onerror = () => setVoiceField(null);
    rec.onend   = () => setVoiceField(null);
    rec.start();
    recRef.current = rec;
    setVoiceField(fieldId);
  }, [voiceField]);

  // Candado por campo (mandato 2026-08-24) — bloquea/desbloquea un campo
  // contra ediciones manuales Y contra regeneración con IA. `campoBloqueado`
  // es derivado (nunca estado separado) para que siempre refleje `st` sin
  // riesgo de desincronizarse.
  const campoBloqueado = (id: string) => !!st.camposBloqueados[id];
  const toggleBloqueo = (id: string) =>
    setSt(p => ({ ...p, camposBloqueados: { ...p.camposBloqueados, [id]: !p.camposBloqueados[id] } }));

  return {
    st, setSt, hidratacionListaRef, ultimoGuardadoRef, sinGuardar, limpiado, setLimpiado,
    mainRef, voiceField, setVoiceField, recRef, toggleVoice, campoBloqueado, toggleBloqueo,
  };
}
