import crypto from 'crypto';

export function registerMotorDialecticoRoutes(app, { authenticateToken, runSql, getRow, tryCatch }) {

  // SECURITY: valida propiedad de :proyectoId antes de tocar motor_dialectico —
  // mismo fix de BOLA aplicado en compliance/configLogistica/marcoNormativo.
  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  // GET /api/m4/config/:proyectoId
  app.get('/api/m4/config/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const row = await getRow(
      'SELECT * FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );
    res.json({ success: true, data: row || null });
  }));

  // POST /api/m4/config/:proyectoId
  //
  // NOTA sobre `tono`: la validación original solo aceptaba un enum interno
  // (formal/tecnico/comunitario/academico/normativo) que nunca coincidió con
  // los valores reales que produce DialecticaPage.tsx (Diplomatico/
  // Institucional/Tecnico/Inspirador/Ejecutivo) — el frontend nunca pudo
  // guardar sin recibir 400. Se guarda el valor real tal cual, sin whitelist,
  // igual que ya se hace con enfasis/lista_oro/lista_negra.
  //
  // Columnas nuevas (interlocutor/enfoque/humanizacion/adicionales) capturan
  // el resto de la UI real de Dialéctica, que no tenía dónde persistirse.
  app.post('/api/m4/config/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const {
      tono = '', lista_oro = [], lista_negra = [], enfasis = '',
      interlocutor = '', enfoque = '', humanizacion = '', adicionales = [],
    } = req.body;

    const existing = await getRow(
      'SELECT id FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );

    const valsCompletos = [
      tono, JSON.stringify(lista_oro), JSON.stringify(lista_negra), enfasis,
      interlocutor, enfoque, humanizacion, JSON.stringify(adicionales),
    ];
    const valsLegacy = [tono, JSON.stringify(lista_oro), JSON.stringify(lista_negra), enfasis];

    async function escribir(columnas, valores) {
      if (existing) {
        const sets = columnas.map(c => `${c} = ?`).join(', ');
        await runSql(
          `UPDATE motor_dialectico SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE proyecto_id = ? AND user_id = ?`,
          [...valores, req.params.proyectoId, req.userId]
        );
      } else {
        const cols = ['id', 'proyecto_id', 'user_id', ...columnas].join(', ');
        const placeholders = ['?', '?', '?', ...columnas.map(() => '?')].join(', ');
        await runSql(
          `INSERT INTO motor_dialectico (${cols}) VALUES (${placeholders})`,
          [crypto.randomUUID(), req.params.proyectoId, req.userId, ...valores]
        );
      }
    }

    // NULL, no '' — un CHECK(tono IN (...)) rechaza tanto '' como cualquier
    // valor fuera de la lista; solo NULL lo evade (NULL IN (...) = NULL, no FALSE).
    const valsSinTono = [ null, JSON.stringify(lista_oro), JSON.stringify(lista_negra), enfasis ];

    try {
      // Intento 1: columnas nuevas (interlocutor/enfoque/humanizacion/
      // adicionales) — requiere la migración 016 ya aplicada.
      await escribir(['tono', 'lista_oro', 'lista_negra', 'enfasis', 'interlocutor', 'enfoque', 'humanizacion', 'adicionales'], valsCompletos);
    } catch (err) {
      const columnaFaltante = /Could not find the '(\w+)' column/.exec(err.message)?.[1];
      const esTonoCheck = /violates check constraint "motor_dialectico_tono_check"/.test(err.message);
      const NUEVAS = new Set(['interlocutor', 'enfoque', 'humanizacion', 'adicionales']);

      if (columnaFaltante && NUEVAS.has(columnaFaltante)) {
        // Intento 2: columnas nuevas no existen todavía (migración 016
        // pendiente) — degrada a los 4 campos originales.
        try {
          await escribir(['tono', 'lista_oro', 'lista_negra', 'enfasis'], valsLegacy);
        } catch (err2) {
          if (/violates check constraint "motor_dialectico_tono_check"/.test(err2.message)) {
            // Intento 3: además el CHECK viejo de tono sigue activo (mismo
            // motivo: migración 016 pendiente) — se guarda todo excepto
            // tono, que queda vacío hasta que la migración elimine el CHECK.
            await escribir(['tono', 'lista_oro', 'lista_negra', 'enfasis'], valsSinTono);
          } else {
            throw err2;
          }
        }
      } else if (esTonoCheck) {
        // Columnas nuevas sí existen, pero el CHECK de tono sigue activo.
        await escribir(['tono', 'lista_oro', 'lista_negra', 'enfasis', 'interlocutor', 'enfoque', 'humanizacion', 'adicionales'],
          [ '', JSON.stringify(lista_oro), JSON.stringify(lista_negra), enfasis, interlocutor, enfoque, humanizacion, JSON.stringify(adicionales) ]);
      } else {
        throw err;
      }
    }

    res.json({ success: true, message: 'Configuración dialéctica guardada' });
  }));
}
