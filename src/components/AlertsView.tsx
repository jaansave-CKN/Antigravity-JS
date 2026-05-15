import { useAlertas } from '../hooks/useAlertas';
import { Bell, CheckCircle, AlertTriangle, XCircle, Clock, RefreshCw, Zap, Send } from 'lucide-react';
import { useState } from 'react';
import './AlertsView.css';

const priorityColors = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a'
};

const priorityIcons = {
  critical: <XCircle size={18} />,
  high: <AlertTriangle size={18} />,
  medium: <Bell size={18} />,
  low: <CheckCircle size={18} />
};

export default function AlertsView() {
  const { alerts, stats, loading, error, acknowledgeAlert, runTriggers, testNotification, fetchAlerts } = useAlertas();
  const [filterPriority, setFilterPriority] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const filteredAlerts = filterPriority
    ? alerts.filter(a => a.priority === filterPriority)
    : alerts;

  const handleTestNotification = async () => {
    setTesting(true);
    await testNotification('system_health', 'high');
    setTesting(false);
  };

  const handleRunTriggers = async () => {
    await runTriggers();
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor(diff / 60000);

    if (hours > 24) return date.toLocaleDateString('es-CO');
    if (hours > 0) return `hace ${hours}h`;
    if (minutes > 0) return `hace ${minutes}m`;
    return 'ahora';
  };

  if (loading && !alerts.length) {
    return (
      <div className="alerts-view">
        <div className="alerts-loading">
          <RefreshCw className="animate-spin" size={32} />
          <p>Cargando alertas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="alerts-view">
      <div className="alerts-header">
        <div className="alerts-stats">
          <div className="stat-card stat-critical">
            <XCircle size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.critical || 0}</span>
              <span className="stat-label">Críticas</span>
            </div>
          </div>
          <div className="stat-card stat-high">
            <AlertTriangle size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.high || 0}</span>
              <span className="stat-label">Altas</span>
            </div>
          </div>
          <div className="stat-card stat-active">
            <Bell size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.active || 0}</span>
              <span className="stat-label">Activas</span>
            </div>
          </div>
          <div className="stat-card stat-resolved">
            <CheckCircle size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.resolved || 0}</span>
              <span className="stat-label">Resueltas</span>
            </div>
          </div>
          <div className="stat-card stat-24h">
            <Clock size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.last_24h || 0}</span>
              <span className="stat-label">Últimas 24h</span>
            </div>
          </div>
        </div>

        <div className="alerts-actions">
          <button className="btn-action" onClick={handleRunTriggers} title="Ejecutar triggers">
            <Zap size={18} />
            <span>Ejecutar Triggers</span>
          </button>
          <button className="btn-action btn-secondary" onClick={handleTestNotification} disabled={testing} title="Enviar alerta de prueba">
            <Send size={18} />
            <span>{testing ? 'Enviando...' : 'Test Notif'}</span>
          </button>
          <button className="btn-action" onClick={() => fetchAlerts()} title="Actualizar">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="alerts-filters">
        <button
          className={`filter-btn ${!filterPriority ? 'active' : ''}`}
          onClick={() => setFilterPriority(null)}
        >
          Todas
        </button>
        <button
          className={`filter-btn filter-critical ${filterPriority === 'critical' ? 'active' : ''}`}
          onClick={() => setFilterPriority('critical')}
        >
          Críticas
        </button>
        <button
          className={`filter-btn filter-high ${filterPriority === 'high' ? 'active' : ''}`}
          onClick={() => setFilterPriority('high')}
        >
          Altas
        </button>
        <button
          className={`filter-btn filter-medium ${filterPriority === 'medium' ? 'active' : ''}`}
          onClick={() => setFilterPriority('medium')}
        >
          Medias
        </button>
        <button
          className={`filter-btn filter-low ${filterPriority === 'low' ? 'active' : ''}`}
          onClick={() => setFilterPriority('low')}
        >
          Bajas
        </button>
      </div>

      {error && (
        <div className="alerts-error">
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="alerts-list">
        {filteredAlerts.length === 0 ? (
          <div className="alerts-empty">
            <Bell size={48} />
            <h3>No hay alertas</h3>
            <p>El sistema está operando sin problemas</p>
          </div>
        ) : (
          filteredAlerts.map(alert => (
            <div
              key={alert.id}
              className={`alert-card alert-${alert.priority}`}
              style={{ '--priority-color': priorityColors[alert.priority] } as React.CSSProperties}
            >
              <div className="alert-card-header">
                <div className="alert-priority-icon" style={{ color: priorityColors[alert.priority] }}>
                  {priorityIcons[alert.priority]}
                </div>
                <div className="alert-info">
                  <h3 className="alert-title">{alert.title}</h3>
                  <div className="alert-meta">
                    <span className="alert-type">{alert.type}</span>
                    {alert.escalation_level > 0 && (
                      <span className="alert-escalation">↗️ Nivel {alert.escalation_level}</span>
                    )}
                    <span className="alert-time">
                      <Clock size={14} />
                      {formatTimestamp(alert.timestamp)}
                    </span>
                  </div>
                </div>
              </div>

              <p className="alert-message">{alert.message}</p>

              {Object.keys(alert.data).length > 0 && (
                <div className="alert-data">
                  {Object.entries(alert.data).map(([key, value]) => (
                    <span key={key} className="alert-data-item">
                      <strong>{key}:</strong> {String(value)}
                    </span>
                  ))}
                </div>
              )}

              {!alert.acknowledged && (
                <div className="alert-actions">
                  <button
                    className="btn-acknowledge"
                    onClick={() => acknowledgeAlert(alert.id, 'admin')}
                  >
                    <CheckCircle size={16} />
                    Marcar como resuelta
                  </button>
                </div>
              )}

              {alert.acknowledged && (
                <div className="alert-acknowledged">
                  <CheckCircle size={14} />
                  <span>Resuelta por {alert.acknowledged_by || 'sistema'}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}