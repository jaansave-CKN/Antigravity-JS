import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface Predio {
  id: string;
  direccion: string;
  area_m2: number;
  valor_catastral: number;
  evaluacion?: {
    score_legal: number;
    alertas?: string[];
    recomendaciones?: string[];
  };
  [key: string]: unknown;
}

interface DashboardContextValue {
  predios: Predio[];
  loading: boolean;
  selectedPredio: Predio | null;
  selectPredio: (predio: Predio | null) => void;
  mapCenter: { lat: number; lng: number };
  bounds: { south: number; north: number; west: number; east: number } | null;
  filters: { minScore: number; viableOnly: boolean };
  setFilters: (filters: Partial<{ minScore: number; viableOnly: boolean }>) => void;
  setBounds: (bounds: { south: number; north: number; west: number; east: number } | null) => void;
  refreshOpportunities: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within DashboardProvider');
  }
  return context;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
   const [predios, setPredios] = useState<Predio[]>([]);
   const [loading, setLoading] = useState(false);
   const [selectedPredio, setSelectedPredio] = useState<Predio | null>(null);
   const [bounds, setBounds] = useState<{ south: number; north: number; west: number; east: number } | null>(null);
   const [filters, setFilters] = useState({ minScore: 50, viableOnly: true });

   const fetchOpportunities = useCallback(async () => {
     setLoading(true);
     try {
       let url = `${API_BASE}/opportunities`;
       if (bounds) {
         url += `?south=${bounds.south}&north=${bounds.north}&west=${bounds.west}&east=${bounds.east}&min_score=${filters.minScore}`;
       }
       const response = await fetch(url);
       if (response.ok) {
         const text = await response.text();
         try {
           const data = JSON.parse(text);
           setPredios(Array.isArray(data) ? data : []);
         } catch {
           console.warn('Non-JSON response from opportunities endpoint');
           setPredios([]);
         }
       }
     } catch (error) {
       console.error('Error fetching opportunities:', error);
       setPredios([]);
     } finally {
       setLoading(false);
     }
   }, [bounds, filters]);

   useEffect(() => {
     // Cargar oportunidades con bounds por defecto (Bogotá)
     if (!bounds) {
       setBounds({
         south: 4.4,
         north: 4.7,
         west: -74.2,
         east: -73.9
       });
     }
   }, []);

useEffect(() => {
     fetchOpportunities();
   }, [bounds]); // Cuando cambian los bounds

  const value: DashboardContextValue = {
    predios,
    loading,
    selectedPredio,
    selectPredio: setSelectedPredio,
    mapCenter: { lat: 4.6097, lng: -74.0817 },
    bounds,
    filters,
    setFilters: (newFilters) => setFilters(prev => ({ ...prev, ...newFilters })),
    setBounds,
    refreshOpportunities: fetchOpportunities,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}