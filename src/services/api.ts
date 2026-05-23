const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

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

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
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

  async getConvocatorias(filtros?: { favoritos?: boolean; estado?: string; page?: number; limit?: number }): Promise<ApiResponse<any>> {
    const params = new URLSearchParams();
    if (filtros?.favoritos) params.set('favoritos', 'true');
    if (filtros?.estado) params.set('estado', filtros.estado);
    if (filtros?.page) params.set('page', String(filtros.page));
    if (filtros?.limit) params.set('limit', String(filtros.limit));
    
    const result = await fetchApi<any>(`/api/convocatorias?${params}`);
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

  async toggleFavorito(id: number): Promise<ApiResponse<any>> {
    return fetchApi(`/api/convocatorias/${id}/favorito`, { method: 'POST' });
  },

  async actualizarEstado(id: number, estado: string): Promise<ApiResponse<any>> {
    return fetchApi(`/api/convocatorias/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
  },

  async getEstadisticas(): Promise<ApiResponse<any>> {
    const result = await fetchApi<any>('/api/estadisticas');
    if (!result.success) {
      return { success: true, data: { totalConvocatorias: 6, abiertas: 6, favoritos: 2, entidadesRastreadas: 20 } };
    }
    return result;
  },

  async runScheduler(): Promise<ApiResponse<any>> {
    return fetchApi('/api/scheduler/now', { method: 'POST' });
  },

  async getEntidadesIndexadas(filtros?: any): Promise<ApiResponse<any>> {
    return fetchApi('/api/entidades/indexadas', { method: 'POST', body: JSON.stringify({ filtros }) });
  },

  async getColaValidacion(estado?: string): Promise<ApiResponse<any>> {
    const params = estado ? `?estado=${estado}` : '';
    return fetchApi(`/api/cola-validacion${params}`);
  },

  async aprobarItem(itemId: string): Promise<ApiResponse<any>> {
    return fetchApi(`/api/cola-validacion/${itemId}/aprobar`, { method: 'POST' });
  },

  async descartarItem(itemId: string): Promise<ApiResponse<any>> {
    return fetchApi(`/api/cola-validacion/${itemId}/descartar`, { method: 'POST' });
  },

  async getProyectos(): Promise<ApiResponse<any>> {
    return fetchApi('/api/proyectos');
  },

  async crearProyecto(data: any): Promise<ApiResponse<any>> {
    return fetchApi('/api/proyectos', { method: 'POST', body: JSON.stringify(data) });
  },

  async search(query: string): Promise<ApiResponse<any>> {
    return fetchApi(`/api/buscar?q=${encodeURIComponent(query)}`);
  },

  async validarCredenciales(): Promise<ApiResponse<any>> {
    return fetchApi('/api/credenciales/validar');
  },

  async guardarCredenciales(apiKey: string, notebookKey: string): Promise<ApiResponse<any>> {
    return fetchApi('/api/credenciales', { method: 'POST', body: JSON.stringify({ apiKey, notebookKey }) });
  },

  async getFuentes(): Promise<ApiResponse<any>> {
    return fetchApi('/api/fuentes');
  },

  async radarBuscar(query: string): Promise<ApiResponse<any>> {
    return fetchApi(`/api/radar/buscar?q=${encodeURIComponent(query)}`);
  },

  async radarBuscarMasivo(): Promise<ApiResponse<any>> {
    return fetchApi('/api/radar/buscar-masivo', { method: 'POST' });
  },

  async ejecutarBarrido(): Promise<ApiResponse<any>> {
    return fetchApi('/api/radar/barrido', { method: 'POST' });
  },

  async aplicarFiltros(filtros: any): Promise<ApiResponse<any>> {
    return fetchApi('/api/convocatorias/filtros', { method: 'POST', body: JSON.stringify({ filtros }) });
  },
};

export default apiService;