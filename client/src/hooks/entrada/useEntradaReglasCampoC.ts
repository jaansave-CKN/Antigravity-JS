import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { MODALIDAD_INTEGRAL, type EntradaState } from '../../components/entrada/entradaModelo';

/**
 * (h) Reglas derivadas de EntradaPage, efectos E5-E9 en el MISMO orden que
 * tenían en pages/EntradaPage.tsx (extraídos LITERAL, refactor 2026-09-28).
 */
export function useEntradaReglasCampoC({ st, setSt }: { st: EntradaState; setSt: Dispatch<SetStateAction<EntradaState>> }) {
  // E5 — AJUSTE (2026-08-23, pedido explícito con captura): el módulo 06
  // "Población Objetivo" (input dedicado de Beneficiarios/Cobertura)
  // desaparece de la UI — Beneficiarios ahora se escribe una sola vez en C3
  // (Contexto del Problema), y Cobertura ya vive en el módulo 10 (Municipio/
  // Vereda, más granular). numeroBeneficiarios/coberturaGeografica de
  // EntradaState SIGUEN existiendo (server.js, viabilidadAgent.js y
  // FichaTecnicaPage.tsx los leen) — ya no tienen input propio, se
  // sincronizan en un solo sentido desde sus nuevas fuentes reales.
  useEffect(() => {
    if (st.contextoMeta.beneficiarios !== st.numeroBeneficiarios) {
      setSt(prev => ({ ...prev, numeroBeneficiarios: prev.contextoMeta.beneficiarios }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.contextoMeta.beneficiarios]);

  // E6 — FIX (2026-08-24, pedido explícito con captura): si el usuario edita
  // cualquier sub-campo de C (problemática, beneficiarios o tipoFormulacion)
  // DESPUÉS de que D/E/F/G ya tienen respuesta, ese texto quedó redactado
  // sobre datos viejos de Meta Esperada — se borra para forzar una
  // regeneración explícita en vez de dejar una respuesta desactualizada.
  // camposCPrevRef arranca en null y en el primer render solo GUARDA la
  // firma sin borrar nada — evita que la restauración desde localStorage
  // (que también "cambia" estos valores al montar) dispare un borrado.
  const camposCPrevRef = useRef<string | null>(null);
  useEffect(() => {
    const firma = JSON.stringify([
      st.contextoMeta.problemaSeleccionado,
      st.contextoMeta.beneficiarios,
      st.contextoMeta.tipoFormulacion,
    ]);
    if (camposCPrevRef.current === null) {
      camposCPrevRef.current = firma;
      return;
    }
    if (camposCPrevRef.current !== firma) {
      camposCPrevRef.current = firma;
      const idsDependientesDeC = ['justificacion', 'sociocultural', 'problema_urgente', 'incertidumbre']; // D,E,F,G
      setSt(prev => {
        const nuevoContexto = { ...prev.contexto };
        let tocoContexto = false;
        idsDependientesDeC.forEach(id => {
          if (nuevoContexto[id]?.trim()) { delete nuevoContexto[id]; tocoContexto = true; }
        });
        // EXTENSIÓN (2026-08-24, pedido explícito con captura): "el
        // planteamiento y/o las opciones del punto C cambia todo" — las 10
        // propuestas de Soluciones (9 IA + la manual) también se redactaron
        // sobre el C viejo, así que se borran igual que D-G, sin excepción
        // para la manual (a diferencia de "regenerar con IA", que sí la
        // preserva — aquí el usuario pidió borrar las 10 sin distinción).
        const huboSoluciones = prev.soluciones.propuestasIA.length > 0 || !!prev.soluciones.propuestaManual.trim() || prev.soluciones.seleccion !== null;
        if (!tocoContexto && !huboSoluciones) return prev;
        return {
          ...prev,
          contexto: nuevoContexto,
          soluciones: huboSoluciones ? { propuestasIA: [], propuestaManual: '', seleccion: null } : prev.soluciones,
        };
      });
    }
  }, [st.contextoMeta.problemaSeleccionado, st.contextoMeta.beneficiarios, st.contextoMeta.tipoFormulacion, setSt]);

  // E7 — FIX (2026-08-24, pedido explícito con captura): en modalidad
  // "Proyecto Integral (100%)" Beneficiarios deja de ser manual — se iguala
  // SIEMPRE al déficit de la problemática elegida (por eso el % de C4 da
  // exactamente 100%). Se recalcula si cambia la problemática (déficit
  // distinto) sin que el usuario tenga que volver a tocar el selector de
  // modalidad. Si el déficit es ND (null), no hay cifra real que copiar — el
  // campo se deja en blanco/manual en vez de inventar un número.
  useEffect(() => {
    if (st.contextoMeta.tipoFormulacion !== MODALIDAD_INTEGRAL) return;
    const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
    const deficit = sel?.deficit_valor ?? null;
    const deseado = deficit !== null ? String(deficit) : '';
    if (st.contextoMeta.beneficiarios !== deseado) {
      setSt(prev => ({ ...prev, contextoMeta: { ...prev.contextoMeta, beneficiarios: deseado } }));
    }
  }, [st.contextoMeta.tipoFormulacion, st.contextoMeta.problemaSeleccionado, st.contextoMeta.problematicas, st.contextoMeta.beneficiarios, setSt]);

  // E8 — FIX (2026-08-24, pedido explícito con captura): en "Formulado por
  // Etapas" el % de C4 NUNCA puede llegar a 100% — por definición esta
  // modalidad cubre el déficit en fases, nunca de una sola vez. Si
  // Beneficiarios llega a igualar o superar el déficit (ya sea tecleado a mano
  // o heredado de un cambio previo de modalidad, ej. venir de "Proyecto
  // Integral"), se topa en déficit-1 — el mínimo ajuste que garantiza <100%
  // sin inventar un tope arbitrario (ej. 95%) que nadie pidió.
  useEffect(() => {
    if (st.contextoMeta.tipoFormulacion !== 'Formulado por Etapas') return;
    const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
    const deficit = sel?.deficit_valor ?? null;
    if (deficit === null) return; // sin déficit real (ND), nada que topar
    const actual = Number(st.contextoMeta.beneficiarios);
    if (!Number.isFinite(actual) || actual < deficit) return;
    const topado = String(Math.max(0, deficit - 1));
    if (st.contextoMeta.beneficiarios !== topado) {
      setSt(prev => ({ ...prev, contextoMeta: { ...prev.contextoMeta, beneficiarios: topado } }));
    }
  }, [st.contextoMeta.tipoFormulacion, st.contextoMeta.problemaSeleccionado, st.contextoMeta.problematicas, st.contextoMeta.beneficiarios, setSt]);

  // E9 — cobertura derivada de Municipio/Vereda (sección 09).
  useEffect(() => {
    const cobertura = [st.municipio.trim(), st.vereda.trim()].filter(Boolean).join(', ');
    if (cobertura && cobertura !== st.coberturaGeografica) {
      setSt(prev => ({ ...prev, coberturaGeografica: cobertura }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.municipio, st.vereda]);
}
