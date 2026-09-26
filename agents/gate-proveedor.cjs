// gate-proveedor.cjs — capa única de proveedor de IA del gate de arquitectura
// (ADR-0002, 2026-09-26). La usan 002 (pedirVeredictoArquitecto) y todos los
// subgates (pedirVeredictoSubagente) vía llamarModelo(); ningún otro punto del
// gate habla con un proveedor directamente.
//
// Principal: NVIDIA NIM (OpenAI-compatible, fetch nativo, sin dependencia
// nueva). Anthropic solo si GATE_PROVIDER=anthropic explícito — NUNCA como
// cascada automática ante una falla de NIM: caer a un proveedor de pago cuando
// el gratuito falla es exactamente el riesgo de cobro que este módulo existe
// para cortar.
//
// Sin efectos secundarios al requerir: no lee .env (lo hace el gate), no toca
// disco ni red hasta que se llama una función.

const fs = require('fs');
const path = require('path');

const NIM_BASE_URL_OFICIAL = 'https://integrate.api.nvidia.com/v1';
const GATE_MODEL_DEFAULT = 'deepseek-ai/deepseek-v4.1-flash';
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
        .replace(/nvapi-[A-Za-z0-9_-]{8,}/g, 'nvapi-[REDACTED]')
        .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED]');
}

// Campos estructurados del cuerpo de error, sin depender del texto humano.
// Formatos soportados: OpenAI-compatible (NIM) {error:{code,type,message}},
// Anthropic {type:'error', error:{type,message}}, problem+json de NVCF
// {status,title,detail,type}. `cuerpo` puede ser string (JSON o texto) u
// objeto ya parseado (SDK de Anthropic: e.error).
function extraerErrorEstructurado(cuerpo) {
    let obj = cuerpo;
    if (typeof cuerpo === 'string') {
        try { obj = JSON.parse(cuerpo); } catch { obj = null; }
    }
    if (!obj || typeof obj !== 'object') return { codes: [], texto: String(cuerpo ?? '') };
    const err = (obj.error && typeof obj.error === 'object') ? obj.error : obj;
    const codes = [err.code, err.type, obj.code, obj.type !== 'error' ? obj.type : null]
        .filter(v => typeof v === 'string' && v.trim())
        .map(v => v.trim().toLowerCase());
    const texto = [err.message, obj.detail, obj.title, obj.message].filter(v => typeof v === 'string').join(' ');
    return { codes, texto };
}

const CODIGOS_CUOTA = new Set(['insufficient_quota', 'quota_exceeded', 'billing_error', 'billing_hard_limit_reached', 'credit_balance_too_low', 'payment_required']);
const CODIGOS_POLITICA = new Set(['model_not_found', 'not_found_error', 'model_not_available', 'model_deprecated', 'deprecated_model']);
const CODIGOS_AUTH = new Set(['authentication_error', 'permission_error', 'invalid_api_key', 'unauthorized', 'forbidden']);

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
            ? 'Verificar NVIDIA_API_KEY / modelo en build.nvidia.com — el gate bloquea hasta corregirlo.'
            : 'Proveedor degradado — el gate opera en soft-fail autorizado hasta que el breaker cierre.',
    }];
}

// --- Configuración -----------------------------------------------------------

const ANTHROPIC_BASE_URL_OFICIAL = 'https://api.anthropic.com';
// Solo ASCII imprimible sin espacios (hallazgo 008): una key con un carácter
// no-ByteString hacía que fetch lanzara TypeError → mal clasificado como
// caída de red → soft-fail. Una key malformada es error de configuración.
const KEY_VALIDA = { nim: /^nvapi-[\x21-\x7E]{8,}$/, anthropic: /^[\x21-\x7E]{8,}$/ };

function resolverConfig(env = process.env) {
    const proveedor = (env.GATE_PROVIDER || 'nim').trim().toLowerCase();
    if (proveedor === 'anthropic') {
        // Hallazgo crítico 008 (2026-09-26): el SDK de Anthropic lee
        // ANTHROPIC_BASE_URL de process.env por su cuenta — un host falso
        // podía devolver {"aprobado":true} (api_directa forjado) y recibir
        // la key. No oficial = bloqueo duro; además baseURL se fija explícito.
        const base = (env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, '');
        if (base && base !== ANTHROPIC_BASE_URL_OFICIAL) {
            throw new ErrorProveedor({ codigo: 'base_url_no_oficial', categoria: 'config', detalle: `ANTHROPIC_BASE_URL apunta a "${base}", no a ${ANTHROPIC_BASE_URL_OFICIAL} — bloqueo duro.` });
        }
        return { proveedor, modelo: env.PRIMARY_AI_MODEL || 'claude-sonnet-4-6', key: env.ANTHROPIC_API_KEY || '', baseUrl: ANTHROPIC_BASE_URL_OFICIAL };
    }
    if (proveedor !== 'nim') {
        throw new ErrorProveedor({ codigo: 'proveedor_desconocido', categoria: 'config', detalle: `GATE_PROVIDER="${proveedor}" no soportado (nim | anthropic).` });
    }
    const baseUrl = (env.GATE_NIM_BASE_URL || NIM_BASE_URL_OFICIAL).trim().replace(/\/+$/, '');
    if (baseUrl !== NIM_BASE_URL_OFICIAL) {
        throw new ErrorProveedor({ codigo: 'base_url_no_oficial', categoria: 'config', detalle: `GATE_NIM_BASE_URL apunta a "${baseUrl}", no a ${NIM_BASE_URL_OFICIAL} — bloqueo duro.` });
    }
    return { proveedor, modelo: (env.GATE_MODEL || GATE_MODEL_DEFAULT).trim(), key: env.NVIDIA_API_KEY || '', baseUrl };
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

// Lee un stream SSE OpenAI-compatible. `latido()` se llama con cada fragmento
// recibido (reinicia el reloj de inactividad); los fragmentos de razonamiento
// (delta.reasoning_content) y los comentarios ": keep-alive" cuentan como
// vida aunque no aporten texto. Un stream que se corta sin finish_reason ni
// [DONE] es una caída de conexión, no una respuesta.
async function leerSSE(body, latido, signal, cfg, request_id) {
    const reader = body.getReader();
    const abortado = new Promise((_, rej) => {
        const f = () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) f(); else signal.addEventListener('abort', f, { once: true });
    });
    abortado.catch(() => {});
    const dec = new TextDecoder();
    let buf = '';
    let texto = '';
    let razonamientoChars = 0;
    let fin = null;
    let uso = null;
    let hecho = false;
    const procesarLinea = (linea) => {
        if (!linea.startsWith('data:')) return;
        const dato = linea.slice(5).trim();
        if (!dato) return;
        if (dato === '[DONE]') { hecho = true; return; }
        let ev;
        try { ev = JSON.parse(dato); } catch {
            throw new ErrorProveedor({ codigo: 'respuesta_no_json', categoria: 'solicitud', http: 200, detalle: redactar(dato, cfg.key).slice(0, 300), request_id });
        }
        if (ev.error) {
            // Error emitido a mitad del stream: misma clasificación
            // estructurada que un 400 (auth/cuota/politica); lo no
            // reconocido es bloqueo duro.
            const cls = clasificarHttp(400, ev);
            throw new ErrorProveedor({ codigo: `stream_${cls.codigo}`, categoria: cls.categoria, http: 200, detalle: redactar(JSON.stringify(ev.error), cfg.key).slice(0, 300), request_id });
        }
        const ch = ev.choices?.[0];
        if (typeof ch?.delta?.content === 'string') texto += ch.delta.content;
        if (typeof ch?.delta?.reasoning_content === 'string') razonamientoChars += ch.delta.reasoning_content.length;
        if (ch?.finish_reason) fin = ch.finish_reason;
        if (ev.usage) uso = { prompt_tokens: ev.usage.prompt_tokens ?? null, completion_tokens: ev.usage.completion_tokens ?? null };
    };
    try {
        while (!hecho) {
            const { value, done } = await Promise.race([reader.read(), abortado]);
            if (done) break;
            latido();
            buf += dec.decode(value, { stream: true });
            let i;
            while (!hecho && (i = buf.indexOf('\n')) >= 0) {
                const linea = buf.slice(0, i).replace(/\r$/, '');
                buf = buf.slice(i + 1);
                procesarLinea(linea);
            }
        }
        if (!hecho && buf.trim()) procesarLinea(buf.trim());
    } finally {
        reader.cancel().catch(() => {});
    }
    if (!hecho && !fin) {
        throw new ErrorProveedor({ codigo: 'stream_incompleto', categoria: 'caida', http: 200, detalle: `El stream se cerró sin finish_reason ni [DONE] tras ${texto.length} caracteres`, request_id });
    }
    return { texto, fin, uso, razonamientoChars };
}

async function unIntentoNim({ cfg, system, user, max_tokens, fetchImpl, timeoutMs, primerByteMs, deadlineMs }) {
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
    let res;
    let cuerpo = null;
    let sse = null;
    let request_id = null;
    // Los relojes cubren también la lectura del cuerpo (hallazgo 008: un
    // servidor que manda cabeceras y se calla colgaba el pre-commit).
    try {
        res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.key}`,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream, application/json',
            },
            body: JSON.stringify({
                model: cfg.modelo,
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                max_tokens,
                temperature: 0.2,
                stream: true,
            }),
            signal: ctrl.signal,
        });
        latido();
        request_id = res.headers?.get?.('nvcf-reqid') || res.headers?.get?.('x-request-id') || null;
        const tipo = String(res.headers?.get?.('content-type') || '');
        // SSE solo si el servidor lo honró; un error HTTP o un servidor que
        // ignora stream:true responde JSON y sigue el camino clásico.
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
    let texto;
    let fin;
    let uso;
    let razonamientoChars = null;
    if (sse) {
        ({ texto, fin, uso, razonamientoChars } = sse);
    } else {
        let json;
        try {
            json = JSON.parse(cuerpo);
        } catch {
            throw new ErrorProveedor({ codigo: 'respuesta_no_json', categoria: 'solicitud', http: res.status, detalle: redactar(cuerpo, cfg.key).slice(0, 300), request_id });
        }
        const choice = json.choices?.[0] || {};
        texto = choice.message?.content;
        fin = choice.finish_reason ?? null;
        uso = json.usage ? { prompt_tokens: json.usage.prompt_tokens ?? null, completion_tokens: json.usage.completion_tokens ?? null } : null;
    }
    // content null/vacío (modelo de razonamiento que no emitió respuesta, o
    // corte por longitud) → código propio y bloqueo duro, no un "no
    // parseable" genérico (hallazgo 008).
    if (!texto) {
        throw new ErrorProveedor({ codigo: fin === 'length' ? 'respuesta_truncada' : 'respuesta_vacia', categoria: 'solicitud', http: res.status, detalle: `finish_reason=${fin ?? 'null'}, content vacío`, request_id });
    }
    // razonamiento_chars/texto_chars: diagnóstico de a dónde se va max_tokens
    // (FinOps + calibración; nunca contenido, solo longitudes).
    return { texto, uso, fin: fin ?? null, request_id, razonamiento_chars: razonamientoChars, texto_chars: texto.length };
}

async function unIntentoAnthropic({ cfg, system, user, max_tokens, deadlineMs }) {
    const Anthropic = require('@anthropic-ai/sdk');
    try {
        const client = new Anthropic({ apiKey: cfg.key, baseURL: cfg.baseUrl, timeout: deadlineMs, maxRetries: 0 });
        const r = await client.messages.create({ model: cfg.modelo, max_tokens, system, messages: [{ role: 'user', content: user }] });
        return { texto: r.content?.[0]?.text ?? '', uso: r.usage ? { prompt_tokens: r.usage.input_tokens, completion_tokens: r.usage.output_tokens } : null, fin: r.stop_reason, request_id: r._request_id || null };
    } catch (e) {
        if (typeof e?.status === 'number') {
            // e.error = cuerpo ya parseado por el SDK (campos estructurados);
            // e.message como respaldo si el SDK no lo expuso.
            const cls = clasificarHttp(e.status, e.error ?? e.message);
            throw new ErrorProveedor({ ...cls, http: e.status, detalle: redactar(e.message, cfg.key).slice(0, 300), request_id: e.requestID || null });
        }
        // Solo un error de conexión real del SDK es caída; cualquier otra
        // excepción (bug, argumento inválido) es bloqueo duro.
        const conexion = e instanceof Anthropic.APIConnectionError;
        throw new ErrorProveedor({ codigo: conexion ? 'sin_respuesta' : 'error_cliente', categoria: conexion ? 'caida' : 'solicitud', detalle: redactar(e?.message || e, cfg.key).slice(0, 300) });
    }
}

// Única puerta a un modelo. Devuelve {texto, uso, fin, request_id, proveedor,
// modelo, intentos}; lanza ErrorProveedor en cualquier falla.
async function llamarModelo({ system, user, max_tokens }, opciones = {}) {
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
    } = opciones;

    const cfg = resolverConfig(env);
    const plazoTotalMs = deadlineMs ?? resolverTimeoutTotal(env);
    if (!cfg.key) {
        throw new ErrorProveedor({
            codigo: cfg.proveedor === 'nim' ? 'NVIDIA_API_KEY_ausente' : 'ANTHROPIC_API_KEY_ausente',
            categoria: 'config',
            detalle: `${cfg.proveedor === 'nim' ? 'NVIDIA_API_KEY' : 'ANTHROPIC_API_KEY'} no configurada en .env — bloqueo duro (error de configuración, no de disponibilidad).`,
        });
    }
    if (!KEY_VALIDA[cfg.proveedor].test(cfg.key)) {
        throw new ErrorProveedor({
            codigo: cfg.proveedor === 'nim' ? 'NVIDIA_API_KEY_malformada' : 'ANTHROPIC_API_KEY_malformada',
            categoria: 'config',
            detalle: `La key del proveedor ${cfg.proveedor} no tiene formato válido (ASCII imprimible sin espacios${cfg.proveedor === 'nim' ? ', prefijo nvapi-' : ''}) — bloqueo duro.`,
        });
    }

    const huella = huellaKey(cfg.key);
    const breaker = breakerPath ? leerBreaker(breakerPath) : { ...BREAKER_DEFAULT };
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
    const maxIntentos = decision === 'permitir_prueba' ? 1 : MAX_REINTENTOS + 1;

    let ultimoError;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            const r = cfg.proveedor === 'nim'
                ? await unIntentoNim({ cfg, system, user, max_tokens, fetchImpl, timeoutMs, primerByteMs, deadlineMs: plazoTotalMs })
                : await unIntentoAnthropic({ cfg, system, user, max_tokens, deadlineMs: plazoTotalMs });
            // Relectura síncrona justo antes de escribir: con subgates en
            // paralelo (--aprobar-pendientes), otra llamada pudo actualizar el
            // breaker mientras esta esperaba la red. leer+escribir sin await
            // de por medio es atómico dentro del proceso (un solo hilo).
            if (breakerPath) escribirBreaker(breakerPath, registrarExito(leerBreaker(breakerPath), ahora()));
            return { ...r, proveedor: cfg.proveedor, modelo: cfg.modelo, intentos: intento };
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
        const actual = leerBreaker(breakerPath);
        if (decision === 'permitir_prueba') actual.estado = 'semiabierto'; // la prueba falló → reabre
        escribirBreaker(breakerPath, registrarFallo(actual, ultimoError, ahora(), huella));
    }
    throw ultimoError;
}

module.exports = {
    NIM_BASE_URL_OFICIAL, GATE_MODEL_DEFAULT, TIMEOUT_MS, MAX_REINTENTOS, BREAKER_DEFAULT,
    TIMEOUT_PRIMER_BYTE_MS, TIMEOUT_INACTIVIDAD_MS, TIMEOUT_TOTAL_DEFAULT_MS, TIMEOUT_TOTAL_RANGO_MS, resolverTimeoutTotal,
    ErrorProveedor, esElegibleSoftFail, esCritico, redactar, clasificarHttp, esReintentable,
    leerBreaker, escribirBreaker, evaluarBreaker, registrarExito, registrarFallo, alertasDeProveedor, huellaKey, breakerPublico, esErrorDeRed,
    extraerErrorEstructurado,
    resolverConfig, filtrarSecretosDiff, llamarModelo,
};
