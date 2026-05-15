import sqlite3
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
conn = sqlite3.connect('radar.db')
cur = conn.cursor()

# Corregir BID -> MinCiencias (convocatorias colombianas, no del BID)
cur.execute("UPDATE convocatorias SET fuente = 'MinCiencias' WHERE fuente = 'BID' AND (donante LIKE '%MinCiencias%' OR donante LIKE '%Ciencias%')")

# Corregir EU Funding -> Unión Europea
cur.execute("UPDATE convocatorias SET fuente = 'Unión Europea' WHERE fuente = 'EU Funding & Tenders'")

# También corregir donante para que sea más preciso
cur.execute("UPDATE convocatorias SET donante = 'Ministerio de Ciencia y Tecnología' WHERE donante LIKE '%MinCiencias%'")

conn.commit()

# Verificar resultado
cur.execute("SELECT fuente, COUNT(*) as cnt FROM convocatorias GROUP BY fuente")
print("Conteo por fuente:")
for r in cur.fetchall():
    print(f"  {r[0]}: {r[1]}")

conn.close()
print("\nCorrecciones aplicadas")