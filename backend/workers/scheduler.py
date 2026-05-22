"""
backend/workers/scheduler.py
============================
Motor de automatización 24/7 — reemplaza run_radar_24h.py y scheduler.py.

Características:
- APScheduler BackgroundScheduler (no bloquea el event-loop de FastAPI)
- Sesiones SQLAlchemy cortas por tarea (no se comparten entre hilos)
- PRAGMA journal_mode=WAL para concurrencia segura en SQLite
- Fallback a schedule (threading) si APScheduler no está instalado
- WebSocket broadcast opcional cuando new_events_chan está inyectado
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import sys
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

# ── 1. Rutas ────────────────────────────────────────────────────────────────
_THIS: Path = Path(__file__).resolve()
BACKEND_DIR: Path  = _THIS.parent.parent          # .../backend
PROJECT_ROOT: Path = _THIS.parent.parent.parent   # raíz repo

sys.path.insert(0, str(BACKEND_DIR))                                  # imports backend
sys.path.insert(0, str(PROJECT_ROOT / "agentes" / "04_arquitecto"))    # modelos SQLA

# ── 2. Logging ─────────────────────────────────────────────────────────────
logger = logging.getLogger("radar.scheduler")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _fh = logging.FileHandler(PROJECT_ROOT / "logs" / "scheduler.log", encoding="utf-8")
    _fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_fh)

# ── 3. Import de modelos y configuración ───────────────────────────────────
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine, text

try:
    from core.config import DB_PATH, FUENTES_MONITOREO, SCRAPING
except ImportError:
    DB_PATH       = PROJECT_ROOT / "data" / "radar.db"
    FUENTES_MONITOREO = []
    SCRAPING      = {"interval_hours": 4, "timeout_seconds": 15,
                     "max_retries": 3, "delay_between_requests": 1.5}

from main import Base, engine, Entidad, Convocatoria

# ── 4. Engine WAL (concurrencia segura) ────────────────────────────────────
with engine.connect() as _conn:
    _conn.execute(text("PRAGMA journal_mode=WAL"))
    _conn.commit()

SessionLocal = sessionmaker(bind=engine)

# ── 5. Configuración de intervalo ───────────────────────────────────────────
INTERVAL_HOURS = int(os.getenv("RADAR_INTERVAL_HOURS",
               os.getenv("SCRAPE_INTERVAL_HOURS", "4")))

FORCE_SCHEDULE = os.getenv("FORCE_SCHEDULE_BACKEND", "false").lower() == "true"

# Callback para notificar a la capa WebSocket
_new_events_chan: Optional[Callable[[list], None | asyncio.coroutine]] = None


def set_ws_callback(callback: Callable[[list], None | asyncio.coroutine]) -> None:
    """Inyecta una función que recibe la lista de convocatorias nuevas."""
    global _new_events_chan
    _new_events_chan = callback


# ════════════════════════════════════════════════════════════════════════════
# TAREAS PROGRAMADAS
# ════════════════════════════════════════════════════════════════════════════

def _db_session():
    """Fabrica una sesión SQLAlchemy nueva por tarea (thread-safe)."""
    db = SessionLocal()
    try:
        return db
    except Exception as exc:
        logger.error(f"No se pudo crear sesión DB: {exc}")
        raise


def _close_db(db) -> None:
    try:
        db.close()
    except Exception:
        pass


def _build_prospecto(entidad: dict, sector: str) -> dict:
    """Construye un prospecto sintético para la cola de validación."""
    now = datetime.utcnow().isoformat()
    return {
        "id":              str(uuid.uuid4()),
        "org_id":          "default",
        "titulo":          f"Oportunidad — {entidad.get('nombre','')} / {sector}",
        "donante":         entidad.get("nombre", "Desconocido"),
        "url_fuente":      entidad.get("url", ""),
        "descripcion":     f"Convocatoria detectada por rastreo automático — sector {sector}.",
        "monto_estimado":  0.0,
        "fecha_cierre":    None,
        "paises_elegibles": [],
        "sectores":        [sector],
        "score_encontrado": 70,
        "fuente":          "Scheduler 24/7",
        "estado":          "pendiente",
        "fecha_ingreso":   now,
    }


# ── TAREA PRINCIPAL ─────────────────────────────────────────────────────────

def job_ciclo_rastreo() -> dict:
    """
    Ciclo completo de rastreo cada N horas:
      1. Minero   → prospectos a cola_validación
      2. Validador→ auto-aprueba score ≥ 75
      3. Arquitecto→ indexa aprobados
    Devuelve estadísticas del ciclo.
    """
    stats = {
        "ts_inicio":      datetime.utcnow().isoformat(),
        "prospectos":     0,
        "auto_aprobados": 0,
        "indexados":      0,
        "nuevos_ws":      [],
    }

    db = _db_session()
    try:
        # ── 1. AGENTE MINERO ─────────────────────────────────────────────────
        prospectos_ciclo: list[dict] = []
        sectores_default = ["Infraestructura", "Saneamiento", "Ambiente",
                            "Energía", "Salud", "Educación", "Tecnología"]

        if FUENTES_MONITOREO:
            for fuente in FUENTES_MONITOREO:
                for sector in sectores_default[:3]:
                    prospectos_ciclo.append(
                        _build_prospecto(fuente, sector)
                    )
        else:
            # Fallback sin fuentes configuradas
            for sector in sectores_default:
                prospectos_ciclo.append(
                    _build_prospecto({"nombre": "Rastreo Automático", "url": ""}, sector)
                )

        stats["prospectos"] = len(prospectos_ciclo)

        from database import (                          # import local para evitar ciclos
            agregar_a_cola_validacion,
            resolver_cola_validacion,
            indexar_entidad,
        )

        for p in prospectos_ciclo:
            agregar_a_cola_validacion(p)

        logger.info(f"[Minero] {len(prospectos_ciclo)} prospectos agregados a cola")

        # ── 2. AGENTE VALIDADOR ────────────────────────────────────────────────
        from database import get_cola_validacion
        pendientes = get_cola_validacion("default", "pendiente")
        for item in pendientes:
            score = item.get("score_encontrado", 0)
            if score >= 75:
                resolver_cola_validacion(item["id"], "aprobado", "Auto-aprobado por score ≥ 75")
                stats["auto_aprobados"] += 1

        logger.info(f"[Validador] {stats['auto_aprobados']} auto-aprobados")

        # ── 3. AGENTE ARQUITECTO ──────────────────────────────────────────────
        aprobados = get_cola_validacion("default", "aprobado")
        for item in aprobados:
            try:
                entidad_map = {
                    "org_id":           item.get("org_id", "default"),
                    "titulo":           item.get("titulo", ""),
                    "donante":          item.get("donante", ""),
                    "descripcion":      item.get("descripcion", ""),
                    "url_fuente":       item.get("url_fuente", ""),
                    "url_convocatoria": item.get("url_fuente", ""),
                    "fecha_cierre":     item.get("fecha_cierre", ""),
                    "paises_elegibles": [],
                    "sectores":         item.get("sectores", "[]"),
                    "monto_min":        0,
                    "monto_max":        item.get("monto_estimado", 0) or 0,
                    "moneda":           "USD",
                    "score_compatibilidad": item.get("score_encontrado", 50),
                    "estado":           "activa",
                    "origen":           "scheduler_24_7",
                    "fecha_indexacion": datetime.utcnow().isoformat(),
                }
                ent_id = indexar_entidad(entidad_map)
                stats["indexados"] += 1
                stats["nuevos_ws"].append(entidad_map)
            except Exception as exc:
                logger.error(f"[Arquitecto] Error indexando '{item.get('titulo', '')[:40]}': {exc}")

        logger.info(f"[Arquitecto] {stats['indexados']} entidades indexadas")

    except Exception as exc:
        logger.exception(f"[Ciclo] Error fatal: {exc}")
    finally:
        _close_db(db)

    # ── 4. Notificar a WebSocket ─────────────────────────────────────────────
    if _new_events_chan and stats["nuevos_ws"]:
        try:
            result = _new_events_chan(stats["nuevos_ws"])
            if asyncio.iscoroutine(result):
                asyncio.run(result)
        except Exception as exc:
            logger.warning(f"[WS] No se pudo enviar notificación: {exc}")

    stats["ts_fin"] = datetime.utcnow().isoformat()
    logger.info(f"[Ciclo] Completado — prospectos={stats['prospectos']} "
                f"aprobados={stats['auto_aprobados']} indexados={stats['indexados']}")
    return stats


# ════════════════════════════════════════════════════════════════════════════
# INICIALIZACIÓN DEL SCHEDULER
# ════════════════════════════════════════════════════════════════════════════

def start_scheduler(
    interval_hours: int | None = None,
    ws_callback:    Optional[Callable] = None,
) -> threading.Thread:
    """
    Arranca el planificador en un hilo daemon.

    Parámetros:
        interval_hours: Cada cuántas horas ejecutar el ciclo.
                        Por defecto lee RADAR_INTERVAL_HOURS del .env.
        ws_callback:    Función (o corrutina) a la que se le entrega la
                        lista de nuevas entidades indexadas para broadcast.

    Devuelve: el threading.Thread en ejecución.
    """
    global _new_events_chan

    intervalo = interval_hours or INTERVAL_HOURS
    if ws_callback:
        set_ws_callback(ws_callback)

    if FORCE_SCHEDULE:
        return _start_plain_schedule(intervalo)

    try:
        return _start_apscheduler(intervalo)
    except ImportError:
        logger.warning("[Scheduler] APScheduler no instalado — usando fallback 'schedule'")
        return _start_plain_schedule(intervalo)


def _start_apscheduler(interval_hours: int) -> threading.Thread:
    """Arranca APScheduler en un hilo separado."""
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger

    scheduler = BackgroundScheduler(
        job_defaults={
            "coalesce":       True,
            "max_instances":  1,
            "misfire_grace_time": 300,
        },
        timezone="America/Bogota",
    )

    scheduler.add_job(
        func          = job_ciclo_rastreo,
        trigger       = IntervalTrigger(hours=interval_hours),
        id            = "radar_ciclo_rastreo",
        name          = "Ciclo de rastreo automático Radar 360",
        replace_existing = True,
    )

    # Ejecutar ciclo inmediato al arrancar
    scheduler.add_job(job_ciclo_rastreo, id="radar_inicial", name="Ciclo inicial")

    scheduler.start()
    logger.info(f"[APScheduler] Iniciado — intervalo: cada {interval_hours}h")

    thread = threading.Thread(target=lambda: None, daemon=True)
    thread.scheduler = scheduler                        # type: ignore[attr-defined]
    thread.start()
    return thread


def _start_plain_schedule(interval_hours: int) -> threading.Thread:
    """Fallback con la librería 'schedule' en hilo daemon."""
    import schedule as _schedule

    running = True

    def _loop() -> None:
        while running:
            _schedule.run_pending()
            threading.Event().wait(30)

    _schedule.every(interval_hours).hours.do(job_ciclo_rastreo)
    job_ciclo_rastreo()          # ejecutar inmediatamente

    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    logger.info(f"[schedule] Iniciado — intervalo: cada {interval_hours}h")
    return thread


def stop_scheduler(thread: threading.Thread) -> None:
    """Detiene el scheduler APScheduler en ejecución."""
    if hasattr(thread, "scheduler"):
        try:
            thread.scheduler.shutdown(wait=False)  # type: ignore[attr-defined]
        except Exception as exc:
            logger.warning(f"Error al cerrar APScheduler: {exc}")


# ── Entry-point independiente ───────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("[Scheduler] iniciado en modo autónomo")
    t = start_scheduler()
    try:
        while True:
            threading.Event().wait(60)
    except KeyboardInterrupt:
        logger.info("[Scheduler] detenido por usuario")
