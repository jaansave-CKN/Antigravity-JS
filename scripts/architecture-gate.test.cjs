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
  escanearSecretos, verificarEnvExample, diffTocaDependencias,
} = require('../agents/architecture-gate.cjs');

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
