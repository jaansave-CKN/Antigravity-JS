#!/bin/bash
cd /app
pip install -r requirements.txt
python -c "from backend.auth_system import init_auth_tables; from backend.normative_engine import init_normative_tables; init_auth_tables(); init_normative_tables()"
python backend/init_admin.py 2>/dev/null || true
exec python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port ${PORT:-8000}