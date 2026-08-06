/**
 * apiClient.ts — Cliente HTTP centralizado
 *
 * Características:
 *   - Base URL desde import.meta.env.VITE_API_URL (cero localhost hardcodeado)
 *   - Inyección automática de Authorization: Bearer <token> en cada request
 *   - Soporte dual: JWT local (localStorage) + Supabase Auth session
 *   - Tipado estricto con genéricos TypeScript
 *   - Manejo de errores homogéneo con ApiError
 *   - Retry automático en 502/503 (cold start serverless)
 *
 * Uso:
 *   import { http } from '../lib/apiClient';
 *   const data = await http.get<Project[]>('/api/projects');
 *   const result = await http.post<{ success: boolean }>('/api/auth/login', { email, password });
 */

// ── Selector de fuente de autenticación ──────────────────────────────────────
// true  → prioriza Supabase Auth session
// false → usa solo JWT local del servidor RadarFondos
export const USE_SUPABASE_AUTH = !!import.meta.env.VITE_SUPABASE_URL;

// ── Base URL (nunca localhost hardcodeado) ────────────────────────────────────
const RAW_API_URL = import.meta.env.VITE_API_URL as string | undefined;
export const API_BASE = RAW_API_URL
  ? RAW_API_URL.replace(/\/$/, '')   // strip trailing slash
  : '';                               // en producción el proxy Vite/Express lo resuelve

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Resolución del token de autorización ─────────────────────────────────────
function getAuthToken(): string | null {
  // 1. Token de Supabase Auth (solo si VITE_SUPABASE_URL está configurada)
  if (USE_SUPABASE_AUTH) {
    try {
      const supabaseKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (supabaseKey) {
        const session = JSON.parse(localStorage.getItem(supabaseKey) || '{}');
        const accessToken = session?.access_token || session?.currentSession?.access_token;
        if (accessToken) return accessToken;
      }
    } catch { /* ignore */ }
  }

  // 2. JWT local del servidor RadarFondos
  const localToken = localStorage.getItem('auth_token');
  if (localToken && localToken !== 'demo-mode-token') return localToken;

  // 3. Token de sesión de prueba (sessionStorage)
  const trialToken = sessionStorage.getItem('trial_token');
  if (trialToken) return trialToken;

  return null;
}

// ── Cabeceras base ────────────────────────────────────────────────────────────
function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (extra) {
    new Headers(extra).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

// ── Parseo seguro de respuesta ────────────────────────────────────────────────
async function parseResponse<T>(resp: Response): Promise<T> {
  const text = await resp.text();

  if (!resp.ok) {
    let parsed: { message?: string; error?: string; code?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* raw text error */ }

    // Sesión inválida/expirada (ej. rotación de JWT_SECRET en el servidor) —
    // aviso global en vez de que cada pantalla muestre su propio error
    // genérico de "no se pudo sincronizar". AuthContextNew.tsx escucha esto
    // y limpia la sesión local para forzar un re-login real.
    if (resp.status === 401 && getAuthToken() && getAuthToken() !== 'demo-mode-token') {
      window.dispatchEvent(new CustomEvent('auth-session-expired', { detail: { code: parsed.code, message: parsed.message } }));
    }

    throw new ApiError(
      parsed.message || parsed.error || `HTTP ${resp.status}`,
      resp.status,
      parsed.code,
      parsed
    );
  }

  if (!text) return undefined as unknown as T;

  try { return JSON.parse(text) as T; }
  catch { throw new ApiError('Invalid JSON response from server', resp.status); }
}

// ── Retry en cold-start serverless (502/503) ──────────────────────────────────
async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let lastError: Error = new Error('Network error');
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.status === 502 || resp.status === 503) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
      }
      return resp;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

// ── Métodos HTTP principales ──────────────────────────────────────────────────
async function get<T>(endpoint: string, opts?: RequestInit): Promise<T> {
  const resp = await fetchWithRetry(
    `${API_BASE}${endpoint}`,
    { method: 'GET', ...opts, headers: buildHeaders(opts?.headers) }
  );
  return parseResponse<T>(resp);
}

async function post<T>(endpoint: string, body?: unknown, opts?: RequestInit): Promise<T> {
  const resp = await fetchWithRetry(
    `${API_BASE}${endpoint}`,
    {
      method:  'POST',
      body:    body !== undefined ? JSON.stringify(body) : undefined,
      ...opts,
      headers: buildHeaders(opts?.headers),
    }
  );
  return parseResponse<T>(resp);
}

async function put<T>(endpoint: string, body?: unknown, opts?: RequestInit): Promise<T> {
  const resp = await fetchWithRetry(
    `${API_BASE}${endpoint}`,
    {
      method:  'PUT',
      body:    body !== undefined ? JSON.stringify(body) : undefined,
      ...opts,
      headers: buildHeaders(opts?.headers),
    }
  );
  return parseResponse<T>(resp);
}

async function patch<T>(endpoint: string, body?: unknown, opts?: RequestInit): Promise<T> {
  const resp = await fetchWithRetry(
    `${API_BASE}${endpoint}`,
    {
      method:  'PATCH',
      body:    body !== undefined ? JSON.stringify(body) : undefined,
      ...opts,
      headers: buildHeaders(opts?.headers),
    }
  );
  return parseResponse<T>(resp);
}

async function del<T>(endpoint: string, opts?: RequestInit): Promise<T> {
  const resp = await fetchWithRetry(
    `${API_BASE}${endpoint}`,
    { method: 'DELETE', ...opts, headers: buildHeaders(opts?.headers) }
  );
  return parseResponse<T>(resp);
}

// ── Upload con form-data (archivos) ───────────────────────────────────────────
async function upload<T>(endpoint: string, formData: FormData): Promise<T> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // NO Content-Type — browser lo pone automáticamente con boundary

  const resp = await fetchWithRetry(`${API_BASE}${endpoint}`, {
    method: 'POST', body: formData, headers,
  });
  return parseResponse<T>(resp);
}

// ── Objeto exportado principal ────────────────────────────────────────────────
export const http = { get, post, put, patch, delete: del, upload };

// ── Helpers de dominio ────────────────────────────────────────────────────────

/** Verifica si el usuario está autenticado (token presente) */
export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/** Retorna las cabeceras de Auth para uso en WebSocket o en requests manuales */
export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default http;
