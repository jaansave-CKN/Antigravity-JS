"""
005_RADAR3_VALIDADOR - Módulo de Lógica (Filtro de compatibilidad)
==================================================================
Protocolo de Comunicación: Lee/escribe exclusivamente en radar.db

Rol: Validador que aprueba/descarta prospectos según score
"""

import sys
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from database import get_cola_validacion, resolver_cola_validacion, log_ejecucion


class Validador:
    """Agente Validador de prospectos."""
    
    UMBRAL_ALTO = 75
    UMBRAL_MEDIO = 50
    
    def obtener_pendientes(self) -> List[Dict]:
        """Obtiene items pendientes de validación."""
        return get_cola_validacion("default", "pendiente")
    
    def procesar_item(self, item_id: str, decision: str, notas: str = "") -> Dict:
        """Procesa un item de la cola de validación."""
        log_ejecucion("RADAR3_VALIDADOR", "proceso", f"Item {item_id}: {decision}")
        resolver_cola_validacion(item_id, decision, notas)
        return {"item_id": item_id, "decision": decision}
    
    def aprobar(self, item_id: str, notas: str = "Aprobado por usuario") -> Dict:
        return self.procesar_item(item_id, "aprobado", notas)
    
    def descartar(self, item_id: str, notas: str = "Descartado por usuario") -> Dict:
        return self.procesar_item(item_id, "descartado", notas)
    
    def auto_validar(self) -> Dict:
        """Auto-valida items según umbrales de score."""
        pendientes = self.obtener_pendientes()
        resultados = {"aprobados": 0, "descartados": 0}
        
        for item in pendientes:
            score = item.get("score_encontrado", 0)
            item_id = item.get("id")
            
            if score >= self.UMBRAL_ALTO:
                self.aprobar(item_id, f"Auto-aprobado (score: {score})")
                resultados["aprobados"] += 1
            elif score < self.UMBRAL_MEDIO:
                self.descartar(item_id, f"Auto-descartado (score: {score})")
                resultados["descartados"] += 1
        
        return resultados
    
    def get_stats(self) -> Dict:
        """Obtiene estadísticas de la cola."""
        pendientes = get_cola_validacion("default", "pendiente")
        aprobadas = get_cola_validacion("default", "aprobado")
        descartadas = get_cola_validacion("default", "descartado")
        
        return {
            "pendientes": len(pendientes),
            "aprobadas": len(aprobadas),
            "descartadas": len(descartadas),
            "pendientes_alto_score": len([p for p in pendientes if p.get("score_encontrado", 0) >= self.UMBRAL_ALTO]),
            "pendientes_medio_score": len([p for p in pendientes if self.UMBRAL_MEDIO <= p.get("score_encontrado", 0) < self.UMBRAL_ALTO]),
            "pendientes_bajo_score": len([p for p in pendientes if p.get("score_encontrado", 0) < self.UMBRAL_MEDIO])
        }


def main():
    """Ejecución principal del validador."""
    v = Validador()
    stats = v.get_stats()
    
    print("\n" + "="*50)
    print("🎯 005_RADAR3_VALIDADOR - ESTADÍSTICAS")
    print("="*50)
    print(f"Pendientes: {stats['pendientes']}")
    print(f"  - Alto score (>75%): {stats['pendientes_alto_score']}")
    print(f"  - Medio score (50-75%): {stats['pendientes_medio_score']}")
    print(f"  - Bajo score (<50%): {stats['pendientes_bajo_score']}")
    print(f"Aprobadas: {stats['aprobadas']}")
    print(f"Descartadas: {stats['descartadas']}")
    print("="*50)


if __name__ == "__main__":
    main()