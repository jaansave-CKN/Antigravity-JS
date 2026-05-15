import sys
import os
os.chdir(r"C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos")
sys.path.insert(0, r"C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos")

from api import app
from werkzeug.serving import make_server

print("[API] Iniciando servidor en puerto 5000...")
server = make_server('0.0.0.0', 5000, app)
print("[API] Servidor corriendo en http://localhost:5000")
print("[API] Presiona Ctrl+C para detener")

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\n[API] Servidor detenido")
    server.shutdown()