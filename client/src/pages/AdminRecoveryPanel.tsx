import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContextNew';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Users, Folder, FileText } from 'lucide-react';
import './AdminRecoveryPanel.css';

interface DeletedItem {
  id: string;
  tipo?: string;
  nombre?: string;
  titulo?: string;
  email?: string;
  descripcion?: string;
  estado?: string;
  created_at?: string;
  deleted_at?: string;
  usuario_id?: string;
}

interface DeletedData {
  usuarios: DeletedItem[];
  proyectos: DeletedItem[];
  convocatorias: DeletedItem[];
}

export default function AdminRecoveryPanel() {
  const { user } = useAuth();
  const [data, setData] = useState<DeletedData>({ usuarios: [], proyectos: [], convocatorias: [] });
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const esAdmin = user?.role === 'admin';

  const fetchData = async () => {
    if (!esAdmin) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/admin/deleted', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setData(result);
      } else {
        setMessage({ type: 'error', text: result.message || 'Error cargando datos' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleRestore = async (tipo: 'usuario' | 'proyecto' | 'convocatoria', id: string) => {
    setRestoring(`${tipo}-${id}`);
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/admin/restore/${tipo}/${id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setMessage({ type: 'success', text: result.message });
        fetchData();
      } else {
        setMessage({ type: 'error', text: result.message || 'Error restaurando' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de conexión' });
    } finally {
      setRestoring(null);
    }
  };

  if (!esAdmin) {
    return (
      <div className="recovery-panel recovery-panel--denied">
        <AlertCircle size={48} />
        <h2>Acceso Denegado</h2>
        <p>Este panel es exclusivo para administradores.</p>
      </div>
    );
  }

  const totalItems = data.usuarios.length + data.proyectos.length + data.convocatorias.length;

  return (
    <div className="recovery-panel">
      <div className="recovery-panel__header">
        <h1>Panel de Soporte y Recuperación</h1>
        <div className="recovery-panel__stats">
          <span className="recovery-panel__badge">{totalItems} elementos eliminados</span>
        </div>
        <button onClick={fetchData} disabled={loading} className="recovery-panel__btn">
          <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          Actualizar
        </button>
      </div>

      {message && (
        <div className={`recovery-panel__alert recovery-panel__alert--${message.type}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          {message.text}
        </div>
      )}

      <div className="recovery-panel__section">
        <h2><Users size={20} /> Usuarios Eliminados ({data.usuarios.length})</h2>
        {data.usuarios.length === 0 ? (
          <p className="recovery-panel__empty">No hay usuarios eliminados</p>
        ) : (
          <table className="recovery-panel__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Email</th>
                <th>Nombre</th>
                <th>Eliminado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {data.usuarios.map(u => (
                <tr key={u.id}>
                  <td>{u.id.slice(0, 8)}...</td>
                  <td>{u.email}</td>
                  <td>{u.nombre}</td>
                  <td>{u.deleted_at ? new Date(u.deleted_at).toLocaleDateString() : 'Inactivo'}</td>
                  <td>
                    <button
                      onClick={() => handleRestore('usuario', u.id)}
                      disabled={restoring === `usuario-${u.id}`}
                      className="recovery-panel__btn recovery-panel__btn--restore"
                    >
                      {restoring === `usuario-${u.id}` ? 'Restaurando...' : 'Restaurar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="recovery-panel__section">
        <h2><Folder size={20} /> Proyectos Eliminados ({data.proyectos.length})</h2>
        {data.proyectos.length === 0 ? (
          <p className="recovery-panel__empty">No hay proyectos eliminados</p>
        ) : (
          <table className="recovery-panel__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Eliminado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {data.proyectos.map(p => (
                <tr key={p.id}>
                  <td>{p.id.slice(0, 8)}...</td>
                  <td>{p.nombre}</td>
                  <td>{p.descripcion?.slice(0, 50)}...</td>
                  <td>{p.deleted_at ? new Date(p.deleted_at).toLocaleDateString() : p.estado}</td>
                  <td>
                    <button
                      onClick={() => handleRestore('proyecto', p.id)}
                      disabled={restoring === `proyecto-${p.id}`}
                      className="recovery-panel__btn recovery-panel__btn--restore"
                    >
                      {restoring === `proyecto-${p.id}` ? 'Restaurando...' : 'Restaurar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="recovery-panel__section">
        <h2><FileText size={20} /> Convocatorias Eliminadas ({data.convocatorias.length})</h2>
        {data.convocatorias.length === 0 ? (
          <p className="recovery-panel__empty">No hay convocatorias eliminadas</p>
        ) : (
          <table className="recovery-panel__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Título</th>
                <th>Estado</th>
                <th>Eliminado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {data.convocatorias.map(c => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.titulo?.slice(0, 50)}...</td>
                  <td>{c.estado}</td>
                  <td>{c.deleted_at ? new Date(c.deleted_at).toLocaleDateString() : '-'}</td>
                  <td>
                    <button
                      onClick={() => handleRestore('convocatoria', c.id)}
                      disabled={restoring === `convocatoria-${c.id}`}
                      className="recovery-panel__btn recovery-panel__btn--restore"
                    >
                      {restoring === `convocatoria-${c.id}` ? 'Restaurando...' : 'Restaurar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}