/**
 * MatrizRaciPage — 4 pestañas internas (2026-08-23, pedido explícito con
 * captura de referencia: plantilla Excel "Matriz de Responsabilidades RACI").
 * Sin diseño Stitch propio todavía — reutiliza los mismos tokens de
 * FichaTecnicaPage.tsx para el cuerpo, y replica la barra oscura de
 * pestañas de la captura de referencia para la navegación interna.
 *
 * REGISTROS/MATRIZ/RESUMEN con backend real (2026-08-24) — diseño de esquema
 * (raci_tareas/raci_roles/raci_asignaciones) y contrato de endpoints
 * revisado por el subagente architect antes de escribir código. FILAS =
 * tareas/actividades del proyecto (Registros), COLUMNAS = roles/personas del
 * proyecto (también Registros), CELDA = sigla R/A/C/I/V/IA (Matriz). Resumen
 * consume el cálculo de validación real del backend (nunca reimplementado
 * aquí — ver backend/services/raciService.js).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { http } from '../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

// FIX (2026-08-24, "salto visual" del botón SAVE al cambiar de ventana):
// 'Manrope' nunca se cargó en la app (ni en index.html ni en ningún .css) —
// caía al sans-serif genérico del sistema, con métricas de line-height
// distintas a 'Public Sans' (la fuente real de las otras 6 ventanas),
// desplazando la altura real del botón dentro de la barra de 72px aunque el
// padding fuera idéntico. Ahora Public Sans se carga global en index.html.
const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.50)',
  primary: '#0058be', primarySoft: 'rgba(0,88,190,0.08)',
  error: '#ba1a1a', success: '#15803d',
  font: "'Public Sans', sans-serif",
};

type TabId = 'registros' | 'atribuciones' | 'matriz' | 'resumen';
const TABS: { id: TabId; label: string }[] = [
  { id: 'registros',    label: 'REGISTROS' },
  { id: 'atribuciones', label: 'ATRIBUCIONES' },
  { id: 'matriz',       label: 'MATRIZ RACI' },
  { id: 'resumen',      label: 'RESUMEN RACI' },
];

// Transcrito literal de la captura de referencia (plantilla Excel RACI) —
// color de cada sigla tomado del mismo badge de la imagen.
const ROLES_RACI = [
  {
    sigla: 'R', color: '#22c55e', nombre: 'Responsable',
    corta: 'Responsable de completar la tarea o entregable',
    larga: 'Este rol corresponde a quien efectivamente realiza la tarea. Lo más habitual es que exista sólo un encargado (R) por cada tarea.',
  },
  {
    sigla: 'A', color: '#1e3a5f', nombre: 'Aprovador',
    corta: 'Aprueba la tarea o entregable',
    larga: 'Aprueba la tarea o entregable. Se responsabiliza de que la tarea se realice y es el que debe rendir cuentas sobre su ejecución. Sólo puede existir una persona que deba rendir cuentas (A) de que la tarea sea ejecutada por su Responsable (R).',
  },
  {
    sigla: 'C', color: '#eab308', nombre: 'Consultado',
    corta: 'Asesor o experto a quien se consulta antes de una acción o decisión.',
    larga: 'Asesor o experto a quien se consulta antes de una acción o decisión.',
  },
  {
    sigla: 'I', color: '#dc2626', nombre: 'Informado',
    corta: 'Debe ser informado después de una decisión o acción.',
    larga: 'Debe ser informado después de una decisión o acción. Este rol debe ser informado sobre el avance y los resultados de la ejecución de la tarea. A diferencia del consultado (C), la comunicación es unidireccional.',
  },
  {
    sigla: 'V', color: '#38bdf8', nombre: 'Verificador',
    corta: 'Comprueba si el producto concuerda con los criterios de aceptación.',
    larga: 'Este rol se encarga de comprobar si el producto concuerda con los criterios de aceptación establecidos en la descripción del producto.',
  },
  {
    sigla: 'IA', color: '#94a3b8', nombre: 'Autorizador',
    corta: 'Aprueba las decisiones de V y autoriza la salida del producto.',
    larga: 'Este rol aprueba las decisiones de V y autoriza la salida del producto. Lo lógico es que el trabajo de un S preceda siempre al de un A.',
  },
];

function Badge({ sigla, color }: { sigla: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 24, borderRadius: 4, background: color,
      color: '#ffffff', fontSize: 12, fontWeight: 800, flexShrink: 0,
    }}>
      {sigla}
    </span>
  );
}

function TabAtribuciones() {
  return (
    <div style={{ padding: '28px 32px' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800, color: '#5f6b7a', letterSpacing: '0.02em' }}>
        SIGLAS Y ATRIBUCIONES DE LA MATRIZ
      </h2>
      <div style={{ width: 260, height: 2, background: '#2b6f77', marginBottom: 24 }} />

      {/* Bloque 1 — descripción corta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 32 }}>
        {ROLES_RACI.map(r => (
          <div key={r.sigla} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Badge sigla={r.sigla} color={r.color} />
            <span style={{ width: 110, flexShrink: 0, fontSize: 13, fontWeight: 700, color: r.color === '#94a3b8' ? '#5f6b7a' : r.color }}>{r.nombre}</span>
            <span style={{ fontSize: 13, color: T.text }}>{r.corta}</span>
          </div>
        ))}
      </div>

      {/* Bloque 2 — descripción extendida */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {ROLES_RACI.map(r => (
          <div key={r.sigla} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <Badge sigla={r.sigla} color={r.color} />
            <span style={{ width: 110, flexShrink: 0, fontSize: 13, fontWeight: 700, color: r.color === '#94a3b8' ? '#5f6b7a' : r.color, paddingTop: 2 }}>{r.nombre}</span>
            <span style={{ fontSize: 13, color: T.text, lineHeight: 1.5, fontWeight: 600 }}>{r.larga}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Datos reales (2026-08-24) ────────────────────────────────────────────────
interface Tarea { id: string; nombre: string; descripcion: string; orden: number }
interface Rol { id: string; nombre: string; orden: number }
interface Asignacion { tarea_id: string; rol_id: string; sigla: string }
interface MatrizResp { tareas: Tarea[]; roles: Rol[]; asignaciones: Asignacion[] }
interface ResumenRaci {
  totalTareas: number; totalRoles: number; totalAsignaciones: number; celdasPosibles: number;
  porcentajeCompletitud: number;
  tareasSinA: { id: string; nombre: string }[];
  tareasConMultiplesA: { id: string; nombre: string }[];
  tareasSinR: { id: string; nombre: string }[];
  rolesSinAsignacion: { id: string; nombre: string }[];
}

const SIGLA_COLOR: Record<string, string> = Object.fromEntries(ROLES_RACI.map(r => [r.sigla, r.color]));

function SinProyecto() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <p style={{ fontSize: 13, color: T.textMuted }}>No hay un proyecto activo — completa el módulo Entrada primero.</p>
    </div>
  );
}

function TabRegistros({ proyectoId, tareas, roles, onChange }: { proyectoId: string; tareas: Tarea[]; roles: Rol[]; onChange: () => void }) {
  const [nuevaTarea, setNuevaTarea] = useState('');
  const [nuevoRol, setNuevoRol] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): ninguna de las dos acciones revisaba `guardando` antes de
  // proceder — guarda compartida, igual que comparten el estado `guardando`.
  const guardandoRef = useRef(false);

  const agregarTarea = async () => {
    const nombre = nuevaTarea.trim();
    if (!nombre || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await http.post(`/api/proyectos/${proyectoId}/raci/tareas`, { nombre, descripcion: '', orden: tareas.length });
      setNuevaTarea('');
      onChange();
    } catch { setError('No se pudo agregar la tarea.'); }
    finally { guardandoRef.current = false; setGuardando(false); }
  };

  const agregarRol = async () => {
    const nombre = nuevoRol.trim();
    if (!nombre || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      await http.post(`/api/proyectos/${proyectoId}/raci/roles`, { nombre, orden: roles.length });
      setNuevoRol('');
      onChange();
    } catch { setError('No se pudo agregar el rol.'); }
    finally { guardandoRef.current = false; setGuardando(false); }
  };

  const borrarTarea = async (id: string) => {
    if (!confirm('¿Eliminar esta tarea? También se borran sus asignaciones en la Matriz.')) return;
    try { await http.delete(`/api/proyectos/${proyectoId}/raci/tareas/${id}`); onChange(); }
    catch { setError('No se pudo eliminar la tarea.'); }
  };

  const borrarRol = async (id: string) => {
    if (!confirm('¿Eliminar este rol? También se borran sus asignaciones en la Matriz.')) return;
    try { await http.delete(`/api/proyectos/${proyectoId}/raci/roles/${id}`); onChange(); }
    catch { setError('No se pudo eliminar el rol.'); }
  };

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 900 }}>
      {error && <div style={{ background: 'rgba(186,26,26,0.08)', border: `1px solid ${T.error}55`, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: T.error }}>{error}</div>}

      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: '#5f6b7a' }}>TAREAS / ACTIVIDADES (filas de la matriz)</h2>
        <div style={{ width: 220, height: 2, background: '#2b6f77', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            value={nuevaTarea}
            onChange={e => setNuevaTarea(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && agregarTarea()}
            placeholder="Nombre de la tarea/actividad…"
            aria-label="Nombre de la tarea o actividad"
            style={{ flex: 1, padding: '9px 12px', border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontFamily: T.font }}
          />
          <button onClick={agregarTarea} disabled={guardando || !nuevaTarea.trim()} style={{ padding: '9px 16px', background: T.primary, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: guardando ? 0.6 : 1 }}>+ Agregar</button>
        </div>
        {tareas.length === 0 ? (
          <p style={{ fontSize: 12.5, color: T.textMuted, fontStyle: 'italic' }}>Sin tareas registradas.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tareas.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 12px' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{t.nombre}</span>
                <button onClick={() => borrarTarea(t.id)} style={{ background: 'none', border: 'none', color: T.error, cursor: 'pointer', fontSize: 15 }} title="Eliminar">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: '#5f6b7a' }}>ROLES / PERSONAS (columnas de la matriz)</h2>
        <div style={{ width: 220, height: 2, background: '#2b6f77', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            value={nuevoRol}
            onChange={e => setNuevoRol(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && agregarRol()}
            placeholder="Nombre del rol o persona…"
            aria-label="Nombre del rol o persona"
            style={{ flex: 1, padding: '9px 12px', border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 13, fontFamily: T.font }}
          />
          <button onClick={agregarRol} disabled={guardando || !nuevoRol.trim()} style={{ padding: '9px 16px', background: T.primary, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', opacity: guardando ? 0.6 : 1 }}>+ Agregar</button>
        </div>
        {roles.length === 0 ? (
          <p style={{ fontSize: 12.5, color: T.textMuted, fontStyle: 'italic' }}>Sin roles registrados.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {roles.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 12px' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{r.nombre}</span>
                <button onClick={() => borrarRol(r.id)} style={{ background: 'none', border: 'none', color: T.error, cursor: 'pointer', fontSize: 15 }} title="Eliminar">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabMatriz({ proyectoId, tareas, roles, asignaciones, onChange }: { proyectoId: string; tareas: Tarea[]; roles: Rol[]; asignaciones: Asignacion[]; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const mapa = new Map(asignaciones.map(a => [`${a.tarea_id}::${a.rol_id}`, a.sigla]));

  const cambiarCelda = async (tareaId: string, rolId: string, sigla: string) => {
    setError(null);
    try {
      await http.put(`/api/proyectos/${proyectoId}/raci/asignaciones/${tareaId}/${rolId}`, { sigla: sigla || null });
      onChange();
    } catch { setError('No se pudo guardar la celda.'); }
  };

  if (tareas.length === 0 || roles.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <p style={{ fontSize: 13, color: T.textMuted, textAlign: 'center', maxWidth: 360 }}>
          Agrega al menos 1 tarea y 1 rol en la pestaña REGISTROS para poder cruzarlos en la matriz.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', overflowX: 'auto' }}>
      {error && <div style={{ marginBottom: 12, background: 'rgba(186,26,26,0.08)', border: `1px solid ${T.error}55`, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: T.error }}>{error}</div>}
      <table style={{ borderCollapse: 'collapse', minWidth: 480 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: T.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${T.border}` }}>Tarea / Rol</th>
            {roles.map(r => (
              <th key={r.id} style={{ padding: '8px 10px', fontSize: 11.5, fontWeight: 700, color: T.text, borderBottom: `2px solid ${T.border}`, minWidth: 90 }}>{r.nombre}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tareas.map(t => (
            <tr key={t.id}>
              <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{t.nombre}</td>
              {roles.map(r => {
                const sigla = mapa.get(`${t.id}::${r.id}`) || '';
                return (
                  <td key={r.id} style={{ padding: '6px', borderBottom: `1px solid ${T.border}`, textAlign: 'center' }}>
                    <select
                      value={sigla}
                      onChange={e => cambiarCelda(t.id, r.id, e.target.value)}
                      style={{
                        width: 56, padding: '5px 4px', borderRadius: 4, fontSize: 12, fontWeight: 800, textAlign: 'center',
                        border: `1.5px solid ${sigla ? SIGLA_COLOR[sigla] : T.border}`,
                        color: sigla ? '#fff' : T.textMuted,
                        background: sigla ? SIGLA_COLOR[sigla] : '#fff',
                      }}
                    >
                      <option value="">—</option>
                      {ROLES_RACI.map(rr => <option key={rr.sigla} value={rr.sigla}>{rr.sigla}</option>)}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListaAlerta({ titulo, items, vacio }: { titulo: string; items: { id: string; nombre: string }[]; vacio: string }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 20px' }}>
      <p style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 800, color: items.length ? T.error : '#15803d' }}>{titulo} ({items.length})</p>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: T.textMuted, fontStyle: 'italic' }}>{vacio}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: T.text }}>
          {items.map(i => <li key={i.id}>{i.nombre}</li>)}
        </ul>
      )}
    </div>
  );
}

function TabResumen({ proyectoId }: { proyectoId: string }) {
  const [resumen, setResumen] = useState<ResumenRaci | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await http.get<{ success: boolean; data?: ResumenRaci }>(`/api/proyectos/${proyectoId}/raci/resumen`);
        if (!cancelled) setResumen(body.data || null);
      } catch { /* deja resumen null, se muestra el estado vacío */ }
      finally { if (!cancelled) setCargando(false); }
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  if (cargando) return <div style={{ padding: 32 }}><p style={{ fontSize: 13, color: T.textMuted }}>Calculando resumen…</p></div>;
  if (!resumen) return <div style={{ padding: 32 }}><p style={{ fontSize: 13, color: T.error }}>No se pudo cargar el resumen.</p></div>;

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ background: T.primarySoft, border: `1px solid ${T.primary}33`, borderRadius: 10, padding: '14px 20px', flex: 1, minWidth: 160 }}>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: T.primary }}>{resumen.porcentajeCompletitud}%</p>
          <p style={{ margin: 0, fontSize: 11.5, color: T.textMuted }}>Celdas completas ({resumen.totalAsignaciones} de {resumen.celdasPosibles})</p>
        </div>
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 20px', flex: 1, minWidth: 160 }}>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: T.text }}>{resumen.totalTareas}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: T.textMuted }}>Tareas registradas</p>
        </div>
        <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 20px', flex: 1, minWidth: 160 }}>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: T.text }}>{resumen.totalRoles}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: T.textMuted }}>Roles registrados</p>
        </div>
      </div>

      <ListaAlerta titulo="Tareas sin Aprobador (A)" items={resumen.tareasSinA} vacio="Todas las tareas tienen un Aprobador asignado." />
      <ListaAlerta titulo="Tareas con más de un Aprobador (A)" items={resumen.tareasConMultiplesA} vacio="Ninguna tarea tiene más de un Aprobador." />
      <ListaAlerta titulo="Tareas sin Responsable (R)" items={resumen.tareasSinR} vacio="Todas las tareas tienen un Responsable asignado." />
      <ListaAlerta titulo="Roles sin ninguna asignación" items={resumen.rolesSinAsignacion} vacio="Todos los roles tienen al menos una asignación." />
    </div>
  );
}

export default function MatrizRaciPage() {
  const [tab, setTab] = useState<TabId>('registros');
  const [proyectoId] = useState<string | null>(() => localStorage.getItem(ACTIVE_PROJECT_KEY));
  const [datos, setDatos] = useState<MatrizResp>({ tareas: [], roles: [], asignaciones: [] });
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!proyectoId) { setCargando(false); return; }
    try {
      const body = await http.get<{ success: boolean; data?: MatrizResp }>(`/api/proyectos/${proyectoId}/raci/matriz`);
      setDatos(body.data || { tareas: [], roles: [], asignaciones: [] });
    } catch { /* deja los datos anteriores en pantalla */ }
    finally { setCargando(false); }
  }, [proyectoId]);

  useEffect(() => { recargar(); }, [recargar]);

  // MANDATO (2026-08-24, "coloca LIMPIAR/SAVE en su misma ubicación, déjalos
  // funcional") — misma barra de 72px que .entr__topbar. Diferencia real de
  // arquitectura frente a Entrada/Contexto/etc.: aquí cada acción (agregar
  // tarea/rol, marcar una celda) ya se persiste al instante contra el
  // servidor — no existe un "borrador" pendiente que confirmar. Por eso:
  // - SAVE siempre se ve "✓ GUARDADO" (verde) — es la realidad, nunca hay
  //   nada sin guardar en este diseño — y su clic solo re-sincroniza la
  //   vista con el servidor (recargar()), útil si se editó en otra pestaña.
  // - LIMPIAR sí tiene una acción real y distinta: borra TODAS las tareas y
  //   roles del proyecto (con confirmación) — no hay "borrador en blanco"
  //   que resetear, así que limpiar significa vaciar la matriz de verdad.
  const [limpiado, setLimpiado] = useState(false);
  const [procesando, setProcesando] = useState(false);

  const limpiarTodo = async () => {
    if (!proyectoId || (datos.tareas.length === 0 && datos.roles.length === 0)) return;
    if (!window.confirm('Esto va a borrar TODAS las tareas y roles registrados en la Matriz RACI de este proyecto (y sus asignaciones). ¿Seguro que quieres continuar?')) return;
    setProcesando(true);
    try {
      await Promise.all([
        ...datos.tareas.map(t => http.delete(`/api/proyectos/${proyectoId}/raci/tareas/${t.id}`)),
        ...datos.roles.map(r => http.delete(`/api/proyectos/${proyectoId}/raci/roles/${r.id}`)),
      ]);
      await recargar();
      setLimpiado(true);
      setTimeout(() => setLimpiado(false), 2000);
    } finally {
      setProcesando(false);
    }
  };

  const guardarTodo = async () => {
    await recargar();
  };

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.font, minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Topbar — misma barra sticky de 72px que EntradaPage.tsx
          (.entr__topbar), reproducida en línea porque esta página tampoco
          tiene hoja de estilos propia (igual criterio que PresupuestoPage). */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#ffffff', borderBottom: `1px solid ${T.border}`,
        height: 72, padding: '0 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 16, flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0, color: T.text, letterSpacing: '-0.02em' }}>Matriz RACI</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button
            onClick={limpiarTodo}
            disabled={procesando || !proyectoId}
            style={{ padding: '10px 20px', background: '#fff', color: '#64748b', border: '1px solid #c6c6cd', borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', fontFamily: T.font, cursor: procesando ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: procesando ? 0.6 : 1 }}
          >
            {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
          </button>
          <button
            onClick={guardarTodo}
            disabled={procesando || !proyectoId}
            title="Cada cambio ya se guarda al instante — este botón solo sincroniza la vista con el servidor"
            style={{ padding: '10px 28px', background: T.success, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', fontFamily: T.font, cursor: procesando ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: procesando ? 0.6 : 1 }}
          >
            ✓ GUARDADO
          </button>
        </div>
      </header>

      {/* Barra de pestañas oscura — replica la captura de referencia (plantilla Excel) */}
      <div style={{ display: 'flex', background: '#12141c' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '14px 24px',
              border: 'none',
              background: tab === t.id ? '#565e6b' : 'transparent',
              color: '#ffffff',
              fontFamily: T.font,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: '0.03em',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!proyectoId ? (
          <SinProyecto />
        ) : cargando ? (
          <div style={{ padding: 32 }}><p style={{ fontSize: 13, color: T.textMuted }}>Cargando datos del proyecto…</p></div>
        ) : (
          <>
            {tab === 'registros'    && <TabRegistros proyectoId={proyectoId} tareas={datos.tareas} roles={datos.roles} onChange={recargar} />}
            {tab === 'atribuciones' && <TabAtribuciones />}
            {tab === 'matriz'       && <TabMatriz proyectoId={proyectoId} tareas={datos.tareas} roles={datos.roles} asignaciones={datos.asignaciones} onChange={recargar} />}
            {tab === 'resumen'      && <TabResumen proyectoId={proyectoId} />}
          </>
        )}
      </div>
    </div>
  );
}
