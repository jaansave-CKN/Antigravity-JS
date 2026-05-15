import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, collection, getDocs, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../contexts/AuthContext';
import ProtectedRoute from '../components/ProtectedRoute';

export default function AdminUsersPage() {
  return (
    <ProtectedRoute requireAdmin>
      <AdminUsers />
    </ProtectedRoute>
  );
}

function AdminUsers() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
      setUsers(snap.docs.map(d => d.data() as UserProfile));
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  async function toggleDisabled(uid: string, current: boolean) {
    setSavingId(uid);
    try {
      await updateDoc(doc(db, 'users', uid), { disabled: !current });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, disabled: !current } : u));
    } finally {
      setSavingId(null);
    }
  }

  async function changeRole(uid: string, current: 'admin' | 'user') {
    setSavingId(uid);
    try {
      const newRole = current === 'admin' ? 'user' : 'admin';
      await updateDoc(doc(db, 'users', uid), { role: newRole });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    } finally {
      setSavingId(null);
    }
  }

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(filter.toLowerCase()) ||
    (u.displayName || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="admin-users">
      <div className="admin-users__header">
        <h2>Gestión de Usuarios</h2>
        <div className="admin-users__stats">
          <span>Total: {users.length}</span>
          <span>Activos: {users.filter(u => !u.disabled).length}</span>
          <span>Suspendidos: {users.filter(u => u.disabled).length}</span>
        </div>
      </div>

      <div className="admin-users__toolbar">
        <input
          type="search"
          placeholder="Buscar por correo o nombre..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="admin-search"
        />
      </div>

      {loading ? (
        <div className="admin-loading">Cargando usuarios...</div>
      ) : (
        <div className="admin-users__table-wrapper">
          <table className="admin-users__table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.uid} className={u.disabled ? 'row--disabled' : ''}>
                  <td>
                    <div className="user-cell">
                      <span className="user-avatar">{u.displayName?.charAt(0).toUpperCase() || '?'}</span>
                      <span>{u.displayName || 'Sin nombre'}</span>
                    </div>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge badge--${u.role}`}>{u.role === 'admin' ? 'Admin' : 'Usuario'}</span>
                  </td>
                  <td>
                    <span className={`badge ${u.disabled ? 'badge--danger' : 'badge--success'}`}>
                      {u.disabled ? 'Suspendido' : 'Activo'}
                    </span>
                  </td>
                  <td>{u.lastLogin ? new Date(u.lastLogin.seconds ? u.lastLogin.seconds * 1000 : u.lastLogin).toLocaleDateString('es-CO') : 'Nunca'}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        className={`btn btn--sm ${u.disabled ? 'btn--success' : 'btn--warning'}`}
                        onClick={() => toggleDisabled(u.uid, u.disabled)}
                        disabled={savingId === u.uid || u.uid === userProfile?.uid}
                        title={u.disabled ? 'Activar usuario' : 'Suspender usuario'}
                      >
                        {u.disabled ? 'Activar' : 'Suspender'}
                      </button>
                      <button
                        className="btn btn--sm btn--secondary"
                        onClick={() => changeRole(u.uid, u.role)}
                        disabled={savingId === u.uid || u.uid === userProfile?.uid}
                        title="Cambiar rol"
                      >
                        {u.role === 'admin' ? 'Quitar Admin' : 'Hacer Admin'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}