import React, { createContext, useContext, useMemo, useState } from 'react';

interface SearchContextValue {
  busqueda: string;
  setBusqueda: (valor: string) => void;
}

const SearchContext = createContext<SearchContextValue>({ busqueda: '', setBusqueda: () => {} });

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [busqueda, setBusqueda] = useState('');
  const value = useMemo(() => ({ busqueda, setBusqueda }), [busqueda]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  return useContext(SearchContext);
}
