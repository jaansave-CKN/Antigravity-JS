import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { fetchWithRetry } from '../lib/apiClient';
import { leerAuthToken, leerAuthUser, escribirAuthToken, escribirAuthUser, borrarAuthSession } from '../lib/authStorage';

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
  activarPorCorreo: (activationToken: string) => Promise<void>;
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
    const storedToken = leerAuthToken();
    const storedUser  = leerAuthUser();

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
    function onSessionExpired(e: Event) {
      const detail = (e as CustomEvent<{ code?: string; message?: string }>).detail;
      sessionStorage.setItem('rf360_session_expired', '1');
      if (detail?.code)    sessionStorage.setItem('rf360_session_expired_code', detail.code);
      if (detail?.message) sessionStorage.setItem('rf360_session_expired_msg', detail.message);
      clearSession();
    }
    window.addEventListener('auth-session-expired', onSessionExpired);
    return () => window.removeEventListener('auth-session-expired', onSessionExpired);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearSession() {
    borrarAuthSession();
    setToken(null);
    setUser(null);
    setHasCreds(null);
    setIsReconnecting(false);
  }

  function persistSession(t: string, u: UserProfile) {
    escribirAuthToken(t);
    escribirAuthUser(u);
    setToken(t);
    setUser(u);
  }

  const verifyTokenWithBackend = useCallback(async (storedToken: string) => { // eslint-disable-line react-hooks/exhaustive-deps
    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (!response.ok) {
        // FIX (2026-08-22, causa raíz real de "Token requerido" en Generar con
        // AI): 502/503 = backend/proxy todavía no disponible (reinicio de PM2,
        // cold start — vite.config.ts devuelve 503 sintético en ECONNREFUSED),
        // NO un rechazo real del token. Antes esto entraba a la MISMA rama que
        // un 401 genuino y, en dev, reemplazaba la sesión real por
        // demo-mode-token de forma silenciosa y PERMANENTE ante cualquier
        // reinicio momentáneo — apiClient.ts nunca envía 'demo-mode-token'
        // como Authorization real, así que el siguiente request salía sin
        // header y el backend respondía "Token requerido" (nada que ver con
        // BYOK/byokGate.js, que nunca llegaba a ejecutarse). Se trata igual
        // que el bloque de red de abajo: mantener la sesión real y marcar
        // reconectando, sin tocar localStorage.
        if (response.status === 502 || response.status === 503) {
          const storedUser = leerAuthUser();
          if (storedUser) {
            try {
              const parsed = JSON.parse(storedUser);
              setToken(storedToken);
              setUser(parsed);
              setIsReconnecting(true);
              console.warn('[Auth] Backend no disponible (', response.status, ') — manteniendo sesión local (reconectando)');
            } catch { clearSession(); }
          } else { clearSession(); }
          setLoading(false);
          return;
        }
        // Token rechazado por el backend (backend UP, respuesta explícita: 401/403).
        // En dev, cambiar a demo-mode-token para no bloquear el trabajo local.
        if (import.meta.env.DEV) {
          const devUser = { id: 'dev-user-001', email: 'dev@antigravity.local', nombre: 'Desarrollador Local', role: 'admin' as const, plan: 'suite', created_at: new Date().toISOString(), is_active: true };
          escribirAuthToken('demo-mode-token');
          escribirAuthUser(devUser);
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
        // FIX (2026-08-22): unificado con la rama 502/503 de arriba — un
        // backend caído momentáneamente (reinicio de PM2, cold start) NUNCA
        // debe destruir una sesión real, ni en dev ni en prod. La rama dev
        // anterior sobreescribía localStorage.auth_token con el string
        // literal 'demo-mode-token' ante cualquier blip de red — permanente
        // hasta un re-login manual, y la causa raíz real del "Token
        // requerido" reportado en Generar con AI.
        const storedUser = leerAuthUser();
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            setToken(storedToken);
            setUser(parsed);
            setIsReconnecting(true);
            console.warn('[Auth] Backend no disponible — manteniendo sesión local (reconectando)');
          } catch { clearSession(); }
        } else { clearSession(); }
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
      // FIX (2026-08-22, "ALERTA DE SEGURIDAD: No se pudo conectar" con el
      // backend sano un instante después): antes un solo intento crudo — un
      // blip de red/reinicio del propio dev server en el instante exacto del
      // clic bastaba para fallar el login sin ningún reintento. Mismo
      // backoff exponencial ya probado en apiClient.ts para el resto de la
      // app (502/503 y errores de red), reutilizado tal cual.
      response = await fetchWithRetry(`${API_BASE}/auth/login`, {
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
      // Mismo fix que login() — segundo paso del mismo flujo, mismo riesgo.
      response = await fetchWithRetry(`${API_BASE}/auth/mfa/challenge`, {
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

  // ── activarPorCorreo — botón "Validar" del correo enviado justo después de
  // que el admin aprueba la cuenta (ver aprobar-por-correo en server.js).
  // Mismo patrón que completeMfaLogin: intercambia un token de un solo uso
  // por una sesión real, sin pedir contraseña de nuevo.
  async function activarPorCorreo(activationToken: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/validar-por-correo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: activationToken }),
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión o intenta más tarde.');
    }
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento.'); }
    if (!response.ok) throw new Error(data?.message || 'No se pudo validar la cuenta.');
    const { token: newToken, user: userData } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
    checkCredentials(newToken);
    window.dispatchEvent(new CustomEvent('auth-login', { detail: { token: newToken } }));
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
    escribirAuthToken(trialToken);
    escribirAuthUser(trialUser);
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
    escribirAuthToken('demo-mode-token');
    escribirAuthUser(demoUser);
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
    borrarAuthSession();
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
      if (updated) { setUser(updated); escribirAuthUser(updated); }
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

  // react-doctor/jsx-no-constructed-context-values omitido a propósito: envolver
  // este value en useMemo no evitaría nada hoy — login/completeMfaLogin/
  // activarPorCorreo/register/logout/updateProfile/changePassword/
  // sendPasswordReset/validateSessionAction/enterDemoMode/startTrial son
  // `function` planas (no useCallback), se recrean en cada render, y el
  // dependency array del memo tendría que incluirlas igual (exhaustive-deps),
  // así que recalcularía siempre. Arreglarlo de verdad significa envolver ~10
  // funciones en useCallback con las deps correctas en el contexto de auth de
  // toda la app — riesgo real de closures obsoletos si se omite una dependencia,
  // no un parche mecánico de useMemo. Requiere revisión aparte.
  return (
    <AuthContext.Provider
      value={{
        user, token, loading, hasCredentials,
        isTrialMode: user?.role === 'trial' || user?.is_trial === true,
        isReconnecting,
        login, completeMfaLogin, activarPorCorreo, register, logout, updateProfile,
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
