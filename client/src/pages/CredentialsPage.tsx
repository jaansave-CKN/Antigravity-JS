import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface Connector {
  id: string;
  label: string;
  description: string;
  category: string;
  prefix?: string;
}
interface SavedCred { id: string; service: string; label: string; updated_at: string; }
type LinkState = 'idle' | 'linking' | 'linked' | 'error' | 'expand';

// ── Conectores institucionales (lenguaje de canal, no de clave) ────────────────
const CONNECTORS: Connector[] = [
  {
    id:          'perplexity',
    label:       'Canal Perplexity Intelligence',
    description: 'Rastreo semántico en tiempo real de convocatorias de financiación pública.',
    category:    'Motor de Búsqueda',
    prefix:      'pplx-',
  },
  {
    id:          'serper',
    label:       'Canal Serper · Indexación Web',
    description: 'Indexación estructurada de convocatorias mediante búsqueda institucional.',
    category:    'Indexación Estratégica',
  },
  {
    id:          'groq',
    label:       'Canal Groq · Procesamiento Rápido',
    description: 'Inferencia de alta velocidad para análisis documental en batch.',
    category:    'Motor de Inferencia',
    prefix:      'gsk_',
  },
  {
    id:          'openai',
    label:       'Canal OpenAI · Clasificación',
    description: 'Enriquecimiento y clasificación semántica de datos de convocatorias.',
    category:    'Análisis Semántico',
    prefix:      'sk-',
  },
];

// ── StatusBadge ────────────────────────────────────────────────────────────────
function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'#10b981', display:'inline-block' }} />CANAL ACTIVO
    </span>
  ) : (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#f9fafb', color:'#6b7280', border:'1px solid #e5e7eb' }}>
      SIN VINCULAR
    </span>
  );
}

// ── Icono Google oficial ──────────────────────────────────────────────────────
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink:0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function CredentialsPage({ isOnboarding = false }: { isOnboarding?: boolean }) {
  const { token, refreshCredentialsStatus } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const mounted   = useRef(true);

  const [saved,       setSaved]       = useState<SavedCred[]>([]);
  const [inputs,      setInputs]      = useState<Record<string, string>>({});
  const [showToken,   setShowToken]   = useState<Record<string, boolean>>({});
  const [linkStates,  setLinkStates]  = useState<Record<string, LinkState>>({});
  const [fieldErrs,   setFieldErrs]   = useState<Record<string, string>>({});
  const [deleting,    setDeleting]    = useState<Record<string, boolean>>({});
  const [loadErr,     setLoadErr]     = useState('');

  // Google OAuth
  const [gConnectedAt, setGConnectedAt] = useState<string | null>(null);
  const [gLoading,     setGLoading]     = useState(true);
  const [gError,       setGError]       = useState('');
  const [gSynced,      setGSynced]      = useState(false);

  // ── Detectar callback OAuth desde URL ─────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status');
    if (status === 'success') setGSynced(true);
    if (status === 'error')   setGError('El Canal de Consulta no pudo vincularse. Intenta de nuevo.');
    if (status) navigate(location.pathname, { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cargar conectores vinculados ──────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    mounted.current = true;

    const load = async () => {
      if (token === 'demo-mode-token') return;
      try {
        const r    = await fetch('/api/credentials', { headers: { Authorization: `Bearer ${token}` } });
        const data = await r.json().catch(() => ({ success: false }));
        if (!mounted.current) return;
        if (data.success) setSaved(data.data ?? []);
        else setLoadErr(data.message || 'Error al cargar conectores.');
      } catch { if (mounted.current) setLoadErr('No se pudo conectar con el servidor.'); }
    };

    const checkGoogle = async () => {
      if (token === 'demo-mode-token') { if (mounted.current) setGLoading(false); return; }
      try {
        const r = await fetch('/api/auth/google/status', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json().catch(() => ({ success: false }));
        if (!mounted.current) return;
        if (d.success && d.connected) { setGConnectedAt(d.connectedAt ?? ''); setGSynced(true); }
      } catch {}
      finally { if (mounted.current) setGLoading(false); }
    };

    load();
    checkGoogle();
    return () => { mounted.current = false; };
  }, [token]);

  // ── Google OAuth handlers ─────────────────────────────────────────────────
  const handleGoogleLink = useCallback(() => {
    window.location.href = '/api/auth/google';
  }, []);

  const handleGoogleRevoke = useCallback(async () => {
    if (!token) return;
    setGError('');
    try {
      const r = await fetch('/api/auth/google/revoke', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({ success: false }));
      if (d.success) { setGConnectedAt(null); setGSynced(false); await refreshCredentialsStatus(); }
      else setGError(d.message || 'Error al desvincular.');
    } catch { setGError('Error de red al desvincular.'); }
  }, [token, refreshCredentialsStatus]);

  // ── Connector handlers ────────────────────────────────────────────────────
  const fetchSaved = useCallback(async () => {
    if (!token) return;
    try {
      const r    = await fetch('/api/credentials', { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => ({ success: false }));
      if (data.success) setSaved(data.data ?? []);
    } catch {}
  }, [token]);

  const isLinked    = (svc: string) => saved.some(s => s.service === svc);
  const linkedAt    = (svc: string) => saved.find(s => s.service === svc)?.updated_at ?? null;
  const setInput    = (svc: string, val: string) => {
    setInputs(p => ({ ...p, [svc]: val }));
    setFieldErrs(p => ({ ...p, [svc]: '' }));
  };
  const setLink     = (svc: string, state: LinkState) => setLinkStates(p => ({ ...p, [svc]: state }));

  async function handleLink(connector: Connector) {
    const raw = (inputs[connector.id] ?? '').trim();
    if (!raw) { setFieldErrs(p => ({ ...p, [connector.id]: 'Ingresa el token de autorización antes de vincular.' })); return; }
    if (connector.prefix && !raw.startsWith(connector.prefix)) {
      setFieldErrs(p => ({ ...p, [connector.id]: `El token debe comenzar con '${connector.prefix}'.` }));
      return;
    }
    setLink(connector.id, 'linking');
    try {
      const r    = await fetch('/api/credentials', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: connector.id, apiKey: raw, label: connector.label }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.message || 'Error al vincular.');
      setLink(connector.id, 'linked');
      setInputs(p => ({ ...p, [connector.id]: '' }));
      await fetchSaved();
      await refreshCredentialsStatus();
      setTimeout(() => setLink(connector.id, 'idle'), 3000);
    } catch (e: any) {
      setFieldErrs(p => ({ ...p, [connector.id]: e.message }));
      setLink(connector.id, 'error');
      setTimeout(() => setLink(connector.id, 'idle'), 3000);
    }
  }

  async function handleUnlink(svc: string) {
    if (!confirm('¿Desvincular este canal? La integración quedará inactiva.')) return;
    setDeleting(p => ({ ...p, [svc]: true }));
    try {
      await fetch(`/api/credentials/${svc}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      await fetchSaved();
      await refreshCredentialsStatus();
    } finally { setDeleting(p => ({ ...p, [svc]: false })); }
  }

  const activeCount = CONNECTORS.filter(c => isLinked(c.id)).length;
  const totalCount  = CONNECTORS.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex:1, maxWidth:1440, margin:'0 auto', width:'100%', padding:'0 16px' }}>
      <main style={{ flex:1, padding:'32px 24px', background:'#f2f4f6', minHeight:'100vh' }}>

        {/* Onboarding banner */}
        {isOnboarding && (
          <div style={{ marginBottom:24, padding:'16px 20px', borderRadius:8, border:'1px solid #0058be', background:'rgba(0,88,190,0.05)', display:'flex', alignItems:'flex-start', gap:12 }}>
            <span style={{ fontSize:22, flexShrink:0, marginTop:2 }}>⊞</span>
            <div>
              <p style={{ fontSize:13, fontWeight:700, color:'#0058be', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>
                Vincule sus canales institucionales para activar el análisis estratégico
              </p>
              <p style={{ fontSize:13, color:'#45464d' }}>
                Configure al menos un canal para habilitar el procesamiento automático de oportunidades de financiación.
              </p>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
          <div>
            <h1 style={{ fontSize:24, fontWeight:600, color:'#191c1e', lineHeight:'32px' }}>
              Canales Institucionales
            </h1>
            <p style={{ fontSize:12, fontFamily:'monospace', color:'#76777d', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:4 }}>
              {activeCount}/{totalCount} canales vinculados · Transmisión cifrada AES-256
            </p>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {!isOnboarding && (
              <button onClick={() => navigate('/settings')}
                style={{ height:36, padding:'0 16px', display:'flex', alignItems:'center', gap:6, border:'1px solid #c6c6cd', borderRadius:6, fontSize:12, fontFamily:'monospace', color:'#45464d', background:'white', cursor:'pointer', fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>
                ← Volver
              </button>
            )}
            {isOnboarding && activeCount > 0 && (
              <button onClick={() => navigate('/')}
                style={{ height:36, padding:'0 16px', display:'flex', alignItems:'center', gap:6, background:'#0058be', color:'white', border:'none', borderRadius:6, fontSize:12, fontFamily:'monospace', cursor:'pointer', fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase' }}>
                Comenzar a operar →
              </button>
            )}
          </div>
        </div>

        {loadErr && (
          <div style={{ marginBottom:24, padding:'12px 16px', borderRadius:6, background:'#fff4f4', border:'1px solid #ba1a1a', color:'#ba1a1a', fontSize:13, fontFamily:'monospace' }}>
            ⚠ {loadErr}
          </div>
        )}

        {/* Aviso de seguridad — sin términos técnicos */}
        <div style={{ marginBottom:24, padding:'12px 16px', borderRadius:6, border:'1px solid #c6c6cd', background:'white', display:'flex', alignItems:'flex-start', gap:8 }}>
          <span style={{ fontSize:16, color:'#76777d', flexShrink:0, marginTop:1 }}>🔒</span>
          <p style={{ fontSize:12, fontFamily:'monospace', color:'#45464d' }}>
            Toda autorización se transmite mediante canales seguros y se almacena en entorno cifrado.
            Los permisos solicitados son exclusivamente de <strong>lectura de consultas</strong> — sin acceso a datos personales ni historial externo.
          </p>
        </div>

        {/* ── Canal Google · IA Institucional (OAuth 2.0) ── */}
        <div style={{
          marginBottom:24,
          border:`2px solid ${gSynced ? '#22c55e44' : '#0058be33'}`,
          borderRadius:12, padding:22, background:'white',
          display:'flex', flexDirection:'column', gap:14,
        }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
            <GoogleIcon size={28} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <h3 style={{ fontSize:16, fontWeight:700, color:'#191c1e' }}>
                  Canal Google · Inteligencia Institucional
                </h3>
                {gSynced ? (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0' }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:'#10b981', display:'inline-block' }} />CANAL ACTIVO
                  </span>
                ) : (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 8px', borderRadius:999, background:'#f9fafb', color:'#6b7280', border:'1px solid #e5e7eb' }}>
                    SIN VINCULAR
                  </span>
                )}
              </div>
              <p style={{ fontSize:12, fontFamily:'monospace', color:'#45464d', marginTop:6, lineHeight:'1.6' }}>
                Autoriza el acceso de lectura para que el motor opere en el contexto aislado{' '}
                <code style={{ background:'#f2f4f6', padding:'1px 5px', borderRadius:3, fontSize:11 }}>Radar_Fondos_360</code>{' '}
                sin interferir con tu actividad personal.
              </p>
              {gConnectedAt && (
                <p style={{ fontSize:10, fontFamily:'monospace', color:'#76777d', marginTop:4 }}>
                  Canal activo desde: {new Date(gConnectedAt).toLocaleString('es-CO')}
                </p>
              )}
            </div>
          </div>

          {gError && (
            <p style={{ fontSize:11, fontFamily:'monospace', color:'#ba1a1a', background:'#fff4f4', border:'1px solid #ba1a1a', borderRadius:4, padding:'6px 10px' }}>
              {gError}
            </p>
          )}

          <div style={{ display:'flex', gap:8 }}>
            {gLoading ? (
              <div style={{ flex:1, height:44, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'#76777d', fontFamily:'monospace' }}>
                Verificando estado del canal…
              </div>
            ) : gSynced ? (
              <>
                <div style={{ flex:1, height:44, display:'flex', alignItems:'center', justifyContent:'center', gap:8, borderRadius:8, background:'#059669', color:'white', fontSize:12, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', userSelect:'none' }}>
                  <GoogleIcon size={16} />
                  Canal Vinculado con Éxito
                </div>
                <button onClick={handleGoogleRevoke}
                  style={{ height:44, padding:'0 14px', display:'flex', alignItems:'center', gap:6, border:'1px solid #c6c6cd', borderRadius:8, fontSize:11, fontFamily:'monospace', color:'#45464d', background:'white', cursor:'pointer', whiteSpace:'nowrap' }}>
                  Desvincular
                </button>
              </>
            ) : (
              <button onClick={handleGoogleLink}
                style={{
                  flex:1, height:44,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                  background:'white', color:'#3c4043',
                  border:'1.5px solid #dadce0', borderRadius:8,
                  fontSize:13, fontFamily:'system-ui, sans-serif', fontWeight:600,
                  letterSpacing:'0.01em', cursor:'pointer',
                  boxShadow:'0 1px 3px rgba(0,0,0,0.08)',
                  transition:'box-shadow .15s, border-color .15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#4285f4';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(66,133,244,0.20)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#dadce0';
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                }}
              >
                <GoogleIcon size={20} />
                Vincular Canal de Consulta Institucional
              </button>
            )}
          </div>
        </div>

        {/* ── Grid de canales adicionales ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
          {CONNECTORS.map(connector => {
            const linked      = isLinked(connector.id);
            const updAt       = linkedAt(connector.id);
            const ls          = linkStates[connector.id] ?? 'idle';
            const err         = fieldErrs[connector.id];
            const isExpanded  = ls === 'expand' || (!linked && ls === 'idle' && !!inputs[connector.id]);

            return (
              <div key={connector.id} style={{
                display:'flex', flexDirection:'column',
                border:`1px solid ${linked ? 'rgba(5,150,105,0.35)' : '#e5e7eb'}`,
                borderRadius:10, background:'white', padding:18, gap:12,
              }}>

                {/* Header */}
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:4 }}>
                      <span style={{ fontSize:8, fontFamily:'monospace', fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.1em' }}>
                        {connector.category}
                      </span>
                      <StatusBadge active={linked} />
                    </div>
                    <h3 style={{ fontSize:14, fontWeight:700, color:'#191c1e', marginBottom:4 }}>{connector.label}</h3>
                    <p style={{ fontSize:11, fontFamily:'monospace', color:'#6b7280', lineHeight:'1.5' }}>{connector.description}</p>
                    {linked && updAt && (
                      <p style={{ fontSize:9, fontFamily:'monospace', color:'#9ca3af', marginTop:4 }}>
                        Vinculado: {new Date(updAt).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' })}
                      </p>
                    )}
                  </div>
                  {linked && (
                    <button onClick={() => handleUnlink(connector.id)} disabled={deleting[connector.id]}
                      title="Desvincular canal"
                      style={{ width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:4, border:'none', background:'transparent', cursor:'pointer', color:'#9ca3af', flexShrink:0, fontSize:14 }}>
                      {deleting[connector.id] ? '…' : '✕'}
                    </button>
                  )}
                </div>

                {/* ── Si está vinculado: estado success ── */}
                {linked && (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, height:40, borderRadius:8, background:'rgba(5,150,105,0.06)', border:'1px solid rgba(5,150,105,0.25)', fontSize:12, fontFamily:'monospace', fontWeight:700, color:'#059669', letterSpacing:'0.05em', textTransform:'uppercase' }}>
                    ✓ Canal Institucional Activo
                  </div>
                )}

                {/* ── Si no está vinculado: botón principal + expansible ── */}
                {!linked && (
                  <>
                    {!isExpanded ? (
                      <button
                        onClick={() => setLink(connector.id, 'expand')}
                        style={{
                          width:'100%', height:42,
                          display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                          borderRadius:8, border:'1.5px solid #0058be',
                          background:'white', color:'#0058be',
                          fontSize:12, fontFamily:'monospace', fontWeight:700,
                          letterSpacing:'0.04em', cursor:'pointer',
                          transition:'background .15s, border-color .15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f6ff'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'white'; }}
                      >
                        ⊞ Vincular Canal de Consulta Institucional
                      </button>
                    ) : (
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {/* Token input — sin etiqueta "API" */}
                        <div style={{ position:'relative' }}>
                          <input
                            type={showToken[connector.id] ? 'text' : 'password'}
                            value={inputs[connector.id] ?? ''}
                            onChange={e => setInput(connector.id, e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleLink(connector)}
                            placeholder="Token de autorización del canal…"
                            autoFocus
                            style={{
                              width:'100%', padding:'9px 40px 9px 12px',
                              fontSize:12, fontFamily:'monospace',
                              background:'#f9fafb', border:'1.5px solid #e5e7eb', borderRadius:7,
                              outline:'none', color:'#191c1e', boxSizing:'border-box',
                              transition:'border-color .15s',
                            }}
                            onFocus={e => e.target.style.borderColor = '#0058be'}
                            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
                            autoComplete="off" spellCheck={false}
                          />
                          <button
                            type="button"
                            onClick={() => setShowToken(p => ({ ...p, [connector.id]: !p[connector.id] }))}
                            style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', border:'none', background:'transparent', cursor:'pointer', color:'#9ca3af', padding:0, fontSize:13 }}
                            tabIndex={-1}
                          >
                            {showToken[connector.id] ? '●' : '○'}
                          </button>
                        </div>

                        {err && <p style={{ fontSize:10, color:'#ba1a1a', fontFamily:'monospace' }}>{err}</p>}

                        <div style={{ display:'flex', gap:8 }}>
                           <button
                             onClick={() => handleLink(connector)}
                             disabled={false}
                             style={{
                               flex:1, height:38, borderRadius:7, border:'none', cursor:'pointer',
                               fontSize:11, fontFamily:'monospace', fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase',
                               background: '#0058be',
                               color:'white', opacity: 1, transition:'background .2s',
                             }}
                           >
                             Confirmar Vínculo
                           </button>
                          <button
                            onClick={() => { setLink(connector.id, 'idle'); setInput(connector.id, ''); }}
                            style={{ height:38, padding:'0 12px', border:'1px solid #e5e7eb', borderRadius:7, background:'white', color:'#6b7280', fontSize:11, fontFamily:'monospace', cursor:'pointer' }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Estado global */}
        {activeCount === totalCount && (
          <div style={{ marginTop:24, padding:'16px 20px', borderRadius:8, border:'1px solid rgba(5,150,105,0.4)', background:'rgba(5,150,105,0.05)', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:20, color:'#059669' }}>✓</span>
            <p style={{ fontSize:13, color:'#059669', fontWeight:700 }}>
              Todos los canales institucionales vinculados — Sistema operativo al 100%.
            </p>
          </div>
        )}

      </main>
    </div>
  );
}
