"""
RADAR 360 - EJECUTOR 24/7
=========================
Inicia el ciclo completo de los 3 agentes:
1. Agente Minero: Extrae convocatorias cada X horas
2. Agente Validador: Las agrega a la cola de validación
3. Agente Arquitecto: Indexa las aprobadas

Ejecutar: python run_radar_24h.py
"""

import schedule
import time
import threading
import os
import sys
import json
import uuid
from datetime import datetime
from database import (
    init_db, 
    agregar_a_cola_validacion, 
    get_cola_validacion,
    resolver_cola_validacion,
    indexar_entidad,
    get_estadisticas,
    log_ejecucion
)

# Configuración
INTERVALO_HORAS = int(os.getenv("RADAR_INTERVAL_HOURS", 6))
PAISES_OBJETIVO = os.getenv("TARGET_COUNTRIES", "Colombia,Venezuela,Canada").split(",")
SECTORES = os.getenv("TARGET_SECTORES", "Infraestructura,Saneamiento,Educacion,Agroindustria,Medio Ambiente").split(",")

# Queries de búsqueda para el Agente Minero
QUERIES_MINERO = [
    "convocatorias becas subvenciones Colombia 2026",
    "fondos para proyectos rurales Colombia",
    "financiación PNUD Colombia proyectos",
    "subvenciones BID Colombia infraestructura",
    "becas MinCiencias Colombia investigación",
    "fondos internacionales ambientales Colombia",
    "donaciones proyectos sociales Colombia",
    "convocatorias USAID Colombia desarrollo",
]


class AgenteMinero:
    """Agente que extrae convocatorias de fuentes externas."""
    
    def __init__(self):
        self.queries = QUERIES_MINERO
        self.prospectos_encontrados = []
    
    def ejecutar_barrido(self) -> list:
        """Ejecuta búsqueda masiva y retorna prospectos."""
        print("\n[MINERO] Ejecutando barrido de fuentes...")
        
        prospectos = []
        
        # Simular búsqueda (en producción usaría API de Google/Serper)
        # Esto busca en las queries definidas
        for query in self.queries[:8]:
            for pais in PAISES_OBJETIVO[:3]:
                prospecto = {
                    "id": str(uuid.uuid4()),
                    "titulo": f"Convocatoria: {query.title()} en {pais}",
                    "donante": self._detectar_donante(query),
                    "url_fuente": f"https://example.com/conv-{uuid.uuid4().hex[:8]}",
                    "descripcion": f"Convocatoria de financiamiento para proyectos en {pais}. Sector relacionado: {query.split()[0]}.",
                    "monto_estimado": float(hash(query)) % 500000 + 10000,
                    "fecha_cierre": self._fecha_cierre_random(),
                    "paises_elegibles": [pais],
                    "sectores": self._detectar_sectores(query),
                    "score_encontrado": 60 + (hash(query) % 35),
                    "fuente": "Motor A - Barrido",
                    "org_id": "default",
                    "fecha_ingreso": datetime.now().isoformat(),
                    "estado": "pendiente"
                }
                prospectos.append(prospecto)
        
        print(f"[MINERO] Prospecos encontrados: {len(prospectos)}")
        self.prospectos_encontrados = prospectos
        return prospectos
    
    def _detectar_donante(self, query: str) -> str:
        """Detecta el donante basado en la query."""
        query_lower = query.lower()
        if "pnud" in query_lower or "undp" in query_lower: return "PNUD"
        if "bid" in query_lower: return "BID"
        if "usaid" in query_lower: return "USAID"
        if "minciencias" in query_lower: return "MinCiencias"
        if "sena" in query_lower: return "SENA"
        if "caf" in query_lower: return "CAF"
        return "Cooperación Internacional"
    
    def _detectar_sectores(self, query: str) -> list:
        """Detecta sectores de la query."""
        sectores = []
        q = query.lower()
        if "infraestructura" in q: sectores.append("Infraestructura")
        if "saneamiento" in q: sectores.append("Saneamiento Básico")
        if "educacion" in q: sectores.append("Educación")
        if "agro" in q: sectores.append("Agroindustria")
        if "ambiente" in q or "ambiental" in q: sectores.append("Medio Ambiente")
        if "salud" in q: sectores.append("Salud")
        if "rural" in q: sectores.append("Desarrollo Rural")
        return sectores if sectores else ["Desarrollo"]
    
    def _fecha_cierre_random(self) -> str:
        """Genera una fecha de cierre aleatoria en el futuro."""
        import random
        dias = random.randint(30, 180)
        fecha = datetime.now().timestamp() + (dias * 24 * 3600)
        return datetime.fromtimestamp(fecha).strftime("%Y-%m-%d")


class AgenteValidador:
    """Agente que gestiona la cola de validación."""
    
    def __init__(self):
        pass
    
    def obtener_pendientes(self) -> list:
        """Obtiene prospectos pendientes de validación."""
        return get_cola_validacion("default", "pendiente")
    
    def aprobar(self, item_id: str):
        """Aprueba un prospecto y lo envía al Agente Arquitecto."""
        print(f"[VALIDADOR] Aprobando item: {item_id}")
        resolver_cola_validacion(item_id, "aprobado", "Aprobado automáticamente")
    
    def descartar(self, item_id: str, razon: str = ""):
        """Descarta un prospecto."""
        print(f"[VALIDADOR] Descartando item: {item_id}")
        resolver_cola_validacion(item_id, "descartado", razon)


class AgenteArquitecto:
    """Agente que indexa las entidades aprobadas."""
    
    def __init__(self):
        pass
    
    def obtener_aprobados(self) -> list:
        """Obtiene entidades aprobadas pendientes de indexación."""
        return get_cola_validacion("default", "aprobado")
    
    def indexar(self, item: dict) -> str:
        """Indexa una entidad con tags completos."""
        
        # Mapear a esquema estandarizado
        entidad = {
            "org_id": item.get("org_id", "default"),
            "titulo": item.get("titulo", ""),
            "donante": item.get("donante", ""),
            "descripcion": item.get("descripcion", ""),
            "url_convocatoria": item.get("url_fuente", ""),
            "url_fuente": item.get("url_fuente", ""),
            "fecha_cierre": item.get("fecha_cierre", ""),
            "paises_elegibles": item.get("paises_elegibles", []),
            "sectors": item.get("sectores", []),
            "targetPopulation": [],
            "fundingType": self._detectar_funding_type(item.get("donante", "")),
            "monto_min": item.get("monto_estimado", 0) * 0.5,
            "monto_max": item.get("monto_estimado", 0),
            "moneda": "USD",
            "score_compatibilidad": item.get("score_encontrado", 50),
            "validationStatus": "Aprobado",
            "sourceMiner": "Agente Minero - Motor A",
            "tags": item.get("sectores", []) + [item.get("donante", "")],
            "estado": "activa",
            "origen": "indexacion_automatica",
            "fecha_indexacion": datetime.now().isoformat(),
        }
        
        return indexar_entidad(entidad)
    
    def _detectar_funding_type(self, donante: str) -> str:
        """Detecta el tipo de fondo."""
        d = donante.lower()
        if "becas" in d: return "Beca"
        if "pnud" in d or "usaid" in d or "giz" in d: return "Cooperación Internacional"
        if "bid" in d or "banco" in d: return "Financiación"
        return "Subvención"


def ciclo_radar_24h():
    """Ciclo completo del radar 24/7."""
    print(f"\n{'='*60}")
    print(f"RADAR 360 - CICLO {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*60}")
    
    log_ejecucion("RADAR_24H", "inicio_ciclo", "Iniciando ciclo completo")
    
    # 1. AGENTE MINERO: Extraer prospectos
    print("\n[1] AGENTE MINERO - Extrayendo prospectos...")
    minero = AgenteMinero()
    nuevos_prospectos = minero.ejecutar_barrido()
    
    # Agregar a cola de validación
    for p in nuevos_prospectos:
        agregar_a_cola_validacion(p)
    
    print(f"    Prospectos agregados a cola: {len(nuevos_prospectos)}")
    
    # 2. AGENTE VALIDADOR: Procesar pendientes (auto-aprobar los de alta puntuación)
    print("\n[2] AGENTE VALIDADOR - Procesando cola...")
    validador = AgenteValidador()
    pendientes = validador.obtener_pendientes()
    
    auto_aprobados = 0
    for item in pendientes:
        if item.get("score_encontrado", 0) >= 75:
            validador.aprobar(item["id"])
            auto_aprobados += 1
    
    print(f"    Aprobados automáticamente: {auto_aprobados}")
    print(f"    Pendientes manuales: {len(pendientes) - auto_aprobados}")
    
    # 3. AGENTE ARQUITECTO: Indexar los aprobados
    print("\n[3] AGENTE ARQUITECTO - Indexando aprobadas...")
    arquitecto = AgenteArquitecto()
    aprobados = arquitecto.obtener_aprobados()
    
    indexados = 0
    for item in aprobados:
        try:
            arquitecto.indexar(item)
            indexados += 1
        except Exception as e:
            print(f"    Error indexando {item.get('titulo', '')[:30]}: {e}")
    
    print(f"    Entidades indexadas: {indexados}")
    
    # 4. Estadísticas finales
    stats = get_estadisticas()
    print(f"\n[RESUMEN]")
    print(f"    Nuevos prospectos: {len(nuevos_prospectos)}")
    print(f"    Auto-aprobados: {auto_aprobados}")
    print(f"    Indexados: {indexados}")
    print(f"    Pendientes validación: {len(pendientes) - auto_aprobados}")
    
    log_ejecucion("RADAR_24H", "fin_ciclo", f"Prospectos: {len(nuevos_prospectos)}, Indexados: {indexados}")
    
    print(f"\n{'='*60}")
    print(f"Próximo ciclo: en {INTERVALO_HORAS} horas")
    print(f"{'='*60}\n")


def iniciar_radar_24h():
    """Inicia el radar 24/7."""
    init_db()
    
    print("\n" + "="*60)
    print("RADAR 360 - SISTEMA 24/7 ACTIVADO")
    print("="*60)
    print(f"Intervalo: cada {INTERVALO_HORAS} horas")
    print(f"Paises: {', '.join(PAISES_OBJETIVO)}")
    print(f"Sectores: {', '.join(SECTORES)}")
    print("="*60 + "\n")
    
    # Ejecutar ciclo inmediatamente
    ciclo_radar_24h()
    
    # Programar siguientes ciclos
    schedule.every(INTERVALO_HORAS).hours.do(ciclo_radar_24h)
    
    # Mantener vivo
    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    iniciar_radar_24h()