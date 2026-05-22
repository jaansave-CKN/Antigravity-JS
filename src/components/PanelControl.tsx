import { useState, useEffect } from 'react';
import { APICredentialInput, SchedulerStatus } from '../types';
import './PanelControl.css';

const STORAGE_KEY = 'panel_control_credentials_v1';
const SOURCES_KEY = 'panel_control_sources_v1';

function loadCredentials(): APICredentialInput {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : { google: '', notebooklm: '', perplexity: '', openai: '', gemini: '' };
  } catch {
    return { google: '', notebooklm: '', perplexity: '', openai: '', gemini: '' };
  }
}

function saveCredentials(creds: APICredentialInput) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch (e) {
    console.error('[PanelControl] Error saving credentials:', e);
  }
}

export const PanelControl = () => {
  const [credentials, setCredentials] = useState<APICredentialInput>(loadCredentials());
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus>({
    interval_hours: 6,
    sources_count: 0,
    active: false
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const stored = loadCredentials();
    setCredentials(stored);
    checkSchedulerStatus();
  }, []);

  const checkSchedulerStatus = async () => {
    try {
      const response = await fetch('/api/scheduler/status');
      if (response.ok) {
        const data = await response.json();
        setSchedulerStatus(data);
      }
    } catch (e) {
      console.error('[PanelControl] Error checking scheduler:', e);
    }
  };

  const handleInputChange = (key: keyof APICredentialInput, value: string) => {
    setCredentials(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('Guardando credenciales...');

    try {
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      if (response.ok) {
        saveCredentials(credentials);
        setMessage('Credenciales guardadas exitosamente');
      } else {
        setMessage('Error al guardar credenciales');
      }
    } catch (e) {
      setMessage('Error de conexión con el servidor');
    }

    setSaving(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleTestCredential = async (type: keyof APICredentialInput) => {
    if (!credentials[type]) {
      setMessage(`No hay credencial para probar ${type}`);
      return;
    }

    setTesting(type);
    setMessage(`Probando ${type}...`);

    try {
      const response = await fetch(`/api/credentials/test/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [type]: credentials[type] })
      });

      if (response.ok) {
        setMessage(`${type} validado correctamente`);
      } else {
        setMessage(`Error validando ${type}`);
      }
    } catch (e) {
      setMessage(`Error de conexión al validar ${type}`);
    }

    setTesting(null);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleRunNow = async () => {
    setMessage('Ejecutando rastreo manual...');
    try {
      const response = await fetch('/api/scheduler/run', { method: 'POST' });
      if (response.ok) {
        setMessage('Rastreo iniciado. Revise la bandeja de Prospectos en unos minutos.');
        checkSchedulerStatus();
      }
    } catch (e) {
      setMessage('Error al iniciar rastreo');
    }
    setTimeout(() => setMessage(''), 5000);
  };

  return (
    <div className="panel-control">
      <div className="panel-header">
        <h1>🎛️ PANEL DE CONTROL - CENTRO DE COMANDO C3</h1>
        <p>Configure credenciales API y controle el motor de rastreo autónomo</p>
      </div>

      <div className="panel-grid">
        <div className="card credentials-card">
          <h2>🔐 Credenciales API</h2>
          <p className="card-subtitle">Ingrese las claves de acceso para los servicios de IA y búsqueda</p>

          <div className="credential-field">
            <label>Google API Key</label>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={credentials.google || ''}
              onChange={(e) => handleInputChange('google', e.target.value)}
            />
            <button onClick={() => handleTestCredential('google')} disabled={testing === 'google'}>
              {testing === 'google' ? 'Probando...' : 'Validar'}
            </button>
          </div>

          <div className="credential-field">
            <label>NotebookLM API Key</label>
            <input
              type="password"
              placeholder="nb-..."
              value={credentials.notebooklm || ''}
              onChange={(e) => handleInputChange('notebooklm', e.target.value)}
            />
            <button onClick={() => handleTestCredential('notebooklm')} disabled={testing === 'notebooklm'}>
              {testing === 'notebooklm' ? 'Probando...' : 'Validar'}
            </button>
          </div>

          <div className="credential-field">
            <label>Perplexity API Key</label>
            <input
              type="password"
              placeholder="pplx-..."
              value={credentials.perplexity || ''}
              onChange={(e) => handleInputChange('perplexity', e.target.value)}
            />
            <button onClick={() => handleTestCredential('perplexity')} disabled={testing === 'perplexity'}>
              {testing === 'perplexity' ? 'Probando...' : 'Validar'}
            </button>
          </div>

          <div className="credential-field">
            <label>OpenAI API Key</label>
            <input
              type="password"
              placeholder="sk-..."
              value={credentials.openai || ''}
              onChange={(e) => handleInputChange('openai', e.target.value)}
            />
            <button onClick={() => handleTestCredential('openai')} disabled={testing === 'openai'}>
              {testing === 'openai' ? 'Probando...' : 'Validar'}
            </button>
          </div>

          <div className="credential-field">
            <label>Gemini API Key</label>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={credentials.gemini || ''}
              onChange={(e) => handleInputChange('gemini', e.target.value)}
            />
            <button onClick={() => handleTestCredential('gemini')} disabled={testing === 'gemini'}>
              {testing === 'gemini' ? 'Probando...' : 'Validar'}
            </button>
          </div>

          <button className="save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando...' : '💾 Guardar Credenciales'}
          </button>
        </div>

        <div className="card scheduler-card">
          <h2>🤖 Scheduler de Rastreo</h2>
          <p className="card-subtitle">Motor automático de recopilación cada 6 horas</p>

          <div className="scheduler-info">
            <div className="info-row">
              <span>Estado:</span>
              <span className={schedulerStatus.active ? 'status-active' : 'status-inactive'}>
                {schedulerStatus.active ? '🟢 Activo' : '🔴 Inactivo'}
              </span>
            </div>
            <div className="info-row">
              <span>Intervalo:</span>
              <span>{schedulerStatus.interval_hours} horas</span>
            </div>
            <div className="info-row">
              <span>Fuentes configuradas:</span>
              <span>{schedulerStatus.sources_count}</span>
            </div>
            {schedulerStatus.last_run && (
              <div className="info-row">
                <span>Última ejecución:</span>
                <span>{new Date(schedulerStatus.last_run).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="scheduler-actions">
            <button onClick={handleRunNow} className="run-now-btn">
              ▶ Ejecutar Rastreo Ahora
            </button>
          </div>
        </div>

        <div className="card workflow-card">
          <h2>🔄 Workflow de Rastreo</h2>
          <p className="card-subtitle">Proceso automático de convocatorias</p>

          <div className="workflow-steps">
            <div className="step">
              <span className="step-num">1</span>
              <span>Rastrea fuentes configuradas</span>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <span>Identifica convocatorias nuevas</span>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <span>Inserta en BD como "Pendientes de Revisión"</span>
            </div>
            <div className="step">
              <span className="step-num">4</span>
              <span>Notifica en Bandeja de Prospectos</span>
            </div>
          </div>

          <div className="target-table">
            <code>cola_validacion</code> (Estado: <code>pendiente</code>)
          </div>
        </div>

        <div className="card status-card">
          <h2>📊 Estado del Sistema</h2>
          {message && <div className="status-message">{message}</div>}
          <div className="features-list">
            <div className="feature">✅ Encriptación AES-256 para credenciales</div>
            <div className="feature">✅ Scheduler Python cada 6 horas</div>
            <div className="feature">✅ Auto-ingesta en <code>cola_validacion</code></div>
            <div className="feature">✅ API REST para gestión</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PanelControl;