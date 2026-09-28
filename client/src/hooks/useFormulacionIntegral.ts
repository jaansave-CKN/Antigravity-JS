import { useState, useRef, useEffect, useCallback } from 'react';
import { http, ApiError } from '../lib/apiClient';
import type { ProgresoFormulacion } from '../components/checklist/checklistModulos';

/**
 * useFormulacionIntegral — estado y handlers de la Formulación Integral con
 * IA de ChecklistPage (cadena Entrada→Árbol→Viabilidad). Extraído tal cual de
 * pages/ChecklistPage.tsx (refactor 2026-09-28): el polling (pollFormRef), la
 * guarda de reentrada (ejecutandoFormRef), el efecto de carga/cleanup y
 * ejecutarFormulacionIntegral comparten refs y deben vivir en el mismo hook.
 */
export function useFormulacionIntegral(proyectoId: string | null) {
  const [progresoForm, setProgresoForm] = useState<ProgresoFormulacion | null>(null);
  const [cargandoEstadoForm, setCargandoEstadoForm] = useState(true);
  const [ejecutandoForm, setEjecutandoForm] = useState(false);
  const [objetivoCentralInput, setObjetivoCentralInput] = useState('');
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const ejecutandoFormRef = useRef(false);
  const pollFormRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refrescarEstadoFormulacion = useCallback(async () => {
    if (!proyectoId) return;
    try {
      const r = await http.get<{ success: boolean; data: ProgresoFormulacion }>(`/api/formulacion/integral/${proyectoId}/estado`);
      setProgresoForm(r.data);
    } catch {
      // Sin progreso previo para este proyecto — arranca desde cero, no es un error.
    }
  }, [proyectoId]);

  useEffect(() => {
    if (!proyectoId) { setCargandoEstadoForm(false); return; }
    setCargandoEstadoForm(true);
    refrescarEstadoFormulacion().finally(() => setCargandoEstadoForm(false));
    return () => { if (pollFormRef.current) clearInterval(pollFormRef.current); };
  }, [proyectoId, refrescarEstadoFormulacion]);

  const ejecutarFormulacionIntegral = async () => {
    if (!proyectoId || ejecutandoFormRef.current) return;
    const arbolListo = progresoForm?.pasos.arbol.estado === 'completado';
    const objetivoYaGuardado = !!progresoForm?.objetivo_central_usado;
    if (!arbolListo && !objetivoYaGuardado && !objetivoCentralInput.trim()) {
      setErrorForm('Escribe el Objetivo Central — lo necesita el paso de Árbol de Objetivos.');
      return;
    }
    ejecutandoFormRef.current = true;
    setEjecutandoForm(true);
    setErrorForm(null);
    pollFormRef.current = setInterval(refrescarEstadoFormulacion, 2500);
    try {
      const body = objetivoCentralInput.trim() ? { objetivoCentral: objetivoCentralInput.trim() } : {};
      // B4 (2026-09-28): hasta 3 llamadas de IA encadenadas en un request
      // (~50 s máx. cada una). Con el timeout de 60 s y 3 reintentos por
      // defecto, el cliente abortaba y relanzaba la cadena mientras la
      // primera seguía corriendo en el servidor (doble gasto).
      const resultado = await http.post<{ success: boolean; completo?: boolean; message: string; data: ProgresoFormulacion }>(
        `/api/formulacion/integral/${proyectoId}`, body, undefined, { timeoutMs: 180_000, retries: 0 }
      );
      setProgresoForm(resultado.data);
      if (!resultado.completo) setErrorForm(resultado.message);
    } catch (e) {
      if (e instanceof ApiError) {
        const cuerpo = e.body as { data?: ProgresoFormulacion } | undefined;
        if (cuerpo?.data) setProgresoForm(cuerpo.data);
        setErrorForm(e.message || 'No se pudo completar la formulación integral.');
      } else {
        setErrorForm('No se pudo conectar con el servidor.');
      }
    } finally {
      if (pollFormRef.current) { clearInterval(pollFormRef.current); pollFormRef.current = null; }
      await refrescarEstadoFormulacion();
      ejecutandoFormRef.current = false;
      setEjecutandoForm(false);
    }
  };

  return {
    progresoForm, cargandoEstadoForm, ejecutandoForm, objetivoCentralInput, setObjetivoCentralInput,
    errorForm, ejecutarFormulacionIntegral,
  };
}
