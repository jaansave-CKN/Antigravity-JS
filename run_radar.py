import os
import json
from dotenv import load_dotenv
from groq import Groq

load_dotenv()
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

TARGET_COUNTRY = "Colombia"

print("="*60)
print("RADAR 24/7 - BUSQUEDA AUTOMATICA")
print("="*60)

prompt = f"""Busca MAXIMO 30 convocatorias REALES y ACTIVAS para {TARGET_COUNTRY} en 2026.

Incluye de estas organizaciones (busca sus páginas de "calls", "opportunities", "convocatorias"):
EU Horizon, USAID Colombia, BID, PNUD, UNESCO, FAO, JICA, GIZ, COSUDE, CAF, GEF, OIM, AFD, FONTAGRO, Avina, Ford Foundation, Kellogg, Google.org, Microsoft AI, Amazon.

Para cada una da:
- titulo, donante, monto_max USD, fecha_cierre YYYY-MM-DD
- url EXACTA de la convocatoria
- fuente, sectores (lista), requisitos (2-3), descripcion

JSON array. Solo devuelve JSON."""

try:
    print("\n[AI] Buscando...")
    chat = groq_client.chat.completions.create(
        messages=[
            {"role": "system", "content": "Responde solo en JSON."},
            {"role": "user", "content": prompt}
        ],
        model="llama-3.3-70b-versatile",
        temperature=0.2,
        max_tokens=8000
    )
    
    result = chat.choices[0].message.content
    result = result.replace("```json", "").replace("```", "").strip()
    convs = json.loads(result)
    
    print(f"\nEncontradas: {len(convs)}")
    
    with open('convocatorias_radar.json', 'w', encoding='utf-8') as f:
        json.dump(convs, f, ensure_ascii=False, indent=2)
    
    for i, c in enumerate(convs[:35], 1):
        print(f"\n{i}. {c.get('titulo', '')[:65]}")
        print(f"   {c.get('donante', '')} | ${c.get('monto_max', 0):,.0f} | {c.get('fecha_cierre', '')}")
        print(f"   {c.get('url', '')[:80]}")
    
except Exception as e:
    print(f"Error: {e}")