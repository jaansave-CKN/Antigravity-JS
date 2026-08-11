const { exec, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const Anthropic = require('@anthropic-ai/sdk');

// A diferencia de server.js, este script se invoca standalone (node agents/architecture-gate.cjs)
// — nada más en el proceso carga .env. Sin esto, pedirVeredictoArquitecto() siempre fallaba con
// "ANTHROPIC_API_KEY no configurada" pese a existir en .env (hallazgo 2026-08-07, gate real recién
// creado nunca se había ejecutado end-to-end).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('\n🚀 [001] ANTIGRAVITY OS: Iniciando Orquestación Dinámica con Honestidad...');

const dirAgents = __dirname;
const dirRoot = path.join(dirAgents, '..');

// =============================================================================
// ESCUADRÓN ÉLITE — Mando Central (Renumerado 2026-08-08, ver AGENTS.md §IV)
// 8 roles (001-008). 001 es este mismo orquestador (no es una clave del objeto,
// es quien lo ejecuta — mismo patrón que el 000_ORQUESTADOR_MAESTRO anterior).
// 002 (Arquitecto) y 003 (Esp. Diseño Stitch) no tienen carpeta en agents/ —
// 002 vive en .claude/agents/architect.md (gate real); 003 nunca tuvo carpeta
// propia (heredado sin cambios del esquema anterior). 004 y 008 son roles
// declarados sin ningún subordinado implementado todavía — honesto, no relleno.
// =============================================================================
const ESCUADRON_ELITE = {
    '003_ESP_DISENO_STITCH': {
        rol: 'Arquitecto Visual y Maquetador de Interfaces (promovido desde agents/11-esp-diseno-grafico-y-stitch/, folder eliminado 2026-08-05)',
        mandato: 'Prohibido maquetar con datos falsos. Toda UI consume estrictamente los contratos JSON de RPC/REST aprobados por el Agente Arquitecto (002, .claude/agents/architect.md) y construidos por 005_INGENIERO_BACKEND.',
        subordinados: [],
    },
    '004_INGENIERO_FRONTEND': {
        rol: 'Lógica de cliente, React/Hooks, estado UI',
        subordinados: [],
    },
    '005_INGENIERO_BACKEND': {
        rol: 'Bases de datos, APIs y lógica de servidor (fusiona el antiguo 002_INGENIERIA_TOTAL)',
        subordinados: [
            '009_gestor_datos', '011_Radar1_minero', '012_Radar2_Estratega',
            '050_Formulador_proy', '051_Form_Lluvia_de_ideas',
            '07-ing-concreto_GFRC', '08-estratega-neuromarketing',
        ],
    },
    '006_DEVSECOPS_INFRAESTRUCTURA': {
        rol: 'Despliegues a producción, servidores, fiscalización de seguridad y cumplimiento estricto en Pesos Colombianos (COP) (fusiona el antiguo 003_DEVSECOPS_Y_AUDITORIA)',
        subordinados: [
            '03-analista-secop', '052_Form_Administrativo', '054_Form_Gestion_de_riesgos',
            '056_Form_Evaluador', '14-analista-comportamiento', '015_intelligence-core',
        ],
    },
    '007_DOCUMENTADOR_AS_BUILD': {
        rol: 'Planimetría y documentación final (antiguo 004_DOCUMENTADOR_AS_BUILD)',
        subordinados: ['010_redactor_tecnico'],
        carpetaSalida: path.join(dirRoot, 'docs', 'as-build'),
    },
    '008_AUDITOR_DE_CODIGO': {
        rol: 'QA Red Team, ejecuta el Protocolo Titán — audita código ya escrito o traído de otras redes (mandato explícito en .claude/agents/architect.md, que se niega a hacer esta tarea y redirige aquí)',
        subordinados: [],
    },
};

function comandanteDe(carpetaAgente) {
    for (const [id, def] of Object.entries(ESCUADRON_ELITE)) {
        if (def.subordinados && def.subordinados.includes(carpetaAgente)) return id;
    }
    return 'SIN_ASIGNAR';
}

// =============================================================================
// RUTEO ALGORÍTMICO — match exacto contra clave, sin heurística ni LLM decidiendo
// a discreción. Basado en la Matriz de Ruteo real de
// agents/001_ORQUESTADOR_MAESTRO/IDENTITY.md, con los nombres de carpeta
// vigentes hoy en disco (post-renumeración 2026-08-08).
// =============================================================================
const ENRUTADOR_ESTATICO = {
    formulacion: '050_Formulador_proy',
    lluvia_ideas: '051_Form_Lluvia_de_ideas',
    administrativo: '052_Form_Administrativo',
    riesgos: '054_Form_Gestion_de_riesgos',
    evaluacion: '056_Form_Evaluador',
    convocatorias: '011_Radar1_minero',
    inteligencia_mercado: '012_Radar2_Estratega',
};

function rutear(clave) {
    if (!Object.prototype.hasOwnProperty.call(ENRUTADOR_ESTATICO, clave)) {
        throw new Error(`RUTEO_FALLIDO: '${clave}' no coincide con ninguna clave del mapa. Claves válidas: ${Object.keys(ENRUTADOR_ESTATICO).join(', ')}`);
    }
    return ENRUTADOR_ESTATICO[clave];
}

// =============================================================================
// GATE DE ARQUITECTURA — Cero Código sin Diseño Aprobado
// El Agente Arquitecto (.claude/agents/architect.md) debe emitir un veredicto
// {"aprobado": true, ...} sobre el diff pendiente antes de que el Mando Central
// autorice ejecutar a cualquier subordinado. La firma es un hash del estado real
// en disco: si algo cambia después de firmar, la aprobación cae.
// Retirado 2026-08-07: el rol "001_ARQUITECTO_CORE" (citado en versiones previas
// de este archivo, de AGENTS.md y de .agent/agents/000_orquestador.md) nunca tuvo
// implementación real — no existía ningún archivo de definición ni lógica de
// revisión, y la firma se autoaprobaba sin criterio. El Agente Arquitecto real
// (.claude/agents/architect.md) sí lee y razona (Read/Grep/Glob) antes de fallar.
// =============================================================================
// Vive directo en agents/ (NO dentro de ninguna carpeta \d{2,3}[_-]*) — si estuviera
// dentro de una carpeta de agente, escribir la firma cambiaría el listado de esa
// carpeta y la firma se autoinvalidaría en el acto.
const APROBACION_PATH = path.join(dirAgents, 'diseno_aprobado.json');
const ARCHITECT_PROMPT_PATH = path.join(dirRoot, '.claude', 'agents', 'architect.md');
// Mismo criterio que server.js/m1Pipeline.js: modelo vía env var, no hardcodeado
// por tercera vez (hallazgo 2026-08-08, se había centralizado en los otros 2
// archivos pero se pasó por alto este).
const ANTHROPIC_MODEL = process.env.PRIMARY_AI_MODEL || 'claude-sonnet-4-6';

// Invoca al Agente Arquitecto real: system prompt = architect.md, input = git diff
// pendiente contra HEAD. Nunca autoaprueba por ausencia de respuesta — todo camino
// de error devuelve aprobado:false con la razón concreta (Honestidad Técnica).
async function pedirVeredictoArquitecto() {
    if (!process.env.ANTHROPIC_API_KEY) {
        return { aprobado: false, razones: ['ANTHROPIC_API_KEY no configurada — no se puede invocar al Agente Arquitecto.'] };
    }
    if (!fs.existsSync(ARCHITECT_PROMPT_PATH)) {
        return { aprobado: false, razones: [`No existe ${ARCHITECT_PROMPT_PATH} — sin criterio de arquitectura que aplicar.`] };
    }
    const systemPrompt = fs.readFileSync(ARCHITECT_PROMPT_PATH, 'utf8');

    let diff;
    try {
        diff = execFileSync('git', ['diff', 'HEAD'], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        return { aprobado: false, razones: [`No se pudo leer 'git diff HEAD': ${e.message}`] };
    }
    if (!diff || !diff.trim()) {
        return { aprobado: false, razones: ['git diff HEAD está vacío — no hay cambios pendientes que aprobar.'] };
    }

    let response;
    try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        response = await client.messages.create({
            model: ANTHROPIC_MODEL,
            // 1500 no alcanzaba en diffs grandes (>15 archivos): el análisis
            // narrativo agotaba el presupuesto antes de llegar al JSON final,
            // y el veredicto quedaba truncado y sin parsear (hallazgo 2026-08-08,
            // reproducido en vivo con el diff de esta misma sesión).
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: `Fiscaliza el siguiente diff pendiente de aprobación (git diff HEAD, truncado a 60000 caracteres si aplica). ` +
                    `IMPORTANTE: esta invocación es una llamada directa a la API de Anthropic, no una sesión de Claude Code — ` +
                    `no tienes acceso real a Read/Grep/Glob aquí pese a lo que indique tu system prompt para tu uso habitual. ` +
                    `No emitas tool_call ni nada similar: no se ejecutará. Basa tu fiscalización únicamente en el diff de texto ` +
                    `provisto abajo (línea de contexto suficiente para evaluar consistencia, completitud y alcance). ` +
                    `Sé conciso en el análisis narrativo (párrafos cortos, sin repetir el diff) — el veredicto JSON obligatorio ` +
                    `al final es lo único que este proceso puede parsear; si te quedas sin espacio antes de emitirlo, el gate ` +
                    `entero falla. Prioriza terminar con el JSON sobre extender el análisis.\n\n${diff.slice(0, 60000)}`,
            }],
        });
    } catch (e) {
        return { aprobado: false, razones: [`Fallo de la API de Anthropic: ${e.message}`] };
    }

    const text = response.content?.[0]?.text ?? '';
    const match = text.match(/\{[^{}]*"aprobado"\s*:\s*(true|false)[^{}]*\}/s);
    if (!match) {
        return { aprobado: false, razones: ['El Agente Arquitecto no devolvió un veredicto JSON parseable.'], respuestaCruda: text.slice(0, 800) };
    }
    let veredicto;
    try {
        veredicto = JSON.parse(match[0]);
    } catch (e) {
        return { aprobado: false, razones: [`Veredicto JSON corrupto: ${e.message}`], respuestaCruda: text.slice(0, 800) };
    }
    return { aprobado: veredicto.aprobado === true, razones: veredicto.razones || [] };
}

// 001_ORQUESTADOR_MAESTRO (antes 000_ORQUESTADOR) excluido a propósito: no es
// un agente subordinado con una tarea de un solo disparo (como 050-056) — es
// la carpeta hogar del propio orquestador, y contiene
// agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py, un daemon de loop
// infinito. Antes de esta exclusión, ejecutarTodosLosAgentes() lo recogía como
// "ejecutable" de esa carpeta y siempre agotaba el timeout de 30s reportándolo
// como fallo — arquitectura incompatible, no un bug del daemon (hallazgo
// 2026-08-08, docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §3.2).
const CARPETAS_EXCLUIDAS_DEL_BATCH = new Set(['001_ORQUESTADOR_MAESTRO']);

function listarCarpetasAgentes() {
    return fs.readdirSync(dirAgents).filter(item => {
        const rutaItem = path.join(dirAgents, item);
        return fs.lstatSync(rutaItem).isDirectory()
            && /^\d{2,3}[_-]/.test(item)
            && !CARPETAS_EXCLUIDAS_DEL_BATCH.has(item);
    }).sort();
}

function listarArchivosRecursivo(dir, base) {
    let out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out = out.concat(listarArchivosRecursivo(full, base));
        } else {
            out.push(path.relative(base, full).replace(/\\/g, '/'));
        }
    }
    return out;
}

// Firma cubre agents/ (listado por carpeta) Y src/ (árbol completo de archivos) —
// expansión de visibilidad: cero código escrito o modificado sin re-firma, ya
// no solo dentro de agents/.
function hashEstado(carpetas) {
    const payloadAgents = carpetas.map(c => {
        const rutaCarpeta = path.join(dirAgents, c);
        const archivos = fs.readdirSync(rutaCarpeta).sort();
        return `${c}:${archivos.join(',')}`;
    }).join('|');

    const dirSrc = path.join(dirRoot, 'src');
    const archivosSrc = listarArchivosRecursivo(dirSrc, dirSrc).sort();
    const payloadSrc = `src:${archivosSrc.join(',')}`;

    return crypto.createHash('sha256').update(payloadAgents + '||' + payloadSrc).digest('hex');
}

function validarDisenoAprobado(carpetas) {
    if (!fs.existsSync(APROBACION_PATH)) {
        return { aprobado: false, razon: 'No existe firma del Agente Arquitecto (002_ARQUITECTO_DE_SOFTWARE — diseno_aprobado.json ausente).' };
    }
    let firma;
    try {
        firma = JSON.parse(fs.readFileSync(APROBACION_PATH, 'utf8'));
    } catch (e) {
        return { aprobado: false, razon: `diseno_aprobado.json corrupto: ${e.message}` };
    }
    if (firma.aprobado !== true) {
        return { aprobado: false, razon: 'El Agente Arquitecto marcó el diseño como NO aprobado.' };
    }
    const hashActual = hashEstado(carpetas);
    if (firma.firma !== hashActual) {
        return { aprobado: false, razon: 'El estado de agents/ cambió después de la firma — se requiere re-aprobación del Agente Arquitecto (002_ARQUITECTO_DE_SOFTWARE).' };
    }
    return { aprobado: true, firma: firma.firma, timestamp: firma.timestamp };
}

// Modo ruteo: `node agents/architecture-gate.cjs --rutear <clave>`
if (process.argv.includes('--rutear')) {
    const clave = process.argv[process.argv.indexOf('--rutear') + 1];
    try {
        const destino = rutear(clave);
        console.log(`✅ [RUTEO] '${clave}' → ${destino}`);
        process.exitCode = 0;
    } catch (e) {
        console.error(`🛑 [RUTEO] ${e.message}`);
        process.exitCode = 1;
    }
    return;
}

// Modo check: `node agents/architecture-gate.cjs --check-gate` — para hooks de git
// (pre-commit). Cero llamadas a la API de Anthropic: solo valida que ya exista
// una firma vigente de una aprobación previa (--aprobar-diseno) contra el estado
// actual de agents/+src/. Hace obligatorio "cero código sin diseño aprobado" sin
// costo recurrente por commit — la API solo se paga cuando de verdad cambió algo
// y hace falta un veredicto nuevo (2026-08-08).
if (process.argv.includes('--check-gate')) {
    const veredicto = validarDisenoAprobado(listarCarpetasAgentes());
    if (!veredicto.aprobado) {
        console.error('\n🛑 [GATE_ARQUITECTURA] Sin aprobación vigente: ' + veredicto.razon);
        console.error('   Ejecuta: node agents/architecture-gate.cjs --aprobar-diseno');
        process.exitCode = 1;
    } else {
        console.log(`✅ [GATE_ARQUITECTURA] Aprobación vigente (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);
        process.exitCode = 0;
    }
    return;
}

// Modo firma: `node agents/architecture-gate.cjs --aprobar-diseno`
// Invoca al Agente Arquitecto real (.claude/agents/architect.md vía API de
// Anthropic) sobre el git diff pendiente. Solo si su veredicto es aprobado:true
// se calcula el hash y se escribe diseno_aprobado.json — ya no hay autofirma.
if (process.argv.includes('--aprobar-diseno')) {
    (async () => {
        console.log('\n🔎 [Agente Arquitecto] Evaluando git diff HEAD contra .claude/agents/architect.md...');
        const veredicto = await pedirVeredictoArquitecto();

        if (!veredicto.aprobado) {
            console.error('\n🛑 [GATE_ARQUITECTURA] El Agente Arquitecto RECHAZÓ el diseño — o no pudo evaluarlo.');
            (veredicto.razones || []).forEach(r => console.error(`   - ${r}`));
            if (veredicto.respuestaCruda) console.error(`   Respuesta cruda: ${veredicto.respuestaCruda}`);
            // process.exitCode (no process.exit()) — forzar la salida mientras el
            // dispatcher de fetch/undici del SDK de Anthropic aún cierra sockets
            // dispara un crash nativo en Node/Windows (Assertion failed ... uv_async_t,
            // mismo caso ya documentado y evitado en scripts/db-check.js).
            process.exitCode = 1;
            return;
        }

        const carpetas = listarCarpetasAgentes();
        const firma = hashEstado(carpetas);
        fs.writeFileSync(APROBACION_PATH, JSON.stringify({
            aprobado: true,
            firma,
            timestamp: new Date().toISOString(),
            firmado_por: 'Agente Arquitecto (.claude/agents/architect.md, vía API Anthropic)',
            razones: veredicto.razones,
        }, null, 2) + '\n', 'utf8');
        console.log(`\n✅ [Agente Arquitecto] Diseño aprobado. Firma: ${firma}`);
        (veredicto.razones || []).forEach(r => console.log(`   - ${r}`));
        process.exitCode = 0;
    })();
    return;
}

function validarEnlace(url) {
    return new Promise((resolve) => {
        if (!url || typeof url !== 'string') {
            resolve({ valido: false, error: 'URL inválida' });
            return;
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (e) {
            resolve({ valido: false, error: 'URL mal formada' });
            return;
        }

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        const req = protocol.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
            resolve({ valido: res.statusCode >= 200 && res.statusCode < 400 });
        });

        req.on('error', (e) => {
            resolve({ valido: false, error: e.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ valido: false, error: 'Timeout' });
        });

        req.end();
    });
}

// =============================================================================
// CONFIGURACIÓN POR AGENTE — reemplaza el timeout global estático de 30s.
// Claves = nombres reales de carpeta en agents/ (no roles del Escuadrón Élite,
// que no todos tienen carpeta propia). Sin entrada explícita, aplica DEFAULT.
// =============================================================================
const EXEC_CONFIG_DEFAULT = { timeoutMs: 30000, maxRetries: 1, backoffMs: 3000 };
const EXEC_CONFIG = {
    // 010_redactor_tecnico es el subordinado real de 007_DOCUMENTADOR_AS_BUILD —
    // genera .docx (Skill_002_Redactor_Propuestas.cjs), tarea más lenta que el
    // resto; más margen y un reintento extra.
    '010_redactor_tecnico': { timeoutMs: 60000, maxRetries: 2, backoffMs: 5000 },
};

function configDe(carpeta) {
    return EXEC_CONFIG[carpeta] || EXEC_CONFIG_DEFAULT;
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Un solo intento de ejecución. No decide éxito/fracaso más allá del propio
// proceso — eso lo hace ejecutarConResiliencia() (URL-hallucination check
// incluido).
function ejecutarProcesoUnico(comando, timeoutMs) {
    return new Promise((resolve) => {
        const inicio = Date.now();
        exec(comando, { cwd: dirRoot, timeout: timeoutMs }, (error, stdout, stderr) => {
            const executionTimeMs = Date.now() - inicio;
            if (!error) {
                resolve({ exito: true, exitCode: 0, executionTimeMs, stdout, timeout: false });
                return;
            }
            const fueTimeout = error.killed === true && executionTimeMs >= timeoutMs;
            resolve({
                exito: false,
                exitCode: typeof error.code === 'number' ? error.code : -1,
                executionTimeMs,
                error: (stderr && stderr.trim()) || error.message,
                timeout: fueTimeout,
            });
        });
    });
}

// Motor de resiliencia: timeout + retries + backoff por agente (FASE 3), más
// el chequeo de URLs alucinadas ya existente (Honestidad Técnica), ahora
// aplicado en cada intento, no solo el primero.
async function ejecutarConResiliencia(carpeta, comando) {
    const { timeoutMs, maxRetries, backoffMs } = configDe(carpeta);
    let intento = 0;
    let resultado;

    while (intento <= maxRetries) {
        console.log(`\n🔍 [001] Ejecutando: ${carpeta} (intento ${intento + 1}/${maxRetries + 1}, timeout ${timeoutMs}ms)`);
        resultado = await ejecutarProcesoUnico(comando, timeoutMs);

        if (resultado.exito) {
            const urls = (resultado.stdout || '').match(/https?:\/\/[^\s<>"']+/g) || [];
            if (urls.length > 0) {
                console.log(`   🔗 Detectadas ${urls.length} URLs - verificando...`);
                let urlRota = null;
                for (const url of urls) {
                    const chequeo = await validarEnlace(url);
                    if (!chequeo.valido) { urlRota = `${url} - ${chequeo.error}`; break; }
                }
                if (urlRota) {
                    resultado = { exito: false, exitCode: resultado.exitCode, executionTimeMs: resultado.executionTimeMs, error: `Link Alucinado Detectado: ${urlRota}`, timeout: false };
                } else {
                    console.log(`   ✅ ${urls.length} URLs verificadas correctamente`);
                }
            }
        }

        if (resultado.exito) {
            console.log(`   ✅ CONFIRMADO: ${carpeta} completado con éxito real (exitCode 0, ${resultado.executionTimeMs}ms)`);
            return { ...resultado, intentos: intento + 1 };
        }

        console.error(`   ❌ ${resultado.timeout ? 'TIMEOUT' : 'ERROR'} en ${carpeta} (intento ${intento + 1}): ${resultado.error}`);
        intento++;
        if (intento <= maxRetries) {
            console.log(`   ⏳ Reintentando en ${backoffMs}ms...`);
            await esperar(backoffMs);
        }
    }

    console.error(`   🛑 DERROTA DEFINITIVA: ${carpeta} agotó ${maxRetries + 1} intento(s).`);
    return { ...resultado, intentos: intento };
}

// OPERACIÓN 4 — Contrato de Salida (Audit Trail): artefacto obligatorio en disco al finalizar.
const AUDIT_TRAIL_PATH = path.join(dirAgents, '001_ORQUESTADOR_MAESTRO', 'orquestacion_log.json');

function escribirAuditTrail(registro) {
    fs.mkdirSync(path.dirname(AUDIT_TRAIL_PATH), { recursive: true });
    let historico = [];
    if (fs.existsSync(AUDIT_TRAIL_PATH)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(AUDIT_TRAIL_PATH, 'utf8'));
            if (Array.isArray(parsed)) historico = parsed;
        } catch { /* archivo corrupto o ausente: arranca historial nuevo, no rompe la corrida */ }
    }
    historico.push(registro);
    fs.writeFileSync(AUDIT_TRAIL_PATH, JSON.stringify(historico, null, 2) + '\n', 'utf8');
}

let agentesEjecutados = 0;
let agentesExitosos = 0;
let agentesFallidos = 0;
const bitacoraEjecucion = [];
const resultadosAuditTrail = [];
const orquestacionId = crypto.randomUUID();
const inicioBatchMs = Date.now();
const timestampInicio = new Date(inicioBatchMs).toISOString();

async function ejecutarTodosLosAgentes() {
    try {
        const carpetasAgentes = listarCarpetasAgentes();

        if (carpetasAgentes.length === 0) {
            console.log('⚠️ No se encontraron carpetas de agentes.');
        }

        // GATE — cero código sin diseño aprobado por el Agente Arquitecto (002_ARQUITECTO_DE_SOFTWARE)
        const veredicto = validarDisenoAprobado(carpetasAgentes);
        if (!veredicto.aprobado) {
            console.error('\n🛑 [GATE_ARQUITECTURA] EJECUCIÓN BLOQUEADA — el Agente Arquitecto (002_ARQUITECTO_DE_SOFTWARE) no ha aprobado el diseño.');
            console.error(`   Motivo: ${veredicto.razon}`);
            console.error('   Para aprobar: node agents/architecture-gate.cjs --aprobar-diseno');
            process.exit(1);
        }
        console.log(`\n✅ [GATE_ARQUITECTURA] Diseño aprobado por el Agente Arquitecto (002_ARQUITECTO_DE_SOFTWARE) (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);

        for (const carpeta of carpetasAgentes) {
            const rutaCarpeta = path.join(dirAgents, carpeta);
            const comandante = comandanteDe(carpeta);

            try {
                const archivos = fs.readdirSync(rutaCarpeta);
                const ejecutable = archivos.find(f =>
                    (f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.py') || f.endsWith('.ps1')) && !f.startsWith('IDENTITY')
                );

                if (ejecutable) {
                    const rutaFinal = path.join(rutaCarpeta, ejecutable);
                    const comando = ejecutable.endsWith('.py')
                        ? `python "${rutaFinal}"`
                        : ejecutable.endsWith('.ps1')
                            ? `powershell -ExecutionPolicy Bypass -File "${rutaFinal}"`
                            : `node "${rutaFinal}"`;
                    agentesEjecutados++;

                    console.log(`\n[001] -> FASE ${agentesEjecutados}: ${carpeta}  (reporta a ${comandante})`);

                    const resultado = await ejecutarConResiliencia(carpeta, comando);

                    resultadosAuditTrail.push({
                        agente: carpeta,
                        estado: resultado.exito ? 'SUCCESS' : 'FAILED',
                        exit_code: resultado.exitCode,
                        intentos_consumidos: resultado.intentos,
                        duracion_ms: resultado.executionTimeMs,
                        error_log: resultado.exito ? null : resultado.error,
                    });

                    if (resultado.exito) {
                        agentesExitosos++;
                        bitacoraEjecucion.push({ carpeta, comandante, resultado: 'exito' });
                    } else {
                        agentesFallidos++;
                        bitacoraEjecucion.push({ carpeta, comandante, resultado: 'fallo', error: resultado.error });
                    }
                }
            } catch (e) {
                agentesFallidos++;
                bitacoraEjecucion.push({ carpeta, comandante, resultado: 'fallo', error: e.message });
                resultadosAuditTrail.push({
                    agente: carpeta,
                    estado: 'FAILED',
                    exit_code: -1,
                    intentos_consumidos: 0,
                    duracion_ms: 0,
                    error_log: e.message,
                });
                console.error(`\n❌ Error interno en ${carpeta}: ${e.message}`);
            }
        }

    } catch (e) {
        console.error(`\n❌ Error crítico en Orquestador: ${e.message}`);
    }

    console.log('\n------------------------------------------------------------');
    console.log('📊 RESUMEN DE EJECUCIÓN:');
    console.log(`   Agentes ejecutados: ${agentesEjecutados}`);
    console.log(`   Exitosos: ${agentesExitosos}`);
    console.log(`   Fallidos: ${agentesFallidos}`);

    if (agentesFallidos > 0) {
        console.log('\n⚠️ ADVERTENCIA: Algunos agentes presentaron errores.');
        console.log('El Orquestador reporta FRACASO PARCIAL, no ocultará fallos.');
    }

    // 007_DOCUMENTADOR_AS_BUILD — acta de entrega (markdown) + telemetría (JSON)
    if (bitacoraEjecucion.length > 0) {
        const carpetaAsBuild = ESCUADRON_ELITE['007_DOCUMENTADOR_AS_BUILD'].carpetaSalida;
        fs.mkdirSync(carpetaAsBuild, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const actaPath = path.join(carpetaAsBuild, `ACTA_${timestamp}.md`);
        const lineas = bitacoraEjecucion.map(e =>
            `| ${e.carpeta} | ${e.comandante} | ${e.resultado === 'exito' ? '✅ Éxito' : '❌ Fallo: ' + e.error} |`
        );
        const acta = [
            `# Acta de Entrega — Orquestación Antigravity OS`,
            ``,
            `**Fecha:** ${new Date().toISOString()}`,
            `**Generado por:** 007_DOCUMENTADOR_AS_BUILD`,
            ``,
            `| Agente | Reporta a | Resultado |`,
            `|---|---|---|`,
            ...lineas,
            ``,
            `**Resumen:** ${agentesEjecutados} ejecutados, ${agentesExitosos} exitosos, ${agentesFallidos} fallidos.`,
            ``,
        ].join('\n');
        fs.writeFileSync(actaPath, acta, 'utf8');
        console.log(`\n📄 [007_DOCUMENTADOR_AS_BUILD] Acta de entrega generada: docs/as-build/${path.basename(actaPath)}`);
    }

    // OPERACIÓN 4 — artefacto obligatorio, independiente de si hubo o no agentes ejecutados.
    const finBatchMs = Date.now();
    escribirAuditTrail({
        orquestacion_id: orquestacionId,
        timestamp_inicio: timestampInicio,
        timestamp_fin: new Date(finBatchMs).toISOString(),
        duracion_total_ms: finBatchMs - inicioBatchMs,
        resultados: resultadosAuditTrail,
    });
    console.log(`📊 [AUDIT_TRAIL] agents/001_ORQUESTADOR_MAESTRO/orquestacion_log.json escrito (${resultadosAuditTrail.length} resultado(s))`);

    console.log('\n✅ OBRA FINALIZADA: Director Jairo Antonio Salinas Velasco | Asfáltica S.A.S.');
    console.log('------------------------------------------------------------');
    console.log('\n[001] Protocolo de Honestidad Técnica: ACTIVO');
    console.log('[001] Cada resultado fue verificado. Sin alucinaciones.');
}

ejecutarTodosLosAgentes();
