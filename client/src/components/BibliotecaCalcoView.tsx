/**
 * BibliotecaCalcoView — Biblioteca Gubernamental con carpetas dinámicas.
 * Mandato del usuario (2026-08-16): reemplaza las 2 carpetas fijas
 * (Documentos Técnicos/Generales, derivadas del toggle "Documento Técnico")
 * por carpetas ilimitadas, creables/renombrables/eliminables por proyecto —
 * ver backend/migrations/040_biblioteca_carpetas_dinamicas.sql y el veredicto
 * del agente architect (2026-08-16) documentado ahí: eliminar una carpeta
 * NUNCA borra sus documentos por defecto (quedan "Sin carpeta") — borrarlos
 * junto con la carpeta es una acción explícita de 2 pasos, nunca implícita.
 *
 * Tokens: mismos que AnexosCalcoView (calcados de Stitch) — sin screen
 * Stitch propio para este módulo, extendido sobre los tokens ya verificados.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import './BibliotecaCalcoView.css';
import { http, ApiError, isAuthenticated } from '../lib/apiClient';

const STORAGE_KEY = 'radar360_biblioteca_calco';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';
const SIN_CARPETA = '__sin_carpeta__'; // id sintético para el bloque de documentos sin carpeta_id
// Caché por proyecto (blindaje antipérdida 2026-08-17): antes solo se
// escribía en localStorage en modo "sin proyecto activo" — cualquier tecleo
// sin llegar a onBlur se perdía por completo ante un F5 con proyecto activo.
const cacheKeyDe = (proyectoId: string | null) => proyectoId ? `${STORAGE_KEY}_proj_${proyectoId}` : STORAGE_KEY;

interface Documento {
  id: string;
  descripcion: string;
  texto: string;
  anexo: string;
  link: string;
  carpetaId: string | null; // null = "Sin carpeta"
  persistido: boolean; // true si ya existe como fila real en project_biblioteca
  subiendo?: boolean;
  progreso?: number; // 0-100, real (XHR upload.onprogress) — solo mientras subiendo es true
}
interface DocumentoApi {
  id: string; nombre_archivo: string; descripcion: string | null; texto: string | null; link: string | null; carpeta_id: string | null;
}
interface BibliotecaApiResponse { success: boolean; data?: DocumentoApi[]; message?: string }

interface Carpeta { id: string; nombre: string; orden: number }
interface CarpetaApi { id: string; nombre: string; orden: number }
interface CarpetasApiResponse { success: boolean; data?: CarpetaApi[]; message?: string }

const nuevoDocumento = (carpetaId: string | null): Documento =>
  ({ id: `b${Date.now()}${Math.random().toString(36).slice(2, 6)}`, descripcion: '', texto: '', anexo: '', link: '', carpetaId, persistido: false });

export default function BibliotecaCalcoView() {
  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
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
  // scheduling que tiene encadenar dos setState (uno disparado desde dentro
  // de eliminar() tras un window.confirm() que bloquea el hilo principal, y
  // otro desde la resolución de un fetch que pudo completarse en la red
  // MIENTRAS ese confirm() bloqueaba — verificado en vivo con logs en
  // AnexosCalcoView.tsx: un check basado en setState(prev => prev.some(...))
  // veía la fila como "todavía presente" incluso después de que eliminar()
  // ya la había filtrado. Un ref no tiene ese problema: se lee/escribe al
  // instante, siempre consistente.
  const eliminadosRef = useRef<Set<string>>(new Set());
  // Cola de guardado por fila (FIX 2026-08-17, bug de duplicación reportado
  // dos veces por el usuario, persistía tras el fix de eliminadosRef porque
  // era OTRA causa): cada input (descripcion/texto/link) dispara su propio
  // onBlur → guardarEnServidor(id) de forma independiente. Si dos blurs de la
  // MISMA fila aún no persistida ocurren en sucesión rápida (p. ej. tabular
  // de descripcion a link), el segundo se ejecuta ANTES de que el primer POST
  // resuelva — persistido todavía lee `false` para ambos — y los dos disparan
  // su propio POST: el servidor crea DOS filas, el estado local solo se
  // queda con el id de la que resolvió última, dejando la otra como
  // duplicado huérfano con datos parciales (visible recién en el próximo
  // reload — coincide exactamente con lo reportado: misma descripción, link
  // vacío). encolar() serializa TODAS las operaciones de guardado de una
  // misma fila (texto y adjuntar archivo) para que nunca corran dos a la vez.
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
      if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) { setDocumentos(p); return; } } catch { /* ignore */ } }
      setDocumentos([nuevoDocumento(null)]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [docsBody, carpetasBody] = await Promise.all([
          http.get<BibliotecaApiResponse>(`/api/proyectos/${proyectoId}/biblioteca`),
          http.get<CarpetasApiResponse>(`/api/proyectos/${proyectoId}/biblioteca/carpetas`),
        ]);
        if (cancelled) return;
        setCarpetas((carpetasBody.data || []).map(c => ({ id: c.id, nombre: c.nombre, orden: c.orden })));

        const rows = (docsBody.data || []).map(a => ({
          id: a.id, descripcion: a.descripcion || '', texto: a.texto || '', link: a.link || '',
          anexo: a.nombre_archivo || '', carpetaId: a.carpeta_id || null, persistido: true,
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
            const cached = JSON.parse(cachedRaw) as Documento[];
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

        if (merged.length) { setDocumentos(merged); return; }

        const raw = localStorage.getItem(STORAGE_KEY);
        let legacy: Documento[] = [];
        if (raw) {
          try {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) {
              legacy = p.filter((s: Documento) => s.descripcion?.trim() || s.texto?.trim() || s.link?.trim() || s.anexo?.trim());
            }
          } catch { /* ignore */ }
        }
        if (!legacy.length) { setDocumentos([nuevoDocumento(null)]); return; }

        const migradas: Documento[] = [];
        for (const s of legacy) {
          try {
            const fd = new FormData();
            fd.append('descripcion', s.descripcion || '');
            fd.append('texto', s.texto || '');
            fd.append('link', s.link || '');
            const resp = await http.upload<{ success: boolean; data?: { id: string; nombre_archivo?: string } }>(`/api/proyectos/${proyectoId}/biblioteca`, fd);
            migradas.push({ ...s, id: resp.data?.id || s.id, anexo: resp.data?.nombre_archivo || s.anexo, carpetaId: null, persistido: !!resp.data?.id });
          } catch {
            migradas.push({ ...s, persistido: false });
          }
        }
        if (cancelled) return;
        setDocumentos(migradas.length ? migradas : [nuevoDocumento(null)]);
        localStorage.removeItem(STORAGE_KEY);
        const conNombreArchivo = legacy.some(s => s.anexo?.trim());
        setErrorSync(
          conNombreArchivo
            ? 'Se recuperaron tus datos guardados localmente. Nota: los archivos adjuntados antes de tener un proyecto activo solo conservaron su nombre — vuelve a adjuntar el archivo real en esas filas.'
            : null
        );
      } catch (err) {
        if (cancelled) return;
        const noAutenticado = (err instanceof ApiError && err.status === 401) || !isAuthenticated();
        const raw = localStorage.getItem(STORAGE_KEY);
        let legacy: Documento[] = [];
        if (raw) {
          try {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) legacy = p.filter((s: Documento) => s.descripcion?.trim() || s.texto?.trim() || s.link?.trim() || s.anexo?.trim());
          } catch { /* ignore */ }
        }
        if (legacy.length) {
          setDocumentos(legacy.map(s => ({ ...s, persistido: false })));
          setErrorSync(
            noAutenticado
              ? 'Tu sesión no es válida o expiró — inicia sesión de nuevo en /login. Estás viendo la copia local de tu biblioteca (aún no sincronizada); nada se ha perdido.'
              : 'No se pudo conectar con el servidor — estás viendo la copia local de tu biblioteca (aún no sincronizada). Nada se ha perdido.'
          );
        } else {
          setErrorSync(noAutenticado ? 'Tu sesión no es válida o expiró — inicia sesión de nuevo en /login.' : 'No se pudieron cargar los documentos guardados.');
          setDocumentos([nuevoDocumento(null)]);
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
  //
  // FIX (bug real encontrado en vivo 2026-08-17 en AnexosCalcoView.tsx, mismo
  // patrón aquí): sin el guard de `cargando`, este efecto se dispara también
  // en el montaje inicial con documentos=[] (el useState arranca vacío) —
  // eso borraba el borrador real en localStorage un instante antes de que el
  // efecto de carga asíncrona (fetch + fusión) alcanzara a leerlo.
  useEffect(() => {
    if (cargando) return;
    localStorage.setItem(cacheKeyDe(proyectoId), JSON.stringify(documentos));
  }, [documentos, proyectoId]);

  const actualizarLocal = (id: string, patch: Partial<Documento>) =>
    setDocumentos(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  // Devuelve si la fila quedó realmente persistida — guardar() lo usa para no
  // mostrar "✓ GUARDADO" cuando en realidad falló. Encolada por id (ver
  // colaGuardadoRef) para que nunca corra en paralelo con otro guardado de la
  // misma fila.
  const guardarEnServidor = (id: string): Promise<boolean> => encolar(id, () => ejecutarGuardado(id));

  const ejecutarGuardado = async (id: string): Promise<boolean> => {
    if (!proyectoId) return true;
    const row = documentos.find(s => s.id === id);
    if (!row) return true;
    try {
      if (row.persistido) {
        await http.patch(`/api/proyectos/${proyectoId}/biblioteca/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link });
      } else if (row.descripcion.trim() || row.texto.trim() || row.link.trim()) {
        const fd = new FormData();
        fd.append('descripcion', row.descripcion);
        fd.append('texto', row.texto);
        fd.append('link', row.link);
        if (row.carpetaId) fd.append('carpeta_id', row.carpetaId);
        const resp = await http.upload<{ success: boolean; data?: { id: string } }>(`/api/proyectos/${proyectoId}/biblioteca`, fd);
        if (resp.data?.id) {
          const idServidor = resp.data.id;
          // FIX (reportado por el usuario 2026-08-17): si el documento se
          // elimina en el cliente MIENTRAS este POST sigue en vuelo, el
          // servidor igual lo crea — queda un huérfano invisible que
          // reaparece en el próximo F5/GET. eliminadosRef (no un check de
          // setState) es la fuente de verdad — ver comentario en su
          // declaración.
          if (eliminadosRef.current.has(id)) {
            eliminadosRef.current.delete(id);
            http.delete(`/api/proyectos/${proyectoId}/biblioteca/${idServidor}`).catch(() => {});
          } else {
            actualizarLocal(id, { id: idServidor, persistido: true });
          }
        }
      }
      setErrorSync(null);
      return true;
    } catch {
      setErrorSync('No se pudo guardar un documento — revisa tu conexión.');
      return false;
    }
  };

  // Mueve un documento a otra carpeta (o a "Sin carpeta" con null) — persiste
  // de inmediato si la fila ya existe en el servidor.
  const moverACarpeta = (id: string, carpetaId: string | null) => {
    setDocumentos(prev => {
      const next = prev.map(s => s.id === id ? { ...s, carpetaId } : s);
      const row = next.find(s => s.id === id);
      if (row?.persistido && proyectoId) {
        http.patch(`/api/proyectos/${proyectoId}/biblioteca/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link, carpeta_id: carpetaId })
          .catch(() => setErrorSync('No se pudo mover el documento — revisa tu conexión.'));
      }
      return next;
    });
  };

  const actualizar = (id: string, patch: Partial<Documento>) => actualizarLocal(id, patch);

  const descargar = async (s: Documento) => {
    if (!proyectoId || !s.persistido) return;
    try {
      const resp = await http.get<{ success: boolean; data?: { url: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/biblioteca/${s.id}/download`
      );
      if (!resp.success || !resp.data?.url) throw new Error(resp.message ?? 'No se pudo generar el enlace de descarga.');
      window.open(resp.data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErrorSync(e instanceof Error ? e.message : 'Error al descargar el documento.');
    }
  };

  const guardar = async () => {
    const resultados = await Promise.all(documentos.map(s => guardarEnServidor(s.id)));
    if (resultados.every(Boolean)) {
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2200);
      // El caché local solo se limpia cuando el servidor confirmó TODOS los
      // documentos — si algo falló, el borrador se conserva para no perderlo.
      localStorage.removeItem(cacheKeyDe(proyectoId));
    }
  };

  const limpiar = () => {
    const hayNoPersistidas = documentos.some(s => !s.persistido && (s.descripcion.trim() || s.texto.trim() || s.link.trim() || s.anexo.trim()));
    if (hayNoPersistidas && !window.confirm('Esto va a quitar de la vista los documentos que aún no se han guardado en el servidor. ¿Seguro que quieres continuar?')) {
      return;
    }
    if (!proyectoId) localStorage.removeItem(STORAGE_KEY);
    setDocumentos(prev => {
      const persistidos = prev.filter(s => s.persistido);
      return persistidos.length ? persistidos : [nuevoDocumento(null)];
    });
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  const eliminar = async (id: string) => {
    const row = documentos.find(s => s.id === id);
    const tieneContenido = row && (row.descripcion.trim() || row.texto.trim() || row.link.trim() || row.anexo.trim());
    if (tieneContenido && !window.confirm('¿Eliminar este documento? Esta acción no se puede deshacer.')) return;
    eliminadosRef.current.add(id); // marca ANTES de tocar el estado — ver comentario en la declaración del ref
    setDocumentos(prev => prev.filter(s => s.id !== id));
    if (!proyectoId) { localStorage.setItem(STORAGE_KEY, JSON.stringify(documentos.filter(s => s.id !== id))); return; }
    if (row?.persistido) {
      try { await http.delete(`/api/proyectos/${proyectoId}/biblioteca/${id}`); }
      catch { setErrorSync('No se pudo eliminar el documento en el servidor.'); }
    }
  };

  // FIX (reportado por el usuario 2026-08-17): antes este check era GLOBAL
  // (documentos.some(...) sobre TODOS los documentos) — una sola fila vacía
  // en CUALQUIER carpeta desactivaba el botón "+ Agregar documento" de TODAS
  // las demás carpetas. Con carpetas dinámicas eso es incorrecto: cada
  // carpeta debe evaluar solo sus propias filas vacías, igual que el filtro
  // `items` ya usado para renderizarlas (misma clave: carpetaId ?? SIN_CARPETA).
  const tieneVacíosEnBloque = (bloqueId: string) =>
    documentos
      .filter(s => (s.carpetaId ?? SIN_CARPETA) === bloqueId)
      .some(s => !s.descripcion.trim() && !s.texto.trim() && !s.anexo.trim() && !s.link.trim());

  const agregar = (carpetaId: string | null) => {
    if (tieneVacíosEnBloque(carpetaId ?? SIN_CARPETA)) return;
    setDocumentos(prev => [...prev, nuevoDocumento(carpetaId)]);
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
    // subida a Storage tuvo éxito, pero si fallaba (p. ej. la clave de
    // Supabase Storage inválida — ver hallazgo previo, aún sin corregir por
    // el usuario) el catch de más abajo solo apagaba "subiendo", nunca
    // revertía el nombre — la fila seguía mostrando un archivo fantasma que
    // NUNCA se guardó, hasta que un F5/recarga futura lo hacía "desaparecer"
    // de golpe. Se captura el valor real anterior aquí para poder revertir
    // al instante si falla, en vez de mentir hasta la próxima recarga.
    const anexoAnterior = documentos.find(s => s.id === id)?.anexo ?? '';
    actualizarLocal(id, { anexo: f.name, subiendo: !!proyectoId, progreso: 0 });
    if (!proyectoId) return;
    // Encolada por id: si un guardado de texto (descripcion/link) para esta
    // misma fila sigue en vuelo, este adjunto espera a que termine antes de
    // decidir crear o reemplazar — evita la carrera con ejecutarGuardado.
    encolar(id, () => ejecutarAdjuntar(id, f, anexoAnterior));
  };

  // FIX (bug real reportado 2026-08-17, DISTINTO del de eliminadosRef): el
  // backend no soporta adjuntar un archivo a una fila que YA existe en el
  // servidor vía PATCH (solo POST crea filas con archivo) — antes esta
  // función hacía POST siempre, sin mirar `persistido`, así que adjuntar un
  // archivo a una fila que el usuario ya había tecleado y guardado (flujo
  // normal: escribir descripción → onBlur la guarda → luego adjuntar el
  // archivo) creaba una fila NUEVA con el archivo y dejaba la vieja como
  // duplicado permanente (mismo texto, sin archivo). Fix: si la fila ya
  // estaba persistida, se crea la fila de reemplazo CON el archivo primero
  // y solo si eso tuvo éxito se borra la fila vieja — nunca al revés, para
  // no perder datos si la subida falla.
  const ejecutarAdjuntar = async (id: string, f: File, anexoAnterior: string): Promise<boolean> => {
    const row = documentos.find(s => s.id === id);
    if (!row) return true;
    const idAntiguo = row.persistido ? row.id : null;
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (row.carpetaId) fd.append('carpeta_id', row.carpetaId);
      fd.append('descripcion', row.descripcion || '');
      fd.append('texto', row.texto || '');
      fd.append('link', row.link || '');
      const resp = await http.uploadConProgreso<{ success: boolean; data?: { id: string; nombre_archivo: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/biblioteca`, fd,
        pct => actualizarLocal(id, { progreso: pct })
      );
      if (resp.data) {
        const idServidor = resp.data.id;
        const nombreArchivo = resp.data.nombre_archivo;
        // Misma condición de carrera que en ejecutarGuardado: si el
        // documento se borró mientras esta subida seguía en vuelo, el
        // archivo real ya quedó guardado en el servidor — eliminadosRef es
        // la fuente de verdad (ver comentario en su declaración).
        if (eliminadosRef.current.has(id)) {
          eliminadosRef.current.delete(id);
          http.delete(`/api/proyectos/${proyectoId}/biblioteca/${idServidor}`).catch(() => {});
        } else {
          actualizarLocal(id, { id: idServidor, anexo: nombreArchivo, persistido: true, subiendo: false, progreso: undefined });
          if (idAntiguo) {
            http.delete(`/api/proyectos/${proyectoId}/biblioteca/${idAntiguo}`)
              .catch(() => setErrorSync('El archivo se adjuntó, pero quedó una fila duplicada sin limpiar — recarga la página e ilumínala para borrarla a mano.'));
          }
        }
      }
      setErrorSync(null);
      return true;
    } catch (e) {
      // FIX (auditoría 2026-08-17, "sube un PDF y al rato desaparece"): antes
      // solo se apagaba "subiendo", dejando el nombre optimista puesto en
      // onFile aunque la subida real hubiera fallado — la fila mentía hasta
      // el próximo reload, donde el nombre fantasma desaparecía de golpe.
      // Ahora se revierte al valor real (lo que había ANTES de este intento)
      // de inmediato, para que el estado visible sea siempre el verdadero.
      actualizarLocal(id, { subiendo: false, progreso: undefined, anexo: anexoAnterior });
      // FIX (auditoría 2026-08-17): antes se mostraba siempre el mismo texto
      // genérico sin importar la causa real — eso ocultaba errores como
      // "El archivo supera el tamaño máximo" o una falla de credenciales de
      // Storage, forzando a revisar los logs del servidor para saber qué
      // pasó. e.message ya trae el mensaje real que el backend devuelve
      // (ver ApiError en apiClient.ts).
      setErrorSync(e instanceof Error && e.message ? e.message : 'No se pudo subir el archivo — inténtalo de nuevo.');
      return false;
    }
  };

  // ── Carpetas: crear / renombrar / eliminar ──────────────────────────────
  const crearCarpeta = async () => {
    const nombre = nombreNuevaCarpeta.trim();
    if (!nombre) { setCreandoCarpeta(false); return; }
    if (!proyectoId) {
      setErrorSync('Activa un proyecto para crear carpetas en la Biblioteca.');
      setCreandoCarpeta(false);
      return;
    }
    try {
      const resp = await http.post<{ success: boolean; data?: { id: string; nombre: string; orden: number } }>(
        `/api/proyectos/${proyectoId}/biblioteca/carpetas`, { nombre }
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
      await http.put(`/api/proyectos/${proyectoId}/biblioteca/carpetas/${id}`, { nombre });
    } catch {
      setErrorSync('No se pudo renombrar la carpeta — revisa tu conexión.');
      if (anterior) setCarpetas(prev => prev.map(c => c.id === id ? { ...c, nombre: anterior } : c));
    }
  };

  const eliminarCarpeta = async (c: Carpeta) => {
    if (!window.confirm(`¿Eliminar la carpeta "${c.nombre}"?`)) return;
    const nDocs = documentos.filter(d => d.carpetaId === c.id).length;
    let eliminarDocumentos = false;
    if (nDocs > 0) {
      eliminarDocumentos = window.confirm(
        `Esta carpeta tiene ${nDocs} documento(s). ¿También quieres eliminarlos? Esta acción no se puede deshacer.\n\nCancelar los conserva — pasan a "Sin carpeta".`
      );
    }
    setCarpetas(prev => prev.filter(x => x.id !== c.id));
    if (eliminarDocumentos) {
      setDocumentos(prev => prev.filter(d => d.carpetaId !== c.id));
    } else {
      setDocumentos(prev => prev.map(d => d.carpetaId === c.id ? { ...d, carpetaId: null } : d));
    }
    if (!proyectoId) return;
    try {
      await http.delete(`/api/proyectos/${proyectoId}/biblioteca/carpetas/${c.id}${eliminarDocumentos ? '?eliminarDocumentos=true' : ''}`);
    } catch {
      setErrorSync('No se pudo eliminar la carpeta en el servidor.');
    }
  };

  // Colapso/expansión por carpeta — evita que la interfaz se sature cuando
  // se acumulan muchos documentos. Expandido por defecto (Set vacío).
  const toggleColapso = (bloqueId: string) => {
    setCarpetasColapsadas(prev => {
      const next = new Set(prev);
      if (next.has(bloqueId)) next.delete(bloqueId); else next.add(bloqueId);
      return next;
    });
  };

  const bloques = [
    ...carpetas.map(c => ({ id: c.id, titulo: c.nombre, esCarpetaReal: true as const })),
    { id: SIN_CARPETA, titulo: 'Sin carpeta', esCarpetaReal: false as const },
  ];

  return (
    <main className="bib">
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onFile} />
      <div className="bib__container">
        <div className="bib__fixedzone">
          <header className="bib__topbar">
            <h1 className="bib__h1"><span className="bib__h1-text">Biblioteca Gubernamental</span><span className="bib__count">{documentos.length}</span></h1>
            <div className="bib__topbar-right">
              {creandoCarpeta ? (
                <div className="bib__newcarpeta">
                  <input
                    className="bib__newcarpeta-input"
                    autoFocus
                    placeholder="Nombre de la carpeta"
                    value={nombreNuevaCarpeta}
                    onChange={e => setNombreNuevaCarpeta(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') crearCarpeta(); if (e.key === 'Escape') { setCreandoCarpeta(false); setNombreNuevaCarpeta(''); } }}
                    onBlur={crearCarpeta}
                  />
                </div>
              ) : (
                <button className="bib__newcarpeta-btn" onClick={() => setCreandoCarpeta(true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  Nueva Carpeta
                </button>
              )}
              <button
                className={`bib__clear${limpiado ? ' bib__clear--done' : ''}`}
                onClick={limpiar}
              >
                {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
              </button>
              <button
                className={`bib__save${guardado ? ' bib__save--saved' : ''}`}
                onClick={guardar}
              >
                {guardado ? '✓ GUARDADO' : 'SAVE'}
              </button>
            </div>
          </header>
          {errorSync && (
            <div className="bib__statusmsg bib__statusmsg--error" role="alert">{errorSync}</div>
          )}
          <div className="bib__theadrow bib__grid">
            <span className="bib__th bib__th--num" />
            <span className="bib__th">DESCRIPCION</span>
            <span className="bib__th bib__th--center">TEXTO</span>
            <span className="bib__th bib__th--center">ANEXO.</span>
            <span className="bib__th bib__th--center">LINK</span>
            <span className="bib__th bib__th--center">CARPETA</span>
            <span className="bib__th" />
          </div>
        </div>

        <div className="bib__content">
        <div className="bib__table-scroll">
          <div className="bib__table">
            {bloques.map(bloque => {
              const items = documentos.filter(d => (d.carpetaId ?? SIN_CARPETA) === bloque.id);
              const enEdicion = editandoCarpetaId === bloque.id;
              const colapsada = carpetasColapsadas.has(bloque.id);
              return (
                <div key={bloque.id} className="bib__bloque">
                  <div
                    className="bib__bloquehead bib__bloquehead--clickable"
                    onClick={() => toggleColapso(bloque.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!colapsada}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleColapso(bloque.id); } }}
                  >
                    <svg
                      className={`bib__bloquehead-chevron${colapsada ? '' : ' bib__bloquehead-chevron--open'}`}
                      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                    ><polyline points="9 18 15 12 9 6" /></svg>
                    <span className="bib__bloquehead-icon">📁</span>
                    {enEdicion ? (
                      <input
                        className="bib__bloquehead-input"
                        autoFocus
                        value={nombreEdicion}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setNombreEdicion(e.target.value)}
                        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') guardarEdicionCarpeta(bloque.id); if (e.key === 'Escape') setEditandoCarpetaId(null); }}
                        onBlur={() => guardarEdicionCarpeta(bloque.id)}
                      />
                    ) : (
                      <span className="bib__bloquehead-title">{bloque.titulo}</span>
                    )}
                    <span className="bib__count">{items.length}</span>
                    {bloque.esCarpetaReal && !enEdicion && (
                      <div className="bib__bloquehead-actions" onClick={e => e.stopPropagation()}>
                        <button className="bib__bloquehead-btn" title="Renombrar carpeta" onClick={() => iniciarEdicionCarpeta(carpetas.find(c => c.id === bloque.id)!)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        </button>
                        <button className="bib__bloquehead-btn bib__bloquehead-btn--danger" title="Eliminar carpeta" onClick={() => eliminarCarpeta(carpetas.find(c => c.id === bloque.id)!)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                  {!colapsada && items.length === 0 && (
                    <div className="bib__bloque-empty">Sin documentos en esta carpeta todavía.</div>
                  )}
                  {!colapsada && items.map((s, idx) => (
                    <div key={s.id} className="bib__tr bib__grid">
                      <span className="bib__rownum">{idx + 1}</span>
                      <div className="bib__td bib__td--desc">
                        <input className="bib__input" placeholder="Descripcion del documento" value={s.descripcion}
                          onChange={e => actualizar(s.id, { descripcion: e.target.value })}
                          onBlur={() => guardarEnServidor(s.id)} />
                      </div>
                      <div className="bib__td">
                        <input className="bib__input bib__input--center" placeholder="TEXTO" value={s.texto}
                          onChange={e => actualizar(s.id, { texto: e.target.value })}
                          onBlur={() => guardarEnServidor(s.id)} />
                      </div>
                      <div className="bib__td">
                        <div className="bib__attach-wrap">
                          <input className="bib__input bib__input--attach" placeholder="." value={s.anexo}
                            onChange={e => actualizar(s.id, { anexo: e.target.value })} />
                          {s.persistido && s.anexo && (
                            <button className="bib__download-btn" title="Descargar documento" onClick={() => descargar(s)}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </button>
                          )}
                          <button className="bib__attach-btn" title={s.subiendo ? `Subiendo… ${s.progreso ?? 0}%` : 'Adjuntar documento'} disabled={s.subiendo} onClick={() => adjuntar(s.id)}>
                            {s.subiendo
                              ? <span style={{ fontSize: 9, fontWeight: 700 }}>{s.progreso ?? 0}%</span>
                              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}
                          </button>
                          {/* Barra de progreso real (XHR upload.onprogress, ver apiClient.ts
                              uploadConProgreso) — FIX 2026-08-19: sin esto, subir un archivo
                              grande sin ninguna señal visual hace parecer que la app se congeló. */}
                          {s.subiendo && (
                            <div className="bib__progress-track">
                              <div className="bib__progress-fill" style={{ width: `${s.progreso ?? 0}%` }} />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="bib__td">
                        <input className="bib__input bib__input--center" placeholder="WWW" value={s.link}
                          onChange={e => actualizar(s.id, { link: e.target.value })}
                          onBlur={() => guardarEnServidor(s.id)} />
                      </div>
                      <div className="bib__td">
                        <select
                          className="bib__select"
                          value={s.carpetaId ?? SIN_CARPETA}
                          onChange={e => moverACarpeta(s.id, e.target.value === SIN_CARPETA ? null : e.target.value)}
                          title="Mover a otra carpeta"
                        >
                          <option value={SIN_CARPETA}>Sin carpeta</option>
                          {carpetas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </div>
                      <div className="bib__td bib__td--action">
                        <button className="bib__delete" title="Eliminar documento" onClick={() => eliminar(s.id)}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                  {!colapsada && (
                    <div className="bib__bloque-footer">
                      <button
                        className="bib__add bib__add--sm"
                        onClick={() => agregar(bloque.esCarpetaReal ? bloque.id : null)}
                        disabled={tieneVacíosEnBloque(bloque.id)}
                        title={tieneVacíosEnBloque(bloque.id) ? 'Completa al menos un campo del documento actual antes de agregar otro' : undefined}
                        style={{ opacity: tieneVacíosEnBloque(bloque.id) ? 0.4 : 1, cursor: tieneVacíosEnBloque(bloque.id) ? 'not-allowed' : 'pointer' }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                        Agregar nuevo documento
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
