import schedule
import time
import threading
import os
import sys
import asyncio

sys.path.insert(0, os.path.dirname(__file__))

from database import init_db, log_ejecucion, get_estadisticas, guardar_entidad
from scraper_entidades import scrape_all_entidades
from realEntidades_scraper import ENTIDADES_RADAR

try:
    from notifications.triggers import run_all_triggers
    NOTIFICATIONS_ENABLED = True
except ImportError:
    NOTIFICATIONS_ENABLED = False
    print("[Scheduler] Modulo de notificaciones no disponible")

TARGET_COUNTRY = os.getenv("TARGET_COUNTRY", "Colombia")

def ejecutar_scraping_24h():
    log_ejecucion("SCRAPER", "inicio_ciclo", f"Iniciando ciclo de scraping 24/7 - {len(ENTIDADES_RADAR)} entidades")
    print(f"\n{'='*60}")
    print(f"RADAR 24/7 - SCRAPING CICLO")
    print(f"{'='*60}")

    for ent in ENTIDADES_RADAR:
        guardar_entidad(ent)

    resultado = scrape_all_entidades()
    stats = get_estadisticas()

    print(f"\n[RESUMEN] Entidades scrapeadas: {resultado['ok']}/{resultado['total']}")
    print(f"[RESUMEN] Entidades en DB: {stats['totalEntidades']}")
    print(f"[RESUMEN] Resultados encontrados: {stats['resultadosFound']}")

    if NOTIFICATIONS_ENABLED:
        print(f"\n[NOTIFICATIONS] Ejecutando triggers de alertas...")
        try:
            asyncio.run(run_all_triggers())
            print(f"[NOTIFICATIONS] Triggers ejecutados correctamente")
        except Exception as e:
            print(f"[NOTIFICATIONS] Error ejecutando triggers: {e}")

    print(f"{'='*60}\n")

    log_ejecucion("SCRAPER", "fin_ciclo", f"Ciclo completado: {resultado}")
    return resultado

def iniciar_scheduler():
    interval = int(os.getenv("SCRAPE_INTERVAL_HOURS", 4))

    print(f"[Scheduler] Radar 24/7 activo - scraping cada {interval} horas")
    print(f"[Scheduler] Entidades rastreadas: {len(ENTIDADES_RADAR)}")

    schedule.every(interval).hours.do(ejecutar_scraping_24h)

    ejecutar_scraping_24h()

    def run_pending():
        while True:
            schedule.run_pending()
            time.sleep(60)

    thread = threading.Thread(target=run_pending, daemon=True)
    thread.start()
    print("[Scheduler] Hilo activo. Presiona Ctrl+C para detener.")
    return thread

def run_once():
    init_db()
    ejecutar_scraping_24h()

if __name__ == "__main__":
    run_once()