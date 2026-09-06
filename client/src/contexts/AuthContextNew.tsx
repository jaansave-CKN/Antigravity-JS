import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { fetchWithRetry } from '../lib/apiClient';
import { leerAuthToken, leerAuthUser, escribirAuthToken, escribirAuthUser, borrarAuthSession, emitirCambioSesion, suscribirCambioSesion, obtenerCsrfHeaders } from '../lib/authStorage';

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

/** Forma real (verificada contra los ~8 endpoints de auth de server.js) del
 *  envelope JSON que devuelve cada ruta de autenticación — todas comparten
 *  este superset de campos, ninguna los usa todos a la vez. */
interface AuthApiResponse {
  success?: boolean;
  message?: string;
  valid?: boolean;
  mfaRequired?: boolean;
  preAuthToken?: string;
  token?: string;
  user?: UserProfile;
  subscription?: LoginSubscription;
  pendingApproval?: boolean;
}

// FIX (Fase 1 frontend, Prioridad Amarilla, 2026-09-05): el JWT real ya
// NUNCA toca este archivo ni localStorage/sessionStorage — vive solo en la
// cookie httpOnly `auth_token` que server.js planta en login/mfa/activación/
// trial (ver server.js, comentario "Fase 1 Dual-Mode"). `token` en este
// contexto deja de ser el secreto real: es un centinela no sensible que solo
// indica CÓMO está autenticada la sesión, para que el resto del código (que
// hoy revisa `token`/`token === 'demo-mode-token'` en ~7 archivos) no tenga
// que rediseñarse todo de una vez. 'demo-mode-token' sigue siendo la única
// cadena que SÍ vive en localStorage (vía authStorage.ts) — no es un secreto,
// es un flag local público y ya lo era antes de este cambio.
const SESSION_TOKEN = 'cookie-session';

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

// Pura, sin estado del componente — a nivel de módulo
// (react-doctor/prefer-module-scope-pure-function).
async function sendPasswordReset(email: string) {
  try {
    await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
  } catch {}
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]               = useState<UserProfile | null>(null);
  const [token, setToken]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [hasCredentials, setHasCreds] = useState<boolean | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    // 'demo-mode-token' es la ÚNICA cadena que authStorage.ts guarda hoy —
    // es un flag local sin backend real detrás, no un JWT. Cualquier otra
    // sesión se verifica SIEMPRE contra el backend vía la cookie httpOnly:
    // ya no hay nada que leer síncronamente en el cliente para saberlo.
    const demoToken = leerAuthToken();
    if (demoToken === 'demo-mode-token') {
      const storedUser = leerAuthUser();
      if (storedUser) {
        try { setUser(JSON.parse(storedUser)); setToken('demo-mode-token'); setHasCreds(false); }
        catch { clearSession(); }
      } else { clearSession(); }
      setLoading(false);
      return;
    }
    verifyViaCookie();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-once: verifyViaCookie estabilizado con useCallback, no cambia entre renders

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

  // Sesión real (login/mfa/activación/trial): la cookie httpOnly ya la puso
  // el backend en la misma respuesta que trajo este `u` — aquí solo se
  // refleja en React state + se cachea el PERFIL (no el token, nunca
  // sensible) para que un reload no muestre una pantalla en blanco mientras
  // se revalida. `emitirCambioSesion()` reemplaza la sincronización entre
  // pestañas que antes daba gratis el evento `storage` de localStorage.token
  // — con el JWT fuera de Web Storage, otra pestaña ya no puede detectar el
  // cambio de sesión observando storage, así que se hace explícito via
  // BroadcastChannel (ver authStorage.ts).
  function persistSession(u: UserProfile) {
    escribirAuthUser(u);
    setToken(SESSION_TOKEN);
    setUser(u);
    emitirCambioSesion();
  }

  const verifyViaCookie = useCallback(async () => {
    try {
      // Sin Authorization: la cookie httpOnly viaja sola con credentials:'include'.
      const response = await fetch(`${API_BASE}/auth/verify`, { credentials: 'include' });
      if (!response.ok) {
        // FIX (2026-08-22, causa raíz real de "Token requerido" en Generar con
        // AI): 502/503 = backend/proxy todavía no disponible (reinicio de PM2,
        // cold start — vite.config.ts devuelve 503 sintético en ECONNREFUSED),
        // NO un rechazo real de la sesión. Se mantiene el perfil cacheado
        // (no sensible) mientras se reconecta, igual que antes — lo único que
        // cambia es que ya no hay un `storedToken` que reflejar en `token`,
        // se usa el mismo centinela SESSION_TOKEN.
        if (response.status === 502 || response.status === 503) {
          const storedUser = leerAuthUser();
          if (storedUser) {
            try {
              const parsed = JSON.parse(storedUser);
              setToken(SESSION_TOKEN);
              setUser(parsed);
              setIsReconnecting(true);
              console.warn('[Auth] Backend no disponible (', response.status, ') — manteniendo sesión local (reconectando)');
            } catch { clearSession(); }
          } else { clearSession(); }
          setLoading(false);
          return;
        }
        // Sesión rechazada por el backend (backend UP, respuesta explícita: 401/403).
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
      let data: AuthApiResponse;
      try { data = JSON.parse(text); } catch { clearSession(); setLoading(false); return; }
      if (data.valid && data.user) {
        setIsReconnecting(false);
        setToken(SESSION_TOKEN);
        const perfil: UserProfile = {
          id: data.user.id, email: data.user.email,
          nombre: data.user.nombre, role: data.user.role,
          plan: data.user.plan,
          created_at: data.user.created_at, is_active: data.user.is_active,
          email_verified: data.user.email_verified,
        };
        setUser(perfil);
        escribirAuthUser(perfil); // solo perfil, nunca el token — cache para el próximo reload
        checkCredentials();
      } else { clearSession(); }
    } catch (err: unknown) {
      // TypeError  = fetch() falló antes de recibir respuesta (red caída, DNS, CORS).
      // AbortError = el AbortController disparó un timeout.
      // En ambos casos la sesión (cookie) puede seguir siendo válida — mantenemos
      // el perfil cacheado en modo reconexión.
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof DOMException && err.name === 'AbortError');

      if (isNetworkError) {
        const storedUser = leerAuthUser();
        if (storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            setToken(SESSION_TOKEN);
            setUser(parsed);
            setIsReconnecting(true);
            console.warn('[Auth] Backend no disponible — manteniendo sesión local (reconectando)');
          } catch { clearSession(); }
        } else { clearSession(); }
      } else {
        // Error inesperado no relacionado con la red → cerrar sesión por seguridad
        console.warn('[Auth] Error inesperado en verificación de sesión, cerrando sesión:', err);
        clearSession();
      }
    }
    finally { setLoading(false); }
  }, []); // useCallback con deps vacías: solo usa setters de estado (referencia estable garantizada por React)

  // FIX (Fase 1, 2026-09-05): reemplaza el guard que main.tsx tenía en
  // AppRoutes (`token !== 'demo-mode-token' && !leerAuthToken()` ⇒ logout) —
  // esa condición se volvió SIEMPRE verdadera para cualquier sesión real en
  // cuanto el JWT dejó de escribirse en localStorage (leerAuthToken() ya
  // nunca devuelve un JWT real), lo que habría cerrado sesión a todo usuario
  // real en cada cambio de ruta. La señal correcta ahora es este canal
  // explícito: cuando OTRA pestaña hace login/logout/trial, revalida contra
  // el backend (la cookie es compartida por todo el navegador) en vez de
  // inferir el estado desde localStorage.
  useEffect(() => {
    return suscribirCambioSesion(() => {
      if (leerAuthToken() !== 'demo-mode-token') verifyViaCookie();
    });
  }, [verifyViaCookie]);

  async function checkCredentials() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`${API_BASE}/credentials/status`, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!r.ok) { setHasCreds(false); return; }
      const data = await r.json();
      setHasCreds(data.hasCredentials === true);
    } catch { setHasCreds(false); }
    finally { clearTimeout(timeout); }
  }

  const refreshCredentialsStatus = useCallback(async () => {
    if (token && token !== 'demo-mode-token') await checkCredentials();
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
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión o intenta más tarde.');
    }
    const text = await response.text();
    let data: AuthApiResponse;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento. Por favor intenta en unos minutos.'); }
    if (!response.ok) throw new Error(data?.message || 'Credenciales incorrectas.');

    // MFA activo en la cuenta — password correcta no basta, todavía no hay
    // sesión real hasta completar el segundo factor (ver completeMfaLogin).
    if (data?.mfaRequired && data?.preAuthToken) {
      return { mfaRequired: true, preAuthToken: data.preAuthToken };
    }

    const { user: userData, subscription } = data;
    if (!userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(userData);
    checkCredentials();
    // Notifica a SubscriptionContext (mismo tab) — ya no depende de localStorage events.
    window.dispatchEvent(new CustomEvent('auth-login'));
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
        credentials: 'include',
        body: JSON.stringify({ preAuthToken, code: code.trim() }),
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión o intenta más tarde.');
    }
    const text = await response.text();
    let data: AuthApiResponse;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento.'); }
    if (!response.ok) throw new Error(data?.message || 'Código incorrecto.');
    const { user: userData, subscription } = data;
    if (!userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(userData);
    checkCredentials();
    window.dispatchEvent(new CustomEvent('auth-login'));
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
        credentials: 'include',
        body: JSON.stringify({ token: activationToken }),
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión o intenta más tarde.');
    }
    const text = await response.text();
    let data: AuthApiResponse;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento.'); }
    if (!response.ok) throw new Error(data?.message || 'No se pudo validar la cuenta.');
    const { user: userData } = data;
    if (!userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(userData);
    checkCredentials();
    window.dispatchEvent(new CustomEvent('auth-login'));
  }

  // ── Modo Trial (V8.0) ──────────────────────────────────────────────────────
  // FIX (Fase 1 frontend, 2026-09-05): el token de trial ya NO se guarda en
  // sessionStorage/localStorage — server.js ya planta la cookie httpOnly
  // auth_token (24h) en esta misma respuesta (verificado en vivo la sesión
  // anterior: Set-Cookie auth_token con Max-Age=86400). El perfil (no
  // sensible) sí se cachea, igual que cualquier otra sesión.
  async function startTrial() {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/trial`, { method: 'POST', credentials: 'include' });
    } catch {
      throw new Error('No se pudo conectar con el servidor.');
    }
    const text = await response.text();
    let data: AuthApiResponse;
    try { data = JSON.parse(text); } catch { throw new Error('Respuesta inválida del servidor.'); }
    if (!response.ok || !data.success) throw new Error(data?.message || 'Error al iniciar sesión trial.');
    const { user: trialUser } = data;
    if (!trialUser) throw new Error('Respuesta inválida del servidor.');
    persistSession(trialUser);
    setHasCreds(false);
  }

  // ── Modo demo sin credenciales reales ─────────────────────────────────────
  // Único caso que SÍ sigue escribiendo en localStorage: 'demo-mode-token' no
  // es un secreto (cadena pública hardcodeada en todo el repo), es un flag de
  // "estoy trabajando sin backend real" que por diseño debe sobrevivir un
  // reload — no hay servidor del que revalidar una sesión que nunca existió.
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
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password, nombre: nombre || 'Usuario', role }),
      });
    } catch { throw new Error('No se pudo conectar con el servidor.'); }
    const text = await response.text();
    let data: AuthApiResponse;
    try { data = JSON.parse(text); }
    catch { throw new Error('El servicio no está disponible en este momento.'); }
    if (!response.ok) throw new Error(data?.message || 'Error al registrarse.');
    // Registro con aprobación manual pendiente: el servidor no emite sesión
    // todavía — no hay nada que abrir, solo se informa al llamador.
    if (data?.pendingApproval) return { pendingApproval: true as const, message: data.message as string };
    const { user: userData } = data;
    if (!userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(userData);
    setHasCreds(false); // usuario nuevo nunca tiene credenciales
    return { pendingApproval: false as const };
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    // 1. Notificar al servidor ANTES de limpiar el estado local, para que
    //    pueda revocar la sesión (blacklist) y limpiar la cookie httpOnly
    //    (res.clearCookie + Clear-Site-Data, ver server.js). Sin Authorization:
    //    la cookie viaja sola con credentials:'include'; extractToken() en
    //    el backend la resuelve igual que en cualquier otra ruta.
    if (token && token !== 'demo-mode-token') {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { ...obtenerCsrfHeaders() },
        });
      } catch { /* red caída — la sesión del cliente se limpia de todas formas */ }
    }

    // 2. Limpieza de localStorage (perfil cacheado + flag de demo, si los hay)
    borrarAuthSession();

    // 3. Purgar sessionStorage completo (cualquier dato de sesión volátil)
    sessionStorage.clear();

    // 4. Sincronizar estado React + avisar a otras pestañas
    clearSession();
    emitirCambioSesion();
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
      headers: { 'Content-Type': 'application/json', ...obtenerCsrfHeaders() },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Error al actualizar perfil.');
    setUser(prev => {
      const next = prev ? { ...prev, ...data } : null;
      if (next) escribirAuthUser(next);
      return next;
    });
  }

  // ── changePassword ─────────────────────────────────────────────────────────
  async function changePassword(oldPassword: string, newPassword: string) {
    if (!token || token === 'demo-mode-token') return;
    const response = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...obtenerCsrfHeaders() },
      credentials: 'include',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    const text = await response.text();
    let data: AuthApiResponse;
    try { data = JSON.parse(text); } catch { throw new Error('Error al cambiar la contraseña.'); }
    if (!response.ok) throw new Error(data?.message || 'Error al cambiar la contraseña.');
  }

  // ── validateSessionAction ──────────────────────────────────────────────────
  async function validateSessionAction(password: string) {
    if (!token) throw new Error('SESIÓN NO ACTIVA.');
    if (token === 'demo-mode-token') return; // modo demo: acepta cualquier pwd
    const response = await fetch(`${API_BASE}/auth/validate-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...obtenerCsrfHeaders() },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    const data: AuthApiResponse = await response.json().catch(() => ({}));
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
