"""
MIGRACIÓN: scraped_results -> convocatorias
===========================================
Mapea campos de la tabla scraper a la estructura de la API.
"""

import sqlite3
from pathlib import Path
import uuid

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "radar.db"

def migrar_datos():
    if not DB_PATH.exists():
        print(f"Error: No se encontró la base de datos en {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT COUNT(*) FROM scraped_results")
        total_orig = cursor.fetchone()[0]
        print(f"Registros en 'scraped_results': {total_orig}")

        if total_orig == 0:
            print("No hay datos para migrar.")
            return

        print("Migrando registros...")

        cursor.execute("""
            INSERT INTO convocatorias (
                id, titulo, donante, montoMax, moneda, fechaCierre,
                fechaPublicacion, paisesElegibles, sectores, probabilidadExito,
                requisitosClave, estado, fuente, descripcion, urlOriginal,
                urlConvocatoria, urlTerminos, favorito, compatibilidadPerfil,
                categoriaGestion, poblacionesObjetivo, verificada
            )
            SELECT 
                ? || '-' || CAST(id AS TEXT),
                COALESCE(titulo, 'Convocatoria sin título'),
                COALESCE(entidad_id, 'Entidad Externa'),
                COALESCE(CAST(monto AS REAL), 0),
                'USD',
                COALESCE(fecha_cierre, ''),
                COALESCE(scraped_en, ''),
                '["Colombia"]',
                '["General"]',
                50,
                'No especificado',
                COALESCE(estado, 'pendiente'),
                'scraper',
                COALESCE(estado_detectado, 'Pendiente de revisión'),
                COALESCE(url, ''),
                COALESCE(url, ''),
                '',
                0,
                50,
                'estandar',
                '[]',
                0
            FROM scraped_results
            WHERE success = 1;
        """, (str(uuid.uuid4())[:8],))

        conn.commit()
        cursor.execute("SELECT COUNT(*) FROM convocatorias")
        total_dest = cursor.fetchone()[0]
        print(f"Migration completed. Total in 'convocatorias': {total_dest}")

    except sqlite3.Error as e:
        print(f"Error: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrar_datos()