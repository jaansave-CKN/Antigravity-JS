import { useState, useEffect } from 'react';
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
      <div className="bg-[#0a1426] rounded-xl border border-[#1a3a50] shadow-xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#3a5e7a] hover:text-[#475569] transition-colors"
          aria-label="Cerrar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center justify-center w-12 h-12 bg-[#001c2e] rounded-xl mb-4 border border-[#1a3a50]">
          <svg className="w-6 h-6 text-[#38bdf8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </div>

        <p className="text-[10px] font-mono font-bold text-[#557997] uppercase tracking-widest mb-1">
          PROTOCOLO DE RECUPERACIÓN
        </p>
        <h2 className="text-base font-bold text-[#c8d8e8] mb-1">RECUPERAR CREDENCIALES DE ACCESO</h2>
        <p className="text-xs text-[#557997] mb-5">
          Ingrese su identificador de sistema. Se generará un enlace seguro de restablecimiento.
        </p>

        {status === 'success' ? (
          <div className="rounded-lg bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.3)] px-4 py-3 text-xs text-[#22c55e] font-mono">
            <p className="font-bold mb-0.5">ENLACE GENERADO · TRANSMISIÓN EXITOSA</p>
            <p>Verifique la bandeja de entrada de <span className="font-medium">{message}</span>.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {status === 'error' && (
              <div className="px-4 py-3 rounded-lg bg-[rgba(248,113,113,0.1)] border border-[rgba(248,113,113,0.3)] text-[#f87171] text-xs font-mono">
                ERROR DE TRANSMISIÓN · Reintente el procedimiento.
              </div>
            )}
            <div>
              <label className="block text-[10px] font-mono font-bold text-[#557997] uppercase tracking-widest mb-1.5">
                IDENTIFICADOR DE SISTEMA (EMAIL)
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="operador@institucion.gov"
                required
                autoFocus
                className="w-full px-3 py-2.5 bg-[#0b1326] border border-[#1a3a50] rounded-lg text-[#c8d8e8] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-[#0058be] focus:ring-1 focus:ring-[#0058be] transition-colors font-mono"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg border border-[#1a3a50] text-[#557997] text-xs font-mono font-semibold uppercase tracking-wide hover:bg-[#1a3a50] transition-colors"
              >
                CANCELAR
              </button>
              <button
                type="submit"
                disabled={status === 'loading' || !email.trim()}
                className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-[#38bdf8] to-[#0284c7] text-[#e0e0ff] text-xs font-mono font-bold uppercase tracking-wide hover:from-[#38bdf8] hover:to-[#0284c7] disabled:opacity-50 transition-colors"
              >
                {status === 'loading' ? 'PROCESANDO...' : 'EJECUTAR RECUPERACIÓN'}
              </button>
            </div>
          </form>
        )}

        {status === 'success' && (
          <button
            onClick={onClose}
            className="mt-4 w-full py-2.5 rounded-lg border border-[#1a3a50] text-[#557997] text-xs font-mono font-semibold uppercase tracking-wide hover:bg-[#1a3a50] transition-colors"
          >
            CERRAR PROTOCOLO
          </button>
        )}
      </div>
    </div>
  );
}

// ── Micro-interacciones — dark mode token system ──────────────────────────────
const LOGIN_CSS = `
  @keyframes lp-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
  .lp-card { animation: lp-in .4s ease both; }

  .lp-btn-primary {
    transition: all 0.2s ease-in-out;
  }
  .lp-btn-primary:not(:disabled):hover {
    transform: translateY(-1px);
    box-shadow: 0 0 15px rgba(56,189,248,0.35), 0 4px 12px rgba(56,189,248,0.15);
  }
  .lp-btn-primary:not(:disabled):active {
    transform: scale(0.97) translateY(1px);
    box-shadow: 0 0 4px rgba(56,189,248,0.20);
  }

  .lp-btn-secondary {
    transition: all 0.2s ease-in-out;
  }
  .lp-btn-secondary:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 8px rgba(56,189,248,0.12);
  }
  .lp-btn-secondary:active {
    transform: scale(0.97) translateY(1px);
    box-shadow: none;
  }
`;

// ── Página de autenticación ───────────────────────────────────────────────────
export default function LoginPage() {
  const { login, completeMfaLogin, register, enterDemoMode } = useAuth();
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
  const [pendingMsg, setPendingMsg]   = useState('');
  const [loading, setLoading]         = useState(false);
  const [showPwd, setShowPwd]         = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  // MFA: si login() devuelve mfaRequired, se guarda el preAuthToken y se
  // muestra un segundo formulario (código de 6 dígitos) en vez de navegar.
  const [mfaPreAuthToken, setMfaPreAuthToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode]                 = useState('');

  // "Recordarme" — SOLO el correo, NUNCA la contraseña. La versión anterior
  // guardaba la clave en texto plano en localStorage y la autocompletaba
  // (junto con el checkbox marcado) en cada carga de la página, sin que el
  // usuario lo pidiera cada vez — un problema de seguridad real, no solo de
  // UX. También se auto-purga cualquier rastro de esa versión anterior al
  // cargar la página, para limpiar sesiones ya afectadas sin acción manual.
  const REMEMBER_KEY = 'rf360_remember_creds';
  const [recordar, setRecordar] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.password) {
          // Rastro de la versión insegura anterior — se purga por completo,
          // el campo de clave nunca se rellena solo.
          localStorage.removeItem(REMEMBER_KEY);
        } else if (parsed?.email) {
          setEmail(parsed.email);
        }
      }
    } catch { localStorage.removeItem(REMEMBER_KEY); }
  }, []);

  // Aviso de sesión expirada — disparado por AuthContextNew.tsx al recibir un
  // 401 real en cualquier pantalla (ej. rotación de JWT_SECRET en el
  // servidor), en vez de dejar que cada página muestre su propio error
  // genérico de sincronización sin explicar la causa real.
  useEffect(() => {
    if (sessionStorage.getItem('rf360_session_expired')) {
      sessionStorage.removeItem('rf360_session_expired');
      setError('Tu sesión expiró (por seguridad, se renovaron las credenciales del servidor). Inicia sesión de nuevo.');
    }
  }, []);

  const from       = (location.state as any)?.from?.pathname || '/';
  const reason     = (location.state as any)?.reason     as string | undefined;
  const moduleCode = (location.state as any)?.module     as string | undefined;
  const moduleName = (location.state as any)?.moduleName as string | undefined;

  function switchModo(m: 'login' | 'registro') {
    setModo(m);
    setError('');
    setEmail('');
    setPassword('');
    setNombre('');
  }

  // Redirección inteligente compartida por login normal y por el segundo
  // paso de MFA — misma lógica, dos puntos de entrada distintos.
  function redirigirTrasLogin(sub: { access_radar?: boolean; access_formulador?: boolean } | undefined) {
    if (from && from !== '/' && from !== '/login') {
      navigate(from, { replace: true });
    } else if (sub?.access_radar && sub?.access_formulador) {
      navigate('/', { replace: true }); // suite: elige pilar en SelectionPage
    } else if (sub?.access_formulador) {
      navigate('/checklist', { replace: true });
    } else if (sub?.access_radar) {
      navigate('/radar', { replace: true });
    } else {
      navigate('/', { replace: true }); // plan free: SelectionPage → upgrade
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setPendingMsg('');
    setLoading(true);
    try {
      const result = await login(email, password);
      // Solo el correo — nunca la clave — y solo si el usuario marcó la casilla en ESTE intento.
      if (recordar) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email }));
      else localStorage.removeItem(REMEMBER_KEY);

      if (result && 'mfaRequired' in result) {
        setMfaPreAuthToken(result.preAuthToken);
        return;
      }
      redirigirTrasLogin(result);
    } catch (err: any) {
      // Credenciales rechazadas: si venían de "Recordarme", la clave guardada
      // ya no sirve (cuenta borrada/cambiada) — se borra para no quedar
      // atrapado reintentando siempre la misma clave vieja.
      localStorage.removeItem(REMEMBER_KEY);
      setRecordar(false);
      setPassword('');
      setError(err.message || 'ERROR DE AUTENTICACIÓN · Verifique sus credenciales.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaPreAuthToken) return;
    setError('');
    setLoading(true);
    try {
      const sub = await completeMfaLogin(mfaPreAuthToken, mfaCode);
      redirigirTrasLogin(sub);
    } catch (err: any) {
      setMfaCode('');
      setError(err.message || 'Código incorrecto.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Registro simplificado: solo correo + clave. El nombre se deriva del
      // correo (parte antes de la @) para no pedirle un dato más al usuario.
      const nombreDerivado = email.trim().split('@')[0] || 'Usuario';
      const result = await register(email.trim().toLowerCase(), password, nombreDerivado);
      if (result.pendingApproval) {
        setPendingMsg(result.message || 'Cuenta creada. Un administrador debe aprobarla antes de que puedas iniciar sesión.');
        switchModo('login');
      } else {
        navigate('/', { replace: true }); // Registro exitoso → SelectionPage para elegir pilar
      }
    } catch (err: any) {
      setError(err.message || 'ERROR DE REGISTRO · Verifica los datos ingresados.');
    } finally {
      setLoading(false);
    }
  }

  function handleDemo() {
    enterDemoMode();
    // Pilar B: rutas que pertenecen al módulo Formulador IA
    const PILAR_B = ['/checklist', '/entrada', '/modulo10', '/anexos', '/logistica', '/dialectica', '/ficha'];
    const isFromB = from && PILAR_B.some(p => from.startsWith(p));
    // Respetar el pilar de origen: B → /checklist, A o sin origen → /radar
    const target = isFromB ? '/checklist' : '/radar';
    navigate(target, { replace: true });
  }

  const esRegistro = modo === 'registro';

  return (
    <>
      <style>{LOGIN_CSS}</style>
      {showRecovery && <RecoveryModal onClose={() => setShowRecovery(false)} />}

      <div className="min-h-screen bg-[#0b1326] flex items-center justify-center p-4">
        <div className="lp-card bg-[#0a1426] rounded-2xl border border-[#1a3a50] w-full max-w-md overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.45)' }}>

          {/* Encabezado institucional */}
          <div className="bg-[#001c2e] px-8 py-7 text-center">
            <h1
              className="text-xl font-bold text-[#e0e0ff]"
              style={{ transform: 'scale(1.5, 1.3)', display: 'inline-block' }}
            >
              RadFor-360
            </h1>
            <p className="text-[11px] text-[#557997] mt-3 font-mono uppercase tracking-wider">
              {mfaPreAuthToken ? 'VERIFICACIÓN EN DOS PASOS' : esRegistro ? 'REGISTRO DE NUEVO USUARIO' : 'PROTOCOLO DE AUTENTICACIÓN SEGURA'}
            </p>
          </div>

          {mfaPreAuthToken ? (
            <div className="px-8 py-7">
              {error && (
                <div className="mb-5 px-4 py-3 rounded-lg bg-[rgba(248,113,113,0.1)] border border-[rgba(248,113,113,0.3)] text-[#f87171] text-xs font-mono">
                  <span className="font-bold">ALERTA DE SEGURIDAD:</span> {error}
                </div>
              )}

              <p className="text-xs text-[#557997] mb-5">
                Ingrese el código de 6 dígitos generado por su aplicación de autenticación.
              </p>

              <form onSubmit={handleMfaSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#557997] uppercase tracking-widest mb-1.5">
                    CÓDIGO DE VERIFICACIÓN
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoFocus
                    value={mfaCode}
                    onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    required
                    className="w-full px-3 py-2.5 bg-[#0b1326] border border-[#1a3a50] rounded-lg text-[#c8d8e8] text-lg tracking-[0.5em] text-center font-mono placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || mfaCode.length !== 6}
                  className="lp-btn-primary w-full bg-[#131b2e] text-[#38bdf8] border border-[rgba(56,189,248,0.35)] py-2.5 rounded-lg font-mono font-bold text-xs uppercase tracking-widest hover:bg-[#1a2a40] hover:border-[rgba(56,189,248,0.65)] disabled:opacity-40 mt-2"
                >
                  {loading ? 'VERIFICANDO...' : 'VERIFICAR CÓDIGO'}
                </button>

                <button
                  type="button"
                  onClick={() => { setMfaPreAuthToken(null); setMfaCode(''); setError(''); setPassword(''); }}
                  className="w-full py-2 text-[10px] font-mono text-[#557997] hover:text-secondary uppercase tracking-wider underline underline-offset-2 transition-colors"
                >
                  VOLVER AL INICIO DE SESIÓN
                </button>
              </form>
            </div>
          ) : (
          <div className="px-8 py-7">
            {/* Aviso de acceso restringido — dinámico según módulo de origen */}
            {reason === 'requires-auth' && !error && (
              <div className="mb-5 px-4 py-3 rounded-lg bg-[rgba(56,189,248,0.1)] border border-[rgba(56,189,248,0.3)] text-[#38bdf8] text-xs font-mono">
                <span className="font-bold">
                  ACCESO RESTRINGIDO · MÓDULO {moduleCode ?? '—'} — {moduleName ?? 'Módulo'}
                </span>
                <p className="mt-1 font-normal">
                  {moduleName ?? 'Este módulo'} requiere una cuenta activa. Inicia sesión o crea una cuenta para continuar.
                </p>
              </div>
            )}

            {/* Aviso de registro pendiente de aprobación */}
            {pendingMsg && !error && (
              <div className="mb-5 px-4 py-3 rounded-lg bg-[rgba(56,189,248,0.1)] border border-[rgba(56,189,248,0.3)] text-[#38bdf8] text-xs font-mono">
                <span className="font-bold">CUENTA CREADA · PENDIENTE DE APROBACIÓN</span>
                <p className="mt-1 font-normal">{pendingMsg}</p>
              </div>
            )}

            {/* Alerta de error */}
            {error && (
              <div className="mb-5 px-4 py-3 rounded-lg bg-[rgba(248,113,113,0.1)] border border-[rgba(248,113,113,0.3)] text-[#f87171] text-xs font-mono">
                <span className="font-bold">ALERTA DE SEGURIDAD:</span> {error}
              </div>
            )}

            {/* ── FORMULARIO INGRESO ── */}
            {!esRegistro && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#557997] uppercase tracking-widest mb-1.5">
                    IDENTIFICADOR DE ACCESO
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="operador@institucion.gov"
                    required
                    autoComplete="email"
                    className="w-full px-3 py-2.5 bg-[#0b1326] border border-[#1a3a50] rounded-lg text-[#c8d8e8] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#557997] uppercase tracking-widest mb-1.5">
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
                      className="w-full px-3 py-2.5 pr-10 bg-[#0b1326] border border-[#1a3a50] rounded-lg text-[#c8d8e8] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                    />
                    <button
                      type="button"
                      onMouseDown={() => setShowPwd(true)}
                      onMouseUp={() => setShowPwd(false)}
                      onMouseLeave={() => setShowPwd(false)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#557997] hover:text-[#c8d8e8]"
                      tabIndex={-1}
                    >
                      {showPwd ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <label className="flex items-center gap-2 text-[10px] font-mono text-[#557997] uppercase tracking-wider cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={recordar}
                        onChange={e => setRecordar(e.target.checked)}
                        className="accent-[#38bdf8]"
                      />
                      RECORDARME
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowRecovery(true)}
                      className="text-[10px] font-mono text-[#557997] hover:text-secondary uppercase tracking-wider underline underline-offset-2 transition-colors"
                    >
                      RECUPERAR CREDENCIALES
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="lp-btn-primary w-full bg-[#131b2e] text-[#38bdf8] border border-[rgba(56,189,248,0.35)] py-2.5 rounded-lg font-mono font-bold text-xs uppercase tracking-widest hover:bg-[#1a2a40] hover:border-[rgba(56,189,248,0.65)] disabled:opacity-40 mt-2"
                >
                  {loading ? 'AUTENTICANDO...' : 'EJECUTAR AUTENTICACIÓN'}
                </button>
              </form>
            )}

            {/* ── FORMULARIO REGISTRO — solo correo + clave, sin pedir nombre ── */}
            {esRegistro && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#557997] uppercase tracking-widest mb-1.5">
                    CORREO ELECTRÓNICO
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="usuario@institucion.gov"
                    required
                    autoFocus
                    autoComplete="email"
                    className="w-full px-3 py-2.5 bg-[#0b1326] border border-[#1a3a50] rounded-lg text-[#c8d8e8] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold text-[#557997] uppercase tracking-widest mb-1.5">
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
                      className="w-full px-3 py-2.5 pr-10 bg-[#0b1326] border border-[#1a3a50] rounded-lg text-[#c8d8e8] text-sm placeholder-[#94a3b8] focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                    />
                    <button
                      type="button"
                      onMouseDown={() => setShowPwd(true)}
                      onMouseUp={() => setShowPwd(false)}
                      onMouseLeave={() => setShowPwd(false)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#557997] hover:text-[#c8d8e8]"
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
                  className="lp-btn-primary w-full bg-gradient-to-r from-[#38bdf8] to-[#0284c7] text-[#001c2e] py-2.5 rounded-lg font-mono font-bold text-xs uppercase tracking-widest disabled:opacity-40 mt-2"
                >
                  {loading ? 'REGISTRANDO...' : 'CREAR CUENTA Y CONTINUAR'}
                </button>
              </form>
            )}

            {/* Separador */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-[#1a3a50]" />
              <span className="text-[10px] font-mono text-[#557997] uppercase tracking-wider">o</span>
              <div className="flex-1 h-px bg-[#1a3a50]" />
            </div>

            {/* Demo — solo visible en modo login */}
            {!esRegistro && (
              <button
                onClick={handleDemo}
                className="lp-btn-secondary w-full py-2.5 rounded-lg border border-[#1a3a50] text-[#557997] text-xs font-mono font-semibold uppercase tracking-wider hover:bg-[#1a3a50] hover:text-[#8bafcf]"
              >
                ACCESO MODO DEMOSTRACIÓN
              </button>
            )}

            {/* Toggle login / registro */}
            <div className="flex justify-center mt-5 text-[10px] font-mono text-[#557997] uppercase tracking-wider">
              {esRegistro ? (
                <span>
                  ¿Ya tienes cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => switchModo('login')}
                    className="text-[#38bdf8] hover:text-[#0044a3] underline underline-offset-2 transition-colors font-bold"
                  >
                    INGRESAR
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => switchModo('registro')}
                  className="hover:text-[#38bdf8] underline underline-offset-2 transition-colors"
                >
                  CREAR NUEVA CUENTA
                </button>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
}
