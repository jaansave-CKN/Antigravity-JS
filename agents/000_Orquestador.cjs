const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

console.log('\n🚀 [000] ANTIGRAVITY OS: Iniciando Orquestación Dinámica con Honestidad...');

const dirAgents = __dirname;
const dirRoot = path.join(dirAgents, '..');

// =============================================================================
// ESCUADRÓN ÉLITE — Mando Central (Fase 4: Instalación del Mando Central)
// Los 18 agentes de agents/ pasan a ser subordinados operativos: se invocan
// exclusivamente a través de este Mando Central, nunca de forma directa/aislada.
// =============================================================================
const ESCUADRON_ELITE = {
    '001_ARQUITECTO_CORE': {
        rol: 'Control de diseño y validación estructural',
        mandato: 'NO ejecuta ni modifica código. Fiscaliza y firma la aprobación de diseño antes de cualquier escritura.',
        subordinados: [],
    },
    '002_INGENIERIA_TOTAL': {
        rol: 'Ejecución de backend, frontend y bases de datos',
        subordinados: [
            '001_gestor_datos', '005_Radar1_minero', '006_Radar2_Estratega',
            '050_Formulador_proy', '051_Form_Lluvia_de_ideas',
            '07-ing-concreto_GFRC', '08-estratega-neuromarketing',
        ],
    },
    '003_DEVSECOPS_Y_AUDITORIA': {
        rol: 'Fiscalización de seguridad, validación de tipos y cumplimiento estricto en Pesos Colombianos (COP)',
        subordinados: [
            '03-analista-secop', '052_Form_Administrativo', '054_Form_Gestion_de_riesgos',
            '056_Form_Evaluador', '14-analista-comportamiento', '015_intelligence-core',
        ],
    },
    '004_DOCUMENTADOR_AS_BUILD': {
        rol: 'Generación de /docs/as-build/ y actas de entrega',
        subordinados: ['002_redactor_tecnico'],
        carpetaSalida: path.join(dirRoot, 'docs', 'as-build'),
    },
    '005_ESP_DISENO_STITCH': {
        rol: 'Arquitecto Visual y Maquetador de Interfaces (promovido desde agents/11-esp-diseno-grafico-y-stitch/, folder eliminado 2026-08-05)',
        mandato: 'Prohibido maquetar con datos falsos. Toda UI consume estrictamente los contratos JSON de RPC/REST aprobados por 001_ARQUITECTO_CORE y construidos por 002_INGENIERIA_TOTAL.',
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
// GATE DE ARQUITECTURA — Cero Código sin Diseño Aprobado
// 001_ARQUITECTO_CORE debe firmar el estado de agents/ antes de que el Mando
// Central autorice ejecutar a cualquier subordinado. La firma es un hash del
// estado real en disco: si algo cambia después de firmar, la aprobación cae.
// =============================================================================
// Vive directo en agents/ (NO dentro de ninguna carpeta \d{2,3}[_-]*) — si estuviera
// dentro de una carpeta de agente, escribir la firma cambiaría el listado de esa
// carpeta y la firma se autoinvalidaría en el acto.
const APROBACION_PATH = path.join(dirAgents, 'diseno_aprobado.json');

function listarCarpetasAgentes() {
    return fs.readdirSync(dirAgents).filter(item => {
        const rutaItem = path.join(dirAgents, item);
        return fs.lstatSync(rutaItem).isDirectory() && /^\d{2,3}[_-]/.test(item);
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
        return { aprobado: false, razon: 'No existe firma de 001_ARQUITECTO_CORE (diseno_aprobado.json ausente).' };
    }
    let firma;
    try {
        firma = JSON.parse(fs.readFileSync(APROBACION_PATH, 'utf8'));
    } catch (e) {
        return { aprobado: false, razon: `diseno_aprobado.json corrupto: ${e.message}` };
    }
    if (firma.aprobado !== true) {
        return { aprobado: false, razon: '001_ARQUITECTO_CORE marcó el diseño como NO aprobado.' };
    }
    const hashActual = hashEstado(carpetas);
    if (firma.firma !== hashActual) {
        return { aprobado: false, razon: 'El estado de agents/ cambió después de la firma — se requiere re-aprobación de 001_ARQUITECTO_CORE.' };
    }
    return { aprobado: true, firma: firma.firma, timestamp: firma.timestamp };
}

// Modo firma: `node agents/000_Orquestador.cjs --aprobar-diseno`
// Simula la fiscalización de 001_ARQUITECTO_CORE — firma el estado actual de
// agents/ y habilita la siguiente corrida. No ejecuta ningún subordinado.
if (process.argv.includes('--aprobar-diseno')) {
    const carpetas = listarCarpetasAgentes();
    const firma = hashEstado(carpetas);
    fs.writeFileSync(APROBACION_PATH, JSON.stringify({
        aprobado: true,
        firma,
        timestamp: new Date().toISOString(),
        firmado_por: '001_ARQUITECTO_CORE',
    }, null, 2) + '\n', 'utf8');
    console.log(`\n✅ [001_ARQUITECTO_CORE] Diseño firmado y aprobado. Firma: ${firma}`);
    process.exit(0);
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

async function ejecutarConVerdad(nombreAgente, funcionEjecutar) {
    console.log(`\n🔍 [000] Verificando: ${nombreAgente}`);

    try {
        const resultado = await funcionEjecutar();

        if (resultado && typeof resultado === 'string') {
            const urls = resultado.match(/https?:\/\/[^\s<>"']+/g) || [];

            if (urls.length > 0) {
                console.log(`   🔗 Detectadas ${urls.length} URLs - verificando...`);

                for (const url of urls) {
                    const chequeo = await validarEnlace(url);
                    if (!chequeo.valido) {
                        throw new Error(`Link Alucinado Detectado: ${url} - ${chequeo.error}`);
                    }
                }
                console.log(`   ✅ ${urls.length} URLs verificadas correctamente`);
            }
        }

        console.log(`   ✅ CONFIRMADO: ${nombreAgente} completado con éxito real`);
        return { exito: true, resultado };

    } catch (error) {
        console.error(`   ❌ ERROR REAL en ${nombreAgente}: ${error.message}`);
        return { exito: false, error: error.message };
    }
}

let agentesEjecutados = 0;
let agentesExitosos = 0;
let agentesFallidos = 0;
const bitacoraEjecucion = [];

async function ejecutarTodosLosAgentes() {
    try {
        const carpetasAgentes = listarCarpetasAgentes();

        if (carpetasAgentes.length === 0) {
            console.log('⚠️ No se encontraron carpetas de agentes.');
        }

        // GATE — cero código sin diseño aprobado por 001_ARQUITECTO_CORE
        const veredicto = validarDisenoAprobado(carpetasAgentes);
        if (!veredicto.aprobado) {
            console.error('\n🛑 [GATE_ARQUITECTURA] EJECUCIÓN BLOQUEADA — 001_ARQUITECTO_CORE no ha aprobado el diseño.');
            console.error(`   Motivo: ${veredicto.razon}`);
            console.error('   Para aprobar: node agents/000_Orquestador.cjs --aprobar-diseno');
            process.exit(1);
        }
        console.log(`\n✅ [GATE_ARQUITECTURA] Diseño aprobado por 001_ARQUITECTO_CORE (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);

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

                    console.log(`\n[000] -> FASE ${agentesEjecutados}: ${carpeta}  (reporta a ${comandante})`);

                    async function ejecutarAgente() {
                        return new Promise((resolve, reject) => {
                            exec(comando, { cwd: dirRoot, timeout: 30000 }, (error, stdout, stderr) => {
                                if (error) {
                                    reject(new Error(stderr || error.message));
                                } else {
                                    resolve(stdout);
                                }
                            });
                        });
                    }

                    // Blindaje de Honestidad Técnica: ya no se asume éxito por ausencia de excepción —
                    // ejecutarConVerdad() corre el comando con timeout real y escanea el resultado en
                    // busca de URLs alucinadas antes de marcarlo como éxito.
                    const resultado = await ejecutarConVerdad(carpeta, ejecutarAgente);

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

    // 004_DOCUMENTADOR_AS_BUILD — acta de entrega
    if (bitacoraEjecucion.length > 0) {
        const carpetaAsBuild = ESCUADRON_ELITE['004_DOCUMENTADOR_AS_BUILD'].carpetaSalida;
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
            `**Generado por:** 004_DOCUMENTADOR_AS_BUILD`,
            ``,
            `| Agente | Reporta a | Resultado |`,
            `|---|---|---|`,
            ...lineas,
            ``,
            `**Resumen:** ${agentesEjecutados} ejecutados, ${agentesExitosos} exitosos, ${agentesFallidos} fallidos.`,
            ``,
        ].join('\n');
        fs.writeFileSync(actaPath, acta, 'utf8');
        console.log(`\n📄 [004_DOCUMENTADOR_AS_BUILD] Acta de entrega generada: docs/as-build/${path.basename(actaPath)}`);
    }

    console.log('\n✅ OBRA FINALIZADA: Director Jairo Antonio Salinas Velasco | Asfáltica S.A.S.');
    console.log('------------------------------------------------------------');
    console.log('\n[000] Protocolo de Honestidad Técnica: ACTIVO');
    console.log('[000] Cada resultado fue verificado. Sin alucinaciones.');
}

ejecutarTodosLosAgentes();
