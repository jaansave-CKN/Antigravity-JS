import { useState, useEffect, useCallback } from 'react';
import type { Alert, AlertStats } from '../types';
import API_BASE from '../api';

export function useAlertas() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async (priority?: string) => {
    try {
      setLoading(true);
      const url = priority
        ? `${API_BASE}/notifications/alerts?priority=${priority}&limit=50`
        : `${API_BASE}/notifications/alerts?limit=50`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch alerts');
      const respText = await response.text();
      const data = JSON.parse(respText);
      setAlerts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/notifications/stats`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      const respText = await response.text();
      const data = JSON.parse(respText);
      setStats(data);
    } catch (err) {
      console.error('Error fetching alert stats:', err);
    }
  }, []);

  const acknowledgeAlert = useCallback(async (alertId: string, acknowledgedBy: string = 'admin') => {
    try {
      const response = await fetch(`${API_BASE}/notifications/${alertId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged_by: acknowledgedBy })
      });

      if (!response.ok) throw new Error('Failed to acknowledge alert');

      await fetchAlerts();
      await fetchStats();
      return true;
    } catch (err) {
      console.error('Error acknowledging alert:', err);
      return false;
    }
  }, [fetchAlerts, fetchStats]);

  const runTriggers = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/notifications/triggers/run`, {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to run triggers');

      await fetchAlerts();
      await fetchStats();
      return true;
    } catch (err) {
      console.error('Error running triggers:', err);
      return false;
    }
  }, [fetchAlerts, fetchStats]);

  const testNotification = useCallback(async (type: string = 'system_health', priority: string = 'high') => {
    try {
      const response = await fetch(`${API_BASE}/notifications/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          priority,
          title: 'Test Alert from RadarFondos',
          message: 'Esta es una alerta de prueba. El sistema de notificaciones está funcionando correctamente.'
        })
      });

      if (!response.ok) throw new Error('Failed to send test notification');
      const respText = await response.text();
      const data = JSON.parse(respText);
      await fetchAlerts();
      return data.alert_id;
    } catch (err) {
      console.error('Error sending test notification:', err);
      return null;
    }
  }, [fetchAlerts]);

  useEffect(() => {
    fetchAlerts();
    fetchStats();

    const interval = setInterval(() => {
      fetchStats();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchAlerts, fetchStats]);

  return {
    alerts,
    stats,
    loading,
    error,
    fetchAlerts,
    fetchStats,
    acknowledgeAlert,
    runTriggers,
    testNotification
  };
}