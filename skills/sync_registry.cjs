// Sincroniza skills/ag_skills_registry.json por lectura directa del filesystem.
// Glob: agents/**/skills/**/*.{cjs,js,py} + skills/**/*.{cjs,js,py}  (antes solo *.cjs)
// Fusiona por 'file' — nunca borra ni pisa anotaciones existentes (sync_note, bitacora_protocol, etc.).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'skills', 'ag_skills_registry.json');
const SKILL_EXT = new Set(['.cjs', '.js', '.py']);
// _archivo_historico agregado 2026-08-08: sin esto, el glob redescubre las 25
// skills de agents/001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/
// como si fueran skills nuevas cada vez que corre, contradiciendo su propio
// estado archivado en ag_skills_registry.json.
const SKIP_DIRS = new Set(['node_modules', '_quarantine', '_archivo_historico']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (SKILL_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

function findSkillsDirs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'skills') out.push(full);
    findSkillsDirs(full, out);
  }
  return out;
}

function collectKnownFiles(registry) {
  const known = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === 'object') {
      if (typeof node.file === 'string') known.add(node.file.replace(/\/$/, ''));
      Object.values(node).forEach(visit);
    }
  };
  visit(registry.agent_mappings);
  visit(registry.transversal_skills_cjs);
  visit(registry.global_skills);
  visit(registry.global_skills_auto_discovered);
  return known;
}

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
const known = collectKnownFiles(registry);

// agents/**/skills/**/*.{cjs,js,py}
let foundAgentSkills = [];
for (const dir of findSkillsDirs(path.join(ROOT, 'agents'))) {
  walk(dir, foundAgentSkills);
}

// skills/**/*.{cjs,js,py}  (raíz de skills/, excluyendo el propio registro y _quarantine)
const foundSkillsRoot = walk(path.join(ROOT, 'skills'));

const SELF_PATH = path.relative(ROOT, __filename).replace(/\\/g, '/');
const allFound = [...new Set([...foundAgentSkills, ...foundSkillsRoot])];
const nuevos = allFound.filter(f => !known.has(f) && f !== SELF_PATH);

registry.global_skills_auto_discovered = registry.global_skills_auto_discovered || [];
const yaListados = new Set(registry.global_skills_auto_discovered.map(s => s.file));
nuevos.forEach(f => {
  if (yaListados.has(f)) return;
  registry.global_skills_auto_discovered.push({
    id: path.basename(f, path.extname(f)),
    file: f,
    sync_note: 'Detectado por el escaneo ampliado (.cjs+.js+.py) — Fase 1 "Visibilidad y Censo", 2026-08-04.',
  });
});

// Poda: solo global_skills_auto_discovered es propiedad de este script (las demás
// secciones son curadas a mano); una entrada aquí cuyo 'file' ya no existe en disco
// es basura de una skill eliminada (Fase 3 "Saneamiento") — se retira.
const antes = registry.global_skills_auto_discovered.length;
registry.global_skills_auto_discovered = registry.global_skills_auto_discovered.filter(s => {
  const existe = fs.existsSync(path.join(ROOT, s.file));
  if (!existe) console.log(`  - podado (ya no existe): ${s.file}`);
  return existe;
});
const podados = antes - registry.global_skills_auto_discovered.length;

registry.sync_method = 'Glob ampliado: agents/**/skills/**/*.{cjs,js,py} + skills/**/*.{cjs,js,py} (antes solo *.cjs). Punto ciego de extensiones cerrado en Fase 1; poda de entradas huérfanas añadida en Fase 3, 2026-08-04.';
registry.last_migration = '2026-08-04';

fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf8');

console.log(`[sync_registry] Escaneados ${allFound.length} archivos (.cjs/.js/.py). Nuevos: ${nuevos.length}. Podados: ${podados}.`);
nuevos.forEach(f => console.log(`  + ${f}`));
