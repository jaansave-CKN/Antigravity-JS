/**
 * useAutoSave — LOTE 10: autoguardado contra el servidor con espera (1,5 s
 * por defecto) y cola SERIALIZADA (ver lib/colaGuardado.ts).
 *
 *   - La BD es la fuente de verdad; localStorage queda como caché de
 *     hidratación que cada página ya maneja por su cuenta.
 *   - `habilitado` debe ser false hasta que la página termine de hidratar:
 *     si no, guardaría el estado inicial vacío encima de los datos reales.
 *   - Al desmontar (el usuario cambia de pantalla antes de la espera) los
 *     cambios pendientes se envían igual — antes esa última edición se perdía.
 *   - `guardarAhora({ forzar: true })` es el botón SAVE manual: pasa por la
 *     MISMA cola (nunca compite con un autoguardado) e ignora `puedeGuardar`.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { crearColaGuardado } from '../lib/colaGuardado';

interface OpcionesAutoSave<T> {
  valor: T;
  habilitado: boolean;
  guardar: (valor: T) => Promise<void>;
  /** Última instantánea confirmada por el servidor (el mismo ref del indicador "sin guardar"). */
  ultimoGuardadoRef: MutableRefObject<string | null>;
  esperaMs?: number;
  /** false → no se AUTOguarda ese valor (p. ej. formulario vacío tras LIMPIAR). */
  puedeGuardar?: (valor: T) => boolean;
}

export function useAutoSave<T>({ valor, habilitado, guardar, ultimoGuardadoRef, esperaMs = 1500, puedeGuardar }: OpcionesAutoSave<T>) {
  const [guardando, setGuardando] = useState(false);
  const valorRef = useRef(valor);
  const guardarRef = useRef(guardar);
  const puedeGuardarRef = useRef(puedeGuardar);
  const habilitadoRef = useRef(habilitado);
  const montadoRef = useRef(true);
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valorRef.current = valor;
    guardarRef.current = guardar;
    puedeGuardarRef.current = puedeGuardar;
    habilitadoRef.current = habilitado;
  });

  const [cola] = useState(() => crearColaGuardado<T>({
    obtener: () => valorRef.current,
    guardar: (v) => guardarRef.current(v),
    base: ultimoGuardadoRef,
    puedeGuardar: (v) => (puedeGuardarRef.current ? puedeGuardarRef.current(v) : true),
    alCambiarGuardando: (g) => { if (montadoRef.current) setGuardando(g); },
  }));

  const cancelarEspera = () => {
    if (temporizadorRef.current) { clearTimeout(temporizadorRef.current); temporizadorRef.current = null; }
  };

  useEffect(() => {
    if (!habilitado) return undefined;
    temporizadorRef.current = setTimeout(() => { temporizadorRef.current = null; void cola.encolar(); }, esperaMs);
    return cancelarEspera;
  }, [valor, habilitado, esperaMs, cola]);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      if (habilitadoRef.current && cola.pendiente()) void cola.encolar();
    };
  }, [cola]);

  const guardarAhora = useCallback((opciones?: { forzar?: boolean }) => {
    cancelarEspera();
    return cola.encolar(!!opciones?.forzar);
  }, [cola]);

  return { guardando, guardarAhora };
}
