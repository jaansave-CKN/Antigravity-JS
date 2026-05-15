import os
import json
import google.generativeai as genai
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# Configuración de Modelos
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel('gemini-2.0-flash')
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

class ScraperAgent:
    """Rastrea fuentes públicas (simulado para este ejemplo)."""
    def fetch_raw_grants(self):
        print("[ScraperAgent] Buscando nuevas convocatorias mundiales...")
        # En producción, aquí iría la lógica de BeautifulSoup o consumo de APIs (ej. Grants.gov)
        # Simulamos la ingesta de un texto en bruto de una convocatoria.
        return [
            """
            Call for Proposals: Sustainable Rural Infrastructure 2026.
            Donor: Kusanone Program / Global Fund.
            Budget: $500,000.
            Eligible: LATAM (including Colombia, Peru, Ecuador).
            Focus: Sanitation facilities, modular community centers.
            Deadline: 2026-10-30.
            Requirements: Local partnership, non-profit or registered SAS with 3 years experience.
            """
        ]

class EvaluationAgent:
    """Usa Gemini 1.5 Pro para leer pliegos y evaluar elegibilidad técnica/legal."""
    def analyze_eligibility(self, raw_text: str, country: str, sectors: str):
        print("[EvaluationAgent] Analizando viabilidad técnica y jurídica...")

        prompt = f"""
        Actúa como un Diseñador y Formulador de Proyectos experto.
        Analiza la siguiente convocatoria de fondos:
        {raw_text}

        Verifica estrictamente lo siguiente:
        1. ¿Es {country} elegible?
        2. ¿Aplica para los sectores: {sectors}?

        Devuelve un objeto JSON con esta estructura exacta:
        {{
            "titulo": "string",
            "donante": "string",
            "paises_elegibles": ["lista"],
            "sectores_aplicables": ["lista"],
            "es_elegible": boolean,
            "score_probabilidad": int (0-100),
            "resumen_tecnico": "string",
            "requisitos": ["lista"]
        }}
        """

        # Intentar con Gemini primero, luego Groq como fallback
        try:
            response = gemini_model.generate_content(prompt)
            result = response.text.replace("```json", "").replace("```", "").strip()
            return json.loads(result)
        except Exception as e:
            print(f"[Warning] Gemini falló: {e}. Usando Groq como fallback...")
            try:
                chat_completion = groq_client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": "Responde siempre en formato JSON válido."},
                        {"role": "user", "content": prompt}
                    ],
                    model="llama-3.3-70b-versatile",
                )
                result = chat_completion.choices[0].message.content.replace("```json", "").replace("```", "").strip()
                return json.loads(result)
            except Exception as e2:
                print(f"[Error] Groq también falló: {e2}")
                return None

class StrategyAgent:
    """Usa Groq (Llama 3 o similar) para generar alertas rápidas."""
    def generate_alert(self, grant_data: dict):
        print("[StrategyAgent] Generando alerta de oportunidad...")

        prompt = f"""
        Genera una alerta ejecutiva corta para el equipo de formulación sobre este fondo:
        Título: {grant_data.get('titulo')}
        Probabilidad: {grant_data.get('score_probabilidad')}%
        Requisitos clave: {grant_data.get('requisitos')}
        """

        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": "Eres un asistente estratégico de subvenciones."},
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
        )
        return chat_completion.choices[0].message.content
