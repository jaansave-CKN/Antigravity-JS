#!/usr/bin/env bash
# Purga del historial de main: SOLO los .png de la RAÍZ del proyecto.
# Nunca toca client/public, src/assets ni ningún archivo dentro de carpetas.
# Ejecutar en Git Bash desde una carpeta vacía FUERA del proyecto.
set -euo pipefail

REPO="https://github.com/jaansave-CKN/Antigravity-JS.git"
STAMP="$(date +%Y%m%d-%H%M)"

command -v git-filter-repo >/dev/null 2>&1 || python -m pip install --user git-filter-repo

# 1. Respaldo espejo de TODO el remoto (todas las ramas). Es la vuelta atrás.
git clone --mirror "$REPO" "respaldo-antigravity-$STAMP.git"

# 2. Clon fresco de SOLO main. Con --single-branch, "--all" del paso 6
#    empuja únicamente main: master (app padre) y las demás ramas quedan intactas.
git clone --single-branch --branch main "$REPO" "cirugia-$STAMP"
cd "cirugia-$STAMP"
HEAD_ANTES="$(git rev-parse HEAD)"

# 3. Lista exacta: .png sin "/" en la ruta = solo raíz.
git log --name-only --format= | grep -E '^[^/]+\.png$' | sort -u > ../png_raiz.txt
echo "PNG de raíz a purgar: $(wc -l < ../png_raiz.txt)"   # esperado: 138
if grep -qE '/' ../png_raiz.txt; then echo "ABORTADO: la lista contiene rutas con carpeta"; exit 1; fi

# 4. Reescritura del historial.
git filter-repo --paths-from-file ../png_raiz.txt --invert-paths --force

# 5. Verificaciones antes de publicar.
QUEDAN="$(git log --name-only --format= | grep -cE '^[^/]+\.png$' || true)"
[ "$QUEDAN" = "0" ] || { echo "ABORTADO: quedan $QUEDAN PNG de raíz"; exit 1; }
git ls-files 'client/public/*' | grep -iqE '\.(png|jpe?g|svg)$' || { echo "ABORTADO: faltan imágenes de client/public"; exit 1; }
[ "$(git branch --format='%(refname:short)')" = "main" ] || { echo "ABORTADO: hay ramas distintas de main en el clon"; exit 1; }

# 6. Publicación forzada (filter-repo elimina el remote: se vuelve a añadir).
git remote add origin "$REPO"
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$HEAD_ANTES" ] || { echo "ABORTADO: main cambió en el remoto durante la cirugía"; exit 1; }
git push origin --force --all

echo "OK. Respaldo en: respaldo-antigravity-$STAMP.git"
echo "Re-sincroniza tu copia local:  git fetch origin && git reset --hard origin/main"
