import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { leerAuthToken, esEventoDeSesion } from '../lib/authStorage';

export type PlanId = 'free' | 'radar' | 'formulador' | 'suite';

export interface Subscription {
  plan: PlanId;
  access_radar: boolean;
  access_formulador: boolean;
}

interface SubscriptionContextType {
  subscription: Subscription;
  loading: boolean;
  hasRadar: boolean;
  hasFormulador: boolean;
  hasSuite: boolean;
  loadSubscription: () => Promise<void>;
  /** Devuelve { redirected: true } cuando el usuario fue enviado a Stripe
   *  Checkout (no admin) — en ese caso aún no hay plan activo real, el
   *  llamador no debe mostrar éxito ni navegar, la página está a punto
   *  de descargarse de todas formas. */
  activatePlan: (plan: PlanId) => Promise<{ redirected: boolean }>;
}

const DEFAULT_SUB: Subscription = { plan: 'free', access_radar: false, access_formulador: false };

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [subscription, setSubscription] = useState<Subscription>(DEFAULT_SUB);
  const [loading, setLoading]           = useState(false);

  const loadSubscription = useCallback(async () => {
    const token = leerAuthToken();
    if (!token || token === 'demo-mode-token') { setSubscription(DEFAULT_SUB); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setSubscription(DEFAULT_SUB); return; }
      const data = await r.json();
      if (data.success && data.data) {
        setSubscription({
          plan:               data.data.plan              || 'free',
          access_radar:       !!data.data.access_radar,
          access_formulador:  !!data.data.access_formulador,
        });
      }
    } catch (err) {
      if (err instanceof TypeError) {
        console.warn('[Subscription] Red no disponible — usando plan por defecto', (err as Error).message);
      } else {
        console.error('[Subscription] Error inesperado al cargar suscripción', err);
      }
      setSubscription(DEFAULT_SUB);
    } finally {
      setLoading(false);
    }
  }, []);

  const activatePlan = useCallback(async (plan: PlanId) => {
    const token = leerAuthToken();
    if (!token || token === 'demo-mode-token') throw new Error('Debes iniciar sesión para cambiar de plan');
    const r = await fetch(`${API_BASE}/subscription/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan }),
    });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.message || 'Error activando plan');

    // Path usuario (no-admin): el backend devuelve una Stripe Checkout Session
    // en vez de activar el plan directo — hay que ir a pagar antes de que
    // exista suscripción real. El webhook activa el plan del lado del
    // servidor cuando el pago se confirma; loadSubscription() lo refleja
    // al volver (ver PlanesPage.tsx onde se llama tras checkout=success).
    if (data.checkout_url) {
      window.location.href = data.checkout_url;
      return { redirected: true };
    }

    // Path admin: activación directa, sin Stripe — el backend ya devuelve
    // el plan real aplicado.
    setSubscription({
      plan:               data.plan              || plan,
      access_radar:       !!data.access_radar,
      access_formulador:  !!data.access_formulador,
    });
    return { redirected: false };
  }, []);

  // Cargar suscripción al montar y al cambiar la sesión (mismo tab o tab cruzado)
  useEffect(() => {
    loadSubscription();
    // storage event solo dispara en *otras* pestañas; auth-login cubre el tab actual
    const onStorage = (e: StorageEvent) => {
      if (esEventoDeSesion(e)) loadSubscription();
    };
    const onAuthLogin = () => loadSubscription();
    window.addEventListener('storage', onStorage);
    window.addEventListener('auth-login', onAuthLogin);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('auth-login', onAuthLogin);
    };
  }, [loadSubscription]);

  const value = useMemo(() => ({
    subscription,
    loading,
    hasRadar:       subscription.access_radar,
    hasFormulador:  subscription.access_formulador,
    hasSuite:       subscription.access_radar && subscription.access_formulador,
    loadSubscription,
    activatePlan,
  }), [subscription, loading, loadSubscription, activatePlan]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription debe usarse dentro de <SubscriptionProvider>');
  return ctx;
}
