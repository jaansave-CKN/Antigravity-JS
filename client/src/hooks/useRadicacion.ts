import { useState, useRef } from 'react';
import { http, ApiError } from '../lib/apiClient';
import type { ProyectoDataResponse, RadicarResponse, RadicarSello } from '../components/checklist/checklistModulos';

/**
 * useRadicacion — radicación formal del proyecto desde ChecklistPage.
 * Extraído tal cual de pages/ChecklistPage.tsx (refactor 2026-09-28).
 */
export function useRadicacion(proyectoId: string | null) {
  const [radicando, setRadicando] = useState(false);
  const [radicarError, setRadicarError] = useState<string | null>(null);
  const [radicarOk, setRadicarOk] = useState<RadicarResponse | null>(null);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): radicar es una acción formal irreversible — sin guarda
  // síncrona, un doble clic podía radicar el proyecto dos veces.
  const radicandoRef = useRef(false);

  const radicarProyecto = async () => {
    if (!proyectoId || radicandoRef.current) return;
    radicandoRef.current = true;
    setRadicando(true);
    setRadicarError(null);
    try {
      const proyecto = await http.get<{ success: boolean; data: ProyectoDataResponse }>(`/api/proyectos/${proyectoId}`);
      const fichaTecnica = proyecto.data.ficha_tecnica || {};
      const presupuesto = proyecto.data.presupuesto || {};
      const resultado = await http.post<{ success: boolean; estado: string; sello: RadicarSello }>(
        `/api/modulo9/radicar/${proyectoId}`,
        { fichaTecnica, presupuesto }
      );
      setRadicarOk({ estado: resultado.estado, sello: resultado.sello });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'CROSSCHECK_FAILED') {
          const disc = (e.body as { discrepancy?: number })?.discrepancy;
          setRadicarError(`Discrepancia presupuestal de $${Math.abs(disc ?? 0).toFixed(2)} — la sumatoria de fases (Negra/Gris/Blanca) no coincide con la meta física de la Ficha Técnica. Corrige el Presupuesto o la Ficha Técnica antes de radicar.`);
        } else if (e.code === 'RIESGO_JURIDICO_CONDICIONADO') {
          setRadicarError('Riesgo jurídico condicionado — el predio debe quedar despejado en Compliance antes de poder radicar.');
        } else {
          setRadicarError(e.message);
        }
      } else {
        setRadicarError('No se pudo radicar el proyecto — intenta de nuevo.');
      }
    } finally {
      radicandoRef.current = false;
      setRadicando(false);
    }
  };

  return { radicando, radicarError, radicarOk, radicarProyecto };
}
