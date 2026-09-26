#!/usr/bin/env node
/**
 * setup-infra.mjs — Asistente de configuración de credenciales externas de
 * RadFor-360 (AWS S3, Wompi, Gemini, alertas Sentry/webhook).
 *
 * Uso (en SU terminal — necesita teclado para las preguntas):
 *   node scripts/setup-infra.mjs                 interactivo: pide, valida en vivo y escribe .env
 *   node scripts/setup-infra.mjs --verificar     solo valida lo que ya hay en .env (no pregunta ni escribe)
 *   node scripts/setup-infra.mjs --subir-github  además ofrece subir los AWS_* validados a GitHub Secrets
 *   node scripts/setup-infra.mjs --desde-archivo <ruta>
 *        sin preguntas: toma las credenciales de un archivo (KEY=valor o KEY: valor),
 *        valida cada grupo en vivo y escribe en .env SOLO los grupos que pasan.
 *        Combinable con --subir-github (en ese caso sí pregunta antes de subir).
 *
 * Garantías:
 *   - Los secretos se escriben sin eco (se ve "*") y NUNCA se imprimen: solo
 *     su prefijo público (pub_prod_, AKIA…) y su longitud.
 *   - Antes de escribir, copia .env a .env.backup-AAAAMMDD-HHMMSS y comprueba
 *     con `git check-ignore` que ambos archivos estén fuera del control de
 *     versiones (el repo es PÚBLICO). Si no lo están, no escribe nada.
 *   - Todas las validaciones son de solo lectura contra cada proveedor.
 *
 * Nombres de variable = los que lee el código real (no otros):
 *   AWS_*       → backend/scripts/s3backup.js y .github/workflows/backup-s3.yml
 *   WOMPI_*     → backend/payments/wompiProvider.js, backend/routes/wompi.webhook.js
 *   PAYMENT_PROVIDER=wompi → backend/payments/index.js (por defecto es 'stripe':
 *                 sin esto las llaves de Wompi quedarían guardadas pero sin uso)
 *   SENTRY_DSN  → backend/config/sentry.config.js
 *   ERROR_WEBHOOK_URL → backend/services/logService.js
 */
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// SETUP_INFRA_ENV_PATH: solo para pruebas (escribir en un .env temporal).
const RUTA_ENV = process.env.SETUP_INFRA_ENV_PATH ? resolve(process.env.SETUP_INFRA_ENV_PATH) : resolve(RAIZ, '.env');

// ── Utilidades puras (exportadas para pruebas) ───────────────────────────────

/** Lee un .env a Map. Respeta comentarios y comillas simples/dobles. */
export function parseEnv(texto) {
  const mapa = new Map();
  for (const linea of String(texto).split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    mapa.set(m[1], v);
  }
  return mapa;
}

const formatearValor = (v) => (/[\s#"'`$\\]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v);

/** Aplica cambios {CLAVE: valor} a un .env: reemplaza la línea existente o la añade al final. */
export function actualizarEnv(texto, cambios, fecha = new Date()) {
  const eol = String(texto).includes('\r\n') ? '\r\n' : '\n';
  const lineas = String(texto).split(/\r?\n/);
  const pendientes = new Map(Object.entries(cambios));
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && pendientes.has(m[1])) {
      lineas[i] = `${m[1]}=${formatearValor(pendientes.get(m[1]))}`;
      pendientes.delete(m[1]);
    }
  }
  if (pendientes.size) {
    while (lineas.length && lineas[lineas.length - 1] === '') lineas.pop();
    lineas.push('', `# setup-infra.mjs — ${fecha.toISOString().slice(0, 10)}`);
    for (const [k, v] of pendientes) lineas.push(`${k}=${formatearValor(v)}`);
  }
  return lineas.join(eol).replace(new RegExp(`(${eol})*$`), '') + eol;
}

const PREFIJOS_PUBLICOS = /^(nvapi-|pub_prod_|pub_test_|prv_prod_|prv_test_|prod_events_|test_events_|prod_integrity_|test_integrity_|AKIA|ASIA|AIza)/;

/** Representación segura de un secreto: solo prefijo público conocido + longitud. */
export function enmascarar(valor) {
  if (!valor) return '(vacía)';
  const prefijo = String(valor).match(PREFIJOS_PUBLICOS)?.[0] ?? '';
  return `${prefijo}${'•'.repeat(4)} (${String(valor).length} car.)`;
}

/** DSN de Sentry: https://<clave_publica>@<host>/<id_proyecto> */
export function validarDsnSentry(dsn) {
  let u;
  try { u = new URL(dsn); } catch { return { ok: false, detalle: 'no es una URL válida' }; }
  if (u.protocol !== 'https:') return { ok: false, detalle: 'debe empezar por https://' };
  if (!/^[0-9a-f]{32}$/i.test(u.username)) return { ok: false, detalle: 'falta la clave pública (32 hex) antes de la @' };
  if (!/^\/\d+$/.test(u.pathname)) return { ok: false, detalle: 'debe terminar en /<id_de_proyecto numérico>' };
  return { ok: true, detalle: `proyecto ${u.pathname.slice(1)} en ${u.host}` };
}

export function validarUrlWebhook(url) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, detalle: 'no es una URL válida' }; }
  if (u.protocol !== 'https:') return { ok: false, detalle: 'debe ser https://' };
  return { ok: true, detalle: `https://${u.host}/… (no se envía ningún mensaje de prueba)` };
}

/** Prefijos oficiales de Wompi (docs.wompi.co/ambientes-y-llaves) y coherencia de ambiente. */
export function clasificarWompi({ publica, privada, eventos, integridad }) {
  const reglas = [
    ['WOMPI_PUBLIC_KEY', publica, /^pub_(prod|test)_/],
    ['WOMPI_PRIVATE_KEY', privada, /^prv_(prod|test)_/],
    ['WOMPI_EVENTS_SECRET', eventos, /^(prod|test)_events_/],
    ['WOMPI_INTEGRITY_SECRET', integridad, /^(prod|test)_integrity_/],
  ];
  const errores = [];
  const ambientes = new Set();
  for (const [nombre, valor, re] of reglas) {
    const m = String(valor || '').match(re);
    if (!m) { errores.push(`${nombre}: prefijo inválido (se espera ${re.source.replace(/\\|\^/g, '')})`); continue; }
    ambientes.add(m[1]);
  }
  if (ambientes.size > 1) errores.push('mezcla llaves de PRODUCCIÓN y de PRUEBA — deben ser todas del mismo ambiente');
  const ambiente = ambientes.size === 1 ? [...ambientes][0] : null;
  return { ok: errores.length === 0, ambiente, errores };
}

/**
 * NVIDIA NIM (Fase 3, Formulador MGA): solo se valida el FORMATO. El listado
 * de modelos de NIM es público (responde igual con cualquier llave), así que
 * no prueba nada; la validez real se comprueba en la primera consolidación
 * (una llave rechazada queda como motivo 'llave_rechazada', visible en la UI).
 */
export function validarLlaveNvidia(llave) {
  return /^nvapi-[A-Za-z0-9_-]{20,}$/.test(String(llave || ''))
    ? { ok: true, detalle: 'formato válido (nvapi-…); la validez real se comprueba en la primera consolidación MGA' }
    : { ok: false, detalle: 'no tiene el formato de una llave de NVIDIA (debe empezar por nvapi-)' };
}

// ── Validaciones en vivo (solo lectura) ──────────────────────────────────────

/** Wompi: GET /v1/merchants/<llave_pública> — endpoint público, no mueve dinero. */
export async function validarWompiPublica(publica, fetchImpl = fetch) {
  const base = publica.startsWith('pub_prod_') ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1';
  try {
    const r = await fetchImpl(`${base}/merchants/${encodeURIComponent(publica)}`, { signal: AbortSignal.timeout(15_000) });
    if (r.status !== 200) return { ok: false, detalle: `Wompi respondió HTTP ${r.status} — la llave pública no corresponde a un comercio` };
    const data = (await r.json())?.data ?? {};
    return { ok: true, detalle: `comercio "${data.name || data.legal_name || '¿sin nombre?'}" (${publica.startsWith('pub_prod_') ? 'PRODUCCIÓN' : 'SANDBOX'})` };
  } catch (e) {
    return { ok: false, detalle: `sin conexión con Wompi (${e.name})` };
  }
}

/** Gemini: listado de modelos — valida la llave sin gastar cuota de generación. */
export async function validarGemini(llave, fetchImpl = fetch) {
  try {
    const r = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': llave }, // en cabecera, nunca en la URL (acabaría en logs)
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status !== 200) {
      const motivo = (await r.json().catch(() => ({})))?.error?.status || `HTTP ${r.status}`;
      return { ok: false, detalle: `Google rechazó la llave (${motivo})` };
    }
    const nombres = ((await r.json())?.models ?? []).map(m => m.name);
    const tieneModelo = nombres.includes('models/gemini-3.6-flash');
    return {
      ok: tieneModelo,
      detalle: tieneModelo
        ? `llave válida, ${nombres.length} modelos, gemini-3.6-flash disponible. OJO: si es de PAGO solo se demuestra superando 20 solicitudes/día`
        : 'llave válida pero SIN acceso a gemini-3.6-flash (el modelo que usa la app)',
    };
  } catch (e) {
    return { ok: false, detalle: `sin conexión con Google (${e.name})` };
  }
}

/**
 * AWS S3: ListObjectsV2 (MaxKeys 1). La política recomendada
 * (docs/infra/iam-politica-backup-s3.json) concede SOLO s3:PutObject, así
 * que "AccessDenied" es la respuesta CORRECTA: prueba que AWS aceptó las
 * credenciales y que el bucket existe. La prueba definitiva de escritura es
 * el backup real (s3backup.js verifica ETag/MD5 tras subir).
 */
export async function validarAws({ accessKeyId, secretAccessKey, bucket, region }, crearCliente = crearClienteS3) {
  const cliente = await crearCliente({ region, credentials: { accessKeyId, secretAccessKey } });
  try {
    await cliente.listar(bucket);
    return { ok: true, detalle: `acceso al bucket "${bucket}" (${region}). AVISO: la política permite LISTAR — es más amplia que la recomendada (solo PutObject)` };
  } catch (e) {
    const codigo = e?.name || e?.Code || 'desconocido';
    switch (codigo) {
      case 'AccessDenied':
        return { ok: true, detalle: `credenciales aceptadas por AWS y bucket "${bucket}" existente; sin permiso de lectura, que es lo esperado con la política mínima (solo PutObject)` };
      case 'NoSuchBucket':
        return { ok: false, detalle: `el bucket "${bucket}" NO existe` };
      case 'InvalidAccessKeyId':
        return { ok: false, detalle: 'AWS_ACCESS_KEY_ID no existe en AWS' };
      case 'SignatureDoesNotMatch':
        return { ok: false, detalle: 'AWS_SECRET_ACCESS_KEY no corresponde a esa AWS_ACCESS_KEY_ID' };
      case 'PermanentRedirect':
      case 'AuthorizationHeaderMalformed':
        return { ok: false, detalle: `el bucket no está en la región "${region}" — corrija AWS_REGION` };
      default:
        return { ok: false, detalle: `AWS respondió "${codigo}"` };
    }
  }
}

async function crearClienteS3(config) {
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client(config);
  return { listar: (Bucket) => s3.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1, Prefix: 'backups/' })) };
}

// ── Definición de grupos ─────────────────────────────────────────────────────

export const GRUPOS = [
  {
    id: 'aws', titulo: 'AWS S3 — backup de la base de datos',
    campos: [
      { clave: 'AWS_ACCESS_KEY_ID', secreto: true },
      { clave: 'AWS_SECRET_ACCESS_KEY', secreto: true },
      { clave: 'AWS_S3_BUCKET' },
      { clave: 'AWS_REGION', porDefecto: 'us-east-1' },
    ],
    validar: (v) => validarAws({ accessKeyId: v.AWS_ACCESS_KEY_ID, secretAccessKey: v.AWS_SECRET_ACCESS_KEY, bucket: v.AWS_S3_BUCKET, region: v.AWS_REGION || 'us-east-1' }),
  },
  {
    id: 'wompi', titulo: 'Wompi — pagos (fija también PAYMENT_PROVIDER=wompi)',
    campos: [
      { clave: 'WOMPI_PUBLIC_KEY' },
      { clave: 'WOMPI_PRIVATE_KEY', secreto: true },
      { clave: 'WOMPI_EVENTS_SECRET', secreto: true },
      { clave: 'WOMPI_INTEGRITY_SECRET', secreto: true },
    ],
    extra: { PAYMENT_PROVIDER: 'wompi' },
    validar: async (v) => {
      const c = clasificarWompi({ publica: v.WOMPI_PUBLIC_KEY, privada: v.WOMPI_PRIVATE_KEY, eventos: v.WOMPI_EVENTS_SECRET, integridad: v.WOMPI_INTEGRITY_SECRET });
      if (!c.ok) return { ok: false, detalle: c.errores.join('; ') };
      const r = await validarWompiPublica(v.WOMPI_PUBLIC_KEY);
      if (r.ok && c.ambiente === 'test') r.detalle += ' — llaves de PRUEBA: no cobran dinero real';
      return r;
    },
  },
  {
    id: 'gemini', titulo: 'Gemini — IA',
    campos: [{ clave: 'GOOGLE_API_KEY', secreto: true }],
    validar: (v) => validarGemini(v.GOOGLE_API_KEY),
  },
  {
    id: 'nvidia', titulo: 'NVIDIA NIM — Formulador MGA (deepseek-v4.1-flash)',
    campos: [{ clave: 'NVIDIA_API_KEY', secreto: true }],
    validar: async (v) => validarLlaveNvidia(v.NVIDIA_API_KEY),
  },
  {
    id: 'alertas', titulo: 'Alertas — Sentry y/o webhook (Slack/Discord)',
    campos: [{ clave: 'SENTRY_DSN', opcional: true, secreto: true }, { clave: 'ERROR_WEBHOOK_URL', opcional: true, secreto: true }],
    validar: async (v) => {
      if (!v.SENTRY_DSN && !v.ERROR_WEBHOOK_URL) return { ok: false, detalle: 'hace falta al menos uno de los dos' };
      const partes = [];
      let ok = true;
      if (v.SENTRY_DSN) { const r = validarDsnSentry(v.SENTRY_DSN); ok &&= r.ok; partes.push(`Sentry: ${r.detalle}`); }
      if (v.ERROR_WEBHOOK_URL) { const r = validarUrlWebhook(v.ERROR_WEBHOOK_URL); ok &&= r.ok; partes.push(`Webhook: ${r.detalle}`); }
      return { ok, detalle: partes.join(' · ') };
    },
  },
];

// ── Ingesta desde archivo (--desde-archivo) ──────────────────────────────────

const CLAVES_CONOCIDAS = new Set(GRUPOS.flatMap(g => g.campos.map(c => c.clave)));

/** Nombres alternativos sin ambigüedad → nombre real que lee el código. */
export const ALIAS = {
  WOMPI_PUB_TEST: 'WOMPI_PUBLIC_KEY', WOMPI_PUB_PROD: 'WOMPI_PUBLIC_KEY', WOMPI_PUB: 'WOMPI_PUBLIC_KEY',
  WOMPI_PRV_TEST: 'WOMPI_PRIVATE_KEY', WOMPI_PRV_PROD: 'WOMPI_PRIVATE_KEY', WOMPI_PRV: 'WOMPI_PRIVATE_KEY',
  WOMPI_EVENTS: 'WOMPI_EVENTS_SECRET', WOMPI_INTEGRITY: 'WOMPI_INTEGRITY_SECRET',
  GEMINI_API_KEY: 'GOOGLE_API_KEY',
  AWS_BUCKET: 'AWS_S3_BUCKET', S3_BUCKET: 'AWS_S3_BUCKET', AWS_DEFAULT_REGION: 'AWS_REGION',
};

/**
 * Extrae del texto de un archivo de credenciales SOLO las variables que usa
 * la app. Acepta "CLAVE=valor", "CLAVE: valor", "export CLAVE=valor" y
 * comillas. Una clave repetida con valores distintos se descarta (no se
 * adivina cuál es la buena). Las AWS_BOOTSTRAP_* (administrador) se
 * rechazan a propósito: el backup debe usar el usuario IAM de mínimo privilegio.
 */
export function extraerCredenciales(texto) {
  const valores = {};
  const alias = [];
  const ignoradas = [];
  const conflictos = new Set();
  let bootstrap = false;
  for (const linea of String(texto).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*?)\s*$/);
    if (!m) continue;
    const clave = m[1].toUpperCase();
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!v) continue;
    if (clave.startsWith('AWS_BOOTSTRAP_')) { bootstrap = true; continue; }
    const destino = CLAVES_CONOCIDAS.has(clave) ? clave : ALIAS[clave];
    // Solo se listan nombres ya escritos en MAYÚSCULAS (estilo variable de entorno): "Nota:" no lo es.
    if (!destino) { if (/^[A-Z][A-Z0-9_]{2,}$/.test(m[1])) ignoradas.push(clave); continue; }
    if (destino !== clave) alias.push([clave, destino]);
    if (valores[destino] !== undefined && valores[destino] !== v) conflictos.add(destino);
    valores[destino] = v;
  }
  for (const c of conflictos) delete valores[c];
  return { valores, alias, ignoradas: [...new Set(ignoradas)], conflictos: [...conflictos], bootstrap };
}

/** Estado de un grupo según los valores disponibles. */
export async function evaluarGrupo(grupo, valores) {
  // Un valor por defecto (AWS_REGION=us-east-1) no cuenta como "configurado".
  const conValor = grupo.campos.filter(c => valores[c.clave] && valores[c.clave] !== c.porDefecto);
  if (!conValor.length) return { estado: 'PENDIENTE', detalle: 'sin configurar' };
  const faltan = grupo.campos.filter(c => !c.opcional && !c.porDefecto && !valores[c.clave]).map(c => c.clave);
  if (faltan.length) return { estado: 'FALLO', detalle: `faltan: ${faltan.join(', ')}` };
  const r = await grupo.validar(valores);
  return { estado: r.ok ? 'OK' : 'FALLO', detalle: r.detalle };
}

// ── Entrada por teclado ──────────────────────────────────────────────────────

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(texto, (r) => { rl.close(); res(r.trim()); }));
}

function preguntarOculto(texto) {
  return new Promise((res) => {
    const { stdin, stdout } = process;
    stdout.write(texto);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let valor = '';
    const alTeclear = (datos) => {
      for (const ch of datos) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', alTeclear);
          stdout.write('\n'); return res(valor.trim());
        }
        if (ch === '\u0003') { stdin.setRawMode(false); stdout.write('\nCancelado — no se escribió nada.\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') { if (valor.length) { valor = valor.slice(0, -1); stdout.write('\b \b'); } continue; }
        valor += ch; stdout.write('*');
      }
    };
    stdin.on('data', alTeclear);
  });
}

// ── Escritura segura ─────────────────────────────────────────────────────────

function estaIgnoradoPorGit(ruta) {
  // Fuera del repositorio (p. ej. el Escritorio): git no puede rastrearlo.
  const rel = relative(RAIZ, resolve(ruta));
  if (rel.startsWith('..') || isAbsolute(rel)) return true;
  const r = spawnSync('git', ['check-ignore', '-q', ruta], { cwd: RAIZ });
  if (r.error) throw new Error('no se encontró git para comprobar .gitignore — no se escribe nada');
  return r.status === 0;
}

async function escribirEnv(cambios) {
  const actual = existsSync(RUTA_ENV) ? await readFile(RUTA_ENV, 'utf8') : '';
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const respaldo = `${RUTA_ENV}.backup-${sello}`;
  if (!estaIgnoradoPorGit(RUTA_ENV) || !estaIgnoradoPorGit(respaldo)) {
    throw new Error('.env o sus copias NO están en .gitignore — no se escribe nada (el repo es público)');
  }
  if (existsSync(RUTA_ENV)) await copyFile(RUTA_ENV, respaldo);
  await writeFile(RUTA_ENV, actualizarEnv(actual, cambios), 'utf8');
  return respaldo;
}

function subirSecretoGithub(nombre, valor) {
  const gh = process.platform === 'win32' && existsSync('C:/Program Files/GitHub CLI/gh.exe') ? 'C:/Program Files/GitHub CLI/gh.exe' : 'gh';
  // El valor va por stdin, nunca como argumento (sería visible en la lista de procesos).
  const r = spawnSync(gh, ['secret', 'set', nombre], { cwd: RAIZ, input: valor, encoding: 'utf8' });
  return r.status === 0;
}

// ── Programa principal ───────────────────────────────────────────────────────

const ICONO = { OK: '🟢 OK', FALLO: '🔴 FALLO', PENDIENTE: '⚪ PENDIENTE' };

async function main() {
  const soloVerificar = process.argv.includes('--verificar');
  const subirGithub = process.argv.includes('--subir-github');
  const iArchivo = process.argv.indexOf('--desde-archivo');
  const rutaArchivo = iArchivo >= 0 ? process.argv[iArchivo + 1] : null;
  const env = existsSync(RUTA_ENV) ? parseEnv(await readFile(RUTA_ENV, 'utf8')) : new Map();
  const valores = Object.fromEntries(env);

  console.log('\n══ RadFor-360 · Asistente de configuración de infraestructura ══');
  console.log('Los secretos nunca se muestran: solo su prefijo público y su longitud.\n');

  if (iArchivo >= 0 && (!rutaArchivo || rutaArchivo.startsWith('--'))) {
    console.error('Uso: node scripts/setup-infra.mjs --desde-archivo <ruta del archivo de credenciales>');
    process.exitCode = 1; return;
  }
  if (!soloVerificar && !rutaArchivo && !process.stdin.isTTY) {
    console.error('Este modo necesita teclado. Ejecútelo en su propia terminal, o use --verificar / --desde-archivo.');
    process.exitCode = 2; return;
  }

  // --desde-archivo: extrae, informa (sin valores) y valida por grupo.
  let delArchivo = null;
  if (rutaArchivo) {
    const ruta = resolve(rutaArchivo);
    if (!existsSync(ruta)) { console.error(`✖ No existe el archivo: ${ruta}`); process.exitCode = 1; return; }
    if (!estaIgnoradoPorGit(ruta)) {
      console.error('✖ El archivo de credenciales está DENTRO del repositorio y NO está en .gitignore — muévalo fuera (el repo es público).');
      process.exitCode = 1; return;
    }
    const ext = extraerCredenciales(await readFile(ruta, 'utf8'));
    delArchivo = ext.valores;
    console.log(`Archivo: ${ruta}`);
    console.log(`   Variables reconocidas: ${Object.keys(ext.valores).length ? Object.keys(ext.valores).join(', ') : 'ninguna'}`);
    for (const [de, a] of ext.alias) console.log(`   alias: ${de} → ${a}`);
    if (ext.conflictos.length) console.log(`   ⚠ Descartadas por tener valores distintos repetidos: ${ext.conflictos.join(', ')}`);
    if (ext.bootstrap) console.log('   ⚠ AWS_BOOTSTRAP_* ignoradas: son de ADMINISTRADOR. El backup usa el usuario IAM de mínimo privilegio (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).');
    if (ext.ignoradas.length) console.log(`   Otras variables del archivo (no usadas por este asistente): ${ext.ignoradas.join(', ')}`);
    console.log('');
  }

  const cambios = {};
  const resultados = [];
  for (const grupo of GRUPOS) {
    console.log(`── ${grupo.titulo}`);

    if (delArchivo) {
      const nuevos = {};
      for (const c of grupo.campos) if (delArchivo[c.clave]) nuevos[c.clave] = delArchivo[c.clave];
      if (Object.keys(nuevos).length) {
        for (const c of grupo.campos) if (!nuevos[c.clave] && !valores[c.clave] && c.porDefecto) nuevos[c.clave] = c.porDefecto;
        const candidatos = { ...valores, ...nuevos };
        for (const c of grupo.campos) console.log(`   ${c.clave}: ${c.secreto ? enmascarar(candidatos[c.clave]) : (candidatos[c.clave] || '(vacía)')}${nuevos[c.clave] ? '  ← del archivo' : ''}`);
        const ev = await evaluarGrupo(grupo, candidatos);
        console.log(`   ${ICONO[ev.estado]} — ${ev.detalle}`);
        if (ev.estado === 'OK') {
          Object.assign(cambios, nuevos, grupo.extra || {});
          Object.assign(valores, nuevos, grupo.extra || {});
          console.log('   → se guardará en .env\n');
        } else {
          console.log('   → NO se guarda (la validación falló; .env queda como estaba para este grupo)\n');
        }
        resultados.push({ grupo, ...ev });
        continue;
      }
    }

    for (const c of grupo.campos) console.log(`   ${c.clave}: ${c.secreto ? enmascarar(valores[c.clave]) : (valores[c.clave] || '(vacía)')}`);

    if (!soloVerificar && !delArchivo) {
      const r = (await preguntar('   ¿Configurar este grupo ahora? (s/N): ')).toLowerCase();
      if (r === 's' || r === 'si' || r === 'sí') {
        const nuevos = {};
        for (const c of grupo.campos) {
          const etiqueta = `   ${c.clave}${c.opcional ? ' (opcional)' : ''}${c.porDefecto ? ` [${c.porDefecto}]` : ''} — Enter conserva el actual: `;
          const v = c.secreto ? await preguntarOculto(etiqueta) : await preguntar(etiqueta);
          if (v) nuevos[c.clave] = v;
          else if (!valores[c.clave] && c.porDefecto) nuevos[c.clave] = c.porDefecto;
        }
        const candidatos = { ...valores, ...nuevos };
        process.stdout.write('   Validando en vivo… ');
        const ev = await evaluarGrupo(grupo, candidatos);
        console.log(`${ICONO[ev.estado]} — ${ev.detalle}`);
        let guardar = ev.estado === 'OK';
        if (!guardar && Object.keys(nuevos).length) {
          guardar = ['s', 'si', 'sí'].includes((await preguntar('   La validación falló. ¿Guardar de todos modos? (s/N): ')).toLowerCase());
        }
        if (guardar && Object.keys(nuevos).length) {
          Object.assign(cambios, nuevos, grupo.extra || {});
          Object.assign(valores, nuevos, grupo.extra || {});
        }
        resultados.push({ grupo, ...ev });
        console.log('');
        continue;
      }
    }
    const ev = await evaluarGrupo(grupo, valores);
    console.log(`   ${ICONO[ev.estado]} — ${ev.detalle}\n`);
    resultados.push({ grupo, ...ev });
  }

  if (Object.keys(cambios).length) {
    const respaldo = await escribirEnv(cambios);
    console.log(`✔ .env actualizado (${Object.keys(cambios).length} variable(s)). Copia previa: ${respaldo.replace(RAIZ, '.')}`);
  }

  const aws = resultados.find(r => r.grupo.id === 'aws');
  if (subirGithub && aws?.estado === 'OK' && !process.stdin.isTTY) {
    console.log('--subir-github necesita confirmar por teclado: vuelva a ejecutarlo en su propia terminal.');
  } else if (subirGithub && aws?.estado === 'OK') {
    const ok =['s', 'si', 'sí'].includes((await preguntar('¿Subir AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET y AWS_REGION a GitHub Secrets? (s/N): ')).toLowerCase());
    if (ok) {
      for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET', 'AWS_REGION']) {
        console.log(`   ${k}: ${subirSecretoGithub(k, valores[k] || 'us-east-1') ? 'subido ✔' : 'FALLÓ ✖'}`);
      }
    }
  }

  console.log('══ Resumen');
  for (const r of resultados) console.log(`   ${ICONO[r.estado].padEnd(12)} ${r.grupo.titulo}`);
  console.log('\nPróximos pasos que este asistente NO hace (requieren su cuenta):');
  console.log('   · Render → radar360-app → Environment: WOMPI_*, PAYMENT_PROVIDER=wompi, GOOGLE_API_KEY, NVIDIA_API_KEY, SENTRY_DSN / ERROR_WEBHOOK_URL.');
  console.log('   · GitHub Secrets: AWS_* (o use --subir-github). Luego: gh workflow run backup-s3.yml');
  console.log('   · Google Cloud → Credenciales: restricción por HTTP referrer de la llave de Firebase.\n');

  const hayFallo = resultados.some(r => r.estado === 'FALLO');
  const hayPendiente = resultados.some(r => r.estado === 'PENDIENTE');
  // exitCode, no process.exit(): en Windows, salir a la fuerza mientras fetch
  // cierra sus sockets aborta Node ("Assertion failed … src\win\async.c") y el
  // código de salida real se pierde (verificado: salía 127 en vez de 2).
  process.exitCode = hayFallo ? 1 : hayPendiente ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`✖ ${e.message}`); process.exitCode = 1; });
}
