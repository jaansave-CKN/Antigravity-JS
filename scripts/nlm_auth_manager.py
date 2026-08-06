import os
import sys
import subprocess
import time

LOG_FILE = os.path.join(os.path.dirname(__file__), "logs", f"nlm_auth_{time.strftime('%Y%m%d')}.log")

def log(msg):
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    print(msg)

def check_token():
    try:
        result = subprocess.run(
            ["nlm", "list", "--max-results", "1"],
            capture_output=True,
            text=True,
            timeout=15,
            encoding='utf-8',
            errors='ignore'
        )
        output = result.stdout + result.stderr
        if "error" not in output.lower() and ("notebook" in output.lower() or result.returncode == 0 or result.returncode == 1):
            return True
    except:
        pass
    return False

def login():
    log("Ejecutando nlm login...")
    try:
        result = subprocess.run(
            ["nlm", "login"],
            capture_output=True,
            text=True,
            timeout=120,
            encoding='utf-8',
            errors='ignore'
        )
        log(f"Login completado con codigo: {result.returncode}")
        return True
    except Exception as e:
        log(f"Error en login: {e}")
    return False

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "check"
    
    if action == "refresh":
        login()
    elif action == "check":
        if not check_token():
            log("Token no valido, intentando login...")
            login()
        else:
            log("Token valido - NotebookLM conectado")
    else:
        log(f"Accion desconocida: {action}")

if __name__ == "__main__":
    main()