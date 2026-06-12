"""
schemas.py — Modelos Pydantic para los endpoints FastAPI (Fase 3).

FormulateRequest  → payload entrante de Node.js
FormulateResponse → respuesta estateless con sello criptográfico y evaluación Red Team
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class FormulateRequest(BaseModel):
    proyecto_id: str = Field(..., description="UUID del proyecto en PostgreSQL")
    tenant_id: str = Field(..., description="UUID del tenant — aislamiento RLS")
    ficha_tecnica: Dict[str, Any] = Field(
        ..., description="Datos completos de la ficha técnica"
    )
    modulos: List[str] = Field(
        default=["arbol_objetivos", "marco_normativo", "match_score"],
    )
    api_key: Optional[str] = Field(
        None,
        description="Google API key resuelta por CredentialVault en Node.js",
    )
    max_citation_loops: int = Field(default=3, ge=1, le=5)

    model_config = {"json_schema_extra": {
        "example": {
            "proyecto_id": "uuid-del-proyecto",
            "tenant_id":   "uuid-del-tenant",
            "ficha_tecnica": {
                "nombre":         "Construcción acueducto veredal",
                "sector":         "Agua potable y saneamiento",
                "sector_codigo":  "agua",
                "municipio":      "Tibirita",
                "departamento":   "Cundinamarca",
                "objetivo_central": "Mejorar acceso a agua potable de 450 familias",
                "poblacion":      "450 familias rurales",
                "metaFisicaTotal": "COP 2.800.000.000",
            },
            "max_citation_loops": 3,
        }
    }}


class RedTeamConstraint(BaseModel):
    """Resultado individual de una restricción dura del Red Team."""
    value:     Optional[float] = None
    threshold: float
    passed:    bool
    details:   str


class RedTeamResult(BaseModel):
    """Reporte completo del agente Red Team (SIV)."""
    siv_score:               float = 0.0
    overall_passed:          bool  = False
    hard_constraints_failed: List[str] = Field(default_factory=list)
    constraints: Dict[str, Any] = Field(default_factory=dict)
    recommendation:          str  = ""
    hard_constraint_report:  Optional[Dict[str, Any]] = None


class FormulateResponse(BaseModel):
    proyecto_id: str
    tenant_id:   str
    status: str = Field(
        ...,
        description=(
            "'completed' | 'needs_human_review' | 'partial' | 'failed' | "
            "'RECHAZADO_HARD_CONSTRAINT'"
        ),
    )

    # ── Resultados de módulos paralelos ───────────────────────────────────────
    arbol_objetivos: Optional[List[Dict[str, Any]]] = None
    marco_normativo: Optional[Dict[str, Any]] = None
    match_score:     Optional[Dict[str, Any]] = None

    # ── Auditoría de citas ────────────────────────────────────────────────────
    citation_audit:      Optional[Dict[str, Any]] = None
    citation_loop_count: int  = 0
    citation_approved:   bool = False

    # ── [Fase 3] Benchmarking regional ───────────────────────────────────────
    regional_benchmark:     Optional[Dict[str, Any]] = None
    apu_weight_adjustments: Optional[Dict[str, Any]] = None

    # ── [Fase 3] Red Team — evaluación SIV ───────────────────────────────────
    red_team_result: Optional[Dict[str, Any]] = None
    red_team_passed: bool = False
    siv_log:         Optional[Dict[str, Any]] = None

    # ── [Fase 3] Sello criptográfico ─────────────────────────────────────────
    payload_hash: Optional[str] = Field(
        None,
        description="SHA-256(payload_es + siv_log + tenant_id) — fingerprint inmutable",
    )

    # ── Payload consolidado → Node.js lo persiste en Supabase ────────────────
    payload_es: Dict[str, Any]

    # ── Diagnósticos ──────────────────────────────────────────────────────────
    errors:            List[str] = Field(default_factory=list)
    warnings:          List[str] = Field(default_factory=list)
    processing_time_ms: int      = 0
    generated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
