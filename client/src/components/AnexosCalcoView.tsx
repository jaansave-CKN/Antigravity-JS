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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import './AnexosCalcoView.css';
import { http } from '../lib/apiClient';

const STORAGE_KEY = 'radar360_anexos_calco';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

interface Soporte {
  id: string;
  descripcion: string;
  texto: string;
  anexo: string;
  link: string;
  persistido: boolean; // true si ya existe como fila real en project_anexos
  subiendo?: boolean;
}
interface AnexoApi {
  id: string; nombre_archivo: string; descripcion: string | null; texto: string | null; link: string | null;
}
interface AnexosApiResponse { success: boolean; data?: AnexoApi[]; message?: string }

const nuevoSoporte = (): Soporte => ({ id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`, descripcion: '', texto: '', anexo: '', link: '', persistido: false });

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
          anexo: a.nombre_archivo || '', persistido: true,
        }));
        setSoportes(rows.length ? rows : [nuevoSoporte()]);
      } catch {
        setErrorSync('No se pudieron cargar los anexos guardados.');
        setSoportes([nuevoSoporte()]);
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
  const guardarEnServidor = async (id: string) => {
    if (!proyectoId) return;
    const row = soportes.find(s => s.id === id);
    if (!row) return;
    try {
      if (row.persistido) {
        await http.patch(`/api/proyectos/${proyectoId}/anexos/${id}`, { descripcion: row.descripcion, texto: row.texto, link: row.link });
      } else if (row.descripcion.trim() || row.texto.trim() || row.link.trim()) {
        const fd = new FormData();
        fd.append('descripcion', row.descripcion);
        fd.append('texto', row.texto);
        fd.append('link', row.link);
        fd.append('categoria', 'otro');
        const resp = await http.upload<{ success: boolean; data?: { id: string } }>(`/api/proyectos/${proyectoId}/anexos`, fd);
        if (resp.data?.id) actualizarLocal(id, { id: resp.data.id, persistido: true });
      }
      setErrorSync(null);
    } catch {
      setErrorSync('No se pudo guardar un anexo — revisa tu conexión.');
    }
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
    await Promise.all(soportes.map(s => guardarEnServidor(s.id)));
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2200);
  };

  // LIMPIAR — resetea el borrador visible a una sola fila en blanco. No borra
  // los anexos ya persistidos en el servidor (mismo criterio no-destructivo
  // que EntradaPage.limpiar()); para eliminar un anexo guardado se usa el
  // botón de eliminar por fila.
  const limpiar = () => {
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
      fd.append('categoria', 'otro');
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
        {/* ── Topbar ── */}
        <header className="anx__topbar">
          <h1 className="anx__h1">Anexos</h1>
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

        <div className="anx__content">
        {(cargando || errorSync) && (
          <div style={{ padding: '8px 4px', fontSize: 12, fontWeight: 600, color: errorSync ? '#ba1a1a' : '#434655' }}>
            {errorSync || 'Cargando anexos guardados…'}
          </div>
        )}
        <div className="anx__table-scroll">
          <table className="anx__table">
            <tbody>
              {soportes.map(s => (
                <tr key={s.id} className="anx__tr">
                  <td className="anx__td anx__td--desc">
                    <div className="anx__field">
                      <label className="anx__label">DESCRIPCION</label>
                      <input className="anx__input" placeholder="Descripcion del soporte" value={s.descripcion}
                        onChange={e => actualizar(s.id, { descripcion: e.target.value })}
                        onBlur={() => guardarEnServidor(s.id)} />
                    </div>
                  </td>
                  <td className="anx__td anx__td--sm">
                    <div className="anx__field anx__field--center">
                      <label className="anx__label">TEXTO</label>
                      <input className="anx__input anx__input--center" placeholder="TEXTO" value={s.texto}
                        onChange={e => actualizar(s.id, { texto: e.target.value })}
                        onBlur={() => guardarEnServidor(s.id)} />
                    </div>
                  </td>
                  <td className="anx__td anx__td--sm">
                    <div className="anx__field anx__field--center">
                      <label className="anx__label">ANEXO.</label>
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
                  </td>
                  <td className="anx__td anx__td--sm">
                    <div className="anx__field anx__field--center">
                      <label className="anx__label">LINK</label>
                      <input className="anx__input anx__input--center" placeholder="WWW" value={s.link}
                        onChange={e => actualizar(s.id, { link: e.target.value })}
                        onBlur={() => guardarEnServidor(s.id)} />
                    </div>
                  </td>
                  <td className="anx__td anx__td--action">
                    <div className="anx__field anx__field--center">
                      <span className="anx__label-spacer" />
                      <button className="anx__delete" title="Eliminar soporte" onClick={() => eliminar(s.id)}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
