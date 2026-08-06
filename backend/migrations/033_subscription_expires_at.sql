-- 033_subscription_expires_at.sql
-- Control de Vigencia de Membresía (Dashboard Superadmin): fecha+hora exacta
-- en la que expira el acceso pago de un usuario. Distinto de trial_expires_at
-- (trial anónimo 24h, sin uso real hoy) — expires_at lo fija un admin a mano
-- para altas manuales (pago Nequi u otro medio fuera de Stripe).
-- TIMESTAMPTZ (no TIMESTAMP naive, a diferencia de las columnas hermanas):
-- se compara contra NOW() en cada request autenticado, un tipo naive
-- introduce desfases de zona horaria en esa comparación.

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
