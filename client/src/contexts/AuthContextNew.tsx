import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  nombre: string;
  role: 'admin' | 'user';
  plan?: string;      // 'free' | 'pro' — infraestructura para gating de suscripción
  created_at: string;
  last_login?: string;
  is_active: boolean;
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  hasCredentials: boolean | null;  // null = aún verificando
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nombre: string, role?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  validateSessionAction: (password: string) => Promise<void>;
  enterDemoMode: () => void;
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
  }, []);

  function clearSession() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
    setHasCreds(null);
  }

  function persistSession(t: string, u: UserProfile) {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('auth_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }

  async function verifyTokenWithBackend(storedToken: string) {
    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (!response.ok) { clearSession(); setLoading(false); return; }
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { clearSession(); setLoading(false); return; }
      if (data.valid && data.user) {
        setToken(storedToken);
        setUser({
          id: data.user.id, email: data.user.email,
          nombre: data.user.nombre, role: data.user.role,
          plan: data.user.plan,
          created_at: data.user.created_at, is_active: data.user.is_active,
        });
        checkCredentials(storedToken);
      } else { clearSession(); }
    } catch {
      // Servidor no disponible — restaurar sesión en modo demo para no bloquear la app
      const storedUser = localStorage.getItem('auth_user');
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          setToken('demo-mode-token');
          setUser(parsed);
          localStorage.setItem('auth_token', 'demo-mode-token');
          console.warn('[Auth] Servidor no disponible — sesión restaurada en modo demo');
        } catch { clearSession(); }
      } else { clearSession(); }
    }
    finally { setLoading(false); }
  }

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
  async function login(email: string, password: string) {
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
    const { token: newToken, user: userData } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
    checkCredentials(newToken);
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
    const { token: newToken, user: userData } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
    setHasCreds(false); // usuario nuevo nunca tiene credenciales
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    if (token && token !== 'demo-mode-token') {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
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
        login, register, logout, updateProfile,
        changePassword, sendPasswordReset,
        validateSessionAction, enterDemoMode,
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
