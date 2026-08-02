import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  nombre: string;
  role: 'admin' | 'user' | 'trial';
  plan?: string;
  created_at: string;
  last_login?: string;
  is_active: boolean;
  is_trial?: boolean;
  email_verified?: boolean;
}

export interface LoginSubscription {
  plan: string;
  access_radar: boolean;
  access_formulador: boolean;
}

export interface MfaRequiredResult {
  mfaRequired: true;
  preAuthToken: string;
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  hasCredentials: boolean | null;
  isTrialMode: boolean;
  isReconnecting: boolean;
  login: (email: string, password: string) => Promise<LoginSubscription | undefined | MfaRequiredResult>;
  completeMfaLogin: (preAuthToken: string, code: string) => Promise<LoginSubscription | undefined>;
  register: (email: string, password: string, nombre: string, role?: string) => Promise<{ pendingApproval: boolean; message?: string }>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  validateSessionAction: (password: string) => Promise<void>;
  enterDemoMode: () => void;
  startTrial: () => Promise<void>;
  refreshCredentialsStatus: () => Promise<void>;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]               = useState<UserProfile | null>(null);
  const [token, setToken]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [hasCredentials, setHasCreds] = useState<boolean | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser  = localStorage.getItem('auth_user');

    if (!storedToken) { setLoading(false); return; }

    // Token de demo local (modo sin backend)
    if (storedToken === 'demo-mode-token') {
      if (storedUser) {
        try { setUser(JSON.parse(storedUser)); setToken('demo-mode-token'); setHasCreds(false); }
        catch { clearSession(); }
      } else { clearSession(); }
      setLoading(false);
      return;
    }

    verifyTokenWithBackend(storedToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-once: verifyTokenWithBackend estabilizado con useCallback, no cambia entre renders

  // Aviso global de sesión expirada (401 real, ej. rotación de JWT_SECRET en
  // el servidor) — disparado por apiClient.ts en cualquier request de la app,
  // no solo en la pantalla donde el usuario esté parado en ese momento.
  useEffect(() => {
    function onSessionExpired() {
      sessionStorage.setItem('rf360_session_expired', '1');
      clearSession();
    }
    window.addEventListener('auth-session-expired', onSessionExpired);
    return () => window.removeEventListener('auth-session-expired', onSessionExpired);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearSession() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
    setHasCreds(null);
    setIsReconnecting(false);
  }

  function persistSession(t: string, u: UserProfile) {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('auth_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }

  const verifyTokenWithBackend = useCallback(async (storedToken: string) => { // eslint-disable-line react-hooks/exhaustive-deps
    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (!response.ok) {
        // Token rechazado. En dev, cambiar a demo-mode-token para no bloquear el trabajo local.
        if (import.meta.env.DEV) {
          const devUser = { id: 'dev-user-001', email: 'dev@antigravity.local', nombre: 'Desarrollador Local', role: 'admin' as const, plan: 'suite', created_at: new Date().toISOString(), is_active: true };
          localStorage.setItem('auth_token', 'demo-mode-token');
          localStorage.setItem('auth_user', JSON.stringify(devUser));
          setToken('demo-mode-token');
          setUser(devUser);
        } else {
          clearSession();
        }
        setLoading(false);
        return;
      }
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { clearSession(); setLoading(false); return; }
      if (data.valid && data.user) {
        setIsReconnecting(false);
        setToken(storedToken);
        setUser({
          id: data.user.id, email: data.user.email,
          nombre: data.user.nombre, role: data.user.role,
          plan: data.user.plan,
          created_at: data.user.created_at, is_active: data.user.is_active,
          email_verified: data.user.email_verified,
        });
        checkCredentials(storedToken);
      } else { clearSession(); }
    } catch (err: unknown) {
      // TypeError  = fetch() falló antes de recibir respuesta (red caída, DNS, CORS).
      // AbortError = el AbortController disparó un timeout.
      // En ambos casos el token puede ser válido — mantenemos la sesión en modo reconexión.
      // Cualquier otro error inesperado (ej. excepción en setState) → cierra sesión por seguridad.
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof DOMException && err.name === 'AbortError');

      if (isNetworkError) {
        // En dev, si el backend no estaba listo al arrancar, evitar propagar un JWT stale
        // que fallará en los endpoints cuando el backend sí esté disponible.
        if (import.meta.env.DEV) {
          const devUser = { id: 'dev-user-001', email: 'dev@antigravity.local', nombre: 'Desarrollador Local', role: 'admin' as const, plan: 'suite', created_at: new Date().toISOString(), is_active: true };
          localStorage.setItem('auth_token', 'demo-mode-token');
          localStorage.setItem('auth_user', JSON.stringify(devUser));
          setToken('demo-mode-token');
          setUser(devUser);
          console.warn('[Auth] Backend no disponible — modo dev activo con demo-mode-token');
        } else {
        const storedUser = localStorage.getItem('auth_user');
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            setToken(storedToken);
            setUser(parsed);
            setIsReconnecting(true);
            console.warn('[Auth] Backend no disponible — manteniendo sesión local (reconectando)');
          } catch { clearSession(); }
        } else { clearSession(); }
        }
      } else {
        // Error inesperado no relacionado con la red → cerrar sesión por seguridad
        console.warn('[Auth] Error inesperado en verificación de token, cerrando sesión:', err);
        clearSession();
      }
    }
    finally { setLoading(false); }
  }, []); // useCallback con deps vacías: solo usa setters de estado (referencia estable garantizada por React)

  async function checkCredentials(t: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`${API_BASE}/credentials/status`, {
        headers: { Authorization: `Bearer ${t}` },
        signal: controller.signal,
      });
      if (!r.ok) { setHasCreds(false); return; }
      const data = await r.json();
      setHasCreds(data.hasCredentials === true);
    } catch { setHasCreds(false); }
    finally { clearTimeout(timeout); }
  }

  const refreshCredentialsStatus = useCallback(async () => {
    if (token && token !== 'demo-mode-token') await checkCredentials(token);
  }, [token]);

  // ── login ──────────────────────────────────────────────────────────────────
  async function login(email: string, password: string): Promise<LoginSubscription | undefined | MfaRequiredResult> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión o intenta más tarde.');
    }
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento. Por favor intenta en unos minutos.'); }
    if (!response.ok) throw new Error(data?.message || 'Credenciales incorrectas.');

    // MFA activo en la cuenta — password correcta no basta, todavía no hay
    // sesión real hasta completar el segundo factor (ver completeMfaLogin).
    if (data?.mfaRequired && data?.preAuthToken) {
      return { mfaRequired: true, preAuthToken: data.preAuthToken };
    }

    const { token: newToken, user: userData, subscription } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
    checkCredentials(newToken);
    // Notifica a SubscriptionContext (mismo tab) para recargar sin depender de localStorage events
    window.dispatchEvent(new CustomEvent('auth-login', { detail: { token: newToken } }));
    return subscription as LoginSubscription | undefined;
  }

  // ── completeMfaLogin — segundo paso, tras login() devolver mfaRequired ───────
  async function completeMfaLogin(preAuthToken: string, code: string): Promise<LoginSubscription | undefined> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/mfa/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preAuthToken, code: code.trim() }),
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión o intenta más tarde.');
    }
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento.'); }
    if (!response.ok) throw new Error(data?.message || 'Código incorrecto.');
    const { token: newToken, user: userData, subscription } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
    checkCredentials(newToken);
    window.dispatchEvent(new CustomEvent('auth-login', { detail: { token: newToken } }));
    return subscription as LoginSubscription | undefined;
  }

  // ── Modo Trial (V8.0) — token temporal 24h, datos en sessionStorage ──────
  async function startTrial() {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/trial`, { method: 'POST' });
    } catch {
      throw new Error('No se pudo conectar con el servidor.');
    }
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error('Respuesta inválida del servidor.'); }
    if (!response.ok || !data.success) throw new Error(data?.message || 'Error al iniciar sesión trial.');
    const { token: trialToken, user: trialUser } = data;
    // Datos del trial en sessionStorage (volátiles — se pierden al cerrar la pestaña)
    sessionStorage.setItem('trial_token', trialToken);
    sessionStorage.setItem('trial_user', JSON.stringify(trialUser));
    // También persistir en auth para que el contexto lo detecte
    localStorage.setItem('auth_token', trialToken);
    localStorage.setItem('auth_user', JSON.stringify(trialUser));
    setToken(trialToken);
    setUser(trialUser);
    setHasCreds(false);
  }

  // ── Modo demo sin credenciales reales ─────────────────────────────────────
  function enterDemoMode() {
    const demoUser: UserProfile = {
      id: 'demo-user', email: 'demo@radar.com',
      nombre: 'Demo Usuario', role: 'user',
      created_at: new Date().toISOString(), is_active: true,
    };
    localStorage.setItem('auth_token', 'demo-mode-token');
    localStorage.setItem('auth_user', JSON.stringify(demoUser));
    setToken('demo-mode-token');
    setUser(demoUser);
    setHasCreds(false);
  }

  // ── register ───────────────────────────────────────────────────────────────
  async function register(email: string, password: string, nombre: string, role = 'user') {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, nombre: nombre || 'Usuario', role }),
      });
    } catch { throw new Error('No se pudo conectar con el servidor.'); }
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento.'); }
    if (!response.ok) throw new Error(data?.message || 'Error al registrarse.');
    // Registro con aprobación manual pendiente: el servidor no emite token
    // todavía — no hay sesión que abrir, solo se informa al llamador.
    if (data?.pendingApproval) return { pendingApproval: true as const, message: data.message as string };
    const { token: newToken, user: userData } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
    setHasCreds(false); // usuario nuevo nunca tiene credenciales
    return { pendingApproval: false as const };
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    // 1. Notificar al servidor ANTES de limpiar el estado local, para que
    //    pueda revocar el token y responder con Clear-Site-Data
    if (token && token !== 'demo-mode-token') {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',  // incluye cookies HTTP-only si las hay
        });
      } catch { /* red caída — la sesión del cliente se limpia de todas formas */ }
    }

    // 2. Limpieza selectiva de localStorage (solo claves de sesión conocidas)
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('trial_token');
    localStorage.removeItem('trial_user');

    // 3. Purgar sessionStorage completo (trial tokens volátiles + cualquier dato de sesión)
    sessionStorage.clear();

    // 4. Sincronizar estado React
    clearSession();
  }

  // ── updateProfile ──────────────────────────────────────────────────────────
  async function updateProfile(data: Partial<UserProfile>) {
    if (!token) return;
    if (token === 'demo-mode-token') {
      const updated = user ? { ...user, ...data } : null;
      if (updated) { setUser(updated); localStorage.setItem('auth_user', JSON.stringify(updated)); }
      return;
    }
    const response = await fetch(`${API_BASE}/auth/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Error al actualizar perfil.');
    setUser(prev => prev ? { ...prev, ...data } : null);
  }

  // ── changePassword ─────────────────────────────────────────────────────────
  async function changePassword(oldPassword: string, newPassword: string) {
    if (!token || token === 'demo-mode-token') return;
    const response = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error('Error al cambiar la contraseña.'); }
    if (!response.ok) throw new Error(data?.message || 'Error al cambiar la contraseña.');
  }

  // ── sendPasswordReset ──────────────────────────────────────────────────────
  async function sendPasswordReset(email: string) {
    try {
      await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {}
  }

  // ── validateSessionAction ──────────────────────────────────────────────────
  async function validateSessionAction(password: string) {
    if (!token) throw new Error('SESIÓN NO ACTIVA.');
    if (token === 'demo-mode-token') return; // modo demo: acepta cualquier pwd
    const response = await fetch(`${API_BASE}/auth/validate-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message ?? 'CREDENCIALES INVÁLIDAS · ACCESO DENEGADO.');
  }

  return (
    <AuthContext.Provider
      value={{
        user, token, loading, hasCredentials,
        isTrialMode: user?.role === 'trial' || user?.is_trial === true,
        isReconnecting,
        login, completeMfaLogin, register, logout, updateProfile,
        changePassword, sendPasswordReset,
        validateSessionAction, enterDemoMode, startTrial,
        refreshCredentialsStatus,
        isAdmin: user?.role === 'admin',
        isAuthenticated: !!token && !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}
