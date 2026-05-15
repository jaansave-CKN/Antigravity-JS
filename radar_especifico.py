"""
RADAR 24/7 - BÚSQUEDA POR ORGANIZACIÓN
======================================
Busca específicamente en cada organización para encontrar
los URLs exactos de sus convocatorias.
"""

import os
import json
import time
from datetime import datetime
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Lista de organizaciones con sus páginas de convocatorias específicas
ORGANIZACIONES = {
    "USAID Colombia": "https://www.grants.gov/search-results-detail?oppId=352577",
    "BID": "https://www.iadb.org/en/opportunities/grants",
    "PNUD": "https://www.undp.org/work-with-us/funding-opportunities",
    "UNESCO": "https://www.unesco.org/en/member-states-portal/participation-programme",
    "EU": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls",
    "JICA": "https://quest.jica.go.jp/en/apply/",
    "OIM": "https://www.iom.int/calls-for-proposals",
    "MinCiencias": "https://minciencias.gov.co/convocatorias",
    "MinCultura": "https://www.mincultura.gov.co/convocatorias",
    "SENA": "https://www.sena.edu.co/trabajo/Paginas/convocatorias.aspx",
}

def buscar_por_org():
    """Busca convocatorias específicas por organización"""
    
    resultados = []
    
    for org, url_base in ORGANIZACIONES.items():
        print(f"\n--- Buscando en {org} ---")
        
        prompt = f"""Busca las últimas 3 convocatorias ABIERTAS para Colombia de {org}.

Para cada una proporciona:
- titulo: nombre exacto
- donante: {org}
- monto_max: en USD
- fecha_cierre: YYYY-MM-DD
- url: URL EXACTA de la convocatoria (busca en {url_base})
- fuente: {org}
- sectores: lista
- requisitos: 2-3 requisitos clave
- descripcion: breve

IMPORTANTE: La url debe ser específica, como:
- /grant/72051422RFA00001
- /call/HORIZON-CL5-2026
- /opportunity/123456
No aceptes la URL base."""

        try:
            chat = groq_client.chat.completions.create(
                messages=[
                    {"role": "system", "content": "Responde solo con JSON array."},
                    {"role": "user", "content": prompt}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.1,
                max_tokens=2000
            )
            
            result = chat.choices[0].message.content
            result = result.replace("```json", "").replace("```", "").strip()
            
            convs = json.loads(result)
            
            for c in convs:
                c['fuente'] = org
                c['url_base'] = url_base
            
            resultados.extend(convs)
            print(f"  -> {len(convs)} convocatorias")
            
        except Exception as e:
            print(f"  -> Error: {e}")
            continue
        
        time.sleep(1)  # Evitar rate limit
    
    return resultados

if __name__ == "__main__":
    print("="*60)
    print("RADAR 24/7 - BUSQUEDA ESPECIFICA POR ORGANIZACION")
    print("="*60)
    
    convs = buscar_por_org()
    
    print(f"\n=== TOTAL: {len(convs)} convocatorias ===")
    
    for i, c in enumerate(convs, 1):
        print(f"\n{i}. {c.get('titulo', '')[:60]}")
        print(f"   {c.get('donante', '')}")
        print(f"   ${c.get('monto_max', 0):,.0f} USD")
        print(f"   Cierre: {c.get('fecha_cierre', '')}")
        print(f"   URL: {c.get('url', '')}")
    
    # Guardar
    with open('convocatorias_especificas.json', 'w', encoding='utf-8') as f:
        json.dump(convs, f, ensure_ascii=False, indent=2)
    
    print("\nGuardado en convocatorias_especificas.json")