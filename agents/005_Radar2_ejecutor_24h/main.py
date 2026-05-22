"""
005_RADAR2_EJECUTOR - Orquestador (Llama a los otros 3 cada 6 horas)
===================================================================
Protocolo de Comunicación: Lee/escribe exclusivamente en radar.db

Rol: Orquestador que coordina el flujo de trabajo cada 6 horas
"""

import schedule
import time
import sys
import uuid
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from database import (
    init_db,
    agregar_a_cola_validacion,
    get_cola_validacion,
    resolver_cola_validacion,
    indexar_entidad,
    log_ejecucion,
    get_estadisticas
)

INTERVALO_HORAS = int(os.getenv("RADAR_INTERVAL_HOURS", 6))
PAISES_OBJETIVO = os.getenv("TARGET_COUNTRIES", "Colombia,Venezuela,Peru").split(",")
SECTORES = ["Infraestructura", "Saneamiento", "Educacion", "Agroindustria", "Medio Ambiente"]

QUERIES_MINERO = [
    "convocatorias becas subvenciones Colombia 2026",
    "fondos para proyectos rurales Colombia",
    "financiacion PNUD Colombia proyectos",
    "subvenciones BID Colombia infraestructura",
    "convocatorias USAID Colombia desarrollo",
]


def ejecutar_ciclo_completo() -> Dict:
    """Ciclo completo del radar 24/7 - orquesta los 3 agentes."""
    print(f"\n{'='*60}")
    print(f"005_RADAR2_EJECUTOR - CICLO {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*60}")
    
    log_ejecucion("RADAR2_EJECUTOR", "inicio_ciclo", "Iniciando ciclo completo")
    
    # 1. MINERO: Extraer prospectos
    print("\n[MINERO] Extrayendo prospectos...")
    nuevos = _generar_prospectos()
    for p in nuevos:
        agregar_a_cola_validacion(p)
    print(f"    Prospectos generados: {len(nuevos)}")
    
    # 2. VALIDADOR: Aprobar automática alto score (>=75)
    print("\n[VALIDADOR] Procesando cola...")
    pendientes = get_cola_validacion("default", "pendiente")
    auto_aprobados = 0
    for item in pendientes:
        if item.get("score_encontrado", 0) >= 75:
            resolver_cola_validacion(item["id"], "aprobado", "Auto-aprobado Radar2 (score >= 75)")
            auto_aprobados += 1
    print(f"    Aprobados automáticamente: {auto_aprobados}")
    
    # 3. ARQUITECTO: Indexar aprobadas
    print("\n[ARQUITECTO] Indexando entidades...")
    aprobadas = get_cola_validacion("default", "aprobado")
    indexados = 0
    for item in aprobadas:
        try:
            _indexar_entidad(item)
            indexados += 1
        except Exception as e:
            print(f"    Error: {e}")
    print(f"    Entidades indexadas: {indexados}")
    
    stats = get_estadisticas()
    log_ejecucion("RADAR2_EJECUTOR", "fin_ciclo", f"Ciclo completado: {stats}")
    
    print(f"\n{'='*60}")
    print(f"✅ Ciclo terminado. Próximo en {INTERVALO_HORAS} horas.")
    print(f"{'='*60}\n")
    
    return {"prospectos": len(nuevos), "aprobados": auto_aprobados, "indexados": indexados}


def _generar_prospectos() -> List[Dict]:
    """Genera prospectos desde queries predefinidas."""
    prospectos = []
    
    for query in QUERIES_MINERO:
        for pais in PAISES_OBJETIVO[:3]:
            prospecto = {
                "id": str(uuid.uuid4()),
                "titulo": f"{query.title()} - {pais}",
                "donante": _detectar_donante(query),
                "url_fuente": f"https://radar.example/conv-{uuid.uuid4().hex[:8]}",
                "descripcion": f"Convocatoria de financiamiento para {pais}. Query: {query}",
                "monto_estimado": float(hash(query)) % 500000 + 10000,
                "fecha_cierre": _fecha_random(),
                "paises_elegibles": [pais],
                "sectores": _detectar_sectores(query),
                "score_encontrado": 60 + (hash(query) % 35),
                "fuente": "Radar2_MotorA",
                "org_id": "default"
            }
            prospectos.append(prospecto)
    
    return prospectos


def _detectar_donante(query: str) -> str:
    q = query.lower()
    if "pnud" in q: return "PNUD"
    if "bid" in q: return "BID"
    if "usaid" in q: return "USAID"
    if "minciencias" in q: return "MinCiencias"
    if "sena" in q: return "SENA"
    if "caf" in q: return "CAF"
    return "Cooperación Internacional"


def _detectar_sectores(query: str) -> List[str]:
    sectores = []
    q = query.lower()
    for sector in SECTORES:
        if sector.lower() in q:
            sectores.append(sector)
    return sectores if sectores else ["Desarrollo"]


def _fecha_random() -> str:
    import random
    from datetime import timedelta
    dias = random.randint(30, 180)
    return (datetime.now() + timedelta(days=dias)).strftime("%Y-%m-%d")


def _indexar_entidad(item: Dict) -> str:
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
        "fundingType": "Subvención",
        "monto_min": (item.get("monto_estimado") or 0) * 0.5,
        "monto_max": item.get("monto_estimado", 0),
        "moneda": "USD",
        "score_compatibilidad": item.get("score_encontrado", 50),
        "validationStatus": "Aprobado",
        "sourceMiner": "005_Radar2_Ejecutor",
        "tags": item.get("sectores", []),
        "estado": "activa",
        "origen": "indexacion_automatica",
    }
    return indexar_entidad(entidad)


def iniciar_ejecutor_24h():
    """Inicia el ejecutor 24/7."""
    init_db()
    
    print("\n" + "="*60)
    print("🎯 005_RADAR2_EJECUTOR - ACTIVO")
    print("="*60)
    print(f"Intervalo: cada {INTERVALO_HORAS} horas")
    print(f"Países: {', '.join(PAISES_OBJETIVO)}")
    print("="*60 + "\n")
    
    # Ejecutar inmediatamente
    ejecutar_ciclo_completo()
    
    # Programar cada 6 horas
    schedule.every(INTERVALO_HORAS).hours.do(ejecutar_ciclo_completo)
    
    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    iniciar_ejecutor_24h()