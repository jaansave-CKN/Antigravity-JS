/**
 * AnexosCalcoView — Calco estricto Stitch screen
 * "Anexos - Azul Sincronizado con Logística (Regen)"
 * Fuente: projects/3791086755596777919/screens/0caf7309bedd46af973dad88f8a346df
 *
 * Tokens fuente:
 *   primary #0041a3 · surface-container-lowest #ffffff · on-surface #191c1e
 *   on-surface-variant #434655 · outline-variant #c4c5d7 · outline #747686
 *   error #ba1a1a · Public Sans
 *   Columnas: DESCRIPCION 70% · TEXTO 10% · ANEXO 10% · LINK 10% · acción 48px
 *
 * EXTENSIÓN 2026-08-17 (mandato "quiero en Anexos la misma configuración de
 * carpetas que ya tiene Biblioteca"): reemplaza los 2 bloques FIJOS
 * (Documentos Técnicos/Generales, derivados del toggle "Documento Técnico")
 * por carpetas dinámicas ilimitadas — mismo sistema, mismos endpoints y
 * mismo componente visual que BibliotecaCalcoView.tsx, ver
 * backend/migrations/042_anexos_carpetas_dinamicas.sql. El toggle "Técnico"
 * NO se elimina — sigue siendo el campo funcional real que determina
 * `categoria` (dispara ExtractorService/AuditorForenseService para Excel
 * `presupuesto_apu`), ahora como columna independiente de la carpeta
 * (puramente organizativa). Backfill de la migración 042: los anexos ya
 * existentes se repartieron en 2 carpetas seed ("Documentos Técnicos"/
 * "Anexos Generales") según su categoria actual — cero cambio visual hasta
 * que el usuario decida crear/renombrar carpetas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import './AnexosCalcoView.css';
import { http, ApiError, isAuthenticated } from '../lib/apiClient';

const STORAGE_KEY = 'radar360_anexos_calco';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';
const SIN_CARPETA = '__sin_carpeta__'; // id sintético para el bloque de soportes sin carpeta_id
// Caché por proyecto (blindaje antipérdida 2026-08-17): antes solo se
// escribía en localStorage en modo "sin proyecto activo" — cualquier tecleo
// sin llegar a onBlur se perdía por completo ante un F5 con proyecto activo.
const cacheKeyDe = (proyectoId: string | null) => proyectoId ? `${STORAGE_KEY}_proj_${proyectoId}` : STORAGE_KEY;

interface Soporte {
  id: string;
  descripcion: string;
  texto: string;
  anexo: string;
  link: string;
  esTecnico: boolean; // toggle "Documento Técnico" — determina la categoria enviada al backend (independiente de la carpeta)
  carpetaId: string | null; // null = "Sin carpeta"
  persistido: boolean; // true si ya existe como fila real en project_anexos
  subiendo?: boolean;
  progreso?: number; // 0-100, real (XHR upload.onprogress) — solo mientras subiendo es true
}
interface AnexoApi {
  id: string; nombre_archivo: string; descripcion: string | null; texto: string | null; link: string | null; categoria: string | null; carpeta_id: string | null;
}
interface AnexosApiResponse { success: boolean; data?: AnexoApi[]; message?: string }

interface Carpeta { id: string; nombre: string; orden: number }
interface CarpetaApi { id: string; nombre: string; orden: number }
interface CarpetasApiResponse { success: boolean; data?: CarpetaApi[]; message?: string }

const CATEGORIAS_TECNICAS = new Set(['tecnico', 'presupuesto_apu']);
const esCategoriaTecnica = (categoria: string | null | undefined) => !!categoria && CATEGORIAS_TECNICAS.has(categoria);

// Deriva la categoria del backend a partir del toggle "Documento Técnico" y la
// extensión del archivo adjunto — un Excel marcado como técnico se etiqueta
// 'presupuesto_apu' (dispara ExtractorService/AuditorForenseService en el POST
// de subida); cualquier otro formato técnico usa 'tecnico' (solo clasificación,
// sin pipeline financiero).
const categoriaDe = (s: Pick<Soporte, 'esTecnico' | 'anexo'>): string => {
  if (!s.esTecnico) return 'otro';
  return /\.(xlsx|xls)$/i.test(s.anexo) ? 'presupuesto_apu' : 'tecnico';
};

const nuevoSoporte = (carpetaId: string | null): Soporte =>
  ({ id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`, descripcion: '', texto: '', anexo: '', link: '', esTecnico: false, carpetaId, persistido: false });

export default function AnexosCalcoView() {
  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);
  const [soportes, setSoportes] = useState<Soporte[]>([]);
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [cargando, setCargando] = useState(!!proyectoId);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [limpiado, setLimpiado] = useState(false);
  const [creandoCarpeta, setCreandoCarpeta] = useState(false);
  const [nombreNuevaCarpeta, setNombreNuevaCarpeta] = useState('');
  const [editandoCarpetaId, setEditandoCarpetaId] = useState<string | null>(null);
  const [nombreEdicion, setNombreEdicion] = useState('');
  const [carpetasColapsadas, setCarpetasColapsadas] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetIdRef = useRef<string | null>(null);
  // Ids eliminados mientras un guardado (POST) seguía en vuelo — un Set en un
  // ref se actualiza de forma síncrona e inmediata, sin la ambigüedad de
  // scheduling que tiene encadenar dos setState (ver comentario histórico en
  // BibliotecaCalcoView.tsx — mismo fix, mismo patrón).
  const eliminadosRef = useRef<Set<string>>(new Set());
  // Cola de guardado por fila (serializa todas las operaciones de guardado de
  // una misma fila — texto y adjuntar archivo — para que nunca corran dos a
  // la vez; ver comentario histórico en BibliotecaCalcoView.tsx).
  const colaGuardadoRef = useRef<Map<string, Promise<unknown>>>(new Map());
  function encolar<T>(id: string, tarea: () => Promise<T>): Promise<T> {
    const anterior = colaGuardadoRef.current.get(id) ?? Promise.resolve();
    const siguiente = anterior.then(tarea, tarea);
    colaGuardadoRef.current.set(id, siguiente.catch(() => {}));
    return siguiente;
  }

  useEffect(() => {
    if (!proyectoId) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) { setSoportes(p); return; } } catch { /* ignore */ } }
      setSoportes([nuevoSoporte(null)]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [body, carpetasBody] = await Promise.all([
          http.get<AnexosApiResponse>(`/api/proyectos/${proyectoId}/anexos`),
          http.get<CarpetasApiResponse>(`/api/proyectos/${proyectoId}/anexos/carpetas`),
        ]);
        if (cancelled) return;
        setCarpetas((carpetasBody.data || []).map(c => ({ id: c.id, nombre: c.nombre, orden: c.orden })));

        const rows = (body.data || []).map(a => ({
          id: a.id, descripcion: a.descripcion || '', texto: a.texto || '', link: a.link || '',
          anexo: a.nombre_archivo || '', esTecnico: esCategoriaTecnica(a.categoria), carpetaId: a.carpeta_id || null, persistido: true,
        }));

        // Fusión con el caché local de este proyecto: si un F5 interrumpió una
        // edición antes de que el onBlur alcanzara a guardarla, el servidor
        // todavía tiene la versión vieja — se prefiere la versión local (más
        // reciente) para esas filas. Filas 100% nuevas que nunca llegaron a
        // persistirse (sin id de servidor) se conservan como borradores.
        let merged = rows;
        try {
          const cachedRaw = localStorage.getItem(cacheKeyDe(proyectoId));
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw) as Soporte[];
            if (Array.isArray(cached)) {
              const cachedById = new Map(cached.map(c => [c.id, c]));
              merged = rows.map(r => {
                const c = cachedById.get(r.id);
                if (c && (c.descripcion !== r.descripcion || c.texto !== r.texto || c.link !== r.link || c.anexo !== r.anexo)) {
                  return { ...r, descripcion: c.descripcion, texto: c.texto, link: c.link, anexo: c.anexo };
                }
                return r;
              });
              const idsServidor = new Set(rows.map(r => r.id));
              const soloLocales = cached.filter(c =>
                !c.persistido && !idsServidor.has(c.id) &&
                (c.descripcion?.trim() || c.texto?.trim() || c.link?.trim() || c.anexo?.trim())
              );
              if (soloLocales.length) merged = [...merged, ...soloLocales];
            }
          }
        } catch { /* caché corrupto — se ignora, no se pierde lo que sí llegó del servidor */ }

        if (merged.length) { setSoportes(merged); return; }

        // Primera activación de proyecto sin datos en el servidor: si existe un
        // borrador guardado en modo "sin proyecto activo" (STORAGE_KEY), se migra
        // ahora a filas reales en project_anexos en vez de descartarlo — evita que
        // el usuario vea "desaparecer" soportes que ya había capturado localmente.
        const raw = localStorage.getItem(STORAGE_KEY);
        let legacy: Soporte[] = [];
        if (raw) {
          try {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) {
              legacy = p.filter((s: Soporte) => s.descripcion?.trim() || s.texto?.trim() || s.link?.trim() || s.anexo?.trim());
            }
          } catch { /* ignore */ }
        }
        if (!legacy.length) { setSoportes([nuevoSoporte(null)]); return; }

        const migradas: Soporte[] = [];
        for (const s of legacy) {
          try {
            const fd = new FormData();
            fd.append('descripcion', s.descripcion || '');
            fd.append('texto', s.texto || '');
            fd.append('link', s.link || '');
            fd.append('categoria', categoriaDe(s)); // s.esTecnico es undefined en borradores viejos (localStorage previo al toggle) -> categoriaDe trata undefined como falsy -> 'otro'
            const resp = await http.upload<{ success: boolean; data?: { id: string; nombre_archivo?: string } }>(`/api/proyectos/${proyectoId}/anexos`, fd);
            migradas.push({ ...s, id: resp.data?.id || s.id, anexo: resp.data?.nombre_archivo || s.anexo, carpetaId: null, persistido: !!resp.data?.id });
          } catch {
            migradas.push({ ...s, persistido: false }); // se conserva visible aunque falle esta fila — no se descarta
          }
        }
        if (cancelled) return;
        setSoportes(migradas.length ? migradas : [nuevoSoporte(null)]);
        localStorage.removeItem(STORAGE_KEY);
        const conNombreArchivo = legacy.some(s => s.anexo?.trim());
        setErrorSync(
          conNombreArchivo
            ? 'Se recuperaron tus datos guardados localmente. Nota: los archivos adjuntados antes de tener un proyecto activo solo conservaron su nombre — vuelve a adjuntar el archivo real en esas filas.'
            : null
        );
      } catch (err) {
        if (cancelled) return;
        // El servidor no respondió (sesión inválida, red, etc.) — en vez de mostrar
        // una fila vacía, se muestra el borrador local (si existe) para que el
        // usuario nunca vea "desaparecer" datos que sí tiene guardados en el
        // navegador. Estas filas NO quedan marcadas como persistidas: siguen
        // pendientes de sincronizar en cuanto el servidor vuelva a responder.
        const noAutenticado = (err instanceof ApiError && err.status === 401) || !isAuthenticated();
        const raw = localStorage.getItem(STORAGE_KEY);
        let legacy: Soporte[] = [];
        if (raw) {
          try {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) legacy = p.filter((s: Soporte) => s.descripcion?.trim() || s.texto?.trim() || s.link?.trim() || s.anexo?.trim());
          } catch { /* ignore */ }
        }
        if (legacy.length) {
          setSoportes(legacy.map(s => ({ ...s, persistido: false })));
          setErrorSync(
            noAutenticado
              ? 'Tu sesión no es válida o expiró — inicia sesión de nuevo en /login. Estás viendo la copia local de tus anexos (aún no sincronizada); nada se ha perdido.'
              : 'No se pudo conectar con el servidor — estás viendo la copia local de tus anexos (aún no sincronizada). Nada se ha perdido.'
          );
        } else {
          setErrorSync(noAutenticado ? 'Tu sesión no es válida o expiró — inicia sesión de nuevo en /login.' : 'No se pudieron cargar los anexos guardados.');
          setSoportes([nuevoSoporte(null)]);
        }
      } finally {
        if (!cancelled) setCargando(false);
      }
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  // Cache local instantánea — con o sin proyecto activo. Se escribe en cada
  // cambio de estado (cada tecla, cada blur) para que un F5 nunca pierda una
  // edición que todavía no alcanzó a llegar al servidor.
  useEffect(() => {
    if (cargando) return;
    localStorage.setItem(cacheKeyDe(proyectoId), JSON.stringify(soportes));
  }, [soportes, proyectoId]);

  const actualizarLocal = (id: string, patch: Partial<Soporte>) =>
    setSoportes(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  // Guarda en el servidor al perder foco (onBlur) — crea la fila si aún no
  // existe (POST) o actualiza los campos narrativos si ya existe (PATCH).
  // Devuelve si la fila quedó realmente persistida — guardar() lo usa para no
  // mostrar "✓ GUARDADO" cuando en realidad falló. Encolada por id para que
  // nunca corra en paralelo con otro guardado de la misma fila.
  const guardarEnServidor = (id: string): Promise<boolean> => encolar(id, () => ejecutarGuardado(id));

  const ejecutarGuardado = async (id: string): Promise<boolean> => {
    if (!proyectoId) return true;
    const row = soportes.find(s => s.id === id);
    if (!row) return true;
    try {
      if (row.persistido) {
        await http.patch(`/api/proyectos/${proyectoId}/anexos/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link, categoria: categoriaDe(row) });
      } else if (row.descripcion.trim() || row.texto.trim() || row.link.trim()) {
        const fd = new FormData();
        fd.append('descripcion', row.descripcion);
        fd.append('texto', row.texto);
        fd.append('link', row.link);
        fd.append('categoria', categoriaDe(row));
        if (row.carpetaId) fd.append('carpeta_id', row.carpetaId);
        const resp = await http.upload<{ success: boolean; data?: { id: string } }>(`/api/proyectos/${proyectoId}/anexos`, fd);
        if (resp.data?.id) {
          const idServidor = resp.data.id;
          // FIX (reportado por el usuario 2026-08-17): si la fila se elimina
          // en el cliente MIENTRAS este POST sigue en vuelo, el servidor
          // igual la crea — queda un huérfano invisible en esta sesión que
          // reaparece intacto en el próximo F5/GET. eliminadosRef es la
          // fuente de verdad de si esto pasó.
          if (eliminadosRef.current.has(id)) {
            eliminadosRef.current.delete(id);
            http.delete(`/api/proyectos/${proyectoId}/anexos/${idServidor}`).catch(() => {});
          } else {
            actualizarLocal(id, { id: idServidor, persistido: true });
          }
        }
      }
      setErrorSync(null);
      return true;
    } catch {
      setErrorSync('No se pudo guardar un anexo — revisa tu conexión.');
      return false;
    }
  };

  // Toggle "Documento Técnico" — reclasifica de inmediato (cambia la
  // categoria enviada al backend) y, si la fila ya existe en el servidor,
  // persiste la nueva categoria ya mismo (no espera a un blur en otro campo).
  // Ya NO afecta a qué carpeta pertenece la fila — carpeta y técnico son
  // ejes independientes desde el mandato de carpetas dinámicas 2026-08-17.
  const toggleTecnico = (id: string) => {
    setSoportes(prev => {
      const next = prev.map(s => s.id === id ? { ...s, esTecnico: !s.esTecnico } : s);
      const row = next.find(s => s.id === id);
      if (row?.persistido && proyectoId) {
        http.patch(`/api/proyectos/${proyectoId}/anexos/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link, categoria: categoriaDe(row) })
          .catch(() => setErrorSync('No se pudo guardar la reclasificación — revisa tu conexión.'));
      }
      return next;
    });
  };

  // Mueve un soporte a otra carpeta (o a "Sin carpeta" con null) — persiste
  // de inmediato si la fila ya existe en el servidor. No toca categoria.
  const moverACarpeta = (id: string, carpetaId: string | null) => {
    setSoportes(prev => {
      const next = prev.map(s => s.id === id ? { ...s, carpetaId } : s);
      const row = next.find(s => s.id === id);
      if (row?.persistido && proyectoId) {
        http.patch(`/api/proyectos/${proyectoId}/anexos/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link, carpeta_id: carpetaId })
          .catch(() => setErrorSync('No se pudo mover el soporte — revisa tu conexión.'));
      }
      return next;
    });
  };

  const actualizar = (id: string, patch: Partial<Soporte>) => actualizarLocal(id, patch);

  // Descarga real vía Supabase Storage — el backend genera una URL firmada de
  // corta duración (5 min); el bucket es privado, así que no hay otra forma
  // de acceder al archivo sin pasar por este endpoint autenticado.
  const descargar = async (s: Soporte) => {
    if (!proyectoId || !s.persistido) return;
    try {
      const resp = await http.get<{ success: boolean; data?: { url: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/anexos/${s.id}/download`
      );
      if (!resp.success || !resp.data?.url) throw new Error(resp.message ?? 'No se pudo generar el enlace de descarga.');
      window.open(resp.data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErrorSync(e instanceof Error ? e.message : 'Error al descargar el anexo.');
    }
  };

  // SAVE manual — fuerza la persistencia de todas las filas ahora mismo (cada
  // campo ya autoguarda con onBlur; este botón es una confirmación explícita
  // por si el usuario navega sin disparar blur, p. ej. en móvil).
  const guardar = async () => {
    const resultados = await Promise.all(soportes.map(s => guardarEnServidor(s.id)));
    if (resultados.every(Boolean)) {
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2200);
      // El caché local solo se limpia cuando el servidor confirmó TODAS las
      // filas — si algo falló, el borrador se conserva para no perderlo.
      localStorage.removeItem(cacheKeyDe(proyectoId));
    }
  };

  // LIMPIAR — resetea el borrador visible a una sola fila en blanco. No borra
  // los anexos ya persistidos en el servidor; para eliminar un anexo guardado
  // se usa el botón de eliminar por fila.
  const limpiar = () => {
    const hayNoPersistidas = soportes.some(s => !s.persistido && (s.descripcion.trim() || s.texto.trim() || s.link.trim() || s.anexo.trim()));
    if (hayNoPersistidas && !window.confirm('Esto va a quitar de la vista los soportes que aún no se han guardado en el servidor. ¿Seguro que quieres continuar?')) {
      return;
    }
    if (!proyectoId) localStorage.removeItem(STORAGE_KEY);
    setSoportes(prev => {
      const persistidos = prev.filter(s => s.persistido);
      return persistidos.length ? persistidos : [nuevoSoporte(null)];
    });
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  const eliminar = async (id: string) => {
    const row = soportes.find(s => s.id === id);
    const tieneContenido = row && (row.descripcion.trim() || row.texto.trim() || row.link.trim() || row.anexo.trim());
    if (tieneContenido && !window.confirm('¿Eliminar este soporte documental? Esta acción no se puede deshacer.')) return;
    eliminadosRef.current.add(id); // marca ANTES de tocar el estado
    setSoportes(prev => prev.filter(s => s.id !== id));
    if (!proyectoId) { localStorage.setItem(STORAGE_KEY, JSON.stringify(soportes.filter(s => s.id !== id))); return; }
    if (row?.persistido) {
      try { await http.delete(`/api/proyectos/${proyectoId}/anexos/${id}`); }
      catch { setErrorSync('No se pudo eliminar el anexo en el servidor.'); }
    }
  };

  // Chequeo de filas vacías POR CARPETA (no global) — cada carpeta evalúa
  // solo sus propias filas, igual que el filtro `items` usado para
  // renderizarlas (misma clave: carpetaId ?? SIN_CARPETA).
  const tieneVacíosEnBloque = (bloqueId: string) =>
    soportes
      .filter(s => (s.carpetaId ?? SIN_CARPETA) === bloqueId)
      .some(s => !s.descripcion.trim() && !s.texto.trim() && !s.anexo.trim() && !s.link.trim());

  const agregar = (carpetaId: string | null) => {
    if (tieneVacíosEnBloque(carpetaId ?? SIN_CARPETA)) return;
    setSoportes(prev => [...prev, nuevoSoporte(carpetaId)]);
  };

  const adjuntar = (id: string) => {
    targetIdRef.current = id;
    fileInputRef.current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const id = targetIdRef.current;
    e.target.value = '';
    if (!f || !id) return;
    // FIX (auditoría 2026-08-17, "subo un PDF y al rato desaparece"): el
    // nombre se mostraba de inmediato (optimista) ANTES de saber si la
    // subida a Storage tuvo éxito — se captura el valor real anterior aquí
    // para poder revertir al instante si falla.
    const anexoAnterior = soportes.find(s => s.id === id)?.anexo ?? '';
    actualizarLocal(id, { anexo: f.name, subiendo: !!proyectoId, progreso: 0 });
    if (!proyectoId) return; // modo demo/offline — solo se guarda el nombre localmente
    // Encolada por id: si un guardado de texto (descripcion/link) para esta
    // misma fila sigue en vuelo, este adjunto espera a que termine antes de
    // decidir crear o reemplazar — evita la carrera con ejecutarGuardado.
    encolar(id, () => ejecutarAdjuntar(id, f, anexoAnterior));
  };

  // El backend no soporta adjuntar un archivo a una fila que YA existe en el
  // servidor vía PATCH (solo POST crea filas con archivo) — si la fila ya
  // estaba persistida, se crea la fila de reemplazo CON el archivo primero
  // y solo si eso tuvo éxito se borra la fila vieja.
  const ejecutarAdjuntar = async (id: string, f: File, anexoAnterior: string): Promise<boolean> => {
    const row = soportes.find(s => s.id === id);
    if (!row) return true;
    const idAntiguo = row.persistido ? row.id : null;
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('categoria', categoriaDe({ esTecnico: row.esTecnico, anexo: f.name }));
      if (row.carpetaId) fd.append('carpeta_id', row.carpetaId);
      fd.append('descripcion', row.descripcion || '');
      fd.append('texto', row.texto || '');
      fd.append('link', row.link || '');
      const resp = await http.uploadConProgreso<{ success: boolean; data?: { id: string; nombre_archivo: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/anexos`, fd,
        pct => actualizarLocal(id, { progreso: pct })
      );
      if (resp.data) {
        const idServidor = resp.data.id;
        const nombreArchivo = resp.data.nombre_archivo;
        if (eliminadosRef.current.has(id)) {
          eliminadosRef.current.delete(id);
          http.delete(`/api/proyectos/${proyectoId}/anexos/${idServidor}`).catch(() => {});
        } else {
          actualizarLocal(id, { id: idServidor, anexo: nombreArchivo, persistido: true, subiendo: false, progreso: undefined });
          if (idAntiguo) {
            http.delete(`/api/proyectos/${proyectoId}/anexos/${idAntiguo}`)
              .catch(() => setErrorSync('El archivo se adjuntó, pero quedó una fila duplicada sin limpiar — recarga la página e ilumínala para borrarla a mano.'));
          }
        }
      }
      setErrorSync(null);
      return true;
    } catch (e) {
      actualizarLocal(id, { subiendo: false, progreso: undefined, anexo: anexoAnterior });
      setErrorSync(e instanceof Error && e.message ? e.message : 'No se pudo subir el archivo — inténtalo de nuevo.');
      return false;
    }
  };

  // ── Carpetas: crear / renombrar / eliminar (mismo patrón que Biblioteca) ──
  const crearCarpeta = async () => {
    const nombre = nombreNuevaCarpeta.trim();
    if (!nombre) { setCreandoCarpeta(false); return; }
    if (!proyectoId) {
      setErrorSync('Activa un proyecto para crear carpetas en Anexos.');
      setCreandoCarpeta(false);
      return;
    }
    try {
      const resp = await http.post<{ success: boolean; data?: { id: string; nombre: string; orden: number } }>(
        `/api/proyectos/${proyectoId}/anexos/carpetas`, { nombre }
      );
      if (resp.data) setCarpetas(prev => [...prev, { id: resp.data!.id, nombre: resp.data!.nombre, orden: resp.data!.orden }]);
      setErrorSync(null);
    } catch {
      setErrorSync('No se pudo crear la carpeta — revisa tu conexión.');
    } finally {
      setNombreNuevaCarpeta('');
      setCreandoCarpeta(false);
    }
  };

  const iniciarEdicionCarpeta = (c: Carpeta) => {
    setEditandoCarpetaId(c.id);
    setNombreEdicion(c.nombre);
  };

  const guardarEdicionCarpeta = async (id: string) => {
    const nombre = nombreEdicion.trim();
    setEditandoCarpetaId(null);
    if (!nombre || !proyectoId) return;
    const anterior = carpetas.find(c => c.id === id)?.nombre;
    if (nombre === anterior) return;
    setCarpetas(prev => prev.map(c => c.id === id ? { ...c, nombre } : c));
    try {
      await http.put(`/api/proyectos/${proyectoId}/anexos/carpetas/${id}`, { nombre });
    } catch {
      setErrorSync('No se pudo renombrar la carpeta — revisa tu conexión.');
      if (anterior) setCarpetas(prev => prev.map(c => c.id === id ? { ...c, nombre: anterior } : c));
    }
  };

  const eliminarCarpeta = async (c: Carpeta) => {
    if (!window.confirm(`¿Eliminar la carpeta "${c.nombre}"?`)) return;
    const nDocs = soportes.filter(d => d.carpetaId === c.id).length;
    let eliminarDocumentos = false;
    if (nDocs > 0) {
      eliminarDocumentos = window.confirm(
        `Esta carpeta tiene ${nDocs} soporte(s). ¿También quieres eliminarlos? Esta acción no se puede deshacer.\n\nCancelar los conserva — pasan a "Sin carpeta".`
      );
    }
    setCarpetas(prev => prev.filter(x => x.id !== c.id));
    if (eliminarDocumentos) {
      setSoportes(prev => prev.filter(d => d.carpetaId !== c.id));
    } else {
      setSoportes(prev => prev.map(d => d.carpetaId === c.id ? { ...d, carpetaId: null } : d));
    }
    if (!proyectoId) return;
    try {
      await http.delete(`/api/proyectos/${proyectoId}/anexos/carpetas/${c.id}${eliminarDocumentos ? '?eliminarDocumentos=true' : ''}`);
    } catch {
      setErrorSync('No se pudo eliminar la carpeta en el servidor.');
    }
  };

  // Colapso/expansión por carpeta — expandido por defecto (Set vacío).
  const toggleColapso = (bloqueId: string) => {
    setCarpetasColapsadas(prev => {
      const next = new Set(prev);
      if (next.has(bloqueId)) next.delete(bloqueId); else next.add(bloqueId);
      return next;
    });
  };

  // Carpeta "Investigación" — mandato del usuario 2026-08-17: es la fuente
  // real que lee el botón "Generar con AI" (busca por este mismo nombre, ver
  // backend/services/EntradaIAService.js), así que queda protegida: sin
  // opción de renombrar/eliminar (ni en esta UI ni en el backend — ver
  // guardas en anexos.routes.js PUT/DELETE .../carpetas/:carpetaId) y
  // siempre visible primero para que sea obvio dónde va el material de
  // investigación. normalizar() quita tildes para calzar "Investigación",
  // "investigacion", "INVESTIGACIÓN", etc. — mismo criterio que el backend.
  const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const esCarpetaProtegida = (nombre: string) => normalizar(nombre).includes('investigacion');

  const bloques = [
    ...carpetas
      .map(c => ({ id: c.id, titulo: c.nombre, esCarpetaReal: true as const, esProtegida: esCarpetaProtegida(c.nombre) }))
      .sort((a, b) => (a.esProtegida === b.esProtegida) ? 0 : (a.esProtegida ? -1 : 1)),
    { id: SIN_CARPETA, titulo: 'Sin carpeta', esCarpetaReal: false as const, esProtegida: false },
  ];

  return (
    <main className="anx">
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onFile} />
      <div className="anx__container">
        {/* ── Zona fija: topbar + mensaje de estado + encabezado de columnas —
             se mueven siempre juntos como un solo bloque pegado arriba. ── */}
        <div className="anx__fixedzone">
          <header className="anx__topbar">
            <h1 className="anx__h1">Anexos <span className="anx__count">{soportes.length}</span></h1>
            <div className="anx__topbar-right">
              {creandoCarpeta ? (
                <div className="anx__newcarpeta">
                  <input
                    className="anx__newcarpeta-input"
                    autoFocus
                    placeholder="Nombre de la carpeta"
                    value={nombreNuevaCarpeta}
                    onChange={e => setNombreNuevaCarpeta(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') crearCarpeta(); if (e.key === 'Escape') { setCreandoCarpeta(false); setNombreNuevaCarpeta(''); } }}
                    onBlur={crearCarpeta}
                  />
                </div>
              ) : (
                <button className="anx__newcarpeta-btn" onClick={() => setCreandoCarpeta(true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  Nueva Carpeta
                </button>
              )}
              <button
                className={`anx__clear${limpiado ? ' anx__clear--done' : ''}`}
                onClick={limpiar}
              >
                {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
              </button>
              <button
                className={`anx__save${guardado ? ' anx__save--saved' : ''}`}
                onClick={guardar}
              >
                {guardado ? '✓ GUARDADO' : 'SAVE'}
              </button>
            </div>
          </header>
          {errorSync && (
            <div className="anx__statusmsg anx__statusmsg--error" role="alert">{errorSync}</div>
          )}
          <div className="anx__theadrow anx__grid">
            <span className="anx__th anx__th--num" />
            <span className="anx__th">DESCRIPCION</span>
            <span className="anx__th anx__th--center">TEXTO</span>
            <span className="anx__th anx__th--center">ANEXO.</span>
            <span className="anx__th anx__th--center">LINK</span>
            <span className="anx__th anx__th--center">CARPETA</span>
            <span className="anx__th anx__th--center">TÉCNICO</span>
            <span className="anx__th" />
          </div>
        </div>

        <div className="anx__content">
        <div className="anx__table-scroll">
          <div className="anx__table">
            {bloques.map(bloque => {
              const items = soportes.filter(s => (s.carpetaId ?? SIN_CARPETA) === bloque.id);
              const enEdicion = editandoCarpetaId === bloque.id;
              const colapsada = carpetasColapsadas.has(bloque.id);
              return (
                <div key={bloque.id} className="anx__bloque">
                  <div
                    className={`anx__bloquehead anx__bloquehead--clickable${bloque.esProtegida ? ' anx__bloquehead--protegida' : ''}`}
                    onClick={() => toggleColapso(bloque.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!colapsada}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleColapso(bloque.id); } }}
                  >
                    <svg
                      className={`anx__bloquehead-chevron${colapsada ? '' : ' anx__bloquehead-chevron--open'}`}
                      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                    ><polyline points="9 18 15 12 9 6" /></svg>
                    <span className={`anx__bloquehead-icon${bloque.esProtegida ? ' anx__bloquehead-icon--protegida' : ''}`}>
                      {bloque.esProtegida ? '🔴' : '📁'}
                    </span>
                    {enEdicion ? (
                      <input
                        className="anx__bloquehead-input"
                        autoFocus
                        value={nombreEdicion}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setNombreEdicion(e.target.value)}
                        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') guardarEdicionCarpeta(bloque.id); if (e.key === 'Escape') setEditandoCarpetaId(null); }}
                        onBlur={() => guardarEdicionCarpeta(bloque.id)}
                      />
                    ) : (
                      <span className={`anx__bloquehead-title${bloque.esProtegida ? ' anx__bloquehead-title--protegida' : ''}`}>{bloque.titulo}</span>
                    )}
                    <span className="anx__count">{items.length}</span>
                    {bloque.esProtegida && (
                      <span className="anx__bloquehead-lock" title="Carpeta protegida — vinculada al botón &quot;Generar con AI&quot; de Entrada, no se puede renombrar ni eliminar">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                      </span>
                    )}
                    {bloque.esCarpetaReal && !bloque.esProtegida && !enEdicion && (
                      <div className="anx__bloquehead-actions" onClick={e => e.stopPropagation()}>
                        <button className="anx__bloquehead-btn" title="Renombrar carpeta" onClick={() => iniciarEdicionCarpeta(carpetas.find(c => c.id === bloque.id)!)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        </button>
                        <button className="anx__bloquehead-btn anx__bloquehead-btn--danger" title="Eliminar carpeta" onClick={() => eliminarCarpeta(carpetas.find(c => c.id === bloque.id)!)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                  {!colapsada && items.length === 0 && (
                    <div className="anx__bloque-empty">Sin soportes en esta carpeta todavía.</div>
                  )}
                  {!colapsada && items.map((s, idx) => (
                    <div key={s.id} className="anx__tr anx__grid">
                      <span className="anx__rownum" title={s.esTecnico ? 'Documento técnico' : 'Anexo general'}>
                        {s.esTecnico
                          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0041a3" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                          : idx + 1}
                      </span>
                      <div className="anx__td anx__td--desc">
                        <input className="anx__input" placeholder="Descripcion del soporte" value={s.descripcion}
                          onChange={e => actualizar(s.id, { descripcion: e.target.value })}
                          onBlur={() => guardarEnServidor(s.id)} />
                      </div>
                      <div className="anx__td">
                        <input className="anx__input anx__input--center" placeholder="TEXTO" value={s.texto}
                          onChange={e => actualizar(s.id, { texto: e.target.value })}
                          onBlur={() => guardarEnServidor(s.id)} />
                      </div>
                      <div className="anx__td">
                        <div className="anx__attach-wrap">
                          <input className="anx__input anx__input--attach" placeholder="." value={s.anexo}
                            onChange={e => actualizar(s.id, { anexo: e.target.value })} />
                          {s.persistido && s.anexo && (
                            <button className="anx__download-btn" title="Descargar anexo" onClick={() => descargar(s)}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </button>
                          )}
                          <button className="anx__attach-btn" title={s.subiendo ? `Subiendo… ${s.progreso ?? 0}%` : 'Adjuntar anexo'} disabled={s.subiendo} onClick={() => adjuntar(s.id)}>
                            {s.subiendo
                              ? <span style={{ fontSize: 9, fontWeight: 700 }}>{s.progreso ?? 0}%</span>
                              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}
                          </button>
                          {/* Barra de progreso real (XHR upload.onprogress, ver apiClient.ts
                              uploadConProgreso) — FIX 2026-08-19: sin esto, ~11s subiendo un
                              archivo grande sin ninguna señal visual hace parecer que la app
                              se congeló. */}
                          {s.subiendo && (
                            <div className="anx__progress-track">
                              <div className="anx__progress-fill" style={{ width: `${s.progreso ?? 0}%` }} />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="anx__td">
                        <input className="anx__input anx__input--center" placeholder="WWW" value={s.link}
                          onChange={e => actualizar(s.id, { link: e.target.value })}
                          onBlur={() => guardarEnServidor(s.id)} />
                      </div>
                      <div className="anx__td">
                        <select
                          className="anx__select"
                          value={s.carpetaId ?? SIN_CARPETA}
                          onChange={e => moverACarpeta(s.id, e.target.value === SIN_CARPETA ? null : e.target.value)}
                          title="Mover a otra carpeta"
                        >
                          <option value={SIN_CARPETA}>Sin carpeta</option>
                          {carpetas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </div>
                      <div className="anx__td anx__td--action">
                        <button
                          className={`anx__toggle${s.esTecnico ? ' anx__toggle--on' : ''}`}
                          role="switch"
                          aria-checked={s.esTecnico}
                          title="Marcar como Documento Técnico"
                          onClick={() => toggleTecnico(s.id)}
                        >
                          <span className="anx__toggle-thumb" />
                        </button>
                      </div>
                      <div className="anx__td anx__td--action">
                        <button className="anx__delete" title="Eliminar soporte" onClick={() => eliminar(s.id)}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                  {!colapsada && (
                    <div className="anx__bloque-footer">
                      <button
                        className="anx__add anx__add--sm"
                        onClick={() => agregar(bloque.esCarpetaReal ? bloque.id : null)}
                        disabled={tieneVacíosEnBloque(bloque.id)}
                        title={tieneVacíosEnBloque(bloque.id) ? 'Completa al menos un campo del soporte actual antes de agregar otro' : undefined}
                        style={{ opacity: tieneVacíosEnBloque(bloque.id) ? 0.4 : 1, cursor: tieneVacíosEnBloque(bloque.id) ? 'not-allowed' : 'pointer' }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                        Agregar nuevo soporte documental
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>
    </main>
  );
}
