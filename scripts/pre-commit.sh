#!/bin/sh
# Gate de arquitectura obligatorio — "cero código sin diseño aprobado"
# (Axioma II.1, AGENTS.md). Sin costo de API por commit: solo valida que exista
# una aprobación vigente de node agents/architecture-gate.cjs --aprobar-diseno.
#
# VERSIONADO (2026-08-12, auditoría "reloj suizo"): este archivo vive en
# scripts/ (bajo control de git) en vez de ser solo .git/hooks/pre-commit
# (que git NUNCA versiona por diseño — cualquiera con acceso al disco podía
# borrarlo/editarlo sin que ningún git diff/log lo mostrara jamás, el hueco
# más grande encontrado en la auditoría de esa fecha). .git/hooks/pre-commit
# ahora es un wrapper de 2 líneas que solo invoca este archivo — instalado
# automáticamente por scripts/install-git-hooks.cjs (corre en `npm install`
# vía el script "prepare" de package.json). Si el wrapper se borra, un
# `npm install` lo repone; si ESTE archivo (el que de verdad importa) se
# edita para debilitar el gate, el cambio queda en git history como
# cualquier otro, visible en diff/log/blame.
#
# NODE_BIN con fallback: el shell que invoca este hook (varía según quién
# commitee — terminal normal, herramienta con PATH reducido, etc.) no siempre
# tiene 'node' en PATH, aunque esté instalado. Sin este fallback, el hook
# falla con "command not found" y bloquea el commit sin haber podido evaluar
# nada — hallazgo real 2026-08-08, primera vez que el hook corrió en un
# commit real.
if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif [ -x "/c/Program Files/nodejs/node.exe" ]; then
  NODE_BIN="/c/Program Files/nodejs/node.exe"
else
  echo "🛑 [GATE_ARQUITECTURA] No se encontró 'node' en PATH ni en la ruta conocida de fallback — commit bloqueado (no se pudo verificar la aprobación)."
  exit 1
fi

"$NODE_BIN" agents/architecture-gate.cjs --check-gate
exit $?
