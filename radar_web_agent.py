import os
import sys
import json
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from database import init_db, guardar_convocatoria, log_ejecucion
from security import sanitize

SCRIPTS_DIR = os.path.join(os.path.dirname(__file__).replace("\\proyectos\\Proy_03_RadarFondos", ""), "scripts")

class RadarWebAgent:
    def __init__(self):
        self.busquedas_activas = [
            "call for proposals 2026 grants Latin America infrastructure building",
            "BID convocatoria 2026 Colombia proyectos sociales desarrollo",
            "UNESCO funding opportunities 2026 developing countries grants",
            "World Bank projects 2026 water sanitation infrastructure",
            "EU Latin America cooperation calls 2026 funding",
            "USAID development grants 2026 Latin America",
            "GIZ funding opportunities 2026 Colombia projects",
            "PNUD convocatorias 2026 Colombia UNDP",
            "fondos no reembolsables Colombia 2026 donaciones",
            "international grants NGOs Latin America 2026",
        ]
        self.indice_busqueda = 0

    def buscar_convocatorias(self):
        log_ejecucion("RADAR_WEB", "inicio", "Iniciando busqueda de convocatorias mundiales")
        print(f"\n{'='*60}")
        print("RADAR WEB - BUSQUEDA MUNDIAL (WebSearch)")
        print(f"{'='*60}")

        busqueda_actual = self.busquedas_activas[self.indice_busqueda]
        self.indice_busqueda = (self.indice_busqueda + 1) % len(self.busquedas_activas)

        print(f"[Buscando] {busqueda_actual}")

        resultados = []
        
        for _ in range(3):
            try:
                from websearch import websearch
                response = websearch(
                    query=busqueda_actual,
                    numResults=10,
                    livecrawl="preferred",
                    type="deep"
                )

                if response and "results" in response:
                    for item in response["results"]:
                        conv = self._procesar_resultado(item, busqueda_actual)
                        if conv:
                            resultados.append(conv)

                if resultados:
                    break

            except Exception as e:
                print(f"[WebSearch error] {e}")
                time.sleep(5)

        print(f"\n[RESUMEN] Convocatorias encontradas: {len(resultados)}")
        log_ejecucion("RADAR_WEB", "fin", f"Encontrados: {len(resultados)}")
        print(f"{'='*60}\n")

        return resultados

    def _procesar_resultado(self, item, fuente):
        try:
            titulo = item.get("title", "Sin titulo")
            url = item.get("url", "")
            desc = item.get("content", "")

            if any(palabra in desc.lower() for palabra in ["convocatoria", "grant", "call for", "funding", "fund", "bid", "proposal"]):
                return {
                    "titulo": sanitize(titulo[:200]),
                    "donante": sanitize(self._extraer_donante(desc, url)),
                    "fuente": f"RadarWeb: {fuente}",
                    "fecha_limite": "2026-12-31",
                    "monto": 0,
                    "paises_elegibles": ["Colombia", "LATAM"],
                    "sectores": self._extraer_sectores(desc),
                    "descripcion": sanitize(desc[:500]),
                    "estado": "nueva",
                    "compatibilidad_perfil": 70,
                    "requisitos": ["Por verificar"],
                    "url": url,
                    "favorito": False
                }
        except Exception as e:
            print(f"[Procesando error] {e}")
        return None

    def _extraer_donante(self, desc, url):
        donante = "Por identificar"
        if "bid" in desc.lower() or "banco interamericano" in desc.lower():
            donante = "BID"
        elif "world bank" in desc.lower():
            donante = "Banco Mundial"
        elif "usaid" in desc.lower():
            donante = "USAID"
        elif "giz" in desc.lower():
            donante = "GIZ"
        elif "pnud" in desc.lower() or "undp" in desc.lower():
            donante = "PNUD"
        elif "european union" in desc.lower() or "eu " in desc.lower():
            donante = "Unión Europea"
        elif "unesco" in desc.lower():
            donante = "UNESCO"
        return donante

    def _extraer_sectores(self, desc):
        sectores = []
        desc_lower = desc.lower()
        if any(p in desc_lower for p in ["agua", "saneamiento", "water", "sanitation"]):
            sectores.append("Saneamiento")
        if any(p in desc_lower for p in ["construccion", "infraestructura", "construction", "infrastructure"]):
            sectores.append("Infraestructura")
        if any(p in desc_lower for p in ["vivienda", "housing"]):
            sectores.append("Vivienda")
        if any(p in desc_lower for p in ["desarrollo social", "social"]):
            sectores.append("Desarrollo Social")
        if any(p in desc_lower for p in ["ambiente", "climate", "ambiental"]):
            sectores.append("Ambiente")
        return sectores if sectores else ["Desarrollo"]

    def ejecutar_ciclo(self):
        init_db()
        resultados = self.buscar_convocatorias()

        guardados = 0
        for conv in resultados:
            try:
                guardar_convocatoria(conv)
                guardados += 1
            except Exception as e:
                print(f"[Error guardando] {e}")

        return {"encontrados": len(resultados), "guardados": guardados}

    def siguiente_busqueda(self):
        return self.busquedas_activas[self.indice_busqueda]

if __name__ == "__main__":
    import time
    agent = RadarWebAgent()
    result = agent.ejecutar_ciclo()
    print(f"Resultado: {result}")
    print(f"\nProxima busqueda: {agent.siguiente_busqueda()}")