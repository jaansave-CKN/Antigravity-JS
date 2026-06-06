/**
 * LanguageContext.tsx — Estado global de idioma ES / EN
 *
 * Uso en cualquier componente:
 *   const { lang, setLang, isEN, t } = useLanguage();
 *
 *   // Renderizado de payloads bilingüe (sin petición al servidor):
 *   const payload = isEN ? project.payload_en : project.payload_es;
 *
 * El idioma se persiste en localStorage para sobrevivir recargas.
 * Defecto: 'es' (español colombiano).
 */

import React, {
  createContext, useContext, useState, useCallback,
  type ReactNode,
} from 'react';

// ── Tipos ─────────────────────────────────────────────────────────────────────
export type Lang = 'es' | 'en';

interface LanguageContextValue {
  /** Idioma activo: 'es' | 'en' */
  lang: Lang;
  /** Cambia el idioma activo */
  setLang: (lang: Lang) => void;
  /** Toggle rápido ES ↔ EN */
  toggleLang: () => void;
  /** Shorthand: true cuando el idioma activo es 'en' */
  isEN: boolean;
  /**
   * Helper de traducción de payloads:
   * Devuelve payload_en si lang==='en' y existe, si no devuelve payload_es.
   */
  resolvePayload: <T extends object>(payloadEs: T, payloadEn?: T) => T;
}

// ── Contexto ──────────────────────────────────────────────────────────────────
const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

// ── Clave de persistencia ─────────────────────────────────────────────────────
const STORAGE_KEY = 'rf360_lang';

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch { /* SSR / sandboxed */ }
  return 'es';
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'es' ? 'en' : 'es');
  }, [lang, setLang]);

  const resolvePayload = useCallback(<T extends object>(
    payloadEs: T,
    payloadEn?: T
  ): T => {
    if (lang === 'en' && payloadEn && Object.keys(payloadEn).length > 0) {
      return payloadEn;
    }
    return payloadEs;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{
      lang,
      setLang,
      toggleLang,
      isEN: lang === 'en',
      resolvePayload,
    }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}

export default LanguageContext;
