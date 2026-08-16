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
 * EXTENSIÓN 2026-08-16 (mandato rediseño Anexos): listado dividido en dos
 * bloques (Documentos Técnicos / Anexos Generales) según el toggle por fila
 * "Documento Técnico", que mapea a la categoria ya existente en el backend
 * (anexos.routes.js) — no se creó ninguna columna/campo nuevo. Sin screen
 * Stitch propio para el toggle/bloques: extendido sobre los tokens ya
 * calcados arriba, autorizado explícitamente en vez de bloquear la entrega.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import './AnexosCalcoView.css';
import { http, ApiError, isAuthenticated } from '../lib/apiClient';

const STORAGE_KEY = 'radar360_anexos_calco';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

interface Soporte {
  id: string;
  descripcion: string;
  texto: string;
  anexo: string;
  link: string;
  esTecnico: boolean; // toggle "Documento Técnico" — determina el bloque (Técnicos / Generales) y la categoria enviada al backend
  persistido: boolean; // true si ya existe como fila real en project_anexos
  subiendo?: boolean;
}
interface AnexoApi {
  id: string; nombre_archivo: string; descripcion: string | null; texto: string | null; link: string | null; categoria: string | null;
}
interface AnexosApiResponse { success: boolean; data?: AnexoApi[]; message?: string }

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

const nuevoSoporte = (): Soporte => ({ id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`, descripcion: '', texto: '', anexo: '', link: '', esTecnico: false, persistido: false });

export default function AnexosCalcoView() {
  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);
  const [soportes, setSoportes] = useState<Soporte[]>([]);
  const [cargando, setCargando] = useState(!!proyectoId);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [limpiado, setLimpiado] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!proyectoId) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) { setSoportes(p); return; } } catch { /* ignore */ } }
      setSoportes([nuevoSoporte()]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const body = await http.get<AnexosApiResponse>(`/api/proyectos/${proyectoId}/anexos`);
        if (cancelled) return;
        const rows = (body.data || []).map(a => ({
          id: a.id, descripcion: a.descripcion || '', texto: a.texto || '', link: a.link || '',
          anexo: a.nombre_archivo || '', esTecnico: esCategoriaTecnica(a.categoria), persistido: true,
        }));
        if (rows.length) { setSoportes(rows); return; }

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
        if (!legacy.length) { setSoportes([nuevoSoporte()]); return; }

        const migradas: Soporte[] = [];
        for (const s of legacy) {
          try {
            const fd = new FormData();
            fd.append('descripcion', s.descripcion || '');
            fd.append('texto', s.texto || '');
            fd.append('link', s.link || '');
            fd.append('categoria', categoriaDe(s)); // s.esTecnico es undefined en borradores viejos (localStorage previo al toggle) -> categoriaDe trata undefined como falsy -> 'otro'
            const resp = await http.upload<{ success: boolean; data?: { id: string; nombre_archivo?: string } }>(`/api/proyectos/${proyectoId}/anexos`, fd);
            migradas.push({ ...s, id: resp.data?.id || s.id, anexo: resp.data?.nombre_archivo || s.anexo, persistido: !!resp.data?.id });
          } catch {
            migradas.push({ ...s, persistido: false }); // se conserva visible aunque falle esta fila — no se descarta
          }
        }
        if (cancelled) return;
        setSoportes(migradas.length ? migradas : [nuevoSoporte()]);
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
        // El mensaje distingue "no hay sesión" (401 real del servidor) de un
        // fallo de red/CSP genérico — antes ambos mostraban el mismo texto
        // ambiguo, lo que impedía saber la causa real sin abrir la consola.
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
          setSoportes([nuevoSoporte()]);
        }
      } finally {
        if (!cancelled) setCargando(false);
      }
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  // Cache local instantánea (solo en modo sin proyecto activo — offline/demo).
  useEffect(() => {
    if (!proyectoId) localStorage.setItem(STORAGE_KEY, JSON.stringify(soportes));
  }, [soportes, proyectoId]);

  const actualizarLocal = (id: string, patch: Partial<Soporte>) =>
    setSoportes(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  // Guarda en el servidor al perder foco (onBlur) — crea la fila si aún no
  // existe (POST) o actualiza los campos narrativos si ya existe (PATCH).
  // Devuelve si la fila quedó realmente persistida — guardar() lo usa para no
  // mostrar "✓ GUARDADO" cuando en realidad falló (antes el botón confirmaba
  // éxito sin importar el resultado real de cada fila).
  const guardarEnServidor = async (id: string): Promise<boolean> => {
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
        const resp = await http.upload<{ success: boolean; data?: { id: string } }>(`/api/proyectos/${proyectoId}/anexos`, fd);
        if (resp.data?.id) actualizarLocal(id, { id: resp.data.id, persistido: true });
      }
      setErrorSync(null);
      return true;
    } catch {
      setErrorSync('No se pudo guardar un anexo — revisa tu conexión.');
      return false;
    }
  };

  // Toggle "Documento Técnico" — reclasifica de inmediato (cambia de bloque en
  // la UI) y, si la fila ya existe en el servidor, persiste la nueva categoria
  // ya mismo (no espera a un blur en otro campo).
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
    }
    // Si alguna fila falló, no se muestra "✓ GUARDADO" — el banner de
    // errorSync (arriba del encabezado) ya explica qué pasó.
  };

  // LIMPIAR — resetea el borrador visible a una sola fila en blanco. No borra
  // los anexos ya persistidos en el servidor (mismo criterio no-destructivo
  // que EntradaPage.limpiar()); para eliminar un anexo guardado se usa el
  // botón de eliminar por fila.
  const limpiar = () => {
    // Confirmación obligatoria: esto puede borrar de la vista filas que aún
    // no se guardaron en el servidor (p. ej. sin sesión válida) — sin este
    // aviso, un clic accidental hace parecer que se perdió el trabajo.
    const hayNoPersistidas = soportes.some(s => !s.persistido && (s.descripcion.trim() || s.texto.trim() || s.link.trim() || s.anexo.trim()));
    if (hayNoPersistidas && !window.confirm('Esto va a quitar de la vista los soportes que aún no se han guardado en el servidor. ¿Seguro que quieres continuar?')) {
      return;
    }
    if (!proyectoId) localStorage.removeItem(STORAGE_KEY);
    setSoportes(prev => {
      const persistidos = prev.filter(s => s.persistido);
      return persistidos.length ? persistidos : [nuevoSoporte()];
    });
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  const eliminar = async (id: string) => {
    const row = soportes.find(s => s.id === id);
    const tieneContenido = row && (row.descripcion.trim() || row.texto.trim() || row.link.trim() || row.anexo.trim());
    if (tieneContenido && !window.confirm('¿Eliminar este soporte documental? Esta acción no se puede deshacer.')) return;
    setSoportes(prev => prev.filter(s => s.id !== id));
    if (!proyectoId) { localStorage.setItem(STORAGE_KEY, JSON.stringify(soportes.filter(s => s.id !== id))); return; }
    if (row?.persistido) {
      try { await http.delete(`/api/proyectos/${proyectoId}/anexos/${id}`); }
      catch { setErrorSync('No se pudo eliminar el anexo en el servidor.'); }
    }
  };

  const tieneVacíos = () =>
    soportes.some(s => !s.descripcion.trim() && !s.texto.trim() && !s.anexo.trim() && !s.link.trim());

  const agregar = () => {
    if (tieneVacíos()) return; // bloquea si hay alguna fila completamente vacía
    setSoportes(prev => [...prev, nuevoSoporte()]);
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
    if (!proyectoId) return; // modo demo/offline — solo se guarda el nombre localmente

    const row = soportes.find(s => s.id === id);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('categoria', categoriaDe({ esTecnico: !!row?.esTecnico, anexo: f.name }));
      fd.append('descripcion', row?.descripcion || '');
      fd.append('texto', row?.texto || '');
      fd.append('link', row?.link || '');
      const resp = await http.upload<{ success: boolean; data?: { id: string; nombre_archivo: string }; message?: string }>(
        `/api/proyectos/${proyectoId}/anexos`, fd
      );
      if (resp.data) actualizarLocal(id, { id: resp.data.id, anexo: resp.data.nombre_archivo, persistido: true, subiendo: false });
      setErrorSync(null);
    } catch {
      actualizarLocal(id, { subiendo: false });
      setErrorSync('No se pudo subir el archivo — inténtalo de nuevo.');
    }
  };

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
            <span className="anx__th anx__th--center">TÉCNICO</span>
            <span className="anx__th" />
          </div>
        </div>

        <div className="anx__content">
        <div className="anx__table-scroll">
          <div className="anx__table">
            {[
              { key: 'tecnico', icono: '📁', titulo: 'Documentos Técnicos', items: soportes.filter(s => s.esTecnico) },
              { key: 'general', icono: '📁', titulo: 'Anexos Generales', items: soportes.filter(s => !s.esTecnico) },
            ].map(bloque => (
              <div key={bloque.key} className="anx__bloque">
                <div className="anx__bloquehead">
                  <span className="anx__bloquehead-icon">{bloque.icono}</span>
                  <span className="anx__bloquehead-title">{bloque.titulo}</span>
                  <span className="anx__count">{bloque.items.length}</span>
                </div>
                {bloque.items.length === 0 && (
                  <div className="anx__bloque-empty">Sin soportes en esta categoría todavía.</div>
                )}
                {bloque.items.map((s, idx) => (
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
                      <button className="anx__attach-btn" title={s.subiendo ? 'Subiendo…' : 'Adjuntar anexo'} disabled={s.subiendo} onClick={() => adjuntar(s.id)}>
                        {s.subiendo
                          ? <span style={{ fontSize: 10, fontWeight: 700 }}>…</span>
                          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}
                      </button>
                    </div>
                  </div>
                  <div className="anx__td">
                    <input className="anx__input anx__input--center" placeholder="WWW" value={s.link}
                      onChange={e => actualizar(s.id, { link: e.target.value })}
                      onBlur={() => guardarEnServidor(s.id)} />
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
              </div>
            ))}
          </div>
        </div>
        {/* Footer Action */}
        <div className="anx__footer">
          <button
            className="anx__add"
            onClick={agregar}
            disabled={tieneVacíos()}
            title={tieneVacíos() ? 'Completa al menos un campo del soporte actual antes de agregar otro' : undefined}
            style={{ opacity: tieneVacíos() ? 0.4 : 1, cursor: tieneVacíos() ? 'not-allowed' : 'pointer' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Agregar nuevo soporte documental
          </button>
        </div>
        </div>
      </div>
    </main>
  );
}
