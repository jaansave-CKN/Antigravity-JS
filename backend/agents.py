import os
import json
from dotenv import load_dotenv
from minimax_client import call_minimax

load_dotenv()

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

        try:
            result = call_minimax(
                messages=[
                    {"role": "system", "content": "Responde siempre en formato JSON válido."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=2000
            )
            return json.loads(result.replace("```json", "").replace("```", "").strip())
        except Exception as e:
            print(f"[Error] MiniMax falló: {e}")
            return None

class StrategyAgent:
    """Usa MiniMax M2.5 para generar alertas rápidas."""
    def generate_alert(self, grant_data: dict):
        print("[StrategyAgent] Generando alerta de oportunidad...")

        prompt = f"""
        Genera una alerta ejecutiva corta para el equipo de formulación sobre este fondo:
        Título: {grant_data.get('titulo')}
        Probabilidad: {grant_data.get('score_probabilidad')}%
        Requisitos clave: {grant_data.get('requisitos')}
        """

        return call_minimax(
            messages=[
                {"role": "system", "content": "Eres un asistente estratégico de subvenciones."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.4,
            max_tokens=1000
        )
