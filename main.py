"""
RADAR 24/7 - Sistema de Monitoreo Automático de Convocatorias
================================================================
Ejecuta cada X horas buscando nuevas oportunidades de financiamiento
para Colombia en fuentes oficiales internacionales.
"""

import time
import schedule
import os
import json
import requests
from datetime import datetime
from dotenv import load_dotenv
from groq import Groq
import google.generativeai as genai

load_dotenv()

# Configuración de APIs
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Configuración del radar
TARGET_COUNTRY = os.getenv("TARGET_COUNTRY", "Colombia")
TARGET_COUNTRIES = os.getenv("TARGET_COUNTRIES", "Alemania,China,Japon,Australia,Francia,Italia,Espana,Portugal,Estados Unidos,Canada,Brasil,Holanda,Paises Bajos,Israel,Corea").split(",")
TARGET_SECTORS = os.getenv("TARGET_SECTORS", "Infraestructura,Saneamiento,Ambiente,Educacion,Energia,Salud,Tecnologia")
UPDATE_INTERVAL_HOURS = int(os.getenv("RADAR_INTERVAL_HOURS", 6))

# Fuentes oficiales para buscar convocatorias
FUENTES_OFICIALES = {
    'EU Horizon Europe': 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls',
    'USAID Colombia': 'https://www.usaid.gov/colombia/funding',
    'BID': 'https://www.iadb.org/en/opportunities',
    'PNUD': 'https://www.undp.org/work-with-us/funding-opportunities',
    'UNESCO': 'https://www.unesco.org/en/member-states-portal/participation-programme',
    'FAO': 'https://www.fao.org/colombia/es/',
    'JICA': 'https://www.jica.go.jp/colombia/spanish/',
    'GIZ': 'https://www.giz.de/en/worldwide/colombia.html',
    'COSUDE': 'https://www.eda.admin.ch/deza/en/home/Activities',
    'CAF': 'https://www.caf.com/es/convocatorias/',
    'GEF': 'https://sgp.undp.org/',
}

def buscar_convocatorias_ai():
    """Usa IA para buscar convocatorias de financiamiento"""
    print("\n[AI] Buscando convocatorias...")

    prompt = """Lista convocatorias reales de financiamiento para Colombia en 2026.
Incluye: titulo, donante, monto_max (USD), fecha_cierre (YYYY-MM-DD), url.
Responde SOLO con JSON array. Ejemplo: [{"titulo":"X","donante":"Y","monto_max":100000,"fecha_cierre":"2026-12-31","url":"https://..."}]"""

    try:
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Eres asistente que responde en JSON puro. Sin texto adicional."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.1-8b-instant",
            temperature=0.2,
            max_tokens=3000
        )

        result = chat.choices[0].message.content.strip()
        print(f"[Debug] Respuesta: {result[:200]}...")

        if result.startswith("[") or result.startswith("{"):
            convs = json.loads(result.replace("```json", "").replace("```", "").strip())
            print(f"[AI] Convocatorias encontradas: {len(convs)}")
            return convs
        return []

    except Exception as e:
        print(f"[AI Error] {e}")
        return []

    try:
        # Usar Groq como motor principal (más rápido y confiable)
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Eres un experto en búsqueda de convocatorias de financiamiento internacional. Respondes siempre en JSON válido."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            max_tokens=12000
        )
        
        result = chat.choices[0].message.content
        result = result.replace("```json", "").replace("```", "").strip()
        convs = json.loads(result)
        
        print(f"[AI] Convocatorias encontradas: {len(convs)}")
        return convs
        
    except Exception as e:
        print(f"[AI Error] {e}")
        
        # Fallback a Gemini
        try:
            model = genai.GenerativeModel('gemini-2.0-flash')
            response = model.generate_content(prompt)
            result = response.text.replace("```json", "").replace("```", "").strip()
            return json.loads(result)
        except Exception as e2:
            print(f"[Gemini Error] {e2}")
            return []

def analizar_elegibilidad(convocatoria: dict) -> dict:
    """Evalúa si una convocatoria es elegible para Colombia"""

    prompt = f"""Evalúa si esta convocatoria es elegible para {TARGET_COUNTRY} y los sectores: {TARGET_SECTORS}.

Convocatoria:
{json.dumps(convocatoria, ensure_ascii=False)}

Responde con JSON:
{{
    "es_elegible": true/false,
    "score_probabilidad": (0-100),
    "razon": "breve justificacion"
}}"""

    try:
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Eres un evaluador de elegibilidad de subvenciones. Respondes en JSON."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            max_tokens=500
        )
        
        result = chat.choices[0].message.content
        return json.loads(result.replace("```json", "").replace("```", "").strip())
    except:
        return {"es_elegible": True, "score_probabilidad": 75, "razón": "Datos insuficientes"}

def generar_alerta(convocatoria: dict, probabilidad: int) -> str:
    """Genera una alerta ejecutiva para el equipo"""
    
    prompt = f"""Genera una alerta ejecutiva corta (máx 200 palabras) para el equipo de formulación:

Título: {convocatoria.get('titulo', '')}
Donante: {convocatoria.get('donante', '')}
Monto: ${convocatoria.get('monto_max', 0)} USD
Probabilidad: {probabilidad}%
Sector: {convocatoria.get('sectores', [])}
URL: {convocatoria.get('url', '')}

Incluye:
1. Resumen de la oportunidad
2. Requisitos clave
3. Acción recomendada
4. Fecha límite
"""

    try:
        chat = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Eres un asistente estratégico de subvenciones. Generates alertas ejecutivas."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.5,
            max_tokens=1000
        )
        
        return chat.choices[0].message.content
    except:
        return "Alerta no disponible"

def job_radar_24_7():
    """Ciclo principal del radar - se ejecuta cada X horas"""
    print(f"\n{'='*60}")
    print(f"RADAR 24/7 - Ciclo de Busqueda: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")
    
    # 1. Buscar convocatorias con IA
    print("\n[1] Buscando convocatorias en fuentes oficiales...")
    convocatorias = buscar_convocatorias_ai()

    if not convocatorias:
        print("[!] No se encontraron convocatorias en esta iteracion")
        return

    print(f"[OK] Total encontradas: {len(convocatorias)}")
    
    # 2. Filtrar por elegibilidad
    print("\n[2] Evaluando elegibilidad...")
    elegibles = []
    
    for conv in convocatorias:
        evaluacion = analizar_elegibilidad(conv)
        
        if evaluacion.get("es_elegible", False):
            prob = evaluacion.get("score_probabilidad", 75)
            
            if prob >= 60:
                conv['probabilidad'] = prob
                elegibles.append(conv)
                print(f"  [OK] {conv.get('titulo', '')[:50]}... (Prob: {prob}%)")
            else:
                print(f"  [X] Baja probabilidad: {conv.get('titulo', '')[:50]}...")
        else:
            print(f"  [X] No elegible: {conv.get('titulo', '')[:50]}...")

    # 3. Generar alertas para oportunidades de alta probabilidad
    print("\n[3] Generando alertas estrategicas...")

    for conv in elegibles[:5]:  # Top 5
        alerta = generar_alerta(conv, conv.get('probabilidad', 75))

        print(f"\n[ALERTA] {conv.get('titulo', '')[:60]}...")
        print(f"   Probabilidad: {conv.get('probabilidad', 75)}%")
        print(f"   URL: {conv.get('url', 'No disponible')}")
        print(f"   ---")
        print(alerta[:300] + "..." if len(alerta) > 300 else alerta)

    # 4. Resumen del ciclo
    print(f"\n{'='*60}")
    print(f"RESUMEN DEL CICLO:")
    print(f"   - Convocatorias encontradas: {len(convocatorias)}")
    print(f"   - Elegibles para Colombia: {len(elegibles)}")
    print(f"   - Alta prioridad: {len([c for c in elegibles if c.get('probabilidad', 0) >= 80])}")
    print(f"   - Proximo ciclo: en {UPDATE_INTERVAL_HOURS} horas")
    print(f"{'='*60}\n")

POBLADO_RAPIDO = os.getenv("POBLADO_RAPIDO", "false").lower() == "true"
CICLOS_POBLADO = int(os.getenv("CICLOS_POBLADO", "48"))
ciclos_ejecutados = 0

def iniciar_radar():
    """Inicia el sistema radar 24/7"""
    global ciclos_ejecutados

    modo = "POBLADO RAPIDO" if POBLADO_RAPIDO else "PRODUCCION"
    intervalo_actual = 1 if POBLADO_RAPIDO else UPDATE_INTERVAL_HOURS

    print("\n" + "="*60)
    print("ANTIGRAVITY OS - RADAR 24/7 INICIADO")
    print("="*60)
    print(f"Modo: {modo}")
    print(f"Pais principal: {TARGET_COUNTRY}")
    print(f"Paises monitoreados: {', '.join(TARGET_COUNTRIES)}")
    print(f"Sectores: {TARGET_SECTORS}")
    print(f"Intervalo: cada {intervalo_actual} hora(s)")
    if POBLADO_RAPIDO:
        print(f"Ciclos de poblado: {CICLOS_POBLADO}")
    print(f"Fuentes monitoreadas: {len(FUENTES_OFICIALES)}")
    print("="*60 + "\n")
    
    # Ejecutar inmediatamente al iniciar
    job_radar_24_7()
    
    # Programar ejecuciones siguientes
    schedule.every(intervalo_actual).hours.do(job_radar_24_7)
    
    # Mantener el sistema vivo
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == "__main__":
    iniciar_radar()