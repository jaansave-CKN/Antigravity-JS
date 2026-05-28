import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

// ── Motores soportados ─────────────────────────────────────────────────────────
const ENGINES: Engine[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Motor de IA generativa para análisis de convocatorias y síntesis estratégica.',
    placeholder: 'AIzaSy…',
    docs: 'https://aistudio.google.com/app/apikey',
    prefix: 'AIzaSy',
  },
  {
    id: 'perplexity',
    label: 'Perplexity AI',
    description: 'Motor de búsqueda semántica en tiempo real para rastreo de oportunidades.',
    placeholder: 'pplx-…',
    docs: 'https://www.perplexity.ai/settings/api',
    prefix: 'pplx-',
  },
  {
    id: 'serper',
    label: 'Serper (Google Search API)',
    description: 'Indexación de convocatorias públicas mediante búsqueda web estructurada.',
    placeholder: 'Clave de 40 caracteres…',
    docs: 'https://serper.dev/api-key',
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Inferencia de alta velocidad para procesamiento de documentos en batch.',
    placeholder: 'gsk_…',
    docs: 'https://console.groq.com/keys',
    prefix: 'gsk_',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Modelos GPT para clasificación y enriquecimiento de datos de convocatorias.',
    placeholder: 'sk-…',
    docs: 'https://platform.openai.com/api-keys',
    prefix: 'sk-',
  },
];

// ── StatusBadge ────────────────────────────────────────────────────────────────
function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />ACTIVO
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />SIN CONFIGURAR
    </span>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function CredentialsPage({ isOnboarding = false }: { isOnboarding?: boolean }) {
  const { token, refreshCredentialsStatus } = useAuth();
  const navigate = useNavigate();

  const [saved, setSaved]         = useState<SavedCred[]>([]);
  const [inputs, setInputs]       = useState<Record<string, string>>({});
  const [show, setShow]           = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [deleting, setDeleting]   = useState<Record<string, boolean>>({});
  const [loadErr, setLoadErr]     = useState('');

  useEffect(() => { fetchSaved(); }, []);

  async function fetchSaved() {
    try {
      const r = await fetch('/api/credentials', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.success) setSaved(data.data);
      else setLoadErr(data.message || 'Error al cargar credenciales.');
    } catch { setLoadErr('No se pudo conectar con el servidor.'); }
  }

  function isConfigured(service: string) {
    return saved.some(s => s.service === service);
  }

  function configuredAt(service: string) {
    return saved.find(s => s.service === service)?.updated_at ?? null;
  }

  function setInput(service: string, value: string) {
    setInputs(prev => ({ ...prev, [service]: value }));
    setErrors(prev => ({ ...prev, [service]: '' }));
  }

  async function handleSave(engine: Engine) {
    const key = (inputs[engine.id] ?? '').trim();
    if (!key) { setErrors(prev => ({ ...prev, [engine.id]: 'Ingresa la clave antes de guardar.' })); return; }
    if (engine.prefix && !key.startsWith(engine.prefix)) {
      setErrors(prev => ({ ...prev, [engine.id]: `La clave de ${engine.label} debe comenzar con '${engine.prefix}'.` }));
      return;
    }
    setSaveState(prev => ({ ...prev, [engine.id]: 'saving' }));
    try {
      const r = await fetch('/api/credentials', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: engine.id, apiKey: key, label: engine.label }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.message || 'Error al guardar.');
      setSaveState(prev => ({ ...prev, [engine.id]: 'saved' }));
      setInputs(prev => ({ ...prev, [engine.id]: '' }));
      await fetchSaved();
      await refreshCredentialsStatus();
      setTimeout(() => setSaveState(prev => ({ ...prev, [engine.id]: 'idle' })), 3000);
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [engine.id]: e.message }));
      setSaveState(prev => ({ ...prev, [engine.id]: 'error' }));
      setTimeout(() => setSaveState(prev => ({ ...prev, [engine.id]: 'idle' })), 3000);
    }
  }

  async function handleDelete(service: string) {
    if (!confirm(`¿Eliminar credencial '${service}'? Esta acción no se puede deshacer.`)) return;
    setDeleting(prev => ({ ...prev, [service]: true }));
    try {
      await fetch(`/api/credentials/${service}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchSaved();
      await refreshCredentialsStatus();
    } finally { setDeleting(prev => ({ ...prev, [service]: false })); }
  }

  const configuredCount = ENGINES.filter(e => isConfigured(e.id)).length;

  return (
    <div className="flex flex-1 max-w-container-max mx-auto w-full">
      <main className="flex-1 p-lg md:p-xl bg-surface-container-low min-h-full">

        {/* Banner de onboarding */}
        {isOnboarding && (
          <div className="mb-lg px-md py-4 rounded border border-secondary bg-secondary/5 flex items-start gap-sm">
            <span className="material-symbols-outlined text-secondary text-[22px] shrink-0 mt-0.5">settings_suggest</span>
            <div>
              <p className="text-body-sm font-bold text-secondary uppercase tracking-wider">Para comenzar a operar, vincule sus motores de inteligencia estratégica</p>
              <p className="text-body-sm text-on-surface-variant mt-xs">Configure al menos un motor de IA para habilitar el análisis automático de convocatorias.</p>
            </div>
          </div>
        )}

        {/* Encabezado */}
        <div className="flex items-center justify-between mb-lg">
          <div>
            <h1 className="text-headline-md font-headline-md text-on-surface">Gestión de APIs</h1>
            <p className="text-label-md font-label-md text-on-surface-variant mt-xs uppercase tracking-wider">
              {configuredCount}/{ENGINES.length} motores configurados · Claves cifradas AES-256
            </p>
          </div>
          {!isOnboarding && (
            <button
              onClick={() => navigate('/settings')}
              className="h-9 px-md flex items-center gap-xs border border-outline-variant rounded text-label-sm font-label-sm text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Volver
            </button>
          )}
          {isOnboarding && configuredCount > 0 && (
            <button
              onClick={() => navigate('/')}
              className="h-9 px-md flex items-center gap-xs bg-secondary text-on-secondary rounded text-label-sm font-label-sm uppercase tracking-wider hover:bg-secondary-container transition-colors"
            >
              Comenzar a operar
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          )}
        </div>

        {/* Error de carga */}
        {loadErr && (
          <div className="mb-lg px-md py-3 rounded bg-[#fff4f4] border border-error text-error text-body-sm font-mono flex items-center gap-sm">
            <span className="material-symbols-outlined text-[18px]">warning</span>
            {loadErr}
          </div>
        )}

        {/* Aviso de seguridad */}
        <div className="mb-lg px-md py-3 rounded border border-outline-variant bg-surface-container-lowest flex items-start gap-sm">
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0 mt-0.5">lock</span>
          <p className="text-label-sm font-label-sm text-on-surface-variant">
            Las claves se cifran con <strong>AES-256-GCM</strong> antes de almacenarse. Nunca se transmiten en texto plano ni se muestran completas. Cada usuario gestiona sus propias credenciales de forma aislada.
          </p>
        </div>

        {/* Grid de motores */}
        <div className="grid grid-cols-1 gap-md md:grid-cols-2">
          {ENGINES.map(engine => {
            const configured  = isConfigured(engine.id);
            const updatedAt   = configuredAt(engine.id);
            const currentSave = saveState[engine.id] ?? 'idle';
            const err         = errors[engine.id];

            return (
              <div
                key={engine.id}
                className={`flex flex-col border rounded bg-surface-container-lowest p-md gap-sm transition-colors ${configured ? 'border-secondary/40' : 'border-outline-variant'}`}
              >
                {/* Header del motor */}
                <div className="flex items-start justify-between gap-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-sm flex-wrap">
                      <h3 className="text-body-md font-bold text-on-surface">{engine.label}</h3>
                      <StatusBadge configured={configured} />
                    </div>
                    <p className="text-label-sm font-label-sm text-on-surface-variant mt-xs">{engine.description}</p>
                    {configured && updatedAt && (
                      <p className="text-[10px] font-mono text-on-surface-variant mt-xs">
                        Actualizado: {new Date(updatedAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  {configured && (
                    <button
                      onClick={() => handleDelete(engine.id)}
                      disabled={deleting[engine.id]}
                      title="Eliminar credencial"
                      className="w-7 h-7 flex items-center justify-center rounded text-on-surface-variant hover:text-error hover:bg-[#fff4f4] transition-colors shrink-0"
                    >
                      {deleting[engine.id]
                        ? <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                        : <span className="material-symbols-outlined text-[14px]">delete</span>
                      }
                    </button>
                  )}
                </div>

                {/* Input de clave */}
                <div className="flex items-center gap-xs border border-outline-variant rounded overflow-hidden bg-surface-container focus-within:border-secondary transition-colors">
                  <input
                    type={show[engine.id] ? 'text' : 'password'}
                    value={inputs[engine.id] ?? ''}
                    onChange={e => setInput(engine.id, e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave(engine)}
                    placeholder={configured ? '••••••  (ingresa nueva para reemplazar)' : engine.placeholder}
                    className="flex-1 px-sm py-2 text-body-sm bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/50 font-mono min-w-0"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShow(prev => ({ ...prev, [engine.id]: !prev[engine.id] }))}
                    className="px-2 text-on-surface-variant hover:text-on-surface transition-colors"
                    tabIndex={-1}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {show[engine.id] ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>

                {/* Error de validación */}
                {err && (
                  <p className="text-[11px] text-error font-mono">{err}</p>
                )}

                {/* Acciones */}
                <div className="flex items-center gap-sm mt-auto pt-xs">
                  <button
                    onClick={() => handleSave(engine)}
                    disabled={currentSave === 'saving'}
                    className={`flex-1 h-9 flex items-center justify-center gap-xs rounded text-label-sm font-label-sm uppercase tracking-wider transition-colors ${
                      currentSave === 'saved'
                        ? 'bg-emerald-600 text-white'
                        : currentSave === 'error'
                        ? 'bg-error text-on-error'
                        : 'bg-secondary text-on-secondary hover:bg-secondary-container'
                    } disabled:opacity-50`}
                  >
                    {currentSave === 'saving' && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                    {currentSave === 'saved'  && <span className="material-symbols-outlined text-[14px]">check</span>}
                    {currentSave === 'error'  && <span className="material-symbols-outlined text-[14px]">error</span>}
                    {currentSave === 'idle'   && <span className="material-symbols-outlined text-[14px]">save</span>}
                    {currentSave === 'saving' ? 'Guardando…' : currentSave === 'saved' ? 'Guardado' : currentSave === 'error' ? 'Error' : configured ? 'Actualizar' : 'Guardar clave'}
                  </button>
                  <a
                    href={engine.docs}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-9 px-sm flex items-center gap-xs border border-outline-variant rounded text-label-sm font-label-sm text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors whitespace-nowrap"
                  >
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    Obtener clave
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Estado general */}
        {configuredCount === ENGINES.length && (
          <div className="mt-lg px-md py-4 rounded border border-secondary/40 bg-secondary/5 flex items-center gap-sm">
            <span className="material-symbols-outlined text-secondary text-[20px]">verified</span>
            <p className="text-body-sm text-secondary font-bold">Todos los motores configurados — Sistema operativo al 100%.</p>
          </div>
        )}
      </main>
    </div>
  );
}
