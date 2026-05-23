import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase';

interface UserProfile {
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
  isAdmin: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      setToken(storedToken);
      verifyToken(storedToken);
    } else {
      setLoading(false);
    }
  }, []);

  async function verifyToken(storedToken: string) {
    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        headers: { Authorization: `Bearer ${storedToken}` }
      });

      const text = await response.text();
      console.log("[Auth] Verify - raw response:", text);

      if (!response.ok) {
        localStorage.removeItem('auth_token');
        setToken(null);
        return;
      }

      const data = JSON.parse(text);

      if (data.valid && data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          nombre: data.user.nombre,
          role: data.user.role,
          created_at: data.user.created_at,
          is_active: data.user.is_active,
        });
      } else {
        localStorage.removeItem('auth_token');
        setToken(null);
      }
    } catch {
      localStorage.removeItem('auth_token');
      setToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const resultText = await response.text();
    console.log("[Auth] Login - raw response:", resultText);

    let data;
    try {
      data = JSON.parse(resultText);
    } catch {
      throw new Error("El servidor respondió, pero no en formato JSON. Verifica logs de Render.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Error al iniciar sesión");
    }

    const { token: newToken, user: userData } = data;
    localStorage.setItem('auth_token', newToken);
    setToken(newToken);
    setUser(userData);
  }

  async function register(email: string, password: string, nombre: string, role = 'user') {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nombre, role })
    });

    const resultText = await response.text();
    console.log("[Auth] Register - raw response:", resultText);

    let data;
    try {
      data = JSON.parse(resultText);
    } catch {
      throw new Error("El servidor respondió, pero no en formato JSON. Verifica logs de Render.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Error al registrarse");
    }

    const { token: newToken, user: userData } = data;
    localStorage.setItem('auth_token', newToken);
    setToken(newToken);
    setUser(userData);
  }

  async function logout() {
    if (token) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {}
    }
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
  }

  async function updateProfile(data: Partial<UserProfile>) {
    if (!token) return;
    
    const response = await fetch(`${API_BASE}/auth/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) throw new Error('Error al actualizar perfil');
    
    setUser(prev => prev ? { ...prev, ...data } : null);
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    if (!token) return;
    
    const response = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });

    const resultText = await response.text();
    console.log("[Auth] Change password - raw response:", resultText);

    let data;
    try {
      data = JSON.parse(resultText);
    } catch {
      throw new Error("El servidor respondió, pero no en formato JSON. Verifica logs de Render.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Error al cambiar contraseña");
    }
  }

  async function sendPasswordReset(email: string) {
    await sendPasswordResetEmail(auth, email);
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
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}