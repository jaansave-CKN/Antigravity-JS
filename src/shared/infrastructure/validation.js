import { z } from 'zod';

// Middleware factory — valida req.body contra un schema zod antes de llegar al handler.
// Reemplaza los checks manuales de 1-2 campos dispersos por el árbol (ver
// docs/analisis_gaps_v1.md A3). Errores de shape nunca llegan al handler como 500.
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Body inválido.',
        detail: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}

export const schemas = {
  sendEmail: z.object({
    email:   z.string().trim().email('email debe ser una dirección válida'),
    subject: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1, 'content no puede estar vacío').max(50_000),
  }),

  sessionLogin: z.object({
    firebaseToken: z.string().min(20, 'firebaseToken inválido'),
  }),

  sessionVerify: z.object({
    token: z.string().min(20, 'token inválido'),
  }),

  execute: z.object({
    user:   z.string().trim().min(1).max(200),
    action: z.string().trim().min(1).max(500),
  }),

  modulo10: z.object({
    // OCC (ADR-0001, Migración A) — opcional: sin este campo no se valida
    // concurrencia (cliente legacy o primera escritura). Si se envía, debe
    // coincidir con el último hash registrado o la petición se rechaza (409).
    version_hash: z.string().length(64).optional(),
    indicadores: z.array(z.object({
      indicador:           z.string().trim().min(1),
      tipo:                z.enum(['producto', 'resultado', 'impacto']).optional(),
      unidad:              z.string().trim().optional(),
      linea_base:          z.string().trim().optional(),
      meta:                z.string().trim().optional(),
      fuente_verificacion: z.string().trim().optional(),
      responsable:         z.string().trim().optional(),
      frecuencia_medicion: z.string().trim().optional(),
      avance_actual:       z.string().trim().optional(),
    })).default([]),
  }),

  fichaTecnica: z.object({
    ficha: z.object({
      metadata:       z.record(z.any()),
      geography:      z.record(z.any()),
      population:     z.record(z.any()).optional(),
      technical_core: z.record(z.any()),
      attachments:    z.record(z.any()).optional(),
    }),
  }),
};
