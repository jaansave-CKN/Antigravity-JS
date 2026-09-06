import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { apiService } from '../services/api';
import { useAuth } from './AuthContextNew';

/** Forma real de una convocatoria guardada — verificada contra los accesos
 *  defensivos de FavoritosView.tsx (fecha_cierre/fechaCierre/fecha_limite,
 *  donante/fuente): los datos vienen de fuentes con nombres de campo
 *  inconsistentes, por eso todo es opcional en vez de un tipo estricto. */
export interface GrantData {
  titulo?: string;
  donante?: string;
  fuente?: string;
  estado?: string;
  fecha_cierre?: string;
  fechaCierre?: string;
  fecha_limite?: string;
}

export interface Favorito {
  id: string;
  grant_id: string;
  grant_data: GrantData;
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
  // FIX (Fase 1, 2026-09-05): leerAuthToken() ya solo devuelve 'demo-mode-token'
  // o null (el JWT real vive en la cookie httpOnly, nunca en localStorage) —
  // usarlo para detectar "hay sesión real" habría dejado esto SIEMPRE en
  // early-return para cualquier usuario real. Se reemplaza por el estado
  // reactivo de AuthContext.
  const { isAuthenticated, token } = useAuth();
  const esSesionReal = isAuthenticated && token !== 'demo-mode-token';

  const cargarFavoritos = useCallback(async () => {
    if (!esSesionReal) return;
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
  }, [esSesionReal]);

  // Cambio de sesión en OTRA pestaña ya no necesita listener propio aquí:
  // AuthContext lo detecta vía su suscribirCambioSesion() (BroadcastChannel)
  // y re-verifica la cookie, lo que actualiza isAuthenticated/token y
  // cascada hasta este efecto a través de la dependencia de cargarFavoritos.
  useEffect(() => {
    cargarFavoritos();
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
    // FIX (purga de `any`, 2026-09-05): leía resp.data?.data?.id — un nivel de
    // más de anidamiento que nunca existió. El backend real (server.js,
    // POST /api/favorites) responde `{ success, message, id }` plano, sin
    // envolver en `data` — fetchApi() ya pone TODO el JSON del backend en
    // `resp.data`, así que el id real vivía en `resp.data.id`. Con `any` esto
    // caía siempre al `crypto.randomUUID()` de respaldo: cada favorito
    // guardado quedaba con un id inventado en el cliente, distinto al id
    // real de la fila en la base de datos — eliminarFavorito(id) contra ese
    // id nunca habría podido borrar la fila correcta. saved_at sí sigue con
    // fallback local: el backend no lo devuelve en el POST (solo en el GET).
    const nuevo: Favorito = {
      id: resp.data?.id ?? crypto.randomUUID(),
      grant_id: String(grantId),
      grant_data: grantData,
      saved_at: new Date().toISOString(),
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

  const value = useMemo(() => ({
    favoritos, cargando,
    isFavorito, getFavoritoId,
    guardarFavorito, eliminarFavorito, eliminarPorGrantId,
    cargarFavoritos,
  }), [favoritos, cargando, isFavorito, getFavoritoId, guardarFavorito, eliminarFavorito, eliminarPorGrantId, cargarFavoritos]);

  return (
    <FavoritosContext.Provider value={value}>
      {children}
    </FavoritosContext.Provider>
  );
}

export function useFavoritos() {
  const ctx = useContext(FavoritosContext);
  if (!ctx) throw new Error('useFavoritos debe usarse dentro de FavoritosProvider');
  return ctx;
}
