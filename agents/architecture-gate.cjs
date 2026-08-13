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
// 002 vive en .claude/agents/002-arquitecto-de-software.md (gate real); 003 nunca tuvo carpeta
// propia (heredado sin cambios del esquema anterior). 004 y 008 son roles
// declarados sin ningún subordinado implementado todavía — honesto, no relleno.
// =============================================================================
const ESCUADRON_ELITE = {
    '003_ESP_DISENO_STITCH': {
        rol: 'Arquitecto Visual y Maquetador de Interfaces (promovido desde agents/11-esp-diseno-grafico-y-stitch/, folder eliminado 2026-08-05)',
        mandato: 'Prohibido maquetar con datos falsos. Toda UI consume estrictamente los contratos JSON de RPC/REST aprobados por el Agente Arquitecto (002, .claude/agents/002-arquitecto-de-software.md) y construidos por 005_INGENIERO_BACKEND.',
        subordinados: [],
    },
    '004_SENTINELA_FRONTEND': {
        rol: 'Auditoría de stubs huérfanos y contratos de build en la SPA (subagente real: .claude/agents/004-sentinela-frontend.md, solo lectura — detecta, no corrige)',
        subordinados: [],
    },
    '005_INGENIERO_BACKEND': {
        rol: 'Bases de datos, APIs y lógica de servidor (fusiona el antiguo 002_INGENIERIA_TOTAL)',
        subordinados: [
            '009_gestor_datos', '011_Radar1_minero', '012_Radar2_Estratega',
            '050_Formulador_proy', '052_Form_Administrativo', '015_intelligence-core',
            '07-ing-concreto_GFRC', '08-estratega-neuromarketing',
        ],
    },
    // Limpieza 2026-08-12 (orden explícita del usuario, aplazada hasta que el
    // roster de 8 estuviera completo — ver docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md
    // §0-T): 03-analista-secop y 14-analista-comportamiento se purgaron del
    // disco (solo tenían IDENTITY.md, cero código — mismo criterio que
    // Skill_Soporte_Automatico.cjs). 052_Form_Administrativo y
    // 015_intelligence-core se reasignaron a 005_INGENIERO_BACKEND (dominio
    // real: Formulador/gestión de proyectos de construcción-SECOP, no
    // infraestructura de despliegue) — ninguno hacía "despliegues a
    // producción, servidores" pese a estar declarados aquí antes.
    '006_DEVSECOPS_INFRAESTRUCTURA': {
        rol: 'Despliegues a producción, servidores, fiscalización de seguridad, secretos y dependencias (ver .claude/agents/006-devsecops-infraestructura.md)',
        subordinados: [],
    },
    '007_DOCUMENTADOR_AS_BUILD': {
        rol: 'Planimetría y documentación final (antiguo 004_DOCUMENTADOR_AS_BUILD)',
        // subordinados: [] — 010_redactor_tecnico purgado de esta lista 2026-08-13
        // (auditoría del propio 007): sus 2 skills (Skill_002_Redactor_Propuestas.cjs,
        // Skill_002_Generador_Anexos.cjs) no las importa nada en src/ ni server.js —
        // código muerto, mismo patrón ya purgado de 006 (03-analista-secop,
        // 14-analista-comportamiento). La carpeta agents/010_redactor_tecnico/ en sí
        // no se borró (a diferencia de esas 2) porque no se confirmó que esté vacía
        // de contenido útil — solo se cortó la asignación fantasma como subordinado.
        subordinados: [],
        carpetaSalida: path.join(dirRoot, 'docs', 'as-build'),
    },
    '008_AUDITOR_DE_CODIGO': {
        rol: 'QA Red Team, ejecuta el Protocolo Titán — audita código ya escrito o traído de otras redes (mandato explícito en .claude/agents/002-arquitecto-de-software.md, que se niega a hacer esta tarea y redirige aquí)',
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
    administrativo: '052_Form_Administrativo',
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
// El Agente Arquitecto (.claude/agents/002-arquitecto-de-software.md) debe emitir un veredicto
// {"aprobado": true, ...} sobre el diff pendiente antes de que el Mando Central
// autorice ejecutar a cualquier subordinado. La firma es un hash del estado real
// en disco: si algo cambia después de firmar, la aprobación cae.
// Retirado 2026-08-07: el rol "001_ARQUITECTO_CORE" (citado en versiones previas
// de este archivo, de AGENTS.md y de .agent/agents/000_orquestador.md) nunca tuvo
// implementación real — no existía ningún archivo de definición ni lógica de
// revisión, y la firma se autoaprobaba sin criterio. El Agente Arquitecto real
// (.claude/agents/002-arquitecto-de-software.md) sí lee y razona (Read/Grep/Glob) antes de fallar.
// =============================================================================
// Vive directo en agents/ (NO dentro de ninguna carpeta \d{2,3}[_-]*) — si estuviera
// dentro de una carpeta de agente, escribir la firma cambiaría el listado de esa
// carpeta y la firma se autoinvalidaría en el acto.
const APROBACION_PATH = path.join(dirAgents, 'diseno_aprobado.json');
const ARCHITECT_PROMPT_PATH = path.join(dirRoot, '.claude', 'agents', '002-arquitecto-de-software.md');
// Mismo criterio que server.js/m1Pipeline.js: modelo vía env var, no hardcodeado
// por tercera vez (hallazgo 2026-08-08, se había centralizado en los otros 2
// archivos pero se pasó por alto este).
const ANTHROPIC_MODEL = process.env.PRIMARY_AI_MODEL || 'claude-sonnet-4-6';

// Orden de prioridad para el diff que se manda a 002 — más crítico primero.
// Corrige un hallazgo real (2026-08-13): un corte crudo de `git diff HEAD` a
// 60000 caracteres, por orden alfabético, dejó fuera los fixes de seguridad
// reales (server.js, public/app.js) porque package-lock.json (1400+ líneas)
// venía antes alfabéticamente y se comió el presupuesto — 002 aprobó habiendo
// visto solo cambios de PMU/dependencias, no el diff que realmente importaba.
const PRIORIDAD_DIFF = [
    /^\.claude\/agents\//,
    /^agents\/architecture-gate\.cjs$/,
    /^src\//,
    /^server\.js$/,
    /^public\/(?!estado_antigravity\.json)/,       // frontend real, no el JSON auto-generado
    /^docs\//,
    // todo lo demás (lockfiles, telemetría/estado PMU auto-generados, etc.)
    // cae al final por no matchear ningún patrón de arriba — ver bucketDe().
];

function bucketDe(archivo) {
    const idx = PRIORIDAD_DIFF.findIndex(p => p.test(archivo));
    return idx === -1 ? PRIORIDAD_DIFF.length : idx;
}

// Construye el diff a mandar a la API ordenando por criticidad, no
// alfabéticamente — si algo se trunca, que sea lo menos importante
// (lockfiles/artefactos auto-generados), nunca código de aplicación o
// definiciones de agentes.
function construirDiffPriorizado(limiteChars) {
    let archivos;
    try {
        archivos = execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd: dirRoot, encoding: 'utf8' })
            .split('\n').map(l => l.trim()).filter(Boolean);
    } catch (e) {
        return { diff: '', truncado: false, error: `No se pudo leer 'git diff HEAD --name-only': ${e.message}` };
    }
    if (archivos.length === 0) return { diff: '', truncado: false };

    archivos.sort((a, b) => bucketDe(a) - bucketDe(b));

    let acumulado = '';
    const omitidos = [];
    for (const archivo of archivos) {
        if (acumulado.length >= limiteChars) { omitidos.push(archivo); continue; }
        let diffArchivo;
        try {
            diffArchivo = execFileSync('git', ['diff', 'HEAD', '--', archivo], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        } catch (e) {
            diffArchivo = `[No se pudo leer el diff de ${archivo}: ${e.message}]\n`;
        }
        const espacioRestante = limiteChars - acumulado.length;
        if (diffArchivo.length > espacioRestante) {
            acumulado += diffArchivo.slice(0, espacioRestante) + `\n[... ${archivo} truncado aquí, sin espacio restante ...]\n`;
            omitidos.push(...archivos.slice(archivos.indexOf(archivo) + 1));
            break;
        }
        acumulado += diffArchivo;
    }
    return { diff: acumulado, truncado: omitidos.length > 0, omitidos };
}

// Invoca al Agente Arquitecto real: system prompt = 002-arquitecto-de-software.md, input = git diff
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

    const { diff, truncado, omitidos, error } = construirDiffPriorizado(60000);
    if (error) {
        return { aprobado: false, razones: [error] };
    }
    if (!diff || !diff.trim()) {
        return { aprobado: false, razones: ['git diff HEAD está vacío — no hay cambios pendientes que aprobar.'] };
    }

    const avisoTruncamiento = truncado
        ? `\n\nAVISO: el diff completo no cabía en el presupuesto de caracteres. Se priorizó por criticidad ` +
          `(.claude/agents/, código de gate, src/, server.js, frontend real, docs — en ese orden); lo que quedó ` +
          `fuera son archivos de menor riesgo (lockfiles, artefactos auto-generados como telemetría/estado PMU): ` +
          `${omitidos.slice(0, 10).join(', ')}${omitidos.length > 10 ? ` (+${omitidos.length - 10} más)` : ''}. ` +
          `Si alguno de esos archivos omitidos SÍ te parece crítico por su nombre, no apruebes sin verlo — pide que se re-envíe.`
        : '';

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
                content: `Fiscaliza el siguiente diff pendiente de aprobación (git diff HEAD, reordenado por criticidad y ` +
                    `truncado a 60000 caracteres si aplica — ver aviso al final si corresponde). ` +
                    `IMPORTANTE: esta invocación es una llamada directa a la API de Anthropic, no una sesión de Claude Code — ` +
                    `no tienes acceso real a Read/Grep/Glob aquí pese a lo que indique tu system prompt para tu uso habitual. ` +
                    `No emitas tool_call ni nada similar: no se ejecutará. Basa tu fiscalización únicamente en el diff de texto ` +
                    `provisto abajo (línea de contexto suficiente para evaluar consistencia, completitud y alcance). ` +
                    `Sé conciso en el análisis narrativo (párrafos cortos, sin repetir el diff) — el veredicto JSON obligatorio ` +
                    `al final es lo único que este proceso puede parsear; si te quedas sin espacio antes de emitirlo, el gate ` +
                    `entero falla. Prioriza terminar con el JSON sobre extender el análisis.\n\n${diff}${avisoTruncamiento}`,
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

// Firma cubre CONTENIDO (no solo listado de nombres) de agents/, src/ y
// .claude/agents/ — corregido 2026-08-12 tras auditoría 001-006: la versión
// anterior solo hasheaba nombres de archivo (fs.readdirSync().sort()), así
// que mutar 1 byte de un archivo YA EXISTENTE nunca invalidaba la firma —
// solo lo hacían altas/bajas. Además .claude/agents/*.md (los prompts reales
// de 001-008) no estaba en el alcance de la firma en absoluto: se podía
// reescribir el mandato completo de cualquier agente sin invalidar nunca el
// gate. Ambos puntos ciegos cerrados aquí.
function hashArchivo(rutaAbsoluta) {
    return crypto.createHash('sha256').update(fs.readFileSync(rutaAbsoluta)).digest('hex');
}

function hashEstado(carpetas) {
    const payloadAgents = carpetas.map(c => {
        const rutaCarpeta = path.join(dirAgents, c);
        const archivos = fs.readdirSync(rutaCarpeta).sort();
        const hashes = archivos.map(a => {
            const rutaArchivo = path.join(rutaCarpeta, a);
            if (!fs.statSync(rutaArchivo).isFile()) return `${a}:DIR`;
            return `${a}:${hashArchivo(rutaArchivo)}`;
        });
        return `${c}:${hashes.join(',')}`;
    }).join('|');

    const dirSrc = path.join(dirRoot, 'src');
    const archivosSrc = listarArchivosRecursivo(dirSrc, dirSrc).sort();
    const payloadSrc = `src:${archivosSrc.map(f => `${f}:${hashArchivo(path.join(dirSrc, f))}`).join(',')}`;

    const dirClaudeAgents = path.join(dirRoot, '.claude', 'agents');
    const archivosClaudeAgents = listarArchivosRecursivo(dirClaudeAgents, dirClaudeAgents).sort();
    const payloadClaudeAgents = `claude-agents:${archivosClaudeAgents.map(f => `${f}:${hashArchivo(path.join(dirClaudeAgents, f))}`).join(',')}`;

    return crypto.createHash('sha256').update(payloadAgents + '||' + payloadSrc + '||' + payloadClaudeAgents).digest('hex');
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

// =============================================================================
// SUBGATES ELITE (2026-08-12, auditoría 001-006) — engancha agentes de solo
// lectura (003, 004, y cualquiera que se agregue después) al mismo gate
// obligatorio que ya protege a 002. Brecha real que cierra: 003/004 nunca
// eran obligatorios antes de un commit — un stub huérfano o una fuga de
// estilo podía llegar a commit sin que ninguno de los dos lo hubiera visto.
//
// Para agregar un futuro agente "elite" a este mecanismo: una entrada nueva
// aquí. No hace falta tocar el resto del gate.
// =============================================================================
const SUBGATES = {
    '004_SENTINELA_FRONTEND': {
        promptPath: path.join(dirRoot, '.claude', 'agents', '004-sentinela-frontend.md'),
        patrones: [/^src\/.*\.(jsx|tsx)$/],
        campoAprobado: 'limpio',
        veredictoPath: path.join(dirAgents, 'veredicto_004.json'),
    },
    '003_ESP_DISENO_STITCH': {
        promptPath: path.join(dirRoot, '.claude', 'agents', '003-esp-diseno-stitch.md'),
        patrones: [/^src\/.*\.(jsx|tsx)$/],
        campoAprobado: 'diseno_valido',
        veredictoPath: path.join(dirAgents, 'veredicto_003.json'),
    },
    // Agregado 2026-08-13: antes 006 solo se invocaba manualmente ("bajo demanda"),
    // sin ningún gate automático — un commit podía tocar render.yaml, .env.example
    // o dependencias sin que nadie con juicio (no solo los chequeos deterministas
    // de secretos/env/npm audit) lo revisara. Mismo patrón que 003/004.
    '006_DEVSECOPS_INFRAESTRUCTURA': {
        promptPath: path.join(dirRoot, '.claude', 'agents', '006-devsecops-infraestructura.md'),
        patrones: [/^render\.yaml$/, /^\.env\.example$/, /^package\.json$/, /^package-lock\.json$/],
        campoAprobado: 'infraestructura_segura',
        veredictoPath: path.join(dirAgents, 'veredicto_006.json'),
    },
    // Agregado 2026-08-13 (orden explícita: "todos los agentes... PMU real,
    // no solo documentado"): 005 es el único subagente además de 001 con
    // Bash, y el de mayor blast radius del escuadrón (Write/Edit sobre
    // persistencia real) — no tenía NINGÚN gate automático propio hasta hoy.
    // campoAprobado no es booleano aquí: 005 emite `estado_backend` con 3
    // valores string posibles, "aislado_y_seguro" es el único que aprueba
    // (ver valorAprobado, generalización de pedirVeredictoSubagente).
    '005_INGENIERO_BACKEND': {
        promptPath: path.join(dirRoot, '.claude', 'agents', '005-ingeniero-backend.md'),
        patrones: [/^src\/modules\/formulador\//, /^src\/shared\/infrastructure\//],
        campoAprobado: 'estado_backend',
        valorAprobado: 'aislado_y_seguro',
        veredictoPath: path.join(dirAgents, 'veredicto_005.json'),
    },
};

function obtenerArchivosStaged() {
    try {
        const out = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dirRoot, encoding: 'utf8' });
        return out.split('\n').map(l => l.trim()).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function archivosRelevantesPara(agentId, archivosStaged) {
    const cfg = SUBGATES[agentId];
    return archivosStaged.filter(f => cfg.patrones.some(p => p.test(f)));
}

// Hashea el CONTENIDO STAGED (git show :archivo), no el de disco — lo que se
// va a commitear puede diferir de lo que hay en disco si algo quedó a medio
// stagear. Mismo criterio de "cero suposiciones" que hashEstado().
function hashArchivosStaged(archivos) {
    const partes = archivos.slice().sort().map(f => {
        let contenido;
        try {
            contenido = execFileSync('git', ['show', `:${f}`], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        } catch (e) {
            contenido = '';
        }
        return `${f}:${crypto.createHash('sha256').update(contenido).digest('hex')}`;
    });
    return crypto.createHash('sha256').update(partes.join('|')).digest('hex');
}

function validarSubgate(agentId, archivosStaged) {
    const cfg = SUBGATES[agentId];
    const relevantes = archivosRelevantesPara(agentId, archivosStaged);
    if (relevantes.length === 0) {
        return { aplica: false, aprobado: true };
    }
    if (!fs.existsSync(cfg.veredictoPath)) {
        return { aplica: true, aprobado: false, razon: `${agentId} no tiene veredicto (${path.basename(cfg.veredictoPath)} ausente) sobre archivos que sí le competen: ${relevantes.join(', ')}` };
    }
    let veredicto;
    try {
        veredicto = JSON.parse(fs.readFileSync(cfg.veredictoPath, 'utf8'));
    } catch (e) {
        return { aplica: true, aprobado: false, razon: `${path.basename(cfg.veredictoPath)} corrupto: ${e.message}` };
    }
    if (veredicto.aprobado !== true) {
        return { aplica: true, aprobado: false, razon: `${agentId} marcó el último veredicto como NO aprobado.` };
    }
    const hashActual = hashArchivosStaged(relevantes);
    if (veredicto.firma !== hashActual) {
        return { aplica: true, aprobado: false, razon: `Los archivos relevantes para ${agentId} cambiaron desde el último veredicto — se requiere re-aprobación (node agents/architecture-gate.cjs --aprobar-subgate ${agentId}).` };
    }
    return { aplica: true, aprobado: true };
}

async function pedirVeredictoSubagente(agentId, relevantes) {
    const cfg = SUBGATES[agentId];
    if (!process.env.ANTHROPIC_API_KEY) {
        return { aprobado: false, razon: 'ANTHROPIC_API_KEY no configurada.' };
    }
    if (!fs.existsSync(cfg.promptPath)) {
        return { aprobado: false, razon: `No existe ${cfg.promptPath}.` };
    }
    const systemPrompt = fs.readFileSync(cfg.promptPath, 'utf8');
    let diff;
    try {
        diff = execFileSync('git', ['diff', '--cached', '--', ...relevantes], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        return { aprobado: false, razon: `No se pudo leer 'git diff --cached': ${e.message}` };
    }
    let response;
    try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        response = await client.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: `Audita el siguiente diff staged (git diff --cached), limitado a los archivos que te competen según tu mandato. ` +
                    `Esta es una llamada directa a la API de Anthropic, sin Read/Grep/Glob reales — basa tu veredicto solo en este ` +
                    `texto. Termina siempre con tu JSON de salida obligatorio, tal como especifica tu propio system prompt.\n\n${diff.slice(0, 60000)}`,
            }],
        });
    } catch (e) {
        return { aprobado: false, razon: `Fallo de la API de Anthropic: ${e.message}` };
    }
    const text = response.content?.[0]?.text ?? '';
    // Generalizado 2026-08-13 (subgate de 005): no todo campoAprobado es
    // booleano — 005 emite `estado_backend` con 3 valores string posibles
    // ("aislado_y_seguro"|"brechas_detectadas"|"bloqueado_por_diseno"), no
    // true/false. Con `valorAprobado` configurado, se matchea contra ese
    // string exacto en vez de contra (true|false).
    const patronValor = cfg.valorAprobado ? `"${cfg.valorAprobado}"` : '(true|false)';
    const match = text.match(new RegExp(`\\{[^{}]*"${cfg.campoAprobado}"\\s*:\\s*${patronValor}[^{}]*\\}`, 's'));
    if (!match) {
        return { aprobado: false, razon: `${agentId} no devolvió un veredicto JSON parseable.`, respuestaCruda: text.slice(0, 800) };
    }
    let veredicto;
    try {
        veredicto = JSON.parse(match[0]);
    } catch (e) {
        return { aprobado: false, razon: `Veredicto JSON corrupto: ${e.message}` };
    }
    const aprobado = cfg.valorAprobado
        ? veredicto[cfg.campoAprobado] === cfg.valorAprobado
        : veredicto[cfg.campoAprobado] === true;
    return { aprobado, veredictoCompleto: veredicto };
}

// =============================================================================
// PMU — PUESTO DE MANDO UNIFICADO (2026-08-12)
//
// Hasta esta ronda, el estado del Escuadrón Élite vivía repartido en 3
// archivos de veredicto sin relación entre sí (diseno_aprobado.json,
// veredicto_003.json, veredicto_004.json) y una narrativa de 16 rondas en
// docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md que había que leer cronológicamente
// para reconstruir "qué es cierto ahora". Eso es una federación de checkpoints,
// no un mando unificado. El PMU resuelve 2 cosas concretas:
//
//   1. estado_operativo.json — UNA sola foto del escuadrón completo, generada
//      por código (nunca escrita a mano), con auto-descubrimiento de agentes
//      desde .claude/agents/*.md. Agregar un agente nuevo (con o sin gate
//      propio) lo hace aparecer solo, sin tocar este archivo.
//   2. telemetria.jsonl — registro append-only de CADA decisión de gate
//      (check/aprobar, aprobado/rechazado, cuándo, por qué). Sin esto no
//      había manera de responder "¿cuántas veces bloqueó el gate?" salvo
//      leyendo la narrativa de la auditoría a mano.
//
// Vigilancia activa (2026-08-13, orden explícita del usuario: "la totalidad
// de los agentes... se comporte como una real, verdadera e integral PMU de
// alto nivel" — no un tablero pasivo que solo se mira si alguien lo invoca).
// Dos chequeos deterministas, sin costo de API, corren en TODO --check-gate:
// analizarTelemetriaPMU() (patrones de rechazo repetido) y
// verificarVigenciaAgentes() (agentes cuyo archivo quedó más viejo que la
// última actualización del documento vivo). Ninguno de los dos bloquea el
// commit — son advisories, no un tercer tipo de gate duro — pero ya no
// dependen de que alguien invoque a 006 a mano para notarlos.
// =============================================================================
const PMU_DIR = path.join(dirAgents, 'pmu');
const ESTADO_OPERATIVO_PATH = path.join(PMU_DIR, 'estado_operativo.json');
const TELEMETRIA_PATH = path.join(PMU_DIR, 'telemetria.jsonl');

function registrarTelemetria(evento) {
    fs.mkdirSync(PMU_DIR, { recursive: true });
    const linea = JSON.stringify({ timestamp: new Date().toISOString(), ...evento });
    fs.appendFileSync(TELEMETRIA_PATH, linea + '\n', 'utf8');
}

// Lee telemetria.jsonl (si existe) y la parsea tolerando líneas corruptas —
// una línea mal escrita no debe tumbar la vigilancia del resto del historial.
function leerTelemetria() {
    if (!fs.existsSync(TELEMETRIA_PATH)) return [];
    return fs.readFileSync(TELEMETRIA_PATH, 'utf8')
        .split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
}

// Vigilancia activa #1 — detecta, sin que nadie tenga que invocar a 006 a
// mano, patrones de rechazo repetido por subsistema: si los últimos N
// eventos consecutivos de un mismo subsistema son todos 'rechazado', es
// señal de que algo estructural está mal (no una falla puntual) y merece
// atención humana, no solo reintentar --aprobar-diseno/--aprobar-subgate
// hasta que pase.
const UMBRAL_RECHAZOS_CONSECUTIVOS = 3;

function analizarTelemetriaPMU() {
    const eventos = leerTelemetria();
    const porSubsistema = {};
    for (const e of eventos) {
        if (!e.subsistema || !e.resultado) continue;
        (porSubsistema[e.subsistema] ||= []).push(e);
    }
    const alertas = [];
    for (const [subsistema, evs] of Object.entries(porSubsistema)) {
        let seguidos = 0;
        for (let i = evs.length - 1; i >= 0; i--) {
            if (evs[i].resultado === 'rechazado') seguidos++; else break;
        }
        if (seguidos >= UMBRAL_RECHAZOS_CONSECUTIVOS) {
            alertas.push({
                subsistema,
                tipo: 'rechazos_consecutivos',
                cantidad: seguidos,
                ultima_razon: evs[evs.length - 1].razon || null,
            });
        }
    }
    return alertas;
}

// Vigilancia activa #2 — compara la fecha del último commit que tocó el
// documento vivo (docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md) contra la fecha
// del último commit de cada agente que se comprometió al patrón "Vigencia
// del estado"/"Fuente única de verdad". Si el documento se movió después
// que el agente, es una señal de que puede haber una sección nueva que le
// compete y todavía no leyó — exactamente el tipo de brecha que dejó a 005
// desactualizado sobre RLS antes de esta ronda (detectado a mano esa vez,
// por código de aquí en adelante).
function fechaUltimoCommit(rutaRelativa) {
    try {
        const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', rutaRelativa], { cwd: dirRoot, encoding: 'utf8' }).trim();
        return out ? Number(out) : null;
    } catch {
        return null;
    }
}

function verificarVigenciaAgentes() {
    const docRel = path.join('docs', 'ARQUITECTURA_AGENTICA_ANTIGRAVITY.md');
    const fechaDoc = fechaUltimoCommit(docRel);
    if (!fechaDoc) return [];

    const dirClaudeAgents = path.join(dirRoot, '.claude', 'agents');
    if (!fs.existsSync(dirClaudeAgents)) return [];

    const alertas = [];
    for (const archivo of fs.readdirSync(dirClaudeAgents).filter(f => f.endsWith('.md'))) {
        const contenido = fs.readFileSync(path.join(dirClaudeAgents, archivo), 'utf8');
        // Solo agentes que se comprometieron al patrón — no todos los .md
        // necesitan estar sincronizados con el documento vivo (ej. uno que
        // no cite ningún hecho fechado del proyecto).
        if (!/Vigencia del estado|FUENTE ÚNICA DE VERDAD/i.test(contenido)) continue;
        const rutaRel = path.join('.claude', 'agents', archivo);
        const fechaAgente = fechaUltimoCommit(rutaRel);
        if (fechaAgente && fechaDoc > fechaAgente) {
            alertas.push({
                agente: archivo,
                razon: 'docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md se actualizó después que este agente — verificar si hay una sección nueva que le compete.',
            });
        }
    }
    return alertas;
}

// Parseo de frontmatter minimalista (sin dependencia de una librería YAML) —
// solo lee `name:` y `tools:`, que es todo lo que el PMU necesita mostrar.
function leerFrontmatterAgente(rutaMd) {
    const contenido = fs.readFileSync(rutaMd, 'utf8');
    const match = contenido.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { nombre: null, tools: [] };
    const bloque = match[1];
    const nombre = (bloque.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || null;
    const toolsLine = (bloque.match(/^tools:\s*(.+)$/m) || [])[1]?.trim();
    const tools = toolsLine ? toolsLine.split(',').map(t => t.trim()) : [];
    return { nombre, tools };
}

// Auto-descubrimiento: cualquier .md nuevo en .claude/agents/ aparece en el
// PMU sin tocar código — esto es lo que hace el tablero escalable para
// agentes futuros, no una lista mantenida a mano.
function descubrirAgentes() {
    const dirClaudeAgents = path.join(dirRoot, '.claude', 'agents');
    if (!fs.existsSync(dirClaudeAgents)) return [];
    return fs.readdirSync(dirClaudeAgents)
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(f => {
            const ruta = path.join(dirClaudeAgents, f);
            const meta = leerFrontmatterAgente(ruta);
            const prefijo = (f.match(/^(\d{3})/) || [])[1] || null;
            return { archivo: `.claude/agents/${f}`, prefijo, ...meta };
        });
}

function mapaGatesPorPrefijo() {
    const mapa = { '002': { veredictoPath: APROBACION_PATH, tipo: 'gate_principal' } };
    for (const [agentId, cfg] of Object.entries(SUBGATES)) {
        mapa[agentId.slice(0, 3)] = { veredictoPath: cfg.veredictoPath, tipo: 'subgate' };
    }
    return mapa;
}

function generarEstadoOperativo() {
    const agentes = descubrirAgentes();
    const gatesPorPrefijo = mapaGatesPorPrefijo();

    const tablero = agentes.map(a => {
        const gate = a.prefijo ? gatesPorPrefijo[a.prefijo] : null;
        let ultimoVeredicto = null;
        if (gate && fs.existsSync(gate.veredictoPath)) {
            try { ultimoVeredicto = JSON.parse(fs.readFileSync(gate.veredictoPath, 'utf8')); } catch { /* corrupto: queda null, no se oculta el resto del tablero por 1 archivo malo */ }
        }
        return {
            archivo: a.archivo,
            nombre: a.nombre,
            tools: a.tools,
            permiso_escritura: a.tools.some(t => ['Write', 'Edit', 'Bash'].includes(t)),
            gate: gate ? gate.tipo : 'sin_gate_propio',
            ultimo_veredicto: ultimoVeredicto,
        };
    });

    return {
        generado: new Date().toISOString(),
        total_agentes: tablero.length,
        agentes_con_gate: tablero.filter(a => a.gate !== 'sin_gate_propio').length,
        agentes_con_permiso_escritura: tablero.filter(a => a.permiso_escritura).map(a => a.nombre || a.archivo),
        agentes: tablero,
    };
}

function escribirEstadoOperativo() {
    const estado = generarEstadoOperativo();
    fs.mkdirSync(PMU_DIR, { recursive: true });
    fs.writeFileSync(ESTADO_OPERATIVO_PATH, JSON.stringify(estado, null, 2) + '\n', 'utf8');
    return estado;
}

// =============================================================================
// CHEQUEOS ESTÁTICOS DE 006_DEVSECOPS_INFRAESTRUCTURA (2026-08-12)
//
// Deterministas, SIN costo de API, corren en TODO --check-gate automáticamente
// — a diferencia de SUBGATES (003/004), estos no necesitan juicio de LLM, son
// reglas verificables por código. No requieren archivo de veredicto ni
// --aprobar-*: o pasan o no pasan, en el momento.
// =============================================================================

// Patrones específicos y de bajo falso-positivo (mismo criterio que gitleaks/
// truffleHog) — nunca un match genérico como la palabra "service_role" sola,
// eso dispararía en cualquier comentario o doc que discuta el tema (este mismo
// proyecto lo hace constantemente).
const PATRONES_SECRETOS = [
    { nombre: 'JWT (3 segmentos base64 separados por punto)', patron: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { nombre: 'AWS Access Key ID', patron: /AKIA[0-9A-Z]{16}/ },
    { nombre: 'Bloque de llave privada PEM', patron: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { nombre: 'Asignación de key/secret/token con valor largo', patron: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{20,}['"]/i },
];

// Solo las líneas AGREGADAS del diff, no el archivo completo (corrección
// 2026-08-12, hallazgo propio del gate): antes escaneaba todo el contenido
// staged, así que tocar un archivo por cualquier motivo ajeno (ej. un fix de
// XSS en fase1-entrada.html) bloqueaba el commit por un valor preexistente y
// ya commiteado antes (el apiKey público de Firebase Web SDK, que por diseño
// no es secreto — se protege con reglas de seguridad/dominio, no con
// confidencialidad). Un archivo nuevo sigue viéndose completo: git diff
// marca cada línea como agregada.
function lineasAgregadasDe(archivo) {
    try {
        const diff = execFileSync('git', ['diff', '--cached', '-U0', '--', archivo], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
        return diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n');
    } catch (e) {
        return null; // archivo eliminado en este commit, o binario — nada que escanear como texto
    }
}

function escanearSecretos(archivosStaged) {
    const hallazgos = [];
    for (const archivo of archivosStaged) {
        if (archivo === '.env' || /(^|\/)\.env$/.test(archivo)) {
            hallazgos.push({ archivo, razon: 'archivo .env real no debe commitearse jamás (usa .env.example para plantillas)' });
            continue;
        }
        if (archivo === '.env.example') continue; // plantilla sin valores, por definición segura
        const agregado = lineasAgregadasDe(archivo);
        if (!agregado) continue;
        for (const { nombre, patron } of PATRONES_SECRETOS) {
            if (patron.test(agregado)) {
                hallazgos.push({ archivo, razon: `posible secreto detectado (${nombre})` });
                break; // 1 hallazgo por archivo alcanza para bloquear; no hace falta enumerar cada patrón que matchea
            }
        }
    }
    return hallazgos;
}

// .env.example debe existir y cubrir, como mínimo, los mismos nombres de
// variable que .env real — sin esto, .env.example se desincroniza en
// silencio (alguien agrega una var nueva a .env y nunca actualiza la
// plantilla) y el siguiente desarrollador no sabe qué configurar.
function verificarEnvExample() {
    const envPath = path.join(dirRoot, '.env');
    const ejemploPath = path.join(dirRoot, '.env.example');
    if (!fs.existsSync(envPath)) return { ok: true }; // sin .env real, nada que comparar (ej. CI)
    if (!fs.existsSync(ejemploPath)) {
        return { ok: false, razon: '.env.example no existe — crear una plantilla con los mismos nombres de variable que .env, sin valores.' };
    }
    const extraerNombres = (contenido) => new Set(
        contenido.split('\n')
            .map(l => l.match(/^([A-Z_][A-Z0-9_]*)\s*=/))
            .filter(Boolean)
            .map(m => m[1])
    );
    const nombresEnv = extraerNombres(fs.readFileSync(envPath, 'utf8'));
    const nombresEjemplo = extraerNombres(fs.readFileSync(ejemploPath, 'utf8'));
    const faltantes = [...nombresEnv].filter(n => !nombresEjemplo.has(n));
    if (faltantes.length > 0) {
        return { ok: false, razon: `.env.example desincronizado — faltan estas variables: ${faltantes.join(', ')}` };
    }
    return { ok: true };
}

// npm audit solo cuando package.json/package-lock.json está en el diff — no
// en cada commit (sería lento y depende de red/registry, mala práctica para
// un hook local que corre en cada commit sin importar qué se tocó).
// Mismo fallback que NODE_BIN en scripts/pre-commit.sh — el shell que corre
// esto no siempre tiene 'npm' en PATH pese a estar instalado (hallazgo real
// 2026-08-12, misma clase de problema que 'node' ya documentado).
function resolverNpmBin() {
    try {
        execFileSync('npm', ['--version'], { encoding: 'utf8' });
        return 'npm';
    } catch {
        const fallback = 'C:\\Program Files\\nodejs\\npm.cmd';
        return fs.existsSync(fallback) ? fallback : null;
    }
}

// Corregido 2026-08-12 (hallazgo real al sellar esta misma ronda): disparar
// solo porque package.json está en el diff es impreciso — un commit que solo
// agrega un script npm (sin tocar "dependencies"/"devDependencies") no
// introduce ni cambia ninguna dependencia, pero bloqueaba igual por la
// deuda de vulnerabilidades YA EXISTENTE, sin relación con ese diff. Ahora
// se inspecciona el diff staged real de package.json y solo aplica si algún
// renglón cambiado cae dentro de un bloque de dependencias.
function diffTocaDependencias(archivosStaged) {
    if (!archivosStaged.includes('package.json')) return false;
    let diff;
    try {
        diff = execFileSync('git', ['diff', '--cached', '--', 'package.json'], { cwd: dirRoot, encoding: 'utf8' });
    } catch (e) {
        return true; // no se pudo leer el diff -- fail-safe hacia "sí aplica", no hacia ignorar
    }
    let dentroDeDependencias = false;
    let profundidadEntrada = 0;
    for (const linea of diff.split('\n')) {
        const contenido = linea.replace(/^[+\- ]/, '');
        if (/^\s*"(dependencies|devDependencies|optionalDependencies|peerDependencies)"\s*:\s*\{/.test(contenido)) {
            dentroDeDependencias = true;
            profundidadEntrada = 0;
            continue;
        }
        if (dentroDeDependencias) {
            if (/\{/.test(contenido)) profundidadEntrada++;
            if (/\}/.test(contenido)) {
                if (profundidadEntrada === 0) { dentroDeDependencias = false; continue; }
                profundidadEntrada--;
            }
            if ((linea.startsWith('+') || linea.startsWith('-')) && !linea.startsWith('+++') && !linea.startsWith('---')) {
                return true; // hay un renglón realmente modificado dentro de un bloque de dependencias
            }
        }
    }
    return false;
}

function verificarDependencias(archivosStaged) {
    const tocaLock = archivosStaged.includes('package-lock.json'); // no versionado hoy, pero si algún día lo está, cualquier cambio ahí sí es relevante por definición
    const tocaDependencias = tocaLock || diffTocaDependencias(archivosStaged);
    if (!tocaDependencias) return { ok: true, aplica: false };
    const npmBin = resolverNpmBin();
    if (!npmBin) {
        return { ok: true, aplica: true, razon: "No se encontró 'npm' en PATH ni en la ruta de fallback conocida — no se pudo verificar, no se bloquea por un fallo de la herramienta en sí." };
    }
    let salida;
    try {
        // shell:true es necesario en Windows porque npm.cmd es un batch script,
        // no un ejecutable nativo — execFileSync sin shell no puede correrlo. Node
        // advierte (DEP0190) sobre esto en general porque args sin escapar +
        // shell es peligroso con INPUT DE USUARIO — aquí los args son literales
        // fijos ('audit', '--json'), nunca datos externos, así que no aplica el
        // riesgo que la advertencia señala.
        salida = execFileSync(`"${npmBin}"`, ['audit', '--json'], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: true });
    } catch (e) {
        // npm audit sale con exit code != 0 cuando SÍ encuentra vulnerabilidades
        // (no es un error de ejecución) — su stdout sigue siendo el JSON útil.
        salida = e.stdout || '';
    }
    let reporte;
    try {
        reporte = JSON.parse(salida);
    } catch (e) {
        return { ok: true, aplica: true, razon: 'npm audit no devolvió JSON parseable — no se pudo verificar, no se bloquea por un fallo de la herramienta en sí.' };
    }
    const criticas = reporte?.metadata?.vulnerabilities?.critical || 0;
    const altas = reporte?.metadata?.vulnerabilities?.high || 0;
    if (criticas > 0 || altas > 0) {
        return { ok: false, aplica: true, razon: `npm audit encontró ${criticas} vulnerabilidad(es) crítica(s) y ${altas} alta(s) — correr 'npm audit' para el detalle.` };
    }
    return { ok: true, aplica: true };
}

function ejecutarChequeosEstaticos(archivosStaged) {
    const resultados = [];

    const secretos = escanearSecretos(archivosStaged);
    if (secretos.length > 0) {
        secretos.forEach(h => resultados.push({ categoria: 'secretos', ok: false, razon: `${h.archivo}: ${h.razon}` }));
    } else {
        resultados.push({ categoria: 'secretos', ok: true });
    }

    const envExample = verificarEnvExample();
    resultados.push({ categoria: 'env_example', ok: envExample.ok, razon: envExample.razon });

    const dependencias = verificarDependencias(archivosStaged);
    if (dependencias.aplica) {
        resultados.push({ categoria: 'dependencias', ok: dependencias.ok, razon: dependencias.razon });
    }

    return resultados;
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
        registrarTelemetria({ tipo: 'check-gate', subsistema: '002_principal', resultado: 'rechazado', razon: veredicto.razon });
        escribirEstadoOperativo();
        process.exitCode = 1;
        return;
    }
    console.log(`✅ [GATE_ARQUITECTURA] Aprobación vigente (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);
    registrarTelemetria({ tipo: 'check-gate', subsistema: '002_principal', resultado: 'aprobado', firma: veredicto.firma });

    // Subgates elite (003/004/006) — solo bloquean si el commit toca algo que
    // les compete (003/004: src/**/*.jsx|tsx; 006: render.yaml/.env.example/
    // dependencias); si no, no agregan fricción a commits que no los tocan.
    const archivosStaged = obtenerArchivosStaged();
    let subgatesOk = true;
    for (const agentId of Object.keys(SUBGATES)) {
        const resultado = validarSubgate(agentId, archivosStaged);
        if (!resultado.aplica) continue;
        if (!resultado.aprobado) {
            console.error(`\n🛑 [SUBGATE_${agentId}] ${resultado.razon}`);
            registrarTelemetria({ tipo: 'check-gate', subsistema: agentId, resultado: 'rechazado', razon: resultado.razon });
            subgatesOk = false;
        } else {
            console.log(`✅ [SUBGATE_${agentId}] Aprobación vigente sobre los archivos relevantes de este commit.`);
            registrarTelemetria({ tipo: 'check-gate', subsistema: agentId, resultado: 'aprobado' });
        }
    }
    // Chequeos estáticos de 006_DEVSECOPS_INFRAESTRUCTURA — secretos, .env,
    // dependencias. Sin costo de API, corren siempre, aquí mismo.
    let chequeosOk = true;
    for (const r of ejecutarChequeosEstaticos(archivosStaged)) {
        if (!r.ok) {
            console.error(`\n🛑 [006_DEVSECOPS · ${r.categoria}] ${r.razon}`);
            registrarTelemetria({ tipo: 'check-gate', subsistema: `006_${r.categoria}`, resultado: 'rechazado', razon: r.razon });
            chequeosOk = false;
        } else {
            console.log(`✅ [006_DEVSECOPS · ${r.categoria}] OK`);
            registrarTelemetria({ tipo: 'check-gate', subsistema: `006_${r.categoria}`, resultado: 'aprobado' });
        }
    }

    // Vigilancia activa del PMU — advisories, nunca bloquean el commit, pero
    // ya no dependen de que alguien invoque a 006 a mano para notarlas.
    for (const alerta of analizarTelemetriaPMU()) {
        console.warn(`\n⚠️  [PMU] ${alerta.subsistema}: ${alerta.cantidad} rechazos consecutivos. Última razón: ${alerta.ultima_razon || 'sin razón registrada'}`);
        registrarTelemetria({ tipo: 'alerta_pmu', subsistema: alerta.subsistema, resultado: 'advertencia', razon: `${alerta.cantidad} rechazos consecutivos` });
    }
    for (const alerta of verificarVigenciaAgentes()) {
        console.warn(`\n⚠️  [PMU] ${alerta.agente}: ${alerta.razon}`);
        registrarTelemetria({ tipo: 'alerta_pmu', subsistema: alerta.agente, resultado: 'advertencia', razon: alerta.razon });
    }

    escribirEstadoOperativo();
    process.exitCode = (subgatesOk && chequeosOk) ? 0 : 1;
    return;
}

// Modo tablero: `node agents/architecture-gate.cjs --pmu-status` — imprime el
// estado operativo actual del Escuadrón Élite completo, regenerado en el
// momento (nunca sirve una copia vieja). No consume API.
if (process.argv.includes('--pmu-status')) {
    const estado = escribirEstadoOperativo();
    console.log(`\n🎖️  PUESTO DE MANDO UNIFICADO — Escuadrón Élite (${estado.generado})`);
    console.log(`   ${estado.total_agentes} agentes registrados · ${estado.agentes_con_gate} con gate técnico propio\n`);
    for (const a of estado.agentes) {
        const escritura = a.permiso_escritura ? '✍️  ESCRITURA' : '👁️  solo lectura';
        const gate = a.gate === 'sin_gate_propio' ? '⚪ sin gate propio' : `🔒 ${a.gate}`;
        const veredicto = a.ultimo_veredicto
            ? (a.ultimo_veredicto.aprobado ? `✅ aprobado (${(a.ultimo_veredicto.timestamp || '').slice(0, 10)})` : '🛑 rechazado')
            : '— sin veredicto registrado';
        console.log(`   ${a.nombre || a.archivo}`);
        console.log(`      ${escritura} · ${gate} · ${veredicto}`);
    }
    process.exitCode = 0;
    return;
}

// Modo firma de subgate: `node agents/architecture-gate.cjs --aprobar-subgate <agentId>`
if (process.argv.includes('--aprobar-subgate')) {
    const agentId = process.argv[process.argv.indexOf('--aprobar-subgate') + 1];
    if (!SUBGATES[agentId]) {
        console.error(`🛑 [SUBGATE] '${agentId}' no es un subgate configurado. Válidos: ${Object.keys(SUBGATES).join(', ')}`);
        process.exitCode = 1;
        return;
    }
    (async () => {
        const cfg = SUBGATES[agentId];
        const archivosStaged = obtenerArchivosStaged();
        const relevantes = archivosRelevantesPara(agentId, archivosStaged);
        if (relevantes.length === 0) {
            console.log(`ℹ️  [SUBGATE_${agentId}] Ningún archivo staged le compete a este agente — nada que aprobar.`);
            process.exitCode = 0;
            return;
        }
        console.log(`\n🔎 [${agentId}] Evaluando ${relevantes.length} archivo(s) staged contra ${path.basename(cfg.promptPath)}...`);
        const veredicto = await pedirVeredictoSubagente(agentId, relevantes);
        if (!veredicto.aprobado) {
            console.error(`\n🛑 [SUBGATE_${agentId}] Rechazado — o no se pudo evaluar.`);
            if (veredicto.razon) console.error(`   - ${veredicto.razon}`);
            if (veredicto.respuestaCruda) console.error(`   Respuesta cruda: ${veredicto.respuestaCruda}`);
            registrarTelemetria({ tipo: 'aprobar-subgate', subsistema: agentId, resultado: 'rechazado', razon: veredicto.razon || null });
            escribirEstadoOperativo();
            process.exitCode = 1;
            return;
        }
        const firma = hashArchivosStaged(relevantes);
        fs.writeFileSync(cfg.veredictoPath, JSON.stringify({
            aprobado: true,
            firma,
            timestamp: new Date().toISOString(),
            firmado_por: `${agentId} (${path.relative(dirRoot, cfg.promptPath)}, vía API Anthropic)`,
            veredictoCompleto: veredicto.veredictoCompleto,
        }, null, 2) + '\n', 'utf8');
        console.log(`\n✅ [SUBGATE_${agentId}] Aprobado. Firma: ${firma}`);
        registrarTelemetria({ tipo: 'aprobar-subgate', subsistema: agentId, resultado: 'aprobado', firma });
        escribirEstadoOperativo();
        process.exitCode = 0;
    })();
    return;
}

// Modo firma: `node agents/architecture-gate.cjs --aprobar-diseno`
// Invoca al Agente Arquitecto real (.claude/agents/002-arquitecto-de-software.md vía API de
// Anthropic) sobre el git diff pendiente. Solo si su veredicto es aprobado:true
// se calcula el hash y se escribe diseno_aprobado.json — ya no hay autofirma.
if (process.argv.includes('--aprobar-diseno')) {
    (async () => {
        console.log('\n🔎 [Agente Arquitecto] Evaluando git diff HEAD contra .claude/agents/002-arquitecto-de-software.md...');
        const veredicto = await pedirVeredictoArquitecto();

        if (!veredicto.aprobado) {
            console.error('\n🛑 [GATE_ARQUITECTURA] El Agente Arquitecto RECHAZÓ el diseño — o no pudo evaluarlo.');
            (veredicto.razones || []).forEach(r => console.error(`   - ${r}`));
            if (veredicto.respuestaCruda) console.error(`   Respuesta cruda: ${veredicto.respuestaCruda}`);
            registrarTelemetria({ tipo: 'aprobar-diseno', subsistema: '002_principal', resultado: 'rechazado', razones: veredicto.razones || [] });
            escribirEstadoOperativo();
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
            firmado_por: 'Agente Arquitecto (.claude/agents/002-arquitecto-de-software.md, vía API Anthropic)',
            razones: veredicto.razones,
        }, null, 2) + '\n', 'utf8');
        console.log(`\n✅ [Agente Arquitecto] Diseño aprobado. Firma: ${firma}`);
        (veredicto.razones || []).forEach(r => console.log(`   - ${r}`));
        registrarTelemetria({ tipo: 'aprobar-diseno', subsistema: '002_principal', resultado: 'aprobado', firma });
        escribirEstadoOperativo();
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
const AUDIT_TRAIL_PATH = path.join(dirAgents, '001_ORQUESTADOR_MAESTRO', 'orquestacion_log.jsonl');

function escribirAuditTrail(registro) {
    fs.mkdirSync(path.dirname(AUDIT_TRAIL_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_TRAIL_PATH, JSON.stringify(registro) + '\n', 'utf8');
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
    console.log(`📊 [AUDIT_TRAIL] agents/001_ORQUESTADOR_MAESTRO/orquestacion_log.jsonl (append, +1 linea, ${resultadosAuditTrail.length} resultado(s))`);

    console.log('\n✅ OBRA FINALIZADA: Director Jairo Antonio Salinas Velasco | Asfáltica S.A.S.');
    console.log('------------------------------------------------------------');
    console.log('\n[001] Protocolo de Honestidad Técnica: ACTIVO');
    console.log('[001] Cada resultado fue verificado. Sin alucinaciones.');
}

// Guard de entry-point (2026-08-12, auditoría "reloj suizo"): sin esto,
// `require('./architecture-gate.cjs')` desde un test dispararía el batch
// executor completo de verdad (ningún modo --rutear/--check-gate/
// --aprobar-diseno estaba presente en process.argv durante un test, así que
// la ejecución caía aquí sin ningún guardia). module.exports expone las
// funciones puras (hashArchivo, hashEstado, validarDisenoAprobado,
// listarCarpetasAgentes) para scripts/architecture-gate.test.cjs sin correr
// nada con efectos secundarios.
if (require.main === module) {
    ejecutarTodosLosAgentes();
}

module.exports = {
    hashArchivo, hashEstado, validarDisenoAprobado, listarCarpetasAgentes, rutear,
    SUBGATES, archivosRelevantesPara, validarSubgate,
    descubrirAgentes, generarEstadoOperativo, mapaGatesPorPrefijo, leerFrontmatterAgente,
    escanearSecretos, verificarEnvExample, verificarDependencias, ejecutarChequeosEstaticos,
    diffTocaDependencias, bucketDe, construirDiffPriorizado,
    analizarTelemetriaPMU, verificarVigenciaAgentes, leerTelemetria,
};
