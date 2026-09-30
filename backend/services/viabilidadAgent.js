/**
 * viabilidadAgent.js — Núcleo de Auditoría de Viabilidad RadFor-360 v3.0.
 *
 * Reemplaza el mock de NN_Viability_Agent.ts para el análisis de viabilidad
 * de PROYECTOS (distinto de la rúbrica de estilo comunicacional que ese
 * archivo ya calculaba de forma determinista y real — esa parte no cambia).
 *
 * Reglas de oro (system prompt, ver SYSTEM_PROMPT abajo):
 *   1. Validación de escala y proporción — cruza población afectada vs
 *      problema vs meta; incoherencias de tamaño → RECHAZADO_INCOHERENCIA.
 *   2. Análisis de anexos por taxonomía estricta — nunca alucina costos si
 *      no hay anexo Financiero/Presupuestal; la teoría del cambio se
 *      supedita al marco normativo si hay anexo Normativo/Legal.
 *   3. Coherencia multiproyecto — solo el contexto del proyecto actual
 *      (satisfecho estructuralmente: cada llamada recibe un único proyecto).
 *
 * Fuentes de contexto reales: proyectos.ficha_tecnica (entrada_completa,
 * contexto_narrativo), proyectos.presupuesto, project_anexos (categoría),
 * objetivos_arbol.supuestos y project_change_theory — todas con
 * degradación con gracia si la tabla/columna aún no existe (migración 016).
 *
 * La IA pasa por llmProveedor.js (OpenRouter → pool Gemini → BYOK). Si
 * ningún proveedor responde con un dictamen válido, calcularViabilidadIA
 * LANZA (503/429) — sin respaldo heurístico desde B1 (2026-09-28).
 */
import { generarConIA } from './llmProveedor.js';
import { logger } from '../utils/logger.js';
import { resolverDirectivas, bloqueVectores } from './directivasFormulacion.js';

function r2(n) { return Math.round(n * 100) / 100; }

/**
 * calcularPuntoEquilibrio — punto de equilibrio financiero (break-even) sobre
 * inputs proyectados estáticos: `break_even_point_cop = costos_fijos /
 * (1 - costos_variables/ventas)`. Especificación de negocio del Director,
 * fiscalizada por el Agente Arquitecto 2026-08-09.
 *
 * IMPORTANTE (hallazgo del Arquitecto): este repo NO tiene ninguna tabla de
 * ejecución/flujo de caja real por periodo (verificado: 0 resultados para
 * flujo_caja|avance_ejecutado|desembolso en todo el schema) — por lo tanto
 * `is_break_even_reached` NO es "el mes en que se cruza el punto de
 * equilibrio" (eso requeriría una serie temporal que no existe), sino una
 * comparación de punto único: ¿el total de ventas proyectadas alcanza o
 * supera el punto de equilibrio calculado? `metodo_calculo` viaja explícito
 * en la respuesta (no solo como comentario) para que ningún consumidor
 * futuro (export, frontend) confunda esto con un dato de ejecución real.
 *
 * Lanza Error con código explícito en inputs degenerados (ventas <= 0, o
 * margen de contribución <= 0) — el Arquitecto exigió rechazo 422, no
 * Infinity/NaN calculado y persistido silenciosamente (esto gatea decisiones
 * sobre dinero de inversionistas).
 */
export function calcularPuntoEquilibrio({ costos_fijos_proyectados, costos_variables_totales, ventas_totales_proyectadas }) {
  const fijos     = Number(costos_fijos_proyectados);
  const variables = Number(costos_variables_totales);
  const ventas    = Number(ventas_totales_proyectadas);

  if (!Number.isFinite(fijos) || fijos < 0) {
    throw new Error('BREAK_EVEN_COSTOS_FIJOS_INVALIDOS');
  }
  if (!Number.isFinite(variables) || variables < 0) {
    throw new Error('BREAK_EVEN_COSTOS_VARIABLES_INVALIDOS');
  }
  if (!Number.isFinite(ventas) || ventas <= 0) {
    throw new Error('BREAK_EVEN_VENTAS_INVALIDAS');
  }

  const margenContribucion = 1 - (variables / ventas);
  if (margenContribucion <= 0) {
    throw new Error('BREAK_EVEN_MARGEN_INVALIDO');
  }

  const breakEvenPointCop = r2(fijos / margenContribucion);

  return {
    costos_fijos_proyectados: fijos,
    costos_variables_totales: variables,
    ventas_totales_proyectadas: ventas,
    break_even_point_cop: breakEvenPointCop,
    is_break_even_reached: ventas >= breakEvenPointCop,
    metodo_calculo: 'proyectado_punto_unico',
    calculadoEn: new Date().toISOString(),
  };
}

function safeParseJson(val, fallback = {}) {
  if (val && typeof val === 'object') return val;
  if (typeof val !== 'string' || !val.trim()) return fallback;
  try { const p = JSON.parse(val); return p && typeof p === 'object' ? p : fallback; }
  catch { return fallback; }
}

// ── Taxonomía de anexos: categoria (columna real project_anexos) → etiqueta del prompt ──
const TAXONOMIA_ANEXO = {
  financiero:    'Financiero/Presupuestal',
  legal:         'Normativo/Legal',
  tecnico:       'Técnico/Operativo',
  institucional: 'Evidencia',
  otro:          'Evidencia',
};

const SYSTEM_PROMPT = `# [SISTEMA DE AUDITORÍA Y FORMULACIÓN — RADFOR-360 v3.0]

Eres el Núcleo de Inteligencia de Auditoría de Radfor-360, un software de ingeniería para la estructuración y validación de proyectos de infraestructura, inversión y desarrollo ejecutados por personas naturales, jurídicas, ONGs, asociaciones y alcaldías en Colombia.

## REGLAS DE ORO INQUEBRANTABLES:

1. VALIDACIÓN DE ESCALA Y PROPORCIÓN (REALISMO DE TAMAÑO):
   - Cruza obligatoriamente la "Población Afectada" con el "Problema" y la "Meta Esperada".
   - Si la magnitud del problema es local/veredal pero la solución planteada exige recursos o impactos desproporcionados (o viceversa), califica de inmediato el campo \`estado_auditoria\` como "RECHAZADO_INCOHERENCIA" y detalla la razón en \`analisis_escala_poblacion.alerta\`. Prohibido inventar justificaciones para encajar datos absurdos.

2. ANÁLISIS DE ANEXOS POR TAXONOMÍA ESTRICTA:
   - Recibirás una lista de archivos adjuntos clasificados por categoría (Financiero/Presupuestal, Normativo/Legal, Técnico/Operativo, Evidencia).
   - RESTRICCIÓN FINANCIERA: Nunca calcules, asumas o alucines costos totales, APUs ni flujos de caja. Si el array de anexos NO contiene al menos un documento clasificado en "Financiero/Presupuestal", debes marcar \`respaldo_financiero_detectado\` en \`false\` y emitir una advertencia crítica de que el proyecto carece de sustento económico auditable.
   - RESTRICCIÓN NORMATIVA: Si se adjuntó un documento en "Normativo/Legal" (como un decreto o acuerdo municipal), obliga a la teoría del cambio a supeditarse a ese marco jurídico.

3. COHERENCIA MULTIPROYECTO:
   - Toda la inferencia debe realizarse de manera aislada utilizando exclusivamente el contexto del \`id_proyecto\` actual. No contamines la lógica con datos de proyectos anteriores.

4. COHERENCIA CON EL FINANCIADOR:
   - Recibirás los "VECTORES DEL FINANCIADOR" que el usuario eligió (fuente, formato, metodologías) y las exigencias que se derivan de ellos.
   - Contrasta la formulación con esas exigencias. Cada exigencia que los datos del proyecto no cubran, o cada incoherencia entre los ejes, va como una línea concreta en \`cruce_anexos.brechas_detectadas\` (qué falta y qué exige el financiador). No inventes que algo existe si no está en los datos.

Devuelve la respuesta estrictamente cumpliendo el esquema JSON requerido, sin texto adicional fuera del formato estructurado.`;

const JSON_SCHEMA = {
  name: 'Radfor360ViabilityAudit',
  schema: {
    type: 'object',
    properties: {
      estado_auditoria: { type: 'string', enum: ['APROBADO_TECNICAMENTE', 'OBSERVACION_CRITICA', 'RECHAZADO_INCOHERENCIA'] },
      score_viabilidad: { type: 'integer', minimum: 0, maximum: 100 },
      analisis_escala_poblacion: {
        type: 'object',
        properties: {
          proporcion_logica: { type: 'boolean' },
          veredicto_escala: { type: 'string' },
          alerta: { type: 'string' },
        },
        required: ['proporcion_logica', 'veredicto_escala'],
      },
      cruce_anexos: {
        type: 'object',
        properties: {
          respaldo_financiero_detectado: { type: 'boolean' },
          marco_normativo_validado: { type: 'boolean' },
          brechas_detectadas: { type: 'array', items: { type: 'string' } },
        },
        required: ['respaldo_financiero_detectado', 'marco_normativo_validado'],
      },
      teoria_del_cambio_generada: {
        type: 'object',
        properties: {
          supuestos: { type: 'array', items: { type: 'string' } },
          resultados_esperados: { type: 'array', items: { type: 'string' } },
        },
        required: ['supuestos', 'resultados_esperados'],
      },
    },
    required: ['estado_auditoria', 'score_viabilidad', 'analisis_escala_poblacion', 'cruce_anexos', 'teoria_del_cambio_generada'],
  },
};

export function buildUserPrompt({ id, nombre, problema, metaEsperada, poblacionAfectada, coberturaGeografica, presupuesto, anexos, directivas = null }) {
  const anexosTaxonomia = anexos.map(a => `- ${a.nombre_archivo} → ${TAXONOMIA_ANEXO[a.categoria] || 'Evidencia'}`).join('\n') || '(sin anexos adjuntos)';
  return `id_proyecto: ${id}
Nombre: ${nombre || '(sin nombre)'}

Problema (diagnóstico): ${(problema || '(no definido)').slice(0, 1500)}

Meta Esperada: ${(metaEsperada || '(no definida)').slice(0, 800)}

Población Afectada: ${poblacionAfectada || '(no especificada)'}
Cobertura Geográfica: ${coberturaGeografica || '(no especificada)'}

Presupuesto: ${JSON.stringify(presupuesto).slice(0, 2000)}

Anexos adjuntos (${anexos.length}) clasificados por taxonomía:
${anexosTaxonomia}
${directivas ? `\n${bloqueVectores(directivas)}\n` : ''}
Responde ÚNICAMENTE con el JSON del esquema Radfor360ViabilityAudit, sin texto adicional.`;
}

/**
 * Valida la salida del modelo contra el esquema del dictamen (lanza si no
 * cumple, y llmProveedor prueba el siguiente proveedor). Exportada para test.
 * El error lleva solo la ESTRUCTURA (claves y valores de control), nunca el
 * texto del proyecto: basta para diagnosticar sin volcar contenido en logs.
 */
export function parsearDictamen(texto) {
  const match = String(texto || '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('respuesta sin JSON');
  const p = JSON.parse(match[0]);
  const validEstados = JSON_SCHEMA.schema.properties.estado_auditoria.enum;
  if (!validEstados.includes(p?.estado_auditoria) || typeof p?.score_viabilidad !== 'number') {
    throw new Error(`esquema inválido (claves: ${Object.keys(p || {}).slice(0, 20).join(',')}; estado_auditoria: ${p?.estado_auditoria}; score: ${typeof p?.score_viabilidad})`);
  }
  return p;
}

/**
 * B1 (2026-09-28, regla de oro ratificada por el dueño): se ELIMINÓ el
 * respaldo heurístico (calcularViabilidadHeuristica). Entregaba un
 * score_viabilidad y un estado_auditoria calculados sin IA que se guardaban
 * en ficha_tecnica.viabilidad_ia y marcaban el paso de la formulación
 * integral como completado. Ahora la llamada pasa por llmProveedor.js
 * (OpenRouter → pool Gemini → BYOK) y, si ningún proveedor devuelve un
 * dictamen que cumpla el esquema, LANZA: IaNoDisponibleError (503) o
 * IaTopeAgotadoError (429). El caller no guarda nada.
 * @param {object} ctx — de recolectarContextoViabilidad()
 * @returns {Promise<object>}
 */
export async function calcularViabilidadIA(ctx) {
  const { valor: parsed, modelo, proveedor } = await generarConIA({
    userId: ctx.userId, agente: 'viabilidad', temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(ctx) },
    ],
    // Lote 6 T1 (verificado en vivo 2026-09-24): con 'json_object' el modelo
    // inventaba su propia estructura; la salida estructurada obliga el esquema.
    responseFormat: { type: 'json_schema', json_schema: JSON_SCHEMA },
    validar: parsearDictamen,
  });
  return {
    estado_auditoria: parsed.estado_auditoria,
    score_viabilidad: Math.max(0, Math.min(100, Math.round(parsed.score_viabilidad))),
    analisis_escala_poblacion: {
      proporcion_logica: !!parsed.analisis_escala_poblacion?.proporcion_logica,
      veredicto_escala: parsed.analisis_escala_poblacion?.veredicto_escala || '',
      alerta: parsed.analisis_escala_poblacion?.alerta || '',
    },
    cruce_anexos: {
      respaldo_financiero_detectado: !!parsed.cruce_anexos?.respaldo_financiero_detectado,
      marco_normativo_validado: !!parsed.cruce_anexos?.marco_normativo_validado,
      brechas_detectadas: Array.isArray(parsed.cruce_anexos?.brechas_detectadas) ? parsed.cruce_anexos.brechas_detectadas : [],
    },
    teoria_del_cambio_generada: {
      supuestos: Array.isArray(parsed.teoria_del_cambio_generada?.supuestos) ? parsed.teoria_del_cambio_generada.supuestos : [],
      resultados_esperados: Array.isArray(parsed.teoria_del_cambio_generada?.resultados_esperados) ? parsed.teoria_del_cambio_generada.resultados_esperados : [],
    },
    // B7: el modelo que REALMENTE respondió, no uno fijo en código.
    fuente: modelo,
    proveedor,
    calculadoEn: new Date().toISOString(),
  };
}

/**
 * recolectarContextoViabilidad — reúne el contexto real de un proyecto
 * (anexos, supuestos del árbol, teoría del cambio, ficha técnica/presupuesto)
 * y arma el `ctx` listo para `calcularViabilidadIA(ctx)`.
 *
 * Extraído de POST /api/proyectos/:id/viabilidad-ia (server.js) — auditoría
 * 2026-08-08 encontró esta misma lógica duplicada al diseñar el flujo Delta →
 * Versión N+1 (POST /api/proyectos/:id/continuar-formulacion,
 * proyectos.routes.js). Único punto de verdad ahora; ambos handlers lo llaman.
 *
 * `fichaOverride` permite fusionar correcciones del usuario (delta) sobre la
 * ficha técnica ANTES de recalcular viabilidad, sin persistir nada aquí —
 * la persistencia queda a cargo de cada caller.
 */
export async function recolectarContextoViabilidad(proyecto, userId, { getRow, getRows }, fichaOverride = null) {
  let anexos = [];
  try {
    anexos = await getRows('SELECT nombre_archivo, categoria FROM project_anexos WHERE project_id = ?', [proyecto.id]);
  } catch (e) {
    logger.warn('[viabilidad-ia] project_anexos no disponible — continuando sin anexos', { proyectoId: proyecto.id, err: e.message });
  }

  let supuestosArbol = [];
  try {
    const nodos = await getRows('SELECT supuestos FROM objetivos_arbol WHERE proyecto_id = ? AND supuestos IS NOT NULL', [proyecto.id]);
    supuestosArbol = nodos.map(n => n.supuestos).filter(Boolean);
  } catch (e) {
    logger.warn('[viabilidad-ia] objetivos_arbol.supuestos no disponible', { proyectoId: proyecto.id, err: e.message });
  }

  let resultadosCambio = [];
  try {
    const tdc = await getRow('SELECT resultados_corto_plazo FROM project_change_theory WHERE proyecto_id = ?', [proyecto.id]);
    if (tdc?.resultados_corto_plazo) resultadosCambio = JSON.parse(tdc.resultados_corto_plazo);
  } catch (e) {
    logger.warn('[viabilidad-ia] project_change_theory no disponible', { proyectoId: proyecto.id, err: e.message });
  }

  const fichaTecnicaBase = safeParseJson(proyecto.ficha_tecnica, {});
  const fichaTecnica = fichaOverride ? { ...fichaTecnicaBase, ...fichaOverride } : fichaTecnicaBase;
  const presupuesto  = safeParseJson(proyecto.presupuesto, {});
  const entradaCompleta   = fichaTecnica.entrada_completa   || {};
  const contextoNarrativo = fichaTecnica.contexto_narrativo || {};

  const ctx = {
    id: proyecto.id,
    userId,
    nombre: proyecto.nombre,
    problema: contextoNarrativo.A_diagnostico || proyecto.problem_statement || '',
    metaEsperada: contextoNarrativo.C_meta || '',
    poblacionAfectada: entradaCompleta.numeroBeneficiarios || '',
    coberturaGeografica: entradaCompleta.coberturaGeografica || '',
    presupuesto, anexos, supuestosArbol, resultadosCambio,
    // Ejes del financiador (Fase A 2026-09-30), de la entrada YA fusionada con fichaOverride.
    directivas: resolverDirectivas(entradaCompleta),
  };

  return { ctx, fichaTecnica };
}

export { safeParseJson, TAXONOMIA_ANEXO };
