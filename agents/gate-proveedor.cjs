// gate-proveedor.cjs — capa única de proveedor de IA (ADR-0004, 2026-10-08;
// contrato de errores, breakers y relojes heredados de ADR-0002). La usan el
// gate (002, subgates, 008 en CI) y la aplicación (LlmGateway: M1, AGT-052,
// health); ningún otro punto habla con un proveedor directamente.
//
// Proveedores: Claude (Anthropic) como primario obligatorio y Gemini (Google)
// como único respaldo. Ningún nombre de modelo está quemado en el código:
// se descubren en el endpoint de listado de cada proveedor y se eligen por
// gama y recencia según la tarea (PERFILES_TAREA, seleccionarModelos()).
// fetch nativo con streaming SSE para ambos — sin SDK, un solo patrón HTTP
// inyectable en pruebas (fetchImpl).
//
// Sin efectos secundarios al requerir: no lee .env (lo hace el llamador), no
// toca disco ni red hasta que se llama una función.

const fs = require('fs');
const path = require('path');

// URL base fijas, sin override por entorno (ADR-0004 §2.1): sin variable que
// las redirija no hay vector para mandar keys o diffs a un host falso.
const BASE_URLS = Object.freeze({
    anthropic: 'https://api.anthropic.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
});
const ANTHROPIC_VERSION = '2023-06-01';
// Orden = prioridad: Claude siempre primero, Gemini solo de respaldo.
const PROVEEDORES = Object.freeze(['anthropic', 'gemini']);
// Tres relojes independientes por intento (corrección 2026-09-26, auditoría
// del timeout_30s en vivo): el tope único de 30 s TOTALES con stream:false
// era aritméticamente incompatible con max_tokens 4096 (002) / 8192
// (subgates) — exigía >136 tokens/s sostenidos más el prefill de ~60 000
// caracteres de diff. Con streaming se separa "servidor colgado" (sin bytes)
// de "modelo generando despacio pero vivo":
//  - PRIMER_BYTE: cola + prefill del prompt antes de la primera respuesta.
//  - INACTIVIDAD: silencio entre fragmentos del stream (servidor colgado).
//  - TOTAL: techo duro por intento, configurable con GATE_TIMEOUT_TOTAL_MS.
// 120 s no alcanzó con un prompt de ~185 000 caracteres (3 intentos sin
// primer byte, 2026-09-26 22:56 UTC): la espera escala con el prefill.
const TIMEOUT_PRIMER_BYTE_MS = 300000;
const TIMEOUT_INACTIVIDAD_MS = 30000;
// Calibrado con la primera llamada real (2026-09-26 22:46 UTC):
// 21 642 prompt + 4 039 completion tokens en 224 s ≈ 18 tokens/s. Con
// max_tokens 8192 el peor caso es ~455 s + prefill → 600 s de techo.
const TIMEOUT_TOTAL_DEFAULT_MS = 600000;
const TIMEOUT_TOTAL_RANGO_MS = Object.freeze([30000, 900000]);
const TIMEOUT_MS = TIMEOUT_INACTIVIDAD_MS; // alias histórico (exportado)
const MAX_REINTENTOS = 2;
const BREAKER_DEFAULT = Object.freeze({
    estado: 'cerrado',
    fallos_consecutivos: 0,
    umbral: 3,
    abierto_desde: null,
    // Categoría que abrió el circuito — decide si circuito_abierto es
    // soft-fail o bloqueo duro. Nunca se degrada de crítica a no crítica
    // mientras siga abierto (hallazgo 008: un 503 concurrente pisaba un 403).
    categoria_apertura: null,
    cooldown_s: 900,
    ultimo_error: null,
    ultimo_exito: null,
});

// cuota/caida → elegibles para soft-fail (Axioma II.1, con opt-in y
// responsable). auth/politica → bloqueo duro + ALERTA CRÍTICA y abren el
// breaker de inmediato (reintentar una key revocada o un modelo retirado solo
// quema intentos). solicitud/config → bloqueo duro, no son del proveedor.
const CATEGORIAS_SOFT_FAIL = new Set(['cuota', 'caida']);
const CATEGORIAS_CRITICAS = new Set(['auth', 'politica']);

class ErrorProveedor extends Error {
    constructor({ codigo, categoria, http = null, detalle = '', request_id = null }) {
        super(`[${codigo}] ${detalle}`);
        this.name = 'ErrorProveedor';
        this.codigo = codigo;
        this.categoria = categoria;
        this.http = http;
        this.detalle = detalle;
        this.request_id = request_id;
    }
}

function esElegibleSoftFail(e) {
    return e instanceof ErrorProveedor && CATEGORIAS_SOFT_FAIL.has(e.categoria);
}

function esCritico(categoria) {
    return CATEGORIAS_CRITICAS.has(categoria);
}

// Nunca deja salir una key en un mensaje de error, log o telemetría (P6):
// redacta la key literal configurada y cualquier forma conocida de key.
function redactar(texto, key) {
    let t = String(texto ?? '');
    if (key && key.length >= 8) t = t.split(key).join('[REDACTED]');
    return t
        .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza[REDACTED]')
        .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED]');
}

// Campos estructurados del cuerpo de error, sin depender del texto humano.
// Formatos soportados: Anthropic {type:'error', error:{type,message}}, Google
// {error:{code,status,message,details:[{reason}]}}, OpenAI-compatible
// {error:{code,type,message}} y problem+json {status,title,detail,type}. `cuerpo` puede ser string (JSON o texto) u
// objeto ya parseado (SDK de Anthropic: e.error).
function extraerErrorEstructurado(cuerpo) {
    let obj = cuerpo;
    if (typeof cuerpo === 'string') {
        try { obj = JSON.parse(cuerpo); } catch { obj = null; }
    }
    if (!obj || typeof obj !== 'object') return { codes: [], texto: String(cuerpo ?? '') };
    const err = (obj.error && typeof obj.error === 'object') ? obj.error : obj;
    const razones = Array.isArray(err.details) ? err.details.map(d => d?.reason) : [];
    const codes = [err.code, err.type, err.status, ...razones, obj.code, obj.type !== 'error' ? obj.type : null]
        .filter(v => typeof v === 'string' && v.trim())
        .map(v => v.trim().toLowerCase());
    const texto = [err.message, obj.detail, obj.title, obj.message].filter(v => typeof v === 'string').join(' ');
    return { codes, texto };
}

const CODIGOS_CUOTA = new Set(['insufficient_quota', 'quota_exceeded', 'billing_error', 'billing_hard_limit_reached', 'credit_balance_too_low', 'payment_required', 'resource_exhausted', 'rate_limit_exceeded']);
// failed_precondition (Google): facturación no habilitada o región sin acceso
// a la API — no se resuelve reintentando: alerta crítica.
const CODIGOS_POLITICA = new Set(['model_not_found', 'not_found_error', 'model_not_available', 'model_deprecated', 'deprecated_model', 'not_found', 'failed_precondition']);
const CODIGOS_AUTH = new Set(['authentication_error', 'permission_error', 'invalid_api_key', 'unauthorized', 'forbidden', 'api_key_invalid', 'unauthenticated', 'permission_denied']);

// Orden de decisión (PMU Titán V2, 2026-09-26): 1) código HTTP, 2) campos
// estructurados del error, 3) regex sobre texto solo como fallback.
function clasificarHttp(status, cuerpo) {
    // 1) El código HTTP manda cuando es inequívoco.
    if (status === 401 || status === 403) return { codigo: `http_${status}_auth`, categoria: 'auth' };
    if (status === 402) return { codigo: 'http_402_sin_saldo', categoria: 'cuota' };
    if (status === 429) return { codigo: 'http_429_rate_limit', categoria: 'cuota' };
    if (status === 404) return { codigo: 'http_404_modelo_no_disponible', categoria: 'politica' };
    if (status === 529) return { codigo: 'http_529_sobrecargada', categoria: 'caida' };
    if (status >= 500) return { codigo: `http_${status}`, categoria: 'caida' };
    if (status !== 400) return { codigo: `http_${status}`, categoria: 'solicitud' };

    // 2) 400 ambiguo → campos estructurados del proveedor.
    const { codes, texto } = extraerErrorEstructurado(cuerpo);
    if (codes.some(c => CODIGOS_AUTH.has(c))) return { codigo: 'http_400_auth', categoria: 'auth' };
    if (codes.some(c => CODIGOS_CUOTA.has(c))) return { codigo: 'http_400_cuota', categoria: 'cuota' };
    if (codes.some(c => CODIGOS_POLITICA.has(c))) return { codigo: 'http_400_modelo_no_disponible', categoria: 'politica' };
    if (codes.includes('context_length_exceeded')) return { codigo: 'http_400', categoria: 'solicitud' };

    // 3) Fallback por texto — solo si lo estructurado no decidió. Estrecho a
    // propósito (hallazgo 008): "exceeded"/"limit" sueltos atrapaban
    // context_length_exceeded. `invalid_request_error` de Anthropic cae aquí
    // porque su "credit balance is too low" no trae código propio.
    const txt = texto || String(typeof cuerpo === 'string' ? cuerpo : '');
    if (/context[_ ]length|max[_ ]tokens|maximum context/i.test(txt)) return { codigo: 'http_400', categoria: 'solicitud' };
    if (/credit balance is too low/i.test(txt)) return { codigo: 'http_400_sin_saldo', categoria: 'cuota' };
    if (/insufficient[_ ]quota|quota[_ ]exceeded|exceeded (your |the )?quota|out of credits|insufficient (credits|balance|funds)/i.test(txt)) {
        return { codigo: 'http_400_cuota', categoria: 'cuota' };
    }
    if (/model[\s\S]{0,80}(not found|does not exist|not available|deprecated|retired|unsupported|unknown)/i.test(txt)) {
        return { codigo: 'http_400_modelo_no_disponible', categoria: 'politica' };
    }
    return { codigo: 'http_400', categoria: 'solicitud' };
}

function esReintentable(categoria, codigo) {
    // 429 (cuota por rate) sí se reintenta; 402/400 de saldo no — no se
    // recupera en segundos. timeout_total y timeout_sin_respuesta tampoco:
    // el mismo prompt contra el mismo modelo vuelve a agotar el plazo
    // (medido en vivo: 3 intentos sin primer byte = 366 s perdidos), y
    // reintentarlo triplica la espera sin cambiar el resultado.
    return (categoria === 'caida' && codigo !== 'timeout_total' && codigo !== 'timeout_sin_respuesta') || codigo === 'http_429_rate_limit';
}

// --- Circuit breaker (estado persistido, generado por código) --------------

function leerBreaker(ruta) {
    let b;
    try {
        b = { ...BREAKER_DEFAULT, ...JSON.parse(fs.readFileSync(ruta, 'utf8')) };
    } catch {
        return { ...BREAKER_DEFAULT };
    }
    // Formato previo a categoria_apertura (hallazgo N1b de 008): se infiere
    // del último error para no perder una apertura crítica ya persistida.
    if (b.estado !== 'cerrado' && !b.categoria_apertura) b.categoria_apertura = b.ultimo_error?.categoria || null;
    return b;
}

// Escritura atómica (tmp + rename): un lector concurrente nunca ve un JSON
// truncado que caería al default "cerrado" (hallazgo 008). No es un lock
// entre procesos — dos gates simultáneos pueden perder un incremento, nunca
// corromper el archivo.
function escribirBreaker(ruta, b) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    const tmp = `${ruta}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(b, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, ruta);
}

// Huella no reversible de la key (12 hex de sha256) — permite saber si la
// credencial cambió sin guardar la credencial. Nunca la key misma (P6).
function huellaKey(key) {
    return key ? require('crypto').createHash('sha256').update(key).digest('hex').slice(0, 12) : null;
}

// Decide si se puede tocar la red. Muta el estado abierto→semiabierto al
// vencer el cooldown, o antes si el breaker se abrió por auth y la key cambió
// desde entonces (rotar la credencial no debe esperar 15 min). El caller
// persiste.
function evaluarBreaker(b, ahoraMs, huellaActual = null) {
    if (b.estado === 'cerrado') return 'permitir';
    if (b.estado === 'semiabierto') return 'permitir_prueba';
    if (b.categoria_apertura === 'auth' && huellaActual && b.ultimo_error?.huella_key && b.ultimo_error.huella_key !== huellaActual) {
        b.estado = 'semiabierto';
        return 'permitir_prueba';
    }
    const desde = Date.parse(b.abierto_desde || '');
    if (!Number.isNaN(desde) && ahoraMs - desde >= b.cooldown_s * 1000) {
        b.estado = 'semiabierto';
        return 'permitir_prueba';
    }
    return 'rechazar';
}

function registrarExito(b, ahoraMs) {
    b.estado = 'cerrado';
    b.fallos_consecutivos = 0;
    b.abierto_desde = null;
    b.categoria_apertura = null;
    b.ultimo_error = null;
    b.ultimo_exito = new Date(ahoraMs).toISOString();
    return b;
}

function registrarFallo(b, err, ahoraMs, huella = null) {
    const ts = new Date(ahoraMs).toISOString();
    if (err.categoria === 'solicitud' || err.categoria === 'config') {
        // No es falla del proveedor: no cuenta ni abre, y no pisa el
        // ultimo_error de una apertura vigente.
        if (b.estado === 'cerrado') b.ultimo_error = { codigo: err.codigo, http: err.http, categoria: err.categoria, timestamp: ts, huella_key: huella };
        return b;
    }
    // Crítica mientras no haya un éxito (hallazgo N1 de 008): antes solo
    // contaba si el estado era 'abierto', así que una sonda semiabierta que
    // fallaba por 503/red olvidaba que la key era inválida → soft-fail. Solo
    // registrarExito() limpia categoria_apertura.
    // Excepción (auditoría 2026-09-26, reproducida en vivo): si la apertura
    // crítica fue de OTRA key (huella distinta), esa evidencia no aplica a la
    // key actual. Sin esto, la sonda con key rotada que fallaba por timeout
    // dejaba ultimo_error congelado en el 403 de la key vieja → el PMU
    // reportaba un 403 falso y evaluarBreaker() concedía una sonda nueva en
    // CADA llamada, sin cooldown (huella siempre distinta).
    const keyRotada = Boolean(huella && b.ultimo_error?.huella_key && b.ultimo_error.huella_key !== huella);
    const aperturaCritica = esCritico(b.categoria_apertura) && !keyRotada;
    if (!aperturaCritica || esCritico(err.categoria)) {
        b.ultimo_error = { codigo: err.codigo, http: err.http, categoria: err.categoria, timestamp: ts, huella_key: huella };
    }
    b.fallos_consecutivos += 1;
    if (esCritico(err.categoria) || b.estado === 'semiabierto' || b.fallos_consecutivos >= b.umbral) {
        if (!aperturaCritica || esCritico(err.categoria)) b.categoria_apertura = err.categoria;
        if (b.estado !== 'abierto' || esCritico(err.categoria)) b.abierto_desde = ts;
        b.estado = 'abierto';
    }
    return b;
}

// Alertas del PMU derivadas del breaker. Vacío = proveedor sano (última
// llamada exitosa o nunca falló).
// Vista pública del breaker para el PMU (versionado): sin huella_key.
function breakerPublico(b) {
    const { ultimo_error, ...resto } = b;
    if (!ultimo_error) return { ...resto, ultimo_error: null };
    const { huella_key, ...err } = ultimo_error;
    return { ...resto, ultimo_error: err };
}

function alertasDeProveedor(b, proveedor, modelo) {
    if (!b.ultimo_error && b.estado === 'cerrado') return [];
    b = breakerPublico(b);
    const critica = esCritico(b.categoria_apertura) || Boolean(b.ultimo_error && esCritico(b.ultimo_error.categoria));
    return [{
        tipo: 'ALERTA CRÍTICA DE PROVEEDOR EXTERNO',
        proveedor,
        modelo,
        severidad: critica ? 'critica' : 'alta',
        efecto: critica ? 'bloqueo_duro' : 'soft_fail_elegible',
        estado_breaker: b.estado,
        fallos_consecutivos: b.fallos_consecutivos,
        ultimo_error: b.ultimo_error,
        accion: critica
            ? 'Verificar la key del proveedor (ANTHROPIC_API_KEY / GEMINI_API_KEY), su saldo o el modelo — mientras tanto la cadena usa la otra familia.'
            : 'Modelo degradado — la cadena conmuta al siguiente modelo (Claude → Gemini) hasta que su breaker cierre; soft-fail solo con opt-in y responsable.',
    }];
}


// --- Configuración -----------------------------------------------------------

// Solo ASCII imprimible sin espacios (hallazgo 008): una key con un carácter
// no-ByteString hacía que fetch lanzara TypeError → mal clasificado como
// caída de red → soft-fail. Una key malformada es error de configuración.
const KEY_VALIDA = /^[\x21-\x7E]{8,}$/;
const NOMBRE_KEY = Object.freeze({ anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' });

// Gemini: GEMINI_API_KEY o, si no está, GOOGLE_API_KEY (convención del SDK
// oficial de Google). Una familia sin key se omite de la cadena sin aviso.
function keyDe(proveedor, env = process.env) {
    const v = proveedor === 'gemini' ? (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) : env.ANTHROPIC_API_KEY;
    return String(v ?? '').trim();
}

function configModelo(proveedor, modelo, env = process.env) {
    if (!BASE_URLS[proveedor]) {
        throw new ErrorProveedor({ codigo: 'proveedor_desconocido', categoria: 'config', detalle: `Proveedor "${String(proveedor).slice(0, 40)}" no soportado (${PROVEEDORES.join(' | ')}).` });
    }
    return { proveedor, modelo, key: keyDe(proveedor, env), baseUrl: BASE_URLS[proveedor] };
}

function validarKey(cfg) {
    const nombre = NOMBRE_KEY[cfg.proveedor];
    if (!cfg.key) {
        throw new ErrorProveedor({ codigo: `${nombre}_ausente`, categoria: 'config', detalle: `${nombre} no configurada — bloqueo duro (error de configuración, no de disponibilidad).` });
    }
    if (!KEY_VALIDA.test(cfg.key)) {
        throw new ErrorProveedor({ codigo: `${nombre}_malformada`, categoria: 'config', detalle: `La key de ${cfg.proveedor} no tiene formato válido (ASCII imprimible sin espacios) — bloqueo duro.` });
    }
}

// Qué familias tienen key (PMU, /status, /api/health) — nunca la key.
function proveedoresConKey(env = process.env) {
    return Object.fromEntries(PROVEEDORES.map(p => [p, Boolean(keyDe(p, env))]));
}

// Plazo total por intento. Valor inválido o fuera de rango = error de
// configuración (bloqueo duro), nunca un default silencioso.
function resolverTimeoutTotal(env = process.env) {
    const crudo = String(env.GATE_TIMEOUT_TOTAL_MS ?? '').trim();
    if (!crudo) return TIMEOUT_TOTAL_DEFAULT_MS;
    const [min, max] = TIMEOUT_TOTAL_RANGO_MS;
    const ms = /^\d+$/.test(crudo) ? Number(crudo) : NaN;
    if (!(ms >= min && ms <= max)) {
        throw new ErrorProveedor({ codigo: 'timeout_total_invalido', categoria: 'config', detalle: `GATE_TIMEOUT_TOTAL_MS="${crudo.slice(0, 20)}" fuera de rango (entero ${min}-${max} ms) — bloqueo duro.` });
    }
    return ms;
}

// --- Filtrado del diff antes de enviarlo a un tercero (ADR-0002 §2.5) --------

// Reforzado 2026-09-26 tras auditoría 008 (16 de 17 formatos pasaban).
// Criterio: ante la duda, redactar — el revisor ve [SECRETO_REDACTADO] en vez
// del valor, el tercero nunca lo recibe. Falsos positivos aceptados.
const ARCHIVO_SENSIBLE = /(^|\/)\.env(?!\.example$)[^/]*$|(^|\/)(id_rsa|id_ed25519|id_ecdsa)[^/]*$|(^|\/)[^/]*(credential|service[-_]?account|secret)[^/]*\.json$|(^|\/)\.(npmrc|pypirc|netrc|pgpass)$|\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/i;
const PATRONES_REDACCION = [
    /nvapi-[A-Za-z0-9_-]{8,}/g,
    /sk-ant-[A-Za-z0-9_-]{8,}/g,
    /\bsk-or-v1-[A-Za-z0-9]{16,}/g,
    /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/g,
    /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    /\bglpat-[A-Za-z0-9_-]{16,}/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    /\bAIza[0-9A-Za-z_-]{30,}/g,
    /\btvly-[A-Za-z0-9_-]{16,}/g,
    /\bgsk_[A-Za-z0-9]{20,}/g,
    /\bhf_[A-Za-z0-9]{20,}/g,
    /\b(AKIA|ASIA)[0-9A-Z]{16}/g,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/g,               // Supabase
    /\b(prv|pub)_(prod|test)_[A-Za-z0-9]{10,}/g,                    // Wompi
    /\b(prod|test)_integrity_[A-Za-z0-9]{10,}/g,                    // Wompi integridad
    /\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]{12,}/g,                   // cabeceras Authorization
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:[^\s@'"]+@/gi, // user:password@ en cualquier URI
    /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY( BLOCK)?-----|$)/g,
];
// Nombre sensible: api_key/secret/token/password/passphrase/credential/
// private_key/privada/encryption y CUALQUIER nombre terminado en _KEY
// (INNGEST_EVENT_KEY, SUPABASE_SERVICE_KEY — hallazgo N3 de 008). Sin "auth"
// suelto (N4: redactaba `authorized = isAdminOrOwnerOfTenant(...)` y
// ocultaba a 002 justo el código RBAC/multi-tenant).
const NOMBRE_SENSIBLE = String.raw`[A-Za-z0-9_.-]*(?:api[_-]?key|_key\b|secret|token|pass(?:phrase|w(?:or)?d)|pwd|credential|private[_-]?key|privad[ao]|encryption)[A-Za-z0-9_.-]*`;
// Regla A — valor LITERAL entre comillas en cualquier contexto (código, JSON,
// YAML, .env). Admite espacios dentro de las comillas (passphrases).
const ASIGNACION_LITERAL = new RegExp(String.raw`(${NOMBRE_SENSIBLE}["']?\s*[:=]\s*)(["'\x60])([^"'\x60\n]{8,})\2`, 'gi');
// Regla B — línea de .env/YAML (el nombre abre la línea del diff) con valor
// sin comillas. Código como `const token = await f()` no abre con el nombre
// y no se toca.
const ASIGNACION_LINEA = new RegExp(String.raw`^([+\- ]\s*(?:export\s+)?${NOMBRE_SENSIBLE}\s*[:=]\s*)([^\s"'#][^\n]{7,})$`, 'gim');
// Regla C — YAML en bloque (`api_key: >-` / `|`) → redacta la línea siguiente.
const YAML_BLOQUE = new RegExp(String.raw`^([+\- ]\s*${NOMBRE_SENSIBLE}\s*:\s*[>|][-+]?\s*\n[+\- ]\s*)(\S[^\n]*)$`, 'gim');
// Regla D — par key/value en 2 líneas (sintaxis real de render.yaml).
const PAR_KEY_VALUE = new RegExp(String.raw`^([+\- ]\s*-?\s*key:\s*["']?${NOMBRE_SENSIBLE}["']?\s*\n[+\- ]\s*value:\s*)(\S[^\n]*)$`, 'gim');
const ES_REFERENCIA = /^(process\.env\.|import\.meta\.env\.|\$\{|\[SECRETO_REDACTADO\])/;

// Ruta del archivo de una sección, soportando rutas entre comillas (espacios,
// core.quotePath) y cabeceras +++/---. null = no parseable.
function rutasDeSeccion(s) {
    const rutas = [];
    const cab = s.match(/^diff --git (?:"a\/((?:[^"\\]|\\.)*)"|a\/(.*?)) (?:"b\/((?:[^"\\]|\\.)*)"|b\/(.*))$/m);
    if (cab) rutas.push(cab[1] ?? cab[2], cab[3] ?? cab[4]);
    // diff combinado de merge (hallazgo N3 de 008): `diff --cc ruta`.
    const cc = s.match(/^diff --(?:cc|combined) (?:"((?:[^"\\]|\\.)*)"|(.+))$/m);
    if (cc) rutas.push(cc[1] ?? cc[2]);
    for (const m of s.matchAll(/^(?:\+\+\+|---) (?:"[ab]\/((?:[^"\\]|\\.)*)"|[ab]\/(.*))$/gm)) rutas.push(m[1] ?? m[2]);
    return rutas.filter(Boolean).map(r => r.trim());
}

function filtrarSecretosDiff(diff) {
    const secciones = String(diff || '').split(/(?=^diff --(?:git|cc|combined) )/m);
    const conservadas = [];
    const omitidos = [];
    for (const s of secciones) {
        if (/^diff --(?:git|cc|combined) /.test(s)) {
            const rutas = rutasDeSeccion(s);
            if (rutas.length === 0 || rutas.some(r => ARCHIVO_SENSIBLE.test(r))) {
                const etiqueta = rutas[rutas.length - 1] || '(cabecera no parseable)';
                omitidos.push(etiqueta);
                conservadas.push(`diff --git ${etiqueta}\n[contenido omitido: archivo sensible o cabecera no parseable, no se envía al proveedor]\n`);
                continue;
            }
        }
        let t = s;
        for (const p of PATRONES_REDACCION) t = t.replace(p, '[SECRETO_REDACTADO]');
        t = t.replace(YAML_BLOQUE, (todo, pre) => `${pre}[SECRETO_REDACTADO]`);
        t = t.replace(PAR_KEY_VALUE, (todo, pre, valor) => ES_REFERENCIA.test(valor) ? todo : `${pre}[SECRETO_REDACTADO]`);
        t = t.replace(ASIGNACION_LITERAL, (todo, pre, q, valor) => ES_REFERENCIA.test(valor) ? todo : `${pre}${q}[SECRETO_REDACTADO]${q}`);
        t = t.replace(ASIGNACION_LINEA, (todo, pre, valor) => ES_REFERENCIA.test(valor) ? todo : `${pre}[SECRETO_REDACTADO]`);
        conservadas.push(t);
    }
    return { diff: conservadas.join(''), omitidos };
}

// --- Llamada ------------------------------------------------------------------

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// Códigos de red reales de Node/undici — solo estos (o el timeout propio)
// cuentan como caída. Cualquier otra excepción de fetch (TypeError por
// cabecera inválida, bug) es bloqueo duro: si no, cualquier error provocable
// localmente abría el gate por soft-fail (hallazgo 008).
// Lista explícita, sin prefijo UND_ERR_* (hallazgo N2 de 008: incluía
// UND_ERR_INVALID_ARG, UND_ERR_NOT_SUPPORTED, UND_ERR_PRX_TLS).
const CODIGOS_RED = new Set([
    'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNABORTED',
    'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED',
]);
function esErrorDeRed(e) {
    const code = e?.cause?.code || e?.code;
    return typeof code === 'string' && CODIGOS_RED.has(code);
}

// --- Transporte: SSE de Claude (Messages API) y Gemini (streamGenerateContent) --

// Gemini 2.5 y posteriores cuentan el razonamiento dentro de maxOutputTokens:
// sin margen, un ping o el plan corto del M1 se agotan pensando y no emiten
// texto (respuesta_truncada). Solo se cobra lo que el modelo usa.
const MARGEN_RAZONAMIENTO_GEMINI = 4096;

function estadoInicial() {
    return { texto: '', fin: null, uso: null, razonamientoChars: 0, hecho: false };
}

// Errores que Anthropic emite como evento a mitad del stream (sin HTTP propio).
const ERRORES_STREAM_ANTHROPIC = Object.freeze({
    overloaded_error: ['stream_sobrecargada', 'caida'],
    api_error: ['stream_error_api', 'caida'],
    rate_limit_error: ['stream_rate_limit', 'cuota'],
});

function errorDeStream(cfg, cuerpo, request_id, httpEquivalente = 400) {
    const tipo = cuerpo?.error?.type;
    const fijo = ERRORES_STREAM_ANTHROPIC[tipo];
    const cls = fijo ? { codigo: fijo[0], categoria: fijo[1] } : (() => {
        const c = clasificarHttp(httpEquivalente, cuerpo);
        return { codigo: `stream_${c.codigo}`, categoria: c.categoria };
    })();
    return new ErrorProveedor({ ...cls, http: 200, detalle: redactar(JSON.stringify(cuerpo?.error ?? cuerpo), cfg.key).slice(0, 300), request_id });
}

function eventoAnthropic(ev, e, cfg, request_id) {
    if (ev.type === 'error' || ev.error) throw errorDeStream(cfg, ev, request_id);
    switch (ev.type) {
        case 'message_start': {
            const u = ev.message?.usage;
            if (u) e.uso = { prompt_tokens: u.input_tokens ?? null, completion_tokens: u.output_tokens ?? null };
            break;
        }
        case 'content_block_delta':
            if (ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') e.texto += ev.delta.text;
            else if (ev.delta?.type === 'thinking_delta' && typeof ev.delta.thinking === 'string') e.razonamientoChars += ev.delta.thinking.length;
            break;
        case 'message_delta':
            if (ev.delta?.stop_reason) e.fin = ev.delta.stop_reason === 'max_tokens' ? 'length' : ev.delta.stop_reason;
            if (ev.usage?.output_tokens != null) e.uso = { prompt_tokens: e.uso?.prompt_tokens ?? ev.usage.input_tokens ?? null, completion_tokens: ev.usage.output_tokens };
            break;
        case 'message_stop':
            e.hecho = true;
            break;
        default: // ping, content_block_start/stop: vida sin contenido
            break;
    }
}

function eventoGemini(ev, e, cfg, request_id) {
    if (ev.error) throw errorDeStream(cfg, ev, request_id, typeof ev.error.code === 'number' ? ev.error.code : 400);
    if (ev.promptFeedback?.blockReason) e.fin = `bloqueado_${String(ev.promptFeedback.blockReason).toLowerCase()}`;
    const cand = ev.candidates?.[0];
    for (const p of cand?.content?.parts ?? []) {
        if (typeof p.text !== 'string') continue;
        if (p.thought) e.razonamientoChars += p.text.length;
        else e.texto += p.text;
    }
    if (cand?.finishReason) {
        const r = String(cand.finishReason);
        e.fin = r === 'MAX_TOKENS' ? 'length' : r === 'STOP' ? 'stop' : `bloqueado_${r.toLowerCase()}`;
    }
    if (ev.usageMetadata) {
        const u = ev.usageMetadata;
        e.uso = { prompt_tokens: u.promptTokenCount ?? null, completion_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
    }
}

const EVENTO = Object.freeze({ anthropic: eventoAnthropic, gemini: eventoGemini });

// Respuesta JSON (servidor que ignoró el streaming): misma traducción.
function interpretarJSON(cfg, json, e, request_id) {
    if (cfg.proveedor === 'anthropic') {
        if (json?.type === 'error' || json?.error) throw errorDeStream(cfg, json, request_id);
        for (const b of json?.content ?? []) {
            if (b?.type === 'text' && typeof b.text === 'string') e.texto += b.text;
            else if (b?.type === 'thinking' && typeof b.thinking === 'string') e.razonamientoChars += b.thinking.length;
        }
        e.fin = json?.stop_reason === 'max_tokens' ? 'length' : (json?.stop_reason ?? null);
        if (json?.usage) e.uso = { prompt_tokens: json.usage.input_tokens ?? null, completion_tokens: json.usage.output_tokens ?? null };
        return;
    }
    for (const ev of Array.isArray(json) ? json : [json]) eventoGemini(ev, e, cfg, request_id);
}

// Lee un stream SSE. `latido()` se llama con cada fragmento recibido
// (reinicia el reloj de inactividad); ping, keep-alive y razonamiento cuentan
// como vida aunque no aporten texto. Claude cierra con message_stop; Gemini
// cierra la conexión tras el fragmento con finishReason. Un stream que se
// corta sin cierre ni motivo de fin es una caída de conexión, no una respuesta.
async function leerSSE(body, latido, signal, cfg, request_id) {
    const reader = body.getReader();
    const abortado = new Promise((_, rej) => {
        const f = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) f(); else signal.addEventListener('abort', f, { once: true });
    });
    abortado.catch(() => {});
    const dec = new TextDecoder();
    const e = estadoInicial();
    let buf = '';
    const procesarLinea = (linea) => {
        if (!linea.startsWith('data:')) return; // event:, comentarios ": ..."
        const dato = linea.slice(5).trim();
        if (!dato) return;
        if (dato === '[DONE]') { e.hecho = true; return; }
        let ev;
        try { ev = JSON.parse(dato); } catch {
            throw new ErrorProveedor({ codigo: 'respuesta_no_json', categoria: 'solicitud', http: 200, detalle: redactar(dato, cfg.key).slice(0, 300), request_id });
        }
        EVENTO[cfg.proveedor](ev, e, cfg, request_id);
    };
    try {
        while (!e.hecho) {
            const { value, done } = await Promise.race([reader.read(), abortado]);
            if (done) break;
            latido();
            buf += dec.decode(value, { stream: true });
            let i;
            while (!e.hecho && (i = buf.indexOf('\n')) >= 0) {
                const linea = buf.slice(0, i).replace(/\r$/, '');
                buf = buf.slice(i + 1);
                procesarLinea(linea);
            }
        }
        if (!e.hecho && buf.trim()) procesarLinea(buf.trim());
    } finally {
        reader.cancel().catch(() => {});
    }
    if (!e.hecho && !e.fin) {
        throw new ErrorProveedor({ codigo: 'stream_incompleto', categoria: 'caida', http: 200, detalle: `El stream se cerró sin evento de cierre ni motivo de fin tras ${e.texto.length} caracteres`, request_id });
    }
    return e;
}

function solicitudHttp(cfg, { system, user, max_tokens }) {
    const comunes = { 'content-type': 'application/json', accept: 'text/event-stream, application/json' };
    if (cfg.proveedor === 'anthropic') {
        return {
            url: `${cfg.baseUrl}/messages`,
            headers: { ...comunes, 'x-api-key': cfg.key, 'anthropic-version': ANTHROPIC_VERSION },
            body: { model: cfg.modelo, max_tokens, system, messages: [{ role: 'user', content: user }], stream: true },
        };
    }
    return {
        url: `${cfg.baseUrl}/models/${encodeURIComponent(cfg.modelo)}:streamGenerateContent?alt=sse`,
        headers: { ...comunes, 'x-goog-api-key': cfg.key },
        body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: max_tokens + MARGEN_RAZONAMIENTO_GEMINI },
        },
    };
}

async function unIntento({ cfg, system, user, max_tokens, fetchImpl, timeoutMs, primerByteMs, deadlineMs }) {
    const ctrl = new AbortController();
    // Primer reloj que vence decide el código; los demás se ignoran.
    let motivo = null;
    const abortar = (m) => { if (!motivo) { motivo = m; ctrl.abort(); } };
    let relojInactividad = setTimeout(() => abortar('primer_byte'), primerByteMs);
    const latido = () => {
        clearTimeout(relojInactividad);
        relojInactividad = setTimeout(() => abortar('inactividad'), timeoutMs);
    };
    const relojTotal = setTimeout(() => abortar('total'), deadlineMs);
    const sol = solicitudHttp(cfg, { system, user, max_tokens });
    let res;
    let cuerpo = null;
    let sse = null;
    let request_id = null;
    // Los relojes cubren también la lectura del cuerpo (hallazgo 008: un
    // servidor que manda cabeceras y se calla colgaba el pre-commit).
    try {
        res = await fetchImpl(sol.url, { method: 'POST', headers: sol.headers, body: JSON.stringify(sol.body), signal: ctrl.signal });
        latido();
        request_id = res.headers?.get?.('request-id') || res.headers?.get?.('x-request-id') || null;
        const tipo = String(res.headers?.get?.('content-type') || '');
        // SSE solo si el servidor lo honró; un error HTTP o un servidor que
        // ignora el streaming responde JSON y sigue el camino clásico.
        if (res.ok && /text\/event-stream/i.test(tipo) && res.body?.getReader) {
            sse = await leerSSE(res.body, latido, ctrl.signal, cfg, request_id);
        } else {
            cuerpo = await res.text();
        }
    } catch (e) {
        if (e instanceof ErrorProveedor) throw e;
        const timeout = motivo !== null || e?.name === 'AbortError' || ctrl.signal.aborted;
        const red = !timeout && esErrorDeRed(e);
        const porMotivo = {
            primer_byte: ['timeout_sin_respuesta', `Sin primer byte del proveedor en ${primerByteMs} ms (cola/prefill)`],
            inactividad: ['timeout_inactividad', `Stream sin datos durante ${timeoutMs} ms (servidor colgado)`],
            total: ['timeout_total', `Respuesta incompleta al vencer el plazo total de ${deadlineMs} ms por intento`],
        };
        const [codigoTimeout, detalleTimeout] = porMotivo[motivo] || porMotivo.inactividad;
        throw new ErrorProveedor({
            codigo: timeout ? codigoTimeout : (red ? 'sin_respuesta' : 'error_cliente'),
            categoria: timeout || red ? 'caida' : 'solicitud',
            detalle: redactar(timeout ? detalleTimeout : `${e?.message || e}${e?.cause?.code ? ` (${e.cause.code})` : ''}`, cfg.key).slice(0, 300),
            request_id,
        });
    } finally {
        clearTimeout(relojInactividad);
        clearTimeout(relojTotal);
    }
    if (!res.ok) {
        const { codigo, categoria } = clasificarHttp(res.status, cuerpo);
        throw new ErrorProveedor({ codigo, categoria, http: res.status, detalle: redactar(cuerpo, cfg.key).slice(0, 300), request_id });
    }
    let e = sse;
    if (!e) {
        let json;
        try {
            json = JSON.parse(cuerpo);
        } catch {
            throw new ErrorProveedor({ codigo: 'respuesta_no_json', categoria: 'solicitud', http: res.status, detalle: redactar(cuerpo, cfg.key).slice(0, 300), request_id });
        }
        e = estadoInicial();
        interpretarJSON(cfg, json, e, request_id);
    }
    // Sin texto: corte por longitud, bloqueo de contenido del proveedor o
    // respuesta vacía → código propio y bloqueo duro (hallazgo 008), nunca
    // un "no parseable" genérico. En una cadena, salta al siguiente modelo.
    if (!e.texto) {
        const codigo = e.fin === 'length' ? 'respuesta_truncada' : String(e.fin || '').startsWith('bloqueado_') ? 'respuesta_bloqueada' : 'respuesta_vacia';
        throw new ErrorProveedor({ codigo, categoria: 'solicitud', http: res.status, detalle: `fin=${e.fin ?? 'null'}, texto vacío`, request_id });
    }
    // razonamiento_chars/texto_chars: diagnóstico de a dónde se va max_tokens
    // (FinOps + calibración; nunca contenido, solo longitudes).
    return { texto: e.texto, uso: e.uso, fin: e.fin ?? null, request_id, razonamiento_chars: e.razonamientoChars, texto_chars: e.texto.length };
}

// --- FinOps: uso de tokens y costo en COP (orden del dueño 2026-10-04) -------
// Claude y Gemini reportan uso real en streaming; la estimación por volumen
// queda solo de respaldo (proveedor que no lo reporte) y se marca estimado.
// El factor por defecto sale de mediciones reales del gate (3,16 y 3,02
// caracteres por token); LLM_CARACTERES_POR_TOKEN lo ajusta.
const CARACTERES_POR_TOKEN_DEFAULT = 3.1;
const CARACTERES_POR_TOKEN_RANGO = Object.freeze([1.5, 6]);
// TRM oficial (datos.gov.co, recurso 32sa-8pi3) vigente 2026-10-03..05.
// TRM_COP_USD la actualiza sin tocar código.
const TRM_COP_USD_DEFAULT = 3273.49;
// USD por millón de tokens, por GAMA (ADR-0004 §2.6, tarifas públicas de
// referencia): un modelo nuevo de una gama conocida hereda su tarifa sin
// tocar código. LLM_TARIFAS_USD (JSON {"<id o gama>": {"entrada", "salida"}})
// las reemplaza; el id exacto gana sobre la gama.
const TARIFAS_USD_POR_MILLON = Object.freeze({
    opus: Object.freeze({ entrada: 5, salida: 25 }),
    sonnet: Object.freeze({ entrada: 3, salida: 15 }),
    haiku: Object.freeze({ entrada: 1, salida: 5 }),
    pro: Object.freeze({ entrada: 2, salida: 12 }),
    flash: Object.freeze({ entrada: 0.5, salida: 3 }),
    'flash-lite': Object.freeze({ entrada: 0.1, salida: 0.4 }),
});

function numeroEnRango(crudo, [min, max], porDefecto) {
    const n = Number(String(crudo ?? '').trim());
    return String(crudo ?? '').trim() && Number.isFinite(n) && n >= min && n <= max ? n : porDefecto;
}

function estimarUso({ system, user, texto, razonamientoChars }, env = process.env) {
    const factor = numeroEnRango(env.LLM_CARACTERES_POR_TOKEN, CARACTERES_POR_TOKEN_RANGO, CARACTERES_POR_TOKEN_DEFAULT);
    const entrada = String(system ?? '').length + String(user ?? '').length;
    const salida = String(texto ?? '').length + (Number.isInteger(razonamientoChars) ? razonamientoChars : 0);
    return {
        prompt_tokens: Math.ceil(entrada / factor),
        completion_tokens: Math.ceil(salida / factor),
        estimado: true,
        caracteres_por_token: factor,
    };
}

function tarifaDe(cfg, env = process.env) {
    let extra = {};
    const crudo = String(env.LLM_TARIFAS_USD ?? '').trim();
    if (crudo) { try { extra = JSON.parse(crudo) || {}; } catch { extra = {}; } }
    const valida = (t) => t && Number.isFinite(t.entrada) && Number.isFinite(t.salida) && t.entrada >= 0 && t.salida >= 0;
    const { gama } = clasificarModelo(cfg.proveedor, cfg.modelo);
    for (const k of [cfg.modelo, gama]) if (valida(extra[k])) return extra[k];
    return TARIFAS_USD_POR_MILLON[gama] || null;
}

function costoEnCOP(uso, cfg, env = process.env) {
    if (!uso) return null;
    const tarifa = tarifaDe(cfg, env);
    if (!tarifa) return { usd: null, cop: null, trm: null, motivo: 'tarifa_desconocida', estimado: Boolean(uso.estimado) };
    const trm = numeroEnRango(env.TRM_COP_USD, [1000, 10000], TRM_COP_USD_DEFAULT);
    const usd = ((uso.prompt_tokens ?? 0) * tarifa.entrada + (uso.completion_tokens ?? 0) * tarifa.salida) / 1e6;
    return { usd: Number(usd.toFixed(6)), cop: Number((usd * trm).toFixed(2)), trm, estimado: Boolean(uso.estimado) };
}

// --- Descubrimiento dinámico de modelos (ADR-0004 §2.3) ---------------------
// Cada proveedor publica su catálogo; aquí se filtra por prefijo de familia,
// se clasifica por gama y se ordena por recencia. Una versión nueva de
// Claude o Gemini entra sola, sin tocar código.

const PREFIJO_FAMILIA = Object.freeze({ anthropic: 'claude-', gemini: 'gemini-' });
// 'flash-lite' antes que 'flash': el orden de la lista es el de detección.
const GAMAS = Object.freeze({ anthropic: Object.freeze(['opus', 'sonnet', 'haiku']), gemini: Object.freeze(['flash-lite', 'flash', 'pro']) });
// Variantes de Gemini que no son modelos de texto generales, y alias sin
// versión (`*-latest`): no entran en la cadena.
const EXCLUIR_GEMINI = /(embedding|tts|image|live|audio|aqa|robotics|computer-use|veo|imagen|learnlm)|-latest$/i;
const MODELOS_POR_FAMILIA = 2;
const LISTADO_TIMEOUT_MS = 15000;
const LISTADO_MAX_PAGINAS = 10;
const TTL_DESCUBRIMIENTO_H_DEFAULT = 24;

// Perfil por tarea: gamas preferidas de cada familia, en orden (§2.2).
// Claude primero siempre; Gemini nunca es primario si hay key de Claude.
const PERFILES_TAREA = Object.freeze({
    razonamiento: Object.freeze({ anthropic: Object.freeze(['opus', 'sonnet']), gemini: Object.freeze(['pro', 'flash']) }),
    rapido: Object.freeze({ anthropic: Object.freeze(['sonnet', 'haiku']), gemini: Object.freeze(['flash', 'flash-lite']) }),
});

// {gama, version: number[], estable, fecha}. gama 'otra' = familia nueva
// bajo el prefijo (entra después de las gamas conocidas, por recencia).
function clasificarModelo(proveedor, id) {
    const s = String(id || '').toLowerCase();
    const cuerpo = s.startsWith(PREFIJO_FAMILIA[proveedor] || '') ? s.slice((PREFIJO_FAMILIA[proveedor] || '').length) : s;
    const tokens = cuerpo.split('-');
    let gama = 'otra';
    if (proveedor === 'gemini') {
        gama = (GAMAS.gemini.find(g => new RegExp(`(^|-)${g}(-|$)`).test(cuerpo))) || 'otra';
    } else {
        gama = GAMAS.anthropic.find(g => tokens.includes(g)) || 'otra';
    }
    const fecha = tokens.find(t => /^\d{8}$/.test(t)) || null;
    // Versión: el PRIMER tramo numérico contiguo del id ("opus-4-6" → [4,6],
    // "3-5-sonnet" → [3,5], "2.5-pro" → [2,5]). Los números posteriores son
    // fechas o revisiones ("-preview-01-2027", "-001", "-20250929") y no
    // cuentan: si contaran, una preview fechada le ganaba a la estable.
    const version = [];
    let enTramo = false;
    for (const t of tokens) {
        if (/^\d+(\.\d+)?$/.test(t) && t.length <= 4) { version.push(...t.split('.').map(Number)); enTramo = true; }
        else if (enTramo) break;
    }
    const estable = !/(preview|exp|experimental)/.test(s);
    return { gama, version, estable, fecha };
}

function compararVersion(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (b[i] ?? -1) - (a[i] ?? -1);
        if (d) return d;
    }
    return 0;
}

// Orden de recencia dentro de la familia: Claude por created_at del API
// (fallback: versión del id); Gemini por versión, estable antes que preview.
function ordenarModelos(proveedor, modelos) {
    return [...modelos].sort((a, b) => {
        if (proveedor === 'anthropic' && Number.isFinite(a.creado) && Number.isFinite(b.creado) && a.creado !== b.creado) return b.creado - a.creado;
        const v = compararVersion(a.version, b.version);
        if (v) return v;
        if (a.estable !== b.estable) return a.estable ? -1 : 1;
        if ((a.fecha || '') !== (b.fecha || '')) return (b.fecha || '').localeCompare(a.fecha || '');
        return a.id.localeCompare(b.id);
    });
}

// Normaliza el listado crudo de un proveedor a [{id, gama, version, estable,
// fecha, creado}] solo con modelos de texto de la familia.
function filtrarModelos(proveedor, crudos) {
    const vistos = new Set();
    const out = [];
    for (const m of crudos) {
        const id = String(m?.id || '').trim();
        if (!id.toLowerCase().startsWith(PREFIJO_FAMILIA[proveedor]) || vistos.has(id)) continue;
        if (proveedor === 'gemini' && (EXCLUIR_GEMINI.test(id) || (Array.isArray(m.metodos) && !m.metodos.includes('generateContent')))) continue;
        vistos.add(id);
        out.push({ id, ...clasificarModelo(proveedor, id), creado: Number.isFinite(m.creado) ? m.creado : null });
    }
    return ordenarModelos(proveedor, out);
}

// LLM_MODELOS_CLAUDE / LLM_MODELOS_GEMINI: fijan el catálogo de la familia
// (ids separados por coma, en orden de preferencia). La selección por tarea
// sigue aplicando la gama sobre esa lista.
function pinesDe(proveedor, env = process.env) {
    const nombre = proveedor === 'anthropic' ? 'LLM_MODELOS_CLAUDE' : 'LLM_MODELOS_GEMINI';
    const crudo = String(env[nombre] ?? '').trim();
    if (!crudo) return null;
    const ids = crudo.split(',').map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
        if (!id.toLowerCase().startsWith(PREFIJO_FAMILIA[proveedor]) || !/^[A-Za-z0-9._-]+$/.test(id)) {
            throw new ErrorProveedor({ codigo: 'modelo_fijado_invalido', categoria: 'config', detalle: `${nombre}: "${id.slice(0, 80)}" no es un id ${PREFIJO_FAMILIA[proveedor]}* válido — bloqueo duro.` });
        }
    }
    return [...new Set(ids)].map(id => ({ id, ...clasificarModelo(proveedor, id), creado: null }));
}

async function obtenerJSON(url, headers, { fetchImpl, plazoMs, key }) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), plazoMs);
    let res;
    let cuerpo;
    try {
        res = await fetchImpl(url, { method: 'GET', headers, signal: ctrl.signal });
        cuerpo = await res.text();
    } catch (e) {
        const timeout = e?.name === 'AbortError' || ctrl.signal.aborted;
        const red = !timeout && esErrorDeRed(e);
        throw new ErrorProveedor({
            codigo: timeout ? 'listado_timeout' : (red ? 'listado_sin_respuesta' : 'listado_error_cliente'),
            categoria: timeout || red ? 'caida' : 'solicitud',
            detalle: redactar(timeout ? `Sin respuesta del listado de modelos en ${plazoMs} ms` : `${e?.message || e}`, key).slice(0, 300),
        });
    } finally {
        clearTimeout(reloj);
    }
    if (!res.ok) {
        const { codigo, categoria } = clasificarHttp(res.status, cuerpo);
        throw new ErrorProveedor({ codigo: `listado_${codigo}`, categoria, http: res.status, detalle: redactar(cuerpo, key).slice(0, 300) });
    }
    try { return JSON.parse(cuerpo); } catch {
        throw new ErrorProveedor({ codigo: 'listado_no_json', categoria: 'solicitud', http: res.status, detalle: redactar(cuerpo, key).slice(0, 300) });
    }
}

// Listado crudo del proveedor: [{id, creado?, metodos?}], todas las páginas.
async function listarModelos(proveedor, key, { fetchImpl = globalThis.fetch, plazoMs = LISTADO_TIMEOUT_MS } = {}) {
    const out = [];
    let cursor = null;
    for (let pagina = 0; pagina < LISTADO_MAX_PAGINAS; pagina++) {
        if (proveedor === 'anthropic') {
            const url = `${BASE_URLS.anthropic}/models?limit=1000${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`;
            const j = await obtenerJSON(url, { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }, { fetchImpl, plazoMs, key });
            for (const m of j?.data ?? []) out.push({ id: m?.id, creado: Date.parse(m?.created_at || '') });
            cursor = j?.has_more && j?.last_id ? j.last_id : null;
        } else {
            const url = `${BASE_URLS.gemini}/models?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`;
            const j = await obtenerJSON(url, { 'x-goog-api-key': key }, { fetchImpl, plazoMs, key });
            for (const m of j?.models ?? []) out.push({ id: String(m?.name || '').replace(/^models\//, ''), metodos: m?.supportedGenerationMethods });
            cursor = j?.nextPageToken || null;
        }
        if (!cursor) break;
    }
    return out;
}

// Validación real de keys para el PMU (2026-10-12, hallazgo R2 del
// diagnóstico PMUI: el tablero decía "key configurada" con la key de Gemini
// rechazada por Google). Una llamada al listado de modelos por familia, sin
// caché y sin consumir tokens. Estados:
//   CONECTADO_Y_VALIDADO        — HTTP 200 del proveedor con esta key.
//   ERROR_AUTENTICACION_O_SALDO — HTTP 400/401/402/403 (key inválida,
//                                 revocada, sin permisos o sin saldo).
//   SIN_KEY                     — la familia no tiene key en el entorno.
//   NO_VERIFICABLE              — timeout, red, 429, 5xx u otro 400 que no es
//                                 de auth/cuota: la key no se pudo confirmar
//                                 ni descartar (nunca cuenta como válida).
//   NO_VERIFICADO               — nadie la validó recientemente (el PMU se
//                                 regeneró sin sonda y no hay validación
//                                 vigente); tampoco cuenta como válida.
// La decisión usa la categoría de clasificarHttp(), no el código solo: un
// 400 FAILED_PRECONDITION de Gemini no es "reemplace la key" (H4, auditoría
// cruzada 008, 2026-10-12).
// El listado no consume saldo, así que un 402 solo aparece si el proveedor
// lo devuelve también ahí; la falta de saldo se detecta en la primera
// llamada real de la cadena (bloqueo duro o soft-fail con opt-in).
const ESTADOS_KEY = Object.freeze({
    VALIDADA: 'CONECTADO_Y_VALIDADO',
    RECHAZADA: 'ERROR_AUTENTICACION_O_SALDO',
    SIN_KEY: 'SIN_KEY',
    NO_VERIFICABLE: 'NO_VERIFICABLE',
    NO_VERIFICADO: 'NO_VERIFICADO',
});

function keyRechazada({ http, categoria }) {
    if (categoria === 'auth' || categoria === 'config') return true;
    if (http === 401 || http === 402 || http === 403) return true;
    return http === 400 && categoria === 'cuota';
}

// sondaSaldo (2026-10-12, hallazgo en vivo al pedir la firma de 002): el
// listado de modelos de Anthropic responde 200 con la cuenta SIN saldo — el
// PMU marcaba CONECTADO_Y_VALIDADO y la primera llamada real devolvía
// "credit balance is too low". Con sondaSaldo, tras el listado se hace una
// llamada real mínima (max_tokens 1, el modelo más barato de la tarea
// 'rapido', 1 intento, sin breaker). Respuesta vacía/truncada = la cuenta
// atiende (válida). --pmu-status la activa; por defecto apagada.
async function validarKeys({ env = process.env, fetchImpl = globalThis.fetch, plazoMs = LISTADO_TIMEOUT_MS, sondaSaldo = false } = {}) {
    return Promise.all(PROVEEDORES.map(async (proveedor) => {
        const key = keyDe(proveedor, env);
        if (!key) return { proveedor, estado: ESTADOS_KEY.SIN_KEY, http: null, codigo: 'sin_key', categoria: 'config', huella_key: null };
        try {
            validarKey({ proveedor, key });
            const listado = await listarModelos(proveedor, key, { fetchImpl, plazoMs });
            if (sondaSaldo) {
                const candidatos = seleccionarModelos(proveedor, filtrarModelos(proveedor, listado), 'rapido');
                const modelo = candidatos[candidatos.length - 1];
                if (!modelo) throw new ErrorProveedor({ codigo: 'sin_modelos_para_sonda', categoria: 'politica', detalle: `Sin modelo de la tarea 'rapido' en el catálogo de ${proveedor} para sondear el saldo.` });
                try {
                    await llamarProveedor(configModelo(proveedor, modelo, env), { system: 'Responde OK.', user: 'ping', max_tokens: 1 }, { env, fetchImpl, maxIntentos: 1, primerByteMs: plazoMs, deadlineMs: plazoMs * 2 });
                } catch (e) {
                    if (!(e instanceof ErrorProveedor && (e.codigo === 'respuesta_vacia' || e.codigo === 'respuesta_truncada'))) throw e;
                }
            }
            return { proveedor, estado: ESTADOS_KEY.VALIDADA, http: 200, codigo: sondaSaldo ? 'ok_con_saldo' : 'ok', categoria: null, huella_key: huellaKey(key) };
        } catch (e) {
            const http = e?.http ?? null;
            return {
                proveedor,
                estado: keyRechazada({ http, categoria: e?.categoria }) ? ESTADOS_KEY.RECHAZADA : ESTADOS_KEY.NO_VERIFICABLE,
                http,
                codigo: e?.codigo || 'error_interno',
                categoria: e?.categoria || null,
                detalle: redactar(String(e?.detalle || e?.message || e), key).slice(0, 300),
                huella_key: huellaKey(key),
            };
        }
    }));
}

// Familias a excluir de la cadena: rechazadas POR AUTENTICACIÓN en la última
// validación Y con la MISMA key que hoy está en el entorno (huella). Rotar la
// key la reincorpora sola; una validación sin huella no excluye nada. Saldo o
// cuota NO excluyen: es la condición de soft-fail con opt-in (Axioma II.1) y
// se resuelve recargando, sin tocar la key — excluirla convertiría un fallo
// elegible a soft-fail en un bloqueo duro "todas_las_keys_rechazadas".
function familiasRechazadas(resultados, env = process.env) {
    return (resultados || [])
        .filter(v => v?.estado === ESTADOS_KEY.RECHAZADA && v.categoria === 'auth')
        .filter(v => v.huella_key && v.huella_key === huellaKey(keyDe(v.proveedor, env)))
        .map(v => v.proveedor);
}

// Caché del descubrimiento: archivo JSON (gate: agents/pmu/, app: logs/llm/)
// o memoria del proceso si no hay ruta. Atada a la huella de la key: rotar la
// key fuerza un listado nuevo.
const cacheMemoria = new Map();

function leerCache(cachePath) {
    if (!cachePath) return Object.fromEntries(cacheMemoria);
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')) || {}; } catch { return {}; }
}

function escribirCache(cachePath, proveedor, entrada) {
    if (!cachePath) { cacheMemoria.set(proveedor, entrada); return; }
    try {
        escribirBreaker(cachePath, { ...leerCache(cachePath), [proveedor]: entrada });
    } catch { /* caché best-effort: un disco de solo lectura no rompe la llamada */ }
}

// Catálogo ordenado de una familia, o null si no tiene key (se omite sin
// aviso). Listado fallido → caché vencida si existe para la misma key; si no,
// el error clasificado (la cadena pasa a la otra familia).
async function catalogo(proveedor, { env = process.env, fetchImpl = globalThis.fetch, cachePath = null, ahora = () => Date.now(), forzar = false } = {}) {
    const fijados = pinesDe(proveedor, env);
    if (fijados) return { modelos: fijados, origen: 'fijado' };
    const key = keyDe(proveedor, env);
    if (!key) return null;
    validarKey(configModelo(proveedor, '', env));
    const huella = huellaKey(key);
    const ttlMs = numeroEnRango(env.LLM_DESCUBRIMIENTO_TTL_H, [1, 168], TTL_DESCUBRIMIENTO_H_DEFAULT) * 3600 * 1000;
    const previa = leerCache(cachePath)[proveedor];
    const deEstaKey = previa && previa.huella_key === huella && Array.isArray(previa.modelos) && previa.modelos.length > 0;
    if (!forzar && deEstaKey && ahora() - Date.parse(previa.descubierto_en) < ttlMs) {
        return { modelos: previa.modelos, origen: 'cache' };
    }
    try {
        const modelos = filtrarModelos(proveedor, await listarModelos(proveedor, key, { fetchImpl }));
        if (modelos.length === 0) {
            throw new ErrorProveedor({ codigo: 'sin_modelos_descubiertos', categoria: 'politica', detalle: `El listado de ${proveedor} no devolvió ningún modelo ${PREFIJO_FAMILIA[proveedor]}* de texto.` });
        }
        escribirCache(cachePath, proveedor, { descubierto_en: new Date(ahora()).toISOString(), huella_key: huella, modelos });
        return { modelos, origen: 'descubierto' };
    } catch (e) {
        if (deEstaKey && e instanceof ErrorProveedor && !['auth', 'config'].includes(e.categoria)) {
            return { modelos: previa.modelos, origen: 'cache_vencida' };
        }
        throw e;
    }
}

// Modelos de una familia para una tarea: mejor modelo de cada gama del
// perfil, luego gamas nuevas (por recencia), luego el resto de gamas
// conocidas; como máximo MODELOS_POR_FAMILIA.
function seleccionarModelos(proveedor, modelos, tarea) {
    const perfil = PERFILES_TAREA[tarea]?.[proveedor];
    if (!perfil) {
        throw new ErrorProveedor({ codigo: 'tarea_desconocida', categoria: 'config', detalle: `Tarea "${String(tarea).slice(0, 40)}" sin perfil (${Object.keys(PERFILES_TAREA).join(' | ')}).` });
    }
    const mejorDe = (g) => modelos.find(m => m.gama === g);
    const elegidos = [
        ...perfil.map(mejorDe),
        ...modelos.filter(m => m.gama === 'otra'),
        ...GAMAS[proveedor].filter(g => !perfil.includes(g)).map(mejorDe),
    ].filter(Boolean).map(m => m.id);
    return [...new Set(elegidos)].slice(0, MODELOS_POR_FAMILIA);
}

// --- Cadena de conmutación (ADR-0004 §2.2; reglas de ADR-0002 §2.1) --------
// Claude (gamas del perfil) → Gemini (gamas del perfil). Cada eslabón salvo
// el último corre con contención: primer byte acotado
// (GATE_FAILOVER_PRIMER_BYTE_MS, 15 s por defecto) y un solo intento. Cada
// modelo tiene su propio breaker: uno abierto se salta al instante.
// Una falla del modelo (caída, cuota por tasa, contexto, respuesta vacía,
// modelo retirado) pasa al siguiente modelo. Una falla de la CUENTA (key
// revocada o mal configurada, saldo agotado) salta directo a la otra familia:
// ningún otro modelo con esa misma key lo arreglaría.
const FAILOVER_PRIMER_BYTE_DEFAULT_MS = 15000;
const FAILOVER_PRIMER_BYTE_RANGO_MS = Object.freeze([5000, 120000]);

const etiquetaModelo = (cfg) => `${cfg.proveedor}:${cfg.modelo}`;

function abortaFamilia(e) {
    return e.categoria === 'auth' || e.categoria === 'config' || /sin_saldo|_cuota$|http_402/.test(e.codigo);
}

function resolverPlazoFailover(env) {
    const crudo = String(env.GATE_FAILOVER_PRIMER_BYTE_MS ?? '').trim();
    if (!crudo) return FAILOVER_PRIMER_BYTE_DEFAULT_MS;
    const [min, max] = FAILOVER_PRIMER_BYTE_RANGO_MS;
    const ms = /^\d+$/.test(crudo) ? Number(crudo) : NaN;
    if (!(ms >= min && ms <= max)) {
        throw new ErrorProveedor({ codigo: 'failover_primer_byte_invalido', categoria: 'config', detalle: `GATE_FAILOVER_PRIMER_BYTE_MS="${crudo.slice(0, 20)}" fuera de rango (entero ${min}-${max} ms) — bloqueo duro.` });
    }
    return ms;
}

// Breaker propio por modelo: <breakerPath sin .json>.<proveedor>__<modelo>.json
function rutaBreakerModelo(breakerPath, cfg) {
    return breakerPath.replace(/\.json$/i, `.${cfg.proveedor}__${cfg.modelo.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
}

// Breakers persistidos junto a breakerPath (PMU): [{modelo, breaker}].
function breakersDe(breakerPath) {
    const dir = path.dirname(breakerPath);
    const base = path.basename(breakerPath).replace(/\.json$/i, '');
    let archivos = [];
    try { archivos = fs.readdirSync(dir); } catch { return []; }
    return archivos
        .filter(f => f.startsWith(`${base}.`) && f.endsWith('.json') && !f.endsWith('.tmp'))
        .map(f => {
            const b = leerBreaker(path.join(dir, f));
            return { modelo: b.modelo || f.slice(base.length + 1, -5).replace('__', ':'), breaker: b };
        });
}

// Única puerta a un modelo. opciones.tarea elige el perfil (default
// 'razonamiento': gate 002, subgates, 008). Devuelve {texto, uso, costo, fin,
// request_id, proveedor, modelo, intentos, failover}; lanza ErrorProveedor.
async function llamarModelo(mensaje, opciones = {}) {
    const env = opciones.env ?? process.env;
    const tarea = opciones.tarea ?? 'razonamiento';
    if (!PERFILES_TAREA[tarea]) {
        throw new ErrorProveedor({ codigo: 'tarea_desconocida', categoria: 'config', detalle: `Tarea "${String(tarea).slice(0, 40)}" sin perfil (${Object.keys(PERFILES_TAREA).join(' | ')}).` });
    }
    // Una familia sin key se omite sin aviso (ADR-0004 §2.4), aunque tenga pines.
    const conKey = PROVEEDORES.filter(p => keyDe(p, env));
    if (conKey.length === 0) {
        throw new ErrorProveedor({ codigo: 'sin_proveedor_ia', categoria: 'config', detalle: 'Ni ANTHROPIC_API_KEY ni GEMINI_API_KEY (o GOOGLE_API_KEY) configuradas — sin proveedor de IA.' });
    }
    // familiasExcluidas (2026-10-12, directiva PMUI Omega): familias cuya key
    // ya fue rechazada por su proveedor en la sonda previa (ver
    // familiasRechazadas). Se sacan de la cadena para que un fallo transitorio
    // del primario no termine en el error de auth del respaldo. Por defecto
    // ninguna — la app (LlmGateway) no la pasa.
    const excluidas = new Set(opciones.familiasExcluidas || []);
    const familias = conKey.filter(p => !excluidas.has(p));
    if (familias.length === 0) {
        throw new ErrorProveedor({ codigo: 'todas_las_keys_rechazadas', categoria: 'auth', detalle: `Todas las familias con key fueron rechazadas por su proveedor en la última validación (${conKey.join(', ')}) — reemplazar las keys en .env.` });
    }
    resolverTimeoutTotal(env); // config inválida = bloqueo antes de tocar la red
    const plazo = resolverPlazoFailover(env);
    const fallos = [];
    let ultimoError = null;

    // Candidatos por familia, perezosamente: si Claude responde, Gemini ni se lista.
    const listas = [];
    for (const proveedor of familias) listas.push({ proveedor, modelos: null });
    for (const [fi, fam] of listas.entries()) {
        try {
            const cat = await catalogo(fam.proveedor, { env, fetchImpl: opciones.fetchImpl ?? globalThis.fetch, cachePath: opciones.cachePath ?? null, ahora: opciones.ahora });
            fam.modelos = cat ? seleccionarModelos(fam.proveedor, cat.modelos, tarea) : [];
        } catch (e) {
            if (!(e instanceof ErrorProveedor)) throw e;
            ultimoError = e;
            fallos.push(`${fam.proveedor}:(catálogo)=${e.codigo}`);
            continue;
        }
        const quedanDespues = (mi) => mi < fam.modelos.length - 1 || listas.slice(fi + 1).length > 0;
        for (const [mi, modelo] of fam.modelos.entries()) {
            const cfg = configModelo(fam.proveedor, modelo, env);
            const op = { ...opciones, env, breakerPath: opciones.breakerPath ? rutaBreakerModelo(opciones.breakerPath, cfg) : undefined };
            if (quedanDespues(mi)) Object.assign(op, { primerByteMs: Math.min(opciones.primerByteMs ?? TIMEOUT_PRIMER_BYTE_MS, plazo), maxIntentos: 1 });
            try {
                const r = await llamarProveedor(cfg, mensaje, op);
                return { ...r, failover: fallos.length ? { desde: fallos[0].split('=')[0], hacia: etiquetaModelo(cfg), fallos: [...fallos] } : null };
            } catch (e) {
                if (!(e instanceof ErrorProveedor)) throw e;
                ultimoError = e;
                fallos.push(`${etiquetaModelo(cfg)}=${e.codigo}`);
                if (abortaFamilia(e)) break;
            }
        }
    }
    if (!ultimoError) {
        throw new ErrorProveedor({ codigo: 'sin_modelos_disponibles', categoria: 'config', detalle: `Ninguna familia tiene modelos para la tarea "${tarea}".` });
    }
    if (fallos.length <= 1) throw ultimoError;
    throw new ErrorProveedor({
        codigo: ultimoError.codigo, categoria: ultimoError.categoria, http: ultimoError.http, request_id: ultimoError.request_id,
        detalle: `${ultimoError.detalle} | cadena: ${fallos.join(', ')}`.slice(0, 500),
    });
}

// Alias histórico de la aplicación (LlmGateway): misma puerta, tarea explícita.
async function llamarPorTarea(mensaje, opciones = {}) {
    return llamarModelo(mensaje, opciones);
}

// Sonda: descubre (forzando el listado, sin caché) y hace un ping mínimo a
// cada modelo que alguna tarea elegiría. No toca los breakers. "vivo" = el
// modelo respondió aunque el presupuesto mínimo no alcanzara para texto.
async function sondearModelos(opciones = {}) {
    const env = opciones.env ?? process.env;
    const fetchImpl = opciones.fetchImpl ?? globalThis.fetch;
    const plazo = resolverPlazoFailover(env);
    const resultados = [];
    const descubiertos = {};
    for (const proveedor of PROVEEDORES) {
        if (!keyDe(proveedor, env)) { descubiertos[proveedor] = { key_configurada: false, modelos: [] }; continue; }
        const t0 = Date.now();
        let cat;
        try {
            cat = await catalogo(proveedor, { env, fetchImpl, cachePath: opciones.cachePath ?? null, forzar: true });
        } catch (e) {
            descubiertos[proveedor] = { key_configurada: true, modelos: [], error: e?.codigo || 'error_interno' };
            resultados.push({ modelo: `${proveedor}:(catálogo)`, vivo: false, ms: Date.now() - t0, codigo: e?.codigo || 'error_interno', categoria: e?.categoria || null, tareas: [] });
            continue;
        }
        descubiertos[proveedor] = { key_configurada: true, origen: cat.origen, modelos: cat.modelos.map(m => m.id) };
        const tareasPorModelo = new Map();
        for (const tarea of Object.keys(PERFILES_TAREA)) {
            for (const m of seleccionarModelos(proveedor, cat.modelos, tarea)) tareasPorModelo.set(m, [...(tareasPorModelo.get(m) || []), tarea]);
        }
        for (const [modelo, tareas] of tareasPorModelo) {
            const cfg = configModelo(proveedor, modelo, env);
            const t1 = Date.now();
            try {
                const r = await llamarProveedor(cfg, { system: 'Responde exactamente con la palabra OK.', user: 'ping', max_tokens: 64 }, {
                    env, fetchImpl, primerByteMs: plazo, maxIntentos: 1, deadlineMs: 90000,
                });
                resultados.push({ modelo: etiquetaModelo(cfg), vivo: true, ms: Date.now() - t1, codigo: 'ok', fin: r.fin, tareas });
            } catch (e) {
                const vivo = e instanceof ErrorProveedor && (e.codigo === 'respuesta_vacia' || e.codigo === 'respuesta_truncada');
                resultados.push({ modelo: etiquetaModelo(cfg), vivo, ms: Date.now() - t1, codigo: e?.codigo || 'error_interno', categoria: e?.categoria || null, tareas });
            }
        }
    }
    return { resultados, descubiertos };
}

// El breaker queda atado al modelo que lo abrió (regresión en vivo
// 2026-10-04): un archivo con otro "modelo" no hereda su circuito abierto.
function leerBreakerDe(breakerPath, cfg) {
    const b = leerBreaker(breakerPath);
    return b.modelo && b.modelo !== etiquetaModelo(cfg) ? { ...BREAKER_DEFAULT } : b;
}

// Un proveedor concreto: validación de key, breaker y reintentos.
async function llamarProveedor(cfg, { system, user, max_tokens }, opciones = {}) {
    const {
        env = process.env,
        fetchImpl = globalThis.fetch,
        breakerPath,
        ahora = () => Date.now(),
        sleep = dormir,
        timeoutMs = TIMEOUT_INACTIVIDAD_MS,
        primerByteMs = TIMEOUT_PRIMER_BYTE_MS,
        deadlineMs,
        aleatorio = Math.random,
        maxIntentos: topeIntentos = MAX_REINTENTOS + 1,
    } = opciones;

    const plazoTotalMs = deadlineMs ?? resolverTimeoutTotal(env);
    validarKey(cfg);

    const huella = huellaKey(cfg.key);
    const breaker = breakerPath ? leerBreakerDe(breakerPath, cfg) : { ...BREAKER_DEFAULT };
    const decision = evaluarBreaker(breaker, ahora(), huella);
    if (decision === 'rechazar') {
        const ult = breaker.ultimo_error || { codigo: 'desconocido', http: null };
        throw new ErrorProveedor({
            codigo: 'circuito_abierto',
            // Hereda la categoría que ABRIÓ el circuito: si fue auth/politica,
            // sigue siendo bloqueo duro (P3); si fue cuota/caida, soft-fail.
            // Sin categoría registrada → bloqueo duro por defecto.
            categoria: breaker.categoria_apertura || ult.categoria || 'solicitud',
            http: ult.http,
            detalle: `Circuit breaker abierto desde ${breaker.abierto_desde} (último error ${ult.codigo}) — no se llama al proveedor hasta el cooldown de ${breaker.cooldown_s}s.`,
        });
    }
    const maxIntentos = decision === 'permitir_prueba' ? 1 : Math.max(1, Math.min(topeIntentos, MAX_REINTENTOS + 1));

    let ultimoError;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            const r = await unIntento({ cfg, system, user, max_tokens, fetchImpl, timeoutMs, primerByteMs, deadlineMs: plazoTotalMs });
            // Relectura síncrona justo antes de escribir: con subgates en
            // paralelo (--aprobar-pendientes), otra llamada pudo actualizar el
            // breaker mientras esta esperaba la red. leer+escribir sin await
            // de por medio es atómico dentro del proceso (un solo hilo).
            if (breakerPath) escribirBreaker(breakerPath, { ...registrarExito(leerBreakerDe(breakerPath, cfg), ahora()), modelo: etiquetaModelo(cfg) });
            const uso = r.uso ?? estimarUso({ system, user, texto: r.texto, razonamientoChars: r.razonamiento_chars }, env);
            return { ...r, uso, costo: costoEnCOP(uso, cfg, env), proveedor: cfg.proveedor, modelo: cfg.modelo, intentos: intento };
        } catch (e) {
            ultimoError = e instanceof ErrorProveedor ? e : new ErrorProveedor({ codigo: 'error_interno', categoria: 'solicitud', detalle: redactar(e?.message || e, cfg.key).slice(0, 300) });
            if (intento < maxIntentos && esReintentable(ultimoError.categoria, ultimoError.codigo)) {
                await sleep(1000 * 2 ** (intento - 1) + Math.floor(aleatorio() * 500));
                continue;
            }
            break;
        }
    }
    if (breakerPath) {
        const actual = leerBreakerDe(breakerPath, cfg);
        if (decision === 'permitir_prueba') actual.estado = 'semiabierto'; // la prueba falló → reabre
        escribirBreaker(breakerPath, { ...registrarFallo(actual, ultimoError, ahora(), huella), modelo: etiquetaModelo(cfg) });
    }
    throw ultimoError;
}


module.exports = {
    BASE_URLS, PROVEEDORES, ANTHROPIC_VERSION, TIMEOUT_MS, MAX_REINTENTOS, BREAKER_DEFAULT,
    TIMEOUT_PRIMER_BYTE_MS, TIMEOUT_INACTIVIDAD_MS, TIMEOUT_TOTAL_DEFAULT_MS, TIMEOUT_TOTAL_RANGO_MS, resolverTimeoutTotal,
    ErrorProveedor, esElegibleSoftFail, esCritico, redactar, clasificarHttp, esReintentable,
    leerBreaker, escribirBreaker, evaluarBreaker, registrarExito, registrarFallo, alertasDeProveedor, huellaKey, breakerPublico, esErrorDeRed,
    extraerErrorEstructurado,
    keyDe, configModelo, proveedoresConKey, filtrarSecretosDiff, llamarProveedor, llamarModelo, llamarPorTarea, sondearModelos, etiquetaModelo,
    resolverPlazoFailover, rutaBreakerModelo, breakersDe, FAILOVER_PRIMER_BYTE_DEFAULT_MS, MARGEN_RAZONAMIENTO_GEMINI,
    clasificarModelo, ordenarModelos, filtrarModelos, seleccionarModelos, pinesDe, listarModelos, catalogo, PERFILES_TAREA, MODELOS_POR_FAMILIA,
    validarKeys, keyRechazada, familiasRechazadas, ESTADOS_KEY,
    estimarUso, costoEnCOP, tarifaDe, TARIFAS_USD_POR_MILLON, CARACTERES_POR_TOKEN_DEFAULT, TRM_COP_USD_DEFAULT,
};
