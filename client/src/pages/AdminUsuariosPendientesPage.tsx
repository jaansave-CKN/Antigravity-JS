import { useEffect, useState } from 'react';
import { http, ApiError } from '../lib/apiClient';

interface UsuarioPendiente {
  id: string;
  email: string;
  nombre: string;
  createdat: string;
}

export default function AdminUsuariosPendientesPage() {
  const [usuarios, setUsuarios] = useState<UsuarioPendiente[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);

  const cargar = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await http.get<{ success: boolean; data: UsuarioPendiente[]; message?: string }>('/api/admin/usuarios/pendientes');
      setUsuarios(resp.data || []);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'Esta sección requiere una cuenta administradora.'
        : 'No se pudo cargar la lista de usuarios pendientes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const aprobar = async (id: string) => {
    setProcesando(id);
    try {
      await http.post(`/api/admin/usuarios/${id}/aprobar`);
      setUsuarios(prev => prev.filter(u => u.id !== id));
    } catch {
      setError('No se pudo aprobar al usuario — inténtalo de nuevo.');
    } finally {
      setProcesando(null);
    }
  };

  const rechazar = async (id: string) => {
    if (!window.confirm('¿Rechazar este registro? La cuenta quedará desactivada.')) return;
    setProcesando(id);
    try {
      await http.post(`/api/admin/usuarios/${id}/rechazar`);
      setUsuarios(prev => prev.filter(u => u.id !== id));
    } catch {
      setError('No se pudo rechazar al usuario — inténtalo de nuevo.');
    } finally {
      setProcesando(null);
    }
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO');
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Usuarios pendientes de aprobación</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
        Verifica el pago (Nequi u otro medio) antes de aprobar. Mientras no apruebes, el usuario no puede iniciar sesión.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Cargando…</p>
      ) : usuarios.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>No hay registros pendientes.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {usuarios.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.nombre}</div>
                <div style={{ fontSize: 12.5, color: '#6b7280' }}>{u.email}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Registrado: {fmt(u.createdat)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => rechazar(u.id)}
                  disabled={procesando === u.id}
                  style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: procesando === u.id ? 0.5 : 1 }}
                >
                  Rechazar
                </button>
                <button
                  onClick={() => aprobar(u.id)}
                  disabled={procesando === u.id}
                  style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#15803d', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: procesando === u.id ? 0.5 : 1 }}
                >
                  {procesando === u.id ? 'Procesando…' : 'Aprobar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
