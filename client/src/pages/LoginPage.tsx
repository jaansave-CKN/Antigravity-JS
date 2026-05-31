import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

// ── Modal recuperación de credenciales ───────────────────────────────────────
function RecoveryModal({ onClose }: { onClose: () => void }) {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail]   = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setStatus('loading');
    try {
      await sendPasswordReset(trimmed);
      setStatus('success');
      setMessage(trimmed);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#94a3b8] hover:text-[#475569] transition-colors"
          aria-label="Cerrar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center justify-center w-12 h-12 bg-[#f0f6ff] rounded-xl mb-4 border border-[#dce9ff]">
          <svg className="w-6 h-6 text-[#0058be]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </div>

        <p className="text-[10px] font-mono font-bold text-[#76777d] uppercase tracking-widest mb-1">
          PROTOCOLO DE RECUPERACIÓN
        </p>
        <h2 className="text-base font-bold text-[#191c1e] mb-1">RECUPERAR CREDENCIALES DE ACCESO</h2>
        <p className="text-xs text-[#76777d] mb-5">
          Ingrese su identificador de sistema. Se generará un enlace seguro de restablecimiento.
        </p>

        {status === 'success' ? (
          <div className="rounded-lg bg-[#f0fdf4] border border-[#86efac] px-4 py-3 text-xs text-[#166534] font-mono">
            <p className="font-bold mb-0.5">ENLACE GENERADO · TRANSMISIÓN EXITOSA</p>
            <p>Verifique la bandeja de entrada de <span className="font-medium">{message}</span>.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {status === 'error' && (
              <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-mono">
                ERROR DE TRANSMISIÓN · Reintente el procedimiento.
              </div>
            )}
            <div>
              <label className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1.5">
                IDENTIFICADOR DE SISTEMA (EMAIL)
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="operador@institucion.gov"
                required
                autoFocus
                className="w-full px-3 py-2.5 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be] transition-colors font-mono"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg border border-[#e2e8f0] text-[#45464d] text-xs font-mono font-semibold uppercase tracking-wide hover:bg-[#f2f4f6] transition-colors"
              >
                CANCELAR
              </button>
              <button
                type="submit"
                disabled={status === 'loading' || !email.trim()}
                className="flex-1 py-2.5 rounded-lg bg-[#0058be] text-white text-xs font-mono font-bold uppercase tracking-wide hover:bg-[#0044a3] disabled:opacity-50 transition-colors"
              >
                {status === 'loading' ? 'PROCESANDO...' : 'EJECUTAR RECUPERACIÓN'}
              </button>
            </div>
          </form>
        )}

        {status === 'success' && (
          <button
            onClick={onClose}
            className="mt-4 w-full py-2.5 rounded-lg border border-[#e2e8f0] text-[#45464d] text-xs font-mono font-semibold uppercase tracking-wide hover:bg-[#f2f4f6] transition-colors"
          >
            CERRAR PROTOCOLO
          </button>
        )}
      </div>
    </div>
  );
}

// ── Página de autenticación ───────────────────────────────────────────────────
export default function LoginPage() {
  const { login, register, enterDemoMode } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  // Modo: 'login' | 'registro'
  const [modo, setModo]               = useState<'login' | 'registro'>('login');

  // Campos compartidos
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');

  // Solo registro
  const [nombre, setNombre]           = useState('');

  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [showPwd, setShowPwd]         = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  const from   = (location.state as any)?.from?.pathname || '/';
  const reason = (location.state as any)?.reason as string | undefined;

  function switchModo(m: 'login' | 'registro') {
    setModo(m);
    setError('');
    setEmail('');
    setPassword('');
    setNombre('');
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'ERROR DE AUTENTICACIÓN · Verifique sus credenciales.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!nombre.trim()) {
      setError('El nombre de usuario es obligatorio.');
      return;
    }
    setLoading(true);
    try {
      await register(email.trim().toLowerCase(), password, nombre.trim());
      // Registro exitoso → redirigir a Centro de Control de APIs
      navigate('/apis', { replace: true });
    } catch (err: any) {
      setError(err.message || 'ERROR DE REGISTRO · Verifica los datos ingresados.');
    } finally {
      setLoading(false);
    }
  }

  function handleDemo() {
    enterDemoMode();
    navigate('/', { replace: true });
  }

  const esRegistro = modo === 'registro';

  return (
    <>
      {showRecovery && <RecoveryModal onClose={() => setShowRecovery(false)} />}

      <div className="min-h-screen bg-[#f7f9fb] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-[#e2e8f0] w-full max-w-md overflow-hidden">

          {/* Encabezado institucional */}
          <div className="bg-[#191c1e] px-8 py-6 text-center">
            <p className="text-[10px] font-mono text-[#76777d] uppercase tracking-[0.2em] mb-2">
              SISTEMA INSTITUCIONAL CERTIFICADO
            </p>
            <h1 className="text-xl font-bold text-white tracking-tight">
              GGIE · RADAR FONDOS 360
            </h1>
            <p className="text-[11px] text-[#8a9bb0] mt-1.5 font-mono uppercase tracking-wider">
              {esRegistro ? 'REGISTRO DE NUEVO USUARIO' : 'PROTOCOLO DE AUTENTICACIÓN SEGURA'}
            </p>
          </div>

          <div className="px-8 py-7">
            {/* Aviso de acceso restringido (viene de /formulador u otra ruta protegida) */}
            {reason === 'requires-auth' && !error && (
              <div className="mb-5 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono">
                <span className="font-bold">ACCESO RESTRINGIDO · MÓDULO B</span>
                <p className="mt-1 font-normal">El Formulador requiere una cuenta activa. Inicia sesión o crea una cuenta para continuar.</p>
              </div>
            )}

            {/* Alerta de error */}
            {error && (
              <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-mono">
                <span className="font-bold">ALERTA DE SEGURIDAD:</span> {error}
              </div>
            )}

            {/* ── FORMULARIO INGRESO ── */}
            {!esRegistro && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1.5">
                    IDENTIFICADOR DE ACCESO
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="operador@institucion.gov"
                    required
                    autoComplete="email"
                    className="w-full px-3 py-2.5 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1.5">
                    CLAVE DE AUTENTICACIÓN
                  </label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      autoComplete="current-password"
                      className="w-full px-3 py-2.5 pr-10 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                    />
                    <button
                      type="button"
                      onMouseDown={() => setShowPwd(true)}
                      onMouseUp={() => setShowPwd(false)}
                      onMouseLeave={() => setShowPwd(false)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#76777d] hover:text-[#191c1e]"
                      tabIndex={-1}
                    >
                      {showPwd ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                  <div className="flex justify-end mt-1.5">
                    <button
                      type="button"
                      onClick={() => setShowRecovery(true)}
                      className="text-[10px] font-mono text-[#76777d] hover:text-secondary uppercase tracking-wider underline underline-offset-2 transition-colors"
                    >
                      RECUPERAR CREDENCIALES
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#191c1e] text-white py-2.5 rounded-lg font-mono font-bold text-xs uppercase tracking-widest hover:bg-[#2d3133] disabled:opacity-50 transition-colors mt-2"
                >
                  {loading ? 'AUTENTICANDO...' : 'EJECUTAR AUTENTICACIÓN'}
                </button>
              </form>
            )}

            {/* ── FORMULARIO REGISTRO ── */}
            {esRegistro && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1.5">
                    NOMBRE DE USUARIO
                  </label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={e => setNombre(e.target.value)}
                    placeholder="Nombre Apellido"
                    required
                    autoFocus
                    autoComplete="name"
                    className="w-full px-3 py-2.5 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1.5">
                    CORREO ELECTRÓNICO
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="usuario@institucion.gov"
                    required
                    autoComplete="email"
                    className="w-full px-3 py-2.5 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1.5">
                    CLAVE DE AUTENTICACIÓN
                  </label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="w-full px-3 py-2.5 pr-10 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                    />
                    <button
                      type="button"
                      onMouseDown={() => setShowPwd(true)}
                      onMouseUp={() => setShowPwd(false)}
                      onMouseLeave={() => setShowPwd(false)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#76777d] hover:text-[#191c1e]"
                      tabIndex={-1}
                    >
                      {showPwd ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0058be] text-white py-2.5 rounded-lg font-mono font-bold text-xs uppercase tracking-widest hover:bg-[#0044a3] disabled:opacity-50 transition-colors mt-2"
                >
                  {loading ? 'REGISTRANDO...' : 'CREAR CUENTA Y CONTINUAR'}
                </button>
              </form>
            )}

            {/* Separador */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-[#e2e8f0]" />
              <span className="text-[10px] font-mono text-[#76777d] uppercase tracking-wider">o</span>
              <div className="flex-1 h-px bg-[#e2e8f0]" />
            </div>

            {/* Demo — solo visible en modo login */}
            {!esRegistro && (
              <button
                onClick={handleDemo}
                className="w-full py-2.5 rounded-lg border border-[#e2e8f0] text-[#45464d] text-xs font-mono font-semibold uppercase tracking-wider hover:bg-[#f2f4f6] transition-colors"
              >
                ACCESO MODO DEMOSTRACIÓN
              </button>
            )}

            {/* Toggle login / registro */}
            <div className="flex justify-center mt-5 text-[10px] font-mono text-[#76777d] uppercase tracking-wider">
              {esRegistro ? (
                <span>
                  ¿Ya tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => switchModo('login')}
                    className="text-[#0058be] hover:text-[#0044a3] underline underline-offset-2 transition-colors font-bold"
                  >
                    INGRESAR
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => switchModo('registro')}
                  className="hover:text-[#0058be] underline underline-offset-2 transition-colors"
                >
                  CREAR NUEVA CUENTA
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
