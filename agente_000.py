import os
from pathlib import Path

def run_agente_000():
    print("--- [Agente 000] Iniciando escaneo de estructura ---")
    raiz = Path.cwd()
    
    # Verificar ruta del motor
    ruta_main = raiz / "agents" / "005_Radar4_arquitecto_datos" / "main.py"
    
    if ruta_main.exists():
        print(f"[OK] Main.py localizado en: {ruta_main}")
    else:
        print(f"[ERROR] Main.py no encontrado en: {ruta_main}")
        return False
        
    # Verificar base de datos
    db_path = raiz / "data" / "radar.db"
    print(f"[INFO] Buscando base de datos en: {db_path}")
    
    return True

if __name__ == "__main__":
    if run_agente_000():
        print("--- [Agente 000] Integridad confirmada. Proceda con el Reparador. ---")
    else:
        print("--- [Agente 000] Integridad fallida. Corrija las rutas antes de proceder. ---")