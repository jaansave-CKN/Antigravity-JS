/**
 * BotonFormularConvocatoria.tsx — disparador del Puente Radar → Formulador
 * dentro de la tarjeta del Radar (`<article className="radx__card">`,
 * columna 5) y de la Búsqueda Semántica. Autocontenido (su propio estado +
 * portal): la tarjeta no necesita callbacks nuevos (dictamen architect C12).
 *
 * Visitante sin sesión o en modo demo → a /login SIN llamar al servidor (C9).
 * El plan Formulador lo decide el servidor (403 NO_ACCESS_FORMULADOR en el
 * modal), no el cliente.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContextNew';
import PuenteFormularModal, { type ConvocatoriaPuente } from './PuenteFormularModal';

interface Props {
  conv: ConvocatoriaPuente;
  /** 'icono' = botón compacto de la tarjeta del Radar; 'texto' = botón primario de la búsqueda. */
  variante?: 'icono' | 'texto';
  /** Lado del botón-icono en px (la esquina de la tarjeta del Radar usa 22). */
  tamano?: number;
}

export default function BotonFormularConvocatoria({ conv, variante = 'icono', tamano = 28 }: Props) {
  const [abierto, setAbierto] = useState(false);
  const { isAuthenticated, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const abrir = () => {
    if (!isAuthenticated || !token || token === 'demo-mode-token') {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setAbierto(true);
  };

  return (
    <>
      {variante === 'icono' ? (
        <button
          type="button"
          onClick={abrir}
          title="Formular esta convocatoria"
          aria-label="Formular esta convocatoria"
          style={{
            width: tamano, height: tamano, borderRadius: 6, border: 'none', padding: 0, cursor: 'pointer',
            background: '#0058be', color: '#ffffff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          {/* flecha hacia un documento (Master Prompt 2) */}
          <svg width={Math.round(tamano * 0.57)} height={Math.round(tamano * 0.57)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <polyline points="14 3 14 8 19 8" />
            <line x1="8" y1="14" x2="15" y2="14" />
            <polyline points="12.5 11.5 15 14 12.5 16.5" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={abrir}
          style={{
            height: 36, padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0058be',
            color: '#ffffff', fontSize: 13, fontWeight: 700, fontFamily: "'Hanken Grotesk', sans-serif",
          }}
        >
          Formular esta convocatoria
        </button>
      )}
      {abierto && <PuenteFormularModal conv={conv} onCerrar={() => setAbierto(false)} />}
    </>
  );
}
