import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

/**
 * AdminGuard — protección de rutas exclusivas de administrador.
 * A diferencia de AuthGuard (solo autenticación), esto exige rol real:
 * useAuth().isAdmin ya deriva de user.role === 'admin' (AuthContextNew.tsx),
 * poblado desde `tipousuario` real del backend — nunca inventa un valor.
 *
 * PRODUCCIÓN (import.meta.env.PROD): sin excepciones — si no es admin,
 * redirige de inmediato a "/" (equivalente a un 403 del lado del cliente;
 * el backend igual rechaza cada endpoint /api/admin/* por su cuenta, esto
 * solo evita renderizar la pantalla).
 *
 * DESARROLLO (import.meta.env.DEV): un redirect silencioso a "/" sin
 * explicación hacía perder tiempo real esta sesión (verificar server.js o
 * la pestaña Network para entender por qué "no pasaba nada" al entrar a
 * /admin). En dev, si hay sesión real pero no es admin, se muestra un
 * banner visible y ADEMÁS se deja pasar — la protección real sigue siendo
 * el backend (cada /api/admin/* exige rol admin de verdad, esto no lo
 * debilita). Solo aplica con sesión real (no a un visitante sin login).
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const [avisoOculto, setAvisoOculto] = useState(false);

  if (loading) {
    return (
      <div style={{ minHeight: 'calc(100vh - 48px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f9fb' }}>
        <span style={{ fontSize: 13, color: '#6b7280', fontFamily: 'monospace' }}>Verificando permisos…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    console.warn('[AdminGuard] Acceso denegado — no hay sesión activa.');
    return <Navigate to="/" state={{ error: 'admin_required' }} replace />;
  }

  if (!isAdmin) {
    if (import.meta.env.PROD) {
      console.warn('[AdminGuard] Acceso denegado — se requiere rol admin (403).');
      return <Navigate to="/" state={{ error: 'admin_required' }} replace />;
    }
    // Paso temporal SOLO en dev — visible, no un redirect silencioso.
    return (
      <div>
        {!avisoOculto && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
            background: '#78350f', color: '#fef3c7', fontSize: 12, fontFamily: 'monospace',
          }}>
            <span>⚠ DEV: tu cuenta no tiene rol admin (tipousuario real ≠ 'admin'). Mostrando /admin de todos modos SOLO por estar en desarrollo — en producción esto redirige. Los endpoints /api/admin/* igual exigen admin real.</span>
            <button
              onClick={() => setAvisoOculto(true)}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid #fef3c7', color: '#fef3c7', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
            >
              Ocultar
            </button>
          </div>
        )}
        {children}
      </div>
    );
  }

  return <>{children}</>;
}
