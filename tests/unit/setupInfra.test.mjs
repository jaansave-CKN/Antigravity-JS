/**
 * setupInfra.test.mjs — asistente de configuración (scripts/setup-infra.mjs).
 * Funciones de validación y escritura de .env. Sin red: fetch y cliente S3
 * simulados. Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEnv, actualizarEnv, enmascarar, validarDsnSentry, validarUrlWebhook,
  clasificarWompi, validarWompiPublica, validarGemini, validarAws, evaluarGrupo, GRUPOS,
} from '../../scripts/setup-infra.mjs';

const WOMPI_PROD = { publica: 'pub_prod_abc123', privada: 'prv_prod_def456', eventos: 'prod_events_ghi789', integridad: 'prod_integrity_jkl012' };
const respuesta = (status, cuerpo) => ({ status, json: async () => cuerpo });

test('parseEnv: comillas, comentarios y espacios', () => {
  const m = parseEnv('# comentario\nA=1\nB="con espacio"\n  C = \'x\'\nmal linea\nD=');
  assert.equal(m.get('A'), '1');
  assert.equal(m.get('B'), 'con espacio');
  assert.equal(m.get('C'), 'x');
  assert.equal(m.get('D'), '');
  assert.equal(m.size, 4);
});

test('actualizarEnv: reemplaza en su sitio, añade al final, conserva comentarios y CRLF', () => {
  const antes = '# cabecera\r\nGOOGLE_API_KEY=vieja\r\nOTRA=1\r\n';
  const despues = actualizarEnv(antes, { GOOGLE_API_KEY: 'nueva', PAYMENT_PROVIDER: 'wompi', ERROR_WEBHOOK_URL: 'https://h/x y' }, new Date('2026-09-24T12:00:00Z'));
  assert.equal(despues, '# cabecera\r\nGOOGLE_API_KEY=nueva\r\nOTRA=1\r\n\r\n# setup-infra.mjs — 2026-09-24\r\nPAYMENT_PROVIDER=wompi\r\nERROR_WEBHOOK_URL="https://h/x y"\r\n');
  assert.equal(parseEnv(despues).get('ERROR_WEBHOOK_URL'), 'https://h/x y', 'ida y vuelta sin pérdida');
});

test('enmascarar: nunca contiene el cuerpo del secreto', () => {
  const secreto = 'prv_prod_SuperSecreto987654321';
  const salida = enmascarar(secreto);
  assert.match(salida, /^prv_prod_/);
  assert.doesNotMatch(salida, /SuperSecreto/);
  assert.match(salida, /\(30 car\.\)/);
  assert.equal(enmascarar(''), '(vacía)');
  assert.doesNotMatch(enmascarar('wJalrXUtnFEMI/K7MDENG'), /wJal/, 'sin prefijo conocido no revela nada');
});

test('Sentry DSN y webhook: estructura', () => {
  assert.equal(validarDsnSentry('https://0123456789abcdef0123456789abcdef@o123.ingest.sentry.io/456').ok, true);
  assert.equal(validarDsnSentry('http://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/4').ok, false);
  assert.equal(validarDsnSentry('https://o1.ingest.sentry.io/4').ok, false);
  assert.equal(validarDsnSentry('https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/abc').ok, false);
  assert.equal(validarDsnSentry('no-es-url').ok, false);
  assert.equal(validarUrlWebhook('https://hooks.slack.com/services/T/B/X').ok, true);
  assert.equal(validarUrlWebhook('http://hooks.slack.com/x').ok, false);
});

test('Wompi: prefijos oficiales y un solo ambiente', () => {
  assert.deepEqual(clasificarWompi(WOMPI_PROD), { ok: true, ambiente: 'prod', errores: [] });
  const mezcla = clasificarWompi({ ...WOMPI_PROD, privada: 'prv_test_x' });
  assert.equal(mezcla.ok, false);
  assert.match(mezcla.errores.join(), /mezcla/);
  const malPrefijo = clasificarWompi({ ...WOMPI_PROD, eventos: 'events_prod_x' });
  assert.match(malPrefijo.errores.join(), /WOMPI_EVENTS_SECRET/);
});

test('Wompi en vivo: producción vs sandbox y comercio inexistente', async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return respuesta(200, { data: { name: 'RadFor SAS' } }); };
  const r = await validarWompiPublica('pub_prod_abc', fake);
  assert.equal(r.ok, true);
  assert.match(r.detalle, /RadFor SAS.*PRODUCCIÓN/);
  await validarWompiPublica('pub_test_abc', fake);
  assert.deepEqual(urls, ['https://production.wompi.co/v1/merchants/pub_prod_abc', 'https://sandbox.wompi.co/v1/merchants/pub_test_abc']);
  assert.equal((await validarWompiPublica('pub_prod_x', async () => respuesta(404, {}))).ok, false);
});

test('Gemini: llave en cabecera (nunca en la URL), modelo requerido y rechazo', async () => {
  let peticion;
  const ok = await validarGemini('AIzaLLAVE', async (url, init) => { peticion = { url, init }; return respuesta(200, { models: [{ name: 'models/gemini-3.6-flash' }, { name: 'models/otro' }] }); });
  assert.equal(ok.ok, true);
  assert.doesNotMatch(peticion.url, /AIzaLLAVE/);
  assert.equal(peticion.init.headers['x-goog-api-key'], 'AIzaLLAVE');
  assert.equal((await validarGemini('k', async () => respuesta(200, { models: [{ name: 'models/otro' }] }))).ok, false);
  const mala = await validarGemini('k', async () => respuesta(400, { error: { status: 'INVALID_ARGUMENT' } }));
  assert.equal(mala.ok, false);
  assert.match(mala.detalle, /INVALID_ARGUMENT/);
});

test('AWS: AccessDenied es ÉXITO con la política mínima; el resto se diagnostica', async () => {
  const cliente = (err) => async () => ({ listar: async () => { if (err) { const e = new Error(err); e.name = err; throw e; } return {}; } });
  const base = { accessKeyId: 'AKIAX', secretAccessKey: 's', bucket: 'rf360-backups', region: 'us-east-1' };
  assert.equal((await validarAws(base, cliente('AccessDenied'))).ok, true);
  const amplia = await validarAws(base, cliente(null));
  assert.equal(amplia.ok, true);
  assert.match(amplia.detalle, /más amplia/);
  for (const [codigo, texto] of [['NoSuchBucket', /NO existe/], ['InvalidAccessKeyId', /no existe en AWS/], ['SignatureDoesNotMatch', /SECRET/], ['PermanentRedirect', /región/]]) {
    const r = await validarAws(base, cliente(codigo));
    assert.equal(r.ok, false, codigo);
    assert.match(r.detalle, texto);
  }
});

test('evaluarGrupo: sin nada = PENDIENTE; incompleto = FALLO; la región por defecto no cuenta', async () => {
  const aws = GRUPOS.find(g => g.id === 'aws');
  const alertas = GRUPOS.find(g => g.id === 'alertas');
  assert.equal((await evaluarGrupo(aws, {})).estado, 'PENDIENTE');
  assert.equal((await evaluarGrupo(aws, { AWS_REGION: 'us-east-1' })).estado, 'PENDIENTE');
  const parcial = await evaluarGrupo(aws, { AWS_ACCESS_KEY_ID: 'AKIAX' });
  assert.equal(parcial.estado, 'FALLO');
  assert.match(parcial.detalle, /AWS_SECRET_ACCESS_KEY.*AWS_S3_BUCKET/);
  assert.equal((await evaluarGrupo(alertas, {})).estado, 'PENDIENTE');
  assert.equal((await evaluarGrupo(alertas, { ERROR_WEBHOOK_URL: 'https://hooks.slack.com/x' })).estado, 'OK');
});

test('Wompi fija PAYMENT_PROVIDER=wompi (por defecto la app usa stripe)', () => {
  assert.deepEqual(GRUPOS.find(g => g.id === 'wompi').extra, { PAYMENT_PROVIDER: 'wompi' });
});

// ── --desde-archivo ──────────────────────────────────────────────────────────
import { extraerCredenciales } from '../../scripts/setup-infra.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('extraerCredenciales: formatos, alias, BOM, comillas y lo que se ignora', () => {
  const texto = '\uFEFF# mis claves\nAWS_S3_BUCKET: rf360-backups\nexport AWS_REGION="us-east-2"\nWOMPI_PUB_TEST=pub_test_1\ngemini_api_key = AIzaX\nNota: llamar a soporte\nOTRA_COSA=1\nAWS_BOOTSTRAP_ACCESS_KEY_ID=AKIAADMIN\nVACIA=\n';
  const r = extraerCredenciales(texto);
  assert.deepEqual(r.valores, { AWS_S3_BUCKET: 'rf360-backups', AWS_REGION: 'us-east-2', WOMPI_PUBLIC_KEY: 'pub_test_1', GOOGLE_API_KEY: 'AIzaX' });
  assert.deepEqual(r.alias, [['WOMPI_PUB_TEST', 'WOMPI_PUBLIC_KEY'], ['GEMINI_API_KEY', 'GOOGLE_API_KEY']]);
  assert.equal(r.bootstrap, true, 'las credenciales de administrador se rechazan');
  assert.ok(!Object.values(r.valores).includes('AKIAADMIN'));
  assert.deepEqual(r.ignoradas, ['OTRA_COSA'], '"Nota" no es un nombre de variable');
});

test('extraerCredenciales: una clave repetida con valores distintos se descarta (no se adivina)', () => {
  const r = extraerCredenciales('GOOGLE_API_KEY=uno\nGEMINI_API_KEY=dos\nAWS_S3_BUCKET=b\nAWS_S3_BUCKET=b');
  assert.deepEqual(r.conflictos, ['GOOGLE_API_KEY']);
  assert.equal(r.valores.GOOGLE_API_KEY, undefined);
  assert.equal(r.valores.AWS_S3_BUCKET, 'b', 'repetida con el MISMO valor no es conflicto');
});

test('--desde-archivo (script real, sin red): guarda solo grupos válidos, respalda y no imprime secretos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rf360-setup-'));
  const envPath = join(dir, '.env');
  const credPath = join(dir, 'claves_privadas-prueba.txt');
  writeFileSync(envPath, 'EXISTENTE=se_conserva\n');
  const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SecretoWebhook123';
  writeFileSync(credPath, [
    `ERROR_WEBHOOK_URL=${WEBHOOK}`,
    'WOMPI_PUBLIC_KEY=clave_sin_prefijo_valido_987', // falla antes de tocar la red
    'WOMPI_PRIVATE_KEY=prv_prod_PrivadaMuySecreta555',
    'AWS_BOOTSTRAP_SECRET_ACCESS_KEY=AdminSecretoNoUsar',
  ].join('\n'));
  const script = fileURLToPath(new URL('../../scripts/setup-infra.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--desde-archivo', credPath], {
    env: { ...process.env, SETUP_INFRA_ENV_PATH: envPath }, encoding: 'utf8',
  });
  const salida = r.stdout + r.stderr;
  assert.equal(r.status, 1, 'Wompi falla → código 1');
  for (const secreto of ['SecretoWebhook123', 'PrivadaMuySecreta555', 'AdminSecretoNoUsar']) assert.doesNotMatch(salida, new RegExp(secreto));
  const env = readFileSync(envPath, 'utf8');
  assert.match(env, /EXISTENTE=se_conserva/);
  assert.ok(env.includes(`ERROR_WEBHOOK_URL=${WEBHOOK}`), 'alertas válidas → guardadas');
  assert.doesNotMatch(env, /WOMPI_|PAYMENT_PROVIDER|Admin/, 'grupo inválido y bootstrap → no se escriben');
  assert.ok(readdirSync(dir).some(f => f.startsWith('.env.backup-')), 'copia de seguridad creada');
  assert.match(salida, /AWS_BOOTSTRAP_\* ignoradas/);
});

test('NVIDIA (Fase 3): solo formato nvapi-…, y el prefijo se muestra sin revelar la llave', async () => {
  const { validarLlaveNvidia, enmascarar: enm } = await import('../../scripts/setup-infra.mjs');
  assert.equal(validarLlaveNvidia('nvapi-AbCdEfGhIjKlMnOpQrStUvWxYz0123').ok, true);
  assert.equal(validarLlaveNvidia('sk-otra-cosa').ok, false);
  assert.equal(validarLlaveNvidia('').ok, false);
  const m = enm('nvapi-SecretoSecretoSecreto123');
  assert.match(m, /^nvapi-/);
  assert.doesNotMatch(m, /Secreto/);
});
