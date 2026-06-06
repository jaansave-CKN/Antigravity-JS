/**
 * LanguageToggle.tsx — Botón switch ES ↔ EN
 *
 * Uso en cualquier componente:
 *   import LanguageToggle from '../components/LanguageToggle';
 *   <LanguageToggle />
 *
 * Se conecta a LanguageContext; el cambio es instantáneo y no genera
 * nuevas peticiones al servidor. La traducción ya está precargada en
 * project.payload_en.
 */

import React from 'react';
import { useLanguage, type Lang } from '../contexts/LanguageContext';

interface LanguageToggleProps {
  /** Clase CSS adicional para el contenedor */
  className?: string;
  /** Variante visual: 'pill' (default) | 'flag' | 'compact' */
  variant?: 'pill' | 'flag' | 'compact';
}

const FLAG: Record<Lang, string> = { es: '🇨🇴', en: '🇬🇧' };
const LABEL: Record<Lang, string> = { es: 'ES', en: 'EN' };
const FULL_LABEL: Record<Lang, string> = { es: 'Español', en: 'English' };

export default function LanguageToggle({ className = '', variant = 'pill' }: LanguageToggleProps) {
  const { lang, setLang } = useLanguage();

  if (variant === 'compact') {
    return (
      <button
        onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
        title={`Cambiar a ${lang === 'es' ? 'English' : 'Español'}`}
        className={className}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 4, border: '1px solid #d0d5dd',
          background: '#fff', cursor: 'pointer', fontSize: 11,
          fontFamily: 'monospace', fontWeight: 700, color: '#344054',
        }}
      >
        {FLAG[lang]} {LABEL[lang]}
      </button>
    );
  }

  if (variant === 'flag') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className={className}>
        {(['es', 'en'] as Lang[]).map(l => (
          <button
            key={l}
            onClick={() => setLang(l)}
            title={FULL_LABEL[l]}
            style={{
              padding: '4px 10px', borderRadius: 20,
              border: lang === l ? '2px solid #2563eb' : '1.5px solid #e0e0e0',
              background: lang === l ? '#eff6ff' : '#fff',
              color: lang === l ? '#1d4ed8' : '#6b7280',
              fontWeight: lang === l ? 700 : 400,
              fontSize: 12, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'all 0.15s',
            }}
          >
            {FLAG[l]} {FULL_LABEL[l]}
          </button>
        ))}
      </div>
    );
  }

  // variant === 'pill' (default)
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: '#f3f4f6', borderRadius: 20, padding: 3,
        border: '1px solid #e5e7eb',
      }}
      title="Cambiar idioma del reporte"
      role="group"
      aria-label="Selector de idioma"
    >
      {(['es', 'en'] as Lang[]).map(l => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          style={{
            padding: '4px 12px', borderRadius: 16,
            border: 'none',
            background: lang === l ? '#ffffff' : 'transparent',
            boxShadow: lang === l ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
            color: lang === l ? '#111827' : '#9ca3af',
            fontWeight: lang === l ? 700 : 400,
            fontSize: 12, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 14 }}>{FLAG[l]}</span>
          <span>{LABEL[l]}</span>
        </button>
      ))}
    </div>
  );
}
