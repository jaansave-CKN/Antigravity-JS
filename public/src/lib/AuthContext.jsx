import { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged } from './firebase';

const AuthContext = createContext({ user: null, loading: true, sessionToken: null });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // JWT propio (session-manager.js) — complementa a Firebase, hoy solo lo consume
  // la revocación de sesión (DELETE /api/session/:id) y las stats de /api/health.
  // Ningún endpoint de negocio lo requiere: la protección real es el ID token de
  // Firebase, que se adjunta por separado en cada fetch autenticado (ver lib/firebase.js).
  const [sessionToken, setSessionToken] = useState(null);
  const [sessionId,    setSessionId]    = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);

      if (!firebaseUser) {
        setSessionToken(null);
        setSessionId(null);
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await fetch('/api/session/login', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ firebaseToken: idToken }),
        });
        if (res.ok) {
          const data = await res.json();
          setSessionToken(data.token);
          setSessionId(data.sessionId);
        }
      } catch (err) {
        console.warn('[Auth] No se pudo emitir la sesión propia (no bloquea el acceso):', err.message);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, sessionToken, sessionId }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
