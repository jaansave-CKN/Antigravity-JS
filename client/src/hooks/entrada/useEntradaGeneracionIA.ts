import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { http, ApiError } from '../../lib/apiClient';
import {
  ACTIVE_PROJECT_KEY, ALERTA_ND, ND_INVESTIGACION, campoCDesbloqueado, claveAutoCarga,
  type EntradaState, type ProblematicaOpcion,
} from '../../components/entrada/entradaModelo';
import type { useEntradaIAEstado } from './useEntradaIAEstado';

interface Deps {
  st: EntradaState;
  setSt: Dispatch<SetStateAction<EntradaState>>;
  ia: ReturnType<typeof useEntradaIAEstado>;
}

/**
 * (g) Llamadas de IA de EntradaPage + efecto E4 (auto-carga de problemáticas).
 * Extraído LITERAL de pages/EntradaPage.tsx (refactor 2026-09-28). Las URLs
 * quedan como plantilla literal completa: scripts/agentes.mjs las detecta con
 * rutaARegex para el inventario de agentes.
 */
export function useEntradaGeneracionIA({ st, setSt, ia }: Deps) {
  const {
    cuotaAgotada, dispararRescateBYOK, marcarEnVuelo, liberarEnVuelo, reportarErrorCuota,
    setErrorIA, setGenerandoCampo, generandoCampo, setGenerandoNombre, setGenerandoPitch, sincronizarTrasNombreIA,
  } = ia;

  // Mensaje de error uniforme para las 3 llamadas de IA de esta sección —
  // mismo criterio ya establecido (2026-08-22): un 401 aquí es señal de
  // sesión realmente perdida (auth.middleware.js solo responde "Token
  // requerido"/similar), nunca se muestra el string crudo del backend.
  const manejarErrorIA = useCallback((e: unknown) => {
    // retryAt (mandato 2026-08-24, "reloj con cuenta regresiva y hora exacta
    // de reset"): viene en el body del 429 cuando el backend lo tiene (ver
    // entradaIA.routes.js) — momento real reportado por Google, no una
    // espera fija inventada.
    const body = e instanceof ApiError ? e.body as { retryAt?: string; esEstimado?: boolean } | undefined : undefined;
    if (body?.retryAt) reportarErrorCuota(body.retryAt, body.esEstimado);
    if (e instanceof ApiError && e.status === 401) {
      setErrorIA('Tu sesión no es válida o expiró. Recarga la página e inicia sesión de nuevo.');
    } else {
      setErrorIA(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'No se pudo generar con IA — inténtalo de nuevo.'));
    }
  }, [reportarErrorCuota, setErrorIA]);

  // Botón ✨ individual (REFACTOR 2026-08-22, reemplaza al botón global) —
  // genera SOLO el campo indicado (A,B,D,E,F,G — nunca 'meta'/C, que tiene su
  // propio flujo abajo). Manda el contexto previo ya escrito y la demografía
  // de Sección 06 al backend, tal como exige el mandato. Sobrescribe el valor
  // actual del campo (acción explícita del usuario al pulsar el botón de ESE
  // campo específico) — distinto del viejo merge "solo si está vacío".
  const generarCampoConIA = async (campoId: string) => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo(`campo:${campoId}`)) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo(`campo:${campoId}`); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoCampo(campoId);
    setErrorIA(null);
    try {
      const resp = await http.post<{ success: boolean; data?: { valor: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-campo`,
        {
          campo: campoId,
          contextoPrevio: st.contexto,
          demografia: {
            beneficiarios: st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      if (!resp.data) throw new Error(resp.message || 'La IA no devolvió datos.');
      const valor = resp.data.valor;
      setSt(prev => ({
        ...prev,
        contexto: { ...prev.contexto, [campoId]: valor === ND_INVESTIGACION ? ALERTA_ND : (valor || '') },
      }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoCampo(null);
      liberarEnVuelo(`campo:${campoId}`);
    }
  };

  // "Generar con AI" del Nombre del Proyecto (mandato 2026-08-24) — combina
  // Diálectica (tono/lista de oro/lista negra) + Evaluación de Impacto
  // Integral + lo ya escrito en Entrada. Sobrescribe el nombre actual (acción
  // explícita del usuario, mismo criterio que generarCampoConIA) y dispara
  // sincronizarProyectoActivo() (vía el efecto E3) para que la columna
  // real `proyectos.nombre` quede al día, no solo el estado local — sin esto
  // el nombre generado por IA se ve en pantalla pero no llega al servidor
  // hasta el próximo blur manual del campo.
  const generarNombreConIA = async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('nombre')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('nombre'); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoNombre(true);
    setErrorIA(null);
    try {
      const problematica = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado) || null;
      const resp = await http.post<{ success: boolean; data?: { nombre: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-nombre`,
        {
          contextoPrevio: st.contexto,
          problematica: problematica ? { problema: problematica.problema, deficit_valor: problematica.deficit_valor, deficit_unidad: problematica.deficit_unidad } : null,
          demografia: {
            beneficiarios: st.contextoMeta.beneficiarios || st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      if (!resp.data?.nombre) throw new Error(resp.message || 'La IA no devolvió un nombre.');
      sincronizarTrasNombreIA.current = true;
      setSt(prev => ({ ...prev, nombre: resp.data!.nombre }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoNombre(false);
      liberarEnVuelo('nombre');
    }
  };

  // "Generar con AI" del Pitch (mandato 2026-08-24) — mismas fuentes que
  // generarNombreConIA. A diferencia del nombre, pitch no toca
  // sincronizarProyectoActivo() (no tiene columna propia) — el setSt es
  // suficiente, se persiste con el SAVE normal.
  const generarPitchConIA = async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('pitch')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('pitch'); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoPitch(true);
    setErrorIA(null);
    try {
      const problematica = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado) || null;
      const resp = await http.post<{ success: boolean; data?: { pitch: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-pitch`,
        {
          contextoPrevio: st.contexto,
          problematica: problematica ? { problema: problematica.problema, deficit_valor: problematica.deficit_valor, deficit_unidad: problematica.deficit_unidad } : null,
          demografia: {
            beneficiarios: st.contextoMeta.beneficiarios || st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      if (!resp.data?.pitch) throw new Error(resp.message || 'La IA no devolvió un pitch.');
      setSt(prev => ({ ...prev, pitch: resp.data!.pitch }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoPitch(false);
      liberarEnVuelo('pitch');
    }
  };

  // FIX CRÍTICO (2026-08-23, auditoría "gasto injustificado de token"): la
  // versión anterior de este auto-disparo dependía de `st.contexto.linea_base`
  // — cambia en CADA tecla que el usuario escribe en el Campo B. Su única
  // guarda ("problematicas.length === 0") NO distingue "nunca se intentó" de
  // "se intentó y falló" (429, red, etc.) — con Gemini agotado, cada tecla
  // siguiente en B volvía a disparar una llamada real a Gemini en silencio,
  // sin que el usuario lo pidiera. `intentoAutoCargaRef` marca el intento
  // apenas arranca (no solo si tuvo éxito) y sobrevive a errores.
  //
  // FIX #2 (2026-08-24, auditoría de RAÍZ pedida tras "falta de saldo cuando
  // sí hay"): el fix de arriba solo cubría "una vez por MONTAJE del
  // componente" — un `useRef` se reinicia en cada recarga/navegación. En una
  // sesión con muchos F5 (como cualquier sesión de prueba real), cada recarga
  // volvía a disparar una llamada real a Gemini en silencio, sin ningún clic
  // — consumo invisible que no aparecía como "algo que el usuario pidió"
  // pero sí contaba contra el mismo cupo de 20 req/min compartido. Ahora
  // persiste en localStorage por proyecto: una sola vez por proyecto, para
  // siempre, hasta que el usuario reintente a mano con "🔄 Volver a leer".
  const intentoAutoCargaRef = useRef(false);

  // C1 — lista de problemáticas + déficit detectadas en Anexos/Investigación.
  // Se auto-dispara la primera vez que el Campo C se desbloquea (E4 abajo);
  // el botón "🔄 Volver a leer" permite regenerarla a mano.
  const cargarProblematicas = useCallback(async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('C1')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('C1'); return; }
    setGenerandoCampo('C1');
    setErrorIA(null);
    try {
      const resp = await http.post<{ success: boolean; data?: { problematicas: ProblematicaOpcion[] }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-problematicas`,
        { demografia: { beneficiarios: st.numeroBeneficiarios, cobertura: st.coberturaGeografica } }
      );
      setSt(prev => ({ ...prev, contextoMeta: { ...prev.contextoMeta, problematicas: resp.data?.problematicas || [] } }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoCampo(null);
      liberarEnVuelo('C1');
    }
  }, [st.numeroBeneficiarios, st.coberturaGeografica, cuotaAgotada, dispararRescateBYOK, manejarErrorIA, marcarEnVuelo, liberarEnVuelo, setGenerandoCampo, setErrorIA, setSt]);

  // Sección 11 "Soluciones con AI" (MANDATO 2026-08-24) — hasta 9 propuestas
  // candidatas; la 10ª (manual) NUNCA se toca aquí. Regenerar reemplaza SOLO
  // propuestasIA (mismo criterio que generarCampoConIA: sobrescribe al
  // pulsar el botón, acción explícita del usuario) y limpia la selección si
  // apuntaba a un slot de IA — el texto que tenía seleccionado ya no existe.
  const generarSoluciones = async () => {
    if (cuotaAgotada) { dispararRescateBYOK(); return; }
    if (!marcarEnVuelo('SOLUCIONES')) return;
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { liberarEnVuelo('SOLUCIONES'); setErrorIA('Activa un proyecto antes de generar con IA.'); return; }
    setGenerandoCampo('SOLUCIONES');
    setErrorIA(null);
    try {
      const resp = await http.post<{ success: boolean; data?: { soluciones: string[] }; message?: string }>(
        `/api/proyectos/${proyectoId}/entrada/generar-ai-soluciones`,
        {
          contextoPrevio: st.contexto,
          demografia: {
            beneficiarios: st.numeroBeneficiarios,
            cobertura: st.coberturaGeografica,
            tipoFormulacion: st.contextoMeta.tipoFormulacion,
          },
        }
      );
      const nuevas = resp.data?.soluciones || [];
      setSt(prev => ({
        ...prev,
        soluciones: {
          ...prev.soluciones,
          propuestasIA: nuevas,
          seleccion: prev.soluciones.seleccion?.tipo === 'ia' ? null : prev.soluciones.seleccion,
        },
      }));
    } catch (e) {
      manejarErrorIA(e);
    } finally {
      setGenerandoCampo(null);
      liberarEnVuelo('SOLUCIONES');
    }
  };

  // E4 — Auto-carga de problemáticas apenas el Campo C se desbloquea (B tiene
  // contenido real) — UNA SOLA VEZ por sesión de la pestaña, éxito o fracaso
  // (ver fix arriba). El usuario puede recargar a mano con el botón 🔄.
  useEffect(() => {
    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const yaAutoIntentado = intentoAutoCargaRef.current || (proyectoId && localStorage.getItem(claveAutoCarga(proyectoId)) === '1');
    if (campoCDesbloqueado(st.contexto) && !yaAutoIntentado && generandoCampo !== 'C1') {
      intentoAutoCargaRef.current = true;
      if (proyectoId) localStorage.setItem(claveAutoCarga(proyectoId), '1');
      cargarProblematicas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.contexto.linea_base]);

  return { generarCampoConIA, generarNombreConIA, generarPitchConIA, cargarProblematicas, generarSoluciones };
}
