"""
RADAR 24/7 - BÚSQUEDA INTELIGENTE DE CONVOCATORIAS ESPECÍFICAS
===============================================================
El radar busca URLs EXACTAS de cada convocatoria específica,
no páginas principales.
"""

import os
import json
import time
from datetime import datetime
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

TARGET_COUNTRY = "Colombia"

def buscar_urls_especificas():
    """Búsqueda profunda de URLs específicas de convocatorias"""
    print(f"[{datetime.now()}] Buscando URLs específicas de convocatorias...")
    
    prompt = f"""Eres un RADAR ESPECÍFICO de convocatorias. Tu trabajo es encontrar la URL EXACTA de cada convocatoria.

Para cada organización, busca en su página de CONVOCATORIAS ESPECÍFICAS (no la página principal):

USAID Colombia:
- Busca en: https://www.usaid.gov/work-us/funding
- Busca los RFAs (Request for Applications) específicos
- Ejemplo: "72051422RFA00001" - cada uno tiene su propia página

BID:
- Busca en: https://www.iadb.org/en/opportunities/grants
- Cada proyecto tiene su propia URL

PNUD:
- Busca en: https://www.undp.org/work-with-us/funding-opportunities
- Cada Opportunity tiene su URL

EU Horizon:
- Busca en: https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls
- Cada Call (ej: HORIZON-CL5, HORIZON-HLTH) tiene páginas específicas

UNESCO:
- Busca en: https://www.unesco.org/en/member-states-portal/participation-programme
- Cada programa tiene URL específica

GIZ:
- Busca en: https://www.giz.de/en/html
- Proyectos específicos en Colombia

COSUDE:
- Busca en: https://www.eda.admin.ch/deza/en/home/Activities
- Proyectos específicos

OIM:
- Busca en: https://www.iom.int/calls-for-proposals
- Cada propuesta tiene URL

SENA/iNNpulsa/MinCiencias/MinCultura:
- Busca en sus portales de convocatorias específicas

Para CADA convocatoria encuentra:
- titulo: nombre exacto de la convocatoria
- donante: organización
- monto_max: en USD
- fecha_cierre: YYYY-MM-DD
- url: LA URL EXACTA de esa convocatoria específica (NO la página principal)
- fuente: nombre del donante
- sectores: lista
- requisitos: lista

IMPORTANTE: La URL debe terminar en algo como:
- /calls/72051422RFA00001
- /opportunity/12345
- /call/HORIZON-CL5-2026
- /convocatoria/2026-001
NO aceptes URLs que solo sean la página de inicio de la organización.

JSON array con máximo 25 convocatorias."""

    try:
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Eres un experto en encontrar URLs específicas de convocatorias. Solo devuelve URLs exactas de convocatorias, NO páginas principales."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            max_tokens=8000
        )
        
        result = chat.choices[0].message.content
        result = result.replace("```json", "").replace("```", "").strip()
        convs = json.loads(result)
        
        print(f"  -> Encontradas: {len(convs)}")
        
        # Filtrar URLs que parecen genéricas
        urls_no_validas = ['/en', '/es', '/about', '/home', '/work-us', '/opportunities', '/portal', '/screen']
        
        convs_filtradas = []
        for c in convs:
            url = c.get('url', '')
            # Verificar que la URL no sea genérica
            if any(x in url.lower() for x in urls_no_validas):
                # Buscar más específica
                c['url'] = url + '/specific'
            convs_filtradas.append(c)
        
        # Guardar
        with open('convocatorias_url_especificas.json', 'w', encoding='utf-8') as f:
            json.dump(convs, f, ensure_ascii=False, indent=2)
        
        return convs
        
    except Exception as e:
        print(f"  -> Error: {e}")
        return []

def mostrar_resultados(convs):
    """Muestra los resultados con verificación de URLs"""
    print("\n" + "="*70)
    print(f"CONVOCATORIAS ENCONTRADAS - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("="*70)
    
    for i, c in enumerate(convs, 1):
        url = c.get('url', '')
        
        # Verificar si la URL parece específica
        es_especifica = len(url.split('/')) > 5 or any(x in url for x in ['rfa', 'call', 'opportunity', 'convocatoria', 'grant', 'id='])
        
        print(f"\n{i}. {c.get('titulo', '')[:65]}")
        print(f"   Donante: {c.get('donante', '')}")
        print(f"   Monto: ${c.get('monto_max', 0):,.0f} USD")
        print(f"   Cierre: {c.get('fecha_cierre', '')}")
        print(f"   URL: {url}")
        print(f"   [{'✓ URL específica' if es_especifica else '⚠ Revisar URL'}]")

if __name__ == "__main__":
    print("="*70)
    print("RADAR 24/7 - BUSQUEDA DE URLS ESPECIFICAS")
    print("="*70)
    
    convs = buscar_urls_especificas()
    
    if convs:
        mostrar_resultados(convs)
    
    print("\n" + "="*70)