/**
 * colaGuardado.ts — LOTE 10: cola de guardado SERIALIZADA (sin React, testeable).
 *
 * Problema que resuelve (verificado en DialecticaPage 2026-09-25): un debounce
 * cancela TIMERS, no peticiones en vuelo. Con dos POST simultáneos, el más
 * viejo puede llegar DESPUÉS al servidor y pisar el valor más nuevo en la BD
 * (la guardia de secuencia existente solo protegía el estado de la UI).
 *
 * Reglas:
 *   - Una sola escritura en vuelo; las siguientes esperan su turno.
 *   - Cada turno lee el valor MÁS RECIENTE en ese momento (gana el último).
 *   - Si el valor ya coincide con lo confirmado por el servidor, no hay petición.
 *   - `base` solo avanza tras una respuesta exitosa (un fallo no lo marca guardado).
 *   - Un fallo nunca rompe la cola: el siguiente turno se ejecuta igual.
 */
export interface OpcionesCola<T> {
  /** Valor más reciente a guardar. */
  obtener: () => T;
  /** Escritura real contra el servidor; debe lanzar si falla. */
  guardar: (valor: T) => Promise<void>;
  /** Última instantánea confirmada por el servidor (la comparte la página). */
  base: { current: string | null };
  serializar?: (valor: T) => string;
  /** false → el guardado AUTOMÁTICO se omite (el forzado no). */
  puedeGuardar?: (valor: T) => boolean;
  alCambiarGuardando?: (guardando: boolean) => void;
}

export interface ColaGuardado {
  /** Encola un guardado. Resuelve true si quedó guardado (u omitido sin error), false si falló. */
  encolar: (forzar?: boolean) => Promise<boolean>;
  /** true si el valor actual difiere de lo confirmado por el servidor. */
  pendiente: () => boolean;
}

export function crearColaGuardado<T>(op: OpcionesCola<T>): ColaGuardado {
  const serializar = op.serializar ?? ((v: T) => JSON.stringify(v));
  let cola: Promise<boolean> = Promise.resolve(true);

  const ejecutar = async (forzar: boolean): Promise<boolean> => {
    const valor = op.obtener();
    const instantanea = serializar(valor);
    if (instantanea === op.base.current) return true;
    if (!forzar && op.puedeGuardar && !op.puedeGuardar(valor)) return true;
    op.alCambiarGuardando?.(true);
    try {
      await op.guardar(valor);
      op.base.current = instantanea;
      return true;
    } catch {
      return false;
    } finally {
      op.alCambiarGuardando?.(false);
    }
  };

  return {
    encolar(forzar = false) {
      cola = cola.then(() => ejecutar(forzar), () => ejecutar(forzar));
      return cola;
    },
    pendiente() {
      return serializar(op.obtener()) !== op.base.current;
    },
  };
}
