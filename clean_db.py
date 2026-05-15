import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "radar.db"

def clean_database():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Eliminar entradas con score 0 o duplicadas
    cursor.execute("""
        DELETE FROM convocatorias WHERE score_probabilidad = 0
    """)
    print(f"Eliminadas entradas con score 0")
    
    # Verificar entradas restantes
    cursor.execute("SELECT id, externo_id, titulo, fuente, fecha_limite, score_probabilidad FROM convocatorias ORDER BY score_probabilidad DESC")
    rows = cursor.fetchall()
    
    print(f"\n=== CONVOCATORIAS VALIDAS ({len(rows)}) ===")
    for row in rows:
        print(f"ID: {row[0]} | {row[2][:50]}... | {row[3]} | Fecha: {row[4]} | Score: {row[5]}")
    
    conn.commit()
    conn.close()
    return len(rows)

if __name__ == "__main__":
    count = clean_database()
    print(f"\nTotal validas: {count}")