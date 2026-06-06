import React, { createContext, useContext, useState } from 'react';

interface SearchContextValue {
  busqueda: string;
  setBusqueda: (valor: string) => void;
}

const SearchContext = createContext<SearchContextValue>({ busqueda: '', setBusqueda: () => {} });

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [busqueda, setBusqueda] = useState('');
  return <SearchContext.Provider value={{ busqueda, setBusqueda }}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  return useContext(SearchContext);
}
