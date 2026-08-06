import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { http, ApiError } from '../lib/apiClient';

interface UsuarioAdmin {
  id: string;
  email: string;
  nombre: string;
  role: string;
  is_active: boolean;
  is_approved: boolean;
  created_at: string;
  plan: string;
  access_radar: boolean;
  access_formulador: boolean;
  expires_at: string | null;
}

// datetime-local es timezone-naive (hora local del navegador) — conversión
// explícita hacia/desde ISO para no desalinear la fecha mostrada vs. la real.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromDatetimeLocal(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function AdminPermisosPage() {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [filtro, setFiltro]     = useState('');
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [okId, setOkId] = useState<string | null>(null);

  const cargar = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await http.get<{ success: boolean; data: UsuarioAdmin[]; message?: string }>('/api/admin/usuarios');
      setUsuarios(resp.data || []);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'Esta sección requiere una cuenta administradora.'
        : 'No se pudo cargar la lista de usuarios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter(u => u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [usuarios, filtro]);

  function actualizarCampo(id: string, cambios: Partial<UsuarioAdmin>) {
    setUsuarios(prev => prev.map(u => (u.id === id ? { ...u, ...cambios } : u)));
  }

  async function guardar(u: UsuarioAdmin) {
    setGuardandoId(u.id);
    setError(null);
    setOkId(null);
    try {
      await http.patch(`/api/admin/usuarios/${u.id}/permisos`, {
        access_radar: u.access_radar,
        access_formulador: u.access_formulador,
        expires_at: u.expires_at,
        is_active: u.is_active,
      });
      setOkId(u.id);
      setTimeout(() => setOkId(id => (id === u.id ? null : id)), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar — inténtalo de nuevo.');
    } finally {
      setGuardandoId(null);
    }
  }

  async function purgar(u: UsuarioAdmin) {
    if (!window.confirm(`Esto elimina PERMANENTEMENTE la cuenta de ${u.nombre} (${u.email}) y todos sus proyectos — Habeas Data, no reversible. ¿Continuar?`)) return;
    setGuardandoId(u.id);
    setError(null);
    try {
      await http.delete(`/api/usuarios/${u.id}/purgar`);
      setUsuarios(prev => prev.filter(x => x.id !== u.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo purgar la cuenta.');
    } finally {
      setGuardandoId(null);
    }
  }

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO');
  };

  return (
    <div style={{ minHeight: '100%', background: '#f7f9fb' }}>
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Matriz de permisos y membresías</h1>
        <Link to="/admin/usuarios-pendientes" style={{ fontSize: 12, color: '#0058be', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Ir a Usuarios pendientes →
        </Link>
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Acceso a módulos, vigencia de membresía y bloqueo de cuenta — se aplica de inmediato, incluso a sesiones ya activas.
      </p>

      <input
        value={filtro}
        onChange={e => setFiltro(e.target.value)}
        placeholder="Filtrar por nombre o correo…"
        style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', marginBottom: 16, boxSizing: 'border-box' }}
      />

      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Cargando…</p>
      ) : visibles.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>Sin resultados.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibles.map(u => {
            const esAdmin = u.role === 'admin';
            return (
              <div key={u.id} style={{ padding: '14px 16px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {u.nombre} {esAdmin && <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', marginLeft: 6 }}>ADMIN</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#6b7280' }}>{u.email}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Registrado: {fmt(u.created_at)}</div>
                  </div>
                  <button
                    onClick={() => guardar(u)}
                    disabled={guardandoId === u.id}
                    style={{
                      padding: '8px 16px', borderRadius: 6, border: 'none', flexShrink: 0,
                      background: okId === u.id ? '#15803d' : '#0058be', color: '#fff',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: guardandoId === u.id ? 0.5 : 1,
                    }}
                  >
                    {guardandoId === u.id ? 'Guardando…' : okId === u.id ? '✓ Guardado' : 'Guardar'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, paddingTop: 10, borderTop: '1px solid #f1f3f5' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: esAdmin ? 'default' : 'pointer', opacity: esAdmin ? 0.5 : 1 }}>
                    <input
                      type="checkbox"
                      checked={esAdmin ? true : u.access_radar}
                      disabled={esAdmin}
                      onChange={e => actualizarCampo(u.id, { access_radar: e.target.checked })}
                    />
                    Módulo Radar
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: esAdmin ? 'default' : 'pointer', opacity: esAdmin ? 0.5 : 1 }}>
                    <input
                      type="checkbox"
                      checked={esAdmin ? true : u.access_formulador}
                      disabled={esAdmin}
                      onChange={e => actualizarCampo(u.id, { access_formulador: e.target.checked })}
                    />
                    Módulo Formulador
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, opacity: esAdmin ? 0.5 : 1 }}>
                    Expira:
                    <input
                      type="datetime-local"
                      disabled={esAdmin}
                      value={toDatetimeLocal(u.expires_at)}
                      onChange={e => actualizarCampo(u.id, { expires_at: fromDatetimeLocal(e.target.value) })}
                      style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none' }}
                    />
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, marginLeft: 'auto', cursor: 'pointer', color: u.is_active ? '#15803d' : '#b91c1c' }}>
                    <input
                      type="checkbox"
                      checked={u.is_active}
                      onChange={e => actualizarCampo(u.id, { is_active: e.target.checked })}
                    />
                    {u.is_active ? 'Acceso habilitado' : 'Acceso bloqueado'}
                  </label>
                </div>
                {esAdmin && (
                  <p style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 8, marginBottom: 0, fontStyle: 'italic' }}>
                    Los administradores ya tienen acceso total a todos los módulos y no expiran — solo el interruptor de acceso aplica.
                  </p>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f3f5' }}>
                  <button
                    onClick={() => purgar(u)}
                    disabled={guardandoId === u.id}
                    title="Habeas Data — borrado permanente de la cuenta y sus proyectos"
                    style={{
                      padding: '6px 12px', borderRadius: 6, border: '1px solid #fca5a5',
                      background: '#fff', color: '#b91c1c', fontSize: 11, fontWeight: 700,
                      cursor: 'pointer', opacity: guardandoId === u.id ? 0.5 : 1,
                    }}
                  >
                    Purgar cuenta (Habeas Data)
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}
