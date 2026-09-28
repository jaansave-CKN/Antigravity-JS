#!/usr/bin/env node
/**
 * aislamiento.mjs — analizador ESTÁTICO del grafo de imports del backend que
 * hace cumplir la regla de aislamiento de la Fase 4 (dictamen architect
 * 2026-09-28): ningún archivo del módulo A (Radar) alcanza —directa o
 * transitivamente— uno del módulo B (Formulador), ni al revés; todo
 * intercambio A↔B pasa por el Gerente de Proyecto (backend/agents/gp/).
 *
 * Reglas (la clasificación vive en backend/agents/modulos.map.js):
 *   1. A no alcanza B y B no alcanza A (cierre transitivo, pasando por NEUTRAL).
 *   2. NEUTRAL no importa A, B ni GP (si no, neutral se volvería un túnel).
 *   3. GP solo importa los coordinadores (agents/radar/index.js,
 *      agents/formulador/index.js) y NEUTRAL — nunca una función hoja.
 *   4. Solo COMPOSICION importa GP.
 *   5. Todo archivo de backend/{services,agents,pipeline,routes} debe estar
 *      clasificado: un archivo nuevo sin clasificar hace fallar el test.
 *
 * Uso: node scripts/aislamiento.mjs   (sale con código 1 si hay violaciones)
 * Solo lectura: no ejecuta el código que analiza.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RAIZ_PROYECTO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS_OBLIGATORIOS = ['backend/services', 'backend/agents', 'backend/pipeline', 'backend/routes'];

const norm = (p) => p.replace(/\\/g, '/');

/** Patrón tipo glob ('**' cualquier ruta, '*' un segmento) → RegExp anclada. */
export function globARegex(patron) {
  const esc = patron.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

/** Módulo al que pertenece una ruta relativa ('backend/services/x.js'), o null. */
export function clasificar(rel, modulos) {
  for (const [nombre, { rutas }] of Object.entries(modulos)) {
    if (rutas.some(p => globARegex(p).test(rel))) return nombre;
  }
  return null;
}

/** Especificadores importados: import/export … from, import('…') dinámico y import '…' desnudo. */
export function extraerImports(src) {
  const sinComentarios = String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const specs = new Set();
  for (const re of [/\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s+['"]([^'"]+)['"]/g]) {
    for (const m of sinComentarios.matchAll(re)) specs.add(m[1]);
  }
  return [...specs];
}

/** Resuelve un import relativo a ruta relativa del proyecto; paquetes/node: → null. */
export function resolverImport(desdeRel, spec, raiz) {
  if (!spec.startsWith('.')) return null;
  let destino = norm(relative(raiz, resolve(raiz, dirname(desdeRel), spec)));
  if (!/\.(m?js|cjs|json)$/.test(destino)) destino += existsSync(join(raiz, destino + '.js')) ? '.js' : '/index.js';
  return destino;
}

export function listarArchivos(raiz) {
  const salida = existsSync(join(raiz, 'server.js')) ? ['server.js'] : [];
  const recorrer = (d) => {
    if (!existsSync(join(raiz, d))) return;
    for (const n of readdirSync(join(raiz, d))) {
      if (n === 'node_modules' || n.startsWith('.')) continue;
      const rel = `${d}/${n}`;
      if (statSync(join(raiz, rel)).isDirectory()) recorrer(rel);
      else if (/\.m?js$/.test(n)) salida.push(rel);
    }
  };
  recorrer('backend');
  return salida;
}

/** Grafo { archivo: [imports resueltos] } — solo lectura de texto. */
export function construirGrafo(raiz, archivos = listarArchivos(raiz)) {
  const grafo = {};
  for (const f of archivos) {
    grafo[f] = extraerImports(readFileSync(join(raiz, f), 'utf8'))
      .map(s => resolverImport(f, s, raiz)).filter(Boolean);
  }
  return grafo;
}

const COORDINADORES = new Set(['backend/agents/radar/index.js', 'backend/agents/formulador/index.js']);

/**
 * @returns {{ violaciones: string[], sinClasificar: string[], grafo: object }}
 */
export function analizarImports(raiz, modulos) {
  const grafo = construirGrafo(raiz);
  const mod = (f) => clasificar(f, modulos);
  const violaciones = [];
  const sinClasificar = Object.keys(grafo).filter(f => DIRS_OBLIGATORIOS.some(d => f.startsWith(d + '/')) && !mod(f));

  for (const [f, imports] of Object.entries(grafo)) {
    const m = mod(f);
    for (const dep of imports) {
      const md = mod(dep);
      if (m === 'NEUTRAL' && ['A_RADAR', 'B_FORMULADOR', 'GP'].includes(md)) violaciones.push(`NEUTRAL importa ${md}: ${f} → ${dep}`);
      if (m === 'GP' && !(COORDINADORES.has(dep) || md === 'NEUTRAL' || md === 'GP')) violaciones.push(`GP importa una función hoja (${md}): ${f} → ${dep}`);
      if (md === 'GP' && !['GP', 'COMPOSICION'].includes(m)) violaciones.push(`solo COMPOSICION importa GP: ${f} → ${dep}`);
    }
  }

  // Cierre transitivo A↛B y B↛A (se recorre NEUTRAL; GP y COMPOSICION cortan el camino).
  const opuesto = { A_RADAR: 'B_FORMULADOR', B_FORMULADOR: 'A_RADAR' };
  for (const f of Object.keys(grafo)) {
    const m = mod(f);
    if (!opuesto[m]) continue;
    const visto = new Set([f]);
    const pila = [[f, [f]]];
    while (pila.length) {
      const [actual, camino] = pila.pop();
      for (const dep of grafo[actual] || []) {
        if (visto.has(dep)) continue;
        visto.add(dep);
        const md = mod(dep);
        if (md === opuesto[m]) { violaciones.push(`${m} alcanza ${md}: ${[...camino, dep].join(' → ')}`); continue; }
        if (md === m || md === 'NEUTRAL') pila.push([dep, [...camino, dep]]);
      }
    }
  }
  return { violaciones: [...new Set(violaciones)], sinClasificar, grafo };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { MODULOS } = await import(pathToFileURL(join(RAIZ_PROYECTO, 'backend/agents/modulos.map.js')).href);
  const { violaciones, sinClasificar } = analizarImports(RAIZ_PROYECTO, MODULOS);
  for (const v of violaciones) console.log(`✖ ${v}`);
  for (const s of sinClasificar) console.log(`✖ sin clasificar: ${s}`);
  if (!violaciones.length && !sinClasificar.length) console.log('✔ Aislamiento A↔B: 0 violaciones, todos los archivos clasificados.');
  process.exit(violaciones.length || sinClasificar.length ? 1 : 0);
}
