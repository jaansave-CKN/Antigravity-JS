#!/bin/bash
# Startup script for RadarFondos 360 en Railway

echo "Starting RadarFondos 360..."

# Build frontend
cd /app
npm install
npm run build

# Initialize database tables
python -c "from backend.database import init_db; from backend.normative_engine import init_normative_tables; init_db(); init_normative_tables()"

# Initialize default admin
python /app/backend/init_admin.py

# Start FastAPI server
exec python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port ${PORT:-8000}