#!/usr/bin/env node
/**
 * agentes.mjs — lista HONESTA de agentes, según la carpeta desde la que se ejecuta.
 *
 *   Dentro de Proy_03_RadarFondos → agentes REALES de la SaaS agrupados por
 *     dominio lógico (Gerente de Proyecto / Radar / Formulador), con estado
 *     calculado EN VIVO: archivo, ruta registrada, pantalla que la llama,
 *     BYOK y último uso real en ai_token_logs.
 *   Fuera (p. ej. la raíz de Antigravity) → Escuadrón Élite (.claude/agents/*.md).
 *
 * Uso:  node scripts/agentes.mjs [--saas | --elite] [--sin-bd] [--json]
 *       (desde la raíz: node proyectos/Proy_03_RadarFondos/scripts/agentes.mjs)
 *
 * Garantías: SOLO LECTURA. No escribe archivos ni la BD (consulta con
 * BEGIN READ ONLY). Nunca imprime secretos. No toca la raíz de Antigravity
 * ni projects/Radford-360/ (solo comprueba si existen sus fichas).
 * Un dominio sin código real se marca "definido, sin código" — nunca "activo".
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const RAIZ_PROYECTO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAS_USO = 90;
// Pantallas que solo existen en rutas /dev (no las usa un cliente real).
const UI_SOLO_DEV = ['client/src/Dashboard.tsx'];

// ── Catálogo de agentes reales (evidencia verificable, no autodeclarada) ─────
// ruta: endpoint que expone el agente (método + path exacto del backend).
// invocadoDesde: para agentes de segundo plano sin ruta propia.
// log: agent_name con el que registra consumo en ai_token_logs.
export const CATALOGO = [
  { id: 'sectorClassifier', dominio: 'Radar', nombre: 'Clasificador de sectores', archivo: 'backend/services/sectorClassifier.js', llamaLLM: true, log: 'sector-classifier',
    invocadoDesde: [['backend/pipeline/DataIngestor.js', 'classifySectors('], ['backend/pipeline/EntityScraper.js', 'classifySectors(']] },
  { id: 'EntityScraper', dominio: 'Radar', nombre: 'Rastreador de convocatorias (scraping)', archivo: 'backend/pipeline/EntityScraper.js', llamaLLM: false, uso: 'crawl_log',
    invocadoDesde: [['backend/pipeline/CronScheduler.js', 'EntityScraper']] },
  { id: 'markitdown', dominio: 'Radar', nombre: 'Extractor de campos de convocatorias', archivo: 'backend/services/markitdownService.js', llamaLLM: true, log: 'markitdown-extract',
    invocadoDesde: [['backend/pipeline/EntityScraper.js', 'extractConvocatoriaFields(']] },
  { id: 'busquedaSemantica', dominio: 'Radar', nombre: 'Búsqueda semántica (embeddings)', archivo: 'backend/services/embeddingsService.js', llamaLLM: true, datos: 'embeddings_convocatorias',
    // services/api.ts solo DEFINE buscar(); su propio comentario: "Sin caller real (grep: 0 usos)".
    ignorarLlamadores: ['client/src/services/api.ts'],
    rutas: [['get', '/api/radar/buscar'], ['post', '/api/radar/buscar-masivo']] },
  { id: 'lookupEntidad', dominio: 'Radar', nombre: 'Búsqueda de entidades (Directorio)', archivo: 'server.js', llamaLLM: true, log: 'lookup-entidad',
    rutas: [['post', '/api/entidades/lookup']] },
  { id: 'EntradaIA', dominio: 'Formulador', nombre: 'Entrada — Generar con AI', archivo: 'backend/services/EntradaIAService.js', llamaLLM: true, log: 'entrada-ia',
    rutas: [['post', '/api/proyectos/:id/entrada/generar-ai-campo'], ['post', '/api/proyectos/:id/entrada/generar-ai-pitch']] },
  { id: 'arbolObjetivos', dominio: 'Formulador', nombre: 'Árbol de objetivos', archivo: 'backend/agents/arbolObjetivosAgent.js', llamaLLM: true, log: 'arbol_objetivos',
    rutas: [['post', '/api/modulo3b/arbol/generar']] },
  { id: 'viabilidad', dominio: 'Formulador', nombre: 'Dictamen de Viabilidad IA', archivo: 'backend/services/viabilidadAgent.js', llamaLLM: true, log: 'viabilidad',
    rutas: [['post', '/api/proyectos/:id/viabilidad-ia']] },
  { id: 'mirofish', dominio: 'Formulador', nombre: 'Comité Hostil MIROFISH', archivo: 'backend/services/mirofishComite.js', llamaLLM: true, log: 'mirofish_comite',
    rutas: [['post', '/api/proyectos/:id/mirofish']] },
  { id: 'copiloto', dominio: 'Formulador', nombre: 'Co-Piloto (chat)', archivo: 'backend/services/CopilotoService.js', llamaLLM: true, log: 'copiloto',
    rutas: [['post', '/api/proyectos/:id/copiloto/chat']] },
  { id: 'formulacionIntegral', dominio: 'Formulador', nombre: 'Formulación integral (secuencia fija Entrada→Árbol→Viabilidad)', archivo: 'backend/routes/formulacionIntegral.routes.js', llamaLLM: true, uso: 'formulacion_integral',
    rutas: [['post', '/api/formulacion/integral/:proyectoId']] },
  { id: 'formuladorMga', dominio: 'Formulador', nombre: 'Formulador MGA (consolidador, NVIDIA NIM)', archivo: 'backend/services/formuladorMga.js', llamaLLM: true, log: 'formulador_mga',
    rutas: [['post', '/api/proyectos/:id/formulador-mga']] },
  { id: 'normativo', dominio: 'Formulador', nombre: 'Marco normativo (M8, tabla de normas)', archivo: 'backend/agents/normativoAgent.js', llamaLLM: false,
    rutas: [['post', '/api/m8/normas/:proyectoId']] },
];

// Dominios lógicos: nombres que AGRUPAN funciones reales. Su ficha externa
// (projects/Radford-360/…) es solo una identidad declarada, sin código.
export const DOMINIOS = [
  { id: 'GP', nombre: 'Gerente de Proyecto', ficha: 'Proy_03 GP Radford-360',
    nota: 'Ningún componente despacha tareas entre agentes (verificado: cero llamadas cruzadas). La formulación integral es una secuencia fija, no un enrutador.' },
  { id: 'Radar', nombre: 'Radar', ficha: 'Proy_03 A Radar' },
  { id: 'Formulador', nombre: 'Formulador', ficha: 'Proy_03 B Formulador' },
];

// ── Utilidades puras (exportadas para pruebas) ───────────────────────────────

const normalizar = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));

/** 'saas' si cwd está dentro del proyecto; si no, 'elite'. Una bandera lo fuerza. */
export function detectarContexto({ cwd, raizProyecto = RAIZ_PROYECTO, argv = [] }) {
  if (argv.includes('--saas')) return 'saas';
  if (argv.includes('--elite')) return 'elite';
  const rel = relative(normalizar(raizProyecto), normalizar(cwd));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) ? 'saas' : 'elite';
}

/** Ruta del backend → RegExp que la reconoce en el cliente (`/api/proyectos/${id}/…`). */
export function rutaARegex(ruta) {
  const partes = ruta.split('/').map(s => (s.startsWith(':') ? '[^/\'"`?]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`${partes.join('/')}(?![\\w-])`);
}

/** Frontmatter YAML simple (clave: valor) de un .md de .claude/agents. */
export function parseFrontmatter(texto) {
  const m = String(texto).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const campos = {};
  for (const linea of m[1].split(/\r?\n/)) {
    const k = linea.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (k) campos[k[1]] = k[2].trim();
  }
  return campos;
}

/** Estado de un agente a partir de su evidencia. Nunca "activo" sin código y conexión reales. */
export function calcularEstado(ev) {
  if (!ev.archivo) return { estado: 'NO EXISTE', icono: '🔴', motivo: 'el archivo del agente no está en el repo' };
  if (ev.rutas.length && !ev.rutas.every(r => r.registrada)) return { estado: 'DESCONECTADO', icono: '🔴', motivo: 'ruta no registrada en el backend' };
  if (ev.rutas.length && !ev.rutas.some(r => r.pantallas.length)) {
    const motivo = ev.rutas.some(r => r.soloDev.length) ? 'solo la llama una pantalla /dev' : 'ninguna pantalla llama a su ruta';
    // Si además no tiene datos, se muestran AMBOS problemas (ninguno oculta al otro).
    if (ev.datos && ev.datos.con === 0) return { estado: 'SIN INTERFAZ · SIN DATOS', icono: '🔴', motivo: `${motivo}; 0 de ${ev.datos.total} registros con embeddings (devuelve vacío)` };
    return { estado: 'SIN INTERFAZ', icono: '🟠', motivo };
  }
  if (ev.invocadores && !ev.invocadores.some(i => i.ok)) return { estado: 'DESCONECTADO', icono: '🔴', motivo: 'nadie lo invoca' };
  if (ev.datos && ev.datos.con === 0) return { estado: 'SIN DATOS', icono: '🔴', motivo: `0 de ${ev.datos.total} registros con embeddings: devuelve vacío` };
  const unidad = ev.uso?.unidad || `llamadas en ${DIAS_USO} días`;
  if (!ev.llamaLLM) return { estado: 'ACTIVO · sin IA', icono: '🟢', motivo: ev.uso ? `determinista · ${ev.uso.n} ${unidad}, última ${ev.uso.ultima}` : 'determinista' };
  if (ev.uso === null) return { estado: 'ACTIVO · uso desconocido', icono: '🟢', motivo: 'sin consulta a la BD' };
  if (ev.uso.n > 0) return { estado: 'ACTIVO · en uso', icono: '🟢', motivo: `${ev.uso.n} ${unidad}, última ${ev.uso.ultima}` };
  return { estado: 'ACTIVO · sin uso registrado', icono: '🟡', motivo: `conectado, 0 ${unidad}` };
}

// ── Evidencia del repositorio (lectura de archivos) ──────────────────────────

function listarArchivos(dir, extensiones) {
  const salida = [];
  const recorrer = (d) => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n.startsWith('.')) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (extensiones.some(e => p.endsWith(e))) salida.push(p);
    }
  };
  if (existsSync(dir)) recorrer(dir);
  return salida;
}

export function reunirEvidencia(raiz = RAIZ_PROYECTO) {
  const leer = (p) => { try { return readFileSync(resolve(raiz, p), 'utf8'); } catch { return null; } };
  const backend = [resolve(raiz, 'server.js'), ...listarArchivos(resolve(raiz, 'backend/routes'), ['.js'])]
    .map(p => ({ p, src: readFileSync(p, 'utf8') }));
  const cliente = listarArchivos(resolve(raiz, 'client/src'), ['.ts', '.tsx'])
    .map(p => ({ rel: relative(raiz, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));

  return CATALOGO.map((a) => {
    const rutas = (a.rutas || []).map(([metodo, ruta]) => {
      const lineas = backend.flatMap(({ src }) => src.split(/\r?\n/).filter(l => l.includes(`.${metodo}('${ruta}'`)));
      const re = rutaARegex(ruta);
      const llamadores = cliente.filter(f => re.test(f.src)).map(f => f.rel).filter(f => !(a.ignorarLlamadores || []).includes(f));
      return {
        metodo: metodo.toUpperCase(), ruta,
        registrada: lineas.length > 0,
        byok: lineas.some(l => /byokGate|requireByokOrExento/.test(l)),
        pantallas: llamadores.filter(f => !UI_SOLO_DEV.includes(f)),
        soloDev: llamadores.filter(f => UI_SOLO_DEV.includes(f)),
      };
    });
    const invocadores = a.invocadoDesde?.map(([archivo, marca]) => ({ archivo, ok: (leer(archivo) || '').includes(marca) }));
    return { ...a, archivoOk: existsSync(resolve(raiz, a.archivo)), rutasEv: rutas, invocadores };
  });
}

// ── Evidencia de la BD (solo lectura, opcional) ──────────────────────────────

async function reunirBD(raiz) {
  try { process.loadEnvFile(resolve(raiz, '.env')); } catch { /* sin .env: se usa el entorno */ }
  if (!process.env.DATABASE_URL) return null;
  const require = createRequire(resolve(raiz, 'package.json'));
  const pg = require('pg');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await c.connect();
    await c.query('BEGIN READ ONLY');
    const q = async (sql) => { try { return (await c.query(sql)).rows; } catch { return null; } };
    const usos = await q(`SELECT agent_name, count(*)::int n, to_char(max(created_at), 'YYYY-MM-DD') ultima FROM ai_token_logs WHERE created_at > now() - interval '${DIAS_USO} days' GROUP BY 1`);
    const crawl = await q(`SELECT count(*) FILTER (WHERE ejecutada_en > now() - interval '7 days')::int n7, to_char(max(ejecutada_en), 'YYYY-MM-DD') ultima FROM crawl_log`);
    const integral = await q("SELECT count(*)::int n, to_char(max(updated_at), 'YYYY-MM-DD') ultima FROM proyectos WHERE ficha_tecnica ? 'formulacion_integral'");
    const emb = await q('SELECT count(*)::int total, count(embedding_vec)::int con FROM convocatorias');
    const byok = await q('SELECT (SELECT count(*)::int FROM usuarios) usuarios, (SELECT count(*)::int FROM usuarios WHERE byok_exento) exentos, (SELECT count(DISTINCT user_id)::int FROM user_gemini_keys WHERE is_valid) con_llave');
    await c.query('COMMIT');
    return { usos: Object.fromEntries((usos || []).map(r => [r.agent_name, r])), crawl: crawl?.[0] ?? null, integral: integral?.[0] ?? null, embeddings: emb?.[0] ?? null, byok: byok?.[0] ?? null };
  } catch (e) {
    return { error: e.message.slice(0, 120) };
  } finally {
    await c.end().catch(() => {});
  }
}

function usoDe(agente, bd) {
  if (!bd || bd.error) return null;
  if (agente.uso === 'crawl_log') return bd.crawl ? { n: bd.crawl.n7, ultima: bd.crawl.ultima ?? '—', unidad: 'corridas en 7 días' } : null;
  if (agente.uso === 'formulacion_integral') return bd.integral ? { n: bd.integral.n, ultima: bd.integral.ultima ?? '—', unidad: 'proyectos con progreso guardado' } : null;
  const nombres = agente.logs || (agente.log ? [agente.log] : []);
  if (!nombres.length) return null;
  const filas = nombres.map(n => bd.usos[n]).filter(Boolean);
  return { n: filas.reduce((s, f) => s + f.n, 0), ultima: filas.map(f => f.ultima).sort().pop() ?? '—' };
}

// ── Modos de salida ──────────────────────────────────────────────────────────

async function modoSaas({ sinBD, json }) {
  const evidencia = reunirEvidencia();
  const bd = sinBD ? null : await reunirBD(RAIZ_PROYECTO);
  const raizAntigravity = resolve(RAIZ_PROYECTO, '..', '..');
  const agentes = evidencia.map((a) => {
    const est = calcularEstado({
      archivo: a.archivoOk, rutas: a.rutasEv, invocadores: a.invocadores, llamaLLM: a.llamaLLM,
      datos: a.datos === 'embeddings_convocatorias' && bd?.embeddings ? bd.embeddings : null,
      uso: usoDe(a, bd),
    });
    return { id: a.id, dominio: a.dominio, nombre: a.nombre, archivo: a.archivo, llamaLLM: a.llamaLLM, byok: a.rutasEv.some(r => r.byok),
      rutas: a.rutasEv.map(r => `${r.metodo} ${r.ruta}`), pantallas: [...new Set(a.rutasEv.flatMap(r => r.pantallas))], ...est };
  });
  const dominios = DOMINIOS.map(d => {
    const miembros = agentes.filter(a => a.dominio === d.id);
    const ficha = existsSync(resolve(raizAntigravity, 'projects', 'Radford-360', d.ficha, 'IDENTITY.md'));
    return { ...d, estado: miembros.length ? `${miembros.length} función(es) real(es)` : 'definido, sin código', ficha: ficha ? `projects/Radford-360/${d.ficha} — definido, sin código` : null, miembros };
  });

  if (json) { console.log(JSON.stringify({ contexto: 'saas', bd: bd ? (bd.error ? { error: bd.error } : { byok: bd.byok, embeddings: bd.embeddings }) : null, dominios }, null, 2)); return; }

  console.log('\n══ RadFor-360 · agentes reales de la SaaS (estado calculado en vivo, solo lectura) ══');
  if (!bd) console.log('   (sin consulta a la BD: el uso real aparece como "desconocido")');
  else if (bd.error) console.log(`   (BD no disponible: ${bd.error})`);
  for (const d of dominios) {
    console.log(`\n■ ${d.nombre.toUpperCase()} — ${d.estado}`);
    if (d.nota) console.log(`   ${d.nota}`);
    if (d.ficha) console.log(`   Ficha externa: ${d.ficha}`);
    for (const a of d.miembros) {
      console.log(`   ${a.icono} ${a.nombre}  [${a.estado}]${a.byok ? ' · BYOK' : ''}${a.llamaLLM ? '' : ' · sin IA'}`);
      console.log(`      ${a.motivo} · ${a.archivo}${a.pantallas.length ? ` · llamada desde: ${a.pantallas.map(p => p.split('/').pop()).join(', ')}` : ''}`);
    }
  }
  if (bd?.byok) {
    console.log(`\nBYOK: las funciones marcadas BYOK responden solo a usuarios exentos o con llave propia → hoy ${bd.byok.exentos + bd.byok.con_llave} de ${bd.byok.usuarios} usuarios.`);
  }
  console.log('\nLeyenda: 🟢 conectado y funcional · 🟡 conectado, sin uso real · 🟠 sin pantalla · 🔴 no funciona');
}

function buscarEscuadron(cwd) {
  let d = resolve(cwd);
  for (;;) {
    const dir = join(d, '.claude', 'agents');
    if (existsSync(dir) && readdirSync(dir).some(f => /^\d{3}-.*\.md$/.test(f))) return dir;
    const padre = dirname(d);
    if (padre === d) return null;
    d = padre;
  }
}

function modoElite({ cwd, json }) {
  const dir = buscarEscuadron(cwd);
  if (!dir) { console.log('No se encontró un Escuadrón Élite (.claude/agents/NNN-*.md) en esta carpeta ni en sus padres.'); return; }
  const agentes = readdirSync(dir).filter(f => f.endsWith('.md')).sort().map((f) => {
    const fm = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
    return { archivo: f, nombre: fm.name || f.replace(/\.md$/, ''), descripcion: (fm.description || '').slice(0, 110), herramientas: fm.tools || '', gate: !!fm.gate };
  });
  if (json) { console.log(JSON.stringify({ contexto: 'elite', carpeta: dir, agentes }, null, 2)); return; }
  console.log(`\n══ Escuadrón Élite — ${dir} ══`);
  console.log('   Definiciones de subagentes de Claude Code (se cargan al abrir Claude Code en esta carpeta).\n');
  for (const a of agentes) {
    console.log(`   • ${a.nombre}${a.gate ? '  [gate]' : ''}`);
    if (a.descripcion) console.log(`      ${a.descripcion}${a.descripcion.length === 110 ? '…' : ''}`);
  }
  console.log(`\n   Total: ${agentes.length}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cwd = process.cwd();
  const opciones = { cwd, sinBD: argv.includes('--sin-bd'), json: argv.includes('--json') };
  if (detectarContexto({ cwd, argv }) === 'saas') await modoSaas(opciones);
  else modoElite(opciones);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(`✖ ${e.message}`); process.exitCode = 1; });
}
