import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface UserProfile {
  id: string;
  email: string;
  nombre: string;
  role: 'admin' | 'inversor';
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
  isAdmin: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

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
      if (response.ok) {
        const data = await response.json();
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

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Error al iniciar sesión');
    }

    const data = await response.json();
    const { token: newToken, user: userData } = data;
    
    localStorage.setItem('auth_token', newToken);
    setToken(newToken);
    setUser(userData);
  }

  async function register(email: string, password: string, nombre: string, role = 'inversor') {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nombre, role })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Error al registrarse');
    }

    const data = await response.json();
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

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Error al cambiar contraseña');
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