#!/usr/bin/env python3
"""
Radar Automático de Convocatorias
Busca convocatorias y actualiza el archivo de datos
"""

import json
import os
import re
from datetime import datetime

RUTA_DATOS = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'convocatoriasReales.ts')

BUSQUEDAS = [
    "convocatorias Colombia 2026 MinCiencias",
    "becas Colombia 2026 maestría doctorado",
    "convocatorias MinCultura Colombia 2026",
    "fondos PNUD Colombia 2026",
    "USAID Colombia grants 2026",
    "becas internacionales Colombia 2026",
    "convocatorias vivienda Colombia 2026",
    "fondos ambiente Colombia 2026",
]

def generar_id():
    return f"auto-{datetime.now().strftime('%Y%m%d%H%M')}-{hash(str(datetime.now())) % 10000}"

def crear_convocatoria(titulo, url, donante, monto, fecha, descripcion, sector):
    return {
        "id": generar_id(),
        "titulo": titulo.strip()[:100],
        "donante": donante,
        "montoMax": monto,
        "moneda": "COP",
        "fechaCierre": fecha or "2026-12-31",
        "fechaPublicacion": datetime.now().strftime('%Y-%m-%d'),
        "paisesElegibles": ["Colombia"],
        "sectores": [sector],
        "probabilidadExito": 75,
        "requisitosClave": ["Por verificar"],
        "estado": "abierta",
        "fuente": donante,
        "descripcion": descripcion[:150] if descripcion else "Convocatoria automática",
        "urlOriginal": url,
        "urlConvocatoria": url,
        "favorito": False,
        "compatibilidadPerfil": 80
    }

def determinar_donante(url):
    url_lower = url.lower()
    if 'minciencias' in url_lower: return 'MinCiencias'
    if 'mincultura' in url_lower: return 'MinCultura'
    if 'minvivienda' in url_lower: return 'MinVivienda'
    if 'sena' in url_lower: return 'SENA'
    if 'icetex' in url_lower: return 'Icetex'
    if 'colfuturo' in url_lower: return 'Colfuturo'
    if 'unesco' in url_lower: return 'UNESCO'
    if 'pnud' in url_lower or 'undp' in url_lower: return 'PNUD'
    if 'bid' in url_lower: return 'BID'
    if 'usaid' in url_lower: return 'USAID'
    if 'oim' in url_lower or 'iom' in url_lower: return 'OIM'
    return 'Otros'

def determinar_sector(titulo):
    titulo_lower = titulo.lower()
    if any(p in titulo_lower for p in ['ciencia', 'tecnología', 'investigación', 'ia']): return 'Ciencia'
    if any(p in titulo_lower for p in ['educación', 'maestría', 'doctorado', 'beca']): return 'Educacion'
    if any(p in titulo_lower for p in ['cultura', 'arte']): return 'Cultura'
    if any(p in titulo_lower for p in ['ambiente', 'clima']): return 'Ambiente'
    if any(p in titulo_lower for p in ['vivienda', 'infraestructura']): return 'Vivienda'
    if any(p in titulo_lower for p in ['social', 'comunidad']): return 'Desarrollo Social'
    return 'Desarrollo Economico'

def main():
    print("🎯 Radar automático de convocatorias")
    print(f"Fecha: {datetime.now()}")
    print("=" * 50)
    
    print("\n📋 Para búsqueda real, usar API de SerpAPI o similar.")
    print("\nBúsquedas configuradas:")
    for i, b in enumerate(BUSQUEDAS, 1):
        print(f"  {i}. {b}")
    
    print("\n⚠️ Este script genera template para búsquedas.")
    print("💡 Para funcionar 24/7, integrar con SerpAPI o similar.")
    print("\nPara usar, ejecutar con API key de SerpAPI:")
    print("  python radar_search.py --api-key TU_API_KEY")

if __name__ == "__main__":
    main()