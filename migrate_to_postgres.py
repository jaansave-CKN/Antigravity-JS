"""
MIGRACIÓN SQLite -> PostgreSQL
==============================
Ejecutar: python migrate_to_postgres.py

Crea las tablas en PostgreSQL y migra los datos desde SQLite.
"""

import sqlite3
import sys
from pathlib import Path

# Rutas
PROJECT_ROOT = Path(__file__).parent
SQLITE_DB = PROJECT_ROOT / "data" / "radar.db"

# Importar configuración PostgreSQL
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
from db_postgres import engine, Base, SessionLocal, Entidad, Convocatoria, ColaValidacion, EntidadIndexada

def migrate_entidades():
    """Migra tabla entidades."""
    conn = sqlite3.connect(str(SQLITE_DB))
    cur = conn.cursor()
    cur.execute("SELECT * FROM entidades")
    rows = cur.fetchall()

    session = SessionLocal()
    for row in rows:
        ent = Entidad(
            id=row[0],
            nombre=row[1],
            pais=row[2],
            tipo_entidad=row[3],
            url=row[4]
        )
        session.add(ent)
    session.commit()
    session.close()
    conn.close()
    print(f"✅ Migrated {len(rows)} entidades")

def migrate_convocatorias():
    """Migra tabla convocatorias."""
    conn = sqlite3.connect(str(SQLITE_DB))
    cur = conn.cursor()
    cur.execute("SELECT * FROM convocatorias")
    rows = cur.fetchall()

    session = SessionLocal()
    for row in rows:
        conv = Convocatoria(
            titulo=row[0],
            sector=row[1],
            tipo_financiamiento=row[2],
            formato_formulacion=row[3],
            monto=row[4],
            url=row[5],
            fecha_cierre=row[6],
            score=row[7],
            estado=row[8],
            entidad_id=row[9],
            es_favorito=bool(row[10])
        )
        session.add(conv)
    session.commit()
    session.close()
    conn.close()
    print(f"✅ Migrated {len(rows)} convocatorias")

def migrate_cola_validacion():
    """Migra cola de validación."""
    conn = sqlite3.connect(str(SQLITE_DB))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM cola_validacion")
    rows = cur.fetchall()

    session = SessionLocal()
    for row in rows:
        item = ColaValidacion(
            id=row["id"],
            org_id=row["org_id"],
            titulo=row["titulo"],
            donante=row["donante"],
            url_fuente=row["url_fuente"],
            descripcion=row["descripcion"],
            monto_estimado=row["monto_estimado"],
            fecha_cierre=row["fecha_cierre"],
            paises_elegibles=row["paises_elegibles"],
            sectores=row["sectores"],
            score_encontrado=row["score_encontrado"],
            fuente=row["fuente"],
            estado=row["estado"]
        )
        session.add(item)
    session.commit()
    session.close()
    conn.close()
    print(f"✅ Migrated {len(rows)} items de cola")

if __name__ == "__main__":
    print("=" * 50)
    print("MIGRANDO SQLite -> PostgreSQL")
    print("=" * 50)

    Base.metadata.create_all(bind=engine)
    print("✅ Tablas creadas en PostgreSQL")

    migrate_entidades()
    migrate_convocatorias()
    migrate_cola_validacion()

    print("\n🎉 Migración completada!")