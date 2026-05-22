import schedule
import time
import threading
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from radar_web_agent import RadarWebAgent
from database import log_ejecucion

def ejecutar_radar_web():
    log_ejecucion("RADAR_SCHEDULER", "inicio", "Iniciando ciclo RadarWeb")
    print(f"\n{'='*60}")
    print("RADAR WEB 24/7 - CICLO AUTOMATICO")
    print(f"{'='*60}")

    agent = RadarWebAgent()
    result = agent.ejecutar_ciclo(profundo=False)

    print(f"\n[RESULTADO] {result}")
    print(f"[PROXIMA BUSQUEDA] {agent.siguiente_busqueda()}")
    print(f"{'='*60}\n")

    log_ejecucion("RADAR_SCHEDULER", "fin", str(result))
    return result

def iniciar_scheduler(interval_hours=6):
    print(f"[Scheduler] RadarWeb 24/7 activo - cada {interval_hours} horas")

    schedule.every(interval_hours).hours.do(ejecutar_radar_web)

    ejecutar_radar_web()

    def run_pending():
        while True:
            schedule.run_pending()
            time.sleep(60)

    thread = threading.Thread(target=run_pending, daemon=True)
    thread.start()
    print("[Scheduler] Hilo activo. Presiona Ctrl+C para detener.")
    return thread

def run_once():
    ejecutar_radar_web()

if __name__ == "__main__":
    if "--once" in sys.argv:
        run_once()
    else:
        interval = int(os.getenv("RADAR_INTERVAL_HOURS", 6))
        iniciar_scheduler(interval)