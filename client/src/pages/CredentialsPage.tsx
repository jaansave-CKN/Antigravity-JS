import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface Engine {
  id: string;
  label: string;
  description: string;
  placeholder: string;
  docs: string;
  prefix?: string;
}
interface SavedCred { id: string; service: string; label: string; updated_at: string; }
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ── Motores soportados (Gemini se gestiona por OAuth, no por API Key) ──────────
const ENGINES: Engine[] = [
  { id: 'perplexity', label: 'Perplexity AI',           description: 'Motor de búsqueda semántica en tiempo real para rastreo de oportunidades.', placeholder: 'pplx-…',                      docs: 'https://www.perplexity.ai/settings/api', prefix: 'pplx-' },
  { id: 'serper',     label: 'Serper (Google Search)',   description: 'Indexación de convocatorias públicas mediante búsqueda web estructurada.',  placeholder: 'Clave de 40 caracteres…',      docs: 'https://serper.dev/api-key' },
  { id: 'groq',       label: 'Groq',                     description: 'Inferencia de alta velocidad para procesamiento de documentos en batch.',    placeholder: 'gsk_…',                        docs: 'https://console.groq.com/keys', prefix: 'gsk_' },
  { id: 'openai',     label: 'OpenAI',                   description: 'Modelos GPT para clasificación y enriquecimiento de datos de convocatorias.', placeholder: 'sk-…',                        docs: 'https://platform.openai.com/api-keys', prefix: 'sk-' },
];

// ── StatusBadge ────────────────────────────────────────────────────────────────
function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'#10b981', display:'inline-block' }} />ACTIVO
    </span>
  ) : (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#fffbeb', color:'#92400e', border:'1px solid #fcd34d' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'#f59e0b', display:'inline-block' }} />SIN CONFIGURAR
    </span>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function CredentialsPage({ isOnboarding = false }: { isOnboarding?: boolean }) {
  const { token, refreshCredentialsStatus } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const mounted   = useRef(true);

  // API key state
  const [saved,      setSaved]      = useState<SavedCred[]>([]);
  const [inputs,     setInputs]     = useState<Record<string, string>>({});
  const [showKey,    setShowKey]    = useState<Record<string, boolean>>({});
  const [saveState,  setSaveState]  = useState<Record<string, SaveState>>({});
  const [fieldErrs,  setFieldErrs]  = useState<Record<string, string>>({});
  const [deleting,   setDeleting]   = useState<Record<string, boolean>>({});
  const [loadErr,    setLoadErr]    = useState('');

  // Google OAuth state
  const [gConnectedAt, setGConnectedAt] = useState<string | null>(null);
  const [gLoading,     setGLoading]     = useState(true);
  const [gError,       setGError]       = useState('');
  const [gSynced,      setGSynced]      = useState(false);

  // ── Detectar callback de OAuth desde la URL (/apis?status=success) ──────────
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status');
    if (status === 'success') setGSynced(true);
    if (status === 'error')   setGError('Error al conectar con Google. Intenta de nuevo.');
    if (status) {
      // Limpiar el param de la URL sin recargar la página
      navigate(location.pathname, { replace: true });
    }
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cargar credenciales guardadas ─────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    mounted.current = true;

    const load = async () => {
      if (token === 'demo-mode-token') return; // modo demo: no hay credenciales reales
      try {
        const r = await fetch('/api/credentials', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await r.json().catch(() => ({ success: false }));
        if (!mounted.current) return;
        if (data.success) setSaved(data.data ?? []);
        else setLoadErr(data.message || 'Error al cargar credenciales.');
      } catch {
        if (mounted.current) setLoadErr('No se pudo conectar con el servidor.');
      }
    };

    const checkGoogle = async () => {
      if (token === 'demo-mode-token') { if (mounted.current) setGLoading(false); return; }
      try {
        const r = await fetch('/api/auth/google/status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json().catch(() => ({ success: false }));
        if (!mounted.current) return;
        if (d.success && d.connected) {
          setGConnectedAt(d.connectedAt ?? '');
          setGSynced(true);
        }
      } catch { /* fallo silencioso — el botón se mostrará en estado "no conectado" */ }
      finally { if (mounted.current) setGLoading(false); }
    };

    load();
    checkGoogle();

    return () => { mounted.current = false; };
  }, [token]);

  // ── Google OAuth handlers ─────────────────────────────────────────────────
  const handleGoogleSync = useCallback(() => {
    window.location.href = '/api/auth/google';
  }, []);

  const handleGoogleRevoke = useCallback(async () => {
    if (!token) return;
    setGError('');
    try {
      const r = await fetch('/api/auth/google/revoke', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => ({ success: false }));
      if (d.success) {
        setGConnectedAt(null);
        setGSynced(false);
        await refreshCredentialsStatus();
      } else {
        setGError(d.message || 'Error al desconectar.');
      }
    } catch { setGError('Error de red al desconectar.'); }
  }, [token, refreshCredentialsStatus]);

  // ── API Key handlers ──────────────────────────────────────────────────────
  const fetchSaved = useCallback(async () => {
    if (!token) return;
    try {
      const r    = await fetch('/api/credentials', { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => ({ success: false }));
      if (data.success) setSaved(data.data ?? []);
    } catch {}
  }, [token]);

  const isConfigured  = (svc: string) => saved.some(s => s.service === svc);
  const configuredAt  = (svc: string) => saved.find(s => s.service === svc)?.updated_at ?? null;

  function setInput(svc: string, val: string) {
    setInputs(p => ({ ...p, [svc]: val }));
    setFieldErrs(p => ({ ...p, [svc]: '' }));
  }

  async function handleSave(engine: Engine) {
    const key = (inputs[engine.id] ?? '').trim();
    if (!key) { setFieldErrs(p => ({ ...p, [engine.id]: 'Ingresa la clave antes de guardar.' })); return; }
    if (engine.prefix && !key.startsWith(engine.prefix)) {
      setFieldErrs(p => ({ ...p, [engine.id]: `La clave debe comenzar con '${engine.prefix}'.` }));
      return;
    }
    setSaveState(p => ({ ...p, [engine.id]: 'saving' }));
    try {
      const r    = await fetch('/api/credentials', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: engine.id, apiKey: key, label: engine.label }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.message || 'Error al guardar.');
      setSaveState(p => ({ ...p, [engine.id]: 'saved' }));
      setInputs(p => ({ ...p, [engine.id]: '' }));
      await fetchSaved();
      await refreshCredentialsStatus();
      setTimeout(() => setSaveState(p => ({ ...p, [engine.id]: 'idle' })), 3000);
    } catch (e: any) {
      setFieldErrs(p => ({ ...p, [engine.id]: e.message }));
      setSaveState(p => ({ ...p, [engine.id]: 'error' }));
      setTimeout(() => setSaveState(p => ({ ...p, [engine.id]: 'idle' })), 3000);
    }
  }

  async function handleDelete(svc: string) {
    if (!confirm(`¿Eliminar credencial '${svc}'? Esta acción no se puede deshacer.`)) return;
    setDeleting(p => ({ ...p, [svc]: true }));
    try {
      await fetch(`/api/credentials/${svc}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      await fetchSaved();
      await refreshCredentialsStatus();
    } finally { setDeleting(p => ({ ...p, [svc]: false })); }
  }

  const configuredCount = ENGINES.filter(e => isConfigured(e.id)).length;

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex:1, maxWidth:1440, margin:'0 auto', width:'100%', padding:'0 16px' }}>
      <main style={{ flex:1, padding:'32px 24px', background:'#f2f4f6', minHeight:'100vh' }}>

        {/* Onboarding banner */}
        {isOnboarding && (
          <div style={{ marginBottom:24, padding:'16px 20px', borderRadius:8, border:'1px solid #0058be', background:'rgba(0,88,190,0.05)', display:'flex', alignItems:'flex-start', gap:12 }}>
            <span className="material-symbols-outlined" style={{ color:'#0058be', fontSize:22, flexShrink:0, marginTop:2 }}>settings_suggest</span>
            <div>
              <p style={{ fontSize:13, fontWeight:700, color:'#0058be', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Para comenzar a operar, vincule sus motores de inteligencia estratégica</p>
              <p style={{ fontSize:13, color:'#45464d' }}>Configure al menos un motor de IA para habilitar el análisis automático de convocatorias.</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
          <div>
            <h1 style={{ fontSize:24, fontWeight:600, color:'#191c1e', lineHeight:'32px' }}>Gestión de APIs</h1>
            <p style={{ fontSize:12, fontFamily:'monospace', color:'#76777d', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:4 }}>
              {configuredCount}/{ENGINES.length} motores configurados · Claves cifradas AES-256
            </p>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {!isOnboarding && (
              <button onClick={() => navigate('/settings')}
                style={{ height:36, padding:'0 16px', display:'flex', alignItems:'center', gap:6, border:'1px solid #c6c6cd', borderRadius:6, fontSize:12, fontFamily:'monospace', color:'#45464d', background:'white', cursor:'pointer', fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>
                <span className="material-symbols-outlined" style={{ fontSize:16 }}>arrow_back</span>Volver
              </button>
            )}
            {isOnboarding && configuredCount > 0 && (
              <button onClick={() => navigate('/')}
                style={{ height:36, padding:'0 16px', display:'flex', alignItems:'center', gap:6, background:'#0058be', color:'white', border:'none', borderRadius:6, fontSize:12, fontFamily:'monospace', cursor:'pointer', fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>
                Comenzar a operar
                <span className="material-symbols-outlined" style={{ fontSize:16 }}>arrow_forward</span>
              </button>
            )}
          </div>
        </div>

        {/* Error de carga */}
        {loadErr && (
          <div style={{ marginBottom:24, padding:'12px 16px', borderRadius:6, background:'#fff4f4', border:'1px solid #ba1a1a', color:'#ba1a1a', fontSize:13, fontFamily:'monospace', display:'flex', alignItems:'center', gap:8 }}>
            <span className="material-symbols-outlined" style={{ fontSize:18 }}>warning</span>{loadErr}
          </div>
        )}

        {/* Aviso de seguridad */}
        <div style={{ marginBottom:24, padding:'12px 16px', borderRadius:6, border:'1px solid #c6c6cd', background:'white', display:'flex', alignItems:'flex-start', gap:8 }}>
          <span className="material-symbols-outlined" style={{ fontSize:18, color:'#76777d', flexShrink:0, marginTop:1 }}>lock</span>
          <p style={{ fontSize:12, fontFamily:'monospace', color:'#45464d' }}>
            Las claves se cifran con <strong>AES-256-GCM</strong> antes de almacenarse. Nunca se transmiten en texto plano. Cada usuario gestiona sus propias credenciales de forma aislada.
          </p>
        </div>

        {/* ── Tarjeta Google OAuth (Gemini vía tu cuenta) ── */}
        <div style={{ marginBottom:24, border:`1px solid ${gSynced ? 'rgba(0,88,190,0.4)' : '#c6c6cd'}`, borderRadius:8, padding:20, background:'white', display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            {/* Google G Logo */}
            <svg width="24" height="24" viewBox="0 0 48 48" style={{ flexShrink:0, marginTop:2 }}>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <h3 style={{ fontSize:16, fontWeight:700, color:'#191c1e' }}>Google Gemini · IA de Radar Fondos</h3>
                {gSynced ? (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:'#10b981', display:'inline-block' }} />IA SINCRONIZADA
                  </span>
                ) : (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#fffbeb', color:'#92400e', border:'1px solid #fcd34d' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:'#f59e0b', display:'inline-block' }} />PENDIENTE
                  </span>
                )}
              </div>
              <p style={{ fontSize:12, fontFamily:'monospace', color:'#45464d', marginTop:4 }}>
                Autoriza tu cuenta Google para que el analizador opere en el contexto aislado{' '}
                <code style={{ background:'#f2f4f6', padding:'1px 4px', borderRadius:3 }}>Radar_Fondos_360</code>, sin contaminar tu historial personal.
              </p>
              {gConnectedAt && (
                <p style={{ fontSize:10, fontFamily:'monospace', color:'#76777d', marginTop:4 }}>
                  Activo desde: {new Date(gConnectedAt).toLocaleString('es-CO')}
                </p>
              )}
            </div>
          </div>

          {gError && (
            <p style={{ fontSize:11, fontFamily:'monospace', color:'#ba1a1a', background:'#fff4f4', border:'1px solid #ba1a1a', borderRadius:4, padding:'6px 10px' }}>{gError}</p>
          )}

          <div style={{ display:'flex', gap:8 }}>
            {gLoading ? (
              <div style={{ flex:1, height:36, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'#76777d' }}>
                Verificando conexión con Google…
              </div>
            ) : gSynced ? (
              <>
                <div style={{ flex:1, height:36, display:'flex', alignItems:'center', justifyContent:'center', gap:6, borderRadius:6, background:'#059669', color:'white', fontSize:12, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', userSelect:'none' }}>
                  <span className="material-symbols-outlined" style={{ fontSize:14 }}>check_circle</span>
                  IA Sincronizada con Éxito
                </div>
                <button onClick={handleGoogleRevoke}
                  style={{ height:36, padding:'0 12px', display:'flex', alignItems:'center', gap:6, border:'1px solid #c6c6cd', borderRadius:6, fontSize:11, fontFamily:'monospace', color:'#45464d', background:'white', cursor:'pointer', whiteSpace:'nowrap' }}
                  title="Desvincular cuenta de Google">
                  <span className="material-symbols-outlined" style={{ fontSize:14 }}>link_off</span>Desvincular
                </button>
              </>
            ) : (
              <button onClick={handleGoogleSync}
                style={{ flex:1, height:36, display:'flex', alignItems:'center', justifyContent:'center', gap:6, background:'#0058be', color:'white', border:'none', borderRadius:6, fontSize:12, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', cursor:'pointer' }}>
                <span className="material-symbols-outlined" style={{ fontSize:14 }}>sync</span>
                Sincronizar mi IA (Google)
              </button>
            )}
          </div>
        </div>

        {/* Grid de motores */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
          {ENGINES.map(engine => {
            const configured  = isConfigured(engine.id);
            const updatedAt   = configuredAt(engine.id);
            const currentSave = saveState[engine.id] ?? 'idle';
            const err         = fieldErrs[engine.id];

            return (
              <div key={engine.id}
                style={{ display:'flex', flexDirection:'column', border:`1px solid ${configured ? 'rgba(0,88,190,0.4)' : '#c6c6cd'}`, borderRadius:8, background:'white', padding:16, gap:8 }}>

                {/* Header del motor */}
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <h3 style={{ fontSize:14, fontWeight:700, color:'#191c1e' }}>{engine.label}</h3>
                      <StatusBadge configured={configured} />
                    </div>
                    <p style={{ fontSize:12, fontFamily:'monospace', color:'#45464d', marginTop:4 }}>{engine.description}</p>
                    {configured && updatedAt && (
                      <p style={{ fontSize:10, fontFamily:'monospace', color:'#76777d', marginTop:4 }}>
                        Actualizado: {new Date(updatedAt).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' })}
                      </p>
                    )}
                  </div>
                  {configured && (
                    <button onClick={() => handleDelete(engine.id)} disabled={deleting[engine.id]}
                      title="Eliminar credencial"
                      style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:4, border:'none', background:'transparent', cursor:'pointer', color:'#76777d', flexShrink:0 }}>
                      <span className="material-symbols-outlined" style={{ fontSize:14 }}>
                        {deleting[engine.id] ? 'hourglass_empty' : 'delete'}
                      </span>
                    </button>
                  )}
                </div>

                {/* Input de clave */}
                <div style={{ display:'flex', alignItems:'center', border:'1px solid #c6c6cd', borderRadius:6, overflow:'hidden', background:'#f2f4f6' }}>
                  <input
                    type={showKey[engine.id] ? 'text' : 'password'}
                    value={inputs[engine.id] ?? ''}
                    onChange={e => setInput(engine.id, e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave(engine)}
                    placeholder={configured ? '••••••  (nueva para reemplazar)' : engine.placeholder}
                    style={{ flex:1, padding:'8px 10px', fontSize:13, fontFamily:'monospace', background:'transparent', border:'none', outline:'none', color:'#191c1e' }}
                    autoComplete="off" spellCheck={false}
                  />
                  <button type="button" onClick={() => setShowKey(p => ({ ...p, [engine.id]: !p[engine.id] }))}
                    style={{ padding:'0 8px', border:'none', background:'transparent', cursor:'pointer', color:'#76777d' }} tabIndex={-1}>
                    <span className="material-symbols-outlined" style={{ fontSize:16 }}>
                      {showKey[engine.id] ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>

                {err && <p style={{ fontSize:11, color:'#ba1a1a', fontFamily:'monospace' }}>{err}</p>}

                {/* Acciones */}
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:'auto', paddingTop:4 }}>
                  <button onClick={() => handleSave(engine)} disabled={currentSave === 'saving'}
                    style={{ flex:1, height:36, display:'flex', alignItems:'center', justifyContent:'center', gap:6, borderRadius:6, border:'none', cursor:'pointer', fontSize:11, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase',
                      background: currentSave === 'saved' ? '#059669' : currentSave === 'error' ? '#ba1a1a' : '#0058be',
                      color: 'white', opacity: currentSave === 'saving' ? 0.6 : 1 }}>
                    <span className="material-symbols-outlined" style={{ fontSize:14 }}>
                      {currentSave === 'saving' ? 'hourglass_empty' : currentSave === 'saved' ? 'check' : currentSave === 'error' ? 'error' : 'save'}
                    </span>
                    {currentSave === 'saving' ? 'Guardando…' : currentSave === 'saved' ? 'Guardado' : currentSave === 'error' ? 'Error' : configured ? 'Actualizar' : 'Guardar clave'}
                  </button>
                  <a href={engine.docs} target="_blank" rel="noopener noreferrer"
                    style={{ height:36, padding:'0 12px', display:'flex', alignItems:'center', gap:6, border:'1px solid #c6c6cd', borderRadius:6, fontSize:11, fontFamily:'monospace', color:'#45464d', textDecoration:'none', whiteSpace:'nowrap', background:'white' }}>
                    <span className="material-symbols-outlined" style={{ fontSize:14 }}>open_in_new</span>Obtener clave
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Estado general */}
        {configuredCount === ENGINES.length && (
          <div style={{ marginTop:24, padding:'16px 20px', borderRadius:8, border:'1px solid rgba(0,88,190,0.4)', background:'rgba(0,88,190,0.05)', display:'flex', alignItems:'center', gap:8 }}>
            <span className="material-symbols-outlined" style={{ color:'#0058be', fontSize:20 }}>verified</span>
            <p style={{ fontSize:13, color:'#0058be', fontWeight:700 }}>Todos los motores configurados — Sistema operativo al 100%.</p>
          </div>
        )}
      </main>
    </div>
  );
}
