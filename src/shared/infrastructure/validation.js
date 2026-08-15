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

  // POST /api/formulador/fase1 — era el único endpoint de escritura del módulo
  // sin schema (hallazgo auditoría PROTOCOLO TITÁN 2026-08-12, Capa 2): aceptaba
  // cualquier shape/tamaño de campo directo a JSONB. z.record(z.any()) sigue
  // siendo flexible (los formularios varían), pero acota tipo objeto y tamaño
  // total del payload — no bloquea el shape libre que ya usa insertar_fase1.sql.
  fase1: z.object({
    ficha_fase1: z.record(z.any()).refine(v => v.nombre || v.nombre_proyecto, {
      message: 'ficha_fase1.nombre o ficha_fase1.nombre_proyecto es requerido',
    }),
    modulo_7: z.record(z.any()).default({}),
    modulo_8: z.record(z.any()).default({}),
    modulo_9: z.record(z.any()).default({}),
  }).refine(v => JSON.stringify(v).length <= 300_000, {
    message: 'Payload de fase1 excede el tamaño máximo permitido (300KB).',
  }),

  // POST /api/chat — hallazgo real PROTOCOLO OMEGA-TITÁN 2026-08-15: era el
  // único endpoint que consume Claude/Anthropic (costo real por token) SIN
  // validateBody(). max_tokens venía directo de req.body sin tope (un cliente
  // podía pedir cualquier valor), y messages[] no tenía límite de tamaño ni
  // de cantidad de elementos — cada una de las 50 llamadas/día que permite
  // checkQuota podía costar arbitrariamente más de lo esperado. 8192 es el
  // mismo tope que ya usa agents/architecture-gate.cjs para llamadas propias
  // al mismo modelo (pedirVeredictoSubagente).
  chat: z.object({
    messages: z.array(z.object({
      role:    z.enum(['system', 'user', 'assistant']),
      content: z.string().max(50_000),
    })).min(1, 'messages no puede estar vacío').max(20, 'máximo 20 mensajes por llamada'),
    max_tokens: z.number().int().min(1).max(8192).optional(),
  }),

  fichaTecnica: z.object({
    ficha: z.object({
      metadata:  z.record(z.any()),
      geography: z.record(z.any()),
      population: z.record(z.any()).optional(),
      // technical_core sigue siendo flexible (.passthrough()) — solo
      // bill_of_materials[].cantidad/precio_unitario quedan acotados a
      // enteros. Regla de negocio innegociable 2026-08-15 (PROTOCOLO
      // OMEGA-TITÁN, hallazgo #4): COP no usa decimales, y AgentOperativo
      // (src/orchestrator-engine.js:147-156) calcula costo_directo/AIU/IVA
      // directo de estos dos campos sin normalizar — un valor fraccionario
      // aquí propagaría un presupuesto_total no entero. .passthrough() en
      // cada ítem preserva campos descriptivos adicionales (nombre, unidad)
      // que el formulario ya envía y que ningún cálculo financiero usa.
      technical_core: z.object({
        bill_of_materials: z.array(z.object({
          cantidad:        z.number().int('cantidad debe ser un número entero — COP no maneja decimales').optional(),
          precio_unitario: z.number().int('precio_unitario debe ser un número entero — COP no maneja decimales').optional(),
        }).passthrough()).optional(),
      }).passthrough(),
      attachments: z.record(z.any()).optional(),
    }),
  }),
};
