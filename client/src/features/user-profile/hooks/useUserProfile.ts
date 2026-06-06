import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  UserProfileData,
  EngineCardState,
  ConnectionStatus,
  CredentialStatusPayload,
} from '../types';
import { DEFAULT_PROFILE, ENGINE_LABELS } from '../types';

// ── Backend proxy endpoint (nunca expone credenciales al frontend) ─────────────
const API = '/api';

interface UseUserProfileReturn {
  profile:        UserProfileData;
  engines:        EngineCardState[];
  loading:        boolean;
  error:          string | null;
  connectGoogle:  () => void;
  disconnectGoogle: () => Promise<void>;
  activateEngine: (key: EngineCardState['key']) => Promise<void>;
  refreshStatus:  () => Promise<void>;
  saveIdentity:   (name: string, email: string) => Promise<void>;
}

// ── Helper: construye el array de cards a partir del perfil ───────────────────
function buildEngineCards(profile: UserProfileData): EngineCardState[] {
  const { connections } = profile;
  return [
    {
      key:          'googleDrive',
      label:        'Fuente de Datos Google Drive',
      provider:     'Google',
      status:       connections.googleDrive.connected ? 'connected' : 'disconnected',
      lastActivity: connections.googleDrive.lastSync || null,
      pulse:        connections.googleDrive.connected,
    },
    {
      key:          'deepSearch',
      label:        ENGINE_LABELS[connections.deepSearch.provider],
      provider:     connections.deepSearch.provider,
      status:       connections.deepSearch.active ? 'connected' : 'disconnected',
      lastActivity: null,
      pulse:        connections.deepSearch.active,
    },
    {
      key:          'documentAnalysis',
      label:        ENGINE_LABELS[connections.documentAnalysis.provider],
      provider:     connections.documentAnalysis.provider,
      status:       connections.documentAnalysis.active ? 'connected' : 'disconnected',
      lastActivity: null,
      pulse:        connections.documentAnalysis.active,
    },
  ];
}

// ── Hook principal ─────────────────────────────────────────────────────────────
export function useUserProfile(authToken: string | null): UseUserProfileReturn {
  const [profile, setProfile] = useState<UserProfileData>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const mountedRef             = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Carga inicial del estado desde backend proxy ───────────────────────────
  const refreshStatus = useCallback(async () => {
    if (!authToken || authToken === 'demo-mode-token') return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/user/profile/status`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CredentialStatusPayload = await res.json();
      if (!mountedRef.current) return;
      setProfile(prev => ({
        ...prev,
        connections: {
          googleDrive: data.googleDrive,
          deepSearch:  { ...prev.connections.deepSearch, active: data.deepSearchActive },
          documentAnalysis: { ...prev.connections.documentAnalysis, active: data.docAnalysisActive },
        },
        security: { encryptionStatus: data.encryptionStatus },
      }));
    } catch (e: any) {
      if (mountedRef.current) setError(e.message ?? 'Error al cargar estado del perfil');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [authToken]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // ── Google SSO — interruptor maestro ──────────────────────────────────────
  const connectGoogle = useCallback(() => {
    window.location.href = `${API}/auth/google`;
  }, []);

  const disconnectGoogle = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    try {
      await fetch(`${API}/auth/google/revoke`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setProfile(prev => ({
        ...prev,
        connections: {
          ...prev.connections,
          googleDrive: { connected: false, scopeGranted: false, lastSync: '' },
        },
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  // ── Activar motor de IA (via backend proxy — credencial nunca en frontend) ─
  const activateEngine = useCallback(async (key: EngineCardState['key']) => {
    if (!authToken || authToken === 'demo-mode-token') return;
    setProfile(prev => {
      const conn = { ...prev.connections };
      if (key === 'googleDrive') conn.googleDrive = { ...conn.googleDrive, connected: true };
      if (key === 'deepSearch')  conn.deepSearch  = { ...conn.deepSearch,  active: true };
      if (key === 'documentAnalysis') conn.documentAnalysis = { ...conn.documentAnalysis, active: true };
      return { ...prev, connections: conn };
    });
    try {
      await fetch(`${API}/user/engines/${key}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch (e: any) {
      setError(e.message);
      await refreshStatus();
    }
  }, [authToken, refreshStatus]);

  // ── Guardar identidad vía backend (nombre / email de perfil) ──────────────
  const saveIdentity = useCallback(async (name: string, email: string) => {
    if (!authToken) return;
    setProfile(prev => ({ ...prev, identity: { ...prev.identity, name, email } }));
    try {
      await fetch(`${API}/auth/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ nombre: name, email }),
      });
    } catch (e: any) {
      setError(e.message);
    }
  }, [authToken]);

  return {
    profile,
    engines: buildEngineCards(profile),
    loading,
    error,
    connectGoogle,
    disconnectGoogle,
    activateEngine,
    refreshStatus,
    saveIdentity,
  };
}
