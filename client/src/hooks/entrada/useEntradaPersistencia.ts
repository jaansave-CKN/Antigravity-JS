import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { getAuthHeaders, http } from '../../lib/apiClient';
import { useAutoSave } from '../useAutoSave';
import {
  ACTIVE_PROJECT_KEY, ACTIVE_PROJECT_NAME_KEY, ESTADO_INICIAL, STORAGE_KEY_LEGACY, STORAGE_KEY_LEGACY_GLOBAL,
  borradorEstaVacio, claveEntrada, leerEntradaStorage, type EntradaState,
} from '../../components/entrada/entradaModelo';

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Combina lo que llegó del servidor con lo que el usuario YA escribió mientras
 * la hidratación estaba en vuelo (2026-09-29): antes `setSt(merged)` pisaba esas
 * ediciones y se perdían sin aviso (ventana de 0,4–2 s tras cargar la página;
 * lo destapó el e2e de autoguardado al activar PlanGate en CI). Un campo cuenta
 * como editado si difiere del estado con que montó la página. Pura: apta como
 * updater de setState.
 */
function conservarEdicionesDuranteCarga(inicial: EntradaState, servidor: EntradaState, actual: EntradaState): EntradaState {
  const out: Record<string, unknown> = { ...servidor };
  const ini = inicial as unknown as Record<string, unknown>;
  const act = actual as unknown as Record<string, unknown>;
  const srv = servidor as unknown as Record<string, unknown>;
  for (const k of Object.keys(act)) {
    if (k === 'contextoMeta' || k === 'soluciones') {
      const anidado: Record<string, unknown> = { ...((srv[k] as Record<string, unknown>) || {}) };
      const a = (act[k] as Record<string, unknown>) || {};
      const i = (ini[k] as Record<string, unknown>) || {};
      for (const kk of Object.keys(a)) if (!igual(a[kk], i[kk])) anidado[kk] = a[kk];
      out[k] = anidado;
    } else if (!igual(act[k], ini[k])) {
      out[k] = act[k];
    }
  }
  return out as unknown as EntradaState;
}

interface Deps {
  st: EntradaState;
  setSt: Dispatch<SetStateAction<EntradaState>>;
  hidratacionListaRef: MutableRefObject<boolean>;
  ultimoGuardadoRef: MutableRefObject<string | null>;
  sincronizarTrasNombreIA: MutableRefObject<boolean>;
  setVoiceField: Dispatch<SetStateAction<string | null>>;
  recRef: MutableRefObject<{ stop: () => void } | null>;
  mainRef: RefObject<HTMLElement | null>;
  setLimpiado: Dispatch<SetStateAction<boolean>>;
}

/**
 * (c-f) Persistencia de EntradaPage — extraída LITERAL de pages/EntradaPage.tsx
 * (refactor 2026-09-28, dictamen architect APROBADO CON CAMBIOS). El orden de
 * los efectos es parte del contrato: E1 (borrador local) → E2 (hidratación) →
 * E3 (sincronizar nombre tras IA) → useAutoSave. Ver el bug del 2026-09-08
 * en useEntradaEstado.ts. `st` y los refs llegan por identidad, sin copias.
 */
export function useEntradaPersistencia({
  st, setSt, hidratacionListaRef, ultimoGuardadoRef, sincronizarTrasNombreIA, setVoiceField, recRef, mainRef, setLimpiado,
}: Deps) {
  // E1 — Auto-save: persiste cada cambio sin necesidad de presionar SAVE.
  // Clave por proyecto (ver claveEntrada) — nunca pisa el draft de otro.
  // Bloqueado hasta que la hidratación de abajo corra al menos una vez (ver
  // comentario de hidratacionListaRef) — si no, este efecto escribe el
  // ESTADO_INICIAL vacío ANTES de que la hidratación tenga oportunidad de
  // preguntarle al servidor, y esa escritura hace que la hidratación se
  // autoengañe pensando que ya hay un draft local real.
  useEffect(() => {
    if (!hidratacionListaRef.current) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    localStorage.setItem(claveEntrada(proyectoId), JSON.stringify(st));
  }, [st, hidratacionListaRef]);

  // E2 — Hidratación: prioridad real de datos para EL PROYECTO ACTIVO actual —
  //   1. Draft local YA GUARDADO para este proyectoId específico (edición en
  //      curso en este navegador, más reciente que lo último sincronizado).
  //   2. Si no hay draft local para este proyecto: SIEMPRE se pregunta al
  //      servidor (antes esto se saltaba si CUALQUIER draft de CUALQUIER otro
  //      proyecto vivía en la clave global — ver comentario de STORAGE_KEY_BASE
  //      en entradaModelo.ts, esa es la causa raíz confirmada del reporte "se
  //      perdió la información que ya tenía guardada": la BD nunca perdió nada).
  //   3. Solo si el servidor NO tiene entrada_completa (proyecto nuevo, nunca
  //      sincronizado) se recupera el draft huérfano de la clave global vieja
  //      (pre-2026-09-07, sin proyectoId) — mandato de cero pérdida de datos
  //      para un draft que nunca llegó a guardarse en el servidor.
  useEffect(() => {
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const draftLocal = leerEntradaStorage(proyectoId);
    // Un draft vacío (ver borradorEstaVacio) NO cuenta como "ya hidratado" —
    // sin este chequeo, un draft fantasma ya escrito por el bug de la carrera
    // bloquearía el fetch al servidor para siempre, incluso con el fix de la
    // carrera ya desplegado (el fix evita ESCRIBIR nuevos fantasmas, pero no
    // limpia por sí solo los que ya existían en el navegador del usuario).
    let draftEsReal = false;
    if (draftLocal) {
      try { draftEsReal = !borradorEstaVacio(JSON.parse(draftLocal)); } catch { draftEsReal = false; }
    }
    if (draftEsReal) { hidratacionListaRef.current = true; return; } // ya hay draft local REAL de ESTE proyecto
    if (!proyectoId) { hidratacionListaRef.current = true; return; } // sin proyecto activo — nada que hidratar
    (async () => {
      let estadoActualizado = false;
      try {
        const body = await fetch(`/api/proyectos/${proyectoId}`, { headers: { ...getAuthHeaders() }, credentials: 'include' })
          .then(r => r.json());
        let entrada = body?.data?.ficha_tecnica?.entrada_completa;
        if (!entrada) {
          // Proyecto sin entrada_completa en servidor — único caso en que un
          // draft huérfano de la clave global vieja es seguro de recuperar
          // (no puede estar pisando datos reales de OTRO proyecto ya
          // sincronizado, porque este todavía no tiene ninguno).
          const huerfano = localStorage.getItem(STORAGE_KEY_LEGACY_GLOBAL);
          if (huerfano) {
            try { entrada = JSON.parse(huerfano); } catch { /* descartar si está corrupto */ }
            localStorage.removeItem(STORAGE_KEY_LEGACY_GLOBAL);
          }
        }
        // Mismo merge profundo que la hidratación desde localStorage (FIX
        // 2026-08-24) — este camino solo corre cuando NO hay draft local de
        // este proyecto, pero el objeto que llega del servidor puede ser
        // igual de viejo/incompleto.
        // FIX (react-doctor no-impure-state-updater, 2026-09-05): el merge y
        // la escritura del ref vivían dentro del updater de setSt — React
        // puede reintentar/descartar un updater, así que un side effect ahí
        // (el ref write) no es seguro. Este efecto corre una sola vez
        // ([] deps) al montar, así que `st` del closure es equivalente a
        // `prev` en la ejecución real — se calcula el merge fuera y se llama
        // setSt con el valor ya resuelto.
        if (entrada) {
          const merged = {
            ...st, ...entrada,
            contextoMeta: { ...st.contextoMeta, ...(entrada.contextoMeta || {}) },
            soluciones: { ...st.soluciones, ...(entrada.soluciones || {}) },
          };
          // Esto ES la última copia sincronizada con el servidor — fijarla
          // como línea base de "guardado" para que el botón no aparezca en
          // rojo (sinGuardar) apenas termina de cargar, sin que el usuario
          // haya tocado nada todavía.
          ultimoGuardadoRef.current = JSON.stringify(merged);
          // Lo que el usuario escribió durante la carga gana sobre el servidor;
          // como difiere de la línea base, el auto-save lo sube al desbloquearse.
          setSt(actual => conservarEdicionesDuranteCarga(st, merged, actual));
          estadoActualizado = true;
        }
      } catch { /* sin conexión — se queda con ESTADO_INICIAL */ }
      finally {
        // El intento de hidratación (con o sin éxito) ya corrió — desbloquea
        // el auto-save. Si esto se marcara ANTES del fetch (o nunca), se
        // reproduce el bug real: el auto-save gana la carrera y escribe un
        // vacío que la próxima recarga confunde con un draft real.
        hidratacionListaRef.current = true;
        // Sin setSt arriba (proyecto sin entrada en el servidor) no habría
        // re-render, y useAutoSave lee `habilitado` en el render: lo escrito
        // durante la carga no se subía hasta la siguiente tecla (2026-09-29).
        // Una copia del estado re-evalúa el auto-save; si no hay cambios
        // frente a la línea base, la cola no envía nada.
        if (!estadoActualizado) setSt(actual => ({ ...actual }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Proyecto activo — persistencia real en BD (POST /api/proyectos) ─────────
  // M1 (Entrada) es donde el usuario nombra su proyecto por primera vez en el
  // wizard del Formulador. Al salir del campo "nombre":
  //   - si no hay proyecto activo aún, se crea uno real vía POST /api/proyectos
  //     y se guarda el id devuelto por la BD (nunca un UUID generado en cliente).
  //   - si ya existe y el nombre cambió, se sincroniza vía PATCH /api/proyectos/:id.
  // El resto de la app (header del Dashboard Formulador, AnexosView, etc.) lee
  // rf360_proyecto_activo/rf360_proyecto_nombre y por lo tanto siempre apunta
  // a un proyecto que realmente existe en la tabla `projects`.
  const sincronizandoProyectoRef = useRef(false);
  const [sincronizandoProyecto, setSincronizandoProyecto] = useState(false);
  const [errorProyecto, setErrorProyecto] = useState<string | null>(null);
  // FIX (2026-08-24, "diferenciar Nombre del Proyecto de Nombre del
  // Archivo"): antes el dedup de este blur comparaba contra
  // ACTIVE_PROJECT_NAME_KEY — esa key ahora es propiedad exclusiva de
  // ProyectoSelectorModal.tsx (guarda nombre_archivo, el identificador
  // corto), así que compararla contra el nombre largo de este campo nunca
  // coincidiría. Este ref lleva su propio registro de "último nombre de
  // proyecto (el texto largo) sincronizado con el servidor" — arranca en
  // null a propósito: el primer blur después de cargar la página siempre
  // dispara un PATCH idempotente (mismo valor ya guardado, sin efecto real),
  // que es preferible a intentar adivinar el valor server-side sin haberlo
  // leído todavía.
  const ultimoNombreProyectoSincronizadoRef = useRef<string | null>(null);

  const sincronizarProyectoActivo = useCallback(async () => {
    const nombre = st.nombre.trim();
    if (!nombre || sincronizandoProyectoRef.current) return;
    if (nombre === ultimoNombreProyectoSincronizadoRef.current) return; // nada que sincronizar

    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);

    sincronizandoProyectoRef.current = true;
    setSincronizandoProyecto(true);
    setErrorProyecto(null);
    try {
      if (!proyectoId) {
        const res = await fetch('/api/proyectos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          credentials: 'include',
          body: JSON.stringify({ nombre }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo crear el proyecto.');

        const idReal = body.id ?? body.proyectoId;
        if (!idReal) throw new Error('La respuesta del servidor no incluyó un id de proyecto.');

        localStorage.setItem(ACTIVE_PROJECT_KEY, idReal);
        // Proyecto recién creado: todavía no tiene un "Nombre de Archivo"
        // propio (se edita desde ProyectoSelectorModal.tsx) — se siembra UNA
        // vez con el valor que el propio backend derivó (nombre truncado a
        // 60 chars, ver proyectos.routes.js) para que el header "Archivo:"
        // no quede vacío hasta que el usuario abra el selector.
        localStorage.setItem(ACTIVE_PROJECT_NAME_KEY, body.nombreArchivo || nombre);
      } else {
        const res = await fetch(`/api/proyectos/${proyectoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          credentials: 'include',
          body: JSON.stringify({ nombre }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo actualizar el nombre del proyecto.');
        // NO se toca ACTIVE_PROJECT_NAME_KEY aquí — "Nombre de Archivo" es
        // propiedad exclusiva de ProyectoSelectorModal.tsx desde este fix;
        // pisarlo con el nombre largo en cada blur era justo el bug
        // reportado por el usuario.
      }
      ultimoNombreProyectoSincronizadoRef.current = nombre;
      // Notifica a componentes hermanos montados en la misma pestaña (ej. el
      // Dashboard Formulador embebido en FormuladorLayout) — el evento nativo
      // "storage" solo dispara en OTRAS pestañas, así que se despacha a mano.
      window.dispatchEvent(new StorageEvent('storage', { key: ACTIVE_PROJECT_KEY }));
    } catch (err: any) {
      setErrorProyecto(err?.message ?? 'Error al sincronizar el proyecto con el servidor.');
    } finally {
      sincronizandoProyectoRef.current = false;
      setSincronizandoProyecto(false);
    }
  }, [st.nombre]);

  // E3 — ver comentario de sincronizarTrasNombreIA (useEntradaIAEstado) —
  // corre en el render SIGUIENTE al setSt del nombre generado por IA, cuando
  // sincronizarProyectoActivo ya tiene el st.nombre nuevo en su closure.
  useEffect(() => {
    if (sincronizarTrasNombreIA.current) {
      sincronizarTrasNombreIA.current = false;
      sincronizarProyectoActivo();
    }
  }, [st.nombre, sincronizarProyectoActivo, sincronizarTrasNombreIA]);

  const [errorEntradaCompleta, setErrorEntradaCompleta] = useState<string | null>(null);

  // LOTE 10 (2026-09-25): autoguardado contra el servidor (espera 1,5 s +
  // cola SERIALIZADA, ver hooks/useAutoSave.ts). Antes solo el botón SAVE
  // subía entrada_completa; el resto quedaba en el borrador local.
  //   - Deshabilitado hasta que termine la hidratación (hidratacionListaRef):
  //     si no, subiría el ESTADO_INICIAL encima de los datos reales.
  //   - NUNCA autoguarda un formulario vacío ni sin proyecto activo: LIMPIAR
  //     deja el formulario en blanco y, sin esto, 1,5 s después borraría en
  //     el servidor la entrada real del proyecto. SAVE manual sí puede.
  const guardarEntradaEnServidor = useCallback(async (valor: EntradaState) => {
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) throw new Error('Sin proyecto activo');
    try {
      await http.patch(`/api/proyectos/${proyectoId}/ficha-tecnica-merge`, { key: 'entrada_completa', value: valor });
      setErrorEntradaCompleta(null);
    } catch (e) {
      setErrorEntradaCompleta('Se guardó localmente, pero no se pudo sincronizar con el servidor.');
      throw e;
    }
  }, []);
  const autoGuardado = useAutoSave({
    valor: st,
    habilitado: hidratacionListaRef.current,
    guardar: guardarEntradaEnServidor,
    ultimoGuardadoRef,
    puedeGuardar: (v) => !!localStorage.getItem(ACTIVE_PROJECT_KEY) && !borradorEstaVacio(v as unknown as Record<string, unknown>),
  });
  // FIX (2026-08-24, "audita la demora — el botón no da ninguna señal de que
  // el clic se registró"): guardar() no tenía NINGÚN estado de "en curso" —
  // el botón se quedaba diciendo "SAVE" en rojo, sin diferencia visual entre
  // "no he tocado nada" y "hay un PATCH en vuelo". Mismo patrón ya usado en
  // ContextoPage.tsx/PresupuestoPage.tsx (botón deshabilitado + "Guardando…"
  // mientras dura la petición).
  const [guardando, setGuardando] = useState(false);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): `if (guardando) return` leía estado de React, que no se
  // actualiza sincrónicamente entre 2 invocaciones en el mismo tick (antes
  // del primer re-render) — un ref sí protege contra eso.
  const guardandoRef = useRef(false);

  const guardar = async () => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    // Antes SAVE solo escribía localStorage — de las 11 secciones de Entrada
    // solo "nombre" llegaba al servidor (vía sincronizarProyectoActivo). Aquí
    // se persiste el resto (enfoque, sectores, población, contexto, etc.)
    // como una clave dentro de ficha_tecnica, igual que ya hace ContextoPage.
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    localStorage.setItem(claveEntrada(proyectoId), JSON.stringify(st));
    // FIX (2026-08-24, "SAVE se queda en rojo sin ningún aviso"): antes esto
    // era un `return` mudo — sin proyecto activo, el botón se quedaba rojo
    // para siempre sin ninguna pista de por qué. Ahora se avisa explícito,
    // igual que el catch de abajo cuando el PATCH sí se intenta y falla.
    if (!proyectoId) {
      setErrorEntradaCompleta('No hay proyecto activo — se guardó localmente, pero no se pudo sincronizar con el servidor.');
      guardandoRef.current = false;
      setGuardando(false);
      return;
    }
    try {
      // LOTE 10: la MISMA cola del autoguardado (nunca compite con él).
      // ultimoGuardadoRef solo avanza tras éxito confirmado (dentro de la
      // cola) — si el PATCH falla, sinGuardar sigue en rojo y
      // guardarEntradaEnServidor deja el mensaje de error visible.
      await autoGuardado.guardarAhora({ forzar: true });
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const limpiar = () => {
    localStorage.removeItem(claveEntrada(localStorage.getItem(ACTIVE_PROJECT_KEY)));
    localStorage.removeItem(STORAGE_KEY_LEGACY);
    localStorage.removeItem(STORAGE_KEY_LEGACY_GLOBAL);
    // Limpieza total: incluso las metodologías con valor por defecto (Marco Lógico)
    // quedan sin marcar — LIMPIAR deja el formulario completamente en blanco.
    setSt({ ...JSON.parse(JSON.stringify(ESTADO_INICIAL)), metodologias: [] });
    setVoiceField(null);
    recRef.current?.stop();
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  return {
    sincronizandoProyecto, errorProyecto, sincronizarProyectoActivo, errorEntradaCompleta, guardando, guardar, limpiar,
  };
}
