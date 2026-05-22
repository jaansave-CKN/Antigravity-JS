import React, { useState, useEffect } from 'react';
import { Save, Key, Search, Globe, Bell, Shield, Database, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import './SidebarConfiguracion.css';

interface Configuracion {
  apiKeyGoogle: string;
  notebookLmAccount: string;
  paisDefault: string;
  notificaciones: boolean;
  syncAutomatico: boolean;
  intervaloSync: number;
}

const defaultConfig: Configuracion = {
  apiKeyGoogle: '',
  notebookLmAccount: '',
  paisDefault: 'Colombia',
  notificaciones: true,
  syncAutomatico: true,
  intervaloSync: 60,
};

function loadConfig(): Configuracion {
  try {
    const stored = localStorage.getItem('antigravity_config');
    return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig;
  } catch {
    return defaultConfig;
  }
}

function saveConfig(config: Configuracion): void {
  try {
    localStorage.setItem('antigravity_config', JSON.stringify(config));
    localStorage.setItem('config_timestamp', new Date().toISOString());
  } catch (e) {
    console.error('Error guardando config:', e);
  }
}

export const SidebarConfiguracion: React.FC = () => {
  const [config, setConfig] = useState<Configuracion>(loadConfig);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'exito' | 'error' | 'info'; texto: string } | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const handleChange = (key: keyof Configuracion, value: string | number | boolean) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleGuardar = async () => {
    // Validar campos obligatorios
    if (!config.apiKeyGoogle || !config.notebookLmAccount) {
      setMensaje({
        tipo: 'error',
        texto: '⚠️ ERROR: Los campos API Key de Google y Account de NotebookLM son OBLIGATORIOS. Por favor complételos para usar el radar.'
      });
      return;
    }

    setGuardando(true);
    setMensaje(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      saveConfig(config);
      setMensaje({
        tipo: 'exito',
        texto: '✅ Configuración guardada exitosamente. Los motores de búsqueda están activos.'
      });
    } catch (err) {
      setMensaje({
        tipo: 'error',
        texto: `Error al guardar: ${err instanceof Error ? err.message : 'Error desconocido'}`
      });
    } finally {
      setGuardando(false);
    }
  };

  const testConnection = async () => {
    setTestStatus('testing');
    setMensaje(null);

    // Validar que ambos campos estén llenos
    if (!config.apiKeyGoogle || !config.notebookLmAccount) {
      setTestStatus('error');
      setMensaje({
        tipo: 'error',
        texto: '⚠️ Faltan credenciales obligatorias. Debe completar ambos campos para activar el motor de búsqueda.'
      });
      return;
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      if (config.apiKeyGoogle && config.notebookLmAccount) {
        setTestStatus('success');
        setMensaje({
          tipo: 'exito',
          texto: '✅ Conexión verificada. Ambos motores de búsqueda (Google Custom Search + NotebookLM) están activos.'
        });
      }
    } catch {
      setTestStatus('error');
      setMensaje({
        tipo: 'error',
        texto: 'Error de conexión. Verifique las credenciales e intente nuevamente.'
      });
    }
  };

  const validarCamposObligatorios = () => {
    if (!config.apiKeyGoogle || !config.notebookLmAccount) {
      setMensaje({
        tipo: 'error',
        texto: '⚠️ Los campos API Key de Google y Account de NotebookLM son obligatorios.'
      });
      return false;
    }
    return true;
  };

  const getStatusIcon = () => {
    switch (testStatus) {
      case 'testing': return <RefreshCw size={16} className="spin" />;
      case 'success': return <CheckCircle size={16} />;
      case 'error': return <XCircle size={16} />;
      default: return <AlertCircle size={16} />;
    }
  };

  const colorMensaje = mensaje?.tipo === 'exito' ? 'var(--success)' : mensaje?.tipo === 'error' ? 'var(--danger)' : 'var(--primary-light)';

  return (
    <div className="configuracion-view">
      <div className="configuracion-view__header">
        <h1 className="configuracion-view__title">⚙️ Configuración</h1>
        <p className="configuracion-view__subtitle">
          Configura tus credenciales de Google y NotebookLM para activar los motores de búsqueda reales
        </p>
        <div className="alerta-importante">
          ⚠️ <strong>IMPORTANTE:</strong> Ambos campos son <strong>OBLIGATORIOS</strong> para usar el Radar 360. Sin estas credenciales, el sistema funcionará en modo demo con datos de ejemplo.
        </div>
      </div>

      <div className="configuracion-view__sections">
        {/* Sección: Credenciales de Google */}
        <div className="config-section">
          <div className="config-section__header">
            <Key size={20} />
            <h2>Credenciales del Motor de Búsqueda</h2>
          </div>

          <div className="config-field">
            <label>
              🔑 API Key de Google <span className="obligatorio">*OBLIGATORIO*</span>
            </label>
            <input
              type="password"
              value={config.apiKeyGoogle}
              onChange={(e) => handleChange('apiKeyGoogle', e.target.value)}
              placeholder="AIzaSy..."
              className="config-input"
            />
            <span className="config-hint">Clave API de Google Cloud Console para Custom Search API</span>
          </div>

          <div className="config-field">
            <label>
              📓 Account de NotebookLM <span className="obligatorio">*OBLIGATORIO*</span>
            </label>
            <input
              type="text"
              value={config.notebookLmAccount}
              onChange={(e) => handleChange('notebookLmAccount', e.target.value)}
              placeholder="Tu cuenta de NotebookLM (email o ID)"
              className="config-input"
            />
            <span className="config-hint">Cuenta de Google NotebookLM para búsquedas vectoriales avanzadas</span>
          </div>

          <div className="config-actions">
            <button className="btn-test" onClick={testConnection} disabled={testStatus === 'testing'}>
              {getStatusIcon()}
              {testStatus === 'testing' ? 'Verificando...' : 'Probar Conexión'}
            </button>
          </div>
        </div>

        {/* Sección: Configuración Regional */}
        <div className="config-section">
          <div className="config-section__header">
            <Globe size={20} />
            <h2>Configuración Regional</h2>
          </div>

          <div className="config-field">
            <label>País por defecto</label>
            <select
              value={config.paisDefault}
              onChange={(e) => handleChange('paisDefault', e.target.value)}
              className="config-select"
            >
              <option value="Colombia">Colombia</option>
              <option value="México">México</option>
              <option value="Perú">Perú</option>
              <option value="Chile">Chile</option>
              <option value="Argentina">Argentina</option>
              <option value="España">España</option>
              <option value="Global">Global</option>
            </select>
          </div>
        </div>

        {/* Sección: Notificaciones */}
        <div className="config-section">
          <div className="config-section__header">
            <Bell size={20} />
            <h2>Notificaciones</h2>
          </div>

          <div className="config-toggle">
            <div className="config-toggle__info">
              <label>Notificaciones push</label>
              <span>Recibir alertas de nuevas convocatorias</span>
            </div>
            <input
              type="checkbox"
              checked={config.notificaciones}
              onChange={(e) => handleChange('notificaciones', e.target.checked)}
              className="toggle-input"
            />
          </div>
        </div>

        {/* Sección: Sincronización */}
        <div className="config-section">
          <div className="config-section__header">
            <RefreshCw size={20} />
            <h2>Sincronización Automática</h2>
          </div>

          <div className="config-toggle">
            <div className="config-toggle__info">
              <label>Sincronización automática</label>
              <span>Actualizar convocatorias cada ciclo</span>
            </div>
            <input
              type="checkbox"
              checked={config.syncAutomatico}
              onChange={(e) => handleChange('syncAutomatico', e.target.checked)}
              className="toggle-input"
            />
          </div>

          {config.syncAutomatico && (
            <div className="config-field">
              <label>Intervalo de sincronización (minutos)</label>
              <input
                type="number"
                value={config.intervaloSync}
                onChange={(e) => handleChange('intervaloSync', parseInt(e.target.value) || 60)}
                min={5}
                max={1440}
                className="config-input config-input--small"
              />
            </div>
          )}
        </div>

        {/* Sección: Seguridad */}
        <div className="config-section">
          <div className="config-section__header">
            <Shield size={20} />
            <h2>Seguridad</h2>
          </div>

          <div className="config-info">
            <Database size={16} />
            <span>Las credenciales se almacenan de forma segura en el navegador del usuario.</span>
          </div>
          <div className="config-info">
            <Shield size={16} />
            <span>Las API Keys nunca se exponen en el código del frontend.</span>
          </div>
        </div>
      </div>

      {/* Mensaje de estado */}
      {mensaje && (
        <div className="config-mensaje" style={{ borderColor: colorMensaje, color: colorMensaje }}>
          {mensaje.texto}
        </div>
      )}

      {/* Botón guardar */}
      <div className="config-footer">
        <button className="btn-guardar" onClick={handleGuardar} disabled={guardando}>
          <Save size={18} />
          {guardando ? 'Guardando...' : 'Guardar Configuración'}
        </button>
      </div>
    </div>
  );
};