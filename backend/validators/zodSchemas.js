/**
 * zodSchemas.js — esquemas de validación estricta para los endpoints de
 * mutación del backend. Cubre TODOS los endpoints POST/PUT/PATCH/DELETE que
 * reciben un body con campos (Fase 1: register/proyectos/credenciales-gemini;
 * Fase 2: barrido completo del resto del backend).
 *
 * Principio de diseño (no negociable, ver 02_INFORME.md de la auditoría):
 * estos esquemas validan FORMA/TIPO, no reemplazan reglas de negocio ya
 * existentes en cada handler (fortaleza de password, cross-check presupuestal,
 * punto de equilibrio, moneda COP, presencia-vs-vacío en updates parciales).
 * Donde un handler ya tiene un validador de dominio con mensajes de error
 * específicos (calcularPuntoEquilibrio, runCrossCheck), el esquema de aquí
 * solo exige que el campo exista con el tipo correcto — el mensaje de negocio
 * sigue viniendo de esa función, no de Zod.
 *
 * Endpoints deliberadamente SIN esquema aquí (ver 02_INFORME.md para la lista
 * completa con justificación): sin body (rutas de acción/params puros),
 * webhooks de Stripe/Wompi (payload externo verificado por firma, no por
 * Zod), y GET.
 */
import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Auth / cuenta
// ────────────────────────────────────────────────────────────────────────────

export const registroUsuarioSchema = z.object({
  email: z.string().trim().min(1, 'email requerido').max(254).email('email inválido'),
  password: z.string().min(1, 'password requerido').max(128),
  nombre: z.string().trim().min(1, 'nombre requerido').max(200),
  role: z.string().max(30).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'email requerido').max(254).email('email inválido'),
  password: z.string().min(1, 'password requerido').max(128),
});

export const mfaChallengeSchema = z.object({
  preAuthToken: z.string().min(1),
  code: z.string().trim().min(1).max(20),
});

export const mfaCodeSchema = z.object({
  code: z.string().trim().min(1).max(20),
});

export const passwordSoloSchema = z.object({
  password: z.string().min(1, 'password requerido'),
});

export const tokenSoloSchema = z.object({
  token: z.string().min(1, 'token requerido'),
});

export const putAuthMeSchema = z.object({
  nombre: z.string().trim().min(1, 'nombre requerido').max(200),
});

export const changePasswordSchema = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().max(254).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'token requerido'),
  newPassword: z.string().min(1, 'newPassword requerido').max(128),
});

export const reportErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  url: z.string().max(2000).optional(),
});

export const credentialsSchema = z.object({
  service: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(1).max(2000),
  label: z.string().trim().max(100).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Admin
// ────────────────────────────────────────────────────────────────────────────

export const permisosUsuarioSchema = z.object({
  access_radar: z.boolean().optional(),
  access_formulador: z.boolean().optional(),
  expires_at: z.string().max(40).nullable().optional(),
  is_active: z.boolean().optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Directorio / Entidades
// ────────────────────────────────────────────────────────────────────────────

export const crearEntidadSchema = z.object({
  nombre: z.string().trim().min(1, 'nombre requerido').max(300),
  sigla: z.string().trim().max(50).optional(),
  tipo: z.string().trim().max(100).optional(),
  pais: z.string().trim().max(100).optional(),
  sitio_web: z.string().trim().min(1, 'sitio_web requerido').max(500),
  url_convocatorias: z.string().trim().max(500).optional(),
  telefono: z.string().trim().max(50).optional(),
  email: z.string().trim().max(254).optional(),
  alcance: z.string().trim().max(100).optional(),
}).passthrough();

export const patchEntidadUrlSchema = z.object({
  url_convocatorias: z.string().trim().min(1, 'url_convocatorias requerida').max(500),
});

export const patchEntidadStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

export const entidadScrapeAsyncSchema = z.object({
  entidadId: z.string().trim().max(100).optional(),
});

export const entidadesIndexadasSchema = z.object({
  filtros: z.object({
    tipo: z.string().trim().max(100).optional(),
    pais: z.string().trim().max(100).optional(),
  }).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Favoritos / convocatorias / panel
// ────────────────────────────────────────────────────────────────────────────

export const favoritoSchema = z.object({
  grant_id: z.union([z.string(), z.number()]).refine(v => String(v).trim().length > 0, 'grant_id requerido'),
  grant_data: z.record(z.string(), z.any()).optional(),
});

export const panelKeywordsSchema = z.object({
  keywords: z.array(z.string().max(200)).max(500),
});

export const cerrarIdsSchema = z.object({
  ids: z.array(z.union([z.string(), z.number()])).min(1, 'ids requerido (array)'),
});

export const convocatoriaEstadoSchema = z.object({
  estado: z.enum(['abierta', 'cerrada', 'nueva']),
});

// ────────────────────────────────────────────────────────────────────────────
// IA / radar (búsqueda semántica, proxies Gemini)
// ────────────────────────────────────────────────────────────────────────────

export const busquedaSemanticaSchema = z.object({
  texto: z.string().trim().min(1, 'texto requerido').max(4000),
  limit: z.coerce.number().optional(),
  threshold: z.coerce.number().optional(),
});

export const barridoMasivoSchema = z.object({
  texto: z.string().trim().max(4000).optional(),
  proyectoId: z.string().trim().max(100).optional(),
  limit: z.coerce.number().optional(),
  threshold: z.coerce.number().optional(),
}).refine(d => (d.texto && d.texto.length > 0) || d.proyectoId, 'texto o proyectoId requerido');

export const promptSoloSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt requerido').max(32_000),
});

export const restoreImportarTipoSchema = z.object({
  tipo: z.enum(['convocatorias', 'directorio']).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Proyectos (server.js — sub-recursos que no viven en proyectos.routes.js)
// ────────────────────────────────────────────────────────────────────────────

export const patchProyectoSchema = z.object({
  nombre: z.string().trim().max(500).optional(),
  nombreArchivo: z.string().trim().max(200).optional(),
  fichaTecnica: z.record(z.string(), z.any()).optional(),
  presupuesto: z.record(z.string(), z.any()).optional(),
}).passthrough();

export const etapaConstruccionSchema = z.object({
  etapa_construccion_finalizada: z.boolean(),
});

export const formulacionIntegralSchema = z.object({
  objetivoCentral: z.string().trim().min(1).max(4000).optional(),
});

export const arbolGenerarSchema = z.object({
  proyectoId: z.string().trim().min(1, 'proyectoId requerido'),
  objetivoCentral: z.string().trim().min(1, 'objetivoCentral requerido').max(4000),
});

export const arbolNodoPatchSchema = z.object({
  texto: z.string().max(4000).optional(),
  supuestos: z.string().max(4000).optional(),
});

export const indicadorSchema = z.object({
  nombre: z.string().trim().min(1, 'nombre requerido').max(300),
  tipo: z.string().trim().min(1, 'tipo requerido').max(100),
  linea_base: z.coerce.number().optional(),
  meta_total: z.union([z.string(), z.number()]).refine(v => v !== undefined && v !== null && String(v).trim() !== '', 'meta_total requerido'),
  unidad_medida: z.string().trim().min(1, 'unidad_medida requerido').max(100),
  fuente_verificacion: z.string().max(500).optional(),
});

export const fichaTecnicaMergeSchema = z.object({
  key: z.string().trim().min(1, 'key (string) es requerido'),
  value: z.any(),
});

export const modulo8AgenteStatusSchema = z.object({
  status: z.string().trim().min(1, 'status requerido').max(30),
});

export const deleteProyectoSchema = z.object({
  password: z.string().min(1, 'password requerido'),
});

// ────────────────────────────────────────────────────────────────────────────
// Copiloto / EntradaIA / EstresFinanciero
// ────────────────────────────────────────────────────────────────────────────

export const copilotoChatSchema = z.object({
  mensaje: z.string().trim().min(1, 'mensaje requerido').max(8000),
  moduloActivo: z.string().max(100).optional(),
});

const objetoLibre = z.record(z.string(), z.any()).optional();

export const entradaCampoSchema = z.object({
  campo: z.string().trim().min(1, 'campo requerido'),
  contextoPrevio: objetoLibre,
  demografia: objetoLibre,
});

export const entradaProblematicasSchema = z.object({
  demografia: objetoLibre,
});

export const entradaSolucionesSchema = z.object({
  contextoPrevio: objetoLibre,
  demografia: objetoLibre,
});

export const entradaNombreOPitchSchema = z.object({
  contextoPrevio: objetoLibre,
  problematica: objetoLibre,
  demografia: objetoLibre,
});

// ────────────────────────────────────────────────────────────────────────────
// Anexos / Biblioteca (carpetas + metadatos — el archivo lo maneja multer)
// ────────────────────────────────────────────────────────────────────────────

export const carpetaNombreSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre de la carpeta es obligatorio').max(100),
});

// PATCH parcial: solo valida TIPO de lo que SÍ vino — la semántica de
// "presente vs ausente" la sigue decidiendo el handler con `!== undefined`
// sobre req.body directamente (Zod no debe intervenir ahí, ver nota de
// cabecera). Por eso todo es .optional() y esta validación es adicional,
// nunca sustituye ese chequeo de presencia.
export const anexoPatchSchema = z.object({
  descripcion: z.string().max(20000).optional(),
  texto: z.string().max(20000).optional(),
  link: z.string().max(500).optional(),
  carpeta_id: z.union([z.string(), z.null()]).optional(),
  categoria: z.string().max(50).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Compliance / Motor Dialéctico / Marco Normativo / Config Logística
// ────────────────────────────────────────────────────────────────────────────

export const complianceSchema = z.object({
  riesgos: z.array(z.any()).optional(),
  sostenibilidad_ambiental: z.string().max(4000).optional(),
  sostenibilidad_social: z.string().max(4000).optional(),
  ods_alineados: z.array(z.any()).optional(),
  enfoque_genero: z.boolean().optional(),
  enfoque_genero_texto: z.string().max(4000).optional(),
});

export const estadoLegalSchema = z.object({
  estado_legal: z.enum(['sin_evaluar', 'condicionado', 'despejado']),
});

export const motorDialecticoSchema = z.object({
  tono: z.string().max(100).optional(),
  lista_oro: z.array(z.any()).optional(),
  lista_negra: z.array(z.any()).optional(),
  enfasis: z.string().max(2000).optional(),
  interlocutor: z.string().max(200).optional(),
  enfoque: z.string().max(200).optional(),
  humanizacion: z.string().max(200).optional(),
  adicionales: z.array(z.any()).optional(),
});

export const marcoNormativoGenerarSchema = z.object({
  proyecto_id: z.string().trim().min(1, 'proyecto_id requerido'),
  sector: z.string().trim().min(1, 'sector requerido').max(200),
  municipio: z.string().trim().max(200).optional(),
});

export const marcoNormativoGuardarSchema = z.object({
  normas_aplicables: z.array(z.any()).optional(),
  citas_bibliograficas: z.array(z.any()).optional(),
  notas_adicionales: z.string().max(4000).optional(),
});

export const logisticaTramosSchema = z.object({
  tramos: z.array(z.record(z.string(), z.any())).max(500, 'Máximo 500 tramos por guardado.'),
});

// ────────────────────────────────────────────────────────────────────────────
// Presupuesto / Radicación / RACI / Valor Exponencial / Exportación
// ────────────────────────────────────────────────────────────────────────────

export const presupuestoItemsSchema = z.object({
  items: z.array(z.record(z.string(), z.any())).min(1, 'items[] es requerido y no puede estar vacio').max(500, 'Máximo 500 ítems de presupuesto por guardado.'),
});

export const radicacionSchema = z.object({
  fichaTecnica: z.record(z.string(), z.any()),
  presupuesto: z.record(z.string(), z.any()),
});

export const raciTareaSchema = z.object({
  nombre: z.string().trim().min(1, 'nombre es requerido').max(300),
  descripcion: z.string().max(5000).optional(),
  orden: z.coerce.number().optional(),
});

export const raciTareaPatchSchema = z.object({
  nombre: z.string().trim().max(300).optional(),
  descripcion: z.string().max(5000).optional(),
  orden: z.coerce.number().optional(),
});

export const raciRolSchema = z.object({
  nombre: z.string().trim().min(1, 'nombre es requerido').max(300),
  orden: z.coerce.number().optional(),
});

export const raciAsignacionSchema = z.object({
  sigla: z.enum(['R', 'A', 'C', 'I', 'V', 'IA']).nullable().optional(),
});

// RESTAURADOS (F-11, 2026-09-24) desde 18bc775^ tal cual — ver
// estresFinanciero.routes.js / valorExponencial.routes.js.
export const estresFinancieroSchema = z.object({
  nombreEscenario: z.string().trim().max(200).optional(),
  porcentajeIncremento: z.coerce.number().optional(),
});

export const sroiSchema = z.object({
  ratioConversion: z.coerce.number({ message: 'ratioConversion es requerido' }),
});

// F-06 (2026-09-24): z.number() SIN coerce a propósito — con coerce un campo
// vacío ("") se volvía 0, que pasa la validación (>= 0) y produce un VAN
// falso. Los rangos finos (min ≤ probable ≤ max, inversión > 0) los valida
// el motor (montecarloFinanciero.js) con 422.
const montoCop = z.number({ message: 'Monto requerido (número en COP)' }).finite().nonnegative().max(1e15);
export const montecarloSchema = z.object({
  beneficioMin: montoCop,
  beneficioProbable: montoCop,
  beneficioMax: montoCop,
  horizonteAnios: z.number({ message: 'horizonteAnios es requerido' }).int().min(1).max(50),
  semilla: z.number().int().min(0).max(0xFFFFFFFF).optional(),
});

export const exportarGraficosSchema = z.object({
  graficos: z.array(z.object({
    svg: z.string().optional(),
    titulo: z.string().optional(),
  }).passthrough()).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Suscripciones
// ────────────────────────────────────────────────────────────────────────────

export const subscriptionActivateSchema = z.object({
  plan: z.string().trim().min(1, 'plan requerido'),
  target_user_id: z.string().trim().max(100).optional(),
});

export const bridgeTransferSchema = z.object({
  convocatoria: z.record(z.string(), z.any()),
});

// ────────────────────────────────────────────────────────────────────────────
// BYOK / proyectos (Fase 1, sin cambios)
// ────────────────────────────────────────────────────────────────────────────

// fichaTecnica/presupuesto son JSON libres por diseño (ver comentario en
// proyectos.routes.js) — se valida que sean OBJETOS planos, no su forma
// interna, para no romper el formulario dinámico de Módulo 3b/4.
export const crearProyectoSchema = z.object({
  nombre: z.string().trim().max(500).optional(),
  nombreArchivo: z.string().trim().max(200).optional(),
  fichaTecnica: z.record(z.string(), z.any()).optional(),
  presupuesto: z.record(z.string(), z.any()).optional(),
}).passthrough(); // otros campos legacy del body no se tocan ni se pierden

export const credencialGeminiSchema = z.object({
  key_slot: z.coerce.number().int().refine(n => [1, 2, 3].includes(n), 'key_slot debe ser 1, 2 o 3'),
  key: z.string().trim().min(10, 'key inválida — demasiado corta').max(500),
  label: z.string().trim().max(100).optional(),
});

/**
 * Valida `body` contra `schema`. Devuelve { ok:true, data } o
 * { ok:false, message } — nunca lanza, para usarse igual que las validaciones
 * manuales ya existentes (if(!ok) return res.status(400).json(...)).
 */
export function validarBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return { ok: true, data: result.data };
  const primero = result.error.issues[0];
  const campo = primero?.path?.length ? `${primero.path.join('.')}: ` : '';
  return { ok: false, message: `${campo}${primero?.message || 'payload inválido'}` };
}
