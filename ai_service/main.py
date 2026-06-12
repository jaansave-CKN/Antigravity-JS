"""
main.py — FastAPI microservicio de Extracción Cognitiva (Fase 3: Autonomía Institucional).

Endpoints:
  POST /api/v1/formulate  — Pipeline LangGraph completo (8 nodos)
  GET  /health            — Liveness probe para Railway / Render

DISEÑO ESTATELESS:
  Este servicio NO escribe en ninguna base de datos.
  Retorna el `payload_es` consolidado y Node.js lo persiste en Supabase
  usando withTenant() + RLS (implementado en Fase 1 — formularProyectoInversion.js).

  EXCEPCIÓN: si red_team_passed=False, Node.js NO debe persistir el payload.
  El status "RECHAZADO_HARD_CONSTRAINT" es la señal para que Node.js aborte.

ARRANQUE:
  uvicorn ai_service.main:app --host 0.0.0.0 --port 8100 --workers 2
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import _get_pool
from .graph import formulation_graph
from .schemas import FormulateRequest, FormulateResponse
from .state import FormulationState

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

load_dotenv()

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-calentar el pool asyncpg en startup (fail-open)
    try:
        await _get_pool()
    except Exception as exc:
        logger.warning("[AI Service] Pool PostgreSQL no disponible en startup: %s", exc)

    logger.info(
        "[AI Service] Fase 3 iniciada — LangGraph 8-nodos compilado | "
        "GOOGLE_API_KEY configurada: %s | "
        "DATABASE_URL configurada: %s",
        bool(os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")),
        bool(os.environ.get("DATABASE_URL")),
    )
    yield
    logger.info("[AI Service] Apagando")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="RadarFondos AI Service",
    description=(
        "Microservicio de Autonomía Institucional — Fase 3.\n\n"
        "Pipeline LangGraph 8 nodos:\n"
        "1. `benchmark_query` — Data Network Effect (PostgreSQL)\n"
        "2-4. `m4/m5/m6` — paralelo (Árbol, Normativo, Match Score)\n"
        "5. `consolidate` — fan-in\n"
        "6-7. `m10` — citas + bucle anti-alucinaciones\n"
        "8. `red_team_evaluation` — Agente Adversarial SIV (OPEX/Financing/SROI)\n"
        "9. `finalize` — Sello SHA-256"
    ),
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

# CORS — en producción restringir a la URL del backend Node.js
_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "Authorization", "X-Tenant-ID"],
)


# ── Manejador global de errores ───────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("[AI Service] Error no manejado en %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": f"Internal server error: {type(exc).__name__}"},
    )


# ── POST /api/v1/formulate ────────────────────────────────────────────────────

@app.post(
    "/api/v1/formulate",
    response_model=FormulateResponse,
    summary="Pipeline de formulación IA (Fase 3)",
    description=(
        "Ejecuta el pipeline completo de 8 nodos LangGraph:\n\n"
        "- **Benchmark regional** (PostgreSQL asyncpg)\n"
        "- **M4/M5/M6** en paralelo (Árbol de Objetivos, Marco Normativo, Match Score)\n"
        "- **M10** con bucle anti-alucinaciones (máx `max_citation_loops` iteraciones)\n"
        "- **Red Team** (evaluación SIV: OPEX ≤30%, Financing ≥70%, SROI >1)\n"
        "- **Finalize** con Sello SHA-256\n\n"
        "**Stateless**: no persiste nada en BD. Node.js recibe el `payload_es` "
        "y lo guarda en Supabase vía RLS. Si `status == RECHAZADO_HARD_CONSTRAINT`, "
        "Node.js NO debe persistir."
    ),
)
async def formulate(
    request: FormulateRequest,
    x_tenant_id: str | None = Header(None, alias="X-Tenant-ID"),
) -> FormulateResponse:
    tenant_id = request.tenant_id or x_tenant_id
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tenant_id es obligatorio (body o header X-Tenant-ID)",
        )

    start_ts = time.monotonic()

    logger.info(
        "[formulate] Iniciando Fase 3 — proyecto=%s tenant=%s modulos=%s",
        request.proyecto_id, tenant_id, request.modulos,
    )

    # ── Estado inicial del grafo ──────────────────────────────────────────────
    initial_state: FormulationState = {
        "proyecto_id":        request.proyecto_id,
        "tenant_id":          tenant_id,
        "ficha_tecnica":      request.ficha_tecnica,
        "modulos":            request.modulos,
        "api_key":            request.api_key,
        "max_citation_loops": request.max_citation_loops,
        # [Fase 3] Benchmark regional — llenado por node_benchmark_query
        "regional_benchmark":     None,
        "apu_weight_adjustments": None,
        # Parallel module outputs — None = pendiente
        "arbol_objetivos": None,
        "marco_normativo":  None,
        "match_score":      None,
        # M10 citation loop state
        "citations":                     None,
        "citation_loop_count":           0,
        "citation_approved":             False,
        "citation_hallucinations_found": False,
        "citation_corrections":          None,
        # [Fase 3] Red Team SIV
        "red_team_result": None,
        "red_team_passed": True,   # optimistic default; el nodo lo sobrescribe
        "siv_log":         None,
        # Output final
        "payload_es":   None,
        # [Fase 3] Sello criptográfico
        "payload_hash": None,
        # Diagnostics — reducers de lista
        "errors":   [],
        "warnings": [],
    }

    # ── Invocar grafo ─────────────────────────────────────────────────────────
    try:
        final_state: FormulationState = await formulation_graph.ainvoke(
            initial_state,
            # recursion_limit: circuit breaker de última línea.
            # 8 nodos + máx 3 loops M10 × 2 nodos = ~14 activaciones. 30 = margen seguro.
            config={"recursion_limit": 30},
        )
    except Exception as exc:
        logger.error(
            "[formulate] Pipeline fallido — proyecto=%s: %s",
            request.proyecto_id, exc, exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline LangGraph error: {exc}",
        )

    elapsed_ms = int((time.monotonic() - start_ts) * 1000)

    # ── Extraer campos del estado final ──────────────────────────────────────
    payload_es    = final_state.get("payload_es") or {}
    errors        = final_state.get("errors") or []
    warnings      = final_state.get("warnings") or []
    loop_count    = final_state.get("citation_loop_count", 0)
    approved      = final_state.get("citation_approved", False)
    red_passed    = final_state.get("red_team_passed", True)
    payload_hash  = final_state.get("payload_hash")
    red_team_res  = final_state.get("red_team_result")
    siv_log       = final_state.get("siv_log")

    # ── Determinar status final ───────────────────────────────────────────────
    bib_citations = payload_es.get("bibliographic_citations") or {}
    needs_review  = bib_citations.get("needs_human_review", not approved)

    if not red_passed:
        # Hard Constraint fallado — Node.js NO persiste
        final_status = "RECHAZADO_HARD_CONSTRAINT"
    elif not payload_es or (errors and len(errors) >= 3):
        final_status = "failed"
    elif needs_review or loop_count >= request.max_citation_loops:
        final_status = "needs_human_review"
    elif errors:
        final_status = "partial"
    else:
        final_status = "completed"

    logger.info(
        "[formulate] Completado — proyecto=%s status=%s loops=%d red_team=%s "
        "hash=%s tiempo=%dms errors=%d",
        request.proyecto_id, final_status, loop_count,
        "PASS" if red_passed else "FAIL",
        payload_hash[:12] + "..." if payload_hash else "None",
        elapsed_ms, len(errors),
    )

    return FormulateResponse(
        proyecto_id=request.proyecto_id,
        tenant_id=tenant_id,
        status=final_status,
        arbol_objetivos=final_state.get("arbol_objetivos"),
        marco_normativo=final_state.get("marco_normativo"),
        match_score=final_state.get("match_score"),
        citation_audit=final_state.get("citations"),
        citation_loop_count=loop_count,
        citation_approved=approved,
        # [Fase 3]
        regional_benchmark=final_state.get("regional_benchmark"),
        apu_weight_adjustments=final_state.get("apu_weight_adjustments"),
        red_team_result=red_team_res,
        red_team_passed=red_passed,
        siv_log=siv_log,
        payload_hash=payload_hash,
        payload_es=payload_es,
        errors=errors,
        warnings=warnings,
        processing_time_ms=elapsed_ms,
    )


# ── GET /health ───────────────────────────────────────────────────────────────

@app.get("/health", summary="Liveness probe")
async def health() -> dict:
    """Railway / Render liveness probe."""
    return {
        "status":  "ok",
        "service": "ai_service",
        "version": "3.0.0",
        "gemini_configured": bool(
            os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        ),
        "database_configured": bool(os.environ.get("DATABASE_URL")),
    }
