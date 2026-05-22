import sqlite3
conn = sqlite3.connect('data/radar.db')
c = conn.cursor()
c.execute('SELECT name FROM sqlite_master WHERE type="table"')
rows = c.fetchall()
for row in rows:
    print(row[0])
conn.close()