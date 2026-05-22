import { useEffect, useCallback, useRef, useState } from 'react';

export interface AnexoNota {
  contenido: string;
  timestamp: string;
  entidad: string;
  referencia: string;
}

export interface AnexoItem {
  id: string;
  entidad: string;
  referencia: string;
  fuente: 'link' | 'cloud' | 'local';
  documento?: string;
  notas: string;
  notasJson?: AnexoNota;
  activo: boolean;
  actualizadoEn: string;
}

export interface AgentContextPayload {
  user_personal_notes: string;
  user_personal_notes_json: AnexoNota[];
  anexos_activos: AnexoItem[];
  timestamp: string;
  version: '1.0';
  agent: '001_minero' | '002_estratega';
}

export interface AgentActivity {
  agentId: string;
  active: boolean;
  lastRead: string;
  scanningNoteId?: string;
}

const STORAGE_KEY = 'radar360_anexos_context';
const AGENT_001_KEY = 'radar_minero_context';
const AGENT_002_KEY = 'radar_estratega_context';
const AGENT_ACTIVITY_KEY = 'radar360_agent_activity';

export function useAnexosAgentIntegration() {
  const [agentActivity, setAgentActivity] = useState<Record<string, AgentActivity>>({
    '001_minero': { agentId: '001_minero', active: false, lastRead: '' },
    '002_estratega': { agentId: '002_estratega', active: false, lastRead: '' }
  });
  
  const contextRef = useRef<AgentContextPayload | null>(null);
  const activityTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const buildContextPayload = useCallback((anexos: AnexoItem[], agent: '001_minero' | '002_estratega'): AgentContextPayload => {
    const notasJson: AnexoNota[] = anexos
      .filter(a => a.activo && a.notas.trim())
      .map(a => ({
        contenido: a.notas,
        timestamp: a.actualizadoEn,
        entidad: a.entidad,
        referencia: a.referencia
      }));

    const notasString = notasJson
      .map(n => `[${n.entidad}] ${n.referencia}: ${n.contenido}`)
      .join('\n');

    return {
      user_personal_notes: notasString,
      user_personal_notes_json: notasJson,
      anexos_activos: anexos.filter(a => a.activo),
      timestamp: new Date().toISOString(),
      version: '1.0',
      agent
    };
  }, []);

  const setAgentScanning = useCallback((agentId: string, noteId: string | undefined) => {
    setAgentActivity(prev => ({
      ...prev,
      [agentId]: {
        agentId,
        active: true,
        lastRead: new Date().toISOString(),
        scanningNoteId: noteId
      }
    }));

    if (activityTimers.current.has(agentId)) {
      clearTimeout(activityTimers.current.get(agentId));
    }

    const timer = setTimeout(() => {
      setAgentActivity(prev => ({
        ...prev,
        [agentId]: { ...prev[agentId], active: false, scanningNoteId: undefined }
      }));
    }, 2000);

    activityTimers.current.set(agentId, timer);
  }, []);

  const injectToAgent001 = useCallback((anexos: AnexoItem[]) => {
    const payload = buildContextPayload(anexos, '001_minero');
    if (typeof window !== 'undefined') {
      localStorage.setItem(AGENT_001_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent('agent_context_update', { 
        detail: { agent: '001_minero', payload } 
      }));
      setAgentScanning('001_minero', anexos.find(a => a.activo)?.id);
    }
  }, [buildContextPayload, setAgentScanning]);

  const injectToAgent002 = useCallback((anexos: AnexoItem[]) => {
    const payload = buildContextPayload(anexos, '002_estratega');
    contextRef.current = payload;
    
    if (typeof window !== 'undefined') {
      localStorage.setItem(AGENT_002_KEY, JSON.stringify(payload));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent('agent_context_update', { 
        detail: { agent: '002_estratega', payload } 
      }));
      setAgentScanning('002_estratega', anexos.find(a => a.activo)?.id);
    }
  }, [buildContextPayload, setAgentScanning]);

  const injectToAllAgents = useCallback((anexos: AnexoItem[]) => {
    injectToAgent001(anexos);
    injectToAgent002(anexos);
  }, [injectToAgent001, injectToAgent002]);

  const getContextForEstratega = useCallback((): AgentContextPayload | null => {
    if (typeof window === 'undefined') return null;
    
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  }, []);

  const isAgentActive = useCallback((agentId: string): boolean => {
    return agentActivity[agentId]?.active || false;
  }, [agentActivity]);

  const getAgentScanningNote = useCallback((agentId: string): string | undefined => {
    return agentActivity[agentId]?.scanningNoteId;
  }, [agentActivity]);

  useEffect(() => {
    const handleAgentRead = (event: CustomEvent) => {
      const { agentId, noteId } = event.detail || {};
      if (agentId) {
        setAgentScanning(agentId, noteId);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('agent_reading_note', handleAgentRead as EventListener);
      return () => {
        window.removeEventListener('agent_reading_note', handleAgentRead as EventListener);
      };
    }
  }, [setAgentScanning]);

  return {
    injectToAgent001,
    injectToAgent002,
    injectToAllAgents,
    getContextForEstratega,
    buildContextPayload,
    agentActivity,
    isAgentActive,
    getAgentScanningNote
  };
}

export default useAnexosAgentIntegration;