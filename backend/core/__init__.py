"""Radar 360 Core Module - Arquitectura SaaS"""
from .config import PROJECT_ROOT, BACKEND_DIR, DATA_DIR, DB_PATH, SCRAPING, FUENTES_MONITOREO
from .tracking_engine import TrackingEngine, get_engine
from .websocket_manager import manager, create_fastapi_app

__all__ = [
    "PROJECT_ROOT", "BACKEND_DIR", "DATA_DIR", "DB_PATH", 
    "SCRAPING", "FUENTES_MONITOREO",
    "TrackingEngine", "get_engine",
    "manager", "create_fastapi_app"
]