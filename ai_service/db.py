"""
db.py — Conexión asyncpg al PostgreSQL compartido con Node.js.

PROPÓSITO: Solo lectura. Consulta estadísticas regionales para el
Data Network Effect (benchmarking de tasa de éxito por departamento/sector).

GARANTÍAS:
  · El pool se inicializa una sola vez (singleton async-safe).
  · Toda query tiene timeout de 5 segundos — no bloquea el pipeline principal.
  · Graceful degradation: si la BD no está disponible, retorna benchmark vacío
    y el grafo continúa sin APU adjustments. El pipeline NO se aborta.
  · Solo extrae agregados anónimos (COUNT, AVG) — no expone datos individuales.
    Si el tamaño de muestra < MIN_SAMPLE, retorna vacío para evitar
    de-anonimización de tenants con pocos proyectos.

PRIVACIDAD:
  La query NO filtra por tenant_id — accede a estadísticas cross-tenant.
  Pero solo retorna COUNT/AVG: ningún dato individual es recuperable.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import asyncpg

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None

MIN_SAMPLE = 5          # mínimo de proyectos para retornar benchmark
QUERY_TIMEOUT = 5.0     # segundos


async def _get_pool() -> Optional[asyncpg.Pool]:
    """Retorna el pool singleton, inicializándolo si es necesario."""
    global _pool

    if _pool is not None:
        return _pool

    url = os.environ.get("DATABASE_URL")
    if not url:
        logger.warning("[db] DATABASE_URL no configurada — benchmark desactivado")
        return None

    try:
        # Quitar sslmode del URL si existe (asyncpg usa ssl= directamente)
        clean_url = url.split("?")[0] if "sslmode" in url else url
        is_local = "localhost" in clean_url or "127.0.0.1" in clean_url

        _pool = await asyncpg.create_pool(
            clean_url,
            min_size=1,
            max_size=4,
            command_timeout=QUERY_TIMEOUT,
            ssl="require" if not is_local else None,
        )
        logger.info("[db] Pool asyncpg creado — benchmark regional activo")
        return _pool

    except Exception as exc:
        logger.warning("[db] No se pudo crear pool asyncpg: %s — benchmark desactivado", exc)
        return None


# ── Benchmark regional ────────────────────────────────────────────────────────

async def query_regional_benchmark(
    departamento: str,
    municipio: str,
    sector: str,
) -> Dict[str, Any]:
    """
    Consulta la tasa de éxito histórica de proyectos en la misma región y sector.

    Retorna un dict con:
      total_count       — proyectos en la región/sector (últimos 3 años)
      successful_count  — proyectos en estado 'formulado' o 'in_review'
      success_rate_pct  — porcentaje de éxito (0-100)
      avg_audit_score   — puntuación de auditoría promedio
      benchmark_active  — False si no hay datos suficientes o BD no disponible
    """
    pool = await _get_pool()
    if not pool:
        return _empty_benchmark(reason="pool_unavailable")

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    COUNT(*)
                        FILTER (WHERE status IN ('formulado', 'in_review'))
                        AS successful_count,
                    COUNT(*) AS total_count,
                    COALESCE(ROUND(AVG(audit_score)::numeric, 2), 0)
                        AS avg_audit_score,
                    COALESCE(
                        ROUND(
                            100.0
                            * COUNT(*) FILTER (WHERE status IN ('formulado','in_review'))
                            / NULLIF(COUNT(*), 0),
                            2
                        ),
                        0
                    ) AS success_rate_pct
                FROM projects
                WHERE
                    (
                        ficha_tecnica->>'departamento' ILIKE $1
                        OR ficha_tecnica->>'municipio'  ILIKE $2
                    )
                    AND ficha_tecnica->>'sector' ILIKE $3
                    AND created_at > NOW() - INTERVAL '3 years'
                    AND status IS NOT NULL
                """,
                f"%{departamento}%",
                f"%{municipio}%",
                f"%{sector}%",
                timeout=QUERY_TIMEOUT,
            )

        if not row or row["total_count"] < MIN_SAMPLE:
            return _empty_benchmark(reason="insufficient_sample", count=row["total_count"] if row else 0)

        result = {
            "total_count":      int(row["total_count"]),
            "successful_count": int(row["successful_count"]),
            "success_rate_pct": float(row["success_rate_pct"]),
            "avg_audit_score":  float(row["avg_audit_score"]),
            "departamento":     departamento,
            "sector":           sector,
            "benchmark_active": True,
        }
        logger.info(
            "[db] Benchmark regional: %d proyectos, %.1f%% éxito — %s / %s",
            result["total_count"], result["success_rate_pct"], departamento, sector,
        )
        return result

    except Exception as exc:
        logger.warning("[db] Error en query benchmark: %s", exc)
        return _empty_benchmark(reason=f"query_error: {type(exc).__name__}")


def _empty_benchmark(reason: str = "unavailable", count: int = 0) -> Dict[str, Any]:
    return {
        "total_count":      count,
        "successful_count": 0,
        "success_rate_pct": 50.0,   # neutral: no adjustment
        "avg_audit_score":  70.0,   # neutral: no adjustment
        "benchmark_active": False,
        "reason":           reason,
    }


# ── APU Weight Adjustments ────────────────────────────────────────────────────

def compute_apu_adjustments(benchmark: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calcula multiplicadores dinámicos para cada partida APU basados en
    la tasa de éxito regional.

    Lógica:
      · Éxito alto   (>60%)  + score alto (>75): precios regionales confiables →
        contingencia normal, sin sobrecosto.
      · Éxito medio  (40-60%): contingencia +10% como margen de seguridad.
      · Éxito bajo   (<40%)  o score bajo (<60): mercado inestable →
        contingencia +20%, AIU +5%.
    """
    if not benchmark.get("benchmark_active", False):
        return {
            "mano_de_obra":   1.0,
            "materiales":     1.0,
            "equipos":        1.0,
            "aiu":            1.0,
            "contingencia":   1.0,
            "confidence":     "no_data",
            "sample_size":    benchmark.get("total_count", 0),
            "adjustment_applied": False,
        }

    success_rate = benchmark.get("success_rate_pct", 50.0) / 100.0
    avg_score    = benchmark.get("avg_audit_score", 70.0) or 70.0
    sample       = benchmark.get("total_count", 0)

    # Contingencia: hasta +24% si éxito < 40%
    contingencia_mult = 1.0 + max(0.0, 0.6 - success_rate) * 0.4

    # AIU: hasta +5% si score promedio < 65
    aiu_mult = 1.0 + max(0.0, 65.0 - avg_score) / 200.0

    # Materiales: leve ajuste si éxito < 50% (mercado regional más caro)
    materiales_mult = 1.0 + max(0.0, 0.5 - success_rate) * 0.1

    confidence = "high" if sample > 20 else "medium" if sample >= MIN_SAMPLE else "low"

    return {
        "mano_de_obra":   1.0,
        "materiales":     round(materiales_mult, 3),
        "equipos":        1.0,
        "aiu":            round(aiu_mult, 3),
        "contingencia":   round(contingencia_mult, 3),
        "confidence":     confidence,
        "sample_size":    sample,
        "success_rate_pct": benchmark.get("success_rate_pct"),
        "avg_audit_score":  avg_score,
        "adjustment_applied": True,
    }
