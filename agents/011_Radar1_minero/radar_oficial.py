import requests
from bs4 import BeautifulSoup
import re
import json
import os
from datetime import datetime

REPO_PATH = "agents/011_Radar1_minero/repositorio_convocatorias.json"
LOG_PATH = "agents/011_Radar1_minero/radar_log.txt"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
}

# Purgado 2026-08-12 (auditoria 001-006, Axioma II.2 de AGENTS.md: foco
# nacional estricto) -- las 6 fuentes extranjeras (Costa Rica, Chile,
# Argentina, Uruguay, Paraguay, Panama) fueron eliminadas. Unica fuente
# vigente: SECOP II, ya validada como URL real en test_fuentes.py de este
# mismo directorio (no se inventa una URL nueva sin verificar).
FUENTES_ABIERTAS = [
    {"nombre": "Colombia SECOP", "url": "https://www.contratos.gov.co/ache/publico/buscarProceso.shtml", "buscar": ["licitacion", "convocatoria", "contratacion"]},
]

def log(mensaje):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    linea = f"[{timestamp}] {mensaje}"
    print(linea)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(linea + "\n")

def leer_repositorio():
    if os.path.exists(REPO_PATH):
        with open(REPO_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"metadatos": {"total_indexado": 0, "ultima_actualizacion": ""}, "convocatorias_activas": []}

def extraer_presupuesto_cop(texto):
    # Purgado 2026-08-12: sin patrones USD/EUR -- toda metrica financiera de
    # este proyecto se calcula y almacena estrictamente en Pesos Colombianos
    # (Axioma II.2 de AGENTS.md). Formato COP tipico: "$ 1.234.567" (punto
    # como separador de miles, sin decimales) o "COP 1.234.567".
    patrones = [
        r"(?:COP\s*\$?|\$)\s*([\d\.]+)",
    ]
    for patron in patrones:
        match = re.search(patron, texto, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1).replace(".", ""))
            except:
                pass
    return None

def buscar_fecha(texto):
    patrones = [
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
        r"(\d{4}-\d{2}-\d{2})",
        r"(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})",
    ]
    for patron in patrones:
        match = re.search(patron, texto, re.IGNORECASE)
        if match:
            return match.group(1)
    return None

def extraer_convocatorias(texto_html, fuente):
    soup = BeautifulSoup(texto_html, 'html.parser')
    texto = soup.get_text().lower()
    resultados = []

    for termino in fuente["buscar"]:
        if termino in texto:
            elementos = soup.find_all(["tr", "article", "li", "div", "p"])
            for elem in elementos[:10]:
                contenido = elem.get_text(strip=True)
                if len(contenido) > 80 and len(contenido) < 1000:
                    if any(t in contenido.lower() for t in fuente["buscar"]):
                        presupuesto = extraer_presupuesto_cop(contenido)
                        fecha = buscar_fecha(contenido)

                        if presupuesto or fecha:
                            resultados.append({
                                "entidad": fuente["nombre"],
                                "objeto": contenido[:250],
                                "presupuesto_cop": presupuesto,
                                "fecha_cierre": fecha,
                                "fuente": fuente["nombre"],
                                "url": fuente["url"],
                                "fecha_indexacion": datetime.now().strftime("%Y-%m-%d")
                            })
            break

    return resultados

def rastrear():
    log("=== INICIO RASTREO RADAR1_MINERO ===")
    repo = leer_repositorio()
    existentes = len(repo["convocatorias_activas"])
    log(f"Existentes: {existentes}")

    total_nuevas = 0
    bloqueadas = []

    for fuente in FUENTES_ABIERTAS:
        log(f"Analizando: {fuente['nombre']}")
        try:
            r = requests.get(fuente["url"], headers=HEADERS, timeout=15)

            if r.status_code == 200:
                convs = extraer_convocatorias(r.text, fuente)
                log(f"   [OK] {len(convs)} extractos")
                for c in convs:
                    c["id"] = f"RADAR-{existentes + total_nuevas + 1:04d}"
                    repo["convocatorias_activas"].append(c)
                    total_nuevas += 1
            elif r.status_code == 403:
                bloqueadas.append(fuente["nombre"])
                log(f"   [X] BLOQUEADA (403)")
            else:
                log(f"   [X] Error {r.status_code}")

        except Exception as e:
            log(f"   [X] {str(e)[:60]}")
            bloqueadas.append(fuente["nombre"])

    repo["metadatos"]["total_indexado"] = existentes + total_nuevas
    repo["metadatos"]["ultima_actualizacion"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with open(REPO_PATH, 'w', encoding='utf-8') as f:
        json.dump(repo, f, indent=2, ensure_ascii=False)

    log(f"=== RESUMEN: {total_nuevas} nuevas | Total: {repo['metadatos']['total_indexado']}")
    if bloqueadas:
        log(f"Bloqueadas: {', '.join(bloqueadas)}")

if __name__ == "__main__":
    rastrear()