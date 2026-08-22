/**
 * EntradaIAService.js — "Generar con AI" de la ventana Entrada (M1 del
 * Formulador). Mandato del usuario (2026-08-17): un botón que llena los
 * campos de Entrada a partir del contenido real de la carpeta de Anexos cuyo
 * nombre contenga "investigación" (o "investigacion", sin tilde) del
 * proyecto activo — el usuario puede seguir llenando todo a mano igual que
 * siempre, esto es una ayuda opcional, nunca obligatoria.
 *
 * Mismo patrón que CopilotoService.js/viabilidadAgent.js: intenta Gemini
 * gateado por geminiCB; si falla, se lanza un error controlado (status) con
 * un mensaje claro — nunca inventa datos ni deja el formulario en un estado
 * a medio llenar sin avisar.
 *
 * "A prueba de errores" (pedido explícito del usuario):
 *   1. Carpeta "investigación" no existe → error claro, no genérico.
 *   2. Carpeta vacía → error claro.
 *   3. Un archivo/link individual falla al extraerse (formato raro, Storage
 *      caído, URL caída/con timeout) → se omite ESE elemento, se sigue con
 *      los demás — nunca aborta todo el proceso por uno solo problemático.
 *   4. Gemini no responde / cuota agotada / JSON inválido → error claro, el
 *      formulario del cliente queda intacto (esta función nunca escribe en
 *      BD, solo devuelve datos — el merge final lo decide el frontend).
 *
 * FIX (auditoría 2026-08-17, "el botón no analiza a fondo la información"):
 * los documentos reales de la carpeta "Investigación" del usuario son
 * mayormente LINKS (a conversaciones compartidas de Gemini/ChatGPT/
 * Perplexity, no archivos subidos) — la versión anterior solo mandaba la
 * URL como texto plano a Gemini (que no puede navegar la web), sin leer el
 * contenido real de la página. Ahora se descarga cada link (mismo patrón de
 * fetch con timeout/User-Agent ya usado en EntityScraper.js) y se extrae el
 * texto plano del HTML antes de mandarlo al prompt. Si una página es una
 * SPA que renderiza todo por JavaScript (sin contenido en el HTML crudo) la
 * extracción puede salir corta — no hay forma de evitarlo sin un navegador
 * headless, que este proyecto no usa en ningún otro punto — pero nunca
 * bloquea ni hace fallar la generación completa por un link individual.
 *
 * FIX (2026-08-19, verificado en vivo con los 4 links reales de la carpeta
 * "Investigación" del usuario): los 2 links `share.gemini.google` fallaban
 * SIEMPRE con "fetch failed" / "Headers Overflow Error" — no es cuota ni
 * red caída, es que Google responde con headers (Set-Cookie de sesión/SSO)
 * más grandes que el límite por defecto de undici (16KB) para el `fetch`
 * global de Node. Confirmado reproduciendo el fetch real: con
 * `maxHeaderSize` ampliado, ambos links devuelven 200 y ~830KB de HTML
 * real. Se probó pasar un `Agent` dedicado vía `dispatcher` por-llamada
 * (como hace `resilientFetch.js` para su propio caso de certificados TLS),
 * pero en esta versión de Node (v25.8.2) esa combinación específica de
 * opciones revienta con "invalid onRequestStart method" — desajuste interno
 * entre el paquete `undici` de npm y el `fetch` nativo vendorizado. La
 * única forma verificada que funciona es `setGlobalDispatcher`, aplicada
 * una sola vez al cargar este módulo.
 *
 * MEJORA FUTURA OPCIONAL, evaluada y descartada por ahora (2026-08-19,
 * revisión de `architect`): agregar un navegador headless (Puppeteer/
 * Playwright) para renderizar JS y leer chatgpt.com/share, share.gemini.
 * google y perplexity.ai. Descartado porque: (1) solo resolvería ChatGPT —
 * Gemini exige sesión de Google autenticada y Perplexity está detrás de
 * Cloudflare bot-management, ninguno de los dos lo arregla un headless; (2)
 * incluso para ChatGPT, el contenido real vive en un blob "turbo-stream" de
 * React Router 7 no documentado, no en el DOM renderizado — ejecutar JS no
 * basta; (3) Render corre esta app como un solo servicio (`render.yaml`,
 * plan starter, sin worker aparte) — un Chromium empaquetado (~300MB+)
 * compite por memoria con el mismo proceso que sirve la API y el frontend,
 * y contradice el trabajo ya invertido en bajar el tiempo de arranque (ver
 * memoria `project_fix_arranque_lento_root_offline_2026_08_17`). La vía que
 * sí funciona hoy sin costo de infraestructura: el usuario pega el texto de
 * la conversación en el campo `texto` del anexo (ver
 * `compilarContenidoCarpeta` más abajo, que ya lo lee).
 */
import { Agent, setGlobalDispatcher } from 'undici';
import { supabaseStorage } from '../config/supabase.config.js';
import { convertBufferToMarkdown } from './markitdownService.js';
import { sanitizeTechnicalText } from '../middlewares/SecurityMiddleware.js';
import { withKeyRotation, isQuotaError, GeminiPoolExhaustedError } from './geminiCircuitBreaker.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const ANEXOS_BUCKET = 'anexos';
const EXTENSIONES_CON_TEXTO = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'md']);
// Subido 2026-08-17 (pedido explícito: "analizando a profundidad" el
// contenido real) — el material de investigación real del usuario son
// conversaciones largas de IA compartidas por link, no notas cortas.
const MAX_CHARS_POR_ANEXO = 20000;
const MAX_CHARS_TOTAL = 120000;

class EntradaIAError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

function safeExt(filename) {
  return (filename || '').split('.').pop().toLowerCase();
}

// Normaliza (minúsculas + sin tildes) para encontrar "investigación",
// "Investigacion", "INVESTIGACIÓN", etc. sin depender de collation de BD.
function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function buscarCarpetaInvestigacion(projectId, { getRows }) {
  const carpetas = await getRows(
    'SELECT id, nombre FROM project_anexos_carpetas WHERE project_id = ?',
    [projectId]
  );
  return carpetas.find(c => normalizar(c.nombre).includes('investigacion')) || null;
}

const LINK_FETCH_TIMEOUT_MS = 15_000;
const LINK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// Google (share.gemini.google) responde con headers de sesión/SSO que
// superan el límite por defecto de undici (16KB) — ver nota de cabecera
// "FIX 2026-08-19". setGlobalDispatcher es la única forma verificada que
// funciona en esta versión de Node; solo amplía un límite (permisivo), no
// afecta ningún otro fetch existente en la app.
setGlobalDispatcher(new Agent({ maxHeaderSize: 262144 }));

// Fail-fast (2026-08-22): dominios verificados en vivo el 2026-08-19 contra
// los 4 links reales de este proyecto como imposibles de leer por fetch
// simple — share.gemini.google exige sesión de Google autenticada,
// perplexity.ai bloquea con el challenge de Cloudflare, chatgpt.com/share
// renderiza la conversación por JS del lado del cliente. En vez de gastar
// LINK_FETCH_TIMEOUT_MS (15s) en un intento que ya se sabe que va a fallar,
// se corta de inmediato con un mensaje accionable para el usuario. Dominio
// real verificado contra la BD del proyecto: `share.gemini.google`, SIN
// `.com` — no confundir con el dominio de consumidor `gemini.google.com`.
const DOMINIOS_PROTEGIDOS = [/(^|\.)chatgpt\.com$/i, /(^|\.)share\.gemini\.google$/i, /(^|\.)perplexity\.ai$/i];
function esDominioProtegido(url) {
  try {
    return DOMINIOS_PROTEGIDOS.some(re => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

// Descarga un link real (conversación compartida de Gemini/ChatGPT/
// Perplexity, artículo, etc.) y extrae texto plano del HTML. Nunca lanza —
// cualquier fallo (timeout, 404, red caída, contenido no-HTML) devuelve
// string vacío para que el resto de la compilación siga sin interrupciones.
async function extraerTextoDeLink(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(LINK_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': LINK_USER_AGENT, Accept: 'text/html' },
    });
    if (!res.ok) return '';
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return '';

    const html = await res.text();
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/gi, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();

    // Verificado en vivo (2026-08-19) contra los 4 links reales de este
    // proyecto: chatgpt.com/share, share.gemini.google y perplexity.ai
    // renderizan la conversación por JavaScript del lado del cliente — el
    // HTML crudo que ve este fetch (sin navegador) es solo un cascarón
    // ("Sign in", "Just a moment... Enable JavaScript", el <title> de la
    // página) de bajo cien caracteres, nunca la conversación real. Sin este
    // umbral, ese cascarón se cuela como si fuera contenido legítimo y
    // contamina el prompt de la IA en vez de activar el aviso honesto de
    // "no se pudo leer" ya existente más abajo.
    if (texto.length < 200) return '';
    return texto;
  } catch (e) {
    logger.warn?.('[EntradaIA] No se pudo leer un link (se omite, no bloqueante)', { url, err: e.message })
      ?? console.warn('[EntradaIA] No se pudo leer un link (se omite):', url, e.message);
    return '';
  }
}

// Compila el contenido real de los anexos de la carpeta en un solo texto —
// descripcion/texto/link narrativos + texto extraído del archivo si el
// formato lo permite. Nunca lanza por un archivo individual: lo omite y
// sigue con el resto (ver punto 3 del comentario de cabecera).
async function compilarContenidoCarpeta(carpetaId, projectId, { getRows }) {
  const anexos = await getRows(
    'SELECT id, nombre_archivo, ruta_storage, descripcion, texto, link FROM project_anexos WHERE carpeta_id = ? AND project_id = ?',
    [carpetaId, projectId]
  );
  if (!anexos.length) return { anexos: [], contenido: '' };

  const bloques = [];
  for (const a of anexos) {
    const partes = [];
    if (a.descripcion?.trim()) partes.push(a.descripcion.trim());
    if (a.texto?.trim()) partes.push(a.texto.trim());

    if (a.link?.trim()) {
      const linkTrim = a.link.trim();
      if (esDominioProtegido(linkTrim)) {
        // Fail-fast — no se intenta el fetch. Si este mismo anexo también
        // tiene texto/descripción, ya se agregaron arriba (líneas 179-180)
        // y no se pierden por esta alerta — solo se advierte sobre el link.
        partes.push(`Fuente: ${linkTrim} — [ALERTA DE SISTEMA]: Se detectó un enlace a un motor de IA protegido. El contenido no pudo ser extraído automáticamente. Acción requerida: exportar la investigación a PDF/TXT y subirla como Anexo, o pegar el texto directo.`);
      } else {
        const textoLink = await extraerTextoDeLink(linkTrim);
        // String de control explícito (no una frase libre) — así el prompt
        // puede instruir a la IA a reconocerlo y tratarlo como "sin datos
        // para este anexo" en vez de intentar extraer sentido de un mensaje
        // de error ambiguo.
        partes.push(textoLink
          ? `Contenido de ${linkTrim}:\n${textoLink}`
          : `Fuente: ${linkTrim} — [Contenido inaccesible por seguridad de la página fuente]`);
      }
    }

    if (a.ruta_storage && supabaseStorage && EXTENSIONES_CON_TEXTO.has(safeExt(a.nombre_archivo))) {
      try {
        const { data, error } = await supabaseStorage.storage.from(ANEXOS_BUCKET).download(a.ruta_storage);
        if (!error && data) {
          const buffer = Buffer.from(await data.arrayBuffer());
          const texto = await convertBufferToMarkdown(buffer, safeExt(a.nombre_archivo));
          if (texto?.trim()) partes.push(texto.trim());
        }
      } catch (e) {
        // No bloqueante — un archivo que no se puede leer no debe tumbar la
        // generación completa. Se sigue con el resto de anexos.
        logger.warn?.('[EntradaIA] No se pudo extraer texto de un anexo (se omite, no bloqueante)', { anexoId: a.id, err: e.message })
          ?? console.warn('[EntradaIA] No se pudo extraer texto de un anexo (se omite):', e.message);
      }
    }

    if (partes.length) {
      bloques.push(`### ${a.nombre_archivo || a.descripcion || 'Documento sin título'}\n${partes.join('\n\n').slice(0, MAX_CHARS_POR_ANEXO)}`);
    }
  }

  const contenido = bloques.join('\n\n---\n\n').slice(0, MAX_CHARS_TOTAL);
  return { anexos, contenido };
}

// Acotado al módulo 11 "Contexto del Problema" (2026-08-17, pedido explícito
// del usuario con captura real de EntradaPage.tsx): antes generaba el
// formulario completo (enfoque/sectores/población/etc.), ahora SOLO estos 7
// campos narrativos — coincide exactamente con CONTEXTO_CAMPOS de
// EntradaPage.tsx. Al ser todo texto libre (sin radios/checkboxes de por
// medio) ya no hace falta que el frontend mande catálogos para validar.
const CAMPOS_CONTEXTO = ['situacion_actual', 'linea_base', 'meta', 'justificacion', 'sociocultural', 'problema_urgente', 'incertidumbre'];

function buildSystemPrompt(contenido) {
  return `Eres un asistente experto en formulación de proyectos de inversión/infraestructura en Colombia. Vas a leer material de investigación real (documentos, conversaciones de investigación con otras IAs, notas) que el usuario ya subió a la carpeta "Investigación" de su proyecto, y a partir de ESE contenido vas a completar la sección "Contexto del Problema" de un formulario de formulación de proyectos.

REGLAS INQUEBRANTABLES:
1. Lee y analiza CADA fuente del material de investigación a fondo, no solo la primera — si hay varias fuentes (por ejemplo, la misma investigación consultada con distintas IAs), sintetiza y cruza la información entre todas ellas: usa el dato más específico/cuantificado cuando varias fuentes coincidan, y complementa un campo con lo que aporte cada fuente si ninguna sola lo cubre completo.
2. Usa EXCLUSIVAMENTE información que puedas fundamentar en el material de investigación de abajo — NUNCA inventes cifras, ubicaciones ni datos que no estén respaldados por el texto. Si un campo crítico (ej. B. Línea Base Cuantificable, C. Meta Esperada) no se encuentra en el material, responde exactamente "ND (No Disponible en la investigación)" en ese campo — nunca lo dejes vacío ni inventes un valor para rellenarlo.
3. Si una fuente aparece marcada como "[Contenido inaccesible por seguridad de la página fuente]" o "[ALERTA DE SISTEMA]", trátala como si no existiera para efectos de ese campo — NUNCA la uses como base ni la menciones en la respuesta, simplemente ignórala y sigue con las demás fuentes disponibles.
4. Toda cifra de presupuesto, costo o viabilidad financiera debe expresarse EXCLUSIVAMENTE en Pesos Colombianos (COP) — prohibido usar o mencionar dólares u otra divisa. Si el material fuente trae una cifra en otra moneda, conviértela a COP solo si el material mismo da la tasa de conversión; si no la da, márcala como "ND (No Disponible en la investigación)" en vez de asumir una tasa.
5. Tono "Arquitecto Constructor": técnico, breve, directo — cifras, unidades, plazos y lugares concretos. Cero introducciones, cero lenguaje comercial, cero explicaciones básicas de conceptos ya obvios para un formulador de proyectos.
6. Sé específico y sustancioso en cada campo (cifras, nombres de lugares, unidades, plazos) cuando el material los tenga — evita respuestas genéricas de una sola frase si el material soporta más detalle.
7. Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown, sin texto antes ni después — solo el JSON.

FORMA EXACTA DEL JSON A DEVOLVER (los 7 campos de "Contexto del Problema"):
{
  "situacion_actual": string ("A. Situación actual sin proyecto" — ej: 'El 80% de las familias consumen agua no potable'),
  "linea_base": string ("B. Indicador de línea base cuantificable" — ej: '% de familias sin acceso a energía — Valor actual: 80 — Unidad: %'),
  "meta": string ("C. Meta esperada (número y unidad)" — ej: 'Valor meta: 5 — Unidad: %'),
  "justificacion": string ("D. Justificación de prioridad" — relevancia estratégica del proyecto),
  "sociocultural": string ("E. Análisis sociocultural para la pertinencia"),
  "problema_urgente": string ("F. ¿Qué problema percibe como más urgente?"),
  "incertidumbre": string ("G. Condición crítica de incertidumbre logística")
}

MATERIAL DE INVESTIGACIÓN REAL DEL PROYECTO:
${contenido}`;
}

// REFACTOR (2026-08-19, pool de llaves): withKeyRotation() prueba cada
// llave del pool, rotando solo ante 429 — mismo contrato (siempre lanza
// EntradaIAError con status HTTP claro, nunca deja el formulario a medias).
async function llamarGemini(systemPrompt, orgId) {
  try {
    const { texto, usage } = await withKeyRotation(async (apiKey) => {
      const upstream = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-3.6-flash',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Genera el JSON del formulario a partir del material de investigación.' }],
          temperature: 0.2,
          max_tokens: 4096,
        }),
      });

      if (upstream.status === 429) throw new Error('Gemini 429 quota exceeded');
      if (!upstream.ok) {
        const cuerpo = await upstream.text().catch(() => '');
        logger.error('[EntradaIA] Fallo Gemini', { status: upstream.status, body: cuerpo.slice(0, 300) });
        throw new Error(`Gemini HTTP ${upstream.status}`);
      }

      const data = await upstream.json();
      const texto = data?.choices?.[0]?.message?.content?.trim();
      if (!texto) throw new Error('Gemini sin contenido en la respuesta');
      return { texto, usage: data?.usage ?? {} };
    });

    logTokenUsage({
      userId: orgId, agentName: 'entrada-ia',
      tokensInput: usage?.prompt_tokens ?? 0,
      tokensOutput: usage?.completion_tokens ?? 0,
    }).catch(() => {});
    return texto;
  } catch (err) {
    if (err instanceof EntradaIAError) throw err;
    if (err instanceof GeminiPoolExhaustedError) throw new EntradaIAError('El límite de uso de IA está agotado por ahora — intenta de nuevo en unos minutos, o llena el formulario manualmente.', 429);
    if (isQuotaError(err)) throw new EntradaIAError('Límite de IA agotado — intenta de nuevo en unos minutos.', 429);
    if (err.status === 503) throw new EntradaIAError('La generación con IA no está configurada en el servidor (falta GOOGLE_API_KEY).', 503);
    logger.error('[EntradaIA] Excepción Gemini', { err: err.message });
    throw new EntradaIAError('No se pudo generar con IA en este momento — intenta de nuevo o llena el formulario manualmente.', 502);
  }
}

function parseJsonRespuesta(texto) {
  // La instrucción pide JSON puro, pero los modelos a veces igual envuelven
  // en ```json ... ``` — se despoja antes de parsear, sin asumir que nunca
  // pasará (matching la regla "a prueba de errores").
  const limpio = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(limpio);
  } catch {
    throw new EntradaIAError('La IA devolvió un formato inválido — intenta de nuevo.', 502);
  }
}

const txt = (v, max = 2000) => sanitizeTechnicalText(typeof v === 'string' ? v : '', max);

// Sanitiza la respuesta cruda de la IA — solo los 7 campos de contexto,
// cualquier clave extra que la IA agregue por su cuenta se ignora.
function sanitizarRespuesta(raw) {
  const out = {};
  for (const campo of CAMPOS_CONTEXTO) out[campo] = txt(raw?.[campo]);
  return out;
}

/**
 * @param {string} projectId
 * @param {string} orgId
 */
export async function generarEntradaDesdeInvestigacion(projectId, orgId, { getRow, getRows }) {
  const carpeta = await buscarCarpetaInvestigacion(projectId, { getRows });
  if (!carpeta) {
    throw new EntradaIAError('No se encontró una carpeta de Anexos llamada "Investigación" en este proyecto. Crea una carpeta con ese nombre en Anexos y sube ahí tu material antes de generar con IA.');
  }

  const { anexos, contenido } = await compilarContenidoCarpeta(carpeta.id, projectId, { getRows });
  if (!anexos.length) {
    throw new EntradaIAError(`La carpeta "${carpeta.nombre}" está vacía — agrega documentos o notas en Anexos antes de generar con IA.`);
  }
  if (!contenido.trim()) {
    throw new EntradaIAError(`Los documentos de la carpeta "${carpeta.nombre}" no tienen contenido legible (¿son solo imágenes o archivos vacíos?) — agrega texto/descripción a los anexos o sube un documento de texto.`);
  }

  const systemPrompt = buildSystemPrompt(contenido);
  const textoRespuesta = await llamarGemini(systemPrompt, orgId);
  const raw = parseJsonRespuesta(textoRespuesta);
  return sanitizarRespuesta(raw);
}
