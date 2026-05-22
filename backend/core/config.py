"""
RADAR FONDOS 360 - Configuración central con rutas absolutas blindeadas
===========================================================================
Solución al problema de "Errno 2 / Base de datos fantasma"
"""

from pathlib import Path
import os

# Ruta absoluta del proyecto (máxima prioridad)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Subdirectorios core
BACKEND_DIR = PROJECT_ROOT / "backend"
DATA_DIR = PROJECT_ROOT / "data"
LOGS_DIR = PROJECT_ROOT / "logs"
AGENTS_DIR = BACKEND_DIR / "agents"

# Rutas de base de datos (NUNCA más relativas)
DB_PATH = DATA_DIR / "radar.db"
DB_LOGS_PATH = LOGS_DIR / "database.log"

# Asegurar que los directorios existen
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Configuración de scraping
SCRAPING = {
    "interval_hours": int(os.getenv("SCRAPE_INTERVAL_HOURS", 4)),
    "timeout_seconds": 15,
    "max_retries": 3,
    "delay_between_requests": 1.5,
}

# Fuentes objetivo para rastreo 24/7
FUENTES_MONITOREO = [
    {"nombre": "GIZ Colombia", "url": "https://www.giz.de/en/worldwide/colombia.html", "prioridad": "alta"},
    {"nombre": "EU Horizon Europe", "url": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls", "prioridad": "alta"},
    {"nombre": "USAID Colombia", "url": "https://www.usaid.gov/colombia/funding", "prioridad": "media"},
    {"nombre": "BID Opportunities", "url": "https://www.iadb.org/en/opportunities", "prioridad": "alta"},
    {"nombre": "PNUD Colombia", "url": "https://www.undp.org/work-with-us/funding-opportunities", "prioridad": "media"},
]

__all__ = ["PROJECT_ROOT", "BACKEND_DIR", "DATA_DIR", "LOGS_DIR", "DB_PATH", "SCRAPING", "FUENTES_MONITOREO"]