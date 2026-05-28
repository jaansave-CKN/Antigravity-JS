import { useState, useEffect, type ReactNode } from 'react';
import { taskQueue } from '../services/ai';
import { useDevAuth, isDevMode } from './DevAuthContext';
import { useAIOrchestrator } from '../hooks/useAIOrchestrator';

interface HealthMonitorProps {
  children: ReactNode;
}

export function HealthMonitor({ children }: HealthMonitorProps) {
  const { bypassMode, healthStatus, autoRecover } = useDevAuth();
  const { queueStatus, stats } = useAIOrchestrator();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    if (isDevMode) {
      console.log('[HealthMonitor] Modo desarrollo activo - bypass de auth');
      console.log('[HealthMonitor] TaskQueue:', queueStatus, '| Agentes:', stats.agents);
    }
  }, [queueStatus, stats.agents]);

  useEffect(() => {
    if (healthStatus === 'offline' || healthStatus === 'degraded') {
      const recoveryTaskId = taskQueue.submitTask({
        type: 'compilation',
        priority: 'critical',
        prompt: 'Error de backend detectado. Diagnosticar y resolver: Firebase Auth/Firestore, conexión API, errores de red.',
        context: { taskType: 'emergency-recovery' }
      });
      console.log(`[HealthMonitor] Tarea de recuperación creada: ${recoveryTaskId}`);
      
      autoRecover();
    }
  }, [healthStatus, autoRecover]);

  if (!mounted) {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" />
        <span>Inicializando RADAR 360...</span>
      </div>
    );
  }

  return (
    <>
      {bypassMode && (
        <div className="dev-mode-indicator" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
          color: 'white',
          padding: '4px 16px',
          fontSize: '12px',
          fontWeight: 500,
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>🔧 MODO DESARROLLO - Bypass de autenticación activo</span>
          <span>Agentes: {stats.agents} | Cola: {queueStatus} | Tasks: {stats.processing}/{stats.total}</span>
        </div>
      )}
      {children}
    </>
  );
}

export default HealthMonitor;