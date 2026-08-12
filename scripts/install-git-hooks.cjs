// install-git-hooks.cjs — instala el wrapper de .git/hooks/pre-commit que
// invoca scripts/pre-commit.sh (la lógica real, versionada). Corre
// automáticamente en `npm install` vía el script "prepare" de package.json,
// así cada clone del repo queda protegido sin un paso manual.
//
// Por qué existe: .git/hooks/ nunca se versiona con git (comportamiento
// estándar, no un bug) — sin este instalador, el gate de "cero código sin
// diseño aprobado" dependería de que cada persona/máquina lo copie a mano,
// y un hook ausente o desactualizado no se detecta con ningún git diff.

const fs = require('fs');
const path = require('path');

const dirRoot = path.join(__dirname, '..');
const hooksDir = path.join(dirRoot, '.git', 'hooks');
const hookPath = path.join(hooksDir, 'pre-commit');

const WRAPPER = `#!/bin/sh
# Wrapper delgado — NO editar aquí. La lógica real vive en scripts/pre-commit.sh
# (versionada por git). Este archivo lo repone \`node scripts/install-git-hooks.cjs\`
# (corre automático en \`npm install\`) — cualquier edición manual de ESTE
# archivo se pierde en la próxima instalación, a propósito.
exec sh "$(dirname "$0")/../../scripts/pre-commit.sh" "$@"
`;

if (!fs.existsSync(path.join(dirRoot, '.git'))) {
  console.log('[install-git-hooks] No es un repositorio git (sin carpeta .git/) — nada que instalar, saliendo sin error.');
  process.exit(0);
}

fs.mkdirSync(hooksDir, { recursive: true });
fs.writeFileSync(hookPath, WRAPPER, { mode: 0o755 });
try {
  fs.chmodSync(hookPath, 0o755);
} catch {
  // chmod puede fallar en algunos filesystems de Windows — el bit de
  // ejecución no siempre importa ahí (git bash resuelve por shebang).
}

console.log('[install-git-hooks] .git/hooks/pre-commit instalado — invoca scripts/pre-commit.sh (versionado).');
