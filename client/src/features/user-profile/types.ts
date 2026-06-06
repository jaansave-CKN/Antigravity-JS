// ── UserProfileData — estado global unificado de identidad y conexiones ────────
// Fuente de verdad para UserProfileOrchestrator y PanelPage.

export interface UserProfileData {
  identity: {
    name:   string;
    email:  string;
    avatar: string;
  };
  connections: {
    googleDrive: {
      connected:    boolean;
      scopeGranted: boolean;
      lastSync:     string;   // ISO 8601 | ''
    };
    documentAnalysis: {
      provider: 'NotebookLM' | 'LocalModel';
      active:   boolean;
    };
    deepSearch: {
      provider: 'Perplexity' | 'Custom';
      active:   boolean;
    };
  };
  security: {
    encryptionStatus: 'secured' | 'pending';
  };
}

// ── Etiquetas orientadas al beneficio (abstracción de proveedor) ───────────────
export const ENGINE_LABELS: Record<string, string> = {
  Perplexity:   'Motor de Rastreos en Tiempo Real',
  Custom:       'Motor de Rastreos Personalizado',
  NotebookLM:   'Analista Inteligente de Documentos',
  LocalModel:   'Analista Local de Documentos',
};

// ── Estado de conexión individual ─────────────────────────────────────────────
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface EngineCardState {
  key:          'googleDrive' | 'documentAnalysis' | 'deepSearch';
  label:        string;        // Nombre orientado al beneficio
  provider:     string;        // Proveedor subyacente (interno)
  status:       ConnectionStatus;
  lastActivity: string | null; // Última consulta o sync
  pulse:        boolean;       // Activa animación de pulso cuando status === 'connected'
}

// ── Payload que el backend proxy devuelve al leer credenciales ─────────────────
export interface CredentialStatusPayload {
  googleDrive:      { connected: boolean; scopeGranted: boolean; lastSync: string };
  deepSearchActive: boolean;
  docAnalysisActive: boolean;
  encryptionStatus: 'secured' | 'pending';
}

// ── Constantes de URLs oficiales de gestión de API ────────────────────────────
export const PROVIDER_URLS = {
  googleAIStudio: 'https://aistudio.google.com/app/apikey',
  perplexity:     'https://www.perplexity.ai/settings/api',
  notebookLM:     'https://notebooklm.google.com/',
} as const;

export const DEFAULT_PROFILE: UserProfileData = {
  identity: { name: '', email: '', avatar: '' },
  connections: {
    googleDrive:      { connected: false, scopeGranted: false, lastSync: '' },
    documentAnalysis: { provider: 'NotebookLM', active: false },
    deepSearch:       { provider: 'Perplexity', active: false },
  },
  security: { encryptionStatus: 'pending' },
};
