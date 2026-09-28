/**
 * ByokRequiredModal.tsx — Modal global de llave propia (rescate).
 *
 * Escucha 'byok-rescate' (mandato 2026-08-24, "ModalBYOK — degradación
 * elegante", disparado por cada página al hacer clic en un botón ✨ mientras
 * `cuotaAgotada` es true): se ofrece (voluntario, nunca obligatorio) agregar
 * una llave propia para saltarse la fila. Guardar aquí tiene efecto real: la
 * llave del usuario es el último eslabón de la cascada de
 * backend/services/llmProveedor.js (OpenRouter → pool Gemini → BYOK).
 *
 * B1 (2026-09-28): eliminado el modo 'requerido' ('byok-required', 428
 * BYOK_REQUIRED) — byokGate.js ya no existe y nadie emite ese evento.
 *
 * Guarda la llave del slot 1 directamente aquí (caso más común: primera
 * llave propia) vía POST /api/credenciales/gemini. Gestión completa de los
 * 3 slots vive en /apis (CredentialsPage.tsx) — el botón "Gestionar mis
 * llaves" navega ahí solo por click explícito del usuario. Al guardar con
 * éxito, dispara 'ai-quota-refresh' (escuchado por useAiQuotaStatus.ts) para
 * que el cronómetro de cualquier página abierta se refresque de inmediato.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { http, ApiError } from '../lib/apiClient';

const COPY = {
  titulo: 'Alta Demanda en los Servidores de IA',
  cuerpoDefault: 'Nuestra cuota global está al límite en este momento. Para saltarte la fila y continuar sin interrupciones, ingresa tu propia API Key de Google Gemini (es gratuita).',
};

const C = {
  bgCard: '#ffffff',
  border: '#d0d9e4',
  text: '#111827',
  textMuted: '#6b7280',
  accent: '#0058be',
  danger: '#ba1a1a',
};

export default function ByokRequiredModal() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState(false);
  const navigate = useNavigate();
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): `disabled={guardando}` solo se aplica al DOM tras el
  // re-render — sin esto un segundo clic antes de eso podía disparar una
  // segunda validación real de llave contra Gemini.
  const guardandoRef = useRef(false);

  useEffect(() => {
    const onRescate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message?: string } | undefined;
      setMessage(detail?.message || COPY.cuerpoDefault);
      setError('');
      setExito(false);
      setKey('');
      setLabel('');
      setOpen(true);
    };
    window.addEventListener('byok-rescate', onRescate);
    return () => window.removeEventListener('byok-rescate', onRescate);
  }, []);

  const cerrar = useCallback(() => { if (!guardando) setOpen(false); }, [guardando]);

  async function guardarYReintentar() {
    if (guardandoRef.current) return;
    const raw = key.trim();
    if (!raw) { setError('Pega tu llave de Gemini (Google AI Studio) antes de continuar.'); return; }
    guardandoRef.current = true;
    setGuardando(true);
    setError('');
    try {
      await http.post('/api/credenciales/gemini', { key_slot: 1, key: raw, label: label.trim() || 'Principal' });
      setExito(true);
      // Mandato 2026-08-24 ("forzar un refresco del estado del cronómetro"):
      // useAiQuotaStatus.ts escucha este evento en cualquier página abierta.
      window.dispatchEvent(new CustomEvent('ai-quota-refresh'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo validar la llave. Intenta de nuevo.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  if (!open) return null;

  return (
    // react-doctor/no-static-element-interactions + click-events-have-key-events
    // omitidos a propósito: este backdrop es dismiss-on-click-outside estándar
    // (el contenido real hace stopPropagation abajo). Ponerle role="button"/
    // tabIndex lo convertiría en un tab-stop de pantalla completa sin sentido
    // para teclado/lector de pantalla — el cierre por teclado real ya existe
    // vía el botón "Entendido"/Cancelar dentro del modal. Es una decisión de
    // UX de diálogos, no un fix mecánico de aria.
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
        zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      }}
      onClick={cerrar}
    >
      <div
        style={{
          background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16,
          width: 460, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: 24,
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '0 0 6px', fontFamily: "'JetBrains Mono', monospace" }}>
          {COPY.titulo}
        </h2>
        <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 18px', lineHeight: 1.5 }}>
          {message}
        </p>

        {exito ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.3)', color: '#059669', fontSize: 12, fontWeight: 600 }}>
              ✓ Llave guardada y validada. Vuelve a intentar la acción que estabas usando.
            </div>
            <button
              onClick={cerrar}
              style={{ height: 40, borderRadius: 8, border: 'none', background: C.accent, color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em', textTransform: 'uppercase' }}
            >
              Entendido
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Pega tu llave de Gemini (AIza...)"
              aria-label="Llave de API de Gemini"
              autoFocus
              disabled={guardando}
              style={{ width: '100%', padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', background: '#f9fafb', border: `1.5px solid ${C.border}`, borderRadius: 8, outline: 'none', color: C.text, boxSizing: 'border-box' }}
            />
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Etiqueta (opcional, ej. 'Principal')"
              aria-label="Etiqueta de la llave (opcional)"
              disabled={guardando}
              style={{ width: '100%', padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', background: '#f9fafb', border: `1.5px solid ${C.border}`, borderRadius: 8, outline: 'none', color: C.text, boxSizing: 'border-box' }}
            />

            {error && <p style={{ fontSize: 11, color: C.danger, margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={guardarYReintentar}
                disabled={guardando}
                style={{ flex: 1, height: 40, borderRadius: 8, border: 'none', background: C.accent, color: 'white', fontSize: 12, fontWeight: 700, cursor: guardando ? 'default' : 'pointer', opacity: guardando ? 0.7 : 1, letterSpacing: '0.03em', textTransform: 'uppercase' }}
              >
                {guardando ? 'Validando…' : 'Guardar Llave y Continuar'}
              </button>
              <button
                onClick={cerrar}
                disabled={guardando}
                style={{ height: 40, padding: '0 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'white', color: C.textMuted, fontSize: 12, cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>

            <button
              onClick={() => { setOpen(false); navigate('/apis'); }}
              style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11, cursor: 'pointer', padding: '4px 0', textAlign: 'left' }}
            >
              Gestionar mis llaves (hasta 3) →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
