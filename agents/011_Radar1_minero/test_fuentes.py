import requests
from bs4 import BeautifulSoup
import re
import json

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
}

FUENTES = [
    {'nombre': 'BID Procurement', 'url': 'https://www.iadb.org/es/procurement'},
    {'nombre': 'Colombia SECOP', 'url': 'https://www.contratos.gov.co/ache/publico/buscarProceso.shtml'},
    {'nombre': 'UNDP', 'url': 'https://procurement.undp.org/'},
]

def extraer_presupuesto(texto):
    patrones = [
        r"\$\s*([\d,]+(?:\.\d{3})*(?:\.\d{2})?)",
        r"USD\s*([\d,]+)",
        r"([\d,]+)\s*USD"
    ]
    for patron in patrones:
        match = re.search(patron, texto, re.IGNORECASE)
        if match:
            return float(match.group(1).replace(",", ""))
    return None

def limpiar_texto(texto):
    if texto:
        return " ".join(texto.split()).strip()
    return ""

print("=== PRUEBA DE CONECTIVIDAD FUENTES ===\n")

for f in FUENTES:
    print(f"[*] {f['nombre']}: ", end="")
    try:
        r = requests.get(f['url'], headers=HEADERS, timeout=15)
        print(f"[{r.status_code}] - {len(r.text)} bytes")

        if r.status_code == 200:
            soup = BeautifulSoup(r.content, 'html.parser')
            textos = soup.get_text()[:3000]

            if 'convocatoria' in textos.lower() or 'licitacion' in textos.lower() or 'tender' in textos.lower():
                print("   [OK] Contiene oportunidades")
            else:
                print("   [W] Portal sin contenido visible")

    except Exception as e:
        print(f"   [X] ERROR: {str(e)[:80]}")

print("\n=== PRUEBA COMPLETADA ===")