# Cirugía de historial git — purga de capturas PNG y separación del commit `2be41c5`

**Estado: NO EJECUTADO.** Reescribe la historia de `main` en un repositorio **público** y exige `push --force`, algo irreversible en el remoto. Ejecutar solo con confirmación explícita del dueño.

## Alcance verificado (2026-09-23)

- **138 PNG de la raíz** en la historia de `main` (capturas de calco/QA). Ninguna es usada por el código.
- **No se tocan** las 6 imágenes de la app en `client/public/` (`INICIO.jpg`, `hero-bg.jpg`, `collage.jpg`…). Un filtro global `*.png/*.jpg` las borraría **también del commit actual** y el siguiente deploy saldría sin imágenes.
- El remoto `jaansave-CKN/Antigravity-JS` tiene **13 ramas**, entre ellas `master` (app padre "Antigravity OS"). Solo se reescribe `main`.
- `2be41c5` mezcla seguridad (7 archivos) con limpieza (renombres a `archive/`, `__pycache__`, capturas). Tras la purga, las capturas desaparecen de ese commit por sí solas.

## Advertencias

- **Las capturas ya fueron públicas.** Reescribir la historia no borra copias en forks, clones, cachés ni en GitHub: los commits viejos siguen accesibles por SHA hasta que GitHub haga limpieza. Para retirarlos del todo hay que pedirlo a GitHub Support (formulario de datos sensibles).
- **Todos los SHA de `main` cambian.** Las ramas de Dependabot basadas en la historia vieja quedan huérfanas y hay que cerrarlas. Cualquier otro clon debe re-sincronizarse.
- El CI despliega el nuevo `HEAD` al hacer push, y el paso de espera busca el deploy por el SHA nuevo, así que no requiere cambios.

## Script (bash, desde una carpeta vacía fuera del proyecto)

```bash
set -euo pipefail
REPO=https://github.com/jaansave-CKN/Antigravity-JS.git

# 0. Herramienta
python -m pip install --user git-filter-repo

# 1. Respaldo COMPLETO del remoto (todas las ramas): es la vuelta atrás
git clone --mirror "$REPO" "respaldo-antigravity-$(date +%Y%m%d-%H%M).git"

# 2. Clon fresco SOLO de main (git filter-repo exige clon fresco)
git clone --single-branch --branch main "$REPO" cirugia
cd cirugia
HEAD_ANTES=$(git rev-parse HEAD)

# 3. Lista EXACTA: solo PNG de la raíz (sin "/" en la ruta) → nunca client/public
git log --name-only --format= | grep -E '^[^/]+\.png$' | sort -u > ../png_raiz.txt
wc -l ../png_raiz.txt                      # esperado: 138

# 4. Purga del historial de esas rutas
git filter-repo --paths-from-file ../png_raiz.txt --invert-paths --force

# 5. Separar el commit mixto (no interactivo: el editor de secuencia marca "edit")
OBJ=$(git log --format='%h' --grep='cierra 7 hallazgos abiertos' -1)
GIT_SEQUENCE_EDITOR="sed -i 's/^pick $OBJ /edit $OBJ /'" git rebase -i "$OBJ^"
git reset HEAD^
git add server.js reset_admin.js backend/middlewares/auth.middleware.js \
        backend/routes/wompi.webhook.js backend/payments/wompiProvider.js \
        package.json package-lock.json
git commit -m "fix(security): cierra 7 hallazgos abiertos de la auditoría 2026-09-23 sin tocar UI ni datos"
git add -A
git commit -m "chore(repo): limpieza — lanzadores rotos y código muerto a archive/, __pycache__ fuera del índice"
git rebase --continue

# 6. Verificar ANTES de publicar
git log --oneline | head -8
echo "PNG de raíz que quedan en la historia: $(git log --name-only --format= | grep -cE '^[^/]+\.png$' || true)"   # 0
git ls-files 'client/public/*'                                  # imágenes de la app presentes
npm ci && npx tsc --noEmit && npm run build

# 7. Publicar, solo si nadie empujó a main mientras tanto
git remote add origin "$REPO"                                   # filter-repo elimina el remote
test "$(git ls-remote origin refs/heads/main | cut -f1)" = "$HEAD_ANTES" || { echo "main cambió en el remoto — abortar"; exit 1; }
git push --force origin main

# 8. Re-sincronizar la copia de trabajo local del proyecto (conserva archivos ignorados como audit/privado y las capturas)
# cd "C:/2026 AI EGIOC5/Antigravity JS/proyectos/Proy_03_RadarFondos"
# git stash -u   # solo si hay cambios sin commitear
# git fetch origin && git reset --hard origin/main
```

## Vuelta atrás

Desde el espejo del paso 1: `git push --force origin <sha_viejo>:refs/heads/main`.
