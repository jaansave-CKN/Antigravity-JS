"""
nodes.py — Implementaciones async de cada nodo del grafo LangGraph (Fase 3).

Contrato de cada nodo:
  async (state: FormulationState) -> Dict[str, Any]   ← actualización parcial

Fase 3 — nuevos nodos:
  node_benchmark_query     → consulta PostgreSQL, ajusta pesos APU dinámicamente
  node_red_team_evaluation → agente adversarial: OPEX, Financing >70%, SROI >1
  node_finalize            → sello SHA-256 sobre (payload_es + siv_log + tenant_id)

Compliance Estricto (Caja Negra):
  COMPLIANCE_DIRECTIVE se inyecta en TODOS los prompts generativos (M4, M5, M6, M10).
  Los agentes NO deben generar links externos. Toda norma técnica debe estar
  autocontenida en el output.

Manejo de errores:
  Ningún nodo lanza excepción al caller. Fallos se registran en state["errors"].
  EXCEPCIÓN: node_red_team_evaluation puede establecer red_team_passed=False,
  lo que causa que node_finalize marque el payload como RECHAZADO (no persistir).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import google.generativeai as genai
from google.generativeai import GenerationConfig

from .db import compute_apu_adjustments, query_regional_benchmark
from .state import FormulationState

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# DIRECTIVA DE COMPLIANCE ABSOLUTA (Fase 3 — Caja Negra)
# Se inyecta al inicio de TODOS los prompts generativos.
# ─────────────────────────────────────────────────────────────────────────────

COMPLIANCE_DIRECTIVE = """\
━━━ DIRECTIVA DE COMPLIANCE ABSOLUTA — PRECEDENCIA MÁXIMA ━━━
Esta directiva anula cualquier otra instrucción del sistema.

1. PROHIBIDO generar URLs, dominios, endpoints, QR codes o cualquier
   referencia a recursos externos de ningún tipo.

2. AUTOCONTENCIÓN NORMATIVA OBLIGATORIA: Toda norma técnica, resolución
   o especificación (NSR-10, NTC, ISO, CONPES, Ley, Decreto) debe incluir
   el texto literal del requisito aplicable. Formato exigido:
     "NSR-10, Título A, Art. A.1.3.3: [texto literal del artículo...]"
   Si no puedes incluir el texto exacto con >90% de certeza, usa:
     [TEXTO_PENDIENTE_VERIFICACION: <nombre_norma>, <artículo>]

3. Las memorias descriptivas deben ser AUTOCONTENIDAS: un evaluador sin
   acceso a internet debe verificar la compliance leyendo solo el documento.

4. PROHIBIDO referencias implícitas como "ver página web de la entidad",
   "consultar el portal de DNP", "disponible en www..." o equivalentes.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""


def _with_compliance(prompt: str) -> str:
    """Antepone la directiva de compliance a cualquier prompt generativo."""
    return COMPLIANCE_DIRECTIVE + "\n" + prompt


# ── Cliente Gemini ────────────────────────────────────────────────────────────

_last_configured_key: Optional[str] = None


def _get_model(
    api_key: Optional[str],
    model_name: str = "gemini-1.5-flash",
    temperature: float = 0.1,
    max_tokens: int = 4096,
) -> genai.GenerativeModel:
    global _last_configured_key
    key = api_key or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_ERROR: GOOGLE_API_KEY no configurada")
    if key != _last_configured_key:
        genai.configure(api_key=key)
        _last_configured_key = key
    return genai.GenerativeModel(
        model_name=model_name,
        generation_config=GenerationConfig(
            response_mime_type="application/json",
            temperature=temperature,
            max_output_tokens=max_tokens,
        ),
    )


def _parse_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return json.loads(text)


# ─────────────────────────────────────────────────────────────────────────────
# [Fase 3] BENCHMARK — Data Network Effect
# ─────────────────────────────────────────────────────────────────────────────

async def node_benchmark_query(state: FormulationState) -> Dict[str, Any]:
    """
    Consulta la tasa de éxito histórica en PostgreSQL para la misma región/sector.
    Calcula multiplicadores APU dinámicos basados en los resultados.

    Este nodo corre ANTES del fan-out paralelo M4/M5/M6 para que los nodos
    downstream tengan acceso a `apu_weight_adjustments` y `regional_benchmark`.

    Degradación graceful: si la BD no responde, retorna ajustes neutros (×1.0)
    y el grafo continúa sin interrupciones.
    """
    ficha = state["ficha_tecnica"]
    departamento = ficha.get("departamento") or ""
    municipio    = ficha.get("municipio") or ""
    sector       = ficha.get("sector") or ficha.get("sector_codigo") or "infraestructura"

    try:
        benchmark = await query_regional_benchmark(departamento, municipio, sector)
        adjustments = compute_apu_adjustments(benchmark)

        if benchmark.get("benchmark_active"):
            logger.info(
                "[BENCHMARK] %s / %s: %.1f%% éxito, %d proyectos → contingencia ×%.3f",
                departamento, sector,
                benchmark["success_rate_pct"],
                benchmark["total_count"],
                adjustments["contingencia"],
            )
        else:
            logger.info("[BENCHMARK] Sin datos suficientes — ajustes neutros aplicados")

        return {
            "regional_benchmark":    benchmark,
            "apu_weight_adjustments": adjustments,
            "errors":   [],
            "warnings": [] if benchmark.get("benchmark_active") else
                        ["BENCHMARK: Sin datos regionales — pesos APU sin ajuste"],
        }

    except Exception as exc:
        logger.error("[BENCHMARK] Error inesperado: %s", exc)
        return {
            "regional_benchmark":    None,
            "apu_weight_adjustments": None,
            "errors":   [f"BENCHMARK_ERROR: {exc}"],
            "warnings": [],
        }


# ─────────────────────────────────────────────────────────────────────────────
# M4 — Árbol de Objetivos (nodo paralelo, compliance inyectada)
# ─────────────────────────────────────────────────────────────────────────────

async def node_m4_arbol_objetivos(state: FormulationState) -> Dict[str, Any]:
    """Genera árbol de objetivos MGA/BPIN. Corre en paralelo con M5 y M6."""
    ficha = state["ficha_tecnica"]
    objetivo = (
        ficha.get("objetivo_central") or ficha.get("objetivos")
        or ficha.get("nombre") or "Proyecto de inversión pública"
    )

    prompt = _with_compliance(f"""
Eres un formulador experto en proyectos MGA/BPIN del Sistema Nacional de Evaluación
de Gestión y Resultados de Colombia.

Genera un árbol de objetivos completo para el siguiente proyecto.

OBJETIVO CENTRAL: {objetivo}
SECTOR: {ficha.get("sector", "No especificado")}
MUNICIPIO: {ficha.get("municipio", "No especificado")}
POBLACIÓN: {ficha.get("poblacion", "No especificada")}

JERARQUÍA MGA OBLIGATORIA:
- FIN (nivel 0): impacto socioeconómico de largo plazo. Solo 1 nodo.
- PROPÓSITO (nivel 1): resultado directo del proyecto. Solo 1 nodo.
- COMPONENTES (nivel 2): 3 a 5 productos entregables medibles.
- ACTIVIDADES (nivel 3): 2 actividades por componente, verbo en infinitivo.

Toda referencia normativa debe incluir el texto literal del artículo aplicable
(no solo el código de la norma). Ver Directiva de Compliance al inicio.

FORMATO JSON REQUERIDO:
{{
  "objetivo_central": "<texto>",
  "nodos": [
    {{
      "id": "F1", "tipo": "fin", "nivel": 0,
      "texto": "<impacto de largo plazo>", "parent_id": null
    }},
    {{
      "id": "P1", "tipo": "proposito", "nivel": 1,
      "texto": "<objetivo central>", "parent_id": "F1"
    }},
    {{
      "id": "C1", "tipo": "componente", "nivel": 2,
      "texto": "<producto sustantivo>", "parent_id": "P1",
      "indicador": "<indicador SMART>", "meta": "<valor cuantificable>",
      "norma_aplicable": "<norma con texto literal autocontenido>"
    }},
    {{
      "id": "A1", "tipo": "actividad", "nivel": 3,
      "texto": "<verbo infinitivo + objeto>", "parent_id": "C1"
    }}
  ],
  "total_nodos": <número>
}}""")

    try:
        model = _get_model(state.get("api_key"), "gemini-1.5-flash", 0.1, 4096)
        response = await model.generate_content_async(prompt)
        data = _parse_json(response.text)
        nodos = data.get("nodos", [])
        logger.info("[M4] %d nodos generados — proyecto %s", len(nodos), state["proyecto_id"])
        return {"arbol_objetivos": nodos, "errors": [], "warnings": []}
    except Exception as exc:
        logger.error("[M4] Error: %s", exc)
        return {"arbol_objetivos": [], "errors": [f"M4_ERROR: {exc}"], "warnings": []}


# ─────────────────────────────────────────────────────────────────────────────
# M5 — Marco Normativo (nodo paralelo, compliance inyectada)
# ─────────────────────────────────────────────────────────────────────────────

async def node_m5_marco_normativo(state: FormulationState) -> Dict[str, Any]:
    """Genera marco normativo aplicable. Corre en paralelo con M4 y M6."""
    ficha = state["ficha_tecnica"]
    sector = ficha.get("sector_codigo") or ficha.get("sector") or "infraestructura"

    prompt = _with_compliance(f"""
Eres un abogado especialista en contratación pública colombiana.

Genera el marco normativo para el siguiente proyecto.

SECTOR: {sector}
MUNICIPIO: {ficha.get("municipio", "")} — {ficha.get("departamento", "")}
DESCRIPCIÓN: {ficha.get("descripcion") or ficha.get("nombre") or "Proyecto"}

REGLAS CRÍTICAS:
1. Solo incluye normas que EXISTAN REALMENTE y estén vigentes en Colombia a 2025.
2. Para cada norma, incluye el texto literal del artículo aplicable (Directiva Compliance).
3. Si tienes <90% de certeza, NO la incluyas o usa [TEXTO_PENDIENTE_VERIFICACION: ...].

FORMATO JSON:
{{
  "sector": "{sector}",
  "normas": [
    {{
      "tipo": "ley|decreto|conpes|resolucion|norma_tecnica",
      "codigo": "<número y año>",
      "titulo": "<título oficial>",
      "texto_aplicable": "<texto literal del artículo aplicable — OBLIGATORIO>",
      "articulos_relevantes": ["Art. X — alcance"],
      "aplica_porque": "<razón específica para este proyecto>"
    }}
  ],
  "principios_rectores": ["<principio>"],
  "fuentes_financiacion_tipicas": ["<fondo>"],
  "advertencias": ["<advertencia si aplica>"]
}}""")

    try:
        model = _get_model(state.get("api_key"), "gemini-1.5-flash", 0.05, 3072)
        response = await model.generate_content_async(prompt)
        data = _parse_json(response.text)
        advertencias = data.pop("advertencias", [])
        logger.info("[M5] %d normas — proyecto %s", len(data.get("normas", [])), state["proyecto_id"])
        return {
            "marco_normativo": data, "errors": [],
            "warnings": [f"M5: {a}" for a in advertencias],
        }
    except Exception as exc:
        logger.error("[M5] Error: %s", exc)
        return {
            "marco_normativo": {"normas": [], "generation_error": str(exc)},
            "errors": [f"M5_ERROR: {exc}"], "warnings": [],
        }


# ─────────────────────────────────────────────────────────────────────────────
# M6 — Match Score (nodo paralelo, compliance inyectada)
# ─────────────────────────────────────────────────────────────────────────────

async def node_m6_match_score(state: FormulationState) -> Dict[str, Any]:
    """
    Calcula match score conceptual contra fondos públicos.
    STATELESS: sin acceso a BD. Node.js cruza este score con pgvector.
    Incluye el benchmark regional si ya está en el estado.
    """
    ficha = state["ficha_tecnica"]
    benchmark = state.get("regional_benchmark") or {}
    success_rate = benchmark.get("success_rate_pct", 50) if benchmark.get("benchmark_active") else None
    benchmark_context = (
        f"\nCONTEXTO REGIONAL: Tasa de éxito histórica en {ficha.get('departamento','')} "
        f"/ {ficha.get('sector','')}: {success_rate:.1f}% ({benchmark.get('total_count',0)} proyectos)"
        if success_rate is not None else ""
    )

    prompt = _with_compliance(f"""
Eres un evaluador experto en elegibilidad para fondos públicos colombianos.
{benchmark_context}

Evalúa la pertinencia del siguiente proyecto para financiamiento público.

PROYECTO:
- Nombre: {ficha.get("nombre", "Sin nombre")}
- Sector: {ficha.get("sector", "No especificado")}
- Municipio: {ficha.get("municipio", "")} / {ficha.get("departamento", "")}
- Descripción: {ficha.get("descripcion", "Sin descripción")}
- Presupuesto: {ficha.get("metaFisicaTotal", "No definido")}
- Población: {ficha.get("poblacion", "No especificada")}

CRITERIOS (0–100 cada uno):
1. pertinencia_sectorial
2. viabilidad_territorial
3. coherencia_presupuestal
4. articulacion_politicas
5. potencial_cofinanciacion

FORMATO JSON:
{{
  "scores": {{
    "pertinencia_sectorial": <0-100>,
    "viabilidad_territorial": <0-100>,
    "coherencia_presupuestal": <0-100>,
    "articulacion_politicas": <0-100>,
    "potencial_cofinanciacion": <0-100>
  }},
  "score_total": <promedio ponderado 0-100>,
  "fondos_recomendados": [
    {{"fondo": "<nombre>", "pertinencia": <0-100>, "razon": "<por qué aplica>"}}
  ],
  "cobertura_financiamiento_estimada_pct": <0-100>,
  "opex_ratio_estimado": <0.0-1.0>,
  "sroi_estimado": <float>,
  "fortalezas": ["<fortaleza>"],
  "brechas": ["<brecha>"],
  "recomendacion_ejecutiva": "<1 oración>"
}}""")

    try:
        model = _get_model(state.get("api_key"), "gemini-1.5-flash", 0.1, 2048)
        response = await model.generate_content_async(prompt)
        data = _parse_json(response.text)
        logger.info("[M6] score_total=%s — proyecto %s", data.get("score_total"), state["proyecto_id"])
        return {"match_score": data, "errors": [], "warnings": []}
    except Exception as exc:
        logger.error("[M6] Error: %s", exc)
        return {
            "match_score": {"score_total": 0, "generation_error": str(exc)},
            "errors": [f"M6_ERROR: {exc}"], "warnings": [],
        }


# ─────────────────────────────────────────────────────────────────────────────
# CONSOLIDATE — Fan-in: merge M4 + M5 + M6
# ─────────────────────────────────────────────────────────────────────────────

async def node_consolidate(state: FormulationState) -> Dict[str, Any]:
    """Fan-in: LangGraph lo ejecuta SOLO cuando M4, M5 y M6 han terminado."""
    ficha   = state["ficha_tecnica"]
    nombre  = ficha.get("nombre") or ficha.get("name") or "Proyecto sin nombre"
    ajustes = state.get("apu_weight_adjustments")

    payload_es: Dict[str, Any] = {
        "version":      "3.0",
        "idioma":       "es",
        "generado_en":  datetime.now(timezone.utc).isoformat(),
        "generado_por": "ai_service/langgraph-fase3",
        "proyecto": {
            "id":            state["proyecto_id"],
            "nombre":        nombre,
            "ficha_tecnica": ficha,
        },
        "arbol_objetivos":      state.get("arbol_objetivos") or [],
        "marco_normativo":      state.get("marco_normativo") or {},
        "match_score":          state.get("match_score") or {},
        "apu_weight_adjustments": ajustes,
        "regional_benchmark":   state.get("regional_benchmark"),
        "bibliographic_citations": None,
    }

    logger.info("[CONSOLIDATE] payload_es v3.0 ensamblado — proyecto %s", state["proyecto_id"])
    return {"payload_es": payload_es, "errors": [], "warnings": []}


# ─────────────────────────────────────────────────────────────────────────────
# M10 — Generación de Citas (compliance inyectada, loop-aware)
# ─────────────────────────────────────────────────────────────────────────────

async def node_m10_generate_citations(state: FormulationState) -> Dict[str, Any]:
    """
    Genera citas bibliográficas autocontenidas para aseveraciones técnicas.
    La Directiva de Compliance prohíbe URLs y exige texto literal de normas.
    """
    payload_es  = state.get("payload_es") or {}
    loop_count  = state.get("citation_loop_count", 0)
    corrections = state.get("citation_corrections") or []

    content = {
        "arbol_objetivos": (payload_es.get("arbol_objetivos") or [])[:15],
        "marco_normativo":  payload_es.get("marco_normativo") or {},
        "ficha_tecnica":    payload_es.get("proyecto", {}).get("ficha_tecnica") or {},
    }

    correction_block = ""
    if loop_count > 0 and corrections:
        correction_block = f"""
⚠️ ITERACIÓN {loop_count + 1} — CORRECCIONES DE ALUCINACIONES PREVIAS:
{chr(10).join(f'  [{i+1}] {c}' for i, c in enumerate(corrections))}

Para estas citas: si no puedes verificar con certeza absoluta → usa "SIN_CITA_VERIFICABLE".
"""

    prompt = _with_compliance(f"""
Eres un auditor de citas normativas en proyectos MGA/BPIN colombianos.
{correction_block}
TAREA: Genera citas bibliográficas verificables y AUTOCONTENIDAS.

REGLAS:
1. Solo cita normas cuya existencia puedas confirmar con >95% de certeza.
2. Incluye el texto literal relevante del artículo (Directiva Compliance).
3. Nunca inventes artículos, fechas o títulos de normas.
4. Si hay duda: "citation": "SIN_CITA_VERIFICABLE"
5. PROHIBIDO cualquier URL o referencia a recursos externos.

PROYECTO:
{json.dumps(content, ensure_ascii=False, indent=2)}

FORMATO JSON:
{{
  "citations": [
    {{
      "claim": "<aseveración técnica>",
      "citation": "<cita exacta o SIN_CITA_VERIFICABLE>",
      "texto_literal": "<fragmento literal de la norma — obligatorio si verified=true>",
      "verified": true|false,
      "needs_human_review": true|false,
      "confidence": <0.0-1.0>
    }}
  ],
  "uncited_claims": <número>,
  "compliance_score": <0-100>,
  "review_required": true|false
}}""")

    try:
        model = _get_model(state.get("api_key"), "gemini-1.5-pro", 0.05, 4096)
        response = await model.generate_content_async(prompt)
        data = _parse_json(response.text)
        logger.info(
            "[M10-GEN] Loop %d: compliance=%s — proyecto %s",
            loop_count + 1, data.get("compliance_score"), state["proyecto_id"]
        )
        return {"citations": data, "errors": [], "warnings": []}
    except Exception as exc:
        logger.error("[M10-GEN] Error loop %d: %s", loop_count + 1, exc)
        return {
            "citations": {
                "citations": [], "uncited_claims": 0,
                "compliance_score": 0, "review_required": True,
                "generation_error": str(exc),
            },
            "errors": [f"M10_GEN_ERROR(loop {loop_count+1}): {exc}"], "warnings": [],
        }


# ─────────────────────────────────────────────────────────────────────────────
# M10 Audit — Detector de Alucinaciones
# ─────────────────────────────────────────────────────────────────────────────

async def node_m10_audit_citations(state: FormulationState) -> Dict[str, Any]:
    """
    Auditor independiente: detecta referencias normativas fabricadas.
    Fail-open: si el auditor falla, aprueba y registra en warnings.
    """
    citations_data  = state.get("citations") or {}
    loop_count      = state.get("citation_loop_count", 0)
    max_loops       = state.get("max_citation_loops", 3)
    new_loop_count  = loop_count + 1
    citations_list  = citations_data.get("citations", [])
    compliance_score = citations_data.get("compliance_score", 0)

    if not citations_list or citations_data.get("generation_error"):
        return {
            "citation_loop_count": new_loop_count,
            "citation_approved": True,
            "citation_hallucinations_found": False,
            "citation_corrections": [],
            "warnings": ["M10_AUDIT: Sin citas — avanzando sin auditoría"],
            "errors": [],
        }

    sample = [
        {"claim": c.get("claim","")[:200], "citation": c.get("citation",""), "verified": c.get("verified", False)}
        for c in citations_list[:20]
    ]

    prompt = f"""Eres un auditor forense de referencias normativas colombianas.

MISIÓN: Detectar ALUCINACIONES (referencias inventadas) en estas citas.

DEFINICIÓN de alucinación: ley con número inexistente, CONPES con año incorrecto,
artículo que no pertenece a la norma, fecha de expedición inventada.
"SIN_CITA_VERIFICABLE" NO es alucinación — es honestidad.

CITAS:
{json.dumps(sample, ensure_ascii=False, indent=2)}

FORMATO JSON:
{{
  "verification_results": [
    {{"citation": "<cita>", "status": "verified|hallucination|uncertain", "reason": "<razón si no verified>"}}
  ],
  "hallucinations_found": true|false,
  "hallucination_count": <número>,
  "uncertain_count": <número>,
  "corrections_needed": ["<instrucción específica de corrección>"],
  "overall_reliability": <0.0-1.0>
}}"""

    try:
        model = _get_model(state.get("api_key"), "gemini-1.5-flash", 0.05, 2048)
        response = await model.generate_content_async(prompt)
        audit = _parse_json(response.text)

        hallucinations_found = audit.get("hallucinations_found", False)
        hallucination_count  = audit.get("hallucination_count", 0)
        corrections          = audit.get("corrections_needed", [])

        approved = (not hallucinations_found) or (compliance_score >= 70 and hallucination_count == 0)

        if new_loop_count >= max_loops and not approved:
            logger.warning("[M10-AUDIT] Límite %d/%d — forzando avance", new_loop_count, max_loops)
            approved = True

        enriched = {**citations_data, "audit_result": audit, "final_loop_count": new_loop_count, "final_approved": approved}
        logger.info("[M10-AUDIT] Loop %d/%d: hallucinations=%d approved=%s", new_loop_count, max_loops, hallucination_count, approved)

        return {
            "citations": enriched,
            "citation_loop_count": new_loop_count,
            "citation_approved": approved,
            "citation_hallucinations_found": hallucinations_found and not approved,
            "citation_corrections": corrections if not approved else [],
            "errors": [],
            "warnings": [] if approved else [f"M10_AUDIT: {hallucination_count} alucinación(es) — loop {new_loop_count}/{max_loops}"],
        }
    except Exception as exc:
        logger.error("[M10-AUDIT] Error loop %d: %s", new_loop_count, exc)
        return {
            "citation_loop_count": new_loop_count,
            "citation_approved": True,
            "citation_hallucinations_found": False,
            "citation_corrections": [],
            "errors": [],
            "warnings": [f"M10_AUDIT_ERROR: {exc} — avanzando sin verificación"],
        }


# ─────────────────────────────────────────────────────────────────────────────
# [Fase 3] RED TEAM — Agente Adversarial (Hard Constraints SIV)
# ─────────────────────────────────────────────────────────────────────────────

async def node_red_team_evaluation(state: FormulationState) -> Dict[str, Any]:
    """
    Agente adversarial que evalúa el Score Integral de Viabilidad (SIV).

    RESTRICCIONES DURAS (Hard Constraints) — incumplimiento = RECHAZO:
      1. OPEX_RATIO        ≤ 0.30  (costos operativos ≤ 30% del presupuesto)
      2. FINANCING_COVERAGE ≥ 0.70  (financiamiento externo ≥ 70% del costo total)
      3. SROI              > 1.0   (beneficio social neto > inversión)

    Si ALGUNA restricción falla:
      · red_team_passed = False
      · El payload queda marcado como RECHAZADO_HARD_CONSTRAINT
      · Node.js NO persiste el payload (interpreta el status)

    Si TODAS pasan:
      · red_team_passed = True
      · El pipeline avanza a finalize con sello criptográfico
    """
    payload_es   = state.get("payload_es") or {}
    match_score  = state.get("match_score") or {}
    ficha        = state["ficha_tecnica"]
    benchmark    = state.get("regional_benchmark") or {}

    # Valores pre-calculados por M6 si están disponibles
    financing_est = match_score.get("cobertura_financiamiento_estimada_pct", None)
    opex_est      = match_score.get("opex_ratio_estimado", None)
    sroi_est      = match_score.get("sroi_estimado", None)

    benchmark_context = ""
    if benchmark.get("benchmark_active"):
        benchmark_context = f"""
CONTEXTO REGIONAL (benchmark histórico):
  - Tasa de éxito: {benchmark.get('success_rate_pct', 0):.1f}%
  - Score promedio: {benchmark.get('avg_audit_score', 0):.1f}/100
  - Muestra: {benchmark.get('total_count', 0)} proyectos
"""

    pre_estimates = ""
    if any(x is not None for x in [financing_est, opex_est, sroi_est]):
        pre_estimates = f"""
ESTIMADOS PRE-CALCULADOS POR M6 (usar como base, puedes ajustar):
  - Cobertura de financiamiento estimada: {financing_est}%
  - OPEX ratio estimado: {opex_est}
  - SROI estimado: {sroi_est}
"""

    prompt = f"""Eres un Auditor de Riesgo Institucional de máxima jerarquía.

TU MISIÓN: Evaluar el Score Integral de Viabilidad (SIV) y aplicar las
RESTRICCIONES DURAS. Eres el último filtro antes de la formulación final.
Debes buscar activamente razones para RECHAZAR el proyecto.
{benchmark_context}
{pre_estimates}

RESTRICCIONES DURAS — NO NEGOCIABLES:

1. OPEX_RATIO (máx 30%):
   costos_operativos_anuales / inversión_total ≤ 0.30
   Incluye: administración, operación, mantenimiento post-construcción.

2. FINANCING_COVERAGE (mín 70%):
   financiamiento_externo / inversión_total ≥ 0.70
   Fuentes válidas: SGR, MinAgricultura, MinTransporte, cooperación intl.

3. SROI (mín 1.0):
   beneficio_social_neto / inversión_total > 1.0
   Calcular: beneficiarios × beneficio_unitario_anual × vida_útil / inversión

PROYECTO A EVALUAR:
Nombre: {ficha.get("nombre", "Sin nombre")}
Sector: {ficha.get("sector", "")}
Municipio: {ficha.get("municipio", "")} / {ficha.get("departamento", "")}
Presupuesto total: {ficha.get("metaFisicaTotal", "No especificado")}
Población beneficiaria: {ficha.get("poblacion", "No especificada")}
Árbol de objetivos: {len(payload_es.get("arbol_objetivos", []))} nodos generados
Normas del marco: {len((payload_es.get("marco_normativo") or {{}}).get("normas", []))} normas

INSTRUCCIONES DE EVALUACIÓN:
1. Extrae o estima los valores de OPEX, financiamiento y SROI del proyecto.
2. Aplica cada restricción dura — sé conservador, no optimista.
3. Si algún valor es incierto, usa el peor escenario razonable.
4. Calcula el SIV score (0-100) como promedio ponderado:
   - OPEX_RATIO:          peso 30% (penaliza si excede threshold)
   - FINANCING_COVERAGE:  peso 40% (el más crítico para viabilidad)
   - SROI:               peso 30%

FORMATO JSON ESTRICTO:
{{
  "siv_score": <0-100>,
  "constraints": {{
    "opex_ratio": {{
      "value": <float 0-1>,
      "threshold": 0.30,
      "passed": true|false,
      "details": "<cálculo y razonamiento>"
    }},
    "financing_coverage": {{
      "value": <float 0-1>,
      "threshold": 0.70,
      "passed": true|false,
      "details": "<fuentes identificadas y cobertura estimada>"
    }},
    "sroi": {{
      "value": <float>,
      "threshold": 1.0,
      "passed": true|false,
      "details": "<cálculo: beneficiarios × beneficio_unitario × vida_útil / inversión>"
    }}
  }},
  "overall_passed": true|false,
  "hard_constraints_failed": ["OPEX_RATIO"|"FINANCING_COVERAGE"|"SROI"],
  "recommendation": "<veredicto ejecutivo en 1-2 oraciones>",
  "hard_constraint_report": {{
    "fecha_evaluacion": "<ISO 8601>",
    "evaluador": "Red Team Agent v3 — RadarFondos 360",
    "proyecto": "{ficha.get("nombre", "")}",
    "constraints_fallidos": ["<lista>"],
    "causa_raiz": "<análisis de causa raíz>",
    "recomendaciones_para_reformulacion": ["<acción concreta 1>", "<acción 2>"],
    "override_possible": false
  }}
}}"""

    try:
        model = _get_model(state.get("api_key"), "gemini-1.5-pro", 0.05, 3072)
        response = await model.generate_content_async(prompt)
        red_team = _parse_json(response.text)

        passed   = red_team.get("overall_passed", False)
        siv_log  = {
            "siv_score":               red_team.get("siv_score"),
            "constraints":             red_team.get("constraints"),
            "hard_constraints_failed": red_team.get("hard_constraints_failed", []),
            "evaluated_at":            datetime.now(timezone.utc).isoformat(),
            "benchmark_used":          benchmark.get("benchmark_active", False),
        }

        if passed:
            logger.info("[RED_TEAM] APROBADO — SIV=%.1f — proyecto %s", red_team.get("siv_score", 0), state["proyecto_id"])
        else:
            logger.warning(
                "[RED_TEAM] RECHAZADO — Hard constraints fallidos: %s — proyecto %s",
                red_team.get("hard_constraints_failed"), state["proyecto_id"]
            )

        return {
            "red_team_result": red_team,
            "red_team_passed": passed,
            "siv_log":         siv_log,
            "errors":   [] if passed else [f"RED_TEAM_REJECT: {red_team.get('hard_constraints_failed')}"],
            "warnings": [],
        }

    except Exception as exc:
        logger.error("[RED_TEAM] Error en evaluación SIV: %s", exc)
        # Fail-open: si el Red Team falla por error técnico, aprobar con warning
        return {
            "red_team_result": {"error": str(exc), "overall_passed": True},
            "red_team_passed": True,
            "siv_log":         {"error": str(exc), "evaluated_at": datetime.now(timezone.utc).isoformat()},
            "errors":   [],
            "warnings": [f"RED_TEAM_ERROR: {exc} — evaluación SIV omitida"],
        }


# ─────────────────────────────────────────────────────────────────────────────
# FINALIZE — Sello SHA-256 + ensamblaje final
# ─────────────────────────────────────────────────────────────────────────────

async def node_finalize(state: FormulationState) -> Dict[str, Any]:
    """
    Nodo terminal. Responsabilidades:
      1. Enriquecer payload_es con citas y resultado Red Team.
      2. Calcular SHA-256(payload_es + siv_log + tenant_id).
      3. Si red_team_passed=False: marcar como RECHAZADO_HARD_CONSTRAINT.
         Node.js interpreta este status y NO persiste el payload en Supabase.
    """
    payload_es   = dict(state.get("payload_es") or {})
    citations    = state.get("citations") or {}
    approved     = state.get("citation_approved", False)
    loop_count   = state.get("citation_loop_count", 0)
    max_loops    = state.get("max_citation_loops", 3)
    red_team     = state.get("red_team_result") or {}
    red_passed   = state.get("red_team_passed", True)
    siv_log      = state.get("siv_log") or {}
    tenant_id    = state["tenant_id"]
    proyecto_id  = state["proyecto_id"]

    # ── Enriquecer payload con resultados de citas ────────────────────────────
    payload_es["bibliographic_citations"] = {
        **citations,
        "approved":          approved,
        "loop_count":        loop_count,
        "needs_human_review": not approved or citations.get("review_required", False) or loop_count >= max_loops,
    }

    # ── Red Team: anotar resultado en payload ─────────────────────────────────
    payload_es["red_team_evaluation"] = {
        "passed":          red_passed,
        "siv_score":       red_team.get("siv_score"),
        "constraints":     red_team.get("constraints"),
        "hard_constraints_failed": red_team.get("hard_constraints_failed", []),
        "evaluated_at":    siv_log.get("evaluated_at"),
    }
    payload_es["finalizado_en"] = datetime.now(timezone.utc).isoformat()

    # ── Sello Criptográfico SHA-256 ───────────────────────────────────────────
    # Combina: payload_es (canónico) + siv_log + tenant_id
    # sort_keys=True y separators compactos garantizan serialización determinista.
    seal_input = json.dumps(
        {
            "payload_es": payload_es,
            "siv_log":    siv_log,
            "tenant_id":  tenant_id,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,   # serializar tipos no-JSON (datetime, UUID, etc.)
    )
    payload_hash = hashlib.sha256(seal_input.encode("utf-8")).hexdigest()

    # ── Anotar hash en el payload para referencia ─────────────────────────────
    payload_es["payload_hash"] = payload_hash

    if red_passed:
        logger.info(
            "[FINALIZE] Pipeline completo — proyecto %s | hash=%s...%s | SIV=%.1f",
            proyecto_id, payload_hash[:8], payload_hash[-6:],
            red_team.get("siv_score", 0),
        )
    else:
        logger.warning(
            "[FINALIZE] RECHAZADO por Red Team — proyecto %s | hash=%s...%s | "
            "Constraints fallidos: %s",
            proyecto_id, payload_hash[:8], payload_hash[-6:],
            red_team.get("hard_constraints_failed"),
        )

    return {
        "payload_es":  payload_es,
        "payload_hash": payload_hash,
        "errors":   [],
        "warnings": [] if red_passed else [
            "RED_TEAM: Proyecto RECHAZADO — Node.js no debe persistir este payload"
        ],
    }
