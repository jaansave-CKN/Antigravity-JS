import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiService } from '../services/api';

export interface Favorito {
  id: string;
  grant_id: string;
  grant_data: any;
  saved_at: string;
}

interface FavoritosContextValue {
  favoritos: Favorito[];
  cargando: boolean;
  isFavorito: (grantId: string | number) => boolean;
  getFavoritoId: (grantId: string | number) => string | undefined;
  guardarFavorito: (grantId: string | number, grantData: object) => Promise<void>;
  eliminarPorGrantId: (grantId: string | number) => Promise<void>;
  eliminarFavorito: (id: string) => Promise<void>;
  cargarFavoritos: () => Promise<void>;
}

const FavoritosContext = createContext<FavoritosContextValue | null>(null);

export function FavoritosProvider({ children }: { children: React.ReactNode }) {
  const [favoritos, setFavoritos] = useState<Favorito[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargarFavoritos = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token || token === 'demo-mode-token') return;
    setCargando(true);
    try {
      const resp = await apiService.getFavoritos();
      if (resp.success && Array.isArray(resp.data?.data)) {
        setFavoritos(resp.data.data);
      }
    } catch {
      // carga silenciosa — el usuario puede reintentar
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarFavoritos();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'auth_token') cargarFavoritos();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [cargarFavoritos]);

  const isFavorito = useCallback(
    (grantId: string | number) => favoritos.some(f => f.grant_id === String(grantId)),
    [favoritos]
  );

  const getFavoritoId = useCallback(
    (grantId: string | number) => favoritos.find(f => f.grant_id === String(grantId))?.id,
    [favoritos]
  );

  const guardarFavorito = useCallback(async (grantId: string | number, grantData: object) => {
    const resp = await apiService.guardarFavorito(String(grantId), grantData);
    if (!resp.success) {
      throw new Error(resp.error || 'No se pudo guardar en la base de datos. Intenta nuevamente.');
    }
    const nuevo: Favorito = {
      id: resp.data?.data?.id ?? crypto.randomUUID(),
      grant_id: String(grantId),
      grant_data: grantData,
      saved_at: resp.data?.data?.saved_at ?? new Date().toISOString(),
    };
    setFavoritos(prev => [nuevo, ...prev]);
  }, []);

  const eliminarFavorito = useCallback(async (id: string) => {
    const resp = await apiService.eliminarFavorito(id);
    if (!resp.success) {
      throw new Error(resp.error || 'No se pudo eliminar el favorito. Intenta nuevamente.');
    }
    setFavoritos(prev => prev.filter(f => f.id !== id));
  }, []);

  const eliminarPorGrantId = useCallback(async (grantId: string | number) => {
    const fav = favoritos.find(f => f.grant_id === String(grantId));
    if (!fav) return;
    await eliminarFavorito(fav.id);
  }, [favoritos, eliminarFavorito]);

  return (
    <FavoritosContext.Provider value={{
      favoritos, cargando,
      isFavorito, getFavoritoId,
      guardarFavorito, eliminarFavorito, eliminarPorGrantId,
      cargarFavoritos,
    }}>
      {children}
    </FavoritosContext.Provider>
  );
}

export function useFavoritos() {
  const ctx = useContext(FavoritosContext);
  if (!ctx) throw new Error('useFavoritos debe usarse dentro de FavoritosProvider');
  return ctx;
}
