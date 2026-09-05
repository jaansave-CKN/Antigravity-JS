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
import { withKeyRotation, isQuotaError, GeminiPoolExhaustedError } from './geminiCircuitBreaker.js';
import { withUserKeyRotation, UserKeyPoolExhaustedError } from './byokService.js';
import { SMMLV_2026_COP } from './ValorExponencialService.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';

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
async function llamarGemini(messages, userId, userGeminiKeys) {
  const intentar = async (apiKey) => {
    const upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.6-flash', messages, temperature: 0.3, max_tokens: 1024 }),
    });

    if (upstream.status === 429) throw new Error('Gemini 429 quota exceeded');
    if (!upstream.ok) {
      // FIX (auditoría SRE Red Team 2026-08-10, Capa 4): antes, cualquier
      // fallo no-429 (401 clave inválida, 400 malformado, 500/503 caído)
      // se tragaba en silencio — el usuario siempre veía "cuota agotada"
      // sin importar la causa real, invisible en logs/monitoreo.
      const cuerpo = await upstream.text().catch(() => '');
      throw new Error(`Gemini HTTP ${upstream.status}: ${cuerpo.slice(0, 300)}`);
    }

    const data = await upstream.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) throw new Error('Gemini sin contenido en la respuesta');
    return { texto, usage: data?.usage ?? {} };
  };

  try {
    // BYOK (2026-08-22): usuario no exento → rota SUS propias llaves, nunca
    // el pool del servidor. Mismo contrato de retorno (texto o null) — si
    // se agota, cae al "Modo Respaldo" ya existente (respuestaRespaldo),
    // que ya es honesto (dice explícitamente que no hay análisis nuevo, no
    // fabrica nada) — no hace falta cambiar esa parte.
    const { texto, usage } = userGeminiKeys?.length
      ? await withUserKeyRotation(userGeminiKeys, intentar)
      : await withKeyRotation(intentar);

    // FinOps — fire-and-forget, nunca bloquea ni rompe la respuesta al usuario.
    logTokenUsage({
      userId, agentName: 'copiloto',
      tokensInput: usage?.prompt_tokens ?? 0,
      tokensOutput: usage?.completion_tokens ?? 0,
    }).catch(() => {});
    return texto;
  } catch (err) {
    if (!(err instanceof GeminiPoolExhaustedError) && !(err instanceof UserKeyPoolExhaustedError) && !isQuotaError(err)) {
      logger.error('[Copiloto] Excepción Gemini no-cuota', { err: err.message });
    }
    return null;
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

  const respuestaGemini = await llamarGemini(messages, orgId, userGeminiKeys);
  const respuesta = respuestaGemini || respuestaRespaldo(snapshot);
  const fuente = respuestaGemini ? 'gemini-3.6-flash' : 'heuristica';

  try {
    await withTenant(orgId, client => client.query(
      `INSERT INTO project_chat_history (project_id, org_id, role, content, modulo_activo)
       VALUES ($1, $2, 'user', $3, $4), ($1, $2, 'model', $5, $4)`,
      [projectId, orgId, mensaje, moduloActivo || null, respuesta]
    ));
  } catch (err) {
    throw new Error(`No se pudo guardar el mensaje del co-piloto: ${err.message}`);
  }

  return { respuesta, fuente };
}
