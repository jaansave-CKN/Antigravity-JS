/**
 * formuladorMga.js — Formulador MGA (Fase 3): CONSOLIDADOR, nunca redacta
 * desde cero. Diseño: docs/diseno/formulador-mga.md (architect 2026-09-26,
 * APROBADO CON CAMBIOS B1-B7, todos incorporados).
 *
 * Flujo:
 *   1. recolectarFuentes(): Node lee de la BD (con RLS) lo YA generado por
 *      Entrada/EntradaIA, Contexto, Viabilidad y MIROFISH, más las cifras
 *      deterministas (Montecarlo, APU), y lo aplana en `datos` { id → texto }.
 *      Las cifras se formatean UNA vez aquí; el modelo no calcula nada.
 *   2. faltantesFormulador() (datosMinimosIA.js): 422 antes de gastar tokens.
 *   3. consolidarMGA(): deepseek-v4.1-flash (NVIDIA NIM) ordena `datos` en los
 *      4 bloques MGA; cada párrafo cita sus fuentes.
 *   4. validarConsolidacion(): determinista, anti-alucinación. Un párrafo sin
 *      fuente válida o con una cifra que no está en SUS fuentes se descarta.
 *      Nada se rellena con heurística.
 */
import crypto from 'crypto';
import { llamarNim, NimError, MAX_TOKENS_NIM } from './nimCliente.js';
import { logTokenUsage } from './aiTokenLogger.js';

export const MODELO_NIM_FORMULADOR = 'deepseek-ai/deepseek-v4.1-flash';
export const BLOQUES = ['identificacion_problema', 'poblacion_beneficiaria', 'justificacion_tecnica', 'analisis_riesgos'];
export const TITULOS_BLOQUES = {
  identificacion_problema: 'Identificación del Problema',
  poblacion_beneficiaria: 'Población Beneficiaria',
  justificacion_tecnica: 'Justificación Técnica',
  analisis_riesgos: 'Análisis de Riesgos',
};
const MAX_PARRAFOS = 4;
const MAX_TEXTO = 1200;
const MAX_ITEMS_LISTA = 12;

// ── Formato único de cifras (B4.1): lo que el modelo copia literal ───────────
const fmtEnteros = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const fmtUnDecimal = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtFecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });

export function cop(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return `${v < 0 ? '-' : ''}$ ${fmtEnteros.format(Math.abs(v))}`;
}
/** Fracción (0.812) → "81,2 %". null/indefinida → null (se omite, nunca "0 %"). */
export function pctDeFraccion(f) {
  if (f === null || f === undefined || !Number.isFinite(Number(f))) return null;
  return `${fmtUnDecimal.format(Number(f) * 100)} %`;
}
export function fechaLarga(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : fmtFecha.format(d);
}

// ── Recolección (B2, B3, B6, R4, R5, R7) ─────────────────────────────────────
const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}') || {}; } catch { return {}; } };
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const EXCLUIR_ENTRADA = new Set(['camposBloqueados', 'sectorOtro', 'categoriaOtro', 'nombre']);

function aplanar(valor, id, poner, profundidad = 0) {
  if (profundidad > 3 || valor === null || valor === undefined) return;
  if (Array.isArray(valor)) { valor.slice(0, MAX_ITEMS_LISTA).forEach((v, i) => aplanar(v, `${id}[${i + 1}]`, poner, profundidad + 1)); return; }
  if (typeof valor === 'object') { for (const [k, v] of Object.entries(valor)) aplanar(v, `${id}.${k}`, poner, profundidad + 1); return; }
  if (typeof valor === 'boolean') return;
  poner(id, valor);
}

/**
 * @param {{ id: string, nombre: string, ficha_tecnica: any }} proyecto — ya verificado como del usuario (B6)
 * @param {{ getRow: Function, getRows: Function }} deps — escopados al tenant
 */
export async function recolectarFuentes(proyecto, { getRow, getRows }) {
  const pid = proyecto.id;
  const [logistica, apu, mirofish, corrida] = await Promise.all([
    getRow('SELECT departamento, municipio FROM config_logistica WHERE proyecto_id = ? LIMIT 1', [pid]).catch(() => null),
    getRows('SELECT valor_total_cop FROM project_apu_lineas WHERE project_id = ?', [pid]),
    getRow('SELECT reglas, ia FROM project_mirofish_evaluaciones WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [pid]),
    getRow('SELECT inversion_cop, tasa_descuento, horizonte_anios, iteraciones, resultado, created_at FROM project_montecarlo_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [pid]),
  ]);

  const datos = {};
  const poner = (k, v) => { const t = texto(v); if (t) datos[k] = t.slice(0, 1500); };
  const ft = parse(proyecto.ficha_tecnica);
  const entrada = ft.entrada_completa || {};

  poner('proyecto.nombre', proyecto.nombre);
  // Tipo de obra = sectores + nivelProyecto (decisión (a) del dueño). "Otro" se resuelve con sectorOtro (R4).
  const sectores = [
    ...(Array.isArray(entrada.sectores) ? entrada.sectores.filter(s => texto(s) && !/^otro$/i.test(texto(s))) : []),
    ...Object.values(entrada.sectorOtro || {}).filter(v => texto(v)),
  ];
  if (sectores.length) poner('entrada.sectores', sectores.join('; '));
  const categoria = [texto(entrada.categoriaPoblacion), ...Object.values(entrada.categoriaOtro || {}).map(texto)].filter(v => v && !/^otro$/i.test(v));
  if (categoria.length) poner('entrada.categoriaPoblacion', categoria.join('; '));
  for (const [k, v] of Object.entries(entrada)) {
    if (EXCLUIR_ENTRADA.has(k) || k === 'sectores' || k === 'categoriaPoblacion') continue;
    aplanar(v, `entrada.${k}`, poner);
  }
  aplanar(ft.contexto_narrativo, 'contexto', poner);
  if (logistica) { poner('logistica.municipio', logistica.municipio); poner('logistica.departamento', logistica.departamento); }

  // Viabilidad (B2): con fuente heurística, analisis_escala_poblacion es RELLENO → se excluye.
  const via = ft.viabilidad_ia;
  const viabilidadHeuristica = via?.fuente === 'heuristica';
  if (via) {
    poner('viabilidad.estado_auditoria', via.estado_auditoria);
    if (Number.isFinite(Number(via.score_viabilidad))) poner('viabilidad.score_viabilidad', `${Math.round(via.score_viabilidad)}/100${viabilidadHeuristica ? ' (cálculo heurístico, sin IA)' : ''}`);
    if (!viabilidadHeuristica) {
      poner('viabilidad.veredicto_escala', via.analisis_escala_poblacion?.veredicto_escala);
      poner('viabilidad.alerta_escala', via.analisis_escala_poblacion?.alerta);
    }
    aplanar(via.cruce_anexos?.brechas_detectadas, 'viabilidad.brechas_detectadas', poner);
    aplanar(via.teoria_del_cambio_generada?.supuestos, 'viabilidad.supuestos', poner);
    aplanar(via.teoria_del_cambio_generada?.resultados_esperados, 'viabilidad.resultados_esperados', poner);
    if (via.calculadoEn) poner('viabilidad.fecha', fechaLarga(via.calculadoEn));
  }

  // MIROFISH (R5): reglas siempre; hallazgos de IA solo si ia.estado === 'ok'.
  if (mirofish) {
    const reglas = parse(mirofish.reglas).hallazgos || [];
    reglas.slice(0, MAX_ITEMS_LISTA).forEach((h, i) => {
      poner(`mirofish.regla[${i + 1}].titulo`, `${h.regla ? `${h.regla} · ` : ''}${h.severidad || ''} · ${h.titulo || ''}`);
      poner(`mirofish.regla[${i + 1}].recomendacion`, h.recomendacion);
    });
    const ia = parse(mirofish.ia);
    if (ia.estado === 'ok') (ia.hallazgos || []).slice(0, MAX_ITEMS_LISTA).forEach((h, i) => {
      poner(`mirofish.ia[${i + 1}].titulo`, `${h.severidad || ''} · ${h.titulo || ''}`);
      poner(`mirofish.ia[${i + 1}].detalle`, h.detalle || h.descripcion);
    });
  }

  // Cifras deterministas (B3, R7).
  const totalApu = apu.reduce((s, l) => s + Number(l.valor_total_cop || 0), 0);
  if (apu.length) {
    poner('finanzas.apu_total_cop', `${cop(totalApu)} (según APU en Anexos)`);
    poner('finanzas.apu_numero_lineas', String(apu.length));
  }
  const corridaObsoleta = !!corrida && Math.abs(Number(corrida.inversion_cop) - totalApu) > 0.005;
  if (corrida && !corridaObsoleta) {
    const r = parse(corrida.resultado);
    poner('finanzas.inversion_cop', cop(corrida.inversion_cop));
    poner('finanzas.tasa_descuento', pctDeFraccion(corrida.tasa_descuento));
    poner('finanzas.horizonte_anios', `${corrida.horizonte_anios} años`);
    poner('finanzas.van_p10_cop', cop(r.van?.p10_cop));
    poner('finanzas.van_p50_cop', cop(r.van?.p50_cop));
    poner('finanzas.van_p90_cop', cop(r.van?.p90_cop));
    poner('finanzas.probabilidad_van_positivo', pctDeFraccion(r.probabilidad_van_positivo));
    poner('finanzas.tir_p50', pctDeFraccion(r.tir?.p50)); // null → se omite (B3)
    poner('finanzas.montecarlo_fecha', fechaLarga(corrida.created_at));
  }

  const poblacion = [datos['entrada.numeroBeneficiarios'], datos['entrada.categoriaPoblacion'], ...Object.keys(datos).filter(k => k.startsWith('entrada.detallePoblacion'))].some(Boolean);
  return {
    datos,
    meta: {
      sectores: sectores.length > 0,
      nivelProyecto: !!texto(entrada.nivelProyecto),
      ubicacion: !!(texto(entrada.municipio) || texto(logistica?.municipio)),
      poblacion,
      viabilidad: !!via,
      viabilidadHeuristica,
      mirofish: !!mirofish,
      lineasApu: apu.length,
      corrida: corrida ? (corridaObsoleta ? 'obsoleta' : 'vigente') : 'ninguna',
    },
  };
}

/** Huella estable de las fuentes: si cambia, la consolidación guardada queda desactualizada. */
export function huellaFuentes(datos) {
  const ordenado = Object.keys(datos).sort().map(k => [k, datos[k]]);
  return crypto.createHash('sha256').update(JSON.stringify(ordenado)).digest('hex');
}

// ── Validación numérica por párrafo (B4) ─────────────────────────────────────
const RE_NUMERO = /(?<![\p{L}\d.,])(?:(?<=^|[\s(])-)?\$?\s?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(\s?%)?/gu;
const RE_ORDINAL = /\d+\s?(?:º|ª|°|er|ro|do|to|vo|no)\b/gu;

/** Tokens numéricos canónicos: { valor: '1234567' | '-81.2', pct: bool }. */
export function tokensNumericos(str) {
  const salida = [];
  for (const m of String(str).matchAll(RE_NUMERO)) {
    const crudo = m[0];
    const pct = /%\s*$/.test(crudo);
    const negativo = crudo.trim().startsWith('-');
    const cuerpo = crudo.replace(/[-$%\s]/g, '').replace(/\./g, '').replace(',', '.');
    const n = Number(cuerpo);
    if (!Number.isFinite(n)) continue;
    salida.push({ valor: String(negativo ? -n : n), pct });
  }
  return salida;
}

function limpiarTexto(t, ids) {
  let s = String(t);
  for (const id of ids) s = s.split(id).join(' ');
  return s.replace(RE_ORDINAL, ' ');
}

/** Cifras del párrafo que NO están en sus propias fuentes (vacío = párrafo válido). */
export function cifrasNoTrazables(textoParrafo, fuentes, datos) {
  const permitidos = fuentes.flatMap(id => tokensNumericos(datos[id] || ''));
  const mencionaNegativo = /negativ/i.test(textoParrafo);
  const ids = Object.keys(datos).sort((a, b) => b.length - a.length);
  return tokensNumericos(limpiarTexto(textoParrafo, ids)).filter((t) => !permitidos.some((p) => {
    if (t.pct !== p.pct) return false;
    if (p.valor === t.valor) return true;
    return mencionaNegativo && Number(p.valor) < 0 && String(Math.abs(Number(p.valor))) === t.valor;
  })).map(t => t.valor + (t.pct ? '%' : ''));
}

/** Extrae el primer objeto JSON del texto (tolera cercas ``` y texto alrededor). */
export function extraerJson(textoModelo) {
  const s = String(textoModelo).replace(/```(?:json)?/gi, '');
  const inicio = s.indexOf('{');
  if (inicio < 0) return null;
  let profundidad = 0, enCadena = false, escape = false;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (enCadena) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') enCadena = false; continue; }
    if (c === '"') enCadena = true;
    else if (c === '{') profundidad++;
    else if (c === '}' && --profundidad === 0) { try { return JSON.parse(s.slice(inicio, i + 1)); } catch { return null; } }
  }
  return null;
}

/**
 * Valida la salida del modelo contra `datos`. Nunca completa ni corrige texto.
 * @returns {{ bloques: object, descartados: Array<{bloque,texto,motivo,detalle?}>, parrafosValidos: number }}
 */
export function validarConsolidacion(salida, datos) {
  const bloques = {};
  const descartados = [];
  let parrafosValidos = 0;
  for (const b of BLOQUES) {
    const parrafos = Array.isArray(salida?.[b]?.parrafos) ? salida[b].parrafos.slice(0, MAX_PARRAFOS) : [];
    const validos = [];
    for (const p of parrafos) {
      const t = texto(p?.texto).slice(0, MAX_TEXTO);
      const fuentes = Array.isArray(p?.fuentes) ? [...new Set(p.fuentes.map(texto).filter(Boolean))] : [];
      if (!t) continue;
      if (!fuentes.length) { descartados.push({ bloque: b, texto: t, motivo: 'sin_fuente' }); continue; }
      const inexistentes = fuentes.filter(id => !(id in datos));
      if (inexistentes.length) { descartados.push({ bloque: b, texto: t, motivo: 'fuente_inexistente', detalle: inexistentes.join(', ') }); continue; }
      const malas = cifrasNoTrazables(t, fuentes, datos);
      if (malas.length) { descartados.push({ bloque: b, texto: t, motivo: 'cifra_no_trazable', detalle: malas.join(', ') }); continue; }
      validos.push({ texto: t, fuentes });
    }
    parrafosValidos += validos.length;
    bloques[b] = validos.length ? { estado: 'ok', parrafos: validos } : { estado: 'sin_contenido_verificable', parrafos: [] };
  }
  return { bloques, descartados, parrafosValidos };
}

// ── Llamada al modelo ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el Formulador MGA de RadFor-360. Tu ÚNICA tarea es ORDENAR Y CONSOLIDAR información ya existente del proyecto en los 4 bloques de la Metodología General Ajustada (DNP Colombia). NO redactas desde cero.

REGLAS OBLIGATORIAS:
1. Usa SOLO la información de DATOS. Si un bloque no tiene información en DATOS, déjalo con "parrafos": [].
2. Cada párrafo DEBE citar en "fuentes" los ids exactos de DATOS de los que sale su contenido (mínimo 1).
3. PROHIBIDO calcular, recalcular, redondear, estimar, convertir o abreviar cifras ("millones", "mil"). Toda cifra se copia LITERAL, con el mismo formato, desde la fuente citada. No escribas números en palabras ni enumeres con números.
4. PROHIBIDO inventar leyes, normas, años, porcentajes, entidades o datos que no estén en DATOS.
5. Máximo ${MAX_PARRAFOS} párrafos por bloque, cada uno de máximo ${MAX_TEXTO} caracteres. Español formal, tono técnico.
6. Bloques: identificacion_problema (problema, causas, contexto), poblacion_beneficiaria (quiénes, cuántos, dónde), justificacion_tecnica (solución, alcance, cifras financieras), analisis_riesgos (hallazgos del comité MIROFISH, brechas y supuestos de viabilidad).

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con esta forma exacta:
{"identificacion_problema":{"parrafos":[{"texto":"...","fuentes":["id"]}]},"poblacion_beneficiaria":{"parrafos":[]},"justificacion_tecnica":{"parrafos":[]},"analisis_riesgos":{"parrafos":[]}}`;

/**
 * @returns {Promise<{ estado: 'ok'|'no_disponible', motivo?: string, bloques?: object, descartados: array, modelo: string }>}
 */
export async function consolidarMGA(datos, { userId }) {
  const listado = Object.entries(datos).map(([id, valor]) => ({ id, valor }));
  let respuesta;
  try {
    respuesta = await llamarNim({
      model: MODELO_NIM_FORMULADOR,
      max_tokens: MAX_TOKENS_NIM,
      temperature: 0.1,
      // Tope TOTAL (reintentos incluidos) por debajo de los 60 s del cliente
      // (apiClient.withDefaultTimeout): si el navegador cortara primero,
      // fetchWithRetry REENVIARÍA el POST → consulta duplicada y cobrada.
      timeoutMs: 50_000,
      origen: 'formulador_mga',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `DATOS (id → valor):\n${JSON.stringify(listado)}` },
      ],
    });
  } catch (err) {
    const motivo = err instanceof NimError ? err.motivo : 'error';
    console.warn(`[FormuladorMGA] IA no disponible (${motivo}): ${String(err.message).slice(0, 160)}`);
    return { estado: 'no_disponible', motivo, descartados: [], modelo: MODELO_NIM_FORMULADOR };
  }

  const u = respuesta.usage || {};
  const salidaReal = Number.isFinite(u.total_tokens) && Number.isFinite(u.prompt_tokens) ? u.total_tokens - u.prompt_tokens : (u.completion_tokens ?? 0);
  logTokenUsage({ userId, agentName: 'formulador_mga', tokensInput: u.prompt_tokens ?? 0, tokensOutput: salidaReal }).catch(() => {});

  const salida = extraerJson(respuesta.texto);
  if (!salida || !BLOQUES.some(b => b in salida)) {
    console.warn('[FormuladorMGA] respuesta sin el JSON esperado');
    return { estado: 'no_disponible', motivo: 'respuesta_invalida', descartados: [], modelo: respuesta.modelo };
  }
  const { bloques, descartados, parrafosValidos } = validarConsolidacion(salida, datos);
  if (!parrafosValidos) return { estado: 'no_disponible', motivo: 'sin_contenido_verificable', descartados, modelo: respuesta.modelo };
  return { estado: 'ok', bloques, descartados, modelo: respuesta.modelo };
}
