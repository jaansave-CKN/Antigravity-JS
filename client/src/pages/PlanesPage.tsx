import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSubscription, type PlanId } from '../contexts/SubscriptionContext';
import { useAuth } from '../contexts/AuthContextNew';
import { API_BASE } from '../lib/apiClient';
import { cop as formatoCOP } from '../lib/currencyFormat';

// Metadata exclusiva de UI (marketing/listado de módulos) — el precio y el
// nombre canónico vienen de GET /api/plans (backend/routes/subscriptions.routes.js:PLANES),
// única fuente de verdad. No duplicar números acá — ver docs/PRECIOS.md.
interface PlanUIMeta {
  id: Exclude<PlanId, 'free'>;
  descripcion: string;
  modulos: string[];
  color: string;
  destacado: boolean;
}

const PLANES_UI_META: PlanUIMeta[] = [
  {
    id: 'radar',
    descripcion: 'Inteligencia de mercado para detectar oportunidades',
    modulos: [
      'M0 — Gatekeeper (aprobación humana)',
      'M1 — Radar de Oportunidades (búsqueda, filtros, favoritos)',
      'M2 — Puente de Interoperabilidad (vista)',
    ],
    color: '#0058be',
    destacado: false,
  },
  {
    id: 'formulador',
    descripcion: 'Caja Negra de Formulación — del pliego al proyecto blindado',
    modulos: [
      'M3 — Ingesta (carga de pliegos propios)',
      'M4 — Motor Dialéctico (tono, lista Oro/Negra)',
      'M5 — Configuración Logística',
      'M6 — Formulación (Árbol de Objetivos con IA)',
      'M7 — Arquitectura Financiera (APU)',
      'M8 — Marco Normativo',
      'M9 — Auditoría de Calidad',
      'M10 — Compliance (riesgos/sostenibilidad)',
      'M11 — Consultor Estratégico y Defensa',
      'M12 — Ficha Técnica Maestra (Hash)',
    ],
    color: '#16a34a',
    destacado: true,
  },
  {
    id: 'suite',
    descripcion: 'Acceso total al ecosistema Radar + Formulador 360',
    modulos: [
      'Todo el plan Radar',
      'Todo el plan Formulador',
      'M2 — Puente activo: Radar → Formulador con un clic',
      'Prioridad en soporte',
    ],
    color: '#7c3aed',
    destacado: false,
  },
];

interface PlanDef extends PlanUIMeta {
  nombre: string;
  precio: number;
}

interface ApiPlanRow { nombre: string; precio: number; access_radar: number; access_formulador: number }

export default function PlanesPage() {
  const navigate                              = useNavigate();
  const [searchParams, setSearchParams]       = useSearchParams();
  const { subscription, activatePlan, loadSubscription } = useSubscription();
  const { isAuthenticated }                   = useAuth();
  const [activando, setActivando]             = useState<PlanId | null>(null);
  const [error, setError]                     = useState<string | null>(null);
  const [exitoId, setExitoId]                 = useState<PlanId | null>(null);
  const [avisoCheckout, setAvisoCheckout]     = useState<'success' | 'canceled' | null>(null);
  const [planes, setPlanes]                   = useState<PlanDef[] | null>(null);

  // Precio/nombre reales desde el backend (única fuente de verdad) — se
  // combinan con la metadata de marketing/UI que solo vive en el frontend.
  useEffect(() => {
    fetch(`${API_BASE}/api/plans`)
      .then(r => r.json())
      .then(body => {
        if (!body?.success || !body?.data) return;
        const data = body.data as Record<string, ApiPlanRow>;
        setPlanes(
          PLANES_UI_META.map(meta => ({
            ...meta,
            nombre: data[meta.id]?.nombre ?? meta.id,
            precio: data[meta.id]?.precio ?? 0,
          }))
        );
      })
      .catch(() => setPlanes(null));
  }, []);

  // Retorno desde Stripe Checkout (real, no el "modo demo" de abajo). El
  // webhook checkout.session.completed ya activó el plan del lado del
  // servidor antes de que Stripe redirija aquí — solo hace falta refrescar
  // el estado real en vez de confiar en lo que se veía antes de pagar.
  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success' || checkout === 'canceled') {
      setAvisoCheckout(checkout);
      if (checkout === 'success') loadSubscription();
      const next = new URLSearchParams(searchParams);
      next.delete('checkout');
      next.delete('plan');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleActivar = async (planId: PlanId) => {
    if (!isAuthenticated) { navigate('/login'); return; }
    setActivando(planId);
    setError(null);
    setExitoId(null);
    try {
      const { redirected } = await activatePlan(planId);
      if (redirected) return; // la página está por navegar a Stripe Checkout
      setExitoId(planId);
      setTimeout(() => {
        if (planId === 'formulador' || planId === 'suite') navigate('/checklist');
        else navigate('/radar');
      }, 1400);
    } catch (e: any) {
      setError(e.message || 'Error al activar el plan');
    } finally {
      setActivando(null);
    }
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 48px)',
      background: 'linear-gradient(135deg,#f0f4ff 0%,#fafafa 60%,#f0fdf4 100%)',
      padding: '3rem 1.5rem',
      fontFamily: 'system-ui,sans-serif',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <p style={{
          fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
          color: '#0058be', letterSpacing: '0.12em',
          textTransform: 'uppercase', marginBottom: 8,
        }}>
          PLANES Y SUSCRIPCIONES — V8.0
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: '#191c1e', margin: '0 0 10px' }}>
          Elige tu módulo de acceso
        </h1>
        <p style={{ fontSize: 14, color: '#45464d', maxWidth: 460, margin: '0 auto' }}>
          Suscripciones independientes por bloque. Paga solo lo que necesitas,
          combínalos cuando estés listo.
        </p>
        {subscription.plan !== 'free' && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#ecfdf5', border: '1px solid #6ee7b7',
            borderRadius: 20, padding: '5px 16px', marginTop: 14,
            fontSize: 12, color: '#065f46', fontWeight: 600,
          }}>
            Plan activo:&nbsp;
            <span style={{ fontFamily: 'monospace', textTransform: 'uppercase', fontWeight: 800 }}>
              {subscription.plan}
            </span>
          </div>
        )}
      </div>

      {avisoCheckout === 'success' && (
        <div style={{
          maxWidth: 460, margin: '0 auto 1.5rem', background: '#ecfdf5',
          border: '1px solid #6ee7b7', borderRadius: 8,
          padding: '10px 16px', fontSize: 13, color: '#065f46', textAlign: 'center',
        }}>
          Pago confirmado. Tu plan ya está activo.
        </div>
      )}
      {avisoCheckout === 'canceled' && (
        <div style={{
          maxWidth: 460, margin: '0 auto 1.5rem', background: '#fffbeb',
          border: '1px solid #fcd34d', borderRadius: 8,
          padding: '10px 16px', fontSize: 13, color: '#92400e', textAlign: 'center',
        }}>
          Pago cancelado — no se realizó ningún cargo.
        </div>
      )}

      {error && (
        <div style={{
          maxWidth: 460, margin: '0 auto 1.5rem', background: '#fff4f4',
          border: '1px solid #fca5a5', borderRadius: 8,
          padding: '10px 16px', fontSize: 13, color: '#ba1a1a', textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      {planes === null && (
        <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>Cargando planes…</p>
      )}

      {/* Plan cards */}
      <div style={{
        display: 'flex', gap: '1.25rem', maxWidth: 960,
        margin: '0 auto', flexWrap: 'wrap', justifyContent: 'center',
      }}>
        {(planes ?? []).map(plan => {
          const esActual = subscription.plan === plan.id;
          const enExito  = exitoId === plan.id;
          const enCarga  = activando === plan.id;

          return (
            <div key={plan.id} style={{
              background: '#fff',
              border: `2px solid ${plan.destacado || esActual ? plan.color : '#e8e8ed'}`,
              borderRadius: 16, padding: '1.75rem',
              width: 275, position: 'relative',
              boxShadow: plan.destacado
                ? `0 8px 28px ${plan.color}22`
                : '0 2px 10px rgba(0,0,0,0.06)',
            }}>
              {plan.destacado && (
                <div style={{
                  position: 'absolute', top: -11, left: '50%',
                  transform: 'translateX(-50%)',
                  background: plan.color, color: '#fff',
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                  padding: '2px 14px', borderRadius: 20,
                  textTransform: 'uppercase', fontFamily: 'monospace',
                }}>
                  RECOMENDADO
                </div>
              )}

              {esActual && (
                <div style={{
                  position: 'absolute', top: 10, right: 10,
                  background: '#ecfdf5', color: '#065f46',
                  fontSize: 9, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 20, fontFamily: 'monospace',
                  border: '1px solid #6ee7b7', textTransform: 'uppercase',
                }}>
                  ACTIVO
                </div>
              )}

              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `${plan.color}18`,
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', marginBottom: 10,
              }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: plan.color }} />
              </div>

              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#191c1e', margin: '0 0 4px' }}>
                {plan.nombre}
              </h2>
              <p style={{ fontSize: 12, color: '#76777d', margin: '0 0 14px', lineHeight: 1.5 }}>
                {plan.descripcion}
              </p>

              <div style={{ marginBottom: '1.25rem' }}>
                <span style={{ fontSize: 32, fontWeight: 800, color: plan.color }}>
                  {formatoCOP.format(plan.precio)}
                </span>
                <span style={{ fontSize: 12, color: '#76777d' }}>/mes</span>
              </div>

              <ul style={{
                listStyle: 'none', padding: 0, margin: '0 0 1.25rem',
                display: 'flex', flexDirection: 'column', gap: 7,
              }}>
                {plan.modulos.map((m) => (
                  <li key={m} style={{
                    display: 'flex', alignItems: 'flex-start',
                    gap: 7, fontSize: 11, color: '#45464d',
                  }}>
                    <span style={{ color: plan.color, flexShrink: 0, fontWeight: 700, marginTop: 1 }}>✓</span>
                    <span style={{ lineHeight: 1.45 }}>{m}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleActivar(plan.id)}
                disabled={esActual || enCarga || !!exitoId}
                style={{
                  width: '100%', height: 38,
                  background: enExito ? '#16a34a' : (esActual ? '#f1f5f9' : plan.color),
                  color: esActual ? '#94a3b8' : '#fff',
                  border: 'none', borderRadius: 7,
                  fontSize: 12, fontWeight: 700,
                  fontFamily: 'monospace', letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: (esActual || enCarga || !!exitoId) ? 'not-allowed' : 'pointer',
                }}
              >
                {enCarga  ? 'Activando...'      :
                 enExito  ? '¡Listo!'           :
                 esActual ? 'Plan actual'        :
                            `Activar ${plan.nombre}`}
              </button>
            </div>
          );
        })}
      </div>

      <p style={{
        textAlign: 'center', fontSize: 10, color: '#c6c6cd',
        fontFamily: 'monospace', margin: '2rem auto 0', maxWidth: 480,
      }}>
        Pasarela de pago Stripe integrada, en espera de activación (STRIPE_SECRET_KEY).
      </p>

      <div style={{ textAlign: 'center', marginTop: '1rem' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none',
            color: '#0058be', fontSize: 13, cursor: 'pointer',
          }}
        >
          ← Volver
        </button>
      </div>
    </div>
  );
}
