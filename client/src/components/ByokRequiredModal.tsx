/**
 * ByokRequiredModal.tsx — Guard global BYOK (migración 045).
 *
 * Escucha 2 eventos globales distintos, mismo formulario de guardado:
 *
 * 1. 'byok-required' (disparado por apiClient.ts cuando cualquiera de las 7
 *    acciones interactivas de IA responde 428/BYOK_REQUIRED —
 *    backend/middlewares/byokGate.js) — usuario NO exento sin ninguna llave
 *    propia todavía. Modal, nunca redirect: mandato explícito del usuario
 *    para evitar un bucle con el redirect ya existente de AuthGuard
 *    (hasCredentials === false → /apis).
 *
 * 2. 'byok-rescate' (mandato 2026-08-24, "ModalBYOK — degradación
 *    elegante", disparado por cada página al hacer clic en un botón ✨
 *    mientras `cuotaAgotada` es true) — usuario EXENTO viendo el pool
 *    compartido agotado, a quien se le ofrece (voluntario, nunca obligatorio)
 *    agregar su propia llave para saltarse la fila — ver la válvula de
 *    escape en byokGate.js (exento + llave propia + pool agotado → usa la
 *    llave propia). Guardar aquí SÍ tiene efecto real para un exento gracias
 *    a ese cambio de backend — antes de esa fecha no lo tenía.
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

type Modo = 'requerido' | 'rescate';

const COPY: Record<Modo, { titulo: string; cuerpoDefault: string }> = {
  requerido: {
    titulo: 'Llave de Gemini requerida',
    cuerpoDefault: 'Configura tu propia llave de Gemini antes de usar esta función.',
  },
  rescate: {
    titulo: 'Alta Demanda en los Servidores de IA',
    cuerpoDefault: 'Nuestra cuota global está al límite en este momento. Para saltarte la fila y continuar sin interrupciones, ingresa tu propia API Key de Google Gemini (es gratuita).',
  },
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
  const [modo, setModo] = useState<Modo>('requerido');
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
    const abrir = (m: Modo) => (e: Event) => {
      const detail = (e as CustomEvent).detail as { message?: string } | undefined;
      setModo(m);
      setMessage(detail?.message || COPY[m].cuerpoDefault);
      setError('');
      setExito(false);
      setKey('');
      setLabel('');
      setOpen(true);
    };
    const onRequerido = abrir('requerido');
    const onRescate = abrir('rescate');
    window.addEventListener('byok-required', onRequerido);
    window.addEventListener('byok-rescate', onRescate);
    return () => {
      window.removeEventListener('byok-required', onRequerido);
      window.removeEventListener('byok-rescate', onRescate);
    };
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
          {COPY[modo].titulo}
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
              autoFocus
              disabled={guardando}
              style={{ width: '100%', padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', background: '#f9fafb', border: `1.5px solid ${C.border}`, borderRadius: 8, outline: 'none', color: C.text, boxSizing: 'border-box' }}
            />
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Etiqueta (opcional, ej. 'Principal')"
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
                {guardando ? 'Validando…' : (modo === 'rescate' ? 'Guardar Llave y Continuar' : 'Guardar llave')}
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
