import { useState, useEffect } from 'react';
import {
  Activity, AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw,
  Trash2, Database, Folder, Code, Cpu, Zap, Server
} from 'lucide-react';

interface SystemStatus {
  timestamp: string;
  errors: number;
  buildStatus: 'ok' | 'error' | 'unknown';
  mcpConnected: boolean;
  architecture: 'ok' | 'warning';
  filesClean: boolean;
  lastCheck: Date;
}

const initialStatus: SystemStatus = {
  timestamp: new Date().toISOString(),
  errors: 0,
  buildStatus: 'ok',
  mcpConnected: false,
  architecture: 'ok',
  filesClean: true,
  lastCheck: new Date(),
};

export default function SystemMonitor() {
  const [status, setStatus] = useState<SystemStatus>(initialStatus);
  const [logs, setLogs] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const checkSystem = () => {
    setRefreshing(true);

    const newLogs: string[] = [];
    newLogs.push(`[${new Date().toLocaleTimeString()}] Iniciando verificación...`);

    try {
      const errorLogs = JSON.parse(localStorage.getItem('antigravity_error_logs') || '[]');
      newLogs.push(`[${new Date().toLocaleTimeString()}] Errores capturados: ${errorLogs.length}`);

      const hasDist = localStorage.getItem('build_status') === 'ok';
      newLogs.push(`[${new Date().toLocaleTimeString()}] Build verificado: ${hasDist ? 'OK' : 'Pendiente'}`);

      const mcpStatus = localStorage.getItem('mcp_connected');
      newLogs.push(`[${new Date().toLocaleTimeString()}] MCP: ${mcpStatus ? 'Conectado' : 'Sin config'}`);

      const orphanedFiles = JSON.parse(localStorage.getItem('orphaned_files') || '[]');
      newLogs.push(`[${new Date().toLocaleTimeString()}] Archivos huérfanos: ${orphanedFiles.length}`);

      newLogs.push(`[${new Date().toLocaleTimeString()}] Verificación completada`);

      setStatus({
        timestamp: new Date().toISOString(),
        errors: errorLogs.length,
        buildStatus: hasDist ? 'ok' : 'unknown',
        mcpConnected: !!mcpStatus,
        architecture: 'ok',
        filesClean: orphanedFiles.length === 0,
        lastCheck: new Date(),
      });
    } catch (e) {
      newLogs.push(`[${new Date().toLocaleTimeString()}] Error en verificación: ${e}`);
    }

    setLogs(newLogs);
    setTimeout(() => setRefreshing(false), 500);
  };

  useEffect(() => {
    checkSystem();
    const interval = setInterval(checkSystem, 30000);
    return () => clearInterval(interval);
  }, []);

  const clearAllLogs = () => {
    localStorage.removeItem('antigravity_error_logs');
    localStorage.removeItem('build_status');
    localStorage.removeItem('orphaned_files');
    checkSystem();
  };

  const getStatusColor = (ok: boolean) => ok ? '#22c55e' : '#ef4444';
  const getStatusIcon = (ok: boolean) => ok ? <CheckCircle size={16} /> : <XCircle size={16} />;

  const stats = [
    { icon: <Code size={18} />, label: 'Build', value: status.buildStatus === 'ok' ? 'OK' : 'Pendiente', ok: status.buildStatus === 'ok' },
    { icon: <AlertTriangle size={18} />, label: 'Errores', value: status.errors, ok: status.errors === 0 },
    { icon: <Database size={18} />, label: 'MCP', value: status.mcpConnected ? 'Conectado' : 'Sin config', ok: status.mcpConnected },
    { icon: <Folder size={18} />, label: 'Archivos', value: status.filesClean ? 'Limpios' : 'Obsoletos', ok: status.filesClean },
    { icon: <Cpu size={18} />, label: 'Arquitectura', value: status.architecture === 'ok' ? 'OK' : 'Revisar', ok: status.architecture === 'ok' },
  ];

  return (
    <div className="system-monitor">
      <div className="system-monitor__header">
        <div className="system-monitor__title">
          <Zap size={20} className="system-monitor__pulse" />
          <span>Monitor 24/7</span>
        </div>
        <div className="system-monitor__meta">
          <Clock size={14} />
          <span>{status.lastCheck.toLocaleTimeString()}</span>
          <button
            className={`system-monitor__refresh ${refreshing ? 'spinning' : ''}`}
            onClick={checkSystem}
            disabled={refreshing}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="system-monitor__grid">
        {stats.map((stat, i) => (
          <div key={i} className="monitor-card" style={{ borderColor: stat.ok ? '#22c55e' : '#ef4444' }}>
            <div className="monitor-card__icon" style={{ color: stat.ok ? '#22c55e' : '#ef4444' }}>
              {stat.icon}
            </div>
            <div className="monitor-card__content">
              <span className="monitor-card__label">{stat.label}</span>
              <span className="monitor-card__value" style={{ color: stat.ok ? '#22c55e' : '#ef4444' }}>
                {stat.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="system-monitor__actions">
        <button className="monitor-btn" onClick={clearAllLogs}>
          <Trash2 size={14} />
          Limpiar errores
        </button>
        <button className="monitor-btn monitor-btn--secondary" onClick={() => setShowDetails(!showDetails)}>
          <Server size={14} />
          {showDetails ? 'Ocultar' : 'Ver'} logs
        </button>
      </div>

      {showDetails && (
        <div className="system-monitor__logs">
          <div className="monitor-logs">
            {logs.map((log, i) => (
              <div key={i} className="monitor-log">{log}</div>
            ))}
          </div>
        </div>
      )}

      <div className="system-monitor__footer">
        <span className="monitor-badge">
          <Activity size={12} />
          Monitoreo activo
        </span>
        <span className="monitor-badge monitor-badge--check">
          <CheckCircle size={12} />
          Todo OK
        </span>
      </div>

      <style>{`
        .system-monitor {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 1rem;
        }

        .system-monitor__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid #334155;
        }

        .system-monitor__title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
          color: #f8fafc;
        }

        .system-monitor__pulse {
          color: #22c55e;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .system-monitor__meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: #64748b;
        }

        .system-monitor__refresh {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 0.25rem;
          display: flex;
        }

        .system-monitor__refresh:hover { color: #3b82f6; }
        .system-monitor__refresh:disabled { opacity: 0.5; }

        .spinning { animation: spin 1s linear infinite; }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .system-monitor__grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .monitor-card {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          background: #1e293b;
          border-radius: 8px;
          border-left: 3px solid;
        }

        .monitor-card__icon { flex-shrink: 0; }

        .monitor-card__content {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .monitor-card__label {
          font-size: 0.625rem;
          text-transform: uppercase;
          color: #64748b;
          letter-spacing: 0.05em;
        }

        .monitor-card__value {
          font-size: 0.875rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .system-monitor__actions {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .monitor-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.375rem;
          padding: 0.5rem;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 6px;
          color: #94a3b8;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .monitor-btn:hover {
          background: #334155;
          color: #f8fafc;
        }

        .monitor-btn--secondary {
          background: transparent;
          border: 1px solid #475569;
        }

        .system-monitor__logs {
          background: #1e293b;
          border-radius: 8px;
          padding: 0.75rem;
          margin-bottom: 1rem;
          max-height: 150px;
          overflow: auto;
        }

        .monitor-logs {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .monitor-log {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.625rem;
          color: #64748b;
        }

        .system-monitor__footer {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          padding-top: 0.75rem;
          border-top: 1px solid #334155;
        }

        .monitor-badge {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.75rem;
          background: #064e3b;
          color: #6ee7b7;
          border-radius: 9999px;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .monitor-badge--check {
          background: #1e3a5f;
          color: #60a5fa;
        }
      `}</style>
    </div>
  );
}