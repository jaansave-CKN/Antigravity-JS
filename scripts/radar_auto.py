"""
Radar Automático de Convocatorias 24/7
Busca convocatorias automáticamente y actualiza el archivo de datos
"""

import json
import os
import re
from datetime import datetime
from typing import List, Dict

RUTA_DATOS = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'convocatoriasReales.ts')

BUSQUEDAS = [
    "convocatorias abiertas Colombia 2026 MinCiencias becas",
    "becas Colombia 2026 maestría doctorado gobierno",
    "fondos Concursos Colombia 2026能看到",
    "subvenciones Colombia gobierno ONGs 2026",
    "convocatorias cultura Colombia 2026 MinCultura",
    "convocatorias ambiente Colombia 2026 MinAmbiente",
    "becas internacionales Colombia 2026 UNESCO PNUD",
    "fondos empresariales Colombia 2026 emprendimiento"
]

def generar_id() -> str:
    return f"auto-{datetime.now().strftime('%Y%m%d%H%M%S')}-{str(hash(datetime.now()))[:4]}"

def formatear_moneda(monto_str: str, moneda: str = "COP") -> Dict:
    try:
        numeros = re.findall(r'[\d,]+', monto_str)
        if numeros:
            numero = float(numeros[0].replace(',', ''))
            if 'mil millones' in monto_str.lower():
                numero *= 1000000000
            elif 'millones' in monto_str.lower():
                numero *= 1000000
            elif 'mil' in monto_str.lower():
                numero *= 1000
            return {"montoMax": numero, "moneda": moneda}
    except:
        pass
    return {"montoMax": 0, "moneda": moneda}

def crear_convocatoria(titulo: str, url: str, donante: str, monto: str, fecha: str, descripcion: str, sector: str) -> Dict:
    monto_info = formatear_moneda(monto)
    
    return {
        "id": generar_id(),
        "titulo": titulo.strip(),
        "donante": donante,
        "montoMax": monto_info["montoMax"],
        "moneda": monto_info["moneda"],
        "fechaCierre": fecha or "2026-12-31",
        "fechaPublicacion": datetime.now().strftime('%Y-%m-%d'),
        "paisesElegibles": ["Colombia"],
        "sectores": [sector],
        "probabilidadExito": 75,
        "requisitosClave": ["Por verificar requisitos específicos"],
        "estado": "abierta",
        "fuente": donante,
        "descripcion": descripcion[:200] if descripcion else "Convocatoria encontrada automáticamente",
        "urlOriginal": url,
        "urlConvocatoria": url,
        "favorito": False,
        "compatibilidadPerfil": 80
    }

def determinar_donante(url: str) -> str:
    url_lower = url.lower()
    if 'minciencias' in url_lower: return 'MinCiencias Colombia'
    if 'mincultura' in url_lower: return 'MinCultura Colombia'
    if 'sena' in url_lower: return 'SENA'
    if 'icolven' in url_lower: return 'ICETEX'
    if 'unesco' in url_lower: return 'UNESCO'
    if 'pnud' in url_lower or 'undp' in url_lower: return 'PNUD'
    if 'bid' in url_lower: return 'BID'
    if 'usaid' in url_lower: return 'USAID'
    if 'oim' in url_lower: return 'OIM'
    if 'google.org' in url_lower: return 'Google.org'
    if 'avina' in url_lower: return 'Avina Foundation'
    return 'Por identificar'

def determinar_sector(titulo: str) -> str:
    titulo_lower = titulo.lower()
    if any(p in titulo_lower for p in ['ciencia', 'tecnología', 'investigación', 'ia', 'inteligencia']): return 'Ciencia y Tecnologia'
    if any(p in titulo_lower for p in ['educación', 'maestría', 'doctorado', 'beca']): return 'Educacion'
    if any(p in titulo_lower for p in ['cultura', 'arte']): return 'Cultura'
    if any(p in titulo_lower for p in ['ambiente', 'clima', 'sostenible']): return 'Ambiente'
    if any(p in titulo_lower for p in ['agro', 'agricultura']): return 'Agricultura'
    if any(p in titulo_lower for p in ['empresa', 'emprendimiento']): return 'Emprendimiento'
    return 'Desarrollo Social'

def actualizar_archivo(convocatorias: List[Dict]):
    contenido = """import type { Convocatoria } from '../types';

export const convocatoriasReales: Convocatoria[] = [
"""
    
    for conv in convocatorias:
        contenido += f"""  {{
    id: '{conv['id']}',
    titulo: '{conv['titulo'].replace("'", "''")}',
    donante: '{conv['donante']}',
    montoMax: {conv['montoMax']},
    moneda: '{conv['moneda']}',
    fechaCierre: '{conv['fechaCierre']}',
    fechaPublicacion: '{conv['fechaPublicacion']}',
    paisesElegibles: {json.dumps(conv['paisesElegibles'])},
    sectores: {json.dumps(conv['sectores'])},
    probabilidadExito: {conv['probabilidadExito']},
    requisitosClave: {json.dumps(conv['requisitosClave'])},
    estado: '{conv['estado']}',
    fuente: '{conv['fuente']}',
    descripcion: '{conv['descripcion'].replace("'", "''")[:150]}',
    urlOriginal: '{conv['urlOriginal']}',
    urlConvocatoria: '{conv['urlConvocatoria']}',
    favorito: {str(conv['favorito']).lower()},
    compatibilidadPerfil: {conv['compatibilidadPerfil']}
  }},
"""
    
    contenido += "];"
    
    with open(RUTA_DATOS, 'w', encoding='utf-8') as f:
        f.write(contenido)
    
    print(f"✅ Archivo actualizado con {len(convocatorias)} convocatorias")

def main():
    print("🎯 Radar Automático de Convocatorias")
    print("=" * 50)
    print("Este script búsqueda convocatorias en la web.")
    print("Para búsquedas reales, necesitas usar la API de SerpAPI o similar.")
    print()
    print("Opciones:")
    print("1. Buscar con SerpAPI (requiere API key)")
    print("2. Buscar con Google Custom Search API")
    print("3. Generar búsqueda manual para ejecutar en navegador")
    print()
    print("Por ahora, generando lista de búsquedas para ejecutar manualmente...")
    print()
    
    for i, busqueda in enumerate(BUSQUEDAS, 1):
        url_busqueda = f"https://www.google.com/search?q={busqueda.replace(' ', '+')}"
        print(f"{i}. {busqueda}")
        print(f"   → {url_busqueda}")
        print()

if __name__ == "__main__":
    main()