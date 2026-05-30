import { useState, useEffect, useCallback } from 'react';
import { useAIOrchestrator } from '../hooks/useAIOrchestrator';

const JUPYTER_STORAGE_KEY = 'radar_jupyter_config_v1';

interface JupyterConfig {
  notebookUrl: string;
  notebookToken: string;
  notebookConnected: boolean;
  lastCheck: string | null;
}

function loadJupyterConfig(): JupyterConfig {
  try {
    const stored = localStorage.getItem(JUPYTER_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { notebookUrl: 'http://localhost:8888', notebookToken: '', notebookConnected: false, lastCheck: null };
}

function saveJupyterConfig(cfg: JupyterConfig): void {
  try { localStorage.setItem(JUPYTER_STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

async function verifyJupyterToken(url: string, token: string): Promise<{ success: boolean; message: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${url}/api/status`, {
      headers: { Authorization: `token ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: true, message: `Servidor Jupyter OK · Kernel: ${data.kernelspecs?.default || 'default'}` };
    }
    if (response.status === 401) return { success: false, message: 'Token de Jupyter inválido (401)' };
    return { success: false, message: `Error HTTP: ${response.status}` };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError')
      return { success: false, message: 'Timeout: Servidor no responde (5s)' };
    return { success: false, message: `Error de conexión: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

export const ConfiguracionCredenciales = function ConfiguracionCredenciales() {
  const { stats } = useAIOrchestrator();

  // ── Jupyter state (persisted in localStorage) ─────────────────────────────
  const [notebookUrl, setNotebookUrl] = useState('http://localhost:8888');
  const [notebookToken, setNotebookToken] = useState('');
  const [notebookConnected, setNotebookConnected] = useState(false);
  const [checkingJupyter, setCheckingJupyter] = useState(false);

  // ── Google OAuth state (persisted server-side) ────────────────────────────
  const [googleConnectedAt, setGoogleConnectedAt] = useState<string | null>(null);
  const [googleStatusLoading, setGoogleStatusLoading] = useState(true);

  // ── Shared status bar ─────────────────────────────────────────────────────
  const [statusMsg, setStatusMsg] = useState('Verificando estado...');

  useEffect(() => {
    // Load Jupyter config from localStorage
    const cfg = loadJupyterConfig();
    setNotebookUrl(cfg.notebookUrl);
    setNotebookToken(cfg.notebookToken);
    setNotebookConnected(cfg.notebookConnected);

    // Fetch Google OAuth status from server
    const checkGoogleStatus = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token || token === 'demo-mode-token') {
        setGoogleStatusLoading(false);
        setStatusMsg('Modo Demo — conexión Google no disponible');
        return;
      }
      try {
        const res = await fetch('/api/auth/google/status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && data.connected) {
          setGoogleConnectedAt(data.connectedAt);
          setStatusMsg('IA Google sincronizada · Radar_Fondos_360 activo');
        } else {
          setStatusMsg('Pendiente: sincroniza tu IA con Google para activar el análisis.');
        }
      } catch {
        setStatusMsg('No se pudo verificar estado de Google.');
      }
      setGoogleStatusLoading(false);
    };

    checkGoogleStatus();
  }, []);

  const handleGoogleSync = useCallback(() => {
    window.location.href = '/api/auth/google';
  }, []);

  const handleGoogleRevoke = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    try {
      await fetch('/api/auth/google/revoke', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setGoogleConnectedAt(null);
      setStatusMsg('Conexión con Google desconectada.');
    } catch {
      setStatusMsg('Error al desconectar. Intenta de nuevo.');
    }
  }, []);

  const handleSaveNotebook = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notebookToken) {
      setStatusMsg('Error: Se requiere el Token de seguridad del Notebook.');
      return;
    }
    setCheckingJupyter(true);
    setStatusMsg('Verificando conexión con Jupyter Notebook...');
    const result = await verifyJupyterToken(notebookUrl, notebookToken);
    const cfg: JupyterConfig = {
      notebookUrl, notebookToken,
      notebookConnected: result.success,
      lastCheck: new Date().toISOString(),
    };
    saveJupyterConfig(cfg);
    setNotebookConnected(result.success);
    setStatusMsg(result.success ? result.message : `Error: ${result.message}`);
    setCheckingJupyter(false);
  }, [notebookUrl, notebookToken]);

  const googleSynced = !!googleConnectedAt;
  const orchestratorReady = googleSynced && notebookConnected;

  const getStatusColor = () => {
    if (orchestratorReady) return 'text-emerald-400';
    if (googleSynced || notebookConnected) return 'text-amber-400';
    return 'text-slate-400';
  };

  const getOrchestratorLabel = () => {
    const agentCount = stats.agents || 0;
    const tasks = (stats.processing || 0) + (stats.pending || 0);
    if (orchestratorReady) return `MODO RASTREO MÁXIMO ACTIVO | Agentes: ${agentCount} | Tareas: ${tasks}`;
    return `ORQUESTADOR EN STANDBY | Agentes: ${agentCount} | Tareas: ${tasks}`;
  };

  return (
    <div className="p-6 bg-slate-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-6 border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Centro de Control · Conexiones</h2>
        <p className="text-sm text-slate-500 mb-6">
          Vincula tu cuenta de Google para que los agentes de Radar Fondos 360 puedan operar con tu IA en un contexto aislado y seguro.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* ── MÓDULO GOOGLE OAUTH ── */}
          <div className="p-5 border border-slate-200 rounded-lg bg-slate-50 flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-700 mb-1">Sincronizar mi IA (Google)</h3>
              <p className="text-xs text-slate-500 mb-4">
                Autoriza al sistema a usar tu cuenta de Google para las llamadas a Gemini, garantizando que cada análisis
                opere en el contexto aislado <span className="font-mono font-medium">Radar_Fondos_360</span>.
              </p>

              {googleSynced && (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 mb-3">
                  <div className="font-semibold mb-0.5">Sincronizado</div>
                  <div className="text-emerald-600">
                    Activo desde: {new Date(googleConnectedAt!).toLocaleString('es-CO')}
                  </div>
                </div>
              )}
            </div>

            {googleStatusLoading ? (
              <div className="w-full py-3 px-4 rounded-md text-center text-sm text-slate-400 bg-slate-100">
                Verificando...
              </div>
            ) : googleSynced ? (
              <div className="space-y-2">
                <div className="w-full py-3 px-4 rounded-md font-semibold text-white text-center bg-emerald-600 cursor-default select-none">
                  Sincronizado con Google
                </div>
                <button
                  onClick={handleGoogleRevoke}
                  className="w-full py-2 px-4 rounded-md text-xs text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                >
                  Desconectar cuenta
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleSync}
                className="w-full py-3 px-4 rounded-md font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors text-sm"
              >
                Sincronizar mi IA (Google)
              </button>
            )}
          </div>

          {/* ── MÓDULO JUPYTER ── */}
          <div className="p-5 border border-slate-200 rounded-lg bg-slate-50">
            <h3 className="text-lg font-semibold text-slate-700 mb-1">Entorno Notebook / Local LM</h3>
            <p className="text-xs text-slate-500 mb-4">
              Establece el puente con el motor local de cómputo y el almacenamiento de binarios.
            </p>
            {notebookConnected && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 mb-3">
                Servidor Jupyter conectado
              </div>
            )}
            <form onSubmit={handleSaveNotebook} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">URL del Servidor</label>
                <input
                  type="text"
                  value={notebookUrl}
                  onChange={(e) => setNotebookUrl(e.target.value)}
                  className="mt-1 w-full p-2 border border-slate-300 rounded text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Token / Clave de Acceso</label>
                <input
                  type="password"
                  placeholder="Token de seguridad del servidor local"
                  value={notebookToken}
                  onChange={(e) => setNotebookToken(e.target.value)}
                  className="mt-1 w-full p-2 border border-slate-300 rounded text-sm bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={checkingJupyter}
                className="w-full bg-slate-800 text-white text-sm py-2 px-4 rounded hover:bg-slate-950 transition-colors disabled:opacity-50"
              >
                {checkingJupyter ? 'Verificando conexión...' : 'Vincular Servidor Local'}
              </button>
            </form>
          </div>
        </div>

        {/* ── BARRA DE ESTADO ── */}
        <div className="mt-6 p-3 bg-slate-800 rounded text-xs font-mono flex justify-between items-center">
          <span className={getStatusColor()}>{getOrchestratorLabel()}</span>
          <span className="text-slate-500">{statusMsg}</span>
        </div>
      </div>
    </div>
  );
};

export default ConfiguracionCredenciales;
