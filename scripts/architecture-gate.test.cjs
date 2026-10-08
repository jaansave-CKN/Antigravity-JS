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
  hashArchivo, hashEstado, validarDisenoAprobado, listarCarpetasAgentes, rutear, evidenciaE2E, diferimientoEnMandato,
  SUBGATES, archivosRelevantesPara, validarSubgate,
  descubrirAgentes, generarEstadoOperativo, mapaGatesPorPrefijo, leerFrontmatterAgente,
  escanearSecretos, verificarEnvExample, diffTocaDependencias, bucketDe, parsearNameStatus,
  parsearDiffRaw, huellaCambios, amarreStaged, amarreDeCommit, validarAmarre, GENERADO_POR_GATE,
  analizarTelemetriaPMU, verificarVigenciaAgentes, extraerJSONConCampo,
  asegurarSubgatesAutoDescubiertos, paquetesVulnerables,
  validarFormaVeredicto, VEREDICTO_SCHEMAS,
  validarOrigenVeredicto, ORIGENES_VALIDOS, HORAS_MAX_EXCEPCION_MANUAL,
  clasificarFalloApi, resolverPermisoSoftFail, construirRegistroSoftFail,
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

test('hashEstado: public/src/ (frontend React real) SÍ forma parte de la firma (regresión bug crítico 2026-08-13, gate principal)', () => {
  // hashEstado() antes solo cubría agents/+src/(backend)+.claude/agents/ —
  // un cambio en App.jsx/RadarApp.jsx no invalidaba diseno_aprobado.json en
  // absoluto. Prueba real: mutar+restaurar un archivo real de public/src/ y
  // confirmar que el hash SÍ cambia. Mutación mínima y reversible, con
  // try/finally para garantizar restauración exacta incluso si el assert falla.
  const dirAgentsGlobal = path.join(__dirname, '..', 'agents');
  const dirPublicSrcGlobal = path.join(__dirname, '..', 'public', 'src');
  const carpetas = fs.readdirSync(dirAgentsGlobal, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{2,3}[_-]/.test(e.name))
    .map(e => e.name);

  const archivoReal = fs.existsSync(path.join(dirPublicSrcGlobal, 'App.jsx'))
    ? path.join(dirPublicSrcGlobal, 'App.jsx')
    : null;
  assert.ok(archivoReal, 'precondición: public/src/App.jsx debe existir en el repo real');

  const original = fs.readFileSync(archivoReal, 'utf8');
  const hashAntes = hashEstado(carpetas);
  try {
    fs.writeFileSync(archivoReal, original + '\n// mutación temporal de test, ver architecture-gate.test.cjs\n', 'utf8');
    const hashDespues = hashEstado(carpetas);
    assert.notEqual(hashAntes, hashDespues, 'mutar un archivo real de public/src/ DEBE cambiar la firma del gate principal');
  } finally {
    fs.writeFileSync(archivoReal, original, 'utf8');
  }
  const hashRestaurado = hashEstado(carpetas);
  assert.equal(hashRestaurado, hashAntes, 'tras restaurar el archivo, la firma debe volver a coincidir con la original');
});

test('hashEstado: el propio motor del gate (agents/architecture-gate.cjs y scripts/check_veto_008.cjs) SÍ forma parte de la firma (regresión bug crítico 2026-08-13, harness engineering — auto-integridad)', () => {
  // Hallazgo real: listarCarpetasAgentes() solo devuelve subcarpetas
  // numeradas de agents/ — el código del propio gate (architecture-gate.cjs,
  // en la raíz de agents/, no en una subcarpeta) y el veto de CI
  // (scripts/check_veto_008.cjs) nunca estaban en el alcance de hashEstado().
  // Se podía debilitar la lógica de enforcement (ej. validarFormaVeredicto()
  // siempre {ok:true}) sin invalidar diseno_aprobado.json. Reproducido en
  // vivo antes de corregir: --aprobar-diseno reportó la MISMA firma tras
  // agregar código real nuevo a este archivo.
  const dirAgentsGlobal = path.join(__dirname, '..', 'agents');
  const gateEnginePath = path.join(dirAgentsGlobal, 'architecture-gate.cjs');
  const carpetas = fs.readdirSync(dirAgentsGlobal, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{2,3}[_-]/.test(e.name))
    .map(e => e.name);

  const original = fs.readFileSync(gateEnginePath, 'utf8');
  const hashAntes = hashEstado(carpetas);
  try {
    fs.writeFileSync(gateEnginePath, original + '\n// mutación temporal de test, ver architecture-gate.test.cjs\n', 'utf8');
    const hashDespues = hashEstado(carpetas);
    assert.notEqual(hashAntes, hashDespues, 'mutar agents/architecture-gate.cjs DEBE cambiar la firma — protege al motor del gate de sí mismo');
  } finally {
    fs.writeFileSync(gateEnginePath, original, 'utf8');
  }
  const hashRestaurado = hashEstado(carpetas);
  assert.equal(hashRestaurado, hashAntes, 'tras restaurar el archivo, la firma debe volver a coincidir con la original');
});

test('validarDisenoAprobado: rechaza si diseno_aprobado.json no existe', () => {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  // No podemos inyectar APROBACION_PATH (está fijo al módulo real), así que
  // esta prueba documenta el contrato esperado en vez de ejecutar contra un
  // path inexistente inyectado — ver nota de limitación al final del archivo.
  assert.equal(typeof validarDisenoAprobado, 'function');
});

test('rutear: clave válida devuelve el destino esperado', () => {
  // Actualizado 2026-08-16: 'formulacion' ahora apunta a agents/dominio-radfor360/
  // (reubicado fuera de agents/ en la limpieza total). 'administrativo' e
  // 'inteligencia_mercado' se removieron del enrutador — sus destinos
  // (052_Form_Administrativo, 012_Radar2_Estratega) fueron purgados del disco.
  assert.equal(rutear('formulacion'), 'agents/dominio-radfor360/Proy_03 B Formulador');
});

test('rutear: clave inválida lanza RUTEO_FALLIDO, nunca aprueba por defecto', () => {
  assert.throws(() => rutear('clave_que_no_existe'), /RUTEO_FALLIDO/);
});

test('SUBGATES: 003 y 004 están configurados con patrones de public/src/**/*.jsx|tsx (corregido 2026-08-13 — el frontend real vive ahí, no en src/ raíz)', () => {
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

test('SUBGATES: 005 cubre server.js y src/orchestrator-engine.js (regresión brecha de cobertura 2026-08-14 — el orquestador arregló ambos directamente porque ningún subgate los cubría)', () => {
  const relevantes = archivosRelevantesPara('005_INGENIERO_BACKEND', [
    'server.js', 'src/orchestrator-engine.js', 'src/shared/infrastructure/cache.js', 'public/src/App.jsx',
  ]);
  assert.deepEqual(relevantes.sort(), ['server.js', 'src/orchestrator-engine.js', 'src/shared/infrastructure/cache.js'].sort());
});

test('archivosRelevantesPara: un .cjs de backend no le compete a 004 (no bloquea commits de DB)', () => {
  const relevantes = archivosRelevantesPara('004_SENTINELA_FRONTEND', ['src/modules/formulador/occGuard.js', 'server.js']);
  assert.deepEqual(relevantes, []);
});

test('archivosRelevantesPara: un .jsx bajo public/src/ (frontend real) sí le compete a 004', () => {
  const relevantes = archivosRelevantesPara('004_SENTINELA_FRONTEND', ['public/src/components/Panel.jsx', 'server.js']);
  assert.deepEqual(relevantes, ['public/src/components/Panel.jsx']);
});

test('archivosRelevantesPara: regresión del bug real 2026-08-13 — un .jsx bajo src/ (raíz, backend) NO le compete a 004 (ahí no vive el frontend)', () => {
  const relevantes = archivosRelevantesPara('004_SENTINELA_FRONTEND', ['src/components/Panel.jsx']);
  assert.deepEqual(relevantes, []);
});

test('archivosRelevantesPara: los 13 archivos .jsx/.tsx reales de public/src/ SÍ competen a 003 y 004 (verificación contra el repo real)', () => {
  const fs2 = require('fs');
  const dirPublicSrc = path.join(__dirname, '..', 'public', 'src');
  function listarJsxTsx(dir) {
    let out = [];
    for (const e of fs2.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(listarJsxTsx(full));
      else if (/\.(jsx|tsx)$/.test(e.name)) out.push(path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/'));
    }
    return out;
  }
  const reales = listarJsxTsx(dirPublicSrc);
  assert.ok(reales.length > 0, 'debe haber al menos 1 archivo .jsx/.tsx real en public/src/');
  const relevantesPara004 = archivosRelevantesPara('004_SENTINELA_FRONTEND', reales);
  assert.equal(relevantesPara004.length, reales.length, 'TODOS los .jsx/.tsx reales deben ser relevantes para 004 — si no, el patrón sigue roto');
});

test('validarSubgate: no aplica (aprobado=true) si el commit no toca nada relevante para el agente', () => {
  const resultado = validarSubgate('004_SENTINELA_FRONTEND', ['server.js', 'package.json']);
  assert.equal(resultado.aplica, false);
  assert.equal(resultado.aprobado, true);
});

// Mecanismo de diferimiento de 002 sobre un subgate — agregado 2026-08-16
// (hallazgo real: no existía NINGUNA conexión de código entre "002 aprobó
// el diseño, incluso sabiendo que un subgate lo rechazaría" y el resultado
// real de --check-gate). Muta el diseno_aprobado.json REAL (mismo patrón ya
// usado en este archivo para hashEstado — try/finally garantiza restauración
// exacta incluso si el assert falla) porque validarDisenoAprobado() no
// acepta una ruta inyectable.
// Ambos tests calculan su propia firma vigente con hashEstado() real —
// NO confían en que agents/diseno_aprobado.json en disco esté al día (no
// lo está necesariamente: cualquier edición a architecture-gate.cjs
// hecha DESPUÉS de la última --aprobar-diseno real lo vuelve stale, y
// justamente este mecanismo se implementó editando ese archivo).
test('validarSubgate: un diferimiento real de 002 (diseno_aprobado.json vigente + diferimientos[]) satisface el subgate sin que el propio agente lo haya aprobado', () => {
  const path = require('path');
  const aprobacionPath = path.join(__dirname, '..', 'agents', 'diseno_aprobado.json');
  const original = fs.readFileSync(aprobacionPath, 'utf8');
  try {
    const firmaVigente = hashEstado(listarCarpetasAgentes());
    const conDiferimiento = {
      aprobado: true,
      origen: 'api_directa',
      firma: firmaVigente,
      timestamp: new Date().toISOString(),
      firmado_por: 'test de regresión',
      razones: ['fixture de test'],
      // Cita la ruta exacta del archivo del mandato (regla endurecida 2026-10-04).
      diferimientos: [{ subgate: '004_SENTINELA_FRONTEND', razon: 'public/src/App.jsx: prueba de regresión — no es un diferimiento real' }],
    };
    fs.writeFileSync(aprobacionPath, JSON.stringify(conDiferimiento, null, 2) + '\n', 'utf8');

    const resultado = validarSubgate('004_SENTINELA_FRONTEND', ['public/src/App.jsx']);
    assert.equal(resultado.aplica, true);
    assert.equal(resultado.aprobado, true, 'el diferimiento debe satisfacer el subgate aunque veredicto_004.json no exista');
    assert.equal(resultado.diferido, true, 'debe quedar marcado explícitamente como diferido, no como aprobación real del agente');
    assert.match(resultado.razon, /prueba de regresión/);
    assert.deepEqual(resultado.citadas, ['public/src/App.jsx']);
  } finally {
    fs.writeFileSync(aprobacionPath, original, 'utf8');
  }
});

test('validarSubgate: un diferimiento con justificación AJENA al mandato (caso real 002→005 citando render.yaml) se ignora y el subgate exige su veredicto', () => {
  const path = require('path');
  const aprobacionPath = path.join(__dirname, '..', 'agents', 'diseno_aprobado.json');
  const veredicto005 = SUBGATES['005_INGENIERO_BACKEND'].veredictoPath;
  const original = fs.readFileSync(aprobacionPath, 'utf8');
  const original005 = fs.existsSync(veredicto005) ? fs.readFileSync(veredicto005, 'utf8') : null;
  try {
    fs.writeFileSync(aprobacionPath, JSON.stringify({
      aprobado: true, origen: 'api_directa', firma: hashEstado(listarCarpetasAgentes()), timestamp: new Date().toISOString(),
      firmado_por: 'test de regresión', razones: ['fixture de test'],
      diferimientos: [{ subgate: '005_INGENIERO_BACKEND', razon: 'render.yaml omitido por presupuesto de caracteres; el ADR exige branch master' }],
    }, null, 2) + '\n', 'utf8');
    if (original005 !== null) fs.unlinkSync(veredicto005);

    const resultado = validarSubgate('005_INGENIERO_BACKEND', ['server.js', 'src/modules/radar/m1Pipeline.js', 'render.yaml']);
    assert.equal(resultado.aplica, true);
    assert.notEqual(resultado.diferido, true, 'render.yaml no es del mandato de 005: el diferimiento no aplica');
    assert.equal(resultado.aprobado, false, 'sin veredicto propio de 005 el commit queda bloqueado');
  } finally {
    fs.writeFileSync(aprobacionPath, original, 'utf8');
    if (original005 !== null) fs.writeFileSync(veredicto005, original005, 'utf8');
  }
});

test('diferimientoEnMandato: solo cuenta la cita exacta de un archivo staged del mandato', () => {
  const relevantes = ['server.js', 'src/modules/radar/m1Pipeline.js'];
  assert.deepEqual(diferimientoEnMandato({ razon: 'render.yaml omitido' }, relevantes), { valido: false, citadas: [] });
  assert.deepEqual(diferimientoEnMandato({ razon: 'hallazgo menor en src/modules/radar/m1Pipeline.js, no bloqueante' }, relevantes), { valido: true, citadas: ['src/modules/radar/m1Pipeline.js'] });
  assert.equal(diferimientoEnMandato({ razon: 'm1Pipeline.js sin ruta completa' }, relevantes).valido, false, 'el nombre suelto no basta');
  assert.equal(diferimientoEnMandato({}, relevantes).valido, false);
});

test('validarSubgate: un diferimiento para OTRO subgate distinto no satisface este', () => {
  const path = require('path');
  const aprobacionPath = path.join(__dirname, '..', 'agents', 'diseno_aprobado.json');
  const original = fs.readFileSync(aprobacionPath, 'utf8');
  try {
    const firmaVigente = hashEstado(listarCarpetasAgentes());
    const conDiferimiento = {
      aprobado: true,
      origen: 'api_directa',
      firma: firmaVigente,
      timestamp: new Date().toISOString(),
      firmado_por: 'test de regresión',
      razones: ['fixture de test'],
      diferimientos: [{ subgate: '003_ESP_DISENO_STITCH', razon: 'diferimiento de otro subgate, no de 004' }],
    };
    fs.writeFileSync(aprobacionPath, JSON.stringify(conDiferimiento, null, 2) + '\n', 'utf8');

    const resultado = validarSubgate('004_SENTINELA_FRONTEND', ['public/src/App.jsx']);
    assert.equal(resultado.diferido, undefined, '004 no debe leerse como diferido por un diferimiento que corresponde a 003');
  } finally {
    fs.writeFileSync(aprobacionPath, original, 'utf8');
  }
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

// "Circuit breaker" de alcance reducido (2026-08-16, diseño aprobado por 002):
// las 2 vigilancias existentes (rechazos consecutivos, agente desactualizado)
// ahora quedan escritas en el propio snapshot del PMU, no solo en un
// console.warn de terminal que se pierde.
test('generarEstadoOperativo: expone "alertas_activas" como arreglo, combinando analizarTelemetriaPMU() y verificarVigenciaAgentes()', () => {
  const estado = generarEstadoOperativo();
  assert.ok(Array.isArray(estado.alertas_activas), 'alertas_activas debe existir siempre, aunque esté vacío');
  // Tipos ampliados 2026-09-26 (ADR-0002): acuse de vigencia + mando del 001.
  const tiposValidos = ['rechazos_consecutivos', 'agente_desactualizado', 'agente_sin_acuse', 'agente_acuse_invalido', 'agente_sin_mando', 'alerta_git_inaccesible'];
  for (const alerta of estado.alertas_activas) {
    assert.ok(tiposValidos.includes(alerta.tipo), `tipo de alerta inesperado: ${alerta.tipo}`);
  }
  assert.ok(Array.isArray(estado.alertas_criticas_proveedor), 'alertas_criticas_proveedor debe existir siempre');
  assert.ok(estado.proveedor_ia && estado.proveedor_ia.circuit_breaker, 'proveedor_ia.circuit_breaker debe existir');
  // Formato real de key, no la subcadena (2026-10-04): el PMU incluye
  // veredictos reales y 006 citó en prosa "'nvapi-'" al comentar este mismo
  // test — mencionar el prefijo no es fugar una credencial.
  const serializado = JSON.stringify(estado);
  assert.ok(!/nvapi-[A-Za-z0-9_-]{8,}/.test(serializado), 'P6: el PMU nunca contiene una key NIM');
  assert.ok(!/sk-ant-[A-Za-z0-9_-]{8,}/.test(serializado), 'P6: el PMU nunca contiene una key Anthropic');
});

test('generarEstadoOperativo: se autoasegura (llama asegurarSubgatesAutoDescubiertos internamente) — 009 siempre reporta "subgate", nunca "sin_gate_propio" (regresión 2026-08-13)', () => {
  // Antes dependía de que el caller invocara asegurarSubgatesAutoDescubiertos()
  // primero — un contrato implícito no forzado, reproducido en vivo: llamar
  // a esta función directamente reportaba a 009 como "sin_gate_propio" pese
  // a tener un gate real declarado en su frontmatter.
  const estado = generarEstadoOperativo();
  const nueve = estado.agentes.find(a => a.archivo.includes('009-ingeniero-frontend'));
  assert.ok(nueve, '009 debe aparecer en el tablero (auto-descubierto)');
  assert.equal(nueve.gate, 'subgate', '009 debe reportar gate=subgate sin depender de una llamada previa externa');
  assert.equal(nueve.permiso_escritura, true);
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

test('bucketDe: gate-proveedor.cjs va con el gate y docs/ADR antes que docs/ (regresión 2026-09-26: 002 rechazó por dependencia no visible)', () => {
  assert.equal(bucketDe('agents/gate-proveedor.cjs'), bucketDe('agents/architecture-gate.cjs'));
  assert.ok(bucketDe('agents/gate-proveedor.cjs') < bucketDe('docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md'));
  assert.ok(bucketDe('docs/ADR/ADR-0002-gate-nim-circuit-breaker.md') < bucketDe('agents/gate-proveedor.cjs'), 'ADR (corto, alto valor) antes que el código del gate');
  assert.ok(bucketDe('docs/ADR/ADR-0002-gate-nim-circuit-breaker.md') < bucketDe('docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md'));
  assert.ok(bucketDe('docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md') < bucketDe('tests/gate/gate-proveedor.test.cjs'));
  assert.ok(bucketDe('tests/gate/gate-proveedor.test.cjs') < bucketDe('agents/pmu/telemetria.jsonl'));
  assert.ok(bucketDe('.claude/agents/002-arquitecto-de-software.md') < bucketDe('agents/gate-proveedor.cjs'));
});

test('parsearNameStatus: un git mv es UNA entrada con origen y similitud, no baja + alta (regresión 2026-10-08: 002 rechazó por "ruta inexistente")', () => {
  const salida = [
    'R100', 'projects/Radford-360/Proy_03 A Radar/IDENTITY.md', 'agents/dominio-radfor360/Proy_03 A Radar/IDENTITY.md',
    'R087', 'docs/viejo.md', 'docs/historico/viejo.md',
    'M', 'server.js',
    'D', 'scripts/core/motor_donaciones.js',
    'A', 'docs/con espacio ñ.md',
    '',
  ].join('\0');
  assert.deepEqual(parsearNameStatus(salida), [
    { estado: 'R', similitud: 100, origen: 'projects/Radford-360/Proy_03 A Radar/IDENTITY.md', archivo: 'agents/dominio-radfor360/Proy_03 A Radar/IDENTITY.md' },
    { estado: 'R', similitud: 87, origen: 'docs/viejo.md', archivo: 'docs/historico/viejo.md' },
    { estado: 'M', archivo: 'server.js' },
    { estado: 'D', archivo: 'scripts/core/motor_donaciones.js' },
    { estado: 'A', archivo: 'docs/con espacio ñ.md' },
  ]);
  assert.deepEqual(parsearNameStatus(''), []);
});

// --- Amarre al commit (2026-10-08): una aprobación cubre un solo commit ------

const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_0 = '0'.repeat(40);

test('parsearDiffRaw: lee estado, modo, blob y ruta (alta, baja, rutas con espacios); falla ruidosamente si no parsea', () => {
  const salida = [
    `:100644 100644 ${SHA_A} ${SHA_B} M`, 'server.js',
    `:000000 100644 ${SHA_0} ${SHA_A} A`, 'agents/dominio-radfor360/Proy_03 A Radar/PERMISSIONS.json',
    `:100644 000000 ${SHA_B} ${SHA_0} D`, 'config/firestore.rules',
    '',
  ].join('\0');
  assert.deepEqual(parsearDiffRaw(salida), [
    { estado: 'M', modo: '100644', blob: SHA_B, ruta: 'server.js' },
    { estado: 'A', modo: '100644', blob: SHA_A, ruta: 'agents/dominio-radfor360/Proy_03 A Radar/PERMISSIONS.json' },
    { estado: 'D', modo: '000000', blob: SHA_0, ruta: 'config/firestore.rules' },
  ]);
  assert.deepEqual(parsearDiffRaw(''), []);
  assert.throws(() => parsearDiffRaw('basura\0x\0'), /no parseable/);
});

test('huellaCambios: excluye solo artefactos del gate, no depende del orden, y cambia con 1 blob distinto', () => {
  const base = [
    { estado: 'M', modo: '100644', blob: SHA_A, ruta: 'server.js' },
    { estado: 'M', modo: '100644', blob: SHA_B, ruta: 'docs/x.md' },
  ];
  const conArtefactos = [...base,
    { estado: 'M', modo: '100644', blob: SHA_A, ruta: 'agents/diseno_aprobado.json' },
    { estado: 'M', modo: '100644', blob: SHA_A, ruta: 'agents/pmu/telemetria.jsonl' },
  ];
  const h = huellaCambios(base);
  assert.equal(h.archivos, 2);
  assert.equal(huellaCambios(conArtefactos).huella, h.huella, 'veredicto/PMU no entran en la huella');
  assert.equal(huellaCambios(base.slice().reverse()).huella, h.huella);
  assert.notEqual(huellaCambios([base[0], { ...base[1], blob: SHA_A }]).huella, h.huella);
  assert.equal(huellaCambios(conArtefactos.slice(2)).huella, null, 'solo artefactos del gate → nada que aprobar');
  // El código del gate SÍ entra: no es artefacto generado.
  assert.ok(!GENERADO_POR_GATE.test('agents/architecture-gate.cjs'));
  assert.ok(!GENERADO_POR_GATE.test('agents/dominio-radfor360/Proy_03 GP Radford-360/PERMISSIONS.json'));
});

test('validarAmarre: rechaza aprobación sin amarre, sobre otro HEAD o con otro contenido (regresión 410e113)', () => {
  const actual = { base_sha: SHA_A, huella: 'h1', archivos: 3 };
  assert.equal(validarAmarre({ base_sha: SHA_A, huella: 'h1', archivos: 3 }, actual).ok, true);
  assert.match(validarAmarre(null, actual).razon, /no está amarrada/);
  assert.match(validarAmarre({ base_sha: SHA_B, huella: 'h1' }, actual).razon, /un solo commit/);
  assert.match(validarAmarre({ base_sha: SHA_A, huella: 'h2', archivos: 2 }, actual).razon, /no es el que aprobó 002/);
  const soloGate = validarAmarre(null, { base_sha: SHA_A, huella: null, archivos: 0 });
  assert.equal(soloGate.ok, true);
  assert.equal(soloGate.soloArtefactosGate, true);
});

test('amarreStaged/amarreDeCommit: la huella del cambio staged es idéntica a la del commit hecho, y caduca en el siguiente (git real)', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-amarre-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'a.js'), 'uno\n');
    fs.mkdirSync(path.join(dir, 'sub dir'));
    fs.writeFileSync(path.join(dir, 'sub dir', 'b.md'), 'b\n');
    git('add', '-A'); git('commit', '-q', '-m', 'base');
    const padre = git('rev-parse', 'HEAD').trim();

    fs.writeFileSync(path.join(dir, 'a.js'), 'dos\n');
    fs.rmSync(path.join(dir, 'sub dir', 'b.md'));
    fs.writeFileSync(path.join(dir, 'nuevo.js'), 'n\n');
    fs.mkdirSync(path.join(dir, 'agents', 'pmu'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'agents', 'diseno_aprobado.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'agents', 'pmu', 'telemetria.jsonl'), '{}\n');
    git('add', '-A');
    const staged = amarreStaged(dir);
    assert.equal(staged.base_sha, padre);
    assert.equal(staged.archivos, 3, 'a.js, b.md (baja) y nuevo.js — sin artefactos del gate');

    git('commit', '-q', '-m', 'cambio');
    const hecho = amarreDeCommit('HEAD', dir);
    assert.equal(hecho.base_sha, padre);
    assert.equal(hecho.huella, staged.huella, 'pre-commit y post-commit deben sellar lo mismo');
    assert.equal(validarAmarre(staged, hecho).ok, true);

    // Siguiente commit con la MISMA aprobación: HEAD ya no es la base → rechazo.
    fs.writeFileSync(path.join(dir, 'a.js'), 'tres\n');
    git('add', '-A');
    assert.match(validarAmarre(staged, amarreStaged(dir)).razon, /un solo commit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bucketDe: fichas de agentes de dominio (IDENTITY/PERMISSIONS) antes que docs/ y que la telemetría (2026-10-08)', () => {
  const ficha = 'agents/dominio-radfor360/Proy_03 GP Radford-360/PERMISSIONS.json';
  assert.ok(bucketDe(ficha) < bucketDe('src/modules/radar/m1Pipeline.js'));
  assert.ok(bucketDe(ficha) < bucketDe('docs/historico/INFORME.md'));
  assert.ok(bucketDe(ficha) < bucketDe('agents/pmu/telemetria.jsonl'));
  assert.ok(bucketDe('agents/architecture-gate.cjs') < bucketDe(ficha));
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

test('SUBGATES 005: cubre src/modules/radar/ y src/shared/contracts/ (orden del dueño 2026-10-04)', () => {
  const relevantes = archivosRelevantesPara('005_INGENIERO_BACKEND', [
    'src/modules/radar/m1Pipeline.js',
    'src/modules/radar/m1Cache.js',
    'src/shared/contracts/Handoffs.js',
    'src/orchestrator-engine.js',
    'public/src/RadarApp.jsx',
    'docs/RADFOR360.pdf',
  ]);
  assert.deepEqual(relevantes.sort(), ['src/modules/radar/m1Cache.js', 'src/modules/radar/m1Pipeline.js', 'src/orchestrator-engine.js', 'src/shared/contracts/Handoffs.js']);
});

test('extraerJSONConCampo: JSON PRIMERO + análisis cortado por max_tokens con llaves sueltas → el veredicto sigue válido (2026-09-26)', () => {
  const texto = '{"aprobado": true, "razones": ["coherente"], "diferimientos": [{"subgate": "010", "razon": "sin specs"}]}\n\n' +
    '## Análisis\nEl bloque `if (x) {` del gate y un objeto {"otro": 1} de ejemplo, luego el corte por length a mitad de { frase';
  const v = extraerJSONConCampo(texto, 'aprobado');
  assert.equal(v.aprobado, true);
  assert.deepEqual(v.razones, ['coherente']);
  assert.equal(v.diferimientos[0].subgate, '010');
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

test('asegurarSubgatesAutoDescubiertos: 009_INGENIERO_FRONTEND se autoregistra desde su frontmatter y matchea los archivos reales que le competen (primera validación real del mecanismo Lego)', () => {
  asegurarSubgatesAutoDescubiertos();
  const cfg = SUBGATES['009_INGENIERO_FRONTEND'];
  assert.ok(cfg, '009 debe auto-registrarse desde su gate: en el frontmatter');
  assert.equal(cfg.campoAprobado, 'codigo_valido');
  const relevantes = archivosRelevantesPara('009_INGENIERO_FRONTEND', [
    'public/src/App.jsx', 'public/app.js', 'public/fase1-entrada.html',
    'src/modules/formulador/supabaseClient.js', 'server.js',
  ]);
  assert.deepEqual(relevantes.sort(), ['public/app.js', 'public/fase1-entrada.html', 'public/src/App.jsx']);
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

// Harness Engineering (orden explícita del usuario, 2026-08-13): validación de
// forma real de los veredictos de agente, no solo del campo de aprobación.
test('validarFormaVeredicto: 002 con "razones" como string suelto (no array) es RECHAZADO aunque aprobado:true', () => {
  const r = validarFormaVeredicto('002_ARQUITECTO_DE_SOFTWARE', { aprobado: true, razones: 'todo bien' });
  assert.equal(r.ok, false);
  assert.match(r.razon, /razones/);
});

test('validarFormaVeredicto: 002 con forma correcta es aceptado', () => {
  const r = validarFormaVeredicto('002_ARQUITECTO_DE_SOFTWARE', { aprobado: true, razones: ['verifiqué X', 'verifiqué Y'] });
  assert.equal(r.ok, true);
});

test('validarFormaVeredicto: 004 con un hallazgo sin campo "archivo" (contrato real de 004-sentinela-frontend.md) es RECHAZADO', () => {
  const r = validarFormaVeredicto('004_SENTINELA_FRONTEND', {
    limpio: false,
    hallazgos: [{ tipo: 'stub_huerfano', evidencia: 'sin fetch/useEffect' }],
  });
  assert.equal(r.ok, false);
  assert.match(r.razon, /archivo/);
});

test('validarFormaVeredicto: 005 con estado_backend fuera del enum real (aislado_y_seguro|brechas_detectadas|bloqueado_por_diseno) es RECHAZADO', () => {
  const r = validarFormaVeredicto('005_INGENIERO_BACKEND', { estado_backend: 'todo_ok', brechas_rls: 0, anomalias: [] });
  assert.equal(r.ok, false);
});

test('validarFormaVeredicto: agente sin contrato declarado en VEREDICTO_SCHEMAS no bloquea (compatibilidad)', () => {
  const r = validarFormaVeredicto('999_AGENTE_INEXISTENTE', { cualquier_cosa: true });
  assert.equal(r.ok, true);
});

// 010 agregado 2026-09-26 (PMU Titán V2): era el único subgate sin contrato.
test('VEREDICTO_SCHEMAS: cubre exactamente los agentes con veredicto JSON real hoy (002 + subgates 003/004/005/006/009/010)', () => {
  const claves = Object.keys(VEREDICTO_SCHEMAS).sort();
  assert.deepEqual(claves, [
    '002_ARQUITECTO_DE_SOFTWARE', '003_ESP_DISENO_STITCH', '004_SENTINELA_FRONTEND',
    '005_INGENIERO_BACKEND', '006_DEVSECOPS_INFRAESTRUCTURA', '009_INGENIERO_FRONTEND',
    '010_INGENIERO_QA_AUTOMATIZACION',
  ].sort());
});

test('validarFormaVeredicto: 002 sin diferimientos es válido (default vacío, compatibilidad con veredictos previos)', () => {
  const r = validarFormaVeredicto('002_ARQUITECTO_DE_SOFTWARE', { aprobado: true, razones: ['ok'] });
  assert.equal(r.ok, true);
});

test('validarFormaVeredicto: 002 con diferimientos bien formados es válido', () => {
  const r = validarFormaVeredicto('002_ARQUITECTO_DE_SOFTWARE', {
    aprobado: true, razones: ['ok'],
    diferimientos: [{ subgate: '004_SENTINELA_FRONTEND', razon: 'placeholder deliberado, ver §0-AH' }],
  });
  assert.equal(r.ok, true);
});

test('validarFormaVeredicto: 002 con un diferimiento sin campo "razon" es RECHAZADO', () => {
  const r = validarFormaVeredicto('002_ARQUITECTO_DE_SOFTWARE', {
    aprobado: true, razones: ['ok'],
    diferimientos: [{ subgate: '004_SENTINELA_FRONTEND' }],
  });
  assert.equal(r.ok, false);
});

// =============================================================================
// validarOrigenVeredicto — cierre de la brecha de procedencia (2026-08-16,
// §0-AJ.2): antes, un veredicto con la firma/hash correctos era aceptado sin
// verificar NADA sobre su origen. Regresión directa del hallazgo real: el
// veredicto vigente de esa fecha fue escrito a mano (canal Agent tool, sin
// saldo de API) e indistinguible para el gate de uno evaluado por la API.
// =============================================================================
test('validarOrigenVeredicto: sin campo "origen" es RECHAZADO por defecto (cierre de la brecha real)', () => {
  const r = validarOrigenVeredicto({ aprobado: true, firma: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.razon, /origen/);
});

test('validarOrigenVeredicto: origen "manual" (valor no reconocido) es RECHAZADO', () => {
  const r = validarOrigenVeredicto({ aprobado: true, firma: 'x', origen: 'manual' });
  assert.equal(r.ok, false);
});

test('validarOrigenVeredicto: origen "api_directa" es aceptado sin requerir excepcion', () => {
  const r = validarOrigenVeredicto({ aprobado: true, firma: 'x', origen: 'api_directa' });
  assert.equal(r.ok, true);
});

test('validarOrigenVeredicto: "excepcion_manual" sin objeto excepcion es RECHAZADO', () => {
  const r = validarOrigenVeredicto({ aprobado: true, firma: 'x', origen: 'excepcion_manual' });
  assert.equal(r.ok, false);
  assert.match(r.razon, /autorizado_por|excepcion/);
});

test('validarOrigenVeredicto: "excepcion_manual" con excepcion completa y vigente es aceptado', () => {
  const timestamp = new Date().toISOString();
  const expira = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const r = validarOrigenVeredicto({
    aprobado: true, firma: 'x', origen: 'excepcion_manual', timestamp,
    excepcion: { autorizado_por: 'usuario de prueba', motivo: 'fixture de test', expira },
  });
  assert.equal(r.ok, true);
  assert.equal(r.excepcionManual.autorizado_por, 'usuario de prueba');
});

test('validarOrigenVeredicto: "excepcion_manual" CADUCADA es RECHAZADA', () => {
  const timestamp = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
  const expiraEnElPasado = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
  const r = validarOrigenVeredicto({
    aprobado: true, firma: 'x', origen: 'excepcion_manual', timestamp,
    excepcion: { autorizado_por: 'x', motivo: 'y', expira: expiraEnElPasado },
  });
  assert.equal(r.ok, false);
  assert.match(r.razon, /caducad/);
});

test(`validarOrigenVeredicto: "excepcion_manual" que excede ${HORAS_MAX_EXCEPCION_MANUAL}h desde la firma es RECHAZADA (no se auto-extiende indefinidamente)`, () => {
  const timestamp = new Date().toISOString();
  const expiraDemasiadoLejos = new Date(Date.now() + (HORAS_MAX_EXCEPCION_MANUAL + 1) * 3600 * 1000).toISOString();
  const r = validarOrigenVeredicto({
    aprobado: true, firma: 'x', origen: 'excepcion_manual', timestamp,
    excepcion: { autorizado_por: 'x', motivo: 'y', expira: expiraDemasiadoLejos },
  });
  assert.equal(r.ok, false);
  assert.match(r.razon, /máximo permitido/);
});

test('ORIGENES_VALIDOS: expone exactamente api_directa, excepcion_manual y soft_fail_api', () => {
  assert.deepEqual([...ORIGENES_VALIDOS].sort(), ['api_directa', 'excepcion_manual', 'soft_fail_api']);
});

// Integración: validarDisenoAprobado()/validarSubgate() de verdad rechazan un
// veredicto sin origen, aunque forma y hash sean correctos — mismo patrón de
// mutación del archivo real con try/finally que el resto de este archivo.
test('validarDisenoAprobado: veredicto con firma/hash correctos pero SIN "origen" es RECHAZADO (regresión de la brecha real)', () => {
  const path = require('path');
  const aprobacionPath = path.join(__dirname, '..', 'agents', 'diseno_aprobado.json');
  const original = fs.readFileSync(aprobacionPath, 'utf8');
  try {
    const firmaVigente = hashEstado(listarCarpetasAgentes());
    fs.writeFileSync(aprobacionPath, JSON.stringify({
      aprobado: true, firma: firmaVigente, timestamp: new Date().toISOString(),
      firmado_por: 'test de regresión', razones: ['fixture sin origen'],
    }, null, 2) + '\n', 'utf8');

    const resultado = validarDisenoAprobado(listarCarpetasAgentes());
    assert.equal(resultado.aprobado, false, 'un veredicto sin "origen" no debe aprobar, aunque la firma coincida con el hash real');
    assert.match(resultado.razon, /origen/);
  } finally {
    fs.writeFileSync(aprobacionPath, original, 'utf8');
  }
});

test('validarSubgate: veredicto de subgate con firma correcta pero SIN "origen" es RECHAZADO', () => {
  const path = require('path');
  const veredictoPath = SUBGATES['004_SENTINELA_FRONTEND'].veredictoPath;
  const existiaAntes = fs.existsSync(veredictoPath);
  const original = existiaAntes ? fs.readFileSync(veredictoPath, 'utf8') : null;
  try {
    const relevantes = ['public/src/App.jsx'];
    // hashArchivosStaged() lee 'git show :archivo' — no depende de que el
    // archivo exista en disco de la misma forma que el resto de la prueba;
    // se calcula la firma real para que el único motivo de rechazo posible
    // sea la ausencia de "origen", no un hash desalineado.
    const { execFileSync } = require('child_process');
    const crypto = require('crypto');
    let contenido;
    try {
      contenido = execFileSync('git', ['show', ':public/src/App.jsx'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    } catch (e) {
      contenido = '';
    }
    const firma = crypto.createHash('sha256').update(`public/src/App.jsx:${crypto.createHash('sha256').update(contenido).digest('hex')}`).digest('hex');
    fs.writeFileSync(veredictoPath, JSON.stringify({
      aprobado: true, firma, timestamp: new Date().toISOString(),
      firmado_por: 'test de regresión', veredictoCompleto: {},
    }, null, 2) + '\n', 'utf8');

    const resultado = validarSubgate('004_SENTINELA_FRONTEND', relevantes);
    assert.equal(resultado.aplica, true);
    assert.equal(resultado.aprobado, false, 'un veredicto de subgate sin "origen" no debe aprobar');
    assert.match(resultado.razon, /origen/);
  } finally {
    if (existiaAntes) fs.writeFileSync(veredictoPath, original, 'utf8');
    else fs.rmSync(veredictoPath, { force: true });
  }
});

// =============================================================================
// SUBGATES['006_DEVSECOPS_INFRAESTRUCTURA'] — cierre del "gate fantasma"
// (§0-AJ.3): el frontmatter de 006 declaraba gate sobre .github/workflows/**
// y scripts/*gate*/*veto*.cjs, pero la entrada hardcodeada previa nunca
// cubría esos patrones — asegurarSubgatesAutoDescubiertos() nunca pisa una
// entrada ya definida a mano, así que ese gate declarado NUNCA se registraba.
// =============================================================================
test('SUBGATES 006: ahora SÍ cubre .github/workflows/*.yml (antes del fix, 0 patrones lo cubrían)', () => {
  const relevantes = archivosRelevantesPara('006_DEVSECOPS_INFRAESTRUCTURA', ['.github/workflows/gate.yml', 'README.md']);
  assert.deepEqual(relevantes, ['.github/workflows/gate.yml']);
});

test('SUBGATES 006: ahora SÍ cubre scripts/*gate*.cjs y scripts/*veto*.cjs', () => {
  const relevantes = archivosRelevantesPara('006_DEVSECOPS_INFRAESTRUCTURA', [
    'scripts/check_veto_008.cjs', 'scripts/auditor_008_advisory_gate.cjs', 'scripts/db-check.js',
  ]);
  assert.deepEqual(relevantes.sort(), ['scripts/auditor_008_advisory_gate.cjs', 'scripts/check_veto_008.cjs']);
});

test('SUBGATES 006: sigue cubriendo render.yaml/.env.example/package*.json (patrones originales, no removidos por el fix)', () => {
  const relevantes = archivosRelevantesPara('006_DEVSECOPS_INFRAESTRUCTURA', ['render.yaml', '.env.example', 'package.json', 'package-lock.json']);
  assert.equal(relevantes.length, 4);
});

// =============================================================================
// SOFT-FAIL DE API (2026-09-25) — la falta de saldo/disponibilidad de la API
// no bloquea el commit, pero solo con opt-in + responsable, y nunca convierte
// un rechazo real ni un error de configuración en aprobación.
// =============================================================================
const Anthropic = require('@anthropic-ai/sdk');
const errorApi = (status, mensaje) => Anthropic.APIError.generate(status, { error: { type: 'x', message: mensaje } }, mensaje, { get: () => 'req_test' });

test('clasificarFalloApi: 402, 429, 529, 5xx, 400 "credit balance is too low" y sin conexión SÍ son fallo de disponibilidad', () => {
  assert.equal(clasificarFalloApi(errorApi(402, 'payment required')).codigo, 'http_402_sin_saldo');
  assert.equal(clasificarFalloApi(errorApi(400, 'Your credit balance is too low to access the Anthropic API')).codigo, 'http_400_sin_saldo');
  assert.equal(clasificarFalloApi(errorApi(429, 'rate limited')).codigo, 'http_429_rate_limit');
  assert.equal(clasificarFalloApi(errorApi(529, 'overloaded')).codigo, 'http_529_sobrecargada');
  assert.equal(clasificarFalloApi(errorApi(503, 'unavailable')).codigo, 'http_503');
  assert.equal(clasificarFalloApi(new Anthropic.APIConnectionTimeoutError()).codigo, 'sin_respuesta');
  assert.equal(clasificarFalloApi(errorApi(402, 'x')).request_id, 'req_test');
});

test('clasificarFalloApi: 400 genérico, 401 y errores no-API NO son soft-fail (bloqueo duro)', () => {
  assert.equal(clasificarFalloApi(errorApi(400, 'invalid request')), null);
  assert.equal(clasificarFalloApi(errorApi(401, 'invalid x-api-key')), null);
  assert.equal(clasificarFalloApi(new TypeError('boom')), null);
});

test('resolverPermisoSoftFail: sin opt-in NO está permitido', () => {
  const r = resolverPermisoSoftFail(['node', 'gate', '--aprobar-diseno'], {});
  assert.equal(r.permitido, false);
});

test('resolverPermisoSoftFail: opt-in sin responsable NO está permitido', () => {
  assert.equal(resolverPermisoSoftFail(['node', 'gate', '--permitir-soft-fail'], {}).permitido, false);
  assert.equal(resolverPermisoSoftFail(['node', 'gate'], { GATE_SOFT_FAIL: 'true' }).permitido, false);
});

test('resolverPermisoSoftFail: flag + --autorizado-por, o env completo, SÍ está permitido', () => {
  const porFlag = resolverPermisoSoftFail(['node', 'gate', '--permitir-soft-fail', '--autorizado-por', 'Jairo'], {});
  assert.equal(porFlag.permitido, true);
  assert.equal(porFlag.autorizadoPor, 'Jairo');
  assert.equal(porFlag.via, 'flag');
  const porEnv = resolverPermisoSoftFail(['node', 'gate'], { GATE_SOFT_FAIL: 'true', GATE_SOFT_FAIL_AUTORIZADO_POR: 'Jairo' });
  assert.equal(porEnv.permitido, true);
  assert.equal(porEnv.via, 'env');
});

test('resolverPermisoSoftFail: ANTHROPIC_BASE_URL no oficial lo DESHABILITA aunque haya opt-in', () => {
  const env = { GATE_SOFT_FAIL: 'true', GATE_SOFT_FAIL_AUTORIZADO_POR: 'Jairo', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' };
  const r = resolverPermisoSoftFail(['node', 'gate'], env);
  assert.equal(r.permitido, false);
  assert.match(r.razon, /ANTHROPIC_BASE_URL/);
  assert.equal(resolverPermisoSoftFail(['node', 'gate'], { ...env, ANTHROPIC_BASE_URL: 'https://api.anthropic.com/' }).permitido, true);
});

test('validarOrigenVeredicto: soft_fail_api completo es aceptado; sin autorizado_por o con diferimientos es RECHAZADO', () => {
  const permiso = { autorizadoPor: 'Jairo', via: 'env' };
  const registro = construirRegistroSoftFail('x', { codigo: 'http_402_sin_saldo', detalle: 'd', request_id: null }, permiso, '002');
  const ok = validarOrigenVeredicto(registro);
  assert.equal(ok.ok, true);
  assert.equal(ok.softFail.autorizado_por, 'Jairo');
  assert.equal(validarOrigenVeredicto({ ...registro, soft_fail: { codigo: 'http_402_sin_saldo' } }).ok, false);
  assert.equal(validarOrigenVeredicto({ ...registro, diferimientos: [{ subgate: '003', razon: 'r' }] }).ok, false);
});

test('validarDisenoAprobado: soft_fail_api con firma vigente aprueba con diferimientos [] y se invalida si el estado cambia', () => {
  const aprobacionPath = path.join(__dirname, '..', 'agents', 'diseno_aprobado.json');
  const original = fs.existsSync(aprobacionPath) ? fs.readFileSync(aprobacionPath, 'utf8') : null;
  try {
    const permiso = { autorizadoPor: 'Jairo', via: 'env' };
    const vigente = construirRegistroSoftFail(hashEstado(listarCarpetasAgentes()), { codigo: 'http_402_sin_saldo', detalle: 'd' }, permiso, '002');
    fs.writeFileSync(aprobacionPath, JSON.stringify(vigente), 'utf8');
    const r = validarDisenoAprobado(listarCarpetasAgentes());
    assert.equal(r.aprobado, true);
    assert.equal(r.origen, 'soft_fail_api');
    assert.deepEqual(r.diferimientos, []);

    fs.writeFileSync(aprobacionPath, JSON.stringify({ ...vigente, firma: 'firma-de-otro-estado' }), 'utf8');
    assert.equal(validarDisenoAprobado(listarCarpetasAgentes()).aprobado, false);
  } finally {
    if (original === null) fs.rmSync(aprobacionPath, { force: true });
    else fs.writeFileSync(aprobacionPath, original, 'utf8');
  }
});

test('evidenciaE2E (010): adjunta la última corrida real de Playwright y si es posterior a los specs staged; nunca fabrica un pass', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lastrun-'));
  const ruta = path.join(dir, '.last-run.json');
  const spec = ['tests/e2e/formulario-fase1.spec.js'];
  const evidencia = (texto) => JSON.parse(texto.match(/\.last-run\.json\): (\{.*\})/)[1]);

  fs.writeFileSync(ruta, JSON.stringify({ status: 'passed', failedTests: [] }));
  const reciente = evidencia(evidenciaE2E(spec, ruta));
  assert.equal(reciente.status, 'passed');
  assert.equal(reciente.posterior_a_specs_staged, true);

  fs.utimesSync(ruta, new Date('2020-01-01'), new Date('2020-01-01'));
  assert.equal(evidencia(evidenciaE2E(spec, ruta)).posterior_a_specs_staged, false, 'corrida anterior al cambio no cuenta');

  fs.writeFileSync(ruta, JSON.stringify({ status: 'failed', failedTests: ['x'] }));
  assert.equal(evidencia(evidenciaE2E(spec, ruta)).status, 'failed');

  assert.equal(evidencia(evidenciaE2E(spec, path.join(dir, 'no-existe.json'))).status, 'sin_evidencia');
  assert.match(evidenciaE2E(spec, ruta), /"pass" solo si status es "passed" y posterior_a_specs_staged es true/);
});
