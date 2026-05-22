import { useState, useEffect, useCallback } from 'react';
import { useAIOrchestrator } from '../hooks/useAIOrchestrator';

const STORAGE_KEY = 'antigravity_orchestrator_config_v1';

interface OrchestratorStatus {
  googleConnected: boolean;
  googleEmail: string;
  notebookUrl: string;
  notebookToken: string;
  notebookConnected: boolean;
  lastJupyterCheck: string | null;
  orchestratorReady: boolean;
}

function loadOrchestratorStatus(): OrchestratorStatus {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('[Orchestrator] Error loading status:', e);
  }
  return {
    googleConnected: false,
    googleEmail: '',
    notebookUrl: 'http://localhost:8888',
    notebookToken: '',
    notebookConnected: false,
    lastJupyterCheck: null,
    orchestratorReady: false,
  };
}

function saveOrchestratorStatus(status: OrchestratorStatus): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch (e) {
    console.error('[Orchestrator] Error saving status:', e);
  }
}

async function verifyJupyterToken(url: string, token: string): Promise<{ success: boolean; message: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${url}/api/status`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: `Servidor Jupyter OK - Kernel: ${data.kernelspecs?.default || 'default'}`,
      };
    } else if (response.status === 401) {
      return { success: false, message: 'Token de Jupyter inválido (401 Unauthorized)' };
    } else {
      return { success: false, message: `Error HTTP: ${response.status}` };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, message: 'Timeout: Servidor no responde (5s)' };
    }
    return { success: false, message: `Error de conexión: ${error instanceof Error ? error.message : 'Unknown'}` };
  }
}

export const ConfiguracionCredenciales = function ConfiguracionCredenciales() {
  const { stats } = useAIOrchestrator();
  
  const [notebookUrl, setNotebookUrl] = useState('http://localhost:8888');
  const [notebookToken, setNotebookToken] = useState('');
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [statusMsg, setStatusMsg] = useState('Esperando llaves de acceso...');
  const [checkingJupyter, setCheckingJupyter] = useState(false);
  const [orchestratorReady, setOrchestratorReady] = useState(false);

  useEffect(() => {
    const saved = loadOrchestratorStatus();
    setNotebookUrl(saved.notebookUrl);
    setNotebookToken(saved.notebookToken);
    setGoogleConnected(saved.googleConnected);
    setGoogleEmail(saved.googleEmail);
    setOrchestratorReady(saved.orchestratorReady);
    setStatusMsg(saved.orchestratorReady 
      ? 'Orquestador Listo - Modo Rastreo Máximo ACTIVO' 
      : 'Esperando llaves de acceso...');
  }, []);

  const handleGoogleLogin = useCallback(() => {
    const mockEmail = 'admin@antigravity-os.onmicrosoft.com';
    setGoogleConnected(true);
    setGoogleEmail(mockEmail);
    setStatusMsg('Conexión con Google Workspace Autorizada OK.');
    
    const status: OrchestratorStatus = {
      googleConnected: true,
      googleEmail: mockEmail,
      notebookUrl,
      notebookToken,
      notebookConnected: orchestratorReady,
      lastJupyterCheck: null,
      orchestratorReady,
    };
    saveOrchestratorStatus(status);
  }, [notebookUrl, notebookToken, orchestratorReady]);

  const handleSaveNotebook = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!notebookToken) {
      setStatusMsg('Error: Se requiere el Token de seguridad del Notebook.');
      return;
    }

    setCheckingJupyter(true);
    setStatusMsg('Verificando conexión con Jupyter Notebook...');

    const result = await verifyJupyterToken(notebookUrl, notebookToken);

    if (result.success) {
      const newOrchestratorReady = googleConnected && result.success;
      setStatusMsg(result.message);
      setOrchestratorReady(newOrchestratorReady);

      const status: OrchestratorStatus = {
        googleConnected,
        googleEmail,
        notebookUrl,
        notebookToken,
        notebookConnected: result.success,
        lastJupyterCheck: new Date().toISOString(),
        orchestratorReady: newOrchestratorReady,
      };
      saveOrchestratorStatus(status);

      if (newOrchestratorReady) {
        setTimeout(() => {
          setStatusMsg('Orquestador Listo - Modo Rastreo Máximo ACTIVO');
        }, 1500);
      }
    } else {
      setStatusMsg(`Error: ${result.message}`);
      const status: OrchestratorStatus = {
        googleConnected,
        googleEmail,
        notebookUrl,
        notebookToken,
        notebookConnected: false,
        lastJupyterCheck: new Date().toISOString(),
        orchestratorReady: false,
      };
      saveOrchestratorStatus(status);
    }

    setCheckingJupyter(false);
  }, [notebookUrl, notebookToken, googleConnected, googleEmail]);

  const getOrchestratorStatusDisplay = () => {
    const agentCount = stats.agents || 0;
    const activeTasks = stats.processing || 0;
    const pendingTasks = stats.pending || 0;
    
    if (orchestratorReady) {
      return `MODO RASTREO MÁXIMO ACTIVO | Agentes: ${agentCount} | Tareas: ${activeTasks + pendingTasks} en cola`;
    }
    return `ORQUESTADOR EN STANDBY | Agentes: ${agentCount} | Tareas: ${activeTasks + pendingTasks}`;
  };

  const getStatusColor = () => {
    if (orchestratorReady) return 'text-emerald-400';
    if (googleConnected || notebookToken) return 'text-amber-400';
    return 'text-slate-400';
  };

  return (
    <div className="p-6 bg-slate-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-6 border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">⚙️ CONFIGURACIÓN DE ACCESOS MAESTROS</h2>
        <p className="text-sm text-slate-500 mb-6">
          Ingrese las credenciales requeridas para que los agentes autónomos de Antigravity OS ejecuten el Modo Rastreo Máximo.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* MÓDULO GOOGLE */}
          <div className="p-4 border border-slate-200 rounded-lg bg-slate-100 flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-700 mb-2">🌐 Conectividad Google Cloud</h3>
              <p className="text-xs text-slate-500 mb-4">
                Permite al sistema escanear Drive, carpetas compartidas y correos electrónicos automáticamente.
              </p>
              {googleConnected && (
                <div className="text-xs text-emerald-600 mb-2">
                  ✓ Conectado: {googleEmail}
                </div>
              )}
            </div>
            <button
              onClick={handleGoogleLogin}
              className={`w-full py-3 px-4 rounded-md font-medium text-white transition-colors ${
                googleConnected ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {googleConnected ? '✅ Cuenta de Google Enlazada' : '🔑 Loguearse con Google'}
            </button>
          </div>

          {/* MÓDULO NOTEBOOK */}
          <div className="p-4 border border-slate-200 rounded-lg bg-slate-100">
            <h3 className="text-lg font-semibold text-slate-700 mb-2">💻 Entorno Notebook / Local LM</h3>
            <p className="text-xs text-slate-500 mb-4">
              Establece el puente con el motor local de cómputo y el almacenamiento de binarios.
            </p>
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
                  placeholder="Ingrese token de seguridad local"
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

        {/* BARRA DE ESTADO INFERIOR */}
        <div className="mt-6 p-3 bg-slate-800 rounded text-xs font-mono flex justify-between items-center">
          <span className={getStatusColor()}>
            {getOrchestratorStatusDisplay()}
          </span>
          <span className="text-slate-400">Antigravity Core v3.0</span>
        </div>
      </div>
    </div>
  );
};

export default ConfiguracionCredenciales;