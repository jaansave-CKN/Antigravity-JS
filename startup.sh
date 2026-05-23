#!/bin/bash
# Startup script - serves frontend + API from same process

echo "Starting RadarFondos 360..."

cd /app || exit 1

# Install Python dependencies
pip install -r requirements.txt 2>&1 | tail -1

# Build frontend (skip if already built by Render build phase)
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then
  echo "Building frontend..."
  npm install
  npm run build
else
  echo "Frontend already built, skipping..."
fi

# Start FastAPI server (serves API + static frontend)
exec python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port "${PORT:-10000}"