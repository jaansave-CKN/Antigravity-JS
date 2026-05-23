#!/bin/bash
# Startup script - serves frontend + API from same process

echo "Starting RadarFondos 360..."

cd /app || exit 1

# Install dependencies and build frontend
npm install
npm run build

# Start FastAPI server (serves API + static frontend)
exec python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port "${PORT:-10000}"