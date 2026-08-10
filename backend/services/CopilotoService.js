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
import { supabaseAdmin } from '../config/supabase.config.js';
import { geminiCB, isQuotaError } from './geminiCircuitBreaker.js';
import { SMMLV_2026_COP } from './ValorExponencialService.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MAX_HISTORIAL_CONTEXTO = 12; // últimos N mensajes enviados a Gemini como contexto

class CopilotoError extends Error {
  constructor(message) { super(message); this.status = 422; }
}

const fmtCOP = (n) => `$${Number(n || 0).toLocaleString('es-CO')} COP`;

async function construirSnapshot(projectId) {
  const [proyectoRes, apuRes, estresRes, sroiRes, hallazgosRes] = await Promise.all([
    supabaseAdmin.from('proyectos').select('nombre, location, estado').eq('id', projectId).maybeSingle(),
    supabaseAdmin.from('project_apu_lineas').select('valor_total_cop').eq('project_id', projectId),
    supabaseAdmin.from('project_escenarios_estres').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('project_sroi_metrics').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('project_hallazgos').select('titulo, severidad, detalle, resuelto').eq('project_id', projectId).order('created_at', { ascending: false }).limit(10),
  ]);

  const lineasApu = apuRes.data || [];
  const presupuestoTotalCOP = lineasApu.reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);

  return {
    proyecto: proyectoRes.data || null,
    presupuestoTotalCOP,
    numLineasApu: lineasApu.length,
    ultimoEscenarioEstres: estresRes.data?.[0] || null,
    ultimaMetricaSROI: sroiRes.data?.[0] || null,
    hallazgosRecientes: hallazgosRes.data || [],
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

MÓDULOS DEL FORMULADOR (puedes orientar sobre cualquiera, no solo el activo): Entrada, Checklist, Ficha Técnica, Anexos (presupuesto/APU), Logística, Dialéctica (marco lógico/coherencia), Viabilidad (scoring IA).
MÓDULO ACTUAL: ${moduloActivo || '(no especificado)'}

SNAPSHOT REAL DEL PROYECTO (datos financieros/auditoría ya calculados):
${snapshotTexto}`;
}

async function llamarGemini(messages, userId) {
  const GEMINI_KEY = process.env.GOOGLE_API_KEY;
  if (!GEMINI_KEY || !geminiCB.canCall()) return null;

  try {
    const upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GEMINI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-2.0-flash', messages, temperature: 0.3, max_tokens: 1024 }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) {
        geminiCB.recordQuotaError();
      } else {
        // FIX (auditoría SRE Red Team 2026-08-10, Capa 4): antes, cualquier
        // fallo no-429 (401 clave inválida, 400 malformado, 500/503 caído)
        // se tragaba en silencio — el usuario siempre veía "cuota agotada"
        // sin importar la causa real, invisible en logs/monitoreo.
        const cuerpo = await upstream.text().catch(() => '');
        logger.error('[Copiloto] Fallo Gemini no-cuota', { status: upstream.status, body: cuerpo.slice(0, 300) });
      }
      return null;
    }

    const data = await upstream.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) return null;

    geminiCB.recordSuccess();
    // FinOps — fire-and-forget, nunca bloquea ni rompe la respuesta al usuario.
    logTokenUsage({
      userId, agentName: 'copiloto',
      tokensInput: data?.usage?.prompt_tokens ?? 0,
      tokensOutput: data?.usage?.completion_tokens ?? 0,
    }).catch(() => {});
    return texto;
  } catch (err) {
    if (isQuotaError(err)) {
      geminiCB.recordQuotaError();
    } else {
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

export async function obtenerHistorial(projectId) {
  const { data, error } = await supabaseAdmin
    .from('project_chat_history')
    .select('role, content, modulo_activo, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`No se pudo leer el historial del co-piloto: ${error.message}`);
  return data || [];
}

export async function chatConCopiloto(projectId, orgId, { mensaje, moduloActivo }) {
  if (!mensaje?.trim()) throw new CopilotoError('mensaje es requerido');

  const [snapshot, historialPrevio] = await Promise.all([
    construirSnapshot(projectId),
    obtenerHistorial(projectId),
  ]);

  const systemPrompt = buildSystemPrompt(formatearSnapshot(snapshot), moduloActivo);
  const contexto = historialPrevio.slice(-MAX_HISTORIAL_CONTEXTO).map(h => ({ role: h.role, content: h.content }));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...contexto,
    { role: 'user', content: mensaje },
  ];

  const respuestaGemini = await llamarGemini(messages, orgId);
  const respuesta = respuestaGemini || respuestaRespaldo(snapshot);
  const fuente = respuestaGemini ? 'gemini-2.0-flash' : 'heuristica';

  const { error: insertError } = await supabaseAdmin.from('project_chat_history').insert([
    { project_id: projectId, org_id: orgId, role: 'user', content: mensaje, modulo_activo: moduloActivo || null },
    { project_id: projectId, org_id: orgId, role: 'model', content: respuesta, modulo_activo: moduloActivo || null },
  ]);
  if (insertError) throw new Error(`No se pudo guardar el mensaje del co-piloto: ${insertError.message}`);

  return { respuesta, fuente };
}
