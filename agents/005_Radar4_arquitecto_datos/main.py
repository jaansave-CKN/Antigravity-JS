"""
005_RADAR4_ARQUITECTO_DATOS - Gestor de la DB (Migraciones y Limpieza)
========================================================================
Protocolo de Comunicación: Lee/escribe exclusivamente en radar.db

Rol: Arquitecto que indexa entidades y gestiona migraciones de base de datos
"""

import sys
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from database import (
    get_cola_validacion,
    indexar_entidad,
    buscar_entidades_indexadas,
    log_ejecucion,
    init_db
)


class Arquitecto:
    """Agente Arquitecto de Datos - Indexa entidades y gestiona DB."""
    
    def obtener_aprobadas(self) -> List[Dict]:
        """Obtiene items aprobados pendientes de indexar."""
        return get_cola_validacion("default", "aprobado")
    
    def indexar_item(self, item: Dict) -> str:
        """Indexa un item aprobado en entidades_indexadas."""
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
            "targetPopulation": self._detectar_poblacion(item.get("sectores", [])),
            "fundingType": self._detectar_funding_type(item.get("donante", "")),
            "monto_min": (item.get("monto_estimado") or 0) * 0.5,
            "monto_max": item.get("monto_estimado", 0),
            "moneda": "USD",
            "score_compatibilidad": item.get("score_encontrado", 50),
            "validationStatus": "Aprobado",
            "sourceMiner": "005_Radar4_Arquitecto",
            "tags": self._generar_tags(item),
            "estado": "activa",
            "origen": "005_Radar4_Arquitecto",
        }
        
        result = indexar_entidad(entidad)
        log_ejecucion("RADAR4_ARQUITECTO", "indexado", f"Entidad: {item.get('titulo', '')[:30]}")
        return result
    
    def _detectar_poblacion(self, sectores: List[str]) -> List[str]:
        """Detecta población objetivo basada en sectores."""
        poblaciones = []
        for s in sectores:
            s_lower = s.lower()
            if "rural" in s_lower: poblaciones.append("Rural")
            if "agro" in s_lower: poblaciones.append("Asociaciones Agropecuarias")
            if "saneamiento" in s_lower: poblaciones.append("Municipios Cat 5 y 6")
        return poblaciones
    
    def _detectar_funding_type(self, donante: str) -> str:
        d = (donante or "").lower()
        if "becas" in d: return "Beca"
        if "pnud" in d or "usaid" in d: return "Cooperación Internacional"
        if "bid" in d: return "Financiación"
        return "Subvención"
    
    def _generar_tags(self, item: Dict) -> List[str]:
        tags = []
        tags.extend(item.get("sectores", []))
        if item.get("donante"): tags.append(item["donante"])
        if item.get("paises_elegibles"): tags.extend(item["paises_elegibles"])
        return list(set(tags))
    
    def get_entidades_indexadas(self, filtros: Dict = None) -> List[Dict]:
        """Obtiene entidades indexadas con filtros opcionales."""
        return buscar_entidades_indexadas("default", filtros)
    
    def migrar_entidades_legacy(self):
        """Migra entidades de tabla legacy a entidades_indexadas."""
        from database import get_entidades, guardar_entidad
        entidades = get_entidades()
        migradas = 0
        
        for e in entidades:
            entidad_nueva = {
                "org_id": "default",
                "titulo": e.get("nombre", ""),
                "donante": e.get("sigla", ""),
                "descripcion": e.get("notas", ""),
                "url_convocatoria": e.get("url_convocatorias", ""),
                "url_fuente": e.get("sitio_web", ""),
                "isGlobal": 0,
                "targetCountry": e.get("pais", ""),
                "sectors": e.get("sectores", []),
                "monto_max": e.get("monto_total", 0),
                "moneda": e.get("moneda", "USD"),
                "score_compatibilidad": 70,
                "estado": "activa",
                "origen": "migracion_legacy",
            }
            indexar_entidad(entidad_nueva)
            migradas += 1
        
        log_ejecucion("RADAR4_ARQUITECTO", "migracion", f"{migradas} entidades migradas")
        return migradas
    
    def limpiar_duplicados(self) -> int:
        """Elimina entidades duplicadas."""
        import sqlite3
        db_path = Path(__file__).parent.parent / "data" / "radar.db"
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Encontrar duplicados por título
        c.execute("""
            DELETE FROM entidades_indexadas
            WHERE id NOT IN (
                SELECT MIN(id) FROM entidades_indexadas
                GROUP BY titulo
            )
        """)
        eliminados = c.rowcount
        conn.commit()
        conn.close()
        
        log_ejecucion("RADAR4_ARQUITECTO", "limpieza", f"{eliminados} duplicados eliminados")
        return eliminados


def main():
    """Ejecución principal del arquitecto."""
    a = Arquitecto()
    
    # Indexar aprobadas pendientes
    aprobadas = a.obtener_aprobadas()
    indexados = 0
    for item in aprobadas:
        try:
            a.indexar_item(item)
            indexados += 1
        except Exception as e:
            print(f"Error indexando {item.get('id')}: {e}")
    
    entidades = a.get_entidades_indexadas()
    
    print("\n" + "="*50)
    print("🎯 005_RADAR4_ARQUITECTO")
    print("="*50)
    print(f"Entidades indexadas: {len(entidades)}")
    print(f"Nuevas indexadas esta ejecución: {indexados}")
    print("="*50)


if __name__ == "__main__":
    main()