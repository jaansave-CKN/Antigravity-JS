/**
 * AvisoApiError.tsx — banner ÚNICO y honesto para errores de la API
 * (directiva OMEGA-7, 2026-09-29; dictamen architect C7).
 *
 * Decide por `code` (no solo por status): el 403 de plan no es el 403 de
 * CSRF, y un 503 de catálogo sin indexar no es el de IA caída. Nunca inventa
 * datos: la hora de reintento solo se muestra si el servidor la envió
 * (`retryAt`); si no, se dice que no hay una hora garantizada.
 * Tokens del Master Prompt (Stitch): #191c1e texto · #45464d secundario ·
 * #ba1a1a error · #ca8a04 alerta · #0284c7 info · #0058be primario ·
 * Hanken Grotesk (UI) · JetBrains Mono (horas y cifras).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/apiClient';

type Tono = 'error' | 'alerta' | 'info';
const TONOS: Record<Tono, { color: string; fondo: string; borde: string }> = {
  error:  { color: '#ba1a1a', fondo: 'rgba(186,26,26,0.06)', borde: 'rgba(186,26,26,0.25)' },
  alerta: { color: '#ca8a04', fondo: 'rgba(202,138,4,0.08)', borde: 'rgba(202,138,4,0.30)' },
  info:   { color: '#0284c7', fondo: 'rgba(2,132,199,0.07)', borde: 'rgba(2,132,199,0.25)' },
};
const MONO = "'JetBrains Mono', monospace";

interface Aviso { tono: Tono; titulo: string; detalle?: string; retryAt?: string | null; accion?: 'planes' | 'login' | 'recargar' | 'radar' }

/** Traduce cualquier error (ApiError o de red) a un aviso honesto. */
function avisoDe(error: unknown): Aviso {
  if (!(error instanceof ApiError)) {
    return { tono: 'error', titulo: 'No se pudo conectar con el servidor.', detalle: 'Revisa tu conexión e inténtalo de nuevo.' };
  }
  const body = (error.body || {}) as { upgrade_required?: boolean; retryAt?: string | null; plan?: string };
  const code = error.code || '';
  switch (error.status) {
    case 401:
      return { tono: 'alerta', titulo: 'Tu sesión no está activa.', detalle: 'Inicia sesión para usar esta función.', accion: 'login' };
    case 403:
      if (code === 'CSRF_TOKEN_INVALID') return { tono: 'alerta', titulo: 'La sesión de seguridad de esta pestaña expiró.', detalle: 'Recarga la página e inténtalo de nuevo.', accion: 'recargar' };
      if (body.upgrade_required || /^NO_ACCESS_/.test(code)) {
        const plan = code === 'NO_ACCESS_FORMULADOR' ? 'Formulador o Suite' : code === 'NO_ACCESS_RADAR' ? 'Radar o Suite' : 'correspondiente';
        return { tono: 'alerta', titulo: `Esta función requiere el plan ${plan}.`, accion: 'planes' };
      }
      return { tono: 'error', titulo: error.message || 'No tienes permiso para esta acción.' };
    case 404:
      return { tono: 'alerta', titulo: error.message || 'El recurso ya no está disponible.', accion: code === 'CONVOCATORIA_NO_ENCONTRADA' ? 'radar' : undefined };
    case 429:
      return {
        tono: 'alerta',
        titulo: code === 'IA_TOPE_AGOTADO' ? 'Alcanzaste tu tope de uso de IA.' : 'Alcanzaste el límite de consultas de IA por ahora.',
        detalle: error.message && !/^HTTP /.test(error.message) ? error.message : undefined,
        retryAt: body.retryAt ?? null,
      };
    case 503:
      if (code === 'CATALOGO_SIN_EMBEDDINGS') return { tono: 'info', titulo: 'El catálogo se está indexando.', detalle: 'La búsqueda semántica estará disponible pronto; mientras tanto usa los filtros del Radar.', accion: 'radar' };
      if (code === 'BUSQUEDA_NO_VERIFICABLE') return { tono: 'alerta', titulo: 'No se pudo verificar el catálogo en este momento.', detalle: 'Inténtalo de nuevo en unos minutos.' };
      return { tono: 'error', titulo: 'Servicio de IA no disponible temporalmente.', detalle: 'No se generó ningún resultado. Tu consulta no se perdió.' };
    default:
      return { tono: 'error', titulo: error.message || `Error ${error.status}` };
  }
}

function hora24(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function CuentaRegresiva({ retryAt }: { retryAt: string }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, new Date(retryAt).getTime() - ahora);
  const mm = String(Math.floor(ms / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  return (
    <span style={{ fontFamily: MONO, fontWeight: 700 }}>
      {ms > 0 ? `${mm}:${ss} — se restablece a las ${hora24(retryAt)}` : 'Ya puedes reintentar.'}
    </span>
  );
}

interface Props {
  error: unknown;
  /** Botón "Reintentar" (solo se muestra si se pasa). */
  onReintentar?: () => void;
  textoReintentar?: string;
}

const boton: React.CSSProperties = {
  height: 32, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: "'Hanken Grotesk', sans-serif", textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
};

export default function AvisoApiError({ error, onReintentar, textoReintentar = 'Reintentar' }: Props) {
  if (!error) return null;
  const a = avisoDe(error);
  const t = TONOS[a.tono];
  return (
    <div
      role={a.tono === 'info' ? 'status' : 'alert'}
      style={{
        background: t.fondo, border: `1px solid ${t.borde}`, borderRadius: 8, padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 6, fontFamily: "'Hanken Grotesk', sans-serif",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: t.color }}>{a.titulo}</p>
      {a.detalle && <p style={{ margin: 0, fontSize: 13, color: '#45464d', lineHeight: 1.5 }}>{a.detalle}</p>}
      {a.tono === 'alerta' && error instanceof ApiError && error.status === 429 && (
        <p style={{ margin: 0, fontSize: 13, color: '#45464d' }}>
          {a.retryAt ? <CuentaRegresiva retryAt={a.retryAt} /> : 'El servidor no informó una hora de restablecimiento; inténtalo más tarde.'}
        </p>
      )}
      {(a.accion || onReintentar) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {a.accion === 'planes' && <Link to="/planes" style={{ ...boton, background: '#0058be', color: '#ffffff', border: 'none' }}>Ver planes</Link>}
          {a.accion === 'login' && <Link to="/login" style={{ ...boton, background: '#0058be', color: '#ffffff', border: 'none' }}>Iniciar sesión</Link>}
          {a.accion === 'radar' && <Link to="/radar" style={{ ...boton, background: '#ffffff', color: '#0058be', border: '1px solid #c6c6cd' }}>Ir al Radar</Link>}
          {a.accion === 'recargar' && (
            <button type="button" onClick={() => window.location.reload()} style={{ ...boton, background: '#ffffff', color: '#0058be', border: '1px solid #c6c6cd' }}>Recargar</button>
          )}
          {onReintentar && (
            <button type="button" onClick={onReintentar} style={{ ...boton, background: '#ffffff', color: '#191c1e', border: '1px solid #c6c6cd' }}>{textoReintentar}</button>
          )}
        </div>
      )}
    </div>
  );
}
