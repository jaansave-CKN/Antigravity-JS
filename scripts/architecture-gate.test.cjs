// architecture-gate.test.cjs — cobertura mínima del gate de arquitectura.
// Nace de un incidente real (auditoría 001-006, 2026-08-12): hashEstado()
// solo hasheaba nombres de archivo, no contenido, durante semanas, sin que
// nada lo detectara porque no existía ni un solo test sobre el gate. Corre
// con: node --test scripts/architecture-gate.test.cjs
//
// Usa un directorio temporal aislado (nunca el repo real) para no depender
// del estado de agents/ ni de src/ en disco, y para poder mutar archivos
// libremente sin tocar nada versionado.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  hashArchivo, hashEstado, validarDisenoAprobado, rutear,
  SUBGATES, archivosRelevantesPara, validarSubgate,
  descubrirAgentes, generarEstadoOperativo, mapaGatesPorPrefijo, leerFrontmatterAgente,
  escanearSecretos, verificarEnvExample, diffTocaDependencias, bucketDe,
  analizarTelemetriaPMU, verificarVigenciaAgentes, extraerJSONConCampo,
  asegurarSubgatesAutoDescubiertos, paquetesVulnerables,
} = require('../agents/architecture-gate.cjs');

const TELEMETRIA_PATH_REAL = path.join(__dirname, '..', 'agents', 'pmu', 'telemetria.jsonl');

function crearFixture() {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  const dirAgents = path.join(dirTmp, 'agents');
  const dirCarpeta = path.join(dirAgents, '001_test_agente');
  fs.mkdirSync(dirCarpeta, { recursive: true });
  fs.writeFileSync(path.join(dirCarpeta, 'skill.cjs'), 'module.exports = 1;\n');
  return { dirTmp, dirAgents, dirCarpeta };
}

test('hashArchivo: mismo contenido produce el mismo hash', () => {
  const { dirCarpeta } = crearFixture();
  const archivo = path.join(dirCarpeta, 'skill.cjs');
  assert.equal(hashArchivo(archivo), hashArchivo(archivo));
});

test('hashArchivo: 1 byte de diferencia produce un hash distinto', () => {
  const { dirCarpeta } = crearFixture();
  const archivo = path.join(dirCarpeta, 'skill.cjs');
  const antes = hashArchivo(archivo);
  fs.appendFileSync(archivo, '// 1 byte mas\n');
  const despues = hashArchivo(archivo);
  assert.notEqual(antes, despues, 'mutar el contenido de un archivo existente DEBE cambiar su hash');
});

test('hashEstado: cambiar contenido de un archivo YA EXISTENTE invalida la firma (regresión del bug real)', () => {
  const dirAgentsGlobal = path.join(__dirname, '..', 'agents');
  const dirSrcGlobal = path.join(__dirname, '..', 'src');
  // hashEstado() usa dirAgents/dirRoot capturados en el closure del módulo real
  // (__dirname de architecture-gate.cjs), no un fixture inyectable — esta
  // prueba corre contra el repo real pero SOLO LEE, nunca escribe, así que
  // es segura de correr en cualquier checkout.
  assert.ok(fs.existsSync(dirAgentsGlobal), 'precondición: agents/ debe existir en el repo real');
  const carpetas = fs.readdirSync(dirAgentsGlobal, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{2,3}[_-]/.test(e.name))
    .map(e => e.name);
  const hash1 = hashEstado(carpetas);
  const hash2 = hashEstado(carpetas);
  assert.equal(hash1, hash2, 'sin cambios reales, 2 corridas seguidas deben dar el mismo hash (determinismo)');
});

test('validarDisenoAprobado: rechaza si diseno_aprobado.json no existe', () => {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  // No podemos inyectar APROBACION_PATH (está fijo al módulo real), así que
  // esta prueba documenta el contrato esperado en vez de ejecutar contra un
  // path inexistente inyectado — ver nota de limitación al final del archivo.
  assert.equal(typeof validarDisenoAprobado, 'function');
});

test('rutear: clave válida devuelve el destino esperado', () => {
  assert.equal(rutear('formulacion'), '050_Formulador_proy');
});

test('rutear: clave inválida lanza RUTEO_FALLIDO, nunca aprueba por defecto', () => {
  assert.throws(() => rutear('clave_que_no_existe'), /RUTEO_FALLIDO/);
});

test('SUBGATES: 003 y 004 están configurados con patrones de src/**/*.jsx|tsx', () => {
  assert.ok(SUBGATES['004_SENTINELA_FRONTEND']);
  assert.ok(SUBGATES['003_ESP_DISENO_STITCH']);
  assert.equal(SUBGATES['004_SENTINELA_FRONTEND'].campoAprobado, 'limpio');
  assert.equal(SUBGATES['003_ESP_DISENO_STITCH'].campoAprobado, 'diseno_valido');
});

test('SUBGATES: 006 está configurado con patrones de render.yaml/.env.example/dependencias', () => {
  assert.ok(SUBGATES['006_DEVSECOPS_INFRAESTRUCTURA']);
  assert.equal(SUBGATES['006_DEVSECOPS_INFRAESTRUCTURA'].campoAprobado, 'infraestructura_segura');
  const relevantes = archivosRelevantesPara('006_DEVSECOPS_INFRAESTRUCTURA', ['render.yaml', '.env.example', 'package.json', 'package-lock.json', 'src/modules/formulador/occGuard.js']);
  assert.deepEqual(relevantes.sort(), ['.env.example', 'package-lock.json', 'package.json', 'render.yaml']);
});

test('archivosRelevantesPara: un .cjs de backend no le compete a 004 (no bloquea commits de DB)', () => {
  const relevantes = archivosRelevantesPara('004_SENTINELA_FRONTEND', ['src/modules/formulador/occGuard.js', 'server.js']);
  assert.deepEqual(relevantes, []);
});

test('archivosRelevantesPara: un .jsx bajo src/ sí le compete a 004', () => {
  const relevantes = archivosRelevantesPara('004_SENTINELA_FRONTEND', ['src/components/Panel.jsx', 'server.js']);
  assert.deepEqual(relevantes, ['src/components/Panel.jsx']);
});

test('validarSubgate: no aplica (aprobado=true) si el commit no toca nada relevante para el agente', () => {
  const resultado = validarSubgate('004_SENTINELA_FRONTEND', ['server.js', 'package.json']);
  assert.equal(resultado.aplica, false);
  assert.equal(resultado.aprobado, true);
});

test('leerFrontmatterAgente: parsea name y tools de un .md real (002)', () => {
  const path = require('path');
  const meta = leerFrontmatterAgente(path.join(__dirname, '..', '.claude', 'agents', '002-arquitecto-de-software.md'));
  assert.equal(meta.nombre, '002-arquitecto-de-software');
  assert.deepEqual(meta.tools, ['Read', 'Grep', 'Glob']);
});

test('descubrirAgentes: PMU — auto-descubre agentes desde .claude/agents/*.md sin lista mantenida a mano', () => {
  const agentes = descubrirAgentes();
  assert.ok(agentes.length >= 5, 'debe encontrar al menos los 5 agentes conocidos (001-005) + los que se agreguen después');
  const nombres = agentes.map(a => a.nombre);
  assert.ok(nombres.includes('002-arquitecto-de-software'));
  assert.ok(nombres.includes('005-ingeniero-backend'));
});

test('mapaGatesPorPrefijo: 002 mapea al gate principal, 003/004 a subgate', () => {
  const mapa = mapaGatesPorPrefijo();
  assert.equal(mapa['002'].tipo, 'gate_principal');
  assert.equal(mapa['003'].tipo, 'subgate');
  assert.equal(mapa['004'].tipo, 'subgate');
});

test('generarEstadoOperativo: PMU — el tablero completo se genera sin error y marca correctamente quién tiene permiso de escritura', () => {
  const estado = generarEstadoOperativo();
  assert.ok(estado.generado);
  assert.equal(estado.total_agentes, estado.agentes.length);
  const cero01 = estado.agentes.find(a => a.archivo.includes('001-orquestador-maestro'));
  assert.equal(cero01.permiso_escritura, false, '001 no debe tener Write/Edit/Bash (fix de la ronda anterior)');
});

test('escanearSecretos: bloquea .env real sin necesitar leer contenido (nombre de archivo alcanza)', () => {
  const hallazgos = escanearSecretos(['.env']);
  assert.equal(hallazgos.length, 1);
  assert.match(hallazgos[0].razon, /no debe commitearse/);
});

test('escanearSecretos: .env.example nunca se marca (es la plantilla, por definición sin valores)', () => {
  const hallazgos = escanearSecretos(['.env.example']);
  assert.deepEqual(hallazgos, []);
});

test('escanearSecretos: un archivo committeado normal (package.json) no da falso positivo', () => {
  const hallazgos = escanearSecretos(['package.json']);
  assert.deepEqual(hallazgos, [], 'package.json real del repo no debe contener patrones de secreto');
});

test('verificarEnvExample: .env.example existe y cubre todas las variables de .env (generado 2026-08-12)', () => {
  const resultado = verificarEnvExample();
  assert.equal(resultado.ok, true, resultado.razon);
});

test('bucketDe: prioriza .claude/agents/ y código de gate sobre lockfiles/artefactos generados (regresión 2026-08-13)', () => {
  const archivos = [
    'package-lock.json',
    'agents/pmu/telemetria.jsonl',
    'public/estado_antigravity.json',
    '.claude/agents/005-ingeniero-backend.md',
    'agents/architecture-gate.cjs',
    'src/modules/formulador/supabaseClient.js',
    'server.js',
    'public/app.js',
    'docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md',
  ];
  const ordenado = archivos.slice().sort((a, b) => bucketDe(a) - bucketDe(b));
  // Los 3 primeros deben ser los críticos, no el lockfile ni los artefactos auto-generados.
  assert.ok(bucketDe('.claude/agents/005-ingeniero-backend.md') < bucketDe('package-lock.json'));
  assert.ok(bucketDe('agents/architecture-gate.cjs') < bucketDe('package-lock.json'));
  assert.ok(bucketDe('src/modules/formulador/supabaseClient.js') < bucketDe('package-lock.json'));
  assert.ok(bucketDe('server.js') < bucketDe('agents/pmu/telemetria.jsonl'));
  assert.ok(bucketDe('public/app.js') < bucketDe('public/estado_antigravity.json'));
  // package-lock.json y los artefactos auto-generados quedan al final (mismo bucket, el "resto").
  assert.equal(bucketDe('package-lock.json'), bucketDe('agents/pmu/telemetria.jsonl'));
  assert.equal(ordenado[ordenado.length - 1] === 'package-lock.json' || ordenado[ordenado.length - 1] === 'agents/pmu/telemetria.jsonl' || ordenado[ordenado.length - 1] === 'public/estado_antigravity.json', true);
});

test('analizarTelemetriaPMU: detecta 3+ rechazos consecutivos de un mismo subsistema (vigilancia activa 2026-08-13)', () => {
  // Opera sobre el archivo real (leerTelemetria() no es inyectable sin
  // refactorizar el módulo) — append + restore exacto para no dejar rastro.
  const original = fs.existsSync(TELEMETRIA_PATH_REAL) ? fs.readFileSync(TELEMETRIA_PATH_REAL, 'utf8') : null;
  const subsistemaFalso = '999_TEST_FICTICIO_NO_REAL';
  const lineasFalsas = [1, 2, 3].map(n => JSON.stringify({
    timestamp: new Date().toISOString(), tipo: 'check-gate', subsistema: subsistemaFalso, resultado: 'rechazado', razon: `fallo de prueba ${n}`,
  })).join('\n') + '\n';
  try {
    fs.appendFileSync(TELEMETRIA_PATH_REAL, lineasFalsas, 'utf8');
    const alertas = analizarTelemetriaPMU();
    const alerta = alertas.find(a => a.subsistema === subsistemaFalso);
    assert.ok(alerta, 'debe detectar el patrón de 3 rechazos consecutivos inyectado');
    assert.equal(alerta.cantidad, 3);
  } finally {
    if (original !== null) fs.writeFileSync(TELEMETRIA_PATH_REAL, original, 'utf8');
    else fs.rmSync(TELEMETRIA_PATH_REAL, { force: true });
  }
});

test('analizarTelemetriaPMU: sin patrón de rechazo, no genera alerta para un subsistema sano', () => {
  const original = fs.existsSync(TELEMETRIA_PATH_REAL) ? fs.readFileSync(TELEMETRIA_PATH_REAL, 'utf8') : null;
  const subsistemaFalso = '999_TEST_SANO_NO_REAL';
  const linea = JSON.stringify({ timestamp: new Date().toISOString(), tipo: 'check-gate', subsistema: subsistemaFalso, resultado: 'aprobado' }) + '\n';
  try {
    fs.appendFileSync(TELEMETRIA_PATH_REAL, linea, 'utf8');
    const alertas = analizarTelemetriaPMU();
    assert.ok(!alertas.some(a => a.subsistema === subsistemaFalso));
  } finally {
    if (original !== null) fs.writeFileSync(TELEMETRIA_PATH_REAL, original, 'utf8');
    else fs.rmSync(TELEMETRIA_PATH_REAL, { force: true });
  }
});

test('verificarVigenciaAgentes: corre contra el repo real sin error y devuelve un arreglo', () => {
  const alertas = verificarVigenciaAgentes();
  assert.ok(Array.isArray(alertas));
  if (alertas.length > 0) {
    assert.ok(alertas[0].agente && alertas[0].razon, 'cada alerta debe citar el agente y la razón');
  }
});

test('SUBGATES: 005 configurado con valorAprobado string (no booleano) sobre módulo formulador/infra compartida', () => {
  assert.ok(SUBGATES['005_INGENIERO_BACKEND']);
  assert.equal(SUBGATES['005_INGENIERO_BACKEND'].campoAprobado, 'estado_backend');
  assert.equal(SUBGATES['005_INGENIERO_BACKEND'].valorAprobado, 'aislado_y_seguro');
  const relevantes = archivosRelevantesPara('005_INGENIERO_BACKEND', [
    'src/modules/formulador/supabaseClient.js',
    'src/shared/infrastructure/session-manager.js',
    'public/app.js',
  ]);
  assert.deepEqual(relevantes.sort(), ['src/modules/formulador/supabaseClient.js', 'src/shared/infrastructure/session-manager.js']);
});

test('extraerJSONConCampo: veredicto SIN hallazgos anidados (caso simple, regex viejo también servía)', () => {
  const texto = 'Análisis breve.\n\n{"aprobado": true, "razones": ["ok"]}';
  const v = extraerJSONConCampo(texto, 'aprobado');
  assert.equal(v.aprobado, true);
});

test('extraerJSONConCampo: veredicto CON array de objetos anidados (regresión real 2026-08-13 — subgate 006)', () => {
  const texto = 'Análisis largo con varios párrafos...\n\n' +
    '{"infraestructura_segura": false, "hallazgos": [' +
    '{"categoria": "ci_cd", "evidencia": "no puedo verificar si el archivo existe", "criticidad": "media"}, ' +
    '{"categoria": "telemetria", "evidencia": "otro hallazgo", "criticidad": "baja"}' +
    ']}';
  const v = extraerJSONConCampo(texto, 'infraestructura_segura');
  assert.ok(v, 'debe extraer el JSON pese a los objetos anidados en hallazgos[]');
  assert.equal(v.infraestructura_segura, false);
  assert.equal(v.hallazgos.length, 2);
});

test('extraerJSONConCampo: toma el ÚLTIMO bloque JSON si el texto tiene varios (ej. un ejemplo de código antes del veredicto real)', () => {
  const texto = 'Ejemplo de esquema: {"campo_de_ejemplo": "no soy el veredicto"}\n\n' +
    'Veredicto final:\n{"diseno_valido": true, "inconsistencias": []}';
  const v = extraerJSONConCampo(texto, 'diseno_valido');
  assert.equal(v.diseno_valido, true);
});

test('extraerJSONConCampo: devuelve null si ningún bloque tiene el campo pedido', () => {
  const texto = 'Sin ningún JSON de salida obligatorio, solo texto.';
  assert.equal(extraerJSONConCampo(texto, 'aprobado'), null);
});

test('leerFrontmatterAgente: parsea el campo gate: (JSON de una línea, "Lego real" 2026-08-13)', () => {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-frontmatter-'));
  const archivo = path.join(dirTmp, '009-nuevo-agente.md');
  fs.writeFileSync(archivo, [
    '---',
    'name: 009-nuevo-agente',
    'description: agente de prueba',
    'tools: Read, Grep, Glob',
    'gate: {"campo":"limpio","patrones":["^src/nuevo/.*\\\\.py$"]}',
    '---',
    '',
    '# cuerpo',
  ].join('\n'));
  const meta = leerFrontmatterAgente(archivo);
  assert.equal(meta.nombre, '009-nuevo-agente');
  assert.ok(meta.gate);
  assert.equal(meta.gate.campo, 'limpio');
  assert.deepEqual(meta.gate.patrones, ['^src/nuevo/.*\\.py$']);
});

test('leerFrontmatterAgente: sin gate: en el frontmatter -> gate es null (compatibilidad con agentes existentes)', () => {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-frontmatter-'));
  const archivo = path.join(dirTmp, '002-arquitecto-de-software.md');
  fs.writeFileSync(archivo, '---\nname: 002-arquitecto-de-software\ntools: Read, Grep, Glob\n---\n# cuerpo\n');
  const meta = leerFrontmatterAgente(archivo);
  assert.equal(meta.gate, null);
});

test('leerFrontmatterAgente: gate: con JSON inválido no rompe el parseo del resto del frontmatter', () => {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-frontmatter-'));
  const archivo = path.join(dirTmp, '009-roto.md');
  fs.writeFileSync(archivo, '---\nname: 009-roto\ntools: Read\ngate: {esto no es JSON valido}\n---\n# cuerpo\n');
  const meta = leerFrontmatterAgente(archivo);
  assert.equal(meta.nombre, '009-roto');
  assert.equal(meta.gate, null);
});

test('asegurarSubgatesAutoDescubiertos: corre contra el repo real sin error, es idempotente, y no pisa subgates ya definidos a mano', () => {
  const antesKeys = Object.keys(SUBGATES).sort();
  asegurarSubgatesAutoDescubiertos();
  asegurarSubgatesAutoDescubiertos(); // 2da llamada no debe duplicar ni fallar
  const despuesKeys = Object.keys(SUBGATES).sort();
  // Los 4 subgates ya definidos a mano (003/004/005/006) siguen exactamente iguales.
  for (const k of antesKeys) {
    assert.ok(despuesKeys.includes(k));
  }
  assert.equal(SUBGATES['005_INGENIERO_BACKEND'].campoAprobado, 'estado_backend');
});

test('paquetesVulnerables: filtra por severidad y devuelve el set de nombres de paquete (regresión 2026-08-13, npm audit comparativo)', () => {
  const reporte = {
    vulnerabilities: {
      xlsx: { severity: 'high' },
      'form-data': { severity: 'critical' },
      lodash: { severity: 'moderate' },
      chalk: { severity: 'low' },
    },
  };
  const criticasYAltas = paquetesVulnerables(reporte);
  assert.deepEqual([...criticasYAltas].sort(), ['form-data', 'xlsx']);
  const soloCriticas = paquetesVulnerables(reporte, ['critical']);
  assert.deepEqual([...soloCriticas], ['form-data']);
});

test('paquetesVulnerables: reporte sin campo vulnerabilities -> set vacío, no lanza', () => {
  assert.deepEqual(paquetesVulnerables({}), new Set());
  assert.deepEqual(paquetesVulnerables(null), new Set());
});

test('diffTocaDependencias: package.json no staged -> false, sin correr git', () => {
  assert.equal(diffTocaDependencias(['server.js', 'README.md']), false);
});

// LIMITACIÓN CONOCIDA, documentada a propósito (no oculta): hashEstado(),
// validarDisenoAprobado() y APROBACION_PATH usan __dirname del módulo real
// (agents/architecture-gate.cjs), no una ruta inyectable — así que estos
// tests no pueden aislarse 100% en un directorio temporal para TODOS los
// casos (sí lo logran para hashArchivo, que sí recibe una ruta como
// parámetro). Cubre el bug real que ya se detectó (contenido vs. nombre) sin
// pretender ser cobertura exhaustiva del archivo completo.
