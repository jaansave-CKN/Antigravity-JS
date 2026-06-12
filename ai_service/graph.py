"""
graph.py — StateGraph LangGraph del pipeline de formulación (Fase 3).

Topología completa (8 nodos):

  START ──► benchmark_query ──┬──► m4_arbol_objetivos ──┐
                              ├──► m5_marco_normativo   ├──► consolidate
                              └──► m6_match_score      ──┘
                                                            │
                                                            ▼
                                               m10_generate_citations
                                                            │
                                                            ▼
                                               m10_audit_citations
                                               │                │
                               alucinaciones   │                │  aprobado
                               Y count < max   │                │  O count >= max
                                               ▼                ▼
                                  m10_generate_citations   red_team_evaluation
                                                                │
                                                                ▼ (siempre)
                                                            finalize ──► END

Cambios Fase 3 respecto a la topología original:

  1. `benchmark_query` se inserta ANTES del fan-out (START → benchmark_query).
     Esto garantiza que regional_benchmark y apu_weight_adjustments estén
     disponibles en M5 y M6 durante su ejecución paralela.

  2. El loop de auditoría M10 termina en `red_team_evaluation` (no en `finalize`).

  3. `red_team_evaluation` conecta SIEMPRE a `finalize`:
     - Si red_team_passed=True  → finalize sella y el pipeline retorna "completed".
     - Si red_team_passed=False → finalize marca RECHAZADO_HARD_CONSTRAINT.
     Node.js interpreta el status para decidir si persistir en Supabase.

Ejecución paralela:
  LangGraph detecta que M4, M5, M6 comparten el mismo predecesor (benchmark_query)
  y no tienen dependencias entre sí → los ejecuta como corrutinas concurrentes.
  `consolidate` actúa como fan-in: se activa solo cuando los 3 terminan.

Límites de seguridad:
  `recursion_limit=20` en main.py actúa como circuit breaker de última línea.
  El bucle de citas tiene `max_citation_loops` (por defecto 3) como límite
  de aplicación antes de forzar avance.
"""

from __future__ import annotations

from typing import Literal

from langgraph.graph import END, START, StateGraph

from .nodes import (
    node_benchmark_query,
    node_consolidate,
    node_finalize,
    node_m10_audit_citations,
    node_m10_generate_citations,
    node_m4_arbol_objetivos,
    node_m5_marco_normativo,
    node_m6_match_score,
    node_red_team_evaluation,
)
from .state import FormulationState


# ── Enrutador condicional: bucle anti-alucinaciones ──────────────────────────

def _route_after_audit(
    state: FormulationState,
) -> Literal["m10_generate_citations", "red_team_evaluation"]:
    """
    Decide si se necesita otra iteración de generación de citas o si pasar
    a la evaluación Red Team.

    Condición de loop (re-genera si AMBOS son true):
      · citation_hallucinations_found == True  (auditor detectó alucinaciones)
      · citation_loop_count < max_citation_loops  (límite no alcanzado)

    En cualquier otro caso → red_team_evaluation.
    """
    hallucinations = state.get("citation_hallucinations_found", False)
    loop_count     = state.get("citation_loop_count", 0)
    max_loops      = state.get("max_citation_loops", 3)

    if hallucinations and loop_count < max_loops:
        return "m10_generate_citations"

    return "red_team_evaluation"


# ── Construcción del grafo ────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    """Construye, conecta y compila el StateGraph de formulación (Fase 3)."""
    builder = StateGraph(FormulationState)

    # ── Registrar nodos ───────────────────────────────────────────────────────
    builder.add_node("benchmark_query",          node_benchmark_query)
    builder.add_node("m4_arbol_objetivos",       node_m4_arbol_objetivos)
    builder.add_node("m5_marco_normativo",       node_m5_marco_normativo)
    builder.add_node("m6_match_score",           node_m6_match_score)
    builder.add_node("consolidate",              node_consolidate)
    builder.add_node("m10_generate_citations",   node_m10_generate_citations)
    builder.add_node("m10_audit_citations",      node_m10_audit_citations)
    builder.add_node("red_team_evaluation",      node_red_team_evaluation)
    builder.add_node("finalize",                 node_finalize)

    # ── Paso 1: benchmark antes del fan-out ───────────────────────────────────
    # benchmark_query consulta PostgreSQL para obtener tasas de éxito regionales
    # y ajustes APU. Sus resultados estarán disponibles en M5 y M6.
    builder.add_edge(START, "benchmark_query")

    # ── Paso 2: fan-out paralelo M4 / M5 / M6 ────────────────────────────────
    # LangGraph los schedula como corrutinas concurrentes desde benchmark_query.
    builder.add_edge("benchmark_query", "m4_arbol_objetivos")
    builder.add_edge("benchmark_query", "m5_marco_normativo")
    builder.add_edge("benchmark_query", "m6_match_score")

    # ── Paso 3: fan-in — consolidate espera a los 3 nodos paralelos ──────────
    builder.add_edge("m4_arbol_objetivos", "consolidate")
    builder.add_edge("m5_marco_normativo", "consolidate")
    builder.add_edge("m6_match_score",     "consolidate")

    # ── Paso 4: pipeline de citas M10 (secuencial) ───────────────────────────
    builder.add_edge("consolidate",            "m10_generate_citations")
    builder.add_edge("m10_generate_citations", "m10_audit_citations")

    # ── Paso 5: bucle anti-alucinaciones → Red Team ───────────────────────────
    builder.add_conditional_edges(
        "m10_audit_citations",
        _route_after_audit,
        {
            "m10_generate_citations": "m10_generate_citations",  # ← loop
            "red_team_evaluation":    "red_team_evaluation",     # ← avance
        },
    )

    # ── Paso 6: Red Team → finalize (siempre, pase o falle) ──────────────────
    # red_team_evaluation NUNCA bloquea el pipeline — fija red_team_passed en
    # el estado y deja que finalize y Node.js decidan si persistir.
    builder.add_edge("red_team_evaluation", "finalize")

    # ── Paso 7: nodo terminal ─────────────────────────────────────────────────
    builder.add_edge("finalize", END)

    return builder.compile()


# Instancia singleton — compilada una vez al importar el módulo.
# FastAPI la reutiliza en cada request sin overhead de recompilación.
formulation_graph = build_graph()
