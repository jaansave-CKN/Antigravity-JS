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

interface Documento {
  id: string;
  descripcion: string;
  texto: string;
  anexo: string;
  link: string;
  carpetaId: string | null; // null = "Sin carpeta"
  persistido: boolean; // true si ya existe como fila real en project_biblioteca
  subiendo?: boolean;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetIdRef = useRef<string | null>(null);

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
        if (rows.length) { setDocumentos(rows); return; }

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

  useEffect(() => {
    if (!proyectoId) localStorage.setItem(STORAGE_KEY, JSON.stringify(documentos));
  }, [documentos, proyectoId]);

  const actualizarLocal = (id: string, patch: Partial<Documento>) =>
    setDocumentos(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  // Devuelve si la fila quedó realmente persistida — guardar() lo usa para no
  // mostrar "✓ GUARDADO" cuando en realidad falló.
  const guardarEnServidor = async (id: string): Promise<boolean> => {
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
        if (resp.data?.id) actualizarLocal(id, { id: resp.data.id, persistido: true });
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
    setDocumentos(prev => prev.filter(s => s.id !== id));
    if (!proyectoId) { localStorage.setItem(STORAGE_KEY, JSON.stringify(documentos.filter(s => s.id !== id))); return; }
    if (row?.persistido) {
      try { await http.delete(`/api/proyectos/${proyectoId}/biblioteca/${id}`); }
      catch { setErrorSync('No se pudo eliminar el documento en el servidor.'); }
    }
  };

  const tieneVacíos = () =>
    documentos.some(s => !s.descripcion.trim() && !s.texto.trim() && !s.anexo.trim() && !s.link.trim());

  const agregar = (carpetaId: string | null) => {
    if (tieneVacíos()) return;
    setDocumentos(prev => [...prev, nuevoDocumento(carpetaId)]);
  };

  const adjuntar = (id: string) => {
    targetIdRef.current = id;
    fileInputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const id = targetIdRef.current;
    e.target.value = '';
    if (!f || !id) return;
    actualizarLocal(id, { anexo: f.name, subiendo: !!proyectoId });
    if (!proyectoId) return;

    const row = documentos.find(s => s.id === id);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (row?.carpetaId) fd.append('carpeta_id', row.carpetaId);
      fd.append('descripcion', row?.descripcion || '');
      fd.append('texto', row?.texto || '');
      fd.append('link', row?.link || '');
      const resp = await http.upload<{ success: boolean; data?: { id: string; nombre_archivo: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/biblioteca`, fd
      );
      if (resp.data) actualizarLocal(id, { id: resp.data.id, anexo: resp.data.nombre_archivo, persistido: true, subiendo: false });
      setErrorSync(null);
    } catch {
      actualizarLocal(id, { subiendo: false });
      setErrorSync('No se pudo subir el archivo — inténtalo de nuevo.');
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
              return (
                <div key={bloque.id} className="bib__bloque">
                  <div className="bib__bloquehead">
                    <span className="bib__bloquehead-icon">📁</span>
                    {enEdicion ? (
                      <input
                        className="bib__bloquehead-input"
                        autoFocus
                        value={nombreEdicion}
                        onChange={e => setNombreEdicion(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') guardarEdicionCarpeta(bloque.id); if (e.key === 'Escape') setEditandoCarpetaId(null); }}
                        onBlur={() => guardarEdicionCarpeta(bloque.id)}
                      />
                    ) : (
                      <span className="bib__bloquehead-title">{bloque.titulo}</span>
                    )}
                    <span className="bib__count">{items.length}</span>
                    {bloque.esCarpetaReal && !enEdicion && (
                      <div className="bib__bloquehead-actions">
                        <button className="bib__bloquehead-btn" title="Renombrar carpeta" onClick={() => iniciarEdicionCarpeta(carpetas.find(c => c.id === bloque.id)!)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        </button>
                        <button className="bib__bloquehead-btn bib__bloquehead-btn--danger" title="Eliminar carpeta" onClick={() => eliminarCarpeta(carpetas.find(c => c.id === bloque.id)!)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                  {items.length === 0 && (
                    <div className="bib__bloque-empty">Sin documentos en esta carpeta todavía.</div>
                  )}
                  {items.map((s, idx) => (
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
                          <button className="bib__attach-btn" title={s.subiendo ? 'Subiendo…' : 'Adjuntar documento'} disabled={s.subiendo} onClick={() => adjuntar(s.id)}>
                            {s.subiendo
                              ? <span style={{ fontSize: 10, fontWeight: 700 }}>…</span>
                              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}
                          </button>
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
                  <div className="bib__bloque-footer">
                    <button
                      className="bib__add bib__add--sm"
                      onClick={() => agregar(bloque.esCarpetaReal ? bloque.id : null)}
                      disabled={tieneVacíos()}
                      title={tieneVacíos() ? 'Completa al menos un campo del documento actual antes de agregar otro' : undefined}
                      style={{ opacity: tieneVacíos() ? 0.4 : 1, cursor: tieneVacíos() ? 'not-allowed' : 'pointer' }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                      Agregar nuevo documento
                    </button>
                  </div>
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
