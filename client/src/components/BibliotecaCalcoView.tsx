/**
 * BibliotecaCalcoView — clon aislado de AnexosCalcoView.tsx para el módulo
 * "Biblioteca Gubernamental" (mandato del usuario 2026-08-16). Mismos
 * controles (DESCRIPCION/TEXTO/ANEXO/LINK/TÉCNICO), mismos 2 bloques
 * (Documentos Técnicos / Documentos Generales), apuntando a los endpoints
 * /api/proyectos/:id/biblioteca (biblioteca.routes.js — sin pipeline
 * financiero, revisado con el agente architect antes de clonar).
 *
 * Tokens: mismos que AnexosCalcoView (calcados de Stitch) — sin screen
 * Stitch propio para este módulo, extendido sobre los tokens ya verificados
 * igual que se hizo con el toggle/bloques de Anexos.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import './BibliotecaCalcoView.css';
import { http, ApiError, isAuthenticated } from '../lib/apiClient';

const STORAGE_KEY = 'radar360_biblioteca_calco';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

interface Documento {
  id: string;
  descripcion: string;
  texto: string;
  anexo: string;
  link: string;
  esTecnico: boolean; // toggle "Documento Técnico" — determina el bloque (Técnicos / Generales) y la categoria enviada al backend
  persistido: boolean; // true si ya existe como fila real en project_biblioteca
  subiendo?: boolean;
}
interface DocumentoApi {
  id: string; nombre_archivo: string; descripcion: string | null; texto: string | null; link: string | null; categoria: string | null;
}
interface BibliotecaApiResponse { success: boolean; data?: DocumentoApi[]; message?: string }

const CATEGORIAS_TECNICAS = new Set(['tecnico']);
const esCategoriaTecnica = (categoria: string | null | undefined) => !!categoria && CATEGORIAS_TECNICAS.has(categoria);

// Deriva la categoria del backend a partir del toggle "Documento Técnico" —
// sin 'presupuesto_apu': la Biblioteca no dispara pipeline financiero, solo
// clasifica el documento como técnico u otro.
const categoriaDe = (s: Pick<Documento, 'esTecnico'>): string => (s.esTecnico ? 'tecnico' : 'otro');

const nuevoDocumento = (): Documento => ({ id: `b${Date.now()}${Math.random().toString(36).slice(2, 6)}`, descripcion: '', texto: '', anexo: '', link: '', esTecnico: false, persistido: false });

export default function BibliotecaCalcoView() {
  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [cargando, setCargando] = useState(!!proyectoId);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [limpiado, setLimpiado] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!proyectoId) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) { setDocumentos(p); return; } } catch { /* ignore */ } }
      setDocumentos([nuevoDocumento()]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const body = await http.get<BibliotecaApiResponse>(`/api/proyectos/${proyectoId}/biblioteca`);
        if (cancelled) return;
        const rows = (body.data || []).map(a => ({
          id: a.id, descripcion: a.descripcion || '', texto: a.texto || '', link: a.link || '',
          anexo: a.nombre_archivo || '', esTecnico: esCategoriaTecnica(a.categoria), persistido: true,
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
        if (!legacy.length) { setDocumentos([nuevoDocumento()]); return; }

        const migradas: Documento[] = [];
        for (const s of legacy) {
          try {
            const fd = new FormData();
            fd.append('descripcion', s.descripcion || '');
            fd.append('texto', s.texto || '');
            fd.append('link', s.link || '');
            fd.append('categoria', categoriaDe(s));
            const resp = await http.upload<{ success: boolean; data?: { id: string; nombre_archivo?: string } }>(`/api/proyectos/${proyectoId}/biblioteca`, fd);
            migradas.push({ ...s, id: resp.data?.id || s.id, anexo: resp.data?.nombre_archivo || s.anexo, persistido: !!resp.data?.id });
          } catch {
            migradas.push({ ...s, persistido: false });
          }
        }
        if (cancelled) return;
        setDocumentos(migradas.length ? migradas : [nuevoDocumento()]);
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
          setDocumentos([nuevoDocumento()]);
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

  const guardarEnServidor = async (id: string) => {
    if (!proyectoId) return;
    const row = documentos.find(s => s.id === id);
    if (!row) return;
    try {
      if (row.persistido) {
        await http.patch(`/api/proyectos/${proyectoId}/biblioteca/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link, categoria: categoriaDe(row) });
      } else if (row.descripcion.trim() || row.texto.trim() || row.link.trim()) {
        const fd = new FormData();
        fd.append('descripcion', row.descripcion);
        fd.append('texto', row.texto);
        fd.append('link', row.link);
        fd.append('categoria', categoriaDe(row));
        const resp = await http.upload<{ success: boolean; data?: { id: string } }>(`/api/proyectos/${proyectoId}/biblioteca`, fd);
        if (resp.data?.id) actualizarLocal(id, { id: resp.data.id, persistido: true });
      }
      setErrorSync(null);
    } catch {
      setErrorSync('No se pudo guardar un documento — revisa tu conexión.');
    }
  };

  const toggleTecnico = (id: string) => {
    setDocumentos(prev => {
      const next = prev.map(s => s.id === id ? { ...s, esTecnico: !s.esTecnico } : s);
      const row = next.find(s => s.id === id);
      if (row?.persistido && proyectoId) {
        http.patch(`/api/proyectos/${proyectoId}/biblioteca/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link, categoria: categoriaDe(row) })
          .catch(() => setErrorSync('No se pudo guardar la reclasificación — revisa tu conexión.'));
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
    await Promise.all(documentos.map(s => guardarEnServidor(s.id)));
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2200);
  };

  const limpiar = () => {
    const hayNoPersistidas = documentos.some(s => !s.persistido && (s.descripcion.trim() || s.texto.trim() || s.link.trim() || s.anexo.trim()));
    if (hayNoPersistidas && !window.confirm('Esto va a quitar de la vista los documentos que aún no se han guardado en el servidor. ¿Seguro que quieres continuar?')) {
      return;
    }
    if (!proyectoId) localStorage.removeItem(STORAGE_KEY);
    setDocumentos(prev => {
      const persistidos = prev.filter(s => s.persistido);
      return persistidos.length ? persistidos : [nuevoDocumento()];
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

  const agregar = () => {
    if (tieneVacíos()) return;
    setDocumentos(prev => [...prev, nuevoDocumento()]);
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
      fd.append('categoria', categoriaDe({ esTecnico: !!row?.esTecnico }));
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

  return (
    <main className="bib">
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onFile} />
      <div className="bib__container">
        <div className="bib__fixedzone">
          <header className="bib__topbar">
            <h1 className="bib__h1"><span className="bib__h1-text">Biblioteca Gubernamental</span><span className="bib__count">{documentos.length}</span></h1>
            <div className="bib__topbar-right">
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
          <div className="bib__theadrow bib__grid">
            <span className="bib__th bib__th--num" />
            <span className="bib__th">DESCRIPCION</span>
            <span className="bib__th bib__th--center">TEXTO</span>
            <span className="bib__th bib__th--center">ANEXO.</span>
            <span className="bib__th bib__th--center">LINK</span>
            <span className="bib__th bib__th--center">TÉCNICO</span>
            <span className="bib__th" />
          </div>
        </div>

        <div className="bib__content">
        <div className="bib__table-scroll">
          <div className="bib__table">
            {[
              { key: 'tecnico', icono: '📁', titulo: 'Documentos Técnicos', items: documentos.filter(s => s.esTecnico) },
              { key: 'general', icono: '📁', titulo: 'Documentos Generales', items: documentos.filter(s => !s.esTecnico) },
            ].map(bloque => (
              <div key={bloque.key} className="bib__bloque">
                <div className="bib__bloquehead">
                  <span className="bib__bloquehead-icon">{bloque.icono}</span>
                  <span className="bib__bloquehead-title">{bloque.titulo}</span>
                  <span className="bib__count">{bloque.items.length}</span>
                </div>
                {bloque.items.length === 0 && (
                  <div className="bib__bloque-empty">Sin documentos en esta categoría todavía.</div>
                )}
                {bloque.items.map((s, idx) => (
                <div key={s.id} className="bib__tr bib__grid">
                  <span className="bib__rownum" title={s.esTecnico ? 'Documento técnico' : 'Documento general'}>
                    {s.esTecnico
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0041a3" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      : idx + 1}
                  </span>
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
                  <div className="bib__td bib__td--action">
                    <button
                      className={`bib__toggle${s.esTecnico ? ' bib__toggle--on' : ''}`}
                      role="switch"
                      aria-checked={s.esTecnico}
                      title="Marcar como Documento Técnico"
                      onClick={() => toggleTecnico(s.id)}
                    >
                      <span className="bib__toggle-thumb" />
                    </button>
                  </div>
                  <div className="bib__td bib__td--action">
                    <button className="bib__delete" title="Eliminar documento" onClick={() => eliminar(s.id)}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="bib__footer">
          <button
            className="bib__add"
            onClick={agregar}
            disabled={tieneVacíos()}
            title={tieneVacíos() ? 'Completa al menos un campo del documento actual antes de agregar otro' : undefined}
            style={{ opacity: tieneVacíos() ? 0.4 : 1, cursor: tieneVacíos() ? 'not-allowed' : 'pointer' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Agregar nuevo documento
          </button>
        </div>
        </div>
      </div>
    </main>
  );
}
