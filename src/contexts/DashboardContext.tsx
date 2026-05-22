import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { taskQueue } from '../services/ai';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function useDashboard() {
  const [predios, setPredios] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPredio, setSelectedPredio] = useState<any | null>(null);
  const [mapCenter, setMapCenter] = useState({ lat: 4.6097, lng: -74.0817 });
  const [bounds, setBounds] = useState<any>(null);
  const [filters, setFilters] = useState({ minScore: 50, viableOnly: true });

  const fetchOpportunities = useCallback(async () => {
    if (!bounds) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/opportunities?south=${bounds.south}&north=${bounds.north}&west=${bounds.west}&east=${bounds.east}&min_score=${filters.minScore}`);
      if (response.ok) {
        const data = await response.json();
        setPredios(data);
      }
    } catch (error) {
      console.error('Error fetching opportunities:', error);
    } finally {
      setLoading(false);
    }
  }, [bounds, filters]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  return {
    predios,
    loading,
    selectedPredio,
    mapCenter,
    bounds,
    filters,
    selectPredio: setSelectedPredio,
    setMapCenter,
    setBounds,
    setFilters: (newFilters: Partial<any>) => setFilters(prev => ({ ...prev, ...newFilters })),
    refreshOpportunities: fetchOpportunities,
  };
}

interface DashboardProviderProps {
  children: ReactNode;
}

export function DashboardProvider({ children }: DashboardProviderProps) {
  const dashboard = useDashboard();
  return <>{children}</>;
}