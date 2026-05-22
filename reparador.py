import sys
import os
from pathlib import Path
from sqlalchemy.orm import sessionmaker

# 1. Ajustar el camino al módulo verificado por el Agente 000
sys.path.insert(0, os.path.join(os.getcwd(), "SIA_Radar", "agentes", "04_arquitecto"))

try:
    from main import engine, Entidad, Convocatoria
    print("--- [Éxito] Módulos cargados correctamente ---")
except ImportError as e:
    print(f"--- [Error] No se pudo cargar main.py: {e} ---")
    sys.exit(1)

# 2. Configurar la sesión
Session = sessionmaker(bind=engine)
session = Session()

def ejecutar_inyeccion():
    try:
        # Verificar cuántas hay para evitar duplicar
        actuales = session.query(Convocatoria).count()
        print(f"--- [Info] Base de datos actual tiene {actuales} convocatorias ---")

        # Crear entidad si no existe
        entidad = session.query(Entidad).filter_by(nombre="GIZ - Agencia Alemana").first()
        if not entidad:
            entidad = Entidad(nombre="GIZ - Agencia Alemana", pais="Alemania", tipo_entidad="Bilateral")
            session.add(entidad)
            session.flush()

        # Inyectar 300 registros
        print("--- [Procesando] Inyectando 300 convocatorias ---")
        for i in range(1, 301):
            conv = Convocatoria(
                titulo=f"Convocatoria de prueba #{i}",
                sector="Infraestructura",
                tipo_financiamiento="Subvenciones",
                formato_formulacion="MGA",
                entidad_id=entidad.id
            )
            session.add(conv)
        
        session.commit()
        print("--- [ÉXITO] 300 convocatorias inyectadas correctamente ---")
    except Exception as e:
        session.rollback()
        print(f"--- [Error] Falló la inyección: {e} ---")
    finally:
        session.close()

if __name__ == "__main__":
    ejecutar_inyeccion()