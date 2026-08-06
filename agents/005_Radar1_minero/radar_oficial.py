import requests
from bs4 import BeautifulSoup
import re
import json
import os
from datetime import datetime

REPO_PATH = "agents/005_Radar1_minero/repositorio_convocatorias.json"
LOG_PATH = "agents/005_Radar1_minero/radar_log.txt"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
}

FUENTES_ABIERTAS = [
    {"nombre": "BCR Costa Rica", "url": "https://www.bcr.fi.cr/", "buscar": ["licitacion", "convocatoria", "contratacion"]},
    {"nombre": "MOP Chile", "url": "https://www.mop.cl/", "buscar": ["licitacion", "convocatoria"]},
    {"nombre": "ARGENTAR", "url": "https://www.argentina.gob.ar/obras-publicas", "buscar": ["licitacion", "convocatoria"]},
    {"nombre": "PGE Uruguay", "url": "https://www.pge.gub.uy/", "buscar": ["licitacion", "convocatoria"]},
    {"nombre": "Portal Compras Paraguay", "url": "https://www.contrataciones.gov.py/", "buscar": ["licitacion", "convocatoria"]},
    {"nombre": "Panama Compra", "url": "https://www.panamacompra.gob.pa/", "buscar": ["licitacion", "convocatoria"]},
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

def extraer_presupuesto(texto):
    patrones = [
        r"\$\s*([\d,]+(?:\.\d{3})*(?:\.\d{2})?)",
        r"USD\s*([\d,]+)",
        r"([\d,]+)\s*(?:USD|EUR)",
    ]
    for patron in patrones:
        match = re.search(patron, texto, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1).replace(",", ""))
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
                        presupuesto = extraer_presupuesto(contenido)
                        fecha = buscar_fecha(contenido)

                        if presupuesto or fecha:
                            resultados.append({
                                "entidad": fuente["nombre"],
                                "objeto": contenido[:250],
                                "presupuesto_usd": presupuesto,
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