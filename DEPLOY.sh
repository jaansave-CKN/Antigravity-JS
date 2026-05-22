#!/bin/bash
# ============================================
# RAILWAY DEPLOY - COMANDO ÚNICO
# ============================================

echo "=== PREPARANDO DESPLIEGUE ==="
git add .
git commit -m "Deploy v1.0 - Go-Live"

echo "=== SUBIENDO A RAILWAY ==="
railway up --service backend --dockerfile Dockerfile

echo "=== DEPLOY COMPLETADO ==="
echo "URL: https://$(railway domain)"