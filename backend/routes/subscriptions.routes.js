import crypto from 'crypto';

export const PLANES = {
  free:        { nombre: 'Gratis',     access_radar: 0, access_formulador: 0, precio: 0,   descripcion: 'Acceso de exploración limitado' },
  radar:       { nombre: 'Radar',      access_radar: 1, access_formulador: 0, precio: 49,  descripcion: 'M1 Radar de Oportunidades + M2 Puente (solo vista)' },
  formulador:  { nombre: 'Formulador', access_radar: 0, access_formulador: 1, precio: 79,  descripcion: 'M3–M12 Caja Negra de Formulación completa' },
  suite:       { nombre: 'Suite',      access_radar: 1, access_formulador: 1, precio: 119, descripcion: 'Acceso total al ecosistema Radar + Formulador' },
};

export function registerSubscriptionRoutes(app, { authenticateToken, runSql, getRow, tryCatch }) {

  // GET /api/subscription — suscripción del usuario actual
  app.get('/api/subscription', authenticateToken, tryCatch(async (req, res) => {
    const sub = await getRow(
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

  // POST /api/subscription/activate — activa un plan
  // Admin puede activar para cualquier usuario (target_user_id). Usuario normal solo para sí mismo.
  app.post('/api/subscription/activate', authenticateToken, tryCatch(async (req, res) => {
    const { plan, target_user_id } = req.body;
    if (!plan || !PLANES[plan]) {
      return res.status(400).json({ success: false, message: `Plan inválido. Opciones: ${Object.keys(PLANES).join(', ')}` });
    }

    const userId = (req.userRole === 'admin' && target_user_id) ? target_user_id : req.userId;
    const planData = PLANES[plan];

    const existing = await getRow('SELECT id FROM user_subscriptions WHERE user_id = ?', [userId]);
    if (existing) {
      await runSql(
        `UPDATE user_subscriptions
         SET plan = ?, access_radar = ?, access_formulador = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [plan, planData.access_radar, planData.access_formulador, userId]
      );
    } else {
      await runSql(
        `INSERT INTO user_subscriptions (id, user_id, plan, access_radar, access_formulador) VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), userId, plan, planData.access_radar, planData.access_formulador]
      );
    }

    res.json({
      success: true,
      message: `Plan "${planData.nombre}" activado correctamente`,
      plan,
      access_radar: !!planData.access_radar,
      access_formulador: !!planData.access_formulador,
    });
  }));

  // POST /api/bridge/transfer — M2 Puente: valida acceso + crea proyecto borrador desde convocatoria
  app.post('/api/bridge/transfer', authenticateToken, tryCatch(async (req, res) => {
    const sub = await getRow(
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

    await runSql(
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
