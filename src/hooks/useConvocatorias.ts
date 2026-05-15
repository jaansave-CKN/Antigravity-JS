import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { convocatoriasReales } from '../data/convocatoriasReales';
import type { Convocatoria } from '../types';

const CACHE_KEY = 'radar_convocatorias_cache';
const CACHE_TTL = 5 * 60 * 1000;

interface State {
  convocatorias: Convocatoria[];
  loading: boolean;
  lastSync: string | null;
  isStale: boolean;
}

function getCache(): { data: Convocatoria[]; ts: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCache(data: Convocatoria[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore */ }
}

export function useConvocatorias() {
  const [state, setState] = useState<State>({
    convocatorias: [],
    loading: true,
    lastSync: null,
    isStale: false,
  });

  const sync = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    
    try {
      const q = query(
        collection(db, 'convocatorias'),
        orderBy('fechaCierre', 'asc'),
        limit(100)
      );
      const snap = await getDocs(q);
      
      if (!snap.empty) {
        const convs: Convocatoria[] = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            titulo: data.titulo || 'Sin título',
            donante: data.donante || '',
            montoMax: data.montoMax || data.montoMaximo || 0,
            moneda: data.moneda || 'USD',
            fechaCierre: data.fechaCierre || '',
            fechaPublicacion: data.fechaPublicacion || '',
            paisesElegibles: data.paisesElegibles || ['Colombia'],
            sectores: data.sectores || [],
            probabilidadExito: data.probabilidadExito || 70,
            requisitosClave: data.requisitosClave || [],
            estado: (data.estado === 'cerrada' ? 'cerrada' : 'abierta') as any,
            fuente: data.fuente || 'Radar',
            descripcion: data.descripcion || '',
            urlOriginal: data.urlOriginal || '',
            urlConvocatoria: data.urlOriginal || '',
            favorito: Boolean(data.favorito),
            compatibilidadPerfil: data.compatibilidadPerfil || 70,
          };
        });
        setCache(convs);
        setState({ convocatorias: convs, loading: false, lastSync: new Date().toISOString(), isStale: false });
        return;
      }
    } catch { /* use fallback */ }
    
    // Fallback: usar datos reales embebidos
    setCache(convocatoriasReales);
    setState({ 
      convocatorias: convocatoriasReales, 
      loading: false, 
      lastSync: new Date().toISOString(), 
      isStale: false 
    });
  }, []);

  useEffect(() => { sync(); }, [sync]);

  useEffect(() => {
    const interval = setInterval(() => setState(s => ({ ...s, isStale: true })), CACHE_TTL);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!state.isStale) return;
    const timer = setTimeout(() => sync(), 1000);
    return () => clearTimeout(timer);
  }, [state.isStale, sync]);

  return { ...state, sync };
}