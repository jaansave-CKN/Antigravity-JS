#!/bin/bash
# Startup script - serves frontend + API from same process

echo "Starting RadarFondos 360..."

cd /app || exit 1

# Build frontend if dist/ doesn't exist (local dev / non-Docker)
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then
  echo "Building frontend..."
  npm install && npm run build
fi

# Start FastAPI server (serves API + static frontend)
exec python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port "${PORT:-10000}"