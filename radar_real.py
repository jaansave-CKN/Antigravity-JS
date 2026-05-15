"""
RADAR 24/7 - BÚSQUEDA INTELIGENTE CON URLs REALES
=================================================
Busca y genera URLs completas y específicas de convocatorias.
"""

import os
import json
import time
from datetime import datetime
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Mapeo de organizaciones a sus URLs de convocatorias
URLS_CONVOCATORIAS = {
    "USAID": "https://www.grants.gov/search-results-detail?oppId=",
    "BID": "https://www.iadb.org/en/opportunities/grants/",
    "PNUD": "https://www.undp.org/work-with-us/funding-opportunities/",
    "UNESCO": "https://www.unesco.org/en/member-states-portal/participation-programme/",
    "EU": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls/",
    "JICA": "https://quest.jica.go.jp/en/apply/",
    "OIM": "https://www.iom.int/calls-for-proposals/",
    "MinCiencias": "https://minciencias.gov.co/convocatorias/",
    "MinCultura": "https://www.mincultura.gov.co/convocatorias/",
    "SENA": "https://www.sena.edu.co/trabajo/Paginas/convocatorias.aspx",
    "CAF": "https://www.caf.com/es/convocatorias/",
    "GIZ": "https://www.giz.de/en/html",
    "COSUDE": "https://www.eda.admin.ch/deza/en/home/Activities",
    "Avina": "https://www.avina.net/",
    "Google": "https://www.google.com/nonprofits/",
}

def buscar_convocatorias():
    """Busca convocatorias con URLs específicas y reales"""
    
    prompt = f"""Busca 25 convocatorias REALES Y ACTIVAS para Colombia en 2026.

Para cada una, genera:
- titulo: nombre exacto
- donante: nombre de la organización
- monto_max: número en USD
- fecha_cierre: formato YYYY-MM-DD
- url: URL COMPLETA Y ESPECÍFICA de la convocatoria
- fuente: nombre del donante
- sectores: lista
- requisitos: lista
- descripcion: breve

URLs REALES de referencia:
- USAID RFAs: https://www.grants.gov (buscar RFAs específicos)
- BID: https://www.iadb.org/en/opportunities (buscar "grants")
- PNUD: https://www.undp.org/work-with-us/funding-opportunities
- UNESCO: https://www.unesco.org/en/member-states-portal/participation-programme
- EU: https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls
- JICA: https://quest.jica.go.jp/en/apply/
- OIM: https://www.iom.int/calls-for-proposals
- MinCiencias: https://minciencias.gov.co
- MinCultura: https://www.mincultura.gov.co
- SENA: https://www.sena.edu.co
- CAF: https://www.caf.com/es/convocatorias/
- GEF: https://sgp.undp.org/
- OIM Colombia: https://colombia.iom.int/

IMPORTANTE: La url debe ser COMPLETA (empezar con https://) y ESPECÍFICA de esa convocatoria, NO la página principal.

JSON array."""

    try:
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Responde con JSON. Cada url debe ser https:// completo."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            max_tokens=8000
        )
        
        result = chat.choices[0].message.content
        result = result.replace("```json", "").replace("```", "").strip()
        
        convs = json.loads(result)
        
        # Filtrar y completar URLs
        for c in convs:
            url = c.get('url', '')
            donante = c.get('donante', '').lower()
            
            # Si la URL no es completa, intentar completarla
            if url and not url.startswith('http'):
                if 'usaid' in donante:
                    c['url'] = 'https://www.grants.gov' + url if url.startswith('/') else f"https://www.grants.gov/search-results-detail?oppId={url}"
                elif 'bid' in donante:
                    c['url'] = 'https://www.iadb.org/en/opportunities' + url if url.startswith('/') else url
                elif 'pnud' in donante or 'undp' in donante:
                    c['url'] = 'https://www.undp.org' + url if url.startswith('/') else url
                elif 'unesco' in donante:
                    c['url'] = 'https://www.unesco.org' + url if url.startswith('/') else url
                elif 'eu' in donante or 'europea' in donante:
                    c['url'] = 'https://ec.europa.eu' + url if url.startswith('/') else url
                else:
                    c['url'] = URLS_CONVOCATORIAS.get(donante, 'https://') + url
        
        # Convertir monto a número si es string
        for c in convs:
            try:
                c['monto_max'] = int(c.get('monto_max', 0))
            except:
                c['monto_max'] = 0
        
        return convs
        
    except Exception as e:
        print(f"Error: {e}")
        return []

if __name__ == "__main__":
    print("="*70)
    print("RADAR 24/7 - BUSQUEDA CON URLS REALES")
    print("="*70)
    
    convs = buscar_convocatorias()
    
    print(f"\n=== {len(convs)} CONVOCATORIAS ===\n")
    
    for i, c in enumerate(convs, 1):
        print(f"{i}. {c.get('titulo', '')[:65]}")
        print(f"   {c.get('donante', '')} | ${c.get('monto_max', 0):,.0f} | {c.get('fecha_cierre', '')}")
        print(f"   URL: {c.get('url', '')}")
        print()
    
    # Guardar
    with open('convocatorias_reales.json', 'w', encoding='utf-8') as f:
        json.dump(convs, f, ensure_ascii=False, indent=2)
    
    print("Guardado en convocatorias_reales.json")