import type { Convocatoria, EstadisticasRadar, AlertaSenal, Entidad } from './types';

export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api$/, '') || '';

async function safeJson(resp: Response): Promise<any> {
  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON from backend'); }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  return safeJson(response);
}

function mapApiToConvocatoria(apiData: any): Convocatoria {
  return {
    id: String(apiData.id),
    titulo: apiData.titulo || '',
    donante: apiData.donante || '',
    montoMax: apiData.monto_max || 0,
    moneda: apiData.moneda || 'USD',
    fechaCierre: apiData.fecha_limite || '',
    fechaPublicacion: apiData.fecha_publicacion || '',
    paisesElegibles: apiData.paises_elegibles || [],
    sectores: apiData.sectores || [],
    probabilidadExito: apiData.score_probabilidad || 0,
    requisitosClave: apiData.requisitos || [],
    estado: apiData.estado || 'abierta',
    fuente: apiData.fuente || '',
    descripcion: apiData.descripcion || apiData.resumen_tecnico || '',
    urlOriginal: apiData.url_fuente || '',
    urlConvocatoria: apiData.url_convocatoria || apiData.url_fuente || '',
    favorito: Boolean(apiData.favorito),
    compatibilidadPerfil: apiData.compatibilidad_perfil || 0,
  };
}

function mapApiToEntidad(apiData: any): Entidad {
  let sectores: Entidad['sectores'] = [];
  try {
    if (typeof apiData.sectores === 'string') {
      sectores = JSON.parse(apiData.sectores);
    } else if (Array.isArray(apiData.sectores)) {
      sectores = apiData.sectores;
    }
  } catch { sectores = []; }

  return {
    id: apiData.id || '',
    nombre: apiData.nombre || '',
    sigla: apiData.sigla || '',
    tipo: apiData.tipo || 'multilateral',
    pais: apiData.pais || '',
    bandera: apiData.bandera || '',
    sectores,
    sitioWeb: apiData.sitio_web || '',
    urlConvocatorias: apiData.url_convocatorias || '',
    contacto: apiData.contacto || '',
    emailContacto: apiData.email_contacto || '',
    convocatoriasActivas: apiData.convocatorias_activas || 0,
    montoTotalDisponible: apiData.monto_total || 0,
    moneda: apiData.moneda || 'USD',
    frecuencia: (apiData.frecuencia || 'variable') as Entidad['frecuencia'],
    ultimaConvocatoria: apiData.ultima_convocatoria || '',
    notas: apiData.notas || '',
    locked: Boolean(apiData.locked),
    creadoEn: apiData.creado_en || '',
    actualizadoEn: apiData.actualizado_en || '',
  };
}

export const apiService = {
  async getConvocatorias(filtros?: { favoritos?: boolean; estado?: string }, page: number = 1, limit: number = 50): Promise<{ data: Convocatoria[], pagination: { page: number; limit: number; total: number; pages: number } }> {
    const params = new URLSearchParams();
    if (filtros?.favoritos) params.append('favoritos', 'true');
    if (filtros?.estado) params.append('estado', filtros.estado);
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    const data = await fetchApi<any>(`/api/convocatorias${query}`);
    return {
      data: data.data.map(mapApiToConvocatoria),
      pagination: data.pagination
    };
  },

  async getEntidades(): Promise<Entidad[]> {
    const data = await fetchApi<any[]>('/api/entidades' as any);
    return data.map(mapApiToEntidad);
  },

  async getScrapedResults(): Promise<any[]> {
    return fetchApi<any[]>('/api/scraped-results' as any);
  },

  async triggerScrape(): Promise<void> {
    await fetchApi('/api/entidades/scrape-async' as any, { method: 'POST' });
  },

  async toggleFavorito(convocatoriaId: number): Promise<boolean> {
    const data = await fetchApi<{ success: boolean; favorito: boolean }>(
      `/api/convocatorias/${convocatoriaId}/favorito`,
      { method: 'POST' }
    );
    return data.favorito;
  },

  async updateEstado(convocatoriaId: number, estado: string): Promise<void> {
    await fetchApi(`/api/convocatorias/${convocatoriaId}/estado` as any, {
      method: 'PUT',
      body: JSON.stringify({ estado }),
    });
  },

  async getEstadisticas(): Promise<EstadisticasRadar> {
    const data = await fetchApi<any>('/api/estadisticas');
    return {
      totalConvocatorias: data.totalConvocatorias || 0,
      convocatoriasAbiertas: data.totalConvocatorias || 0,
      montoTotalDisponible: data.totalConvocatorias * 500000 || 0,
      promedioCompatibilidad: data.promedioCompatibilidad || 0,
      nuevasUltimas24h: data.nuevasHoy || 0,
      fuentesActivas: 5,
      probabilidadPromedio: data.promedioCompatibilidad || 0,
    };
  },

  async runScheduler(): Promise<void> {
    await fetchApi('/api/scheduler/now' as any, { method: 'POST' });
  },

  async healthCheck(): Promise<{ status: string }> {
    return fetchApi('/api/health');
  },
};

export default apiService;