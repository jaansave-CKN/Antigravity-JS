import crypto from 'crypto';
import { paymentProvider } from '../payments/index.js';
import { PLANES } from '../config/planes.config.js';
import { withTenantRow, withTenantRun } from '../config/database.config.js';

export { PLANES };

export function registerSubscriptionRoutes(app, { authenticateToken, tryCatch }) {

  // GET /api/subscription — suscripción del usuario actual
  app.get('/api/subscription', authenticateToken, tryCatch(async (req, res) => {
    const sub = await withTenantRow(req.userId,
      'SELECT plan, access_radar, access_formulador, created_at, updated_at FROM user_subscriptions WHERE user_id = ?',
      [req.userId]
    );
    const data = sub
      ? { ...sub, access_radar: !!sub.access_radar, access_formulador: !!sub.access_formulador }
      : { plan: 'free', access_radar: false, access_formulador: false };
    res.json({ success: true, data });
  }));

  // GET /api/plans — catálogo de planes disponibles
  app.get('/api/plans', (req, res) => {
    res.json({ success: true, data: PLANES });
  });

  // POST /api/subscription/activate
  //   Admin (o target_user_id) → activación directa sin pago (backoffice / cortesías).
  //   Usuario normal           → genera checkout hosteado en la pasarela activa
  //   (backend/payments/index.js) y devuelve checkout_url. Esta ruta no sabe
  //   ni le importa si la pasarela es Stripe, Wompi o cualquier otra.
  app.post('/api/subscription/activate', authenticateToken, tryCatch(async (req, res) => {
    const { plan, target_user_id } = req.body;
    if (!plan || !PLANES[plan]) {
      return res.status(400).json({ success: false, message: `Plan inválido. Opciones: ${Object.keys(PLANES).join(', ')}` });
    }

    // ── PATH ADMIN: activación directa en BD (sin Stripe) ─────────────────────
    if (req.userRole === 'admin') {
      // tenantId = userId (el dueño real, target_user_id si el admin activa el
      // plan de OTRO usuario) — NUNCA req.userId. Mismo criterio que el
      // admin-bypass de compliance.routes.js: RLS bloquearía en silencio la
      // escritura si se escopara por el id del admin en vez del dueño real.
      const userId = target_user_id || req.userId;
      const planData = PLANES[plan];
      const existing = await withTenantRow(userId, 'SELECT id FROM user_subscriptions WHERE user_id = ?', [userId]);
      if (existing) {
        await withTenantRun(userId,
          `UPDATE user_subscriptions
           SET plan = ?, access_radar = ?, access_formulador = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
          [plan, planData.access_radar, planData.access_formulador, userId]
        );
      } else {
        await withTenantRun(userId,
          `INSERT INTO user_subscriptions (id, user_id, plan, access_radar, access_formulador)
           VALUES (?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), userId, plan, planData.access_radar, planData.access_formulador]
        );
      }
      return res.json({
        success: true,
        message: `Plan "${planData.nombre}" activado por admin`,
        plan,
        access_radar: !!planData.access_radar,
        access_formulador: !!planData.access_formulador,
      });
    }

    // ── PATH USUARIO: genera checkout hosteado en la pasarela activa ──────────
    if (!paymentProvider.isConfigured) {
      return res.status(503).json({
        success: false,
        message: 'El sistema de pagos no está disponible en este momento. Contacta al administrador.',
      });
    }

    const user = await withTenantRow(req.userId, 'SELECT email, nombre FROM usuarios WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const customerId = await paymentProvider.getOrCreateCustomer(user.email, user.nombre, req.userId, { withTenantRow, withTenantRun });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const session = await paymentProvider.createCheckoutSession({
      customerId,
      plan,
      tenantId: req.userId,
      successUrl: `${frontendUrl}/planes?checkout=success&plan=${plan}`,
      cancelUrl:  `${frontendUrl}/planes?checkout=canceled`,
    });

    res.json({ success: true, checkout_url: session.url, session_id: session.sessionId });
  }));

  // POST /api/bridge/transfer — M2 Puente: valida acceso + crea proyecto borrador desde convocatoria
  app.post('/api/bridge/transfer', authenticateToken, tryCatch(async (req, res) => {
    const sub = await withTenantRow(req.userId,
      'SELECT access_formulador FROM user_subscriptions WHERE user_id = ?',
      [req.userId]
    );

    if (!sub?.access_formulador && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'NO_ACCESS_FORMULADOR',
        message: 'Activa el plan Formulador para formular esta oportunidad',
        upgrade_required: true,
        redirect_to: '/planes',
      });
    }

    const { convocatoria } = req.body;
    if (!convocatoria) {
      return res.status(400).json({ success: false, message: 'convocatoria requerida' });
    }

    const proyectoId = crypto.randomUUID();
    const nombre = `Formulación: ${(convocatoria.titulo || 'Sin título').substring(0, 80)}`;

    await withTenantRun(req.userId,
      `INSERT INTO proyectos (id, user_id, org_id, nombre, estado, problem_statement)
       VALUES (?, ?, ?, ?, 'Borrador', ?)`,
      [proyectoId, req.userId, req.userId, nombre, convocatoria.descripcion || '']
    );

    res.json({
      success: true,
      data: {
        proyecto_id: proyectoId,
        nombre,
        convocatoria_id: convocatoria.id || convocatoria.externo_id,
        redirect_to: `/formulador?proyecto=${proyectoId}&from_radar=true`,
      },
    });
  }));
}
