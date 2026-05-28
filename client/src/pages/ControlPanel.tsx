import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

// ── Iconos ────────────────────────────────────────────────────────────────────
function IconArrowLeft() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  );
}

function IconUser() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function IconCpu() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
      <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  );
}

function IconShield() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function IconLock() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function IconUnlock() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
    </svg>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function ControlPanel() {
  const { user, logout, validateSessionAction, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Estado de motores SIE
  const [engines, setEngines] = useState({ perplexity: true, gemini: true });

  // Estado de validación de sesión administrativa
  const [sessionValidated, setSessionValidated]   = useState(false);
  const [validationPwd, setValidationPwd]         = useState('');
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError]     = useState('');
  const [showPwd, setShowPwd]                     = useState(false);

  function toggleEngine(id: keyof typeof engines) {
    if (!sessionValidated) return;
    setEngines(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleValidateSession(e: React.FormEvent) {
    e.preventDefault();
    setValidationLoading(true);
    setValidationError('');
    try {
      await validateSessionAction(validationPwd);
      setSessionValidated(true);
      setValidationPwd('');
    } catch (err: any) {
      setValidationError(err.message || 'CREDENCIALES INVÁLIDAS · ACCESO DENEGADO.');
    } finally {
      setValidationLoading(false);
    }
  }

  const MONTHLY_USED  = 12;
  const MONTHLY_LIMIT = 500;
  const progressPct   = Math.round((MONTHLY_USED / MONTHLY_LIMIT) * 100);

  const bothActive = engines.perplexity && engines.gemini;
  const oneActive  = engines.perplexity || engines.gemini;

  return (
    <div className="min-h-screen bg-[#f7f9fb] p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* ── Encabezado ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg text-[#76777d] hover:text-[#191c1e] hover:bg-[#eceef0] transition-colors"
              title="Volver al sistema principal"
            >
              <IconArrowLeft />
            </button>
            <div>
              <h1 className="text-lg font-bold text-[#191c1e] tracking-tight uppercase">
                CENTRO DE CONTROL OPERATIVO
              </h1>
              <p className="text-[10px] font-mono text-[#76777d] mt-0.5 uppercase tracking-wider">
                GESTIÓN DE SISTEMAS Y ACCESOS INSTITUCIONALES
              </p>
            </div>
          </div>
          {user && (
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="text-[10px] font-mono font-bold text-[#76777d] hover:text-red-600 uppercase tracking-wider transition-colors"
            >
              TERMINAR SESIÓN SEGURA
            </button>
          )}
        </div>

        {/* ── Tarjeta 1: Configuración de Accesos y Nodos ── */}
        <div className="bg-white rounded-xl border border-[#c6c6cd] overflow-hidden">
          {/* Cabecera de tarjeta */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[#eceef0]">
            <div className="p-2 bg-[#191c1e] rounded-lg text-white">
              <IconUser />
            </div>
            <div>
              <h2 className="font-bold text-[#191c1e] text-xs uppercase tracking-wider">
                CONFIGURACIÓN DE ACCESOS Y NODOS
              </h2>
              <p className="text-[10px] font-mono text-[#76777d] mt-0.5 uppercase tracking-wider">
                OPERADOR ACTIVO EN SESIÓN
              </p>
            </div>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div>
              <span className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1">
                IDENTIFICADOR DE SISTEMA
              </span>
              <div className="w-full px-3 py-2 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm font-mono select-all">
                {user?.email ?? '—'}
              </div>
            </div>
            <div>
              <span className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1">
                OPERADOR ASIGNADO
              </span>
              <div className="w-full px-3 py-2 bg-[#f7f9fb] border border-[#e2e8f0] rounded-lg text-[#191c1e] text-sm">
                {user?.nombre ?? '—'}
              </div>
            </div>
            <div>
              <span className="block text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-1">
                NIVEL DE AUTORIZACIÓN
              </span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                user?.role === 'admin'
                  ? 'bg-[#191c1e] text-white'
                  : 'bg-[#eceef0] text-[#45464d]'
              }`}>
                {user?.role === 'admin'
                  ? 'OPERADOR NIVEL-A · ADMINISTRADOR'
                  : 'OPERADOR NIVEL-B · USUARIO'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Tarjeta 2: Sistemas de Inteligencia Estratégica ── */}
        <div className="bg-white rounded-xl border border-[#c6c6cd] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#eceef0]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#191c1e] rounded-lg text-white">
                <IconCpu />
              </div>
              <div>
                <h2 className="font-bold text-[#191c1e] text-xs uppercase tracking-wider">
                  SISTEMAS DE INTELIGENCIA ESTRATÉGICA (SIE)
                </h2>
                <p className="text-[10px] font-mono text-[#76777d] mt-0.5 uppercase tracking-wider">
                  MOTORES OPERATIVOS DE ANÁLISIS INSTITUCIONAL
                </p>
              </div>
            </div>
            {sessionValidated && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(5,150,105,0.1)] text-[#065f46] text-[10px] font-mono font-bold uppercase">
                <IconUnlock /> SESIÓN VALIDADA
              </span>
            )}
          </div>

          <div className="px-5 py-4 space-y-3">
            {/* Bloqueo de sesión — visible hasta que el admin valide */}
            {!sessionValidated && (
              <div className="rounded-lg border border-[#e2e8f0] bg-[#f7f9fb] p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-[#191c1e] rounded-lg text-white shrink-0">
                    <IconLock />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono font-bold text-[#191c1e] uppercase tracking-wider">
                      ACCESO RESTRINGIDO · AUTENTICACIÓN REQUERIDA
                    </p>
                    <p className="text-[10px] text-[#76777d] mt-0.5">
                      {isAdmin
                        ? 'Valide su sesión administrativa para operar los SIE.'
                        : 'Se requiere nivel de autorización ADMINISTRADOR.'}
                    </p>
                  </div>
                </div>

                {isAdmin && (
                  <form onSubmit={handleValidateSession} className="space-y-2 pt-1">
                    <div className="relative">
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={validationPwd}
                        onChange={e => setValidationPwd(e.target.value)}
                        placeholder="CLAVE DE AUTENTICACIÓN"
                        required
                        autoComplete="current-password"
                        className="w-full px-3 py-2 pr-10 bg-white border border-[#c6c6cd] rounded-lg text-[#191c1e] text-sm font-mono placeholder-[#76777d] focus:outline-none focus:border-[#191c1e] focus:ring-1 focus:ring-[#191c1e] transition-colors"
                      />
                      <button
                        type="button"
                        onMouseDown={() => setShowPwd(true)}
                        onMouseUp={() => setShowPwd(false)}
                        onMouseLeave={() => setShowPwd(false)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#76777d]"
                        tabIndex={-1}
                      >
                        {showPwd ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[10px] font-mono text-red-600 uppercase tracking-wide">{validationError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={validationLoading || !validationPwd}
                      className="w-full bg-[#191c1e] text-white py-2 rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-[#2d3133] disabled:opacity-40 transition-colors"
                    >
                      {validationLoading ? 'VALIDANDO SESIÓN...' : 'VALIDAR SESIÓN ADMINISTRATIVA'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Filas de SIE — habilitadas solo tras validación */}
            {([
              { id: 'perplexity' as const, label: 'SIE-01 · PERPLEXITY AI',  desc: 'Búsqueda en tiempo real de convocatorias y financiamiento internacional' },
              { id: 'gemini'     as const, label: 'SIE-02 · GEMINI 1.5 PRO', desc: 'Análisis semántico, clasificación de fondos y scoring de oportunidades' },
            ]).map(({ id, label, desc }) => {
              const active = engines[id];
              return (
                <div
                  key={id}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
                    sessionValidated
                      ? 'bg-[#f7f9fb] border-[#e2e8f0]'
                      : 'bg-[#f7f9fb] border-[#e2e8f0] opacity-40 pointer-events-none'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono font-bold text-[#191c1e] uppercase tracking-wider">{label}</p>
                    <p className="text-[10px] text-[#76777d] mt-0.5">{desc}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
                      active
                        ? 'bg-[rgba(5,150,105,0.1)] text-[#065f46]'
                        : 'bg-[#eceef0] text-[#76777d]'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-emerald-500' : 'bg-[#94a3b8]'}`} />
                      {active ? 'OPERATIVO' : 'SUSPENDIDO'}
                    </span>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      aria-label={`${active ? 'Suspender' : 'Activar'} ${label}`}
                      onClick={() => toggleEngine(id)}
                      disabled={!sessionValidated}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed ${
                        active ? 'bg-emerald-500' : 'bg-[#cbd5e1]'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
                        active ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Banner de estado global */}
            <div className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
              bothActive
                ? 'bg-[rgba(5,150,105,0.04)] border-[rgba(5,150,105,0.15)]'
                : 'bg-[#f7f9fb] border-[#e2e8f0]'
            }`}>
              <p className={`text-[10px] font-mono font-bold uppercase tracking-wider ${
                bothActive ? 'text-[#065f46]' : 'text-[#76777d]'
              }`}>
                {bothActive
                  ? 'SIE PERPLEXITY AI Y GEMINI 1.5 PRO OPERATIVOS · CANAL SEGURO ACTIVO'
                  : oneActive
                  ? `SISTEMA PARCIAL · SOLO ${engines.perplexity ? 'SIE-01 PERPLEXITY AI' : 'SIE-02 GEMINI 1.5 PRO'} OPERATIVO`
                  : 'TODOS LOS SISTEMAS DE INTELIGENCIA SUSPENDIDOS'}
              </p>
              <span className={`shrink-0 ml-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono font-bold border uppercase tracking-wider ${
                bothActive
                  ? 'bg-[rgba(5,150,105,0.12)] text-[#065f46] border-[rgba(5,150,105,0.2)]'
                  : 'bg-[#eceef0] text-[#76777d] border-[#e2e8f0]'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${bothActive ? 'bg-emerald-500' : 'bg-[#94a3b8]'}`} />
                {bothActive
                  ? 'ESTADO: OPERATIVO · LICENCIA ENTERPRISE'
                  : 'ESTADO: PARCIAL'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Tarjeta 3: Nivel de Acceso y Cuotas Operativas ── */}
        <div className="bg-white rounded-xl border border-[#c6c6cd] overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[#eceef0]">
            <div className="p-2 bg-[#191c1e] rounded-lg text-white">
              <IconShield />
            </div>
            <div>
              <h2 className="font-bold text-[#191c1e] text-xs uppercase tracking-wider">
                NIVEL DE ACCESO Y CUOTAS OPERATIVAS
              </h2>
              <p className="text-[10px] font-mono text-[#76777d] mt-0.5 uppercase tracking-wider">
                CLASIFICACIÓN DEL PLAN ACTIVO
              </p>
            </div>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Clasificación */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#45464d] uppercase tracking-wider">CLASIFICACIÓN DE ACCESO</span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-[#191c1e] text-white uppercase tracking-wider">
                ENTERPRISE · CLASSIFIED
              </span>
            </div>

            {/* Consultas al sistema */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
                <span className="text-[#45464d]">CONSULTAS AL SISTEMA</span>
                <span className="font-bold text-[#191c1e]">{MONTHLY_USED} / {MONTHLY_LIMIT}</span>
              </div>
              <div className="w-full h-1.5 bg-[#e6e8ea] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#191c1e] transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[10px] font-mono text-[#76777d] uppercase tracking-wider">
                {MONTHLY_LIMIT - MONTHLY_USED} CONSULTAS DISPONIBLES · CICLO ACTIVO
              </p>
            </div>

            {/* Capacidades habilitadas */}
            <div className="pt-2 border-t border-[#e2e8f0]">
              <p className="text-[10px] font-mono font-bold text-[#45464d] uppercase tracking-widest mb-2">
                CAPACIDADES HABILITADAS · PLAN ENTERPRISE
              </p>
              <ul className="space-y-1.5">
                {[
                  'ACCESO IRRESTRICTO AL RADAR DE FONDOS 360',
                  'BÚSQUEDA EN TIEMPO REAL · MOTOR PERPLEXITY AI',
                  'ANÁLISIS SEMÁNTICO PROFUNDO · MOTOR GEMINI 1.5 PRO',
                  'EXPORTACIÓN DE REPORTES E INTELIGENCIA ESTRATÉGICA',
                  'SOPORTE PRIORITARIO · CANAL INSTITUCIONAL DEDICADO',
                ].map(feature => (
                  <li key={feature} className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span className="text-[10px] font-mono text-[#45464d] uppercase tracking-wide">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
