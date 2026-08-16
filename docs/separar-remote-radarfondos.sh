#!/usr/bin/env bash
# separar-remote-radarfondos.sh
#
# Generado 2026-08-16 por auditoria forense de Antigravity JS (docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md
# §0-AJ.9) -- hallazgo: proyectos/Proy_03_RadarFondos/.git y el repo raiz de Antigravity JS apuntan al
# MISMO remote de GitHub (https://github.com/jaansave-CKN/Antigravity-JS.git), en ramas distintas
# (RadarFondos usa "main", el raiz usa "master"), sin ancestro comun. El propio .gitignore del repo raiz
# ya documenta que esto causo una colision real una vez.
#
# NO SE EJECUTO AUTOMATICAMENTE. Requiere una decision humana antes de correr:
#   1. Un repositorio GitHub NUEVO y dedicado para RadarFondos 360 (nombre/visibilidad a tu criterio).
#      Crealo manualmente en github.com, o con GitHub CLI ya autenticado:
#        gh repo create jaansave-CKN/RadarFondos-360 --private --confirm
#   2. Confirmar que ningun colaborador/CI/despliegue (Render, GitHub Actions) depende hoy de que
#      Proy_03_RadarFondos empuje al remote compartido actual -- si algo apunta ahi, ajustalo primero.
#
# Estado real verificado al generar este script (2026-08-16):
#   proyectos/Proy_03_RadarFondos tiene MULTIPLES ramas y worktrees activos (.kilo/worktrees/), y su
#   rama "main" esta 7 commits adelante de "origin/main" sin pushear -- confirma que es un proyecto en
#   desarrollo activo independiente. Revisa 'git branch -vv' y 'git worktree list' antes de tocar nada.
#
# Ejecutar DENTRO del working tree de Proy_03_RadarFondos (ajusta la ruta si corres esto desde otro lugar):
#   cd "proyectos/Proy_03_RadarFondos" && bash ../../docs/separar-remote-radarfondos.sh

set -euo pipefail

echo "== Estado actual (verificacion antes de tocar nada) =="
git remote -v
git branch -vv
git status --short

if [ -n "$(git status --porcelain)" ]; then
  echo "" >&2
  echo "Hay cambios sin commitear en este repo -- resuelvelos (commit o stash) antes de continuar." >&2
  exit 1
fi

# --- AJUSTA ESTA LINEA con la URL real del repo nuevo que hayas creado en el paso 1 ---
NUEVO_REMOTE_URL="https://github.com/jaansave-CKN/RadarFondos-360.git"

RAMA_ACTUAL="$(git rev-parse --abbrev-ref HEAD)"
echo ""
echo "Rama actual a empujar al nuevo remote: ${RAMA_ACTUAL}"
read -r -p "¿Confirmas que '${NUEVO_REMOTE_URL}' es el repo GitHub dedicado ya creado? (escribe 'si' para continuar) " CONFIRMACION
if [ "${CONFIRMACION}" != "si" ]; then
  echo "Cancelado -- no se toco ningun remote." >&2
  exit 1
fi

# 1. Renombra el remote compartido -- lo deja como referencia de solo lectura, evita pushes accidentales
#    de aqui en adelante al repo raiz de Antigravity JS.
git remote rename origin origin-shared-antigravity-js-DO-NOT-PUSH

# 2. Agrega el remote nuevo, dedicado, como "origin"
git remote add origin "${NUEVO_REMOTE_URL}"

# 3. Empuja el historial completo de la rama actual al remote nuevo (preserva todos los commits ya hechos,
#    incluidos los 7 que hoy estan solo en local sin llegar a ningun remote)
git push -u origin "${RAMA_ACTUAL}"

echo ""
echo "== Verificacion final =="
git remote -v
echo ""
echo "'origin' ahora apunta al repo dedicado de RadarFondos 360."
echo "'origin-shared-antigravity-js-DO-NOT-PUSH' queda como referencia de solo lectura del remote viejo."
echo "Una vez confirmes que todo funciona (CI, despliegue, colaboradores), puedes eliminarlo con:"
echo "  git remote remove origin-shared-antigravity-js-DO-NOT-PUSH"
echo ""
echo "PENDIENTE MANUAL: este script solo separa el remote de Proy_03_RadarFondos. Las otras ramas/worktrees"
echo "de este mismo repo (railway/fix-deploy-*, respaldo-2026-07-22, los worktrees .kilo/) siguen apuntando"
echo "al remote compartido hasta que corras 'git push origin <rama>' de cada una contra el nuevo origin."
