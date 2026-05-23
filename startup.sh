#!/bin/bash
# Startup script - serves frontend + API from same process

echo "Starting RadarFondos 360..."

cd /app || exit 1

# Install Python dependencies (Render node env usually has python3)
pip3 install -r requirements.txt 2>/dev/null || pip install -r requirements.txt 2>/dev/null || echo "pip install skipped (will use bundled)"

# Build frontend if dist/ doesn't exist
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then
  echo "Building frontend..."
  npm install && npm run build
fi

# Try python3 first, fall back to python
PYTHON=$(command -v python3 || command -v python || echo "")
if [ -z "$PYTHON" ]; then
  echo "ERROR: Python not found. Install python3 or use a different env."
  exit 1
fi

echo "Using Python: $PYTHON"
exec $PYTHON -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port "${PORT:-10000}"