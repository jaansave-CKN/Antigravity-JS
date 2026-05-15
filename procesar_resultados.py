import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import init_db, guardar_convocatoria, log_ejecucion
from security import sanitize

RESULTADOS_WEBSEARCH = [
    {
        "title": "EU-LAC Social Accelerator-Third Party Financial Support Call for Proposals",
        "url": "https://carib-export.com/opportunities/eu-lac-social-accelerator-third-party-financial-support-call",
        "deadline": "2026-04-08",
        "donante": "Unión Europea",
        "monto": "Por definir",
        "paises": ["Latinoamérica", "Caribe", "Colombia"],
        "sectores": ["Innovación Social", "Igualdad de género", "Jóvenes", "Derechos humanos"],
        "descripcion": "Convocatoria para organizaciones no lucrativas. Fomentar innovación social y reducir desigualdades."
    },
    {
        "title": "Colombia 4G Toll Road Program - PPP Opportunities",
        "url": "https://www.allianzgi.com/en/insights/financing-growth-with-infrastructure-in-latin-america",
        "deadline": "2026-12-31",
        "donante": "Agencia Nacional de Infraestructura (ANI) Colombia",
        "monto": "$24 mil millones",
        "paises": ["Colombia"],
        "sectores": ["Infraestructura", "Carreteras", "APP"],
        "descripcion": "Programa de carreteras 4G. Hasta 40 proyectos APP."
    },
    {
        "title": "Investing in Sustainable Infrastructure in Latin America - IDB",
        "url": "https://ppp.worldbank.org/sites/default/files/2025-06/Investing%20in%20Sustainable%20Infrastructure%20in%20Latin%20America-%20Instruments,%20Strategies%20and%20Partnerships%20for%20Institutional%20Investors%20Mobilization.pdf",
        "deadline": "2026-12-31",
        "donante": "BID - Banco Interamericano de Desarrollo",
        "monto": "$250 mil millones/año",
        "paises": ["Argentina", "Brasil", "Chile", "Colombia", "México", "Perú"],
        "sectores": ["Infraestructura Sostenible", "ESG", "Inversión Institucional"],
        "descripcion": "Informe sobre oportunidades de inversión en infraestructura sostenible en LATAM."
    },
    {
        "title": "Mexico Investment Plan for Infrastructure 2026-2030",
        "url": "https://www.jonesday.com/en/insights/2026/04/mexico-unlocks-private-investment-in-strategic-infrastructure",
        "deadline": "2030-12-31",
        "donante": "Gobierno de México",
        "monto": "$314.8 mil millones",
        "paises": ["México", "LATAM"],
        "sectores": ["Infraestructura Estratégica", "Energía", "Transporte", "Agua"],
        "descripcion": "Plan de infraestructura 2026-2030 para inversión privada en proyectos estratégicos."
    },
    {
        "title": "Brazil Construction & Sanitation Infrastructure Projects 2026",
        "url": "https://finance.yahoo.com/news/brazil-construction-industry-report-2026-160200758.html",
        "deadline": "2026-12-31",
        "donante": "Gobierno de Brasil",
        "monto": "BRL 707.59 mil millones (2026)",
        "paises": ["Brasil", "LATAM"],
        "sectores": ["Construcción", "Saneamiento", "Vivienda Social", "Data Centers"],
        "descripcion": "Mercado de construcción en Brasil. Oportunidades en Saneamiento, vivienda social e infraestructura."
    }
]

def guardar_resultados():
    init_db()
    guardados = 0
    
    for item in RESULTADOS_WEBSEARCH:
        try:
            conv = {
                "titulo": sanitize(item["title"][:200]),
                "donante": sanitize(item["donante"]),
                "fuente": "RadarWeb: Busqueda automatica",
                "descripcion": sanitize(item["descripcion"]),
                "paises_elegibles": item["paises"],
                "sectores": item["sectores"],
                "url_convocatoria": item["url"],
                "fecha_limite": item["deadline"],
                "monto_min": 0,
                "monto_max": 0,
                "moneda": "USD",
                "estado": "nueva",
                "compatibilidad_perfil": 75,
                "requisitos": ["Por verificar"],
                "es_elegible": True,
                "score_probabilidad": 75
            }
            guardar_convocatoria(conv)
            guardados += 1
            print(f"[GUARDADO] {item['title'][:60]}...")
        except Exception as e:
            print(f"[ERROR] {e}")
    
    print(f"\n[RESUMEN] Guardados: {guardados}/{len(RESULTADOS_WEBSEARCH)}")
    log_ejecucion("RADAR_WEB", "importacion", f"Guardados: {guardados}")

if __name__ == "__main__":
    guardar_resultados()