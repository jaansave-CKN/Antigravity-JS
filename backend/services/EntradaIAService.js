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
import { withUserKeyRotation, UserKeyPoolExhaustedError } from './byokService.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';
import { calcularScoringDinamico } from './scoringDinamico.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const ANEXOS_BUCKET = 'anexos';
const EXTENSIONES_CON_TEXTO = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'md']);
// Subido 2026-08-17 (pedido explícito: "analizando a profundidad" el
// contenido real) — el material de investigación real del usuario son
// conversaciones largas de IA compartidas por link, no notas cortas.
const MAX_CHARS_POR_ANEXO = 20000;
const MAX_CHARS_TOTAL = 120000;

class EntradaIAError extends Error {
  // retryAt (opcional, Date): momento real en que se puede reintentar — se
  // propaga desde GeminiPoolExhaustedError (ver llamarGemini más abajo) para
  // que el frontend pueda mostrar el reloj de cuenta regresiva real.
  constructor(message, status = 422, retryAt = null) { super(message); this.status = status; this.retryAt = retryAt; }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO MOCK (2026-08-23, "quemando tokens en pruebas repetitivas de UI") —
// interruptor de desarrollo que corta ANTES de tocar Anexos/Gemini y
// devuelve datos de prueba instantáneos, marcados sin ambigüedad como mock
// ("[MOCK]" en cada valor) — nunca podrían confundirse con análisis real ni
// colarse como si lo fueran. Distinto en naturaleza de las fabricaciones ya
// rechazadas esta sesión: aquellas pedían simular una respuesta REAL de IA
// ante un usuario REAL con datos REALES ausentes (alucinación disfrazada de
// verdad); esto es una bandera de desarrollo, apagada por defecto, que un
// desarrollador activa a propósito para probar SU PROPIO código (máquina de
// estados secuencial, matemática de C4, wiring de botones) sin gastar la
// cuota compartida — nunca llega a un usuario real sin que alguien haya
// editado el .env del servidor a mano.
// Doble candado de producción (mismo patrón que demo-mode-token en
// auth.middleware.js): NODE_ENV==='production' desactiva esto sin
// excepción, aunque alguien deje MOCK_AI=true en el .env por descuido.
function mockAiActivo() {
  return process.env.MOCK_AI === 'true' && process.env.NODE_ENV !== 'production';
}
function logMock(fn) {
  logger.warn(`[EntradaIA][MOCK_AI] ${fn} — devolviendo datos de prueba, no se llamó a Gemini`);
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
//
// CACHÉ (2026-08-22, corregida en 044): extraerTextoDeLink() (fetch real,
// hasta 15s) y convertBufferToMarkdown() (descarga de Supabase Storage +
// subprocess de Python vía MarkItDown) son las dos operaciones caras de
// esta función — antes se repetían íntegras en CADA clic de "Generar con
// AI" aunque el anexo no hubiera cambiado. El diseño original invalidaba
// por `updated_at`, pero project_anexos NO tiene esa columna (verificado
// en vivo: la 043 original habría roto el SELECT completo con "column
// updated_at does not exist" — nunca llegó a ejecutarse contra datos
// reales). Ahora la invalidación es por CONTENIDO: cada canal guarda el
// valor exacto (`link`/`ruta_storage`) que se cacheó — si el usuario edita
// el link o sube otro archivo, ese valor cambia y la caché de ESE canal se
// invalida sola, sin depender de ninguna columna de timestamp de fila.
// Escritura de caché best-effort — un fallo al guardar no debe tumbar la
// generación (mismo criterio "no bloqueante" del resto de esta función).
async function compilarContenidoCarpeta(carpetaId, projectId, { getRows, runSql }) {
  const anexos = await getRows(
    `SELECT id, nombre_archivo, ruta_storage, descripcion, texto, link,
            link_texto_cache, link_cache_de, archivo_texto_cache, archivo_cache_de
     FROM project_anexos WHERE carpeta_id = ? AND project_id = ?`,
    [carpetaId, projectId]
  );
  if (!anexos.length) return { anexos: [], contenido: '' };

  const bloques = [];
  for (const a of anexos) {
    const partes = [];
    if (a.descripcion?.trim()) partes.push(a.descripcion.trim());
    if (a.texto?.trim()) partes.push(a.texto.trim());

    let nuevoLinkCache, nuevoLinkCacheDe;       // undefined = no tocar esa columna al persistir
    let nuevoArchivoCache, nuevoArchivoCacheDe;

    if (a.link?.trim()) {
      const linkTrim = a.link.trim();
      const linkCacheVigente = a.link_cache_de === linkTrim && a.link_texto_cache != null;
      if (esDominioProtegido(linkTrim)) {
        // Fail-fast — no se intenta el fetch. Si este mismo anexo también
        // tiene texto/descripción, ya se agregaron arriba (líneas 179-180)
        // y no se pierden por esta alerta — solo se advierte sobre el link.
        partes.push(`Fuente: ${linkTrim} — [ALERTA DE SISTEMA]: Se detectó un enlace a un motor de IA protegido. El contenido no pudo ser extraído automáticamente. Acción requerida: exportar la investigación a PDF/TXT y subirla como Anexo, o pegar el texto directo.`);
      } else if (linkCacheVigente) {
        partes.push(a.link_texto_cache
          ? `Contenido de ${linkTrim}:\n${a.link_texto_cache}`
          : `Fuente: ${linkTrim} — [Contenido inaccesible por seguridad de la página fuente]`);
      } else {
        const textoLink = await extraerTextoDeLink(linkTrim);
        nuevoLinkCache = textoLink; // string vacío también se cachea: evita reintentar un link que ya se probó y falló
        nuevoLinkCacheDe = linkTrim;
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
      const archivoCacheVigente = a.archivo_cache_de === a.ruta_storage && a.archivo_texto_cache != null;
      if (archivoCacheVigente) {
        if (a.archivo_texto_cache.trim()) partes.push(a.archivo_texto_cache.trim());
      } else {
        try {
          const { data, error } = await supabaseStorage.storage.from(ANEXOS_BUCKET).download(a.ruta_storage);
          if (!error && data) {
            const buffer = Buffer.from(await data.arrayBuffer());
            const texto = await convertBufferToMarkdown(buffer, safeExt(a.nombre_archivo));
            nuevoArchivoCache = texto?.trim() || '';
            nuevoArchivoCacheDe = a.ruta_storage;
            if (nuevoArchivoCache) partes.push(nuevoArchivoCache);
          }
        } catch (e) {
          // No bloqueante — un archivo que no se puede leer no debe tumbar la
          // generación completa. Se sigue con el resto de anexos.
          logger.warn?.('[EntradaIA] No se pudo extraer texto de un anexo (se omite, no bloqueante)', { anexoId: a.id, err: e.message })
            ?? console.warn('[EntradaIA] No se pudo extraer texto de un anexo (se omite):', e.message);
        }
      }
    }

    if (runSql && (nuevoLinkCache !== undefined || nuevoArchivoCache !== undefined)) {
      const link_texto_cache    = nuevoLinkCache    !== undefined ? nuevoLinkCache    : a.link_texto_cache;
      const link_cache_de       = nuevoLinkCacheDe  !== undefined ? nuevoLinkCacheDe  : a.link_cache_de;
      const archivo_texto_cache = nuevoArchivoCache !== undefined ? nuevoArchivoCache : a.archivo_texto_cache;
      const archivo_cache_de    = nuevoArchivoCacheDe !== undefined ? nuevoArchivoCacheDe : a.archivo_cache_de;
      runSql(
        'UPDATE project_anexos SET link_texto_cache = ?, link_cache_de = ?, archivo_texto_cache = ?, archivo_cache_de = ? WHERE id = ?',
        [link_texto_cache, link_cache_de, archivo_texto_cache, archivo_cache_de, a.id]
      ).catch(e => console.warn('[EntradaIA] No se pudo guardar caché de extracción (se omite, no bloqueante):', e.message));
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

// EXTENSIÓN (2026-08-22, trazabilidad de fuentes): este prompt solo recibe
// contenido de `project_anexos` (carpeta Investigación) — el módulo
// Biblioteca Gubernamental (leyes/CONPES/DNP/normativas, tabla propia
// project_biblioteca) NO está conectado a este flujo. Si se quiere que
// Biblioteca también alimente "Contexto del Problema", es una conexión
// nueva de datos que debe pedirse explícitamente, no algo que este prompt
// ya cubra. Los datos de presupuesto/costos en COP los ingresa el usuario
// directamente en otros módulos (Presupuesto/APU) — no pasan por este
// prompt, por eso no necesitan la cita de fuente de la regla 7 de abajo.
function buildSystemPrompt(contenido) {
  return `Eres un asistente experto en formulación de proyectos de inversión/infraestructura en Colombia. Vas a leer material de investigación real (documentos, conversaciones de investigación con otras IAs, notas) que el usuario ya subió a la carpeta "Investigación" de su proyecto, y a partir de ESE contenido vas a completar la sección "Contexto del Problema" de un formulario de formulación de proyectos.

REGLAS INQUEBRANTABLES:
1. Lee y analiza CADA fuente del material de investigación a fondo, no solo la primera — si hay varias fuentes (por ejemplo, la misma investigación consultada con distintas IAs), sintetiza y cruza la información entre todas ellas: usa el dato más específico/cuantificado cuando varias fuentes coincidan, y complementa un campo con lo que aporte cada fuente si ninguna sola lo cubre completo.
2. Usa EXCLUSIVAMENTE información que puedas fundamentar en el material de investigación de abajo — NUNCA inventes cifras, ubicaciones ni datos que no estén respaldados por el texto. Si un campo crítico (ej. B. Línea Base Cuantificable, C. Meta Esperada) no se encuentra en el material, responde exactamente "ND (No Disponible en la investigación)" en ese campo — nunca lo dejes vacío ni inventes un valor para rellenarlo.
3. Si una fuente aparece marcada como "[Contenido inaccesible por seguridad de la página fuente]" o "[ALERTA DE SISTEMA]", trátala como si no existiera para efectos de ese campo — NUNCA la uses como base ni la menciones en la respuesta, simplemente ignórala y sigue con las demás fuentes disponibles.
4. Toda cifra de presupuesto, costo o viabilidad financiera debe expresarse EXCLUSIVAMENTE en Pesos Colombianos (COP) — prohibido usar o mencionar dólares u otra divisa. Si el material fuente trae una cifra en otra moneda, conviértela a COP solo si el material mismo da la tasa de conversión; si no la da, márcala como "ND (No Disponible en la investigación)" en vez de asumir una tasa.
5. Tono "Arquitecto Constructor": técnico, breve, directo — cifras, unidades, plazos y lugares concretos. Cero introducciones, cero lenguaje comercial, cero explicaciones básicas de conceptos ya obvios para un formulador de proyectos.
6. Sé específico y sustancioso en cada campo (cifras, nombres de lugares, unidades, plazos) cuando el material los tenga — evita respuestas genéricas de una sola frase si el material soporta más detalle.
7. TRAZABILIDAD DE FUENTE: cada bloque del material de investigación de abajo empieza con un encabezado "### <nombre>" que identifica su origen exacto. Cuando un campo (A-G) se apoye en un dato específico de ese material, cierra el campo citando entre paréntesis el encabezado exacto de la fuente usada, ej: "(Fuente: investigacion Cantagallo GEMA)". Si el campo combina datos de varias fuentes, cita todas separadas por coma. Esta trazabilidad aplica SOLO a datos de investigación — nunca inventes una cita de fuente para un dato que no esté realmente respaldado en el material.
8. Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown, sin texto antes ni después — solo el JSON.

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

// REFACTOR (2026-08-19, pool de llaves; 2026-08-22, BYOK): withKeyRotation()
// prueba cada llave del pool DEL SERVIDOR; si `userGeminiKeys` llega con
// contenido (usuario no exento de BYOK, ver byokGate.js), se usa
// withUserKeyRotation() sobre SUS propias llaves en su lugar — nunca se
// mezclan los dos pools. Mismo contrato en ambos casos: siempre lanza
// EntradaIAError con status HTTP claro, nunca deja el formulario a medias,
// nunca degrada a un fallback fabricado si el pool (del servidor o del
// usuario) se agota.
async function llamarGemini(systemPrompt, orgId, userGeminiKeys) {
  const intentar = async (apiKey) => {
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

    if (upstream.status === 429) {
      // FIX (2026-08-24, "cuándo la cuota está al 100%"): antes se descartaba
      // el body real de Google en el 429 — Gemini normalmente incluye
      // retryDelay/quotaMetric en el detalle del error, información que
      // nunca llegaba ni a los logs. Se captura para poder responder con la
      // hora real de reset en vez de "en unos minutos" genérico, y se le
      // pasa a geminiCircuitBreaker.js (vía err.retryDelayMs) para que el
      // cooldown real (~45s en el free tier de RPM) reemplace el fijo de
      // 5 min cuando Google nos dice exactamente cuánto esperar.
      const cuerpo = await upstream.text().catch(() => '');
      logger.error('[EntradaIA] Gemini 429 — detalle real de cuota', { body: cuerpo.slice(0, 1000) });
      const err = new Error('Gemini 429 quota exceeded');
      const match = cuerpo.match(/retry in ([\d.]+)\s*s/i);
      if (match) err.retryDelayMs = Math.ceil(parseFloat(match[1]) * 1000) + 2000; // +2s de margen
      throw err;
    }
    if (!upstream.ok) {
      const cuerpo = await upstream.text().catch(() => '');
      logger.error('[EntradaIA] Fallo Gemini', { status: upstream.status, body: cuerpo.slice(0, 300) });
      throw new Error(`Gemini HTTP ${upstream.status}`);
    }

    const data = await upstream.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) throw new Error('Gemini sin contenido en la respuesta');
    return { texto, usage: data?.usage ?? {} };
  };

  try {
    const { texto, usage } = userGeminiKeys?.length
      ? await withUserKeyRotation(userGeminiKeys, intentar)
      : await withKeyRotation(intentar);

    logTokenUsage({
      userId: orgId, agentName: 'entrada-ia',
      tokensInput: usage?.prompt_tokens ?? 0,
      tokensOutput: usage?.completion_tokens ?? 0,
    }).catch(() => {});
    return texto;
  } catch (err) {
    if (err instanceof EntradaIAError) throw err;
    if (err instanceof UserKeyPoolExhaustedError) throw new EntradaIAError(err.message, 429);
    if (err instanceof GeminiPoolExhaustedError) throw new EntradaIAError('El límite de uso de IA está agotado por ahora — intenta de nuevo en unos minutos, o llena el formulario manualmente.', 429, err.retryAt);
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
export async function generarEntradaDesdeInvestigacion(projectId, orgId, { getRow, getRows, runSql, userGeminiKeys }) {
  if (mockAiActivo()) {
    logMock('generarEntradaDesdeInvestigacion');
    return Object.fromEntries(CAMPOS_CONTEXTO.map(id => [id, `[MOCK] Texto de prueba para "${id}" — MOCK_AI activo, sin llamada real a Gemini.`]));
  }
  const carpeta = await buscarCarpetaInvestigacion(projectId, { getRows });
  if (!carpeta) {
    throw new EntradaIAError('No se encontró una carpeta de Anexos llamada "Investigación" en este proyecto. Crea una carpeta con ese nombre en Anexos y sube ahí tu material antes de generar con IA.');
  }

  const { anexos, contenido } = await compilarContenidoCarpeta(carpeta.id, projectId, { getRows, runSql });
  if (!anexos.length) {
    throw new EntradaIAError(`La carpeta "${carpeta.nombre}" está vacía — agrega documentos o notas en Anexos antes de generar con IA.`);
  }
  if (!contenido.trim()) {
    throw new EntradaIAError(`Los documentos de la carpeta "${carpeta.nombre}" no tienen contenido legible (¿son solo imágenes o archivos vacíos?) — agrega texto/descripción a los anexos o sube un documento de texto.`);
  }

  const systemPrompt = buildSystemPrompt(contenido);
  const textoRespuesta = await llamarGemini(systemPrompt, orgId, userGeminiKeys);
  const raw = parseJsonRespuesta(textoRespuesta);
  return sanitizarRespuesta(raw);
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN POR CAMPO INDIVIDUAL (2026-08-22, refactor "botón ✨ por campo")
// Reemplaza en la UI al botón global de arriba (que sigue existiendo aquí sin
// tocar, por si algún consumidor futuro lo necesita) — cada campo A,B,D,E,F,G
// se genera por separado, con contexto explícito de lo ya escrito antes y de
// la demografía de la Sección 06. El campo C ("meta") queda FUERA de este
// flujo — se reemplaza por 4 sub-campos (problemática/déficit/beneficiarios/
// %) con su propio endpoint, ver generarProblematicasTerritorio() abajo.
// ═══════════════════════════════════════════════════════════════════════════

// Mismos 7 ids que CAMPOS_CONTEXTO menos 'meta' — deliberadamente una
// constante separada (no se toca CAMPOS_CONTEXTO/buildSystemPrompt/
// generarEntradaDesdeInvestigacion de arriba, que siguen sirviendo al
// endpoint bulk legacy tal cual). Debe mantenerse sincronizada a mano con
// CONTEXTO_CAMPOS de EntradaPage.tsx (frontend) — ver comentario ahí.
export const CAMPOS_INDIVIDUALES = ['situacion_actual', 'linea_base', 'justificacion', 'sociocultural', 'problema_urgente', 'incertidumbre'];

const LABEL_CAMPO_INDIVIDUAL = {
  situacion_actual:  'A. SITUACIÓN ACTUAL SIN PROYECTO',
  linea_base:        'B. INDICADOR DE LÍNEA BASE CUANTIFICABLE',
  justificacion:     'D. JUSTIFICACIÓN DE PRIORIDAD',
  sociocultural:     'E. ANÁLISIS SOCIOCULTURAL PARA LA PERTINENCIA',
  problema_urgente:  'F. ¿QUÉ PROBLEMA PERCIBE COMO MÁS URGENTE?',
  incertidumbre:     'G. CONDICIÓN CRÍTICA DE INCERTIDUMBRE LOGÍSTICA',
};

function buildSystemPromptCampoIndividual(campoId, contenido, demografia, contextoPrevio) {
  const bloqueDemografia = (demografia?.beneficiarios || demografia?.cobertura || demografia?.tipoFormulacion)
    ? `\n\nDATOS DEMOGRÁFICOS DEL PROYECTO (Sección 06, ya ingresados por el usuario):\nBeneficiarios: ${demografia?.beneficiarios || 'ND (No Disponible en la investigación)'}\nCobertura geográfica: ${demografia?.cobertura || 'ND (No Disponible en la investigación)'}${demografia?.tipoFormulacion ? `\nModalidad de formulación (Campo C): ${demografia.tipoFormulacion} — ajusta el enfoque narrativo a esta modalidad (ej. "Prueba Piloto" implica alcance/escala reducidos con fines de validación; "Formulado por Etapas" implica continuidad y fases futuras; "Proyecto Integral (100%)" implica cobertura total del déficit identificado en el Campo C)` : ''}`
    : '';
  const previos = Object.entries(contextoPrevio || {}).filter(([, v]) => v?.trim() && v !== ALERTA_ND_BACKEND);
  const bloquePrevios = previos.length
    ? `\n\nCAMPOS DEL "CONTEXTO DEL PROBLEMA" YA ESCRITOS POR EL USUARIO EN PASOS ANTERIORES (mantén coherencia narrativa con esto, no lo contradigas):\n${previos.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  return `Eres un asistente experto en formulación de proyectos de inversión/infraestructura en Colombia bajo metodología MGA. Vas a completar ÚNICAMENTE el campo "${LABEL_CAMPO_INDIVIDUAL[campoId]}" de la sección "Contexto del Problema" de un formulario de formulación de proyectos, a partir del material de investigación real del proyecto.

REGLAS INQUEBRANTABLES:
1. Usa EXCLUSIVAMENTE información que puedas fundamentar en el material de investigación de abajo (y en los campos ya escritos, si los hay) — NUNCA inventes cifras, ubicaciones ni datos que no estén respaldados por el texto. Si el material no trae dato suficiente para este campo, responde exactamente "ND (No Disponible en la investigación)" — nunca inventes un valor para rellenarlo.
2. Si una fuente aparece marcada como "[Contenido inaccesible por seguridad de la página fuente]" o "[ALERTA DE SISTEMA]", trátala como si no existiera — NUNCA la uses como base ni la menciones en la respuesta.
3. Toda cifra de presupuesto, costo o viabilidad financiera debe expresarse EXCLUSIVAMENTE en Pesos Colombianos (COP).
4. Tono "Arquitecto Constructor": técnico, breve, directo — cifras, unidades, plazos y lugares concretos. Cero introducciones, cero lenguaje comercial.
5. Responde ÚNICAMENTE con un objeto JSON válido de una sola clave, sin bloques de código markdown, sin texto antes ni después: {"valor": string}
${bloqueDemografia}${bloquePrevios}

MATERIAL DE INVESTIGACIÓN REAL DEL PROYECTO:
${contenido}`;
}

const ALERTA_ND_BACKEND = '⚠️ REQUERIDO: FALTA INFORMACIÓN EN ANEXOS'; // debe coincidir literal con ALERTA_ND de EntradaPage.tsx

/**
 * Genera UN solo campo (A,B,D,E,F o G) — botón ✨ individual. Mismo
 * contrato de errores que generarEntradaDesdeInvestigacion (EntradaIAError
 * con status claro, nunca fabrica datos, nunca lanza algo sin manejar).
 */
export async function generarCampoIndividual(projectId, orgId, campoId, contextoPrevio, demografia, { getRows, runSql, userGeminiKeys }) {
  if (!CAMPOS_INDIVIDUALES.includes(campoId)) {
    throw new EntradaIAError(`Campo "${campoId}" no es válido para generación individual.`, 400);
  }
  if (mockAiActivo()) {
    logMock('generarCampoIndividual');
    return { valor: `[MOCK] Texto técnico de prueba para "${LABEL_CAMPO_INDIVIDUAL[campoId] || campoId}" — MOCK_AI activo, sin llamada real a Gemini.` };
  }
  const carpeta = await buscarCarpetaInvestigacion(projectId, { getRows });
  if (!carpeta) {
    throw new EntradaIAError('No se encontró una carpeta de Anexos llamada "Investigación" en este proyecto. Crea una carpeta con ese nombre en Anexos y sube ahí tu material antes de generar con IA.');
  }
  const { anexos, contenido } = await compilarContenidoCarpeta(carpeta.id, projectId, { getRows, runSql });
  if (!anexos.length) {
    throw new EntradaIAError(`La carpeta "${carpeta.nombre}" está vacía — agrega documentos o notas en Anexos antes de generar con IA.`);
  }
  if (!contenido.trim()) {
    throw new EntradaIAError(`Los documentos de la carpeta "${carpeta.nombre}" no tienen contenido legible — agrega texto/descripción a los anexos o sube un documento de texto.`);
  }

  const systemPrompt = buildSystemPromptCampoIndividual(campoId, contenido, demografia, contextoPrevio);
  const textoRespuesta = await llamarGemini(systemPrompt, orgId, userGeminiKeys);
  const raw = parseJsonRespuesta(textoRespuesta);
  return { valor: txt(raw?.valor) };
}

// ═══════════════════════════════════════════════════════════════════════════
// C1: LISTA DE PROBLEMÁTICAS + DÉFICIT (Campo C rediseñado en 4 sub-campos)
// Esquema de ARRAY, distinto del Record<string,string> plano de arriba —
// por eso es un endpoint/función separada, no una rama del mismo parser.
// deficit_valor es number|null — null es OBLIGATORIO (nunca 0 ni un número
// inventado) cuando el material no trae una cifra real de déficit para esa
// problemática. C4 (% = beneficiarios/déficit) se calcula 100% en el
// frontend, en JS puro, nunca aquí — cero IA en el cálculo matemático.
// ═══════════════════════════════════════════════════════════════════════════
function buildSystemPromptProblematicas(contenido, demografia) {
  const bloqueDemografia = (demografia?.beneficiarios || demografia?.cobertura)
    ? `\n\nDATOS DEMOGRÁFICOS DEL PROYECTO (Sección 06, ya ingresados por el usuario):\nBeneficiarios: ${demografia?.beneficiarios || 'ND'}\nCobertura geográfica: ${demografia?.cobertura || 'ND'}`
    : '';
  return `Eres un asistente experto en formulación de proyectos de inversión/infraestructura en Colombia bajo metodología MGA. Vas a leer el material de investigación real del proyecto y extraer una LISTA de problemáticas territoriales distintas y concretas que el material describa (ej. "80% sin acceso a agua potable", "déficit de 45 viviendas rurales sin saneamiento") — no una sola frase genérica.

REGLAS INQUEBRANTABLES:
1. Cada problemática debe estar fundamentada en el material de investigación de abajo — NUNCA inventes una problemática que el texto no describa.
2. Para cada problemática, busca en el material una cifra REAL de déficit total (número de usuarios/viviendas/hectáreas/unidades afectadas, etc.). Si el material trae esa cifra, repórtala en "deficit_valor" (número) y "deficit_unidad" — usa SIEMPRE una unidad de medida válida en Planes de Desarrollo/metodología MGA (ej. "usuarios", "viviendas", "hectáreas", "kilómetros", "metros cuadrados", "unidades"); "familias" NO es una unidad de medida válida en este contexto — si el material cuantifica por hogares/familias, repórtalo en "usuarios" (usando el tamaño promedio de hogar si el material lo indica, o el propio conteo de hogares como "viviendas" si no hay forma de convertir a usuarios). Si el material NO trae una cifra cuantificada de déficit para esa problemática específica, "deficit_valor" DEBE ser JSON null (nunca 0, nunca un número aproximado o inventado, nunca un string) y "deficit_unidad" también null.
3. Si una fuente aparece marcada como "[Contenido inaccesible por seguridad de la página fuente]" o "[ALERTA DE SISTEMA]", ignórala por completo.
4. Si el material no describe ninguna problemática territorial identificable, responde con un array vacío — nunca inventes una problemática de relleno.
5. Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown, sin texto antes ni después:
{"problematicas": [{"problema": string, "deficit_valor": number|null, "deficit_unidad": string|null}]}
${bloqueDemografia}

MATERIAL DE INVESTIGACIÓN REAL DEL PROYECTO:
${contenido}`;
}

function sanitizarRespuestaProblematicas(raw) {
  const lista = Array.isArray(raw?.problematicas) ? raw.problematicas : [];
  return lista.slice(0, 15).map(p => {
    const valorNum = typeof p?.deficit_valor === 'number' && Number.isFinite(p.deficit_valor) ? p.deficit_valor : null;
    return {
      problema: txt(p?.problema, 300),
      deficit_valor: valorNum,
      deficit_unidad: valorNum !== null ? txt(p?.deficit_unidad, 60) : null,
    };
  }).filter(p => p.problema);
}

export async function generarProblematicasTerritorio(projectId, orgId, demografia, { getRows, runSql, userGeminiKeys }) {
  if (mockAiActivo()) {
    logMock('generarProblematicasTerritorio');
    // Incluye a propósito una fila con deficit_valor:null — deja probar
    // también la rama "N/D" de calcularPorcentajeC4() en el frontend, no
    // solo el camino feliz con número real.
    return {
      problematicas: [
        // FIX (2026-08-24, reportado con captura): 'familias' no es una unidad
        // de medida válida en Planes de Desarrollo/metodología MGA — la
        // unidad correcta exigida por el usuario es 'usuarios' (mismo
        // criterio ahora exigido al prompt real, ver
        // buildSystemPromptProblematicas arriba).
        { problema: '[MOCK] Déficit de acceso a agua potable', deficit_valor: 320, deficit_unidad: 'usuarios' },
        { problema: '[MOCK] Déficit de infraestructura educativa', deficit_valor: 4, deficit_unidad: 'aulas' },
        { problema: '[MOCK] Sin déficit cuantificado en el material (ND real)', deficit_valor: null, deficit_unidad: null },
      ],
    };
  }
  const carpeta = await buscarCarpetaInvestigacion(projectId, { getRows });
  if (!carpeta) {
    throw new EntradaIAError('No se encontró una carpeta de Anexos llamada "Investigación" en este proyecto. Crea una carpeta con ese nombre en Anexos y sube ahí tu material antes de generar con IA.');
  }
  const { anexos, contenido } = await compilarContenidoCarpeta(carpeta.id, projectId, { getRows, runSql });
  if (!anexos.length) {
    throw new EntradaIAError(`La carpeta "${carpeta.nombre}" está vacía — agrega documentos o notas en Anexos antes de generar con IA.`);
  }
  if (!contenido.trim()) {
    throw new EntradaIAError(`Los documentos de la carpeta "${carpeta.nombre}" no tienen contenido legible — agrega texto/descripción a los anexos o sube un documento de texto.`);
  }

  const systemPrompt = buildSystemPromptProblematicas(contenido, demografia);
  const textoRespuesta = await llamarGemini(systemPrompt, orgId, userGeminiKeys);
  const raw = parseJsonRespuesta(textoRespuesta);
  return { problematicas: sanitizarRespuestaProblematicas(raw) };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECCIÓN 11: "SOLUCIONES CON AI" — 9 propuestas candidatas (la 10ª la
// escribe el usuario a mano en el frontend, esta función nunca la toca).
// Mismo patrón que generarProblematicasTerritorio (devuelve un ARRAY, por
// eso es hermana de esa función y no de generarCampoIndividual, que devuelve
// un string único). Igual que las problemáticas: si el material real no
// sustenta 9 soluciones distintas, la regla anti-alucinación exige devolver
// MENOS — nunca rellenar con una solución inventada para completar el conteo.
// ═══════════════════════════════════════════════════════════════════════════
function buildSystemPromptSoluciones(contenido, contextoPrevio, demografia) {
  const bloqueDemografia = (demografia?.beneficiarios || demografia?.cobertura || demografia?.tipoFormulacion)
    ? `\n\nDATOS DEMOGRÁFICOS DEL PROYECTO (Sección 06, ya ingresados por el usuario):\nBeneficiarios: ${demografia?.beneficiarios || 'ND'}\nCobertura geográfica: ${demografia?.cobertura || 'ND'}${demografia?.tipoFormulacion ? `\nModalidad de formulación (Campo C): ${demografia.tipoFormulacion}` : ''}`
    : '';
  const previos = Object.entries(contextoPrevio || {}).filter(([, v]) => v?.trim() && v !== ALERTA_ND_BACKEND);
  const bloquePrevios = previos.length
    ? `\n\nCAMPOS DEL "CONTEXTO DEL PROBLEMA" YA ESCRITOS POR EL USUARIO (las soluciones deben ser coherentes con esto, no contradecirlo):\n${previos.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  return `Eres un asistente experto en formulación de proyectos de inversión/infraestructura en Colombia bajo metodología MGA. Vas a proponer POSIBLES SOLUCIONES técnicas concretas para el problema descrito en el material de investigación y en el contexto ya escrito por el usuario — cada solución es una alternativa de intervención completa (ej. "Construcción de sistema de acueducto veredal con tanque elevado y red de distribución para 320 familias"), no una frase genérica ni un objetivo.

REGLAS INQUEBRANTABLES:
1. Cada solución debe estar fundamentada en el material de investigación y en los campos ya escritos por el usuario (situación actual, línea base, meta esperada, justificación) — NUNCA inventes una solución que no tenga respaldo en ese contenido real.
2. Las soluciones deben ser técnicamente distintas entre sí (alcances, tecnologías o estrategias de intervención diferentes) — nunca repitas la misma idea con otras palabras para rellenar.
3. Ajusta cada solución a la realidad y proyecciones del proyecto: coherente con los beneficiarios, la cobertura geográfica y la modalidad de formulación (Proyecto Integral / Prueba Piloto / Formulado por Etapas) ya definidos, cuando estén disponibles.
4. Si una fuente aparece marcada como "[Contenido inaccesible por seguridad de la página fuente]" o "[ALERTA DE SISTEMA]", ignórala por completo.
5. Toda cifra de presupuesto, costo o viabilidad financiera debe expresarse EXCLUSIVAMENTE en Pesos Colombianos (COP).
6. Tono "Arquitecto Constructor": técnico, breve, directo — cifras, unidades, plazos y lugares concretos cuando el material los provea. Cero introducciones, cero lenguaje comercial.
7. Propón HASTA 9 soluciones. Si el material real no sustenta 9 alternativas técnicamente distintas, devuelve MENOS — nunca inventes una solución de relleno para completar el conteo.
8. Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown, sin texto antes ni después:
{"soluciones": [string]}
${bloqueDemografia}${bloquePrevios}

MATERIAL DE INVESTIGACIÓN REAL DEL PROYECTO:
${contenido}`;
}

function sanitizarRespuestaSoluciones(raw) {
  const lista = Array.isArray(raw?.soluciones) ? raw.soluciones : [];
  return lista.slice(0, 9).map(s => txt(s, 1500)).filter(Boolean);
}

/**
 * Genera hasta 9 posibles soluciones (botón "Soluciones con AI", Sección 11)
 * — la 10ª propuesta es manual, este servicio nunca la genera ni la toca.
 * Mismo contrato de errores que generarProblematicasTerritorio.
 */
export async function generarPosiblesSoluciones(projectId, orgId, contextoPrevio, demografia, { getRows, runSql, userGeminiKeys }) {
  if (mockAiActivo()) {
    logMock('generarPosiblesSoluciones');
    // Las 9 completas a propósito (a diferencia de generarProblematicasTerritorio,
    // que sí puede devolver menos por diseño): esto es un fixture fijo de
    // prueba, no una llamada real a Gemini — no hay contenido real que pueda
    // sustentar "menos de 9", así que debe mostrar siempre el máximo para que
    // MOCK_AI ejercite el mismo layout de 9+1 que vería el usuario en producción.
    return {
      soluciones: [
        '[MOCK] Construcción de sistema de acueducto veredal con tanque elevado y red de distribución para las familias afectadas.',
        '[MOCK] Perforación de pozo profundo comunitario con planta de tratamiento compacta y puntos de abastecimiento distribuidos.',
        '[MOCK] Sistema de captación y potabilización de agua lluvia a nivel de vivienda con tanques certificados y filtros.',
        '[MOCK] Optimización y ampliación de la red de acueducto existente con macromedición y reducción de pérdidas.',
        '[MOCK] Convenio interinstitucional con la empresa de acueducto regional para extensión de cobertura veredal.',
        '[MOCK] Plantas de tratamiento compactas por sectores (potabilización descentralizada) con operación comunitaria.',
        '[MOCK] Sistema de pozos profundos individuales por vivienda con filtro certificado, para zonas de vivienda dispersa.',
        '[MOCK] Alianza público-privada para construcción de acueducto multiveredal con esquema tarifario diferencial.',
        '[MOCK] Programa de cosecha de agua lluvia a escala comunitaria con tanque de almacenamiento colectivo y red de reparto.',
      ],
    };
  }
  const carpeta = await buscarCarpetaInvestigacion(projectId, { getRows });
  if (!carpeta) {
    throw new EntradaIAError('No se encontró una carpeta de Anexos llamada "Investigación" en este proyecto. Crea una carpeta con ese nombre en Anexos y sube ahí tu material antes de generar con IA.');
  }
  const { anexos, contenido } = await compilarContenidoCarpeta(carpeta.id, projectId, { getRows, runSql });
  if (!anexos.length) {
    throw new EntradaIAError(`La carpeta "${carpeta.nombre}" está vacía — agrega documentos o notas en Anexos antes de generar con IA.`);
  }
  if (!contenido.trim()) {
    throw new EntradaIAError(`Los documentos de la carpeta "${carpeta.nombre}" no tienen contenido legible — agrega texto/descripción a los anexos o sube un documento de texto.`);
  }

  const systemPrompt = buildSystemPromptSoluciones(contenido, contextoPrevio, demografia);
  const textoRespuesta = await llamarGemini(systemPrompt, orgId, userGeminiKeys);
  const raw = parseJsonRespuesta(textoRespuesta);
  return { soluciones: sanitizarRespuestaSoluciones(raw) };
}

// ═══════════════════════════════════════════════════════════════════════════
// "NOMBRE DEL PROYECTO CON AI" (mandato 2026-08-24) — a diferencia de las 3
// funciones de arriba, NO lee la carpeta "Investigación" de Anexos: usa lo
// que el usuario YA escribió en Entrada (situación actual, problemática,
// déficit, beneficiarios — el frontend ya los tiene en memoria, se los manda
// tal cual) más 2 fuentes server-side que Entrada no conoce:
//   - motor_dialectico (tono/interlocutor/enfoque/humanizacion/lista_oro/
//     lista_negra) — pedido explícito: "que se ajuste a la configuración de
//     dialéctica para que todo sea el mismo lenguaje".
//   - calcularScoringDinamico — pedido explícito: "teniendo en cuenta... la
//     evaluación de impacto integral".
// Ninguna de las dos bloquea si el proyecto todavía no las tiene (proyecto
// nuevo) — se degradan a "sin datos todavía", igual que ya hace
// scoringDinamico.js con cada dimensión pendiente. Lo que SÍ bloquea (regla
// anti-alucinación, mismo criterio que las 3 funciones de arriba): sin
// situación actual NI problemática seleccionada, no hay ninguna base real
// sobre la cual generar un nombre — nunca se fabrica uno de la nada.
// ═══════════════════════════════════════════════════════════════════════════
function safeParseArrayNombre(raw) {
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
}

// Bloques de contexto compartidos entre Nombre y Pitch (mismas 5 fuentes,
// mismo formato) — extraído para que un ajuste futuro (ej. cuántos items de
// lista de oro se mandan) se haga en un solo lugar, no en dos prompts que
// podrían desalinearse con el tiempo.
function buildBloquesComunes(contextoPrevio, problematica, demografia, dialectica, scoring) {
  const bloqueProblematica = problematica?.problema
    ? `\n\nPROBLEMÁTICA SELECCIONADA POR EL USUARIO (Campo C):\n- ${problematica.problema}${problematica.deficit_valor != null ? ` — Déficit: ${problematica.deficit_valor} ${problematica.deficit_unidad || ''}`.trim() : ''}`
    : '';
  const bloqueDemografia = (demografia?.beneficiarios || demografia?.cobertura)
    ? `\n\nDATOS DEMOGRÁFICOS (Sección 06, ya ingresados):\nBeneficiarios directos: ${demografia?.beneficiarios || 'ND'}\nCobertura geográfica: ${demografia?.cobertura || 'ND'}${demografia?.tipoFormulacion ? `\nModalidad: ${demografia.tipoFormulacion}` : ''}`
    : '';
  const previos = Object.entries(contextoPrevio || {}).filter(([, v]) => v?.trim() && v !== ALERTA_ND_BACKEND);
  const bloquePrevios = previos.length
    ? `\n\nCAMPOS DEL "CONTEXTO DEL PROBLEMA" YA ESCRITOS POR EL USUARIO:\n${previos.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  let bloqueDialectica = '';
  if (dialectica) {
    const oro = safeParseArrayNombre(dialectica.lista_oro).flatMap(g => g.items || []);
    const negra = safeParseArrayNombre(dialectica.lista_negra).flatMap(g => g.items || []);
    bloqueDialectica = `\n\nCONFIGURACIÓN DEL MOTOR DIALÉCTICO (Sección 03 — debe hablar EXACTAMENTE el mismo idioma que el resto del proyecto):
Tono: ${dialectica.tono || 'ND'}
Interlocutor: ${dialectica.interlocutor || 'ND'}
Enfoque: ${dialectica.enfoque || 'ND'}
Humanización: ${dialectica.humanizacion || 'ND'}
${oro.length ? `Palabras/enfoques a FAVORECER (lista de oro): ${oro.slice(0, 15).join(', ')}` : ''}
${negra.length ? `Palabras/enfoques PROHIBIDOS (lista negra — nunca usar este lenguaje): ${negra.slice(0, 15).join(', ')}` : ''}`;
  }

  let bloqueImpacto = '';
  if (scoring?.dimensiones) {
    const activas = Object.entries(scoring.dimensiones)
      .filter(([, d]) => !d.pendiente && typeof d.score === 'number')
      .map(([k, d]) => `${k}: ${d.score}/100`);
    if (activas.length) bloqueImpacto = `\n\nEVALUACIÓN DE IMPACTO INTEGRAL ya calculada (dimensiones con datos reales — refleja las fortalezas reales del proyecto, úsalas para reforzar si aplica naturalmente):\n${activas.join(', ')}`;
  }

  return `${bloqueProblematica}${bloqueDemografia}${bloquePrevios}${bloqueDialectica}${bloqueImpacto}`;
}

function buildSystemPromptNombre(contextoPrevio, problematica, demografia, dialectica, scoring) {
  const bloquesComunes = buildBloquesComunes(contextoPrevio, problematica, demografia, dialectica, scoring);

  return `Eres un experto en formulación de proyectos de inversión pública en Colombia (metodología MGA) y en comunicación para financiadores internacionales (banca multilateral, cooperación internacional, fondos de regalías). Vas a proponer el NOMBRE OFICIAL de un proyecto real de inversión — el título que aparecerá en la portada del documento y que un evaluador debe poder leer una sola vez y entender de inmediato QUÉ se va a hacer, PARA QUIÉN y CON QUÉ ALCANCE, sintiendo que vale la pena aprobarlo.

REGLAS INQUEBRANTABLES:
1. Usa EXCLUSIVAMENTE la información real suministrada abajo — nunca inventes ubicación, sector, cifra, tecnología o alcance que no esté mencionado explícitamente en el material.
2. Si hay "Palabras/enfoques PROHIBIDOS" (lista negra), el nombre NUNCA puede usar ese lenguaje ni ese enfoque, bajo ninguna circunstancia.
3. Si hay "Palabras/enfoques a FAVORECER" (lista de oro), úsalos cuando encajen de forma natural con la información real — nunca los fuerces si no aplican.
4. Prohibido el lenguaje de relleno sin sustento ("innovador", "transformador", "de clase mundial", "garantizado", "impacto significativo") salvo que un dato real del material lo sustente directamente.
5. Cuando el material lo permita, integra en el nombre: tipo de intervención + población/ubicación objetivo + escala (beneficiarios y/o déficit) — eso es lo que distingue un nombre real de uno genérico.
6. Máximo 15 palabras. Una sola frase, sin subtítulo, sin comillas, sin punto final.
7. Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown, sin texto antes ni después:
{"nombre": string}
${bloquesComunes}`;
}

/**
 * Genera el nombre real del proyecto (botón "Generar con IA" junto al campo
 * "Nombre del Proyecto") — combina Diálectica (tono/lista de oro/lista
 * negra), Evaluación de Impacto Integral y lo ya escrito en Entrada. Mismo
 * contrato de errores que el resto de este archivo.
 */
export async function generarNombreProyecto(projectId, orgId, { contextoPrevio, problematica, demografia }, { getRow, getRows, userGeminiKeys }) {
  if (mockAiActivo()) {
    logMock('generarNombreProyecto');
    return { nombre: '[MOCK] Fortalecimiento del acceso a agua potable y saneamiento básico rural — Cantagallo, Bolívar (320 usuarios)' };
  }

  // Regla anti-alucinación: sin situación actual NI problemática, no hay
  // ninguna base real sobre la cual generar un nombre.
  const situacionActual = contextoPrevio?.situacion_actual;
  const tieneSituacion = !!(situacionActual?.trim() && situacionActual !== ALERTA_ND_BACKEND);
  const tieneProblematica = !!problematica?.problema?.trim();
  if (!tieneSituacion && !tieneProblematica) {
    throw new EntradaIAError('Completa la Situación Actual (Campo A) o selecciona una Problemática (Campo C) antes de generar el nombre con IA.');
  }

  // Diálectica e Impacto son enriquecimiento opcional — nunca bloquean si el
  // proyecto todavía no los tiene (proyecto nuevo).
  const [dialectica, scoring] = await Promise.all([
    getRow('SELECT tono, interlocutor, enfoque, humanizacion, lista_oro, lista_negra FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?', [projectId, orgId]).catch(() => null),
    calcularScoringDinamico(projectId, { getRow, getRows }).catch(() => null),
  ]);

  const systemPrompt = buildSystemPromptNombre(contextoPrevio, problematica, demografia, dialectica, scoring);
  const textoRespuesta = await llamarGemini(systemPrompt, orgId, userGeminiKeys);
  const raw = parseJsonRespuesta(textoRespuesta);
  const nombre = txt(raw?.nombre, 300);
  if (!nombre) throw new EntradaIAError('La IA no devolvió un nombre válido — intenta de nuevo.', 502);
  return { nombre };
}

// ═══════════════════════════════════════════════════════════════════════════
// "PITCH DEL PROYECTO CON AI" (mandato 2026-08-24, campo nuevo debajo de
// Nombre del Proyecto) — mismas 5 fuentes de contexto que generarNombreProyecto
// (comparten buildBloquesComunes), pero el propósito es distinto: el nombre
// es un TÍTULO corto, el pitch es un párrafo persuasivo "robusto, integral,
// que impacte y hagan que deseen aprobarlo" — mismo guard anti-alucinación
// que el nombre (situación actual o problemática con contenido real), a
// propósito sin exigir más: el pitch usa exactamente los mismos datos ya
// disponibles para generar el nombre, exigirle más rompería esa simetría.
// ═══════════════════════════════════════════════════════════════════════════
function buildSystemPromptPitch(contextoPrevio, problematica, demografia, dialectica, scoring) {
  const bloquesComunes = buildBloquesComunes(contextoPrevio, problematica, demografia, dialectica, scoring);

  return `Eres un experto en formulación de proyectos de inversión pública en Colombia (metodología MGA) y en comunicación para financiadores internacionales (banca multilateral, cooperación internacional, fondos de regalías). Vas a redactar el PITCH del proyecto — el párrafo de presentación que un evaluador lee justo después del nombre, y que debe generar el entusiasmo suficiente para que quiera seguir leyendo y aprobarlo.

REGLAS INQUEBRANTABLES:
1. Usa EXCLUSIVAMENTE la información real suministrada abajo — nunca inventes ubicación, sector, cifra, tecnología o alcance que no esté mencionado explícitamente en el material.
2. Estructura narrativa obligatoria, en este orden: (a) el problema/déficit real con su cifra si existe, (b) la solución/intervención propuesta, (c) el alcance (beneficiarios + cobertura geográfica), (d) el impacto/resultado esperado que justifique la aprobación.
3. Si hay "Palabras/enfoques PROHIBIDOS" (lista negra), el pitch NUNCA puede usar ese lenguaje ni ese enfoque, bajo ninguna circunstancia.
4. Si hay "Palabras/enfoques a FAVORECER" (lista de oro), úsalos cuando encajen de forma natural con la información real — nunca los fuerces si no aplican.
5. Prohibido el lenguaje de relleno sin sustento ("innovador", "transformador", "de clase mundial", "garantizado", "impacto significativo") salvo que un dato real del material lo sustente directamente.
6. Extensión: 3 a 5 oraciones, 80 a 150 palabras. Un solo párrafo corrido — nunca una lista, nunca subtítulos, nunca viñetas.
7. Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown, sin texto antes ni después:
{"pitch": string}
${bloquesComunes}`;
}

/**
 * Genera el pitch del proyecto (botón "Generar con IA" junto al campo
 * "Pitch", debajo de Nombre del Proyecto) — mismas fuentes que
 * generarNombreProyecto, párrafo persuasivo en vez de título. Mismo
 * contrato de errores que el resto de este archivo.
 */
export async function generarPitchProyecto(projectId, orgId, { contextoPrevio, problematica, demografia }, { getRow, getRows, userGeminiKeys }) {
  if (mockAiActivo()) {
    logMock('generarPitchProyecto');
    return { pitch: '[MOCK] En la zona rural de Cantagallo, Bolívar, 320 usuarios carecen de acceso a agua potable segura. Este proyecto propone la construcción de un sistema de abastecimiento veredal que resuelve el déficit identificado, con cobertura directa sobre la población afectada. La intervención se ejecuta bajo un enfoque técnico verificable, alineado con los estándares de sostenibilidad ambiental y social exigidos por la metodología MGA, y sienta las bases para un impacto medible en la calidad de vida de la comunidad.' };
  }

  const situacionActual = contextoPrevio?.situacion_actual;
  const tieneSituacion = !!(situacionActual?.trim() && situacionActual !== ALERTA_ND_BACKEND);
  const tieneProblematica = !!problematica?.problema?.trim();
  if (!tieneSituacion && !tieneProblematica) {
    throw new EntradaIAError('Completa la Situación Actual (Campo A) o selecciona una Problemática (Campo C) antes de generar el pitch con IA.');
  }

  const [dialectica, scoring] = await Promise.all([
    getRow('SELECT tono, interlocutor, enfoque, humanizacion, lista_oro, lista_negra FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?', [projectId, orgId]).catch(() => null),
    calcularScoringDinamico(projectId, { getRow, getRows }).catch(() => null),
  ]);

  const systemPrompt = buildSystemPromptPitch(contextoPrevio, problematica, demografia, dialectica, scoring);
  const textoRespuesta = await llamarGemini(systemPrompt, orgId, userGeminiKeys);
  const raw = parseJsonRespuesta(textoRespuesta);
  const pitch = txt(raw?.pitch, 1200);
  if (!pitch) throw new EntradaIAError('La IA no devolvió un pitch válido — intenta de nuevo.', 502);
  return { pitch };
}
