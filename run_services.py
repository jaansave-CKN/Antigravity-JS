import subprocess
import sys
import os

os.chdir(r"C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos")

print("[START] Iniciando servicios...")

p1 = subprocess.Popen([sys.executable, "main.py"], 
                       stdout=subprocess.PIPE, 
                       stderr=subprocess.STDOUT,
                       text=True,
                       bufsize=1)

print(f"[API] Proceso iniciado con PID: {p1.pid}")

import time
time.sleep(4)

print("[OUTPUT DEL API:]")
if p1.poll() is None:
    print("   API sigue corriendo...")
else:
    print("   API terminated")
    
import urllib.request
try:
    response = urllib.request.urlopen("http://localhost:5000/api/health", timeout=3)
    print(f"[OK] API respondio: {response.status}")
except Exception as e:
    print(f"[WARN] API no respondio: {e}")

print("\n[SERVICIOS INICIADOS]")
print("   API: http://localhost:5000")
print("   Web: http://localhost:5173 (ejecuta 'npm run dev' manualmente)")
print("\nPara detener: taskkill /PID " + str(p1.pid) + " /F")

p1.terminate()