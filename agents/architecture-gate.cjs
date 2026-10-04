const { exec, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
// Capa única de proveedor (ADR-0002, 2026-09-26): NIM principal, breaker,
// filtrado de secretos. Ver agents/gate-proveedor.cjs.
const proveedorIA = require('./gate-proveedor.cjs');

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
// ESTE OBJETO ES PURAMENTE INFORMATIVO (usado solo por comandanteDe(), para el
// batch executor legado) — la fuente real de mandato/tools/skills de cada
// agente SIEMPRE es .claude/agents/00X-*.md, nunca este objeto ni las carpetas
// de agents/.
//
// NOMENCLATURA FÍSICA 2026-08-16 (mandato del usuario, normalización 001-010):
// agents/ ahora lista físicamente 001 a 010 por convención de nombre. 002-008
// son carpetas PUNTERO (solo README.md, sin contenido real — ver
// agents/00X-*/README.md) porque nunca tuvieron implementación en el sistema
// de carpetas legacy. 001, 009 y 010 SÍ tienen contenido real, pero es
// contenido de un sistema DISTINTO (Sistema A, dominio construcción/Radar,
// nada que ver con Antigravity OS) que ahora comparte nombre EXACTO con el
// agente real homónimo en .claude/agents/ — ver advertencia de colisión en
// cada IDENTITY.md renombrado y en .claude/agents/009-ingeniero-frontend.md /
// 010-ingeniero-qa-automatizacion.md. Las claves de ESCUADRON_ELITE abajo
// (ej. '003_ESP_DISENO_STITCH') deliberadamente NO coinciden con los nombres
// de carpeta nuevos (ej. '003-esp-diseno-stitch') — evita que comandanteDe()
// asocie por accidente una carpeta-puntero vacía con un mandato real.
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
    // Agregado 2026-08-13: brecha real encontrada en auditoría — 003/004
    // auditan frontend (solo lectura) pero nadie del escuadrón lo
    // construía; el trabajo lo hacía Claude principal fuera del sistema de
    // agentes. Auto-registra su propio subgate vía frontmatter (patrón
    // "Lego", §0-Y) — no necesita entrada en SUBGATES aquí.
    '009_INGENIERO_FRONTEND': {
        rol: 'Único con permiso de escritura sobre public/ — implementa hallazgos de 003/004/008 y pantallas ya aprobadas por 002 (subagente real: .claude/agents/009-ingeniero-frontend.md)',
        subordinados: [],
    },
    '005_INGENIERO_BACKEND': {
        rol: 'Bases de datos, APIs y lógica de servidor (fusiona el antiguo 002_INGENIERIA_TOTAL)',
        // '07-ing-concreto_GFRC' y '08-estratega-neuromarketing' purgados
        // 2026-08-13 (auditoría §0-Z): solo tenían IDENTITY.md, cero código,
        // 0 referencias reales — confirmado y autorizado explícitamente.
        // '011_Radar1_minero' purgado (solo código, IDENTITY.md/datos históricos
        // preservados) 2026-08-13: duplicaba la misma capacidad que el Radar
        // real en producción (src/modules/radar/m1Pipeline.js), inactivo desde
        // 2026-05-16 — orden explícita del usuario ("no admito sistemas o
        // agentes paralelos con las mismas habilidades"). Renombrada a
        // 'Proy_03 A Radar' 2026-08-16, luego reubicada el mismo día fuera de
        // agents/ (ver nota de purga abajo) — sigue sin código.
        //
        // PURGA 2026-08-16 (mandato directo del usuario, "limpieza total y
        // reestructuración"): '012_Radar2_Estratega', '052_Form_Administrativo'
        // y '015_intelligence-core' eliminados físicamente del disco (sin
        // consumidores reales en src/ ni server.js, confirmado antes de
        // borrar). 'Proy_03 A Radar', 'Proy_03 B Formulador' y
        // 'Proy_03 GP Radford-360' NO se purgaron — se reubicaron a
        // projects/Radford-360/ (dominio de proyecto, fuera de agents/, que
        // ahora contiene solo al Escuadrón Élite legacy 001/009/010). Ya no
        // son subordinados de esta carpeta a efectos de listarCarpetasAgentes()
        // (que solo escanea agents/) — la relación jerárquica GP→A/B sigue
        // viva, documentada en agents/001-orquestador-maestro/IDENTITY.md.
        //
        // RENOMBRADA 2026-08-16 (mismo mandato de normalización de
        // nomenclatura): '009_gestor_datos' -> '009-ingeniero-frontend'. Pese
        // al nombre, sigue siendo el agente legacy de gestión de datos/OCR —
        // NO tiene relación con el subagente real homónimo de frontend
        // (.claude/agents/009-ingeniero-frontend.md). Ver advertencia de
        // colisión en agents/009-ingeniero-frontend/IDENTITY.md.
        //
        // AISLADA 2026-09-25 (orden del usuario): agents/001-orquestador-maestro/,
        // agents/009-ingeniero-frontend/ y agents/010-ingeniero-qa-automatizacion/
        // (Sistema A) movidas a _legacy_backup/ — fin de la colisión de nombres
        // con .claude/agents/. Skills MGA del 010 legacy rescatadas en
        // docs/skills-rescate-mga/.
        subordinados: [],
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
        // 14-analista-comportamiento). La carpeta (luego agents/010-ingeniero-qa-automatizacion/)
        // se movió a _legacy_backup/ el 2026-09-25; sus 2 skills quedaron
        // rescatadas en docs/skills-rescate-mga/.
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
// 'convocatorias' removido 2026-08-13: apuntaba a '011_Radar1_minero',
// purgado por duplicar la capacidad real del Radar en producción
// (src/modules/radar/m1Pipeline.js + endpoint /api/convocatorias en
// server.js) — sin código ejecutable, no hay destino válido al que rutear.
// (esa carpeta fue renombrada a 'Proy_03 A Radar' 2026-08-16, sigue igual
// de inactiva — no reintroduce la clave 'convocatorias').
// 'formulacion' actualizado 2026-08-16 (dos veces en la misma fecha): primero
// renombrado de '050_Formulador_proy' a 'Proy_03 B Formulador', luego
// reubicado fuera de agents/ a projects/Radford-360/Proy_03 B Formulador/
// (mandato directo del usuario, "limpieza total y reestructuración") — el
// valor ahora es ruta relativa a la raíz del repo, no solo nombre de carpeta.
// 'administrativo' e 'inteligencia_mercado' removidas en la misma ronda:
// apuntaban a '052_Form_Administrativo' y '012_Radar2_Estratega', ambas
// purgadas del disco (0 código real, mismo criterio que 'convocatorias'
// arriba) — sin destino válido al que rutear.
const ENRUTADOR_ESTATICO = {
    formulacion: 'projects/Radford-360/Proy_03 B Formulador',
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
// Estado del circuit breaker del proveedor de IA (ADR-0002 §2.4) — generado
// por código, fuera de las carpetas numeradas de agents/ (no entra en
// hashEstado, no autoinvalida la firma).
const BREAKER_PATH = path.join(dirAgents, 'pmu', 'circuit_breaker.json');
// Formato de diff determinista para lo que sale al proveedor (hallazgo 008):
// sin color, sin diff externo, prefijos a/ b/ fijos aunque el usuario tenga
// diff.noprefix / diff.mnemonicPrefix — filtrarSecretosDiff() depende de
// poder leer la ruta de cada sección.
const FLAGS_DIFF_PROVEEDOR = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];

// Punto único de llamada a modelo para 002 y subgates. Filtra secretos del
// diff antes de que salga a un tercero, registra consumo de tokens y fallas
// del proveedor en telemetría (nunca la key). Devuelve {ok:true, texto} o
// {ok:false, error: ErrorProveedor}.
async function consultarModelo(subsistema, { system, user, max_tokens }) {
    const { diff: userFiltrado, omitidos } = proveedorIA.filtrarSecretosDiff(user);
    try {
        // Cadena por defecto: modelos NIM gratuitos (GATE_FALLBACK_CHAIN la reemplaza).
        const r = await proveedorIA.llamarModelo({ system, user: userFiltrado, max_tokens }, { breakerPath: BREAKER_PATH, cadenaPorDefecto: proveedorIA.CADENA_NIM_DEFAULT });
        registrarTelemetria({
            tipo: 'uso_modelo', subsistema, resultado: 'ok', proveedor: r.proveedor, modelo: r.modelo,
            intentos: r.intentos, uso: r.uso, fin: r.fin, archivos_sensibles_omitidos: omitidos.length,
            texto_chars: r.texto_chars ?? null, razonamiento_chars: r.razonamiento_chars ?? null,
            failover: r.failover ?? null,
        });
        return { ok: true, texto: r.texto, fin: r.fin, proveedor: r.proveedor, modelo: r.modelo };
    } catch (e) {
        const err = e instanceof proveedorIA.ErrorProveedor ? e
            : new proveedorIA.ErrorProveedor({ codigo: 'error_interno', categoria: 'solicitud', detalle: proveedorIA.redactar(e?.message || e).slice(0, 300) });
        registrarTelemetria({
            tipo: 'fallo_proveedor', subsistema, resultado: proveedorIA.esCritico(err.categoria) ? 'alerta_critica' : 'fallo',
            codigo: err.codigo, categoria: err.categoria, http: err.http, razon: err.detalle,
        });
        return { ok: false, error: err };
    }
}

// Texto de razón para un fallo de proveedor que NO es elegible para soft-fail.
function razonFalloProveedor(err) {
    const prefijo = proveedorIA.esCritico(err.categoria) ? '🚨 ALERTA CRÍTICA DE PROVEEDOR EXTERNO — ' : '';
    return `${prefijo}Fallo del proveedor de IA (${err.codigo}, categoría ${err.categoria}): ${err.detalle}`;
}

// Orden de prioridad para el diff que se manda a 002 — más crítico primero.
// Corrige un hallazgo real (2026-08-13): un corte crudo de `git diff HEAD` a
// 60000 caracteres, por orden alfabético, dejó fuera los fixes de seguridad
// reales (server.js, public/app.js) porque package-lock.json (1400+ líneas)
// venía antes alfabéticamente y se comió el presupuesto — 002 aprobó habiendo
// visto solo cambios de PMU/dependencias, no el diff que realmente importaba.
const PRIORIDAD_DIFF = [
    /^\.claude\/agents\//,
    /^docs\/ADR\//,                                  // decisiones que el diff dice implementar (cortas, alto valor)
    // gate-proveedor.cjs junto al gate (hallazgo 2026-09-26: 002 rechazó por
    // "dependencia dura no visible" — caía al bucket final y nunca entraba).
    /^agents\/(architecture-gate|gate-proveedor)\.cjs$/,
    /^src\//,
    /^server\.js$/,
    /^public\/(?!estado_antigravity\.json)/,       // frontend real, no el JSON auto-generado
    /^(AGENTS|CLAUDE)\.md$/,
    /^docs\//,
    /^(tests|scripts)\//,
    // todo lo demás (lockfiles, telemetría/estado PMU auto-generados, etc.)
    // cae al final por no matchear ningún patrón de arriba — ver bucketDe().
];

// Presupuesto del diff para 002 (2026-09-26): 60 000 caracteres dejaban fuera
// gate-proveedor.cjs y ADR-0002 de un diff real de ~400 000. Medido en vivo
// con deepseek-v4.1-flash: 60 000 caracteres = 21 642 prompt_tokens →
// respondió; 185 000 → sin primer byte en 3×120 s. 130 000 ≈ 40 000 tokens
// cubre agentes + ADR + código del gate completo.
const LIMITE_DIFF_002 = 130000;
// Binarios: su diff textual (PDF con streams) es ruido que consume presupuesto.
const EXT_BINARIA = /\.(pdf|png|jpe?g|gif|webp|ico|bmp|zip|gz|7z|xlsx?|docx?|pptx?|woff2?|ttf|otf|eot|mp[34]|wav|sqlite|db)$/i;

function bucketDe(archivo) {
    const idx = PRIORIDAD_DIFF.findIndex(p => p.test(archivo));
    return idx === -1 ? PRIORIDAD_DIFF.length : idx;
}

// Construye el diff a mandar a la API ordenando por criticidad, no
// alfabéticamente — si algo se trunca, que sea lo menos importante
// (lockfiles/artefactos auto-generados), nunca código de aplicación o
// definiciones de agentes.
// Resumen de una sección que no vale la pena enviar completa. Cabecera con
// formato git real: filtrarSecretosDiff() necesita leer la ruta.
function seccionResumida(archivo, nota) {
    return `diff --git a/${archivo} b/${archivo}\n[${nota}]\n`;
}

function construirDiffPriorizado(limiteChars) {
    let archivos;
    const eliminados = new Set();
    try {
        // --name-status: una baja (D) se fiscaliza por su nombre, no línea a
        // línea — 20 archivos legacy borrados se comían ~60 KB de presupuesto.
        // --no-renames: cada ruta aparece sola, igual que el diff por archivo.
        archivos = execFileSync('git', ['diff', 'HEAD', '--name-status', '--no-renames'], { cwd: dirRoot, encoding: 'utf8' })
            .split('\n').map(l => l.trim()).filter(Boolean)
            .map(l => {
                const [estado, ...ruta] = l.split('\t');
                const archivo = ruta.join('\t');
                if (estado === 'D') eliminados.add(archivo);
                return archivo;
            })
            .filter(Boolean);
    } catch (e) {
        return { diff: '', truncado: false, error: `No se pudo leer 'git diff HEAD --name-status': ${e.message}` };
    }
    if (archivos.length === 0) return { diff: '', truncado: false };

    archivos.sort((a, b) => bucketDe(a) - bucketDe(b));

    let acumulado = '';
    let truncadoParcial = false;
    const omitidos = [];
    for (const archivo of archivos) {
        // Bajas y binarios cuestan ~150 caracteres: se nombran siempre, aun
        // con el presupuesto agotado — ningún cambio queda invisible para 002.
        const resumible = eliminados.has(archivo) || EXT_BINARIA.test(archivo);
        if (acumulado.length >= limiteChars && !resumible) { omitidos.push(archivo); continue; }
        let diffArchivo;
        if (eliminados.has(archivo)) {
            diffArchivo = seccionResumida(archivo, 'archivo ELIMINADO — contenido previo omitido; se fiscaliza la baja por su ruta');
        } else if (EXT_BINARIA.test(archivo)) {
            diffArchivo = seccionResumida(archivo, 'archivo binario modificado — contenido omitido');
        } else try {
            diffArchivo = execFileSync('git', ['diff', ...FLAGS_DIFF_PROVEEDOR, 'HEAD', '--', archivo], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        } catch (e) {
            diffArchivo = `[No se pudo leer el diff de ${archivo}: ${e.message}]\n`;
        }
        const espacioRestante = limiteChars - acumulado.length;
        if (!resumible && diffArchivo.length > espacioRestante) {
            // El corte deja acumulado >= limiteChars: los siguientes no
            // resumibles caen a omitidos por el chequeo de arriba.
            acumulado += diffArchivo.slice(0, espacioRestante) + `\n[... ${archivo} truncado aquí, sin espacio restante ...]\n`;
            truncadoParcial = true;
            continue;
        }
        acumulado += diffArchivo;
    }
    return { diff: acumulado, truncado: truncadoParcial || omitidos.length > 0, omitidos };
}

// Extrae el ÚLTIMO objeto JSON de nivel superior balanceado del texto que
// contenga el campo dado. Corrige un bug real (2026-08-13, encontrado en
// vivo con el subgate de 006): el regex anterior (`\{[^{}]*"campo"...[^{}]*\}`)
// asumía que no había llaves anidadas entre el campo y el cierre — se
// rompía en cuanto el veredicto incluía un array de objetos (hallazgos/
// inconsistencias/anomalias, que TODOS los agentes del escuadrón usan en su
// salida obligatoria), reportando "veredicto JSON no parseable" con un
// hallazgo real presente. Este extractor cuenta profundidad de llaves en
// vez de asumir que no hay anidamiento.
function extraerJSONConCampo(texto, campo) {
    const bloques = [];
    let profundidad = 0;
    let inicio = -1;
    for (let i = 0; i < texto.length; i++) {
        if (texto[i] === '{') {
            if (profundidad === 0) inicio = i;
            profundidad++;
        } else if (texto[i] === '}') {
            profundidad--;
            if (profundidad === 0 && inicio !== -1) {
                bloques.push(texto.slice(inicio, i + 1));
                inicio = -1;
            }
        }
    }
    // De atrás hacia adelante: el veredicto siempre va al final ("termina
    // siempre con tu JSON de salida obligatorio").
    for (let i = bloques.length - 1; i >= 0; i--) {
        try {
            const obj = JSON.parse(bloques[i]);
            if (Object.prototype.hasOwnProperty.call(obj, campo)) return obj;
        } catch {
            // bloque no es JSON válido por sí solo (ej. un ejemplo de código
            // en el análisis narrativo) — seguir probando bloques anteriores.
        }
    }
    return null;
}

// Harness Engineering (orden explícita del usuario, 2026-08-13): hasta ahora
// extraerJSONConCampo() solo verificaba que el campo de aprobación existiera
// — el resto de la forma (arrays de hallazgos con sus claves, tipos correctos)
// no se validaba nunca. Un veredicto con "razones": "string suelto" en vez de
// array, o un hallazgo sin "archivo", pasaba silenciosamente hacia el resto
// del sistema (PMU, docs). Cierra la brecha real de "salida de agente sin
// validar por esquema" identificada al evaluar Harness Engineering contra
// este sistema — con precedente concreto (el bug de extraerJSONConCampo con
// arrays anidados, 2026-08-13). Contrato tomado literal de la sección
// "Salida obligatoria" de cada .claude/agents/*.md — si ese archivo cambia
// su contrato, este objeto debe actualizarse en el mismo commit.
const VEREDICTO_SCHEMAS = {
    '002_ARQUITECTO_DE_SOFTWARE': z.object({
        aprobado: z.boolean(),
        razones: z.array(z.string()),
        // Mecanismo de diferimiento estructural — agregado 2026-08-16
        // (hallazgo real: no existía NINGUNA conexión entre el veredicto de
        // 002 y el resultado de un subgate; "diferido por arquitectura" era
        // una frase que yo usaba sin que el código la implementara). 002
        // declara aquí, como parte de SU MISMO veredicto real de API — no
        // vía un flag manual ni parseo de prosa — qué subgate concreto
        // considera no-bloqueante para este diff y por qué. Opcional,
        // default vacío: la inmensa mayoría de las aprobaciones no difieren
        // nada.
        diferimientos: z.array(z.object({
            subgate: z.string(),
            razon: z.string(),
        })).default([]),
    }),
    '003_ESP_DISENO_STITCH': z.object({
        diseno_valido: z.boolean(),
        inconsistencias: z.array(z.object({
            archivo: z.string(),
            tipo: z.string(),
            evidencia: z.string(),
        })),
    }),
    '004_SENTINELA_FRONTEND': z.object({
        limpio: z.boolean(),
        hallazgos: z.array(z.object({
            archivo: z.string(),
            tipo: z.string(),
            evidencia: z.string(),
        })),
    }),
    '005_INGENIERO_BACKEND': z.object({
        estado_backend: z.enum(['aislado_y_seguro', 'brechas_detectadas', 'bloqueado_por_diseno']),
        brechas_rls: z.number(),
        anomalias: z.array(z.object({
            archivo: z.string(),
            tipo: z.string(),
            evidencia: z.string(),
        })),
    }),
    '006_DEVSECOPS_INFRAESTRUCTURA': z.object({
        infraestructura_segura: z.boolean(),
        hallazgos: z.array(z.object({
            categoria: z.string(),
            evidencia: z.string(),
            criticidad: z.enum(['alta', 'media', 'baja']),
        })),
    }),
    '009_INGENIERO_FRONTEND': z.object({
        codigo_valido: z.boolean(),
        cambios: z.array(z.object({
            archivo: z.string(),
            tipo: z.string(),
            origen_hallazgo: z.string(),
            resumen: z.string(),
        })),
    }),
    // Agregado 2026-09-26 (PMU Titán V2): 010 era el único subgate sin
    // contrato — validarFormaVeredicto() lo dejaba pasar sin validar forma.
    // Refleja la "Salida obligatoria" declarada en
    // .claude/agents/010-ingeniero-qa-automatizacion.md:39-41.
    '010_INGENIERO_QA_AUTOMATIZACION': z.object({
        suite_valida: z.boolean(),
        specs: z.array(z.object({
            archivo: z.string(),
            flujo: z.string(),
            resultado: z.enum(['pass', 'fail', 'skip_justificado']),
        })),
    }),
};

// Fail-closed: un veredicto que no matchea la forma declarada por su propio
// agente NUNCA se trata como aprobado, aunque el campo booleano diga true —
// mismo criterio de "Honestidad Técnica" que el resto del gate. Agentes sin
// contrato en VEREDICTO_SCHEMAS no bloquean (compatibilidad hacia atrás).
function validarFormaVeredicto(agentId, veredicto) {
    const schema = VEREDICTO_SCHEMAS[agentId];
    if (!schema) return { ok: true };
    const resultado = schema.safeParse(veredicto);
    if (resultado.success) return { ok: true };
    const detalle = resultado.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, razon: `Veredicto de ${agentId} no cumple su contrato de salida declarado: ${detalle}` };
}

// Invoca al Agente Arquitecto real: system prompt = 002-arquitecto-de-software.md, input = git diff
// pendiente contra HEAD. Nunca autoaprueba por ausencia de respuesta — todo camino
// de error devuelve aprobado:false con la razón concreta (Honestidad Técnica).
async function pedirVeredictoArquitecto() {
    // Chequeo de key movido a gate-proveedor.cjs (2026-09-26): depende del
    // proveedor activo (NVIDIA_API_KEY o ANTHROPIC_API_KEY); ausente sigue
    // siendo bloqueo duro (categoría 'config', nunca soft-fail).
    if (!fs.existsSync(ARCHITECT_PROMPT_PATH)) {
        return { aprobado: false, razones: [`No existe ${ARCHITECT_PROMPT_PATH} — sin criterio de arquitectura que aplicar.`] };
    }
    const systemPrompt = fs.readFileSync(ARCHITECT_PROMPT_PATH, 'utf8');

    const { diff, truncado, omitidos, error } = construirDiffPriorizado(LIMITE_DIFF_002);
    if (error) {
        return { aprobado: false, razones: [error] };
    }
    if (!diff || !diff.trim()) {
        return { aprobado: false, razones: ['git diff HEAD está vacío — no hay cambios pendientes que aprobar.'] };
    }

    const avisoTruncamiento = truncado
        ? `\n\nAVISO: el diff completo no cabía en el presupuesto de caracteres. Se priorizó por criticidad ` +
          `(.claude/agents/, docs/ADR, código de gate, src/, server.js, frontend real, AGENTS.md, docs, tests — en ese orden); lo que quedó ` +
          `fuera son archivos de menor riesgo (lockfiles, artefactos auto-generados como telemetría/estado PMU): ` +
          `${omitidos.length ? omitidos.join(', ') : '(ninguno completo; solo el último archivo quedó cortado)'}. ` +
          `Si alguno de esos archivos omitidos SÍ te parece crítico por su nombre, no apruebes sin verlo — pide que se re-envíe.`
        : '';

    // Proveedor vía consultarModelo() desde 2026-09-26 (ADR-0002): NIM por
    // defecto, breaker, reintentos, filtrado de secretos del diff.
    const r = await consultarModelo('002_principal', {
            // 1500 no alcanzaba en diffs grandes (>15 archivos): el análisis
            // narrativo agotaba el presupuesto antes de llegar al JSON final,
            // y el veredicto quedaba truncado y sin parsear (hallazgo 2026-08-08,
            // reproducido en vivo con el diff de esta misma sesión).
            // 4096 → 8192 (2026-09-26): deepseek-v4.1-flash usó 4039/4096
            // (98,6 %) en su primer veredicto real — a un paso del truncado.
            max_tokens: 8192,
            system: systemPrompt,
            user: `Fiscaliza el siguiente diff pendiente de aprobación (git diff HEAD, reordenado por criticidad y ` +
                    `truncado a ${LIMITE_DIFF_002} caracteres si aplica — ver aviso al final si corresponde; los archivos ` +
                    `eliminados y binarios aparecen resumidos por ruta). ` +
                    `IMPORTANTE: esta invocación es una llamada directa a un modelo vía API, no una sesión de Claude Code — ` +
                    `no tienes acceso real a Read/Grep/Glob aquí pese a lo que indique tu system prompt para tu uso habitual. ` +
                    `No emitas tool_call ni nada similar: no se ejecutará. Basa tu fiscalización únicamente en el diff de texto ` +
                    `provisto abajo (línea de contexto suficiente para evaluar consistencia, completitud y alcance). ` +
                    // JSON PRIMERO (2026-09-26, medido en vivo): con "JSON al
                    // final", deepseek-v4.1-flash agotó 8192/8192 tokens en el
                    // análisis (fin=length) y el veredicto nunca se emitió.
                    // extraerJSONConCampo() encuentra el bloque con "aprobado"
                    // en cualquier posición: un análisis cortado después del
                    // JSON ya no invalida la decisión.
                    `FORMATO OBLIGATORIO PARA ESTA INVOCACIÓN (prevalece sobre "termina con tu JSON" de tu system prompt): ` +
                    `decide primero y emite COMO PRIMERA SALIDA tu JSON de veredicto completo ` +
                    `({"aprobado": boolean, "razones": [string], "diferimientos": [{"subgate": string, "razon": string}]}); ` +
                    `después, como máximo 300 palabras de análisis que sustenten las razones. Solo el JSON es parseable; ` +
                    `si el análisis se corta por longitud, la decisión ya quedó registrada.\n\n${diff}${avisoTruncamiento}`,
    });
    if (!r.ok) {
        const falloApi = clasificarFalloApi(r.error);
        if (falloApi) {
            return { aprobado: false, apiNoDisponible: true, falloApi, razones: [`Proveedor de IA no disponible (${falloApi.codigo}): ${falloApi.detalle}`] };
        }
        return { aprobado: false, razones: [razonFalloProveedor(r.error)] };
    }

    const text = r.texto;
    const veredicto = extraerJSONConCampo(text, 'aprobado');
    if (!veredicto) {
        const razon = r.fin === 'length'
            ? 'El Agente Arquitecto agotó max_tokens (finish_reason=length) antes de emitir el veredicto JSON — respuesta truncada, no aprobada.'
            : 'El Agente Arquitecto no devolvió un veredicto JSON parseable.';
        return { aprobado: false, razones: [razon], respuestaCruda: text.slice(0, 800) };
    }
    const forma = validarFormaVeredicto('002_ARQUITECTO_DE_SOFTWARE', veredicto);
    if (!forma.ok) {
        return { aprobado: false, razones: [forma.razon], respuestaCruda: text.slice(0, 800) };
    }
    return {
        aprobado: veredicto.aprobado === true,
        razones: veredicto.razones || [],
        diferimientos: veredicto.diferimientos || [],
        proveedor: r.proveedor, modelo: r.modelo,
    };
}

// Trazabilidad exacta del evaluador (2026-09-26, PMU Titán V2): proveedor y
// modelo que REALMENTE respondieron, no un literal quemado.
function firmaEvaluador(quien, promptRel, v) {
    return `${quien} (${promptRel}, vía API ${v.proveedor || 'desconocido'} · modelo ${v.modelo || 'desconocido'})`;
}

// 001_ORQUESTADOR_MAESTRO (antes 000_ORQUESTADOR) excluido a propósito: no es
// un agente subordinado con una tarea de un solo disparo (como 050-056) — es
// la carpeta hogar del propio orquestador, y contiene
// agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py, un daemon de loop
// infinito. Antes de esta exclusión, ejecutarTodosLosAgentes() lo recogía como
// "ejecutable" de esa carpeta y siempre agotaba el timeout de 30s reportándolo
// como fallo — arquitectura incompatible, no un bug del daemon (hallazgo
// 2026-08-08, docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §3.2).
// Renombrada 2026-08-16 de '001_ORQUESTADOR_MAESTRO' a '001-orquestador-maestro'
// (mandato del usuario, normalización de nomenclatura 001-010 en agents/).
// Movida a _legacy_backup/ 2026-09-25 — la exclusión queda como salvaguarda
// por si la carpeta se restaurara; sin efecto mientras no exista en agents/.
const CARPETAS_EXCLUIDAS_DEL_BATCH = new Set(['001-orquestador-maestro']);

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

    // CORREGIDO 2026-08-13 — mismo bug de raíz que rompía los subgates de
    // 003/004 (§0-Z), pero aquí en el gate PRINCIPAL: la firma nunca incluía
    // `public/src/` (el frontend React real, 13 archivos .jsx/.tsx) ni las
    // páginas HTML/JS sueltas de `public/`. Un cambio no revisado en
    // App.jsx/RadarApp.jsx/etc. no invalidaba `diseno_aprobado.json` en
    // absoluto — `--check-gate` seguía diciendo "Aprobación vigente" con una
    // firma calculada antes de que ese cambio existiera. Bypass real y
    // silencioso de "cero código sin diseño aprobado" para todo el frontend.
    const dirPublicSrc = path.join(dirRoot, 'public', 'src');
    const archivosPublicSrc = listarArchivosRecursivo(dirPublicSrc, dirPublicSrc).sort();
    const payloadPublicSrc = `public-src:${archivosPublicSrc.map(f => `${f}:${hashArchivo(path.join(dirPublicSrc, f))}`).join(',')}`;

    // Páginas HTML sueltas + app.js (mismo alcance que declara el subgate de
    // 009_INGENIERO_FRONTEND) — solo nivel superior de public/, no assets/
    // ni artefactos auto-generados (estado_antigravity.json, etc.).
    const dirPublic = path.join(dirRoot, 'public');
    const archivosPublicSueltos = fs.existsSync(dirPublic)
        ? fs.readdirSync(dirPublic, { withFileTypes: true })
            .filter(e => e.isFile() && (e.name.endsWith('.html') || e.name === 'app.js'))
            .map(e => e.name)
            .sort()
        : [];
    const payloadPublicSueltos = `public-sueltos:${archivosPublicSueltos.map(f => `${f}:${hashArchivo(path.join(dirPublic, f))}`).join(',')}`;

    const dirClaudeAgents = path.join(dirRoot, '.claude', 'agents');
    const archivosClaudeAgents = listarArchivosRecursivo(dirClaudeAgents, dirClaudeAgents).sort();
    const payloadClaudeAgents = `claude-agents:${archivosClaudeAgents.map(f => `${f}:${hashArchivo(path.join(dirClaudeAgents, f))}`).join(',')}`;

    // CORREGIDO 2026-08-13 — mismo bug de raíz, ahora en el motor del gate
    // mismo: `listarCarpetasAgentes()` solo devuelve subcarpetas numeradas de
    // `agents/`, así que `agents/architecture-gate.cjs` (el código que decide
    // qué aprueba y qué bloquea) y `scripts/check_veto_008.cjs` (el veto
    // determinista que bloquea en CI) NUNCA estaban dentro del alcance de su
    // propia firma. Se podía debilitar la lógica de enforcement — por
    // ejemplo, hacer que `validarFormaVeredicto()` siempre devuelva
    // `{ok:true}` — sin invalidar `diseno_aprobado.json` en absoluto.
    // Encontrado en vivo (2026-08-13): al editar este mismo archivo para
    // agregar VEREDICTO_SCHEMAS, `--aprobar-diseno` reportó la firma
    // IDÉNTICA a la de antes del cambio, pese a haber código nuevo real.
    // Harness que no protege su propio motor no es un harness completo.
    // gate-proveedor.cjs agregado 2026-09-26 (ADR-0002): decide qué falla del
    // proveedor es soft-fail y cuál bloquea — es motor del gate, entra en su
    // propia firma.
    const payloadGateEngine = `gate-engine:architecture-gate.cjs:${hashArchivo(__filename)}` +
        `,gate-proveedor.cjs:${hashArchivo(path.join(dirAgents, 'gate-proveedor.cjs'))}` +
        `,check_veto_008.cjs:${hashArchivo(path.join(dirRoot, 'scripts', 'check_veto_008.cjs'))}`;

    return crypto.createHash('sha256').update(
        payloadAgents + '||' + payloadSrc + '||' + payloadPublicSrc + '||' + payloadPublicSueltos + '||' + payloadClaudeAgents + '||' + payloadGateEngine
    ).digest('hex');
}

// Brecha de procedencia cerrada (2026-08-16, hallazgo §0-AJ.2 de
// docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md): validarDisenoAprobado() y
// validarSubgate() nunca verificaban NADA sobre el origen del veredicto —
// solo forma y hash. La aprobación vigente de esa misma fecha fue escrita a
// mano (canal Agent tool, ANTHROPIC_API_KEY sin saldo) usando el mismo
// hashEstado()/hashArchivosStaged() públicos en este archivo, e
// indistinguible para el gate de un veredicto real de la API. No existe una
// forma criptográficamente infalsificable de cerrar esto del todo en un
// entorno local donde el propio algoritmo de verificación es público y quien
// escribe el JSON tiene acceso de escritura al filesystem (mismo límite que
// ya reconoce hashEstado() sobre sí mismo) — lo que SÍ se cierra es la
// brecha real: el gate ya no acepta silenciosamente un origen no declarado,
// y una excepción manual caduca sola y queda marcada de forma visible en
// consola/PMU — nunca se ve igual que una aprobación evaluada por la API.
//
// SOFT-FAIL DE API (2026-09-25, orden del usuario, diseño ajustado tras
// veredicto de 002 vía canal Agent tool): la falta de saldo/disponibilidad
// de la API de Anthropic ya no bloquea el flujo de ingeniería. Si la API
// responde 402/429/529/5xx, "credit balance is too low" o no responde, y el
// soft-fail está habilitado explícitamente con un responsable declarado, se
// escribe una aprobación con origen 'soft_fail_api' atada a la misma firma
// hash del estado actual (cualquier cambio posterior la invalida). Siguen
// siendo bloqueo duro: rechazo real del modelo, respuesta no parseable,
// ANTHROPIC_API_KEY ausente (error de configuración, no de saldo),
// ANTHROPIC_BASE_URL no oficial y los chequeos estáticos de 006.
const ORIGENES_VALIDOS = ['api_directa', 'excepcion_manual', 'soft_fail_api'];
const HORAS_MAX_EXCEPCION_MANUAL = 6;
const ANTHROPIC_BASE_URL_OFICIAL = 'https://api.anthropic.com';

// Devuelve {codigo, detalle, request_id} si el error es de disponibilidad
// de la API (no de contenido); null en cualquier otro caso.
function clasificarFalloApi(e) {
    // ErrorProveedor (capa NIM/Anthropic, 2026-09-26): la categoría ya viene
    // resuelta — solo cuota/caida son disponibilidad. auth (401/403),
    // politica (modelo retirado), solicitud y config → null = bloqueo duro.
    if (e instanceof proveedorIA.ErrorProveedor) {
        return proveedorIA.esElegibleSoftFail(e)
            ? { codigo: e.codigo, detalle: e.detalle, request_id: e.request_id || null }
            : null;
    }
    const status = typeof e?.status === 'number' ? e.status : null;
    const detalle = String(e?.message || e || '').slice(0, 300);
    const request_id = e?.requestID || e?.request_id || null;
    let codigo = null;
    if (status === 402) codigo = 'http_402_sin_saldo';
    else if (status === 400 && /credit balance is too low/i.test(detalle)) codigo = 'http_400_sin_saldo';
    else if (status === 429) codigo = 'http_429_rate_limit';
    else if (status === 529) codigo = 'http_529_sobrecargada';
    else if (status !== null && status >= 500) codigo = `http_${status}`;
    else if (e instanceof Anthropic.APIConnectionError) codigo = 'sin_respuesta';
    return codigo ? { codigo, detalle, request_id } : null;
}

// Opt-in explícito con responsable declarado (flag o .env) — nunca se
// activa solo. ANTHROPIC_BASE_URL no oficial lo deshabilita: evita provocar
// el soft-fail a voluntad apuntando a un host muerto o que devuelve 402/529.
function resolverPermisoSoftFail(argv = process.argv, env = process.env) {
    const base = env.ANTHROPIC_BASE_URL;
    if (base && base.trim().replace(/\/+$/, '') !== ANTHROPIC_BASE_URL_OFICIAL) {
        return { permitido: false, razon: `ANTHROPIC_BASE_URL apunta a "${base}", no al endpoint oficial — soft-fail deshabilitado.` };
    }
    // Mismo criterio para NIM (2026-09-26): no se puede provocar el soft-fail
    // a voluntad apuntando el gate a un host muerto.
    const baseNim = env.GATE_NIM_BASE_URL;
    if (baseNim && baseNim.trim().replace(/\/+$/, '') !== proveedorIA.NIM_BASE_URL_OFICIAL) {
        return { permitido: false, razon: `GATE_NIM_BASE_URL apunta a "${baseNim}", no a ${proveedorIA.NIM_BASE_URL_OFICIAL} — soft-fail deshabilitado.` };
    }
    const leerFlag = (nombre) => { const i = argv.indexOf(nombre); return i !== -1 ? argv[i + 1] : undefined; };
    const viaFlag = argv.includes('--permitir-soft-fail');
    if (!viaFlag && env.GATE_SOFT_FAIL !== 'true') {
        return { permitido: false, razon: 'Soft-fail no habilitado — usa --permitir-soft-fail --autorizado-por "nombre", o GATE_SOFT_FAIL=true + GATE_SOFT_FAIL_AUTORIZADO_POR en .env.' };
    }
    const autorizadoPor = (leerFlag('--autorizado-por') || env.GATE_SOFT_FAIL_AUTORIZADO_POR || '').trim();
    if (!autorizadoPor) {
        return { permitido: false, razon: 'Soft-fail requiere responsable: --autorizado-por "nombre" o GATE_SOFT_FAIL_AUTORIZADO_POR en .env.' };
    }
    return { permitido: true, autorizadoPor, via: viaFlag ? 'flag' : 'env' };
}

function validarOrigenVeredicto(firma) {
    if (!firma.origen || !ORIGENES_VALIDOS.includes(firma.origen)) {
        return { ok: false, razon: `Veredicto sin campo "origen" válido (uno de: ${ORIGENES_VALIDOS.join(', ')}) — rechazado por defecto (cierre de brecha de procedencia, §0-AJ.2).` };
    }
    if (firma.origen === 'api_directa') {
        return { ok: true };
    }
    if (firma.origen === 'soft_fail_api') {
        const sf = firma.soft_fail;
        if (!sf || typeof sf.codigo !== 'string' || !sf.codigo.trim()
            || typeof sf.autorizado_por !== 'string' || !sf.autorizado_por.trim()) {
            return { ok: false, razon: 'origen:"soft_fail_api" requiere soft_fail:{codigo, autorizado_por} completos.' };
        }
        if (Array.isArray(firma.diferimientos) && firma.diferimientos.length > 0) {
            return { ok: false, razon: 'origen:"soft_fail_api" no puede traer diferimientos — no hubo salida del modelo.' };
        }
        return { ok: true, softFail: sf };
    }
    // origen === 'excepcion_manual' — requiere metadata completa y una
    // ventana de vigencia corta, no una excepción que se pueda reutilizar
    // indefinidamente.
    const exc = firma.excepcion;
    if (!exc || typeof exc.autorizado_por !== 'string' || !exc.autorizado_por.trim()
        || typeof exc.motivo !== 'string' || !exc.motivo.trim()
        || typeof exc.expira !== 'string') {
        return { ok: false, razon: 'origen:"excepcion_manual" requiere excepcion:{autorizado_por, motivo, expira} completos — no hay excepción manual válida sin los 3 campos.' };
    }
    const expiraMs = Date.parse(exc.expira);
    if (Number.isNaN(expiraMs)) {
        return { ok: false, razon: `excepcion.expira no es una fecha ISO válida: "${exc.expira}".` };
    }
    if (Date.now() > expiraMs) {
        return { ok: false, razon: `Excepción manual caducada (expiró ${exc.expira}) — requiere una nueva, no se opera indefinidamente bajo una excepción vencida.` };
    }
    const timestampFirma = Date.parse(firma.timestamp);
    if (!Number.isNaN(timestampFirma) && (expiraMs - timestampFirma) > HORAS_MAX_EXCEPCION_MANUAL * 3600 * 1000) {
        return { ok: false, razon: `excepcion.expira excede el máximo permitido de ${HORAS_MAX_EXCEPCION_MANUAL}h desde la firma — una excepción manual no puede auto-extenderse indefinidamente.` };
    }
    return { ok: true, excepcionManual: exc };
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
    const origenCheck = validarOrigenVeredicto(firma);
    if (!origenCheck.ok) {
        return { aprobado: false, razon: origenCheck.razon };
    }
    const hashActual = hashEstado(carpetas);
    if (firma.firma !== hashActual) {
        return { aprobado: false, razon: 'El estado de agents/ cambió después de la firma — se requiere re-aprobación del Agente Arquitecto (002_ARQUITECTO_DE_SOFTWARE).' };
    }
    return {
        aprobado: true, firma: firma.firma, timestamp: firma.timestamp,
        diferimientos: origenCheck.softFail ? [] : (firma.diferimientos || []), origen: firma.origen,
        excepcionManual: origenCheck.excepcionManual || null,
        softFail: origenCheck.softFail || null,
    };
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
    // CORREGIDO 2026-08-13 — bug crítico encontrado en vivo, verificado con
    // certeza (0 coincidencias probadas contra archivos reales): el patrón
    // original (/^src\/.*\.(jsx|tsx)$/) apuntaba a `src/` en la raíz, que es
    // 100% backend (0 archivos .jsx/.tsx ahí, confirmado por find). El
    // frontend React real vive en `public/src/` (13 archivos .jsx/.tsx
    // reales, App.jsx/RadarApp.jsx/Modulo10Page.jsx/etc.). Estos 2 subgates
    // llevaban desde su creación sin poder aplicarse NUNCA a ningún cambio
    // real de frontend — silenciosamente inertes, sin error visible.
    '004_SENTINELA_FRONTEND': {
        promptPath: path.join(dirRoot, '.claude', 'agents', '004-sentinela-frontend.md'),
        patrones: [/^public\/src\/.*\.(jsx|tsx)$/],
        campoAprobado: 'limpio',
        veredictoPath: path.join(dirAgents, 'veredicto_004.json'),
    },
    '003_ESP_DISENO_STITCH': {
        promptPath: path.join(dirRoot, '.claude', 'agents', '003-esp-diseno-stitch.md'),
        patrones: [/^public\/src\/.*\.(jsx|tsx)$/],
        campoAprobado: 'diseno_valido',
        veredictoPath: path.join(dirAgents, 'veredicto_003.json'),
    },
    // Agregado 2026-08-13: antes 006 solo se invocaba manualmente ("bajo demanda"),
    // sin ningún gate automático — un commit podía tocar render.yaml, .env.example
    // o dependencias sin que nadie con juicio (no solo los chequeos deterministas
    // de secretos/env/npm audit) lo revisara. Mismo patrón que 003/004.
    // Patrones fusionados 2026-08-16 (cierre de §0-AJ.3, "gate fantasma de
    // 006"): esta entrada hardcodeada ya existía desde 2026-08-13
    // (render.yaml/.env.example/package*.json) y bloqueaba, por diseño de
    // asegurarSubgatesAutoDescubiertos() (nunca pisa una entrada manual), el
    // auto-registro del gate que 006 declara en su propio frontmatter
    // (.claude/agents/006-devsecops-infraestructura.md:5 —
    // .github/workflows/**, scripts/*gate*.cjs/*veto*.cjs). Resultado real
    // hasta hoy: un commit que tocara el propio motor del gate o los
    // workflows de CI no pasaba por ningún subgate. Se fusionan los patrones
    // aquí — esta entrada sigue siendo la única fuente de verdad para
    // '006_DEVSECOPS_INFRAESTRUCTURA', ahora con cobertura real de las 2
    // áreas (infraestructura de despliegue + infraestructura del propio gate).
    '006_DEVSECOPS_INFRAESTRUCTURA': {
        promptPath: path.join(dirRoot, '.claude', 'agents', '006-devsecops-infraestructura.md'),
        patrones: [
            /^render\.yaml$/, /^\.env\.example$/, /^package\.json$/, /^package-lock\.json$/,
            /^\.github\/workflows\/.*\.ya?ml$/, /^scripts\/.*(gate|veto).*\.cjs$/,
        ],
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
        // server.js y src/orchestrator-engine.js agregados 2026-08-14 —
        // brecha de cobertura real encontrada por el usuario: el propio 005
        // se declara "Bases de datos, APIs y lógica de servidor" pero el
        // patrón no cubría ningún archivo de servidor en la raíz. Consecuencia
        // real: varios fixes críticos de seguridad de hoy (bug de Redis en
        // cache.js — sí cubierto pero hecho directamente igual; race
        // condition de _serverAuthToken en orchestrator-engine.js, trust
        // proxy y /api/mcp en server.js — NO cubiertos) los hizo el
        // orquestador directamente en vez de pasar por 005. Ver
        // docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md para el hallazgo completo.
        patrones: [/^src\/modules\/formulador\//, /^src\/shared\/infrastructure\//, /^server\.js$/, /^src\/orchestrator-engine\.js$/],
        campoAprobado: 'estado_backend',
        valorAprobado: 'aislado_y_seguro',
        veredictoPath: path.join(dirAgents, 'veredicto_005.json'),
    },
};

// Auto-registro de subgates declarados en el frontmatter de un agente
// (2026-08-13, "Lego real" — orden explícita: un agente nuevo debe
// integrarse sin tocar código central). Mutación idempotente y lazy de
// SUBGATES — se llama explícitamente desde los 3 puntos de entrada CLI
// reales (--check-gate, --aprobar-subgate, --pmu-status), NUNCA a nivel de
// módulo (violaría el mismo principio de "sin efectos secundarios al
// requerir" recién aplicado en Fase 3 a los scripts sueltos de agents/).
// Nunca pisa un subgate ya definido a mano arriba — esos siguen siendo la
// fuente de verdad si hay conflicto de nombre.
let _subgatesAutoRegistrados = false;
function asegurarSubgatesAutoDescubiertos() {
    if (_subgatesAutoRegistrados) return;
    _subgatesAutoRegistrados = true;
    for (const agente of descubrirAgentes()) {
        if (!agente.gate || !agente.prefijo) continue;
        const idBase = agente.archivo.replace('.claude/agents/', '').replace(/\.md$/, '');
        const agentId = idBase.toUpperCase().replace(/-/g, '_');
        if (SUBGATES[agentId]) continue;
        const cfg = agente.gate;
        if (!cfg.campo || !Array.isArray(cfg.patrones)) continue;
        let patrones;
        try {
            patrones = cfg.patrones.map(p => new RegExp(p));
        } catch (e) {
            console.warn(`[SUBGATES auto] ${agente.archivo}: patrón de regex inválido en su gate declarado, se omite (${e.message}).`);
            continue;
        }
        SUBGATES[agentId] = {
            promptPath: path.join(dirRoot, agente.archivo),
            patrones,
            campoAprobado: cfg.campo,
            ...(cfg.valor ? { valorAprobado: cfg.valor } : {}),
            veredictoPath: path.join(dirAgents, `veredicto_${agente.prefijo}.json`),
        };
        console.log(`[SUBGATES auto] Registrado desde frontmatter: ${agentId} (${agente.archivo})`);
    }
}

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
    // Diferimiento estructural de 002 — agregado 2026-08-16 (hallazgo real:
    // no existía NINGUNA conexión de código entre "002 aprobó el diseño
    // completo, incluyendo este hallazgo de un subgate" y "el subgate
    // bloquea el commit igual"). Se re-verifica en fresco que la aprobación
    // de 002 sigue VIGENTE para el estado actual del repo (mismo criterio
    // que --check-gate ya aplica al gate principal) — un diferimiento de
    // una aprobación caducada no cuenta; si el diff cambia, el diferimiento
    // caduca junto con la aprobación que lo contenía, no por separado.
    const disenoVigente = validarDisenoAprobado(listarCarpetasAgentes());
    if (disenoVigente.aprobado && Array.isArray(disenoVigente.diferimientos)) {
        const diferido = disenoVigente.diferimientos.find(d => d.subgate === agentId);
        if (diferido) {
            return { aplica: true, aprobado: true, diferido: true, razon: diferido.razon };
        }
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
    // Mismo cierre de brecha de procedencia que el gate principal (§0-AJ.2) —
    // un subgate no verificaba origen tampoco.
    const origenCheck = validarOrigenVeredicto(veredicto);
    if (!origenCheck.ok) {
        return { aplica: true, aprobado: false, razon: origenCheck.razon };
    }
    const hashActual = hashArchivosStaged(relevantes);
    if (veredicto.firma !== hashActual) {
        return { aplica: true, aprobado: false, razon: `Los archivos relevantes para ${agentId} cambiaron desde el último veredicto — se requiere re-aprobación (node agents/architecture-gate.cjs --aprobar-subgate ${agentId}).` };
    }
    return { aplica: true, aprobado: true, origen: veredicto.origen, excepcionManual: origenCheck.excepcionManual || null, softFail: origenCheck.softFail || null };
}

async function pedirVeredictoSubagente(agentId, relevantes) {
    const cfg = SUBGATES[agentId];
    if (!fs.existsSync(cfg.promptPath)) {
        return { aprobado: false, razon: `No existe ${cfg.promptPath}.` };
    }
    const systemPrompt = fs.readFileSync(cfg.promptPath, 'utf8');
    let diff;
    try {
        diff = execFileSync('git', ['diff', ...FLAGS_DIFF_PROVEEDOR, '--cached', '--', ...relevantes], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        return { aprobado: false, razon: `No se pudo leer 'git diff --cached': ${e.message}` };
    }
    // Manifiesto del resto del staging (2026-09-26, rechazo real de 006): el
    // subgate solo ve el diff de SU mandato y concluía que gate-proveedor.cjs
    // o tests/gate/ "no aparecen en el diff staged" — sí estaban, fuera de su
    // mandato. Solo nombres y estado, nunca contenido.
    let manifiesto = '';
    try {
        const setRelevantes = new Set(relevantes);
        const fuera = execFileSync('git', ['diff', '--cached', '--name-status', '--no-renames'], { cwd: dirRoot, encoding: 'utf8' })
            .split('\n').map(l => l.trim()).filter(Boolean)
            .filter(l => !setRelevantes.has(l.split('\t').slice(1).join('\t')));
        if (fuera.length) {
            manifiesto = `\n\nMANIFIESTO — otros ${fuera.length} archivo(s) TAMBIÉN staged en este mismo commit, fuera de tu mandato ` +
                `(los fiscaliza 002 y sus subgates; no los reportes como ausentes, sí puedes señalar riesgos de integración con ellos):\n` +
                fuera.map(l => `  ${l.replace('\t', ' ')}`).join('\n');
        }
    } catch {
        manifiesto = '\n\nMANIFIESTO — no se pudo listar el resto del staging; no infieras ausencias de archivos que no ves.';
    }
    const r = await consultarModelo(agentId, {
            // 8192, no 4096 (hallazgo real 2026-08-13): la instrucción de "sé
            // conciso" en el prompt no bastó para 006 — su mandato tiene 5
            // categorías que insiste en cubrir con detalle antes del JSON,
            // agotando 4096 igual. Más presupuesto es más confiable que
            // depender de que el modelo se autolimite.
            max_tokens: 8192,
            system: systemPrompt,
            user: `Audita el siguiente diff staged (git diff --cached), limitado a los archivos que te competen según tu mandato. ` +
                    `Esta es una llamada directa a un modelo vía API (sin sesión de Claude Code), sin Read/Grep/Glob reales — basa tu veredicto solo en este ` +
                    `texto. ` +
                    // JSON PRIMERO (2026-09-26): mismo criterio que 002 —
                    // deepseek-v4.1-flash agotó 8192 tokens razonando con el
                    // JSON al final (hallazgos 2026-08-13 y 2026-09-26).
                    `FORMATO OBLIGATORIO PARA ESTA INVOCACIÓN (prevalece sobre "termina con tu JSON" de tu system prompt): ` +
                    `emite COMO PRIMERA SALIDA tu JSON de veredicto completo, con la forma exacta que exige tu system prompt; ` +
                    `después, como máximo 300 palabras de análisis. Solo el JSON es parseable; si el análisis se corta por ` +
                    `longitud, la decisión ya quedó registrada.\n\n${diff.slice(0, 60000)}${manifiesto}`,
    });
    if (!r.ok) {
        const falloApi = clasificarFalloApi(r.error);
        if (falloApi) {
            return { aprobado: false, apiNoDisponible: true, falloApi, razon: `Proveedor de IA no disponible (${falloApi.codigo}): ${falloApi.detalle}` };
        }
        return { aprobado: false, razon: razonFalloProveedor(r.error) };
    }
    const text = r.texto;
    // Generalizado 2026-08-13 (subgate de 005): no todo campoAprobado es
    // booleano — 005 emite `estado_backend` con 3 valores string posibles
    // ("aislado_y_seguro"|"brechas_detectadas"|"bloqueado_por_diseno"), no
    // true/false. Con `valorAprobado` configurado, se matchea contra ese
    // string exacto en vez de contra (true|false).
    const veredicto = extraerJSONConCampo(text, cfg.campoAprobado);
    if (!veredicto) {
        const razon = r.fin === 'length'
            ? `${agentId} agotó max_tokens (finish_reason=length) antes de emitir el veredicto JSON — respuesta truncada, no aprobada.`
            : `${agentId} no devolvió un veredicto JSON parseable.`;
        return { aprobado: false, razon, respuestaCruda: text.slice(0, 800) };
    }
    const forma = validarFormaVeredicto(agentId, veredicto);
    if (!forma.ok) {
        return { aprobado: false, razon: forma.razon, respuestaCruda: text.slice(0, 800) };
    }
    const aprobado = cfg.valorAprobado
        ? veredicto[cfg.campoAprobado] === cfg.valorAprobado
        : veredicto[cfg.campoAprobado] === true;
    // BUG REAL corregido 2026-08-15: este es el caso "parseó bien, forma
    // válida, pero el agente legítimamente dijo que NO aprueba" (ej.
    // {"limpio":false,"hallazgos":[...]})  — antes no traía ningún `razon`,
    // así que aprobarUnSubgate() (abajo) lo registraba en telemetría como
    // "razon: null" y los hallazgos reales quedaban invisibles, nunca
    // mostrados en consola. Mismo patrón de "hallazgo real silenciado" que
    // esta sesión ya cazó varias veces en código de aplicación — esta vez
    // estaba en el propio gate.
    const razon = aprobado ? undefined : `${agentId} evaluó y NO aprobó — ver hallazgos: ${JSON.stringify(veredicto)}`;
    return { aprobado, veredictoCompleto: veredicto, razon, proveedor: r.proveedor, modelo: r.modelo };
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

// ACUSE EXPLÍCITO (2026-09-26, ADR-0002 §2.6) — reemplaza la comparación de
// fechas de commit de abajo, que medía "quién commiteó último", no "quién
// revisó": un commit al documento marcaba a los 10 agentes a la vez, y un
// commit cosmético al .md del agente apagaba la alerta sin revisión real.
// Ahora cada agente declara en su frontmatter `doc_revisado: <sha>` (commit
// del documento maestro revisado). Alerta solo si: falta el acuse, el sha no
// es un commit que tocó el documento, o hubo commits posteriores cuyas líneas
// AGREGADAS mencionan a ese agente por su ID.
const DOC_MAESTRO_REL = 'docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md';

function gitSeguro(args) {
    try {
        return execFileSync('git', args, { cwd: dirRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

// true si `texto` menciona al agente por prefijo numérico aislado (`005`,
// "005_", "005-"), por nombre kebab o por ID en mayúsculas.
function mencionaAgente(texto, archivo) {
    const base = archivo.replace(/\.md$/, '');
    const upper = base.toUpperCase().replace(/-/g, '_');
    const prefijo = (base.match(/^(\d{3})/) || [])[1];
    if (texto.includes(base) || texto.includes(upper)) return true;
    // `_`/`-` excluidos tras el prefijo (hallazgo de 007, 2026-09-26): los
    // IDs reales con separador ya matchean arriba por base/upper; sin esto,
    // nombres de migración como `005_fix_insertar_fase1.sql` o
    // `007_worm_occ_shadow_ledger.sql` marcaban al agente por error.
    // Alfanumérico excluido a ambos lados (hallazgo 008): hashes hex como
    // `a004e3f` o `b005c1d` también marcaban al agente.
    return prefijo ? new RegExp(`(^|[^0-9A-Za-z.])${prefijo}(?![0-9A-Za-z._-])`, 'm').test(texto) : false;
}

// Degradación con gracia (PMU Titán V2, 2026-09-26): antes, si git no estaba
// disponible (binario ausente, entorno restringido, checkout superficial sin
// historial del documento), gitSeguro() devolvía null → '' → 0 commits → []:
// un VERDE FALSO y silencioso. Ahora se distingue "git falló" (null) de "no
// hay historial" y se emite una alerta explícita en vez de callar. `git` es
// inyectable para poder probar ese camino sin romper el binario real.
function alertaGitInaccesible(detalle) {
    return {
        tipo: 'alerta_git_inaccesible', estado: 'alerta_git_inaccesible', agente: null,
        razon: `No se pudo consultar git (${detalle}) — la vigencia de los agentes NO se verificó. No es un verde.`,
    };
}

function verificarVigenciaAgentes(git = gitSeguro) {
    const ejecutar = (args) => {
        try { return git(args); } catch { return null; } // un runner inyectado que lance tampoco rompe el PMU
    };
    const logDoc = ejecutar(['log', '--format=%H', '--', DOC_MAESTRO_REL]);
    if (logDoc === null) return [alertaGitInaccesible(`git log -- ${DOC_MAESTRO_REL}`)];
    const commitsDoc = logDoc.split('\n').filter(Boolean);
    if (commitsDoc.length === 0) {
        return [alertaGitInaccesible(`sin historial de ${DOC_MAESTRO_REL} — ¿checkout superficial (fetch-depth)?`)];
    }
    const setCommitsDoc = new Set(commitsDoc);

    const dirClaudeAgents = path.join(dirRoot, '.claude', 'agents');
    if (!fs.existsSync(dirClaudeAgents)) return [];

    let gitFallo = null;
    const cacheAgregadas = new Map();
    const agregadasDesde = (sha) => {
        if (!cacheAgregadas.has(sha)) {
            const revList = ejecutar(['rev-list', `${sha}..HEAD`, '--', DOC_MAESTRO_REL]);
            if (revList === null) { gitFallo = gitFallo || `git rev-list ${sha.slice(0, 7)}..HEAD`; cacheAgregadas.set(sha, null); return null; }
            const posteriores = revList.split('\n').filter(Boolean);
            const diff = posteriores.length ? ejecutar(['diff', '-U0', `${sha}..HEAD`, '--', DOC_MAESTRO_REL]) : '';
            if (diff === null) { gitFallo = gitFallo || `git diff ${sha.slice(0, 7)}..HEAD`; cacheAgregadas.set(sha, null); return null; }
            const agregadas = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
            cacheAgregadas.set(sha, { posteriores, agregadas });
        }
        return cacheAgregadas.get(sha);
    };

    const alertas = [];
    for (const archivo of fs.readdirSync(dirClaudeAgents).filter(f => f.endsWith('.md')).sort()) {
        const { doc_revisado } = leerFrontmatterAgente(path.join(dirClaudeAgents, archivo));
        if (!doc_revisado) {
            alertas.push({ tipo: 'agente_sin_acuse', agente: archivo, razon: `Sin campo "doc_revisado" en el frontmatter — no hay constancia de qué versión de ${DOC_MAESTRO_REL} revisó.` });
            continue;
        }
        // rev-parse --quiet sale con código ≠ 0 ante un sha desconocido: aquí
        // null significa "acuse inválido", no "git caído" (git ya respondió
        // al log de arriba).
        const sha = ejecutar(['rev-parse', '--verify', '--quiet', `${doc_revisado}^{commit}`]);
        if (!sha || !setCommitsDoc.has(sha)) {
            alertas.push({ tipo: 'agente_acuse_invalido', agente: archivo, razon: `doc_revisado "${doc_revisado}" no es un commit que haya tocado ${DOC_MAESTRO_REL}.` });
            continue;
        }
        const datos = agregadasDesde(sha);
        if (datos === null) continue; // se reporta una sola alerta_git_inaccesible al final
        const { posteriores, agregadas } = datos;
        if (posteriores.length && mencionaAgente(agregadas, archivo)) {
            alertas.push({
                tipo: 'agente_desactualizado', agente: archivo,
                razon: `${DOC_MAESTRO_REL} tiene ${posteriores.length} commit(s) posteriores a ${sha.slice(0, 7)} que mencionan a este agente — revisar y actualizar doc_revisado.`,
                commits_posteriores: posteriores.map(c => c.slice(0, 7)),
            });
        }
    }
    if (gitFallo) alertas.push(alertaGitInaccesible(gitFallo));
    return alertas;
}

// Historia: la versión 2026-08-13 ("escalable como Lego") ya aplicaba a TODOS
// los agentes descubiertos sin opt-in por texto — se conserva ese criterio de
// universalidad; lo retirado 2026-09-26 es solo la comparación por fechas.

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
    // gate: opcional, una línea de JSON compacto (2026-08-13, "Lego real" —
    // un agente nuevo declara su propio subgate en su frontmatter en vez de
    // requerir una edición a mano de SUBGATES en este archivo). Formato:
    // gate: {"campo":"aprobado","patrones":["^src/.*\\.py$"],"veredicto":"010"}
    // "patrones" son strings de regex (se compilan con new RegExp), "campo"
    // es el campoAprobado, "valor" es opcional (equivalente a valorAprobado
    // para campos string no-booleanos). Sin JSON válido → sin gate propio,
    // no rompe el descubrimiento del agente en sí.
    const gateLine = (bloque.match(/^gate:\s*(.+)$/m) || [])[1]?.trim();
    let gate = null;
    if (gateLine) {
        try { gate = JSON.parse(gateLine); } catch { gate = null; }
    }
    // 2026-09-26 (ADR-0002): acuse de vigencia y datos para el mapa de mando
    // del 001 — description (propósito) y skills.
    // Comentario YAML opcional al final (p. ej. "# acuse administrativo")
    // para dejar constancia del tipo de acuse sin romper el parseo.
    const doc_revisado = (bloque.match(/^doc_revisado:\s*([0-9a-f]{7,40})\s*(?:#.*)?$/m) || [])[1] || null;
    const descripcion = (bloque.match(/^description:\s*(.+)$/m) || [])[1]?.trim() || null;
    const skillsLine = (bloque.match(/^skills:\s*(.+)$/m) || [])[1]?.trim();
    const skills = skillsLine ? skillsLine.split(',').map(s => s.trim()).filter(Boolean) : [];
    return { nombre, tools, gate, doc_revisado, descripcion, skills };
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

// Mapa de mando del 001 (2026-09-26, ADR-0002 §2.7): por agente, propósito,
// skills, gate y permisos, y si la matriz de ruteo del 001 lo enruta
// ("→ `00X_…`" en .claude/agents/001-orquestador-maestro.md). El 001 es el
// mando: se marca mapeado por definición. No le otorga herramientas.
function generarMapaDelegacion001(agentes, gatesPorPrefijo) {
    const ruta001 = path.join(dirRoot, '.claude', 'agents', '001-orquestador-maestro.md');
    const texto001 = fs.existsSync(ruta001) ? fs.readFileSync(ruta001, 'utf8') : '';
    const enrutados = new Set([...texto001.matchAll(/→\s*`(\d{3})_[A-Z0-9_]+`/g)].map(m => m[1]));
    return agentes.map(a => {
        const gate = a.prefijo ? gatesPorPrefijo[a.prefijo] : null;
        return {
            archivo: a.archivo,
            prefijo: a.prefijo,
            proposito: a.descripcion ? a.descripcion.slice(0, 160) : null,
            skills: a.skills || [],
            gate: gate ? gate.tipo : 'sin_gate_propio',
            permisos: a.tools,
            mapeado_por_001: a.prefijo === '001' || enrutados.has(a.prefijo),
        };
    });
}

function generarEstadoOperativo() {
    // Corregido 2026-08-13 (auditoría A-Z, hallazgo real): antes dependía de
    // que el CALLER hubiera invocado asegurarSubgatesAutoDescubiertos() antes
    // — un contrato implícito no forzado. Reproducido en vivo: llamar a esta
    // función directamente (sin pasar por --check-gate/--pmu-status primero)
    // reportaba a 009_INGENIERO_FRONTEND como "sin_gate_propio" pese a tener
    // uno real. Ahora se autoasegura — idempotente, sin efectos secundarios
    // de I/O más allá de un console.log, seguro de llamar redundantemente.
    asegurarSubgatesAutoDescubiertos();
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

    // alertas_activas (2026-08-16, "circuit breaker" — diseño aprobado por
    // 002 con alcance reducido frente a la propuesta original del usuario:
    // no existe proceso persistente que "aislar/cortar" en este sistema, así
    // que esto no aísla nada en ejecución — lo que sí hace es dejar de perder
    // las 2 vigilancias que ya existían (analizarTelemetriaPMU,
    // verificarVigenciaAgentes) en un console.warn de una terminal que nadie
    // vuelve a ver. Quedan escritas en el propio snapshot que este archivo ya
    // regenera en cada --check-gate/--aprobar-*/--pmu-status, verificables en
    // disco la próxima vez que alguien (humano o 001 vía su propia
    // herramienta Read) lea el PMU, no solo en el instante en que ocurrieron.
    const mapaMando = generarMapaDelegacion001(agentes, gatesPorPrefijo);
    const alertasActivas = [
        ...analizarTelemetriaPMU().map(a => ({ tipo: 'rechazos_consecutivos', ...a })),
        ...verificarVigenciaAgentes().map(a => ({ tipo: 'agente_desactualizado', ...a })),
        ...mapaMando.filter(m => !m.mapeado_por_001).map(m => ({
            tipo: 'agente_sin_mando', agente: m.archivo,
            razon: 'No aparece en la matriz de ruteo de .claude/agents/001-orquestador-maestro.md — el 001 no puede delegarle.',
        })),
    ];

    // Proveedor de IA (ADR-0002 §2.4) — estado del breaker y alertas críticas,
    // derivadas de agents/pmu/circuit_breaker.json. Nunca incluye la key.
    let cfgProveedor;
    try {
        const c = proveedorIA.resolverConfig();
        cfgProveedor = { proveedor: c.proveedor, modelo: c.modelo, base_url: c.baseUrl, key_configurada: Boolean(c.key) };
        cfgProveedor.cadena_conmutacion = proveedorIA.resolverCadena(process.env, c, proveedorIA.CADENA_NIM_DEFAULT)
            .map(e => ({ modelo: proveedorIA.etiquetaModelo(e), key_configurada: Boolean(e.key) }));
        cfgProveedor.primer_byte_conmutacion_ms = proveedorIA.resolverPlazoFailover(process.env);
    } catch (e) {
        cfgProveedor = { proveedor: process.env.GATE_PROVIDER || 'nim', error_config: e.codigo || String(e.message) };
    }
    const breaker = proveedorIA.leerBreaker(BREAKER_PATH);
    const alertasProveedor = proveedorIA.alertasDeProveedor(breaker, cfgProveedor.proveedor, cfgProveedor.modelo);
    if (cfgProveedor.error_config || cfgProveedor.key_configurada === false) {
        alertasProveedor.push({
            tipo: 'ALERTA CRÍTICA DE PROVEEDOR EXTERNO', proveedor: cfgProveedor.proveedor, modelo: cfgProveedor.modelo || null,
            severidad: 'critica', efecto: 'bloqueo_duro',
            ultimo_error: { codigo: cfgProveedor.error_config || `${cfgProveedor.proveedor === 'nim' ? 'NVIDIA' : 'ANTHROPIC'}_API_KEY_ausente`, categoria: 'config' },
            accion: 'Configurar la key / base URL del proveedor en .env — el gate no puede evaluar nada hasta entonces.',
        });
    }

    return {
        generado: new Date().toISOString(),
        total_agentes: tablero.length,
        agentes_con_gate: tablero.filter(a => a.gate !== 'sin_gate_propio').length,
        agentes_con_permiso_escritura: tablero.filter(a => a.permiso_escritura).map(a => a.nombre || a.archivo),
        alertas_activas: alertasActivas,
        alertas_criticas_proveedor: alertasProveedor,
        proveedor_ia: { ...cfgProveedor, circuit_breaker: proveedorIA.breakerPublico(breaker) },
        // Modo local/offline (2026-09-25): la API es opcional para el flujo
        // de commit — ver bloque SOFT-FAIL DE API. Actualizado 2026-09-26
        // (ADR-0002) con la clasificación del proveedor NIM.
        politica_api: {
            modo: 'soft_fail',
            soft_fail_habilitado_env: process.env.GATE_SOFT_FAIL === 'true',
            disparadores: ['http_402', 'http_400_cuota', 'http_429', 'http_5xx', 'timeout_sin_respuesta', 'timeout_inactividad', 'timeout_total', 'stream_incompleto', 'sin_respuesta', 'circuito_abierto(cuota|caida)'],
            bloqueo_duro: ['rechazo_real_del_modelo', 'respuesta_no_parseable', 'http_401/403 (ALERTA CRÍTICA)', 'modelo_no_disponible (ALERTA CRÍTICA)', 'API_KEY_ausente', 'BASE_URL_no_oficial', 'chequeos_estaticos_006'],
        },
        mapa_delegacion_001: mapaMando,
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

function ejecutarNpmAudit(npmBin, cwd) {
    let salida;
    try {
        // shell:true es necesario en Windows porque npm.cmd es un batch script,
        // no un ejecutable nativo — execFileSync sin shell no puede correrlo. Node
        // advierte (DEP0190) sobre esto en general porque args sin escapar +
        // shell es peligroso con INPUT DE USUARIO — aquí los args son literales
        // fijos ('audit', '--json'), nunca datos externos, así que no aplica el
        // riesgo que la advertencia señala.
        salida = execFileSync(`"${npmBin}"`, ['audit', '--json'], { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: true });
    } catch (e) {
        // npm audit sale con exit code != 0 cuando SÍ encuentra vulnerabilidades
        // (no es un error de ejecución) — su stdout sigue siendo el JSON útil.
        salida = e.stdout || '';
    }
    try {
        return JSON.parse(salida);
    } catch {
        return null;
    }
}

// Vulnerabilidades críticas/altas por nombre de paquete, del reporte de `npm audit --json`.
function paquetesVulnerables(reporte, severidades = ['critical', 'high']) {
    if (!reporte?.vulnerabilities) return new Set();
    return new Set(
        Object.entries(reporte.vulnerabilities)
            .filter(([, v]) => severidades.includes(v.severity))
            .map(([nombre]) => nombre)
    );
}

// Audita el package.json+package-lock.json de un ref de git específico, en un
// directorio temporal aislado — sin tocar el working tree, sin necesitar
// node_modules (`--package-lock-only`).
function auditarLockfileDeRef(npmBin, ref) {
    let dirTmp;
    try {
        dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-audit-base-'));
        const pkgJson = execFileSync('git', ['show', `${ref}:package.json`], { cwd: dirRoot, encoding: 'utf8' });
        const pkgLock = execFileSync('git', ['show', `${ref}:package-lock.json`], { cwd: dirRoot, encoding: 'utf8' });
        fs.writeFileSync(path.join(dirTmp, 'package.json'), pkgJson);
        fs.writeFileSync(path.join(dirTmp, 'package-lock.json'), pkgLock);
        let salida;
        try {
            salida = execFileSync(`"${npmBin}"`, ['audit', '--package-lock-only', '--json'], { cwd: dirTmp, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: true });
        } catch (e) {
            salida = e.stdout || '';
        }
        return JSON.parse(salida);
    } catch {
        return null; // sin base disponible (ref inexistente, primer commit, etc.) — el caller decide qué hacer
    } finally {
        if (dirTmp) { try { fs.rmSync(dirTmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
    }
}

// Corregido 2026-08-13 (hallazgo real: agregar @sentry/node — una dependencia
// nueva, sin ninguna vulnerabilidad propia — quedó bloqueada por 46
// vulnerabilidades PREEXISTENTES sin relación con el cambio, que el usuario ya
// había decidido explícitamente no resolver con --force por riesgo de
// romper algo). Bloquear en bloque cualquier diff que toque package-lock.json
// mientras existan vulnerabilidades viejas vuelve el gate inútil para
// cualquier cambio de dependencias futuro, sin importar cuán seguro sea.
// Ahora compara contra HEAD: solo bloquea si el cambio introduce
// vulnerabilidades críticas/altas NUEVAS (paquetes que no estaban en esa
// severidad antes) — las preexistentes se reportan como advertencia, no
// como bloqueo, preservando la decisión ya tomada por el usuario sobre ellas.
function verificarDependencias(archivosStaged) {
    const tocaLock = archivosStaged.includes('package-lock.json'); // no versionado hoy, pero si algún día lo está, cualquier cambio ahí sí es relevante por definición
    const tocaDependencias = tocaLock || diffTocaDependencias(archivosStaged);
    if (!tocaDependencias) return { ok: true, aplica: false };
    const npmBin = resolverNpmBin();
    if (!npmBin) {
        return { ok: true, aplica: true, razon: "No se encontró 'npm' en PATH ni en la ruta de fallback conocida — no se pudo verificar, no se bloquea por un fallo de la herramienta en sí." };
    }
    const reporteActual = ejecutarNpmAudit(npmBin, dirRoot);
    if (!reporteActual) {
        return { ok: true, aplica: true, razon: 'npm audit no devolvió JSON parseable — no se pudo verificar, no se bloquea por un fallo de la herramienta en sí.' };
    }
    const criticas = reporteActual?.metadata?.vulnerabilities?.critical || 0;
    const altas = reporteActual?.metadata?.vulnerabilities?.high || 0;
    if (criticas === 0 && altas === 0) return { ok: true, aplica: true };

    const vulnActuales = paquetesVulnerables(reporteActual);
    const reporteBase = auditarLockfileDeRef(npmBin, 'HEAD');
    if (!reporteBase) {
        // Sin base para comparar (ej. primer commit del repo) — no se puede
        // distinguir "nuevo" de "preexistente", así que se mantiene el
        // criterio conservador anterior: bloquear.
        return { ok: false, aplica: true, razon: `npm audit encontró ${criticas} vulnerabilidad(es) crítica(s) y ${altas} alta(s), y no se pudo comparar contra HEAD para descartar que sean nuevas — correr 'npm audit' para el detalle.` };
    }
    const vulnBase = paquetesVulnerables(reporteBase);
    const nuevas = [...vulnActuales].filter(p => !vulnBase.has(p));

    if (nuevas.length > 0) {
        return { ok: false, aplica: true, razon: `npm audit encontró ${nuevas.length} vulnerabilidad(es) crítica/alta NUEVA(S) introducida(s) por este cambio: ${nuevas.join(', ')} — correr 'npm audit' para el detalle.` };
    }
    return {
        ok: true, aplica: true,
        razon: `${criticas} crítica(s) + ${altas} alta(s) preexistentes sin cambiar (ninguna nueva introducida por este diff) — no bloquea, ver 'npm audit' para el detalle si aún no se han resuelto.`,
    };
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
    asegurarSubgatesAutoDescubiertos();
    const veredicto = validarDisenoAprobado(listarCarpetasAgentes());
    if (!veredicto.aprobado) {
        console.error('\n🛑 [GATE_ARQUITECTURA] Sin aprobación vigente: ' + veredicto.razon);
        console.error('   Ejecuta: node agents/architecture-gate.cjs --aprobar-diseno  (sin saldo de API: soft-fail si GATE_SOFT_FAIL=true o --permitir-soft-fail --autorizado-por "nombre")');
        registrarTelemetria({ tipo: 'check-gate', subsistema: '002_principal', resultado: 'rechazado', razon: veredicto.razon });
        escribirEstadoOperativo();
        process.exitCode = 1;
        return;
    }
    if (veredicto.origen === 'soft_fail_api') {
        console.warn(`🟡 [GATE_ARQUITECTURA] SOFT-FAIL vigente (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp}) — SIN evaluación de 002: API no disponible (${veredicto.softFail.codigo}), autorizado por ${veredicto.softFail.autorizado_por}.`);
    } else {
        console.log(`✅ [GATE_ARQUITECTURA] Aprobación vigente (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);
    }
    if (veredicto.origen === 'excepcion_manual') {
        console.warn(`   🟡 EXCEPCIÓN MANUAL, no veredicto de la API de 002 — ${JSON.stringify(veredicto.excepcionManual)}`);
    }
    registrarTelemetria({ tipo: 'check-gate', subsistema: '002_principal', resultado: 'aprobado', firma: veredicto.firma, origen: veredicto.origen });

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
        } else if (resultado.diferido) {
            // Distinto a propósito de "✅ Aprobación vigente": nadie debe
            // poder leer esta línea y concluir que el propio agente aprobó.
            console.log(`🟡 [SUBGATE_${agentId}] DIFERIDO por 002_ARQUITECTO_DE_SOFTWARE — ${resultado.razon}`);
            registrarTelemetria({ tipo: 'check-gate', subsistema: agentId, resultado: 'diferido', razon: resultado.razon });
        } else if (resultado.origen === 'soft_fail_api') {
            console.warn(`🟡 [SUBGATE_${agentId}] SOFT-FAIL vigente — SIN evaluación de ${agentId}: API no disponible (${resultado.softFail.codigo}), autorizado por ${resultado.softFail.autorizado_por}.`);
            registrarTelemetria({ tipo: 'check-gate', subsistema: agentId, resultado: 'soft_fail', origen: resultado.origen });
        } else {
            console.log(`✅ [SUBGATE_${agentId}] Aprobación vigente sobre los archivos relevantes de este commit.`);
            if (resultado.origen === 'excepcion_manual') {
                console.warn(`   🟡 EXCEPCIÓN MANUAL, no veredicto de ${agentId} vía API — ${JSON.stringify(resultado.excepcionManual)}`);
            }
            registrarTelemetria({ tipo: 'check-gate', subsistema: agentId, resultado: 'aprobado', origen: resultado.origen });
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
            console.log(`✅ [006_DEVSECOPS · ${r.categoria}] OK${r.razon ? ` — ${r.razon}` : ''}`);
            registrarTelemetria({ tipo: 'check-gate', subsistema: `006_${r.categoria}`, resultado: 'aprobado', razon: r.razon || null });
        }
    }

    // Vigilancia activa del PMU — advisories, nunca bloquean el commit, pero
    // ya no dependen de que alguien invoque a 006 a mano para notarlas.
    for (const alerta of analizarTelemetriaPMU()) {
        console.warn(`\n⚠️  [PMU] ${alerta.subsistema}: ${alerta.cantidad} rechazos consecutivos. Última razón: ${alerta.ultima_razon || 'sin razón registrada'}`);
        registrarTelemetria({ tipo: 'alerta_pmu', subsistema: alerta.subsistema, resultado: 'advertencia', razon: `${alerta.cantidad} rechazos consecutivos` });
    }
    for (const alerta of verificarVigenciaAgentes()) {
        console.warn(`\n⚠️  [PMU] ${alerta.agente || 'git'}: ${alerta.razon}`);
        registrarTelemetria({ tipo: 'alerta_pmu', subsistema: alerta.agente || alerta.tipo, resultado: 'advertencia', razon: alerta.razon });
    }

    const estadoPmu = escribirEstadoOperativo();
    // Proveedor de IA (2026-09-26) — solo informa; --check-gate no llama a la
    // API. El bloqueo real ocurre en --aprobar-* si el fallo es crítico.
    for (const al of estadoPmu.alertas_criticas_proveedor) {
        console.warn(`\n🚨 [PMU] ${al.tipo} (${al.proveedor}, ${al.ultimo_error?.codigo || 'sin código'}) — ${al.accion}`);
    }
    process.exitCode = (subgatesOk && chequeosOk) ? 0 : 1;
    return;
}

// Sonda de modelos: `node agents/architecture-gate.cjs --sondear-proveedores`
// — ping mínimo a cada modelo de la cadena (primario + conmutación) para
// saber cuáles responden hoy y en cuánto. Exit 0 si al menos uno vive.
if (process.argv.includes('--sondear-proveedores')) {
    (async () => {
        const resultados = await proveedorIA.sondearModelos({ cadenaPorDefecto: proveedorIA.CADENA_NIM_DEFAULT });
        console.log('\n📡 Sonda de modelos del gate (orden de la cadena):');
        for (const r of resultados) {
            console.log(`   ${r.vivo ? '🟢' : '🔴'} ${r.modelo.padEnd(48)} ${String(r.ms).padStart(6)} ms  ${r.codigo}`);
        }
        registrarTelemetria({ tipo: 'sonda_proveedores', subsistema: 'gate', resultado: resultados.some(r => r.vivo) ? 'ok' : 'sin_modelos', resultados });
        process.exit(resultados.some(r => r.vivo) ? 0 : 1);
    })().catch(err => {
        console.error(`🛑 Sonda falló: ${proveedorIA.redactar(err?.message || err)}`);
        process.exit(1);
    });
}

// Modo tablero: `node agents/architecture-gate.cjs --pmu-status` — imprime el
// estado operativo actual del Escuadrón Élite completo, regenerado en el
// momento (nunca sirve una copia vieja). No consume API.
if (process.argv.includes('--pmu-status')) {
    asegurarSubgatesAutoDescubiertos();
    const estado = escribirEstadoOperativo();
    console.log(`\n🎖️  PUESTO DE MANDO UNIFICADO — Escuadrón Élite (${estado.generado})`);
    console.log(`   ${estado.total_agentes} agentes registrados · ${estado.agentes_con_gate} con gate técnico propio\n`);
    const mando = new Map(estado.mapa_delegacion_001.map(m => [m.archivo, m]));
    for (const a of estado.agentes) {
        const escritura = a.permiso_escritura ? '✍️  ESCRITURA' : '👁️  solo lectura';
        const gate = a.gate === 'sin_gate_propio' ? '⚪ sin gate propio' : `🔒 ${a.gate}`;
        // Origen visible (2026-09-26): un soft-fail nunca se ve igual que
        // una evaluación real del modelo.
        const v = a.ultimo_veredicto;
        const veredicto = v
            ? (v.aprobado
                ? (v.origen === 'api_directa' ? `✅ aprobado api_directa (${(v.timestamp || '').slice(0, 10)})` : `🟡 aprobado ${v.origen} (${(v.timestamp || '').slice(0, 10)}) — SIN evaluación del modelo`)
                : '🛑 rechazado')
            : (a.gate === 'sin_gate_propio' ? '— n/a' : '— sin cambios evaluados');
        console.log(`   ${a.nombre || a.archivo}`);
        console.log(`      ${escritura} · ${gate} · ${veredicto} · mando 001: ${mando.get(a.archivo)?.mapeado_por_001 ? 'sí' : 'NO'}`);
    }
    const pv = estado.proveedor_ia;
    console.log(`\n   Proveedor IA: ${pv.proveedor} · ${pv.modelo || '—'} · key ${pv.key_configurada ? 'configurada' : 'AUSENTE'} · breaker ${pv.circuit_breaker.estado}`);
    console.log(`   alertas_activas: ${estado.alertas_activas.length} · alertas_criticas_proveedor: ${estado.alertas_criticas_proveedor.length}`);
    for (const al of estado.alertas_criticas_proveedor) {
        console.log(`   🚨 ${al.tipo} [${al.severidad}] ${al.ultimo_error?.codigo || ''} — ${al.accion}`);
    }
    for (const al of estado.alertas_activas) {
        console.log(`   ⚠️  ${al.tipo}: ${al.agente || al.subsistema || 'git'} — ${al.razon || al.ultima_razon || ''}`);
    }
    process.exitCode = 0;
    return;
}

// Modo firma de subgate: `node agents/architecture-gate.cjs --aprobar-subgate <agentId>`
// Aprueba UN subgate — extraído para reutilizar entre --aprobar-subgate
// (uno a la vez) y --aprobar-pendientes (todos en paralelo, ver abajo).
// Nunca escribe en consola directamente salvo su propio resultado — el
// caller decide cómo presentar/agregar varios resultados.
// Registro de aprobación degradada (soft-fail): nunca se ve igual que un
// veredicto evaluado — origen propio, sin diferimientos, responsable y
// código de fallo explícitos.
function construirRegistroSoftFail(firma, falloApi, permiso, evaluador) {
    return {
        aprobado: true,
        origen: 'soft_fail_api',
        soft_fail: {
            codigo: falloApi.codigo,
            detalle: falloApi.detalle,
            request_id: falloApi.request_id || null,
            autorizado_por: permiso.autorizadoPor,
            habilitado_via: permiso.via,
        },
        firma,
        timestamp: new Date().toISOString(),
        firmado_por: `SOFT-FAIL (proveedor de IA ${process.env.GATE_PROVIDER || 'nim'} no disponible: ${falloApi.codigo}) — SIN evaluación de ${evaluador}. Autorizado por: ${permiso.autorizadoPor}`,
        razones: [`SOFT-FAIL, no veredicto de ${evaluador}: ${falloApi.detalle}`],
        diferimientos: [],
    };
}

async function aprobarUnSubgate(agentId, archivosStaged) {
    const cfg = SUBGATES[agentId];
    const relevantes = archivosRelevantesPara(agentId, archivosStaged);
    if (relevantes.length === 0) {
        return { agentId, estado: 'sin_archivos_relevantes' };
    }
    const veredicto = await pedirVeredictoSubagente(agentId, relevantes);
    if (!veredicto.aprobado && veredicto.apiNoDisponible) {
        const permiso = resolverPermisoSoftFail();
        if (permiso.permitido) {
            const firma = hashArchivosStaged(relevantes);
            fs.writeFileSync(cfg.veredictoPath, JSON.stringify(
                construirRegistroSoftFail(firma, veredicto.falloApi, permiso, agentId), null, 2) + '\n', 'utf8');
            registrarTelemetria({ tipo: 'aprobar-subgate', subsistema: agentId, resultado: 'soft_fail', firma, razon: veredicto.falloApi.codigo });
            return { agentId, estado: 'soft_fail', firma, falloApi: veredicto.falloApi };
        }
        veredicto.razon = `${veredicto.razon} — ${permiso.razon}`;
    }
    if (!veredicto.aprobado) {
        registrarTelemetria({ tipo: 'aprobar-subgate', subsistema: agentId, resultado: 'rechazado', razon: veredicto.razon || null });
        return { agentId, estado: 'rechazado', razon: veredicto.razon, respuestaCruda: veredicto.respuestaCruda };
    }
    const firma = hashArchivosStaged(relevantes);
    fs.writeFileSync(cfg.veredictoPath, JSON.stringify({
        aprobado: true,
        origen: 'api_directa',
        firma,
        timestamp: new Date().toISOString(),
        firmado_por: firmaEvaluador(agentId, path.relative(dirRoot, cfg.promptPath).replace(/\\/g, '/'), veredicto),
        veredictoCompleto: veredicto.veredictoCompleto,
    }, null, 2) + '\n', 'utf8');
    registrarTelemetria({ tipo: 'aprobar-subgate', subsistema: agentId, resultado: 'aprobado', firma });
    return { agentId, estado: 'aprobado', firma };
}

if (process.argv.includes('--aprobar-subgate')) {
    asegurarSubgatesAutoDescubiertos();
    const agentId = process.argv[process.argv.indexOf('--aprobar-subgate') + 1];
    if (!SUBGATES[agentId]) {
        console.error(`🛑 [SUBGATE] '${agentId}' no es un subgate configurado. Válidos: ${Object.keys(SUBGATES).join(', ')}`);
        process.exitCode = 1;
        return;
    }
    (async () => {
        const archivosStaged = obtenerArchivosStaged();
        const relevantes = archivosRelevantesPara(agentId, archivosStaged);
        console.log(relevantes.length === 0
            ? `ℹ️  [SUBGATE_${agentId}] Ningún archivo staged le compete a este agente — nada que aprobar.`
            : `\n🔎 [${agentId}] Evaluando ${relevantes.length} archivo(s) staged contra ${path.basename(SUBGATES[agentId].promptPath)}...`);
        const r = await aprobarUnSubgate(agentId, archivosStaged);
        if (r.estado === 'sin_archivos_relevantes') { process.exitCode = 0; return; }
        if (r.estado === 'soft_fail') {
            console.warn(`\n🟡 [SUBGATE_${agentId}] SOFT-FAIL — API no disponible (${r.falloApi.codigo}); commit permitido SIN evaluación de ${agentId}. Firma: ${r.firma}`);
            escribirEstadoOperativo();
            process.exitCode = 0;
            return;
        }
        if (r.estado === 'rechazado') {
            console.error(`\n🛑 [SUBGATE_${agentId}] Rechazado — o no se pudo evaluar.`);
            if (r.razon) console.error(`   - ${r.razon}`);
            if (r.respuestaCruda) console.error(`   Respuesta cruda: ${r.respuestaCruda}`);
            escribirEstadoOperativo();
            process.exitCode = 1;
            return;
        }
        console.log(`\n✅ [SUBGATE_${agentId}] Aprobado. Firma: ${r.firma}`);
        escribirEstadoOperativo();
        process.exitCode = 0;
    })();
    return;
}

// Modo lote: `node agents/architecture-gate.cjs --aprobar-pendientes` —
// optimización de velocidad (2026-08-13, hallazgo real: aprobar 3 subgates
// tras el cambio de Sentry tomó varios minutos porque --aprobar-subgate solo
// aprueba uno a la vez, en serie, y cada llamada real a Anthropic tarda
// 10-30s). Detecta TODOS los subgates que aplican al diff staged actual y
// que no tienen aprobación vigente, y los manda en paralelo (Promise.all)
// — mismo trabajo, una fracción del tiempo de pared. No toca 002 (el gate
// principal) porque ese es un solo veredicto sobre TODO el diff, no hay
// nada que paralelizar ahí.
if (process.argv.includes('--aprobar-pendientes')) {
    asegurarSubgatesAutoDescubiertos();
    (async () => {
        const archivosStaged = obtenerArchivosStaged();
        const pendientes = Object.keys(SUBGATES).filter(agentId => {
            const resultado = validarSubgate(agentId, archivosStaged);
            return resultado.aplica && !resultado.aprobado;
        });
        if (pendientes.length === 0) {
            console.log('ℹ️  [LOTE] Ningún subgate pendiente sobre los archivos staged actuales.');
            process.exitCode = 0;
            return;
        }
        console.log(`\n🔎 [LOTE] ${pendientes.length} subgate(s) pendiente(s), evaluando en paralelo: ${pendientes.join(', ')}...`);
        const resultados = await Promise.all(pendientes.map(agentId => aprobarUnSubgate(agentId, archivosStaged)));
        let algunRechazo = false;
        for (const r of resultados) {
            if (r.estado === 'aprobado') {
                console.log(`✅ [SUBGATE_${r.agentId}] Aprobado. Firma: ${r.firma}`);
            } else if (r.estado === 'soft_fail') {
                console.warn(`🟡 [SUBGATE_${r.agentId}] SOFT-FAIL — API no disponible (${r.falloApi.codigo}); SIN evaluación. Firma: ${r.firma}`);
            } else if (r.estado === 'rechazado') {
                algunRechazo = true;
                console.error(`🛑 [SUBGATE_${r.agentId}] Rechazado — o no se pudo evaluar.`);
                if (r.razon) console.error(`   - ${r.razon}`);
            }
        }
        escribirEstadoOperativo();
        process.exitCode = algunRechazo ? 1 : 0;
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

        if (!veredicto.aprobado && veredicto.apiNoDisponible) {
            const permiso = resolverPermisoSoftFail();
            if (permiso.permitido) {
                const firma = hashEstado(listarCarpetasAgentes());
                fs.writeFileSync(APROBACION_PATH, JSON.stringify(
                    construirRegistroSoftFail(firma, veredicto.falloApi, permiso, '002_ARQUITECTO_DE_SOFTWARE'), null, 2) + '\n', 'utf8');
                console.warn(`\n🟡 [GATE_ARQUITECTURA] SOFT-FAIL — proveedor de IA no disponible (${veredicto.falloApi.codigo}).`);
                console.warn(`   Commit permitido SIN evaluación de 002. Autorizado por: ${permiso.autorizadoPor} (vía ${permiso.via}). Firma: ${firma}`);
                registrarTelemetria({ tipo: 'aprobar-diseno', subsistema: '002_principal', resultado: 'soft_fail', firma, razon: veredicto.falloApi.codigo });
                escribirEstadoOperativo();
                process.exitCode = 0;
                return;
            }
            veredicto.razones = [...(veredicto.razones || []), permiso.razon];
        }

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
            origen: 'api_directa',
            firma,
            timestamp: new Date().toISOString(),
            firmado_por: firmaEvaluador('Agente Arquitecto', '.claude/agents/002-arquitecto-de-software.md', veredicto),
            razones: veredicto.razones,
            diferimientos: veredicto.diferimientos || [],
        }, null, 2) + '\n', 'utf8');
        console.log(`\n✅ [Agente Arquitecto] Diseño aprobado. Firma: ${firma}`);
        (veredicto.razones || []).forEach(r => console.log(`   - ${r}`));
        (veredicto.diferimientos || []).forEach(d => console.log(`   🟡 DIFERIDO — ${d.subgate}: ${d.razon}`));
        registrarTelemetria({ tipo: 'aprobar-diseno', subsistema: '002_principal', resultado: 'aprobado', firma });
        escribirEstadoOperativo();
        process.exitCode = 0;
    })();
    return;
}

// Modo excepción manual: `node agents/architecture-gate.cjs
// --aprobar-excepcion-manual <principal|agentId> --autorizado-por "nombre"
// --motivo "texto" [--horas N]` — 2026-08-16, cierre de §0-AJ.2. Antes de
// esto, la única forma de destrabar el gate sin saldo de API era escribir
// diseno_aprobado.json/veredicto_00X.json a mano, calculando la firma con el
// mismo algoritmo público del script — indistinguible de un veredicto real
// para validarDisenoAprobado()/validarSubgate(). Este modo no lo hace
// infalsificable (sigue siendo local, con el mismo límite que hashEstado()
// ya reconoce sobre sí mismo), pero cierra la brecha real: fuerza que la
// excepción declare quién la autoriza y por qué, caduque sola dentro de
// HORAS_MAX_EXCEPCION_MANUAL, y quede marcada en consola/PMU de forma
// visiblemente distinta a una aprobación evaluada por la API — nunca
// indistinguible, que era el hallazgo real.
if (process.argv.includes('--aprobar-excepcion-manual')) {
    asegurarSubgatesAutoDescubiertos();
    const objetivo = process.argv[process.argv.indexOf('--aprobar-excepcion-manual') + 1];
    const leerFlag = (nombre) => {
        const idx = process.argv.indexOf(nombre);
        return idx !== -1 ? process.argv[idx + 1] : undefined;
    };
    const autorizadoPor = leerFlag('--autorizado-por');
    const motivo = leerFlag('--motivo');
    const horasFlag = leerFlag('--horas');
    const horas = Math.min(horasFlag ? Number(horasFlag) : 2, HORAS_MAX_EXCEPCION_MANUAL);

    if (!objetivo || !autorizadoPor || !motivo) {
        console.error('🛑 [EXCEPCION_MANUAL] Uso: --aprobar-excepcion-manual <principal|agentId> --autorizado-por "nombre" --motivo "texto" [--horas N]');
        process.exitCode = 1;
        return;
    }
    if (!Number.isFinite(horas) || horas <= 0) {
        console.error(`🛑 [EXCEPCION_MANUAL] --horas debe ser un número positivo (máximo ${HORAS_MAX_EXCEPCION_MANUAL}).`);
        process.exitCode = 1;
        return;
    }

    const timestamp = new Date();
    const expira = new Date(timestamp.getTime() + horas * 3600 * 1000).toISOString();
    const excepcion = { autorizado_por: autorizadoPor, motivo, expira };

    if (objetivo === 'principal') {
        const carpetas = listarCarpetasAgentes();
        const firma = hashEstado(carpetas);
        fs.writeFileSync(APROBACION_PATH, JSON.stringify({
            aprobado: true,
            origen: 'excepcion_manual',
            excepcion,
            firma,
            timestamp: timestamp.toISOString(),
            firmado_por: `Excepción manual (canal alterno, sin evaluación de 002 vía API) — autorizada por ${autorizadoPor}: ${motivo}`,
            razones: [`EXCEPCIÓN MANUAL, no veredicto de 002: ${motivo}`],
            diferimientos: [],
        }, null, 2) + '\n', 'utf8');
        console.warn(`\n🟡 [EXCEPCION_MANUAL] Aprobación PRINCIPAL bajo excepción manual — expira ${expira} (${horas}h). Autorizada por: ${autorizadoPor}. Esto NO es un veredicto de la API de 002.`);
        registrarTelemetria({ tipo: 'aprobar-excepcion-manual', subsistema: '002_principal', resultado: 'aprobado', razon: `excepcion_manual, expira ${expira}` });
        escribirEstadoOperativo();
        process.exitCode = 0;
        return;
    }

    if (!SUBGATES[objetivo]) {
        console.error(`🛑 [EXCEPCION_MANUAL] '${objetivo}' no es 'principal' ni un subgate configurado. Válidos: principal, ${Object.keys(SUBGATES).join(', ')}`);
        process.exitCode = 1;
        return;
    }
    const cfg = SUBGATES[objetivo];
    const relevantes = archivosRelevantesPara(objetivo, obtenerArchivosStaged());
    if (relevantes.length === 0) {
        console.error(`🛑 [EXCEPCION_MANUAL] Ningún archivo staged le compete a ${objetivo} — nada que aprobar bajo excepción.`);
        process.exitCode = 1;
        return;
    }
    const firma = hashArchivosStaged(relevantes);
    fs.writeFileSync(cfg.veredictoPath, JSON.stringify({
        aprobado: true,
        origen: 'excepcion_manual',
        excepcion,
        firma,
        timestamp: timestamp.toISOString(),
        firmado_por: `Excepción manual (canal alterno, sin evaluación de ${objetivo} vía API) — autorizada por ${autorizadoPor}: ${motivo}`,
        veredictoCompleto: { nota: 'excepción manual, sin evaluación real del subagente' },
    }, null, 2) + '\n', 'utf8');
    console.warn(`\n🟡 [EXCEPCION_MANUAL] Subgate ${objetivo} bajo excepción manual — expira ${expira} (${horas}h). Autorizada por: ${autorizadoPor}. Esto NO es un veredicto de ${objetivo} vía API.`);
    registrarTelemetria({ tipo: 'aprobar-excepcion-manual', subsistema: objetivo, resultado: 'aprobado', razon: `excepcion_manual, expira ${expira}` });
    escribirEstadoOperativo();
    process.exitCode = 0;
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
// Reubicado 2026-09-25 a agents/pmu/ — la carpeta legacy 001 se movió a
// _legacy_backup/ y el mkdir recursivo de escribirAuditTrail() la recrearía.
const AUDIT_TRAIL_PATH = path.join(dirAgents, 'pmu', 'orquestacion_log.jsonl');

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
        if (veredicto.origen === 'soft_fail_api') {
            console.warn(`\n🟡 [GATE_ARQUITECTURA] SOFT-FAIL vigente — SIN evaluación de 002 (${veredicto.softFail.codigo}) (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);
        } else {
            console.log(`\n✅ [GATE_ARQUITECTURA] Diseño aprobado por el Agente Arquitecto (002_ARQUITECTO_DE_SOFTWARE) (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);
        }

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
    if (agentesEjecutados === 0) {
        // Esperado desde 2026-09-25: las únicas carpetas con ejecutables
        // (Sistema A legacy) se movieron a _legacy_backup/ y ese directorio se
        // eliminó el 2026-09-26 (recuperable desde ac1721c); agents/00X-* restantes
        // son punteros (solo README.md). Los agentes reales viven en
        // .claude/agents/ y no los ejecuta este batch.
        console.warn('\n⚠️ Batch sin ejecutables: agents/ solo contiene carpetas puntero (Sistema A legacy eliminado 2026-09-26; recuperable desde el commit ac1721c).');
    }

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
    console.log(`📊 [AUDIT_TRAIL] ${path.relative(dirRoot, AUDIT_TRAIL_PATH).replace(/\\/g, '/')} (append, +1 linea, ${resultadosAuditTrail.length} resultado(s))`);

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
// --sondear-proveedores es asíncrono y no consulta el gate: el batch no corre.
if (require.main === module && !process.argv.includes('--sondear-proveedores')) {
    ejecutarTodosLosAgentes();
}

module.exports = {
    hashArchivo, hashEstado, validarDisenoAprobado, listarCarpetasAgentes, rutear,
    SUBGATES, archivosRelevantesPara, validarSubgate,
    descubrirAgentes, generarEstadoOperativo, mapaGatesPorPrefijo, leerFrontmatterAgente,
    escanearSecretos, verificarEnvExample, verificarDependencias, ejecutarChequeosEstaticos,
    diffTocaDependencias, bucketDe, construirDiffPriorizado,
    analizarTelemetriaPMU, verificarVigenciaAgentes, leerTelemetria,
    extraerJSONConCampo, asegurarSubgatesAutoDescubiertos, paquetesVulnerables,
    validarFormaVeredicto, VEREDICTO_SCHEMAS,
    validarOrigenVeredicto, ORIGENES_VALIDOS, HORAS_MAX_EXCEPCION_MANUAL,
    clasificarFalloApi, resolverPermisoSoftFail, construirRegistroSoftFail,
    mencionaAgente, generarMapaDelegacion001, consultarModelo, BREAKER_PATH,
};
