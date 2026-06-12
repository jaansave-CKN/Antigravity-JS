# ── Fase 3: Autonomía Institucional — AI Service Container ───────────────────
#
# Imagen dedicada para el microservicio Python FastAPI + LangGraph.
# STATELESS: no monta volúmenes de datos. Solo lee env vars.
#
# Build:
#   docker build -f ai_service/Dockerfile -t radarfondos-ai-service .
#
# Run (standalone):
#   docker run --env-file .env -p 8100:8100 radarfondos-ai-service

FROM python:3.12-slim AS base

# ── Sistema mínimo ────────────────────────────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl \
       build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Dependencias (capa cacheada — solo se reconstruye si requirements.txt cambia)
COPY ai_service/requirements.txt ./ai_service/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r ai_service/requirements.txt

# ── Código fuente del microservicio ──────────────────────────────────────────
COPY ai_service/ ./ai_service/

# ── Usuario no-root (hardening) ───────────────────────────────────────────────
RUN groupadd -r aiservice && useradd -r -g aiservice aiservice
USER aiservice

# ── Puerto expuesto ───────────────────────────────────────────────────────────
EXPOSE 8100

# ── Health check interno (Docker lo usa para depends_on: condition: service_healthy)
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8100/health || exit 1

# ── Variables de entorno por defecto (sobreescribibles en runtime) ────────────
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8100

# ── Arranque ──────────────────────────────────────────────────────────────────
# --workers 2: dos workers async. En Railway/Render con RAM baja, usar --workers 1.
CMD ["python", "-m", "uvicorn", "ai_service.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8100", \
     "--workers", "2", \
     "--log-level", "info"]
