/**
 * CopilotoService.js — Co-Piloto conversacional RadFor-360 (chat fijo del panel derecho).
 *
 * Mismo patrón que viabilidadAgent.js: intenta Gemini gateado por geminiCB,
 * y si no hay GOOGLE_API_KEY / la cuota está agotada / la llamada falla,
 * cae a una respuesta determinística de "Modo Respaldo" — nunca lanza,
 * nunca inventa cifras.
 *
 * El snapshot que se inyecta en el system prompt se arma EXCLUSIVAMENTE con
 * datos reales ya calculados por los servicios del pipeline financiero
 * (EstresadoFinancieroService, ValorExponencialService) y con las líneas de
 * presupuesto/hallazgos ya persistidos — cero cifras inventadas.
 */
// FIX (005_INGENIERO_BACKEND, 2026-09-04): supabaseAdmin (service_role)
// bypaseaba RLS por completo — ver AuditorForenseService.js para el detalle
// completo del hallazgo/fix. withTenant() usa rf360_rls_scoped (migración
// 053_rls_scoped_role.sql), sin BYPASSRLS.
import { withTenant } from '../config/database.config.js';
import { geminiCB, withKeyRotation, isQuotaError, GeminiPoolExhaustedError } from './geminiCircuitBreaker.js';
import { withUserKeyRotation, UserKeyPoolExhaustedError } from './byokService.js';
import { SMMLV_2026_COP } from './ValorExponencialService.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';
import { fetchGeminiConReintento } from './geminiReintento.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MAX_HISTORIAL_CONTEXTO = 12; // últimos N mensajes enviados a Gemini como contexto

class CopilotoError extends Error {
  constructor(message) { super(message); this.status = 422; }
}

const fmtCOP = (n) => `$${Number(n || 0).toLocaleString('es-CO')} COP`;

async function construirSnapshot(projectId, orgId) {
  const [proyectoRes, apuRes, estresRes, sroiRes, hallazgosRes] = await Promise.all([
    withTenant(orgId, client => client.query('SELECT nombre, location, estado FROM proyectos WHERE id = $1', [projectId])),
    withTenant(orgId, client => client.query('SELECT valor_total_cop FROM project_apu_lineas WHERE project_id = $1', [projectId])),
    withTenant(orgId, client => client.query('SELECT * FROM project_escenarios_estres WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [projectId])),
    withTenant(orgId, client => client.query('SELECT * FROM project_sroi_metrics WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [projectId])),
    withTenant(orgId, client => client.query('SELECT titulo, severidad, detalle, resuelto FROM project_hallazgos WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10', [projectId])),
  ]);

  const lineasApu = apuRes.rows || [];
  const presupuestoTotalCOP = lineasApu.reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);

  return {
    proyecto: proyectoRes.rows?.[0] || null,
    presupuestoTotalCOP,
    numLineasApu: lineasApu.length,
    ultimoEscenarioEstres: estresRes.rows?.[0] || null,
    ultimaMetricaSROI: sroiRes.rows?.[0] || null,
    hallazgosRecientes: hallazgosRes.rows || [],
  };
}

function formatearSnapshot(snapshot) {
  const p = snapshot.proyecto;
  const lineas = [];

  lineas.push(`Proyecto: ${p?.nombre || '(sin nombre)'}${p?.location ? ` — ${p.location}` : ''} — estado: ${p?.estado || '(sin estado)'}`);

  if (snapshot.numLineasApu > 0) {
    lineas.push(`Presupuesto ingerido (project_apu_lineas): ${fmtCOP(snapshot.presupuestoTotalCOP)} en ${snapshot.numLineasApu} líneas.`);
  } else {
    lineas.push('Sin presupuesto/APU ingerido todavía en Anexos.');
  }

  const e = snapshot.ultimoEscenarioEstres;
  lineas.push(e
    ? `Último escenario de estrés financiero: "${e.nombre_escenario}" (+${e.porcentaje_incremento_insumos}% insumos) → presupuesto pasaría de ${fmtCOP(e.valor_base_cop)} a ${fmtCOP(e.valor_base_cop + Number(e.impacto_total_calculado_cop || 0))} → clasificación: ${e.viabilidad_resultado}.`
    : 'Sin escenarios de estrés financiero corridos aún.');

  const s = snapshot.ultimaMetricaSROI;
  lineas.push(s
    ? `Última métrica SROI: ratio de conversión ${s.ratio_conversion}, valor social generado ${fmtCOP(s.valor_social_generado_cop)}, empleos persona-mes estimados ${s.empleos_persona_mes_estimados} (SMMLV ref. ${fmtCOP(SMMLV_2026_COP)}).`
    : 'Sin cálculo de SROI/Valor Exponencial aún.');

  if (snapshot.hallazgosRecientes.length) {
    lineas.push('Hallazgos de auditoría recientes:');
    for (const h of snapshot.hallazgosRecientes) {
      lineas.push(`  - [${h.severidad}]${h.resuelto ? ' (resuelto)' : ''} ${h.titulo}${h.detalle ? ` — ${h.detalle}` : ''}`);
    }
  } else {
    lineas.push('Sin hallazgos de auditoría registrados.');
  }

  return lineas.join('\n');
}

function buildSystemPrompt(snapshotTexto, moduloActivo) {
  return `Eres el Co-Piloto RadFor-360, asesor integral del módulo Formulador para proyectos de infraestructura/inversión en Colombia: acompañas formulación (ficha técnica, anexos, logística), evaluación de viabilidad/scoring y evaluación de impacto integral (social, financiero, ambiental y HSEQ) — no solo temas financieros.

REGLAS INQUEBRANTABLES:
1. Si la pregunta es financiera o de presupuesto, responde y calcula EXCLUSIVAMENTE en Pesos Colombianos (COP). SMMLV 2026 = ${fmtCOP(SMMLV_2026_COP)} (Decretos 1469/1470 de 2025).
2. Fundamenta tu razonamiento en la normativa pertinente a la pregunta: Ley 80 (contratación pública), POT (uso de suelo), NSR-10 (sismorresistencia), ISO 9001/ISO 45001 (HSEQ), y buenas prácticas de formulación/evaluación de proyectos (marco lógico, cadena de valor, teoría de cambio) cuando aplique.
3. Usa ÚNICAMENTE los datos reales del snapshot de abajo para cifras del proyecto. Si el snapshot no tiene el dato que te preguntan, dilo explícitamente ("no tengo ese dato cargado en el proyecto") — nunca inventes cifras, escenarios ni hallazgos. Fuera de lo financiero (formulación, metodología, impacto), puedes orientar y razonar libremente, aclarando siempre cuando una cifra específica del proyecto no está disponible.
4. Sé breve y directo, en tono de asesor técnico senior, no de chatbot genérico.
5. Motor de Diagramación (2026-08-17): si te piden explícitamente un mapa/flujo de proceso, un organigrama o un cronograma tipo Gantt, responde con un bloque \`\`\`mermaid que contenga sintaxis Mermaid válida (flowchart/graph, gantt, etc.) — el frontend lo detecta y lo dibuja automáticamente. Si te piden un análisis financiero que amerite visualizarse como gráfico (presupuesto, costos APU, flujo de caja), responde con un bloque \`\`\`json con exactamente esta forma: {"tipo_visualizacion":"grafico_financiero","tipo":"barra"|"linea","titulo":"...","claveX":"nombre_del_campo_x","series":[{"clave":"campo_y","nombre":"Etiqueta"}],"data":[{"nombre_del_campo_x":"...", "campo_y": 1234567}]} — usa SIEMPRE valores numéricos en COP sin formatear (el frontend los formatea). Nunca emitas estos bloques si no te lo piden explícitamente — la respuesta normal sigue siendo texto plano.

MÓDULOS DEL FORMULADOR (puedes orientar sobre cualquiera, no solo el activo): Entrada, Checklist, Ficha Técnica, Anexos (presupuesto/APU), Logística, Dialéctica (marco lógico/coherencia), Viabilidad (scoring IA).
MÓDULO ACTUAL: ${moduloActivo || '(no especificado)'}

SNAPSHOT REAL DEL PROYECTO (datos financieros/auditoría ya calculados):
${snapshotTexto}`;
}

// REFACTOR (2026-08-19, pool de llaves): antes leía una sola GOOGLE_API_KEY
// y llamaba a geminiCB directamente; ahora withKeyRotation() prueba cada
// llave configurada en el pool, rotando solo ante 429 — mismo contrato de
// retorno (texto o null, nunca lanza) y mismo log de errores no-cuota.
// LOTE 7 (2026-09-24): mismo blindaje que viabilidadAgent.js (Lote 6, verificado
// en vivo): gemini-3.6-flash RAZONA y esos tokens cuentan contra max_tokens.
// Con 1024, una respuesta larga llegaba CORTADA a mitad de frase y se
// entregaba al usuario como si estuviera completa (texto libre: no hay JSON
// que falle). Ahora 8192 + razonamiento acotado; un corte se registra y se
// marca visiblemente; toda caída al Modo Respaldo registra su causa exacta
// (antes la cuota agotada caía en silencio).
export const AVISO_RESPUESTA_CORTADA = '\n\n[⚠️ Respuesta incompleta: se alcanzó el límite de extensión de la IA. Pide que continúe o reformula la pregunta de forma más acotada.]';

function falloGemini(motivo, mensaje, extra = {}) {
  const e = new Error(mensaje);
  e.motivoRespaldo = motivo;
  return Object.assign(e, extra);
}

/** @returns {Promise<{ texto: string|null, motivo: string|null, truncada?: boolean }>} */
export async function llamarGemini(messages, userId, userGeminiKeys) {
  const useUserKeys = Array.isArray(userGeminiKeys) && userGeminiKeys.length > 0;
  const intentar = async (apiKey) => {
    const upstream = await fetchGeminiConReintento(GEMINI_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.6-flash', messages, temperature: 0.3, max_tokens: 8192, reasoning_effort: 'low' }),
      signal: AbortSignal.timeout(45_000),
    });

    if (upstream.status === 429) throw new Error('Gemini 429 quota exceeded');
    if (upstream.status === 503) throw falloGemini('modelo_saturado', 'Gemini 503: modelo saturado (alta demanda en Google)');
    if (!upstream.ok) {
      // FIX (auditoría SRE Red Team 2026-08-10, Capa 4): antes, cualquier
      // fallo no-429 (401 clave inválida, 400 malformado, 500/503 caído)
      // se tragaba en silencio — el usuario siempre veía "cuota agotada"
      // sin importar la causa real, invisible en logs/monitoreo.
      const cuerpo = await upstream.text().catch(() => '');
      throw falloGemini(`http_${upstream.status}`, `Gemini HTTP ${upstream.status}`, { cuerpo: cuerpo.slice(0, 300) });
    }

    const data = await upstream.json();
    const eleccion = data?.choices?.[0];
    const texto = eleccion?.message?.content?.trim();
    // Mensaje SIN "429/quota/rate limit": isQuotaError lo rotaría como cuota.
    if (!texto) throw falloGemini('respuesta_vacia', 'Gemini sin contenido en la respuesta', { usage: data?.usage, finish: eleccion?.finish_reason });
    return { texto, usage: data?.usage ?? {}, truncada: eleccion?.finish_reason === 'length' };
  };

  try {
    if (!useUserKeys && !geminiCB.keys.length) {
      throw falloGemini('sin_llaves_servidor', 'No hay llaves de Gemini configuradas en el servidor');
    }
    // BYOK (2026-08-22): usuario no exento → rota SUS propias llaves, nunca
    // el pool del servidor. Si se agota, cae al "Modo Respaldo" ya existente
    // (respuestaRespaldo), que es honesto (no fabrica análisis).
    const { texto, usage, truncada } = useUserKeys
      ? await withUserKeyRotation(userGeminiKeys, intentar)
      : await withKeyRotation(intentar);

    // FinOps — fire-and-forget. Salida REAL facturada = total − entrada
    // (completion_tokens no incluye los tokens de razonamiento).
    const salidaReal = Number.isFinite(usage?.total_tokens) && Number.isFinite(usage?.prompt_tokens)
      ? usage.total_tokens - usage.prompt_tokens : (usage?.completion_tokens ?? 0);
    logTokenUsage({ userId, agentName: 'copiloto', tokensInput: usage?.prompt_tokens ?? 0, tokensOutput: salidaReal }).catch(() => {});

    if (truncada) {
      logger.warn('[Copiloto] Respuesta de Gemini cortada por el límite de tokens (finish_reason: length) — se entrega marcada', { motivo: 'respuesta_truncada', usage, userId });
      return { texto: texto + AVISO_RESPUESTA_CORTADA, motivo: null, truncada: true };
    }
    return { texto, motivo: null };
  } catch (err) {
    const motivo = err.motivoRespaldo
      || (err instanceof UserKeyPoolExhaustedError || err?.code === 'USER_KEY_EXHAUSTED' ? 'USER_KEY_EXHAUSTED'
        : err instanceof GeminiPoolExhaustedError || isQuotaError(err) ? 'cuota_agotada'
        : err?.name === 'TimeoutError' ? 'timeout'
        : 'error');
    const esperado = ['USER_KEY_EXHAUSTED', 'cuota_agotada', 'sin_llaves_servidor', 'modelo_saturado'].includes(motivo);
    logger[esperado ? 'warn' : 'error']('[Copiloto] Gemini no disponible → Modo Respaldo', {
      motivo, detalle: err.message, usage: err.usage, cuerpo: err.cuerpo, userId,
    });
    return { texto: null, motivo };
  }
}

function respuestaRespaldo(snapshot) {
  const tieneDatos = snapshot.numLineasApu > 0 || snapshot.ultimoEscenarioEstres || snapshot.ultimaMetricaSROI;
  return tieneDatos
    ? 'Modo Respaldo activo (cuota de IA agotada o sin configurar): puedo mostrarte los datos reales ya calculados del proyecto, pero no puedo generar un análisis narrativo nuevo en este momento. Consulta los módulos de Presupuesto, Estrés Financiero y Valor Exponencial para ver las cifras exactas.'
    : 'Modo Respaldo activo (cuota de IA agotada o sin configurar). Además, este proyecto todavía no tiene presupuesto/APU ingerido en Anexos — sin eso no hay datos financieros que analizar.';
}

export async function obtenerHistorial(projectId, orgId) {
  try {
    const res = await withTenant(orgId, client => client.query(
      'SELECT role, content, modulo_activo, created_at FROM project_chat_history WHERE project_id = $1 ORDER BY created_at ASC',
      [projectId]
    ));
    return res.rows || [];
  } catch (err) {
    throw new Error(`No se pudo leer el historial del co-piloto: ${err.message}`);
  }
}

export async function chatConCopiloto(projectId, orgId, { mensaje, moduloActivo, userGeminiKeys }) {
  if (!mensaje?.trim()) throw new CopilotoError('mensaje es requerido');

  const [snapshot, historialPrevio] = await Promise.all([
    construirSnapshot(projectId, orgId),
    obtenerHistorial(projectId, orgId),
  ]);

  const systemPrompt = buildSystemPrompt(formatearSnapshot(snapshot), moduloActivo);
  // FIX (auditoría 2026-08-17): copiloto_historial guarda los roles en
  // convención nativa de Gemini ('user'/'model' — ver INSERT más abajo,
  // mismo naming que usa el SDK genAI y el frontend CoPilotoSidebarChat.tsx),
  // pero se llama al endpoint OpenAI-compatible de Gemini, que exige
  // 'user'/'assistant'/'system' — enviar 'model' tal cual causaba
  // "Invalid role: model" (400 INVALID_ARGUMENT) en CUALQUIER turno con
  // historial previo, cayendo siempre a Modo Respaldo sin que el usuario
  // supiera por qué. Se traduce solo al armar el payload; la BD sigue
  // guardando 'model' sin cambios (no rompe el historial ya persistido).
  const contexto = historialPrevio.slice(-MAX_HISTORIAL_CONTEXTO).map(h => ({ role: h.role === 'model' ? 'assistant' : h.role, content: h.content }));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...contexto,
    { role: 'user', content: mensaje },
  ];

  const ia = await llamarGemini(messages, orgId, userGeminiKeys);
  const respuesta = ia.texto || respuestaRespaldo(snapshot);
  const fuente = ia.texto ? 'gemini-3.6-flash' : 'heuristica';

  try {
    await withTenant(orgId, client => client.query(
      `INSERT INTO project_chat_history (project_id, org_id, role, content, modulo_activo)
       VALUES ($1, $2, 'user', $3, $4), ($1, $2, 'model', $5, $4)`,
      [projectId, orgId, mensaje, moduloActivo || null, respuesta]
    ));
  } catch (err) {
    throw new Error(`No se pudo guardar el mensaje del co-piloto: ${err.message}`);
  }

  // motivo_respaldo / truncada: campos ADITIVOS (Lote 7) para diagnóstico.
  return { respuesta, fuente, ...(ia.motivo ? { motivo_respaldo: ia.motivo } : {}), ...(ia.truncada ? { truncada: true } : {}) };
}
