#!/usr/bin/env bash
# Ejecutar en Git Bash desde la raíz del proyecto (usa el .env local).
set -euo pipefail
REPO="jaansave-CKN/Antigravity-JS"

# ── Secretos de GitHub Actions para Playwright (gh CLI autenticado) ──────────
# DATABASE_URL: la misma BD que usa el E2E local (pooler IPv4 de Supabase).
gh secret set DATABASE_URL   --repo "$REPO" --body "$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"
# JWT_SECRET y ENCRYPTION_KEY: valores NUEVOS solo para CI (no reutilizar los de producción).
openssl rand -hex 32 | gh secret set JWT_SECRET     --repo "$REPO"
openssl rand -hex 32 | gh secret set ENCRYPTION_KEY --repo "$REPO"
gh secret list --repo "$REPO"

# ── LLM_MAX_LLAMADAS_POR_MINUTO=30 en producción (Render) ───────────────────
# RENDER_API_KEY: la llave rnd_… de Desktop/claves_privadas-3.txt
RENDER_SERVICE_ID="srv-d89pvbb7uimc739q7vtg"
curl -s -X PUT "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars/LLM_MAX_LLAMADAS_POR_MINUTO" \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
  -d '{"value":"30"}'
# Aplicar la variable (Render solo la toma en un deploy nuevo):
curl -s -X POST "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" -d '{}'
