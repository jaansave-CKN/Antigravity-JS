import { useState, useEffect, useCallback } from 'react';
import { realEntidades } from '../data/realEntidades';
import type { Entidad } from '../types';

const CACHE_KEY = 'radar_entidades_cache';
const CACHE_TTL_MS = 60 * 60 * 1000;

interface EntidadesState {
  entidades: Entidad[];
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  isStale: boolean;
}

function getCache(): { data: Entidad[]; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCache(data: Entidad[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // storage full
  }
}

export function useEntidades() {
  const [state, setState] = useState<EntidadesState>({
    entidades: [],
    loading: true,
    error: null,
    lastSync: null,
    isStale: false,
  });

  const load = useCallback(() => {
    const cached = getCache();
    const now = Date.now();
    const isStale = !cached || now - cached.timestamp > CACHE_TTL_MS;

    if (cached) {
      setState({
        entidades: cached.data,
        loading: false,
        error: null,
        lastSync: new Date(cached.timestamp).toISOString(),
        isStale,
      });
    } else {
      setState(prev => ({ ...prev, loading: false, isStale: true }));
    }
  }, []);

  const sync = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const res = await fetch('/api/entidades');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: Entidad[] = await res.json();
      setCache(data);

      setState({
        entidades: data,
        loading: false,
        error: null,
        lastSync: new Date().toISOString(),
        isStale: false,
      });
    } catch {
      // Fallback to static data
      setCache(realEntidades);
      setState({
        entidades: realEntidades,
        loading: false,
        error: null,
        lastSync: new Date().toISOString(),
        isStale: false,
      });
    }
  }, []);

  const forceSync = useCallback(async () => {
    await sync();
  }, [sync]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh if stale every 5 minutes
  useEffect(() => {
    if (!state.isStale) return;
    const timer = setTimeout(() => {
      if (state.isStale) sync();
    }, 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [state.isStale, sync]);

  return {
    ...state,
    sync,
    forceSync,
  };
}