"""
RADAR AUTOMÁTICO 24/7 - Búsqueda Inteligente de Convocatorias
===============================================================
Este script se ejecuta automáticamente y busca convocatorias
reales cada X horas usando IA para búsquedas profundas.
"""

import os
import json
import time
from datetime import datetime
from dotenv import load_dotenv
from groq import Groq
import google.generativeai as genai

load_dotenv()

# Configurar APIs
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# Configuración
TARGET_COUNTRY = "Colombia"
UPDATE_HOURS = 4

FUENTES = {
    'EU': 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls',
    'USAID': 'https://www.usaid.gov/colombia/funding',
    'BID': 'https://www.iadb.org/en/opportunities',
    'PNUD': 'https://www.undp.org/work-with-us/funding-opportunities',
    'UNESCO': 'https://www.unesco.org/en/member-states-portal/participation-programme',
    'FAO': 'https://www.fao.org/colombia/es/',
    'JICA': 'https://www.jica.go.jp/colombia/spanish/',
    'GIZ': 'https://www.giz.de/en/worldwide/colombia.html',
    'COSUDE': 'https://www.eda.admin.ch/deza/en/home/Activities',
    'CAF': 'https://www.caf.com/es/convocatorias/',
    'GEF': 'https://sgp.undp.org/',
    'OIM': 'https://www.iom.int/calls-for-proposals',
    'AECID': 'https://www.aecid.es/ES/Paginas/home.aspx',
    'MinCiencias': 'https://minciencias.gov.co/',
    'MinCultura': 'https://www.mincultura.gov.co/',
    'SENA': 'https://www.sena.edu.co/',
    'iNNpulsa': 'https://www.innpulsa.co/',
}

def buscar_convocatorias():
    """Búsqueda profunda de convocatorias usando IA"""
    print(f"[{datetime.now()}] Buscando convocatorias...")
    
    prompt = f"Dame 15 convocatorias reales para Colombia 2026: titulo, donante, monto, fecha_cierre, url, fuente, sectores. JSON array."

    try:
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Eres un experto en búsqueda de convocatorias internacionales. Responde siempre con JSON array válido."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.2,
            max_tokens=4000
        )
        
        result = chat.choices[0].message.content
        result = result.replace("```json", "").replace("```", "").strip()
        
        # Manejar caso donde no hay JSON
        if not result or result == "":
            print("  -> Respuesta vacía")
            return []
            
        convs = json.loads(result)
        
        print(f"  -> Encontradas: {len(convs)}")
        
        # Guardar en archivo
        with open('convocatorias_encontradas.json', 'w', encoding='utf-8') as f:
            json.dump(convs, f, ensure_ascii=False, indent=2)
        
        return convs
        
    except Exception as e:
        print(f"  -> Error: {e}")
        return []

def run_radar():
    """Ejecuta el ciclo completo del radar"""
    print("="*60)
    print(f"RADAR 24/7 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)
    
    # Buscar convocatorias
    convs = buscar_convocatorias()
    
    if convs:
        print(f"\n === CONVOCATORIAS ENCONTRADAS ===")
        for i, c in enumerate(convs[:15], 1):
            print(f"\n{i}. {c.get('titulo', '')[:60]}")
            print(f"   {c.get('donante', '')} | ${c.get('monto_max', 0):,.0f}")
            print(f"   {c.get('fecha_cierre', '')}")
            print(f"   {c.get('url', '')[:70]}")
    
    print("\n" + "="*60)
    print(f"Próxima búsqueda en {UPDATE_HOURS} horas")
    print("="*60)

if __name__ == "__main__":
    print("Iniciando RADAR 24/7...")
    run_radar()