// Use empty base so all /api/* requests go through the Vite dev proxy → localhost:3000
import { leerAuthToken } from '../lib/authStorage';
import type { GrantData } from '../contexts/FavoritosContext';

const API_BASE = '';

function getAuthHeaders(): Record<string, string> {
  const token = leerAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  mensaje?: string;
}

const CONVOCATORIAS_EJEMPLO = [
  { id: 'ent_001', titulo: 'PNUD Colombia - Desarrollo Rural 2026', donante: 'PNUD', monto_max: 500000, fecha_limite: '2026-06-30', fuente: 'PNUD', estado: 'abierta' },
  { id: 'ent_002', titulo: 'BID - Infraestructura Verde', donante: 'BID', monto_max: 2000000, fecha_limite: '2026-08-15', fuente: 'BID', estado: 'abierta' },
  { id: 'ent_003', titulo: 'USAID - Agua y Saneamiento Rural', donante: 'USAID', monto_max: 250000, fecha_limite: '2026-05-20', fuente: 'USAID', estado: 'abierta' },
  { id: 'ent_004', titulo: 'GIZ - Energías Renovables', donante: 'GIZ', monto_max: 300000, fecha_limite: '2026-04-30', fuente: 'GIZ', estado: 'abierta' },
  { id: 'ent_005', titulo: 'UNESCO - International Fund for Cultural Diversity', donante: 'UNESCO', monto_max: 100000, fecha_limite: '2026-05-06', fuente: 'UNESCO', estado: 'abierta' },
  { id: 'ent_006', titulo: 'EU Horizon Europe - Research Infrastructures', donante: 'European Commission', monto_max: 5000000, fecha_limite: '2026-06-16', fuente: 'EU', estado: 'abierta' },
];

// ── Formas reales verificadas contra los res.json() de server.js/proyectos.routes.js
//    (Prioridad Verde, 2026-09-05) — fetchApi() envuelve el JSON parseado COMPLETO
//    del backend (incluido su propio `success`) dentro de `ApiResponse.data`, así
//    que estos tipos describen ese envelope interno, no solo el payload de negocio. ──

/** GET /api/entidades/indexadas (server.js:~3990) */
export interface EntidadIndexada {
  id: string; nombre: string; sigla: string; tipo: string; pais: string;
  validation_status: string; updated_at: string;
}
/** GET /api/cola-validacion (server.js:~4117) */
export interface EntidadColaValidacion {
  id: string; nombre: string; sigla: string; tipo: string; pais: string;
  sitio_web: string | null; validation_status: string; fuente: string | null; created_at: string;
}
/** GET /api/favorites (server.js:~3516) — grant_data es JSONB crudo; se reusa
 *  el GrantData ya modelado (y verificado) en FavoritosContext.tsx en vez de
 *  duplicar o aflojar a `unknown` una forma que este mismo repo ya conoce. */
interface FavoritoRow {
  id: string; grant_id: string; grant_data: GrantData; saved_at: string;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options?.headers },
    });

    const text = await res.text();
    if (!res.ok) {
      try {
        const err = JSON.parse(text);
        throw new Error(err.message || `HTTP ${res.status}`);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
    }

    try {
      const data = JSON.parse(text);
      return { success: true, data };
    } catch {
      return { success: false, error: 'Invalid JSON response' };
    }
  } catch (err) {
    console.warn(`API unavailable: ${endpoint}`, err);
    return { success: false, error: String(err) };
  }
}

function getFallbackData() {
  return CONVOCATORIAS_EJEMPLO;
}

export const apiService = {
  setOrgId(_orgId: string) {},

  // Sin caller real en client/src (grep: 0 usos de apiService.getConvocatorias)
  // — `unknown` en vez de inventar una forma para un método que nada consume.
  // Backend real (server.js:2401): { success, data: fila[], total, page, limit }.
  async getConvocatorias(filtros?: { favoritos?: boolean; estado?: string; page?: number; limit?: number }): Promise<ApiResponse<unknown>> {
    const params = new URLSearchParams();
    if (filtros?.favoritos) params.set('favoritos', 'true');
    if (filtros?.estado) params.set('estado', filtros.estado);
    if (filtros?.page) params.set('page', String(filtros.page));
    if (filtros?.limit) params.set('limit', String(filtros.limit));

    const result = await fetchApi<unknown>(`/api/convocatorias?${params}`);
    if (!result.success) {
      const data = getFallbackData().filter(c => {
        if (filtros?.favoritos) return false;
        if (filtros?.estado && c.estado !== filtros.estado) return false;
        return true;
      });
      return { success: true, data: { data, total: data.length, page: 1, limit: 50 } };
    }
    return result;
  },

  // Sin caller real (grep: 0 usos). Backend real (server.js:3545): { success, favorito }.
  async toggleFavorito(id: number): Promise<ApiResponse<unknown>> {
    return fetchApi(`/api/convocatorias/${id}/favorito`, { method: 'POST' });
  },

  // Sin caller real (grep: 0 usos). Backend real (server.js:4498): { success }.
  async actualizarEstado(id: number, estado: string): Promise<ApiResponse<unknown>> {
    return fetchApi(`/api/convocatorias/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
  },

  // Sin caller real (grep: 0 usos). Nota aparte: el fallback de abajo
  // (totalConvocatorias/abiertas/favoritos/entidadesRastreadas) usa nombres de
  // campo que NO coinciden con el backend real (server.js:2535, que devuelve
  // total_convocatorias/convocatorias_abiertas/convocatorias_nuevas/
  // total_entidades) — inconsistencia real encontrada al tipar, inerte porque
  // nada llama a este método hoy; se documenta, no se "arregla" un fallback
  // que ningún caller ejercita (evitar tocar código sin caller a ciegas).
  async getEstadisticas(): Promise<ApiResponse<unknown>> {
    const result = await fetchApi<unknown>('/api/estadisticas');
    if (!result.success) {
      return { success: true, data: { totalConvocatorias: 6, abiertas: 6, favoritos: 2, entidadesRastreadas: 20 } };
    }
    return result;
  },

  // Sin caller real (grep: 0 usos). Backend real (server.js:3653):
  // { success, message } o { success:false, message, detail } si falla.
  async runScheduler(): Promise<ApiResponse<unknown>> {
    return fetchApi('/api/scheduler/now', { method: 'POST' });
  },

  async getEntidadesIndexadas(filtros?: { tipo?: string; pais?: string }): Promise<ApiResponse<{ success: boolean; data: EntidadIndexada[]; total: number }>> {
    return fetchApi('/api/entidades/indexadas', { method: 'POST', body: JSON.stringify({ filtros }) });
  },

  async getColaValidacion(estado?: string): Promise<ApiResponse<{ success: boolean; data: EntidadColaValidacion[]; total: number }>> {
    const params = estado ? `?estado=${estado}` : '';
    return fetchApi(`/api/cola-validacion${params}`);
  },

  async aprobarItem(itemId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return fetchApi(`/api/cola-validacion/${itemId}/aprobar`, { method: 'POST' });
  },

  async descartarItem(itemId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return fetchApi(`/api/cola-validacion/${itemId}/descartar`, { method: 'POST' });
  },

  // Sin caller real (grep: 0 usos). Backend real (proyectos.routes.js:152):
  // { success, data: fila[] } — RLS por org_id vía withTenantRows.
  async getProyectos(): Promise<ApiResponse<unknown>> {
    return fetchApi('/api/proyectos');
  },

  // Sin caller real en el repo (grep: 0 usos de apiService.crearProyecto) ni
  // lectura del body en el backend correspondiente — `unknown` en vez de
  // inventar una forma no verificada para un parámetro muerto.
  async crearProyecto(data: unknown): Promise<ApiResponse<unknown>> {
    return fetchApi('/api/proyectos', { method: 'POST', body: JSON.stringify(data) });
  },

  // Sin caller real (grep: 0 usos). Backend real (server.js:4025):
  // { success, data: { convocatorias: fila[], entidades: fila[] }, total }.
  async search(query: string): Promise<ApiResponse<unknown>> {
    return fetchApi(`/api/buscar?q=${encodeURIComponent(query)}`);
  },

  async validarCredenciales(): Promise<ApiResponse<{ success: boolean; valid: boolean }>> {
    return fetchApi('/api/credenciales/validar');
  },

  // Sin caller real (grep: 0 usos). Backend real (server.js:4052):
  // { success, data: { fuente, total, activas }[] }.
  async getFuentes(): Promise<ApiResponse<unknown>> {
    return fetchApi('/api/fuentes');
  },

  // Sin caller real HOY (grep: 0 usos) pese a que el comentario de
  // server.js:3988 ("único caller real: services/api.ts:142") afirma lo
  // contrario — documentación desactualizada, no verificada de nuevo antes
  // de este pase (mismo patrón de drift que el resto de esta sesión).
  // Backend real: { success, resultados: fila[], total } (sin envolver en `data`).
  async radarBuscar(query: string): Promise<ApiResponse<unknown>> {
    return fetchApi(`/api/radar/buscar?q=${encodeURIComponent(query)}`);
  },

  // Sin caller real (grep: 0 usos). Backend real (server.js:3958):
  // { success, resultados: fila[], total, motor }.
  async radarBuscarMasivo(): Promise<ApiResponse<unknown>> {
    return fetchApi('/api/radar/buscar-masivo', { method: 'POST' });
  },

  // Sin caller real (grep: 0 usos). Backend real (server.js:4449,
  // barridoMasivoHandler): { success, resultados: fila[], total, motor }.
  async ejecutarBarrido(): Promise<ApiResponse<unknown>> {
    return fetchApi('/api/radar/barrido', { method: 'POST' });
  },

  // POST /api/convocatorias/filtros (server.js) ignora el body por completo
  // (`(req, res) => res.json({success:true, data:[]})`) — `unknown` en vez de
  // inventar una forma para un parámetro que ni el backend lee.
  async aplicarFiltros(filtros: unknown): Promise<ApiResponse<unknown>> {
    return fetchApi('/api/convocatorias/filtros', { method: 'POST', body: JSON.stringify({ filtros }) });
  },

  async getFavoritos(): Promise<ApiResponse<{ success: boolean; data: FavoritoRow[] }>> {
    return fetchApi('/api/favorites');
  },

  async guardarFavorito(grantId: string, grantData: object): Promise<ApiResponse<{ success: boolean; message: string; id: string }>> {
    return fetchApi('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ grant_id: grantId, grant_data: grantData }),
    });
  },

  async eliminarFavorito(id: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return fetchApi(`/api/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getGoogleOAuthStatus(): Promise<ApiResponse<{ connected: boolean; connectedAt: string | null }>> {
    return fetchApi('/api/auth/google/status');
  },

  async revokeGoogleOAuth(): Promise<ApiResponse<void>> {
    return fetchApi('/api/auth/google/revoke', { method: 'DELETE' });
  },
};

export default apiService;
