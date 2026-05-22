"""
RadarFondos Normative Engine v1.0
=================================
Motor de cruce normativo y georreferenciación para predios
"""

import sqlite3
import json
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "radar.db"


@dataclass
class Predio:
    id: str
    lat: float
    lng: float
    direccion: str
    area_m2: float
    valor_catastral: float
    propietario: str
    matricula: str


@dataclass
class Restrictiva:
    tipo: str
    descripcion: str
    severidad: str
    documento_ref: str


class NormativeEngine:
    RESTRICTIONS_POT = {
        "zona_residencial": {"permitido": ["vivienda", "comercio_minorista"], "restringido": ["industrial", "agropecuario"]},
        "zona_comercial": {"permitido": ["comercio", "oficinas"], "restringido": ["vivienda_social", "agropecuario"]},
        "zona_industrial": {"permitido": ["industrial", "almacenamiento"], "restringido": ["vivienda", "recreativo"]},
        "zona_protegida": {"permitido": [], "restringido": ["todo"]}
    }

    def __init__(self, db_path: str = None):
        self.db_path = db_path or str(DB_PATH)

    def _get_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def cruzar_pot(self, lat: float, lng: float) -> List[Restrictiva]:
        """Cruza coordenadas con Plan de Ordenamiento Territorial"""
        restrictivas = []
        conn = self._get_db()
        cur = conn.cursor()
        try:
            cur.execute("""
                SELECT zona_tipo, restricciones, normativa FROM zonas_pot 
                WHERE ? BETWEEN lat_min AND lat_max 
                AND ? BETWEEN lng_min AND lng_max
            """, (lat, lng))
            row = cur.fetchone()
            if row:
                zona = row["zona_tipo"]
                norma = json.loads(row["normativa"] or "{}")
                restrictivas.append(Restrictiva(
                    tipo="POT",
                    descripcion=f"Zona clasificada como: {zona}",
                    severidad=norma.get("severidad", "media"),
                    documento_ref=row["restricciones"]
                ))
                for r in norma.get("restricciones_especificas", []):
                    restrictivas.append(Restrictiva(
                        tipo=r.get("tipo", "general"),
                        descripcion=r.get("descripcion", ""),
                        severidad=r.get("severidad", "baja"),
                        documento_ref=r.get("norma", "")
                    ))
        except Exception:
            pass
        finally:
            conn.close()
        return restrictivas

    def consultar_historial_legal(self, matricula: str) -> Dict[str, Any]:
        """Consulta historial legal: sucesiones, embargos, déficit impuestos"""
        historial = {
            "sucesiones": [],
            "embargos": [],
            "déficit_impuestos": [],
            "estado_general": "libre"
        }
        conn = self._get_db()
        cur = conn.cursor()
        try:
            cur.execute("SELECT * FROM sucesiones WHERE matricula = ?", (matricula,))
            historial["sucesiones"] = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT * FROM embargos WHERE matricula = ?", (matricula,))
            historial["embargos"] = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT * FROM impuestos WHERE matricula = ?", (matricula,))
            historial["déficit_impuestos"] = [dict(r) for r in cur.fetchall()]
            if historial["embargos"] or historial["déficit_impuestos"]:
                historial["estado_general"] = "con_cargas"
        finally:
            conn.close()
        return historial

    def evaluar_oportunidad(self, predio: Predio) -> Dict[str, Any]:
        """Evalúa una oportunidad inmobiliaria completa"""
        restrictivas = self.cruzar_pot(predio.lat, predio.lng)
        historial = self.consultar_historial_legal(predio.matricula)
        
        score = 100
        alertas = []
        recomendaciones = []
        
        for r in restrictivas:
            if r.severidad == "alta":
                score -= 30
                alertas.append(f"Restricción alta: {r.descripcion}")
            elif r.severidad == "media":
                score -= 15
                alertas.append(f"Restricción media: {r.descripcion}")
        
        if historial["embargos"]:
            score -= 40
            alertas.append(f"Embargos judiciales detectados: {len(historial['embargos'])}")
        
        if historial["déficit_impuestos"]:
            score -= 20
            alertas.append(f"Déficit de impuestos: {len(historial['déficit_impuestos'])}")
        
        if score >= 80:
            recomendaciones.append("Oportunidad recomendada - Bajo riesgo legal")
        elif score >= 50:
            recomendaciones.append("Oportunidad moderada - Requiere revisión")
        else:
            recomendaciones.append("No recomendado - Alto riesgo legal")
        
        return {
            "predio_id": predio.id,
            "score_legal": max(0, score),
            "alertas": alertas,
            "recomendaciones": recomendaciones,
            "restrictivas": [r.__dict__ for r in restrictivas],
            "historial": historial,
            "viable": score >= 50
        }

    def buscar_opportunidades_filtradas(
        self, 
        bounds: Dict[str, float],
        min_score: int = 50
    ) -> List[Dict[str, Any]]:
        """Busca oportunidades dentro de un bounding box"""
        conn = self._get_db()
        cur = conn.cursor()
        resultados = []
        try:
            cur.execute("""
                SELECT * FROM predios 
                WHERE lat BETWEEN ? AND ? 
                AND lng BETWEEN ? AND ?
            """, (bounds["south"], bounds["north"], bounds["west"], bounds["east"]))
            predios = [dict(r) for r in cur.fetchall()]
            for p in predios:
                predio = Predio(**p)
                evaluacion = self.evaluar_oportunidad(predio)
                if evaluacion["score_legal"] >= min_score:
                    resultados.append({
                        **p,
                        "evaluacion": evaluacion
                    })
        finally:
            conn.close()
        return resultados


def init_normative_tables():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS zonas_pot (
            id TEXT PRIMARY KEY,
            lat_min REAL, lat_max REAL,
            lng_min REAL, lng_max REAL,
            zona_tipo TEXT,
            restricciones TEXT,
            normativa TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS predios (
            id TEXT PRIMARY KEY,
            lat REAL, lng REAL,
            direccion TEXT,
            area_m2 REAL,
            valor_catastral REAL,
            propietario TEXT,
            matricula TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sucesiones (
            id TEXT PRIMARY KEY,
            matricula TEXT,
            estado TEXT,
            fecha TEXT,
            herederos TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS embargos (
            id TEXT PRIMARY KEY,
            matricula TEXT,
            juzgado TEXT,
            estado TEXT,
            fecha TEXT,
            monto REAL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS impuestos (
            id TEXT PRIMARY KEY,
            matricula TEXT,
            tipo TEXT,
            deficit REAL,
            fecha TEXT
        )
    """)
    conn.commit()
    conn.close()


__all__ = ["NormativeEngine", "Predio", "Restrictiva", "init_normative_tables"]