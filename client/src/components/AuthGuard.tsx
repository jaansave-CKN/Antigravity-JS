import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

// ── Tipos de protección disponibles ──────────────────────────────────────────
type AuthMode =
  | 'public-demo'   // Demo automático si no hay sesión. Sin chequeo de credenciales.
  | 'normal'        // Demo + chequeo de credenciales (comportamiento original).
  | 'require-auth'; // JWT real obligatorio. Redirige a /login si falta.

// ── Spinner compartido ────────────────────────────────────────────────────────
function Spinner({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: 'calc(100vh - 48px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f7f9fb',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 28, height: 28,
          border: '3px solid #c6c6cd', borderTopColor: '#0058be',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 13, color: '#76777d', fontFamily: 'monospace' }}>{message}</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/**
 * AuthGuard — guarda de rutas con tres modos:
 *
 * 'public-demo'  → / y /radar: acceso libre con demo mode automático.
 *                  No redirige a /apis aunque falten credenciales.
 *
 * 'normal'       → /importar, /settings, /apis: demo mode + chequeo de credenciales.
 *
 * 'require-auth' → /favoritos, /calendario: requiere JWT real (no demo-mode-token).
 *                  Sin auth válida → redirige a /login con estado de retorno.
 */
export default function AuthGuard({
  children,
  mode = 'normal',
}: {
  children: React.ReactNode;
  mode?: AuthMode;
}) {
  const { isAuthenticated, loading, hasCredentials, enterDemoMode, token } = useAuth();
  const [credTimedOut, setCredTimedOut] = React.useState(false);
  const loc = window.location.pathname;

  // FIX (2026-08-22 — "le oprimo el botón y se resetea y cambia el correo"):
  // un 401 real (sesión expirada/revocada, ej. al usar "Generar con AI")
  // limpiaba la sesión (AuthContextNew.tsx → clearSession) y este guard,
  // en rutas 'public-demo'/'normal' (todo el Formulador — Pilar B), entraba
  // a modo demo automáticamente igual que un visitante anónimo nuevo: la
  // cuenta real desaparecía y el usuario quedaba operando como
  // demo@radar.com sin ningún aviso. AuthContextNew.tsx ya marca
  // sessionStorage.rf360_session_expired exactamente en ese caso (hoy solo
  // lo consume LoginPage) — se usa aquí para distinguir "sesión real que
  // acaba de expirar" (→ pedir login de nuevo) de "visitante nuevo sin
  // sesión" (→ sigue entrando a modo demo sin fricción, sin cambios).
  const sesionRealExpiro = mode !== 'require-auth' && !!sessionStorage.getItem('rf360_session_expired');

  // Todos los hooks antes de cualquier retorno condicional (regla de hooks:
  // sesionRealExpiro NUNCA debe saltarse un hook — antes rompía esto con un
  // "Rendered fewer hooks than expected" real, confirmado en consola).
  React.useEffect(() => {
    if (mode !== 'require-auth' && !sesionRealExpiro && !loading && !isAuthenticated) {
      enterDemoMode();
    }
  }, [mode, sesionRealExpiro, loading, isAuthenticated, enterDemoMode]);

  React.useEffect(() => {
    if (mode !== 'normal') return;
    if (hasCredentials !== null) { setCredTimedOut(false); return; }
    const t = setTimeout(() => setCredTimedOut(true), 5_000);
    return () => clearTimeout(t);
  }, [mode, hasCredentials]);

  if (sesionRealExpiro) {
    return (
      <Navigate
        to="/login"
        state={{ from: { pathname: loc }, reason: 'session-expired' }}
        replace
      />
    );
  }

  // ── require-auth: Formulador y rutas de pago ─────────────────────────────
  if (mode === 'require-auth') {
    if (loading) return <Spinner message="Verificando acceso…" />;
    if (!isAuthenticated || !token || token === 'demo-mode-token') {
      return (
        <Navigate
          to="/login"
          state={{ from: { pathname: loc }, reason: 'requires-auth' }}
          replace
        />
      );
    }
    return <>{children}</>;
  }

  // ── public-demo: Inicio y Radar (acceso libre) ───────────────────────────
  if (mode === 'public-demo') {
    if (loading || !isAuthenticated) return <Spinner message="Cargando…" />;
    return <>{children}</>;
  }

  // ── normal: rutas de gestión interna con credential check ────────────────
  if (loading || !isAuthenticated) return <Spinner message="Verificando acceso…" />;
  if (hasCredentials === null && !credTimedOut) return <Spinner message="Comprobando suscripción…" />;
  if ((hasCredentials === false || credTimedOut) && loc !== '/apis') {
    return <Navigate to="/apis" replace />;
  }
  return <>{children}</>;
}
