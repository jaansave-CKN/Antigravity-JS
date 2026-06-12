"""
state.py — TypedDict compartido del pipeline LangGraph (Fase 3: Autonomía Institucional).

Reductores:
  `errors` y `warnings` usan `Annotated[List, operator.add]`: cuando las ramas
  paralelas M4/M5/M6 terminan, sus listas se concatenan sin sobreescribirse.
  Todos los demás campos usan last-write-wins (cada rama escribe keys distintos).

Contrato de inmutabilidad:
  Los campos de input (proyecto_id, tenant_id, ficha_tecnica, api_key) no son
  modificados por ningún nodo — solo se leen.

Fase 3 — campos nuevos:
  · regional_benchmark / apu_weight_adjustments → Data Network Effect
  · red_team_result / red_team_passed / siv_log  → Agente Red Team
  · payload_hash                                 → Sello Criptográfico SHA-256
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Dict, List, Optional
from typing_extensions import TypedDict


class FormulationState(TypedDict):
    # ── Input — inmutable durante toda la ejecución ───────────────────────────
    proyecto_id: str
    tenant_id: str
    ficha_tecnica: Dict[str, Any]
    modulos: List[str]
    api_key: Optional[str]
    max_citation_loops: int

    # ── [Fase 3 — Data Network Effect] Benchmark regional (PostgreSQL) ────────
    regional_benchmark: Optional[Dict[str, Any]]       # tasa de éxito por región
    apu_weight_adjustments: Optional[Dict[str, Any]]  # multiplicadores APU dinámicos

    # ── Salidas de módulos paralelos (M4, M5, M6) ─────────────────────────────
    arbol_objetivos: Optional[List[Dict[str, Any]]]   # M4
    marco_normativo: Optional[Dict[str, Any]]          # M5
    match_score: Optional[Dict[str, Any]]              # M6

    # ── Bucle de auditoría de citas M10 ───────────────────────────────────────
    citations: Optional[Dict[str, Any]]
    citation_loop_count: int
    citation_approved: bool
    citation_hallucinations_found: bool
    citation_corrections: Optional[List[str]]

    # ── [Fase 3 — Red Team] Evaluación adversarial pre-compilación ───────────
    red_team_result: Optional[Dict[str, Any]]  # evaluación completa SIV
    red_team_passed: bool                       # True = cumple todas las restricciones duras
    siv_log: Optional[Dict[str, Any]]          # log detallado OPEX/Financing/SROI

    # ── Payload final consolidado ─────────────────────────────────────────────
    payload_es: Optional[Dict[str, Any]]

    # ── [Fase 3 — Sello Criptográfico] SHA-256 ───────────────────────────────
    payload_hash: Optional[str]  # SHA-256(payload_es + siv_log + tenant_id)

    # ── Diagnósticos — reducers de lista (merge entre ramas paralelas) ────────
    errors:   Annotated[List[str], operator.add]
    warnings: Annotated[List[str], operator.add]
