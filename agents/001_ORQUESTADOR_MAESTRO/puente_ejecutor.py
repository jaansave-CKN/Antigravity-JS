import os
import time
import subprocess
import shlex
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))        # agents/000_ORQUESTADOR
AGENTS_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))    # agents/

INSTRUCTION_FILE = "agents/000_ORQUESTADOR/latest_instruction.txt"
LOG_FILE = "agents/000_ORQUESTADOR/puente_log.txt"

# Lista blanca estricta: solo estos intérpretes y solo estos scripts pueden
# ejecutarse, y el script resuelto debe vivir físicamente dentro de agents/.
# Cualquier otra cosa se rechaza sin tocar subprocess.
ALLOWED_INTERPRETERS = {"node", "node.exe"}
ALLOWED_SCRIPTS = {"000_Orquestador.cjs", "000_VERIFICADOR.cjs"}


def log(mensaje):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    linea = f"[{timestamp}] {mensaje}\n"
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(linea)
    print(linea.strip())


def validar_comando(comando_str):
    """
    Parsea el comando de texto libre a una lista de argumentos (sin shell) y
    lo valida contra la allowlist. Devuelve la lista de args si es válido,
    o None si debe rechazarse.
    """
    try:
        args = shlex.split(comando_str, posix=False)
    except ValueError as e:
        log(f"[✗] Comando mal formado, rechazado: {e}")
        return None

    if len(args) < 2:
        log(f"[✗] Comando rechazado (formato inesperado): {comando_str}")
        return None

    interprete = os.path.basename(args[0].strip('"\'')).lower()
    if interprete not in ALLOWED_INTERPRETERS:
        log(f"[✗] Intérprete no permitido, rechazado: {interprete}")
        return None

    script_arg = args[1].strip('"\'')
    script_real = os.path.realpath(os.path.join(os.getcwd(), script_arg))

    if not script_real.startswith(AGENTS_DIR + os.sep):
        log(f"[✗] Script fuera de agents/, rechazado: {script_real}")
        return None

    if os.path.basename(script_real) not in ALLOWED_SCRIPTS:
        log(f"[✗] Script no está en la allowlist, rechazado: {os.path.basename(script_real)}")
        return None

    return args


def ejecutar_puente():
    log("[📡] Sistema de escucha acoplado con el Chat Dedicado (allowlist, sin shell).")
    ultimo_comando = ""

    while True:
        try:
            if os.path.exists(INSTRUCTION_FILE):
                with open(INSTRUCTION_FILE, "r", encoding="utf-8") as f:
                    comando = f.read().strip()

                if comando and comando != ultimo_comando:
                    args = validar_comando(comando)
                    if args is None:
                        ultimo_comando = comando  # no reintentar el mismo comando rechazado
                    else:
                        log(f"[⚡] Ejecutando comando validado: {args}")
                        resultado = subprocess.run(args, shell=False, capture_output=True, text=True)
                        log(f"[✓] Resultado: {resultado.stdout[:200] if resultado.stdout else 'Sin output'}")
                        ultimo_comando = comando

        except Exception as e:
            log(f"[✗] Error: {str(e)}")

        time.sleep(1)


if __name__ == "__main__":
    ejecutar_puente()
