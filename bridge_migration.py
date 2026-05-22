"""
bridge_migration.py
===================
Migración masiva de scraped_results → convocatorias
Ejecutar: python bridge_migration.py
"""
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

THIS_FILE = Path(__file__).resolve()
PROJECT_ROOT = THIS_FILE.parent

DB_PATH = PROJECT_ROOT / "backend" / "radar.db"

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT * FROM scraped_results WHERE success = 1")
registros = cur.fetchall()
print(f"Registrando {len(registros)} desde scraped_results...")

insertados = 0
for r in registros:
    titulo = r["titulo"] or "Sin título"
    monto_str = r["monto"] or "0"
    monto_limpio = monto_str.replace("USD", "").replace("$", "").replace(",", "").strip()
    
    try:
        monto_val = float(monto_limpio) if monto_limpio else 0
    except:
        monto_val = 0

    cur.execute("""
        INSERT INTO convocatorias 
        (externo_id, titulo, donante, fuente, descripcion,
         monto_min, monto_max, moneda, paises_elegibles, sectores,
         url_convocatoria, url_fuente, fecha_limite, fecha_publicacion,
         requisitos, resumen_tecnico, es_elegible, score_probabilidad,
         estado, favorito, categoria_gestion, compatibilidad_perfil,
         scraped_en, created_at, actualizado_en)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        str(uuid.uuid4()),
        titulo,
        r["entidad_id"] or "Desconocido",
        "scraped",
        f"Resultado de scraping: {titulo}",
        0,
        monto_val,
        "USD",
        "[]",
        "[]",
        r["url"],
        r["url"],
        r["fecha_cierre"] or "",
        r["scraped_en"],
        "[]",
        "",
        1,
        70,
        r["estado_detectado"] or r["estado"] or "pendiente",
        0,
        "migrado",
        50,
        r["scraped_en"],
        datetime.utcnow().isoformat(),
        datetime.utcnow().isoformat()
    ))
    insertados += 1

conn.commit()
print(f"[OK] Migracion completada: {insertados} registros insertados en tabla 'convocatorias'")

cur.execute("SELECT COUNT(*) FROM convocatorias")
total = cur.fetchone()[0]
print(f"[INFO] Total convocatorias en BD: {total}")

conn.close()