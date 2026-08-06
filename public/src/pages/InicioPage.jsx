import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, AlertCircle, Loader } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';

export default function InicioPage() {
  const { user, loading: authLoading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error,     setError]     = useState(null);

  // Ya hay sesión — no mostrar el formulario, ir directo a la app.
  if (!authLoading && user) {
    return <Navigate to="/radar" replace />;
  }

  const handleLogin = async () => {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle(); // onAuthStateChanged (AuthContext) hace el resto — incluida la redirección de arriba
    } catch (err) {
      // popup-closed-by-user no es un error real del sistema, no lo mostramos como falla
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError(err.message || 'No se pudo iniciar sesión.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-md px-8 py-10 rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: '#3b82f6' }}>
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-lg leading-none">Antigravity OS</div>
            <div className="text-gray-500 text-xs mt-0.5">Sistema de Lista Blanca</div>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">Acceso Seguro</h1>
        <p className="text-gray-400 text-sm mb-8">
          Ingresa con tu cuenta de Google autorizada para acceder a la plataforma.
        </p>

        {error && (
          <div className="mb-4 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={signingIn}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition text-sm"
        >
          {signingIn ? (
            <>
              <Loader size={16} className="animate-spin" />
              Conectando...
            </>
          ) : (
            'Ingresar con Google'
          )}
        </button>

        <div className="mt-8 pt-6 border-t border-gray-800 text-center">
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
            Validación de lista blanca activa
          </span>
        </div>
      </div>
    </div>
  );
}
