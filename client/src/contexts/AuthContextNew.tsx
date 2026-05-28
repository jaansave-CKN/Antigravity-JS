import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  nombre: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login?: string;
  is_active: boolean;
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nombre: string, role?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  validateSessionAction: (password: string) => Promise<void>;
  enterDemoMode: () => void;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

// ── Bypass local — ninguna de estas credenciales toca el backend ──────────────
const DEV_TOKEN = 'dev-bypass-token-v3';

// Credenciales fijas de prueba: email → { profile, password }
// password null = acepta cualquier contraseña
const BYPASS_CREDENTIALS: Record<string, { profile: UserProfile; password: string | null }> = {
  'jaansave@gmail.com': {
    password: 'Radar360Admin!',
    profile: {
      id: 'admin-jaansave',
      email: 'jaansave@gmail.com',
      nombre: 'Juan Admin',
      role: 'admin',
      created_at: new Date().toISOString(),
      is_active: true,
    },
  },
  'admin@test.com': {
    password: 'admin123',
    profile: {
      id: 'dev-admin-1',
      email: 'admin@test.com',
      nombre: 'Admin (Dev)',
      role: 'admin',
      created_at: new Date().toISOString(),
      is_active: true,
    },
  },
  'demo@radar.com': {
    password: null,
    profile: {
      id: 'demo-user-1',
      email: 'demo@radar.com',
      nombre: 'Demo Usuario',
      role: 'user',
      created_at: new Date().toISOString(),
      is_active: true,
    },
  },
};

// Kept for backward-compat (enterDemoMode uses it)
const BYPASS_USERS: Record<string, UserProfile> = Object.fromEntries(
  Object.entries(BYPASS_CREDENTIALS).map(([k, v]) => [k, v.profile])
);

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Al montar: restaurar sesión desde localStorage sin tocar el backend si es token local
  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser  = localStorage.getItem('auth_user');

    if (!storedToken) {
      setLoading(false);
      return;
    }

    // Token de bypass local → restaurar sin fetch
    if (storedToken === DEV_TOKEN || storedToken === 'dev-bypass-token' || storedToken === 'dev-bypass-token-v2') {
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
          setToken(DEV_TOKEN);
        } catch {
          clearSession();
        }
      } else {
        clearSession();
      }
      setLoading(false);
      return;
    }

    // Token real → verificar contra el backend
    verifyTokenWithBackend(storedToken);
  }, []);

  function clearSession() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
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
          id: data.user.id,
          email: data.user.email,
          nombre: data.user.nombre,
          role: data.user.role,
          created_at: data.user.created_at,
          is_active: data.user.is_active,
        });
      } else {
        clearSession();
      }
    } catch {
      // Backend no disponible — sesión se pierde, usuario debe volver a loguearse
      clearSession();
    } finally {
      setLoading(false);
    }
  }

  // ── login ──────────────────────────────────────────────────────────────────
  async function login(email: string, password: string) {
    const trimmedEmail = email.trim().toLowerCase();

    // BYPASS LOCAL — intercepta ANTES de cualquier fetch al backend
    const bypassEntry = BYPASS_CREDENTIALS[trimmedEmail];
    if (bypassEntry) {
      // Valida contraseña si está definida; null = acepta cualquiera
      if (bypassEntry.password !== null && password !== bypassEntry.password) {
        throw new Error('Contraseña incorrecta.');
      }
      persistSession(DEV_TOKEN, bypassEntry.profile);
      return;
    }

    // Login real contra el backend
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
    } catch {
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión o intenta más tarde.');
    }

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // El backend devolvió HTML (Render error page, proxy caído, etc.)
      throw new Error('El servicio no está disponible en este momento. Por favor intenta en unos minutos.');
    }

    if (!response.ok) {
      throw new Error(data?.message || 'Credenciales incorrectas.');
    }

    const { token: newToken, user: userData } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
  }

  // ── Modo demo — acceso sin credenciales ────────────────────────────────────
  function enterDemoMode() {
    const demoUser = BYPASS_USERS['demo@radar.com'];
    persistSession(DEV_TOKEN, demoUser);
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
    } catch {
      throw new Error('No se pudo conectar con el servidor.');
    }

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('El servicio no está disponible en este momento.');
    }

    if (!response.ok) throw new Error(data?.message || 'Error al registrarse.');

    const { token: newToken, user: userData } = data;
    if (!newToken || !userData) throw new Error('Respuesta inválida del servidor.');
    persistSession(newToken, userData);
  }

  // ── logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    if (token && token !== DEV_TOKEN) {
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
    if (token === DEV_TOKEN) {
      const updated = user ? { ...user, ...data } : null;
      if (updated) { setUser(updated); localStorage.setItem('auth_user', JSON.stringify(updated)); }
      return;
    }
    if (!token) return;
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
    if (token === DEV_TOKEN) return; // noop en dev
    if (!token) return;
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
    } catch {
      // Si el backend no está disponible, no lanzamos error
    }
  }

  // ── validateSessionAction ──────────────────────────────────────────────────
  // Revalida identidad del admin antes de operaciones sensibles (toggles SIE).
  async function validateSessionAction(password: string) {
    const trimmedEmail = user?.email.trim().toLowerCase() ?? '';

    if (token === DEV_TOKEN) {
      const entry = BYPASS_CREDENTIALS[trimmedEmail];
      if (!entry) throw new Error('USUARIO NO RECONOCIDO EN EL SISTEMA.');
      if (entry.password !== null && password !== entry.password) {
        throw new Error('CREDENCIALES INVÁLIDAS · SESIÓN ADMINISTRATIVA NO AUTORIZADA.');
      }
      return;
    }

    const response = await fetch(`${API_BASE}/auth/validate-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password }),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message ?? 'CREDENCIALES INVÁLIDAS · ACCESO DENEGADO.');
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        updateProfile,
        changePassword,
        sendPasswordReset,
        validateSessionAction,
        enterDemoMode,
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
