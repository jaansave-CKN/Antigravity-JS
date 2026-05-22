"""
agents/scraper_core.py
======================
Agente extractor real de convocatorias internacionales.
Ejecutar: python agents/scraper_core.py
Integración: Llamado por FastAPI background worker.
"""
import sqlite3
import uuid
import hashlib
import logging
import re
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

import requests
from bs4 import BeautifulSoup

THIS_FILE = Path(__file__).resolve()
PROJECT_ROOT = THIS_FILE.parent.parent
DB_PATH = PROJECT_ROOT / "backend" / "radar.db"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("scraper_core")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
}

SECTORES_CLAVE = {
    "infraestructura": ["infraestructura", "construcción", "carreteras", "puentes", "vivienda", "urbanismo"],
    "rural": ["rural", "agricultura", "desarrollo rural", "seguridad alimentaria", "campesino"],
    "ambiente": ["ambiente", "cambio climático", "sostenibilidad", "recursos hídricos", "biodiversidad"],
    "energia": ["energía", "energías renovables", "electricidad", "generación"],
    "salud": ["salud", "sanidad", "hospital", "medicamentos", "epidemiología"],
    "educacion": ["educación", "formación", "capacitación", "becas", "investigación"],
    "tecnologia": ["tecnología", "digital", "innovación", "startups", "inteligencia artificial"],
}

FORMATO_MGA = "MGA"


class ScraperCore:
    def __init__(self, db_path: str = None):
        self.db_path = db_path or str(DB_PATH)
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.nuevas_convocatorias = []
        
    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _generar_hash(self, titulo: str, url: str) -> str:
        raw = f"{titulo.lower().strip()}|{url.strip()}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def _existe_convocatoria(self, hash_unico: str) -> bool:
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM convocatorias WHERE externo_id = ?", (hash_unico,))
        existe = cur.fetchone()[0] > 0
        conn.close()
        return existe

    def _calcular_score(self, titulo: str, descripcion: str, sector: str) -> int:
        texto = f"{titulo} {descripcion} {sector}".lower()
        score = 50
        
        for sector_nombre, keywords in SECTORES_CLAVE.items():
            for kw in keywords:
                if kw.lower() in texto:
                    score += 10
        
        score = min(score, 100)
        return score

    def _normalizar_monto(self, monto_str: str) -> tuple:
        if not monto_str:
            return 0, 0
        
        numeros = re.findall(r"[\d,.]+", monto_str.replace("$", "").replace("USD", "").replace("€", ""))
        if not numeros:
            return 0, 0
        
        try:
            valor = float(numeros[0].replace(",", ""))
            if valor < 1000:
                return valor, valor * 1.5
            return valor * 0.8, valor * 1.2
        except:
            return 0, 0

    def _detectar_sector(self, titulo: str, descripcion: str = "") -> str:
        texto = f"{titulo} {descripcion}".lower()
        
        for sector, keywords in SECTORES_CLAVE.items():
            for kw in keywords:
                if kw in texto:
                    return sector.capitalize()
        return "General"

    def _insertar_convocatoria(self, datos: dict) -> Optional[int]:
        hash_unico = self._generar_hash(datos["titulo"], datos.get("url", ""))
        
        if self._existe_convocatoria(hash_unico):
            logger.info(f"Duplicado ignorado: {datos['titulo'][:50]}...")
            return None
        
        conn = self._get_connection()
        cur = conn.cursor()
        
        monto_min, monto_max = self._normalizar_monto(datos.get("monto", ""))
        sector = self._detectar_sector(datos["titulo"], datos.get("descripcion", ""))
        score = self._calcular_score(datos["titulo"], datos.get("descripcion", ""), sector)
        
        now = datetime.utcnow().isoformat()
        
        cur.execute("""
            INSERT INTO convocatorias 
            (externo_id, titulo, donante, fuente, descripcion,
             monto_min, monto_max, moneda, paises_elegibles, sectores,
             url_convocatoria, url_fuente, fecha_limite, fecha_publicacion,
             requisitos, resumen_tecnico, es_elegible, score_probabilidad,
             estado, favorito, categoria_gestion, compatibilidad_perfil,
             scraped_en, created_at, actualizado_en)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            hash_unico,
            datos["titulo"][:500],
            datos.get("donante", "Desconocido"),
            datos.get("fuente", "scraped"),
            datos.get("descripcion", "")[:2000],
            monto_min,
            monto_max,
            datos.get("moneda", "USD"),
            datos.get("paises", "['Colombia']"),
            datos.get("sectores", f"['{sector}']"),
            datos.get("url", ""),
            datos.get("url", ""),
            datos.get("fecha_cierre", ""),
            now,
            datos.get("requisitos", "[]"),
            datos.get("resumen", "")[:2000],
            1,
            score,
            datos.get("estado", "nueva"),
            0,
            datos.get("categoria", "migrado"),
            50,
            now,
            now,
            now
        ))
        
        conn.commit()
        row_id = cur.lastrowid
        conn.close()
        
        logger.info(f"[NEW] Convocatoria insertada: {datos['titulo'][:60]}... (ID: {row_id})")
        
        datos["id"] = row_id
        datos["timestamp"] = now
        self.nuevas_convocatorias.append(datos)
        
        return row_id

    def _scrapear_giz(self) -> List[Dict]:
        """Scraper para portal GIZ (Cooperación Alemana)"""
        resultados = []
        
        URLs_GIZ = [
            ("https://www.giz.de/en/worldwide/colombia.html", "GIZ Colombia"),
            ("https://www.giz.de/en/worldwide/colombia.html?tab=projects", "GIZ Proyectos"),
        ]
        
        for url, fuente in URLs_GIZ:
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    continue
                    
                soup = BeautifulSoup(resp.text, "html.parser")
                
                for link in soup.find_all("a", href=True):
                    href = link.get("href", "")
                    text = link.get_text(strip=True)
                    
                    if any(palabra in text.lower() for palabra in ["convocatoria", "funding", "grant", "proposal", "call"]):
                        resultados.append({
                            "titulo": text[:200],
                            "donante": fuente,
                            "fuente": "GIZ",
                            "url": href if href.startswith("http") else f"https://www.giz.de{href}",
                            "descripcion": f"Proyecto GIZ detectado: {text}",
                            "monto": "",
                            "fecha_cierre": "",
                            "estado": "nueva"
                        })
                        
            except Exception as e:
                logger.warning(f"GIZ scrap error ({url}): {e}")
                
        return resultados

    def _scrapear_iadb(self) -> List[Dict]:
        """Scraper para BID (Banco Interamericano de Desarrollo)"""
        resultados = []
        
        URLs_BID = [
            ("https://www.iadb.org/en/about/our-projects", "BID Proyectos"),
            ("https://www.iadb.org/en/who-we-are/development-entities/inter-american-investment-corporation", "BID Corp"),
        ]
        
        for url, fuente in URLs_BID:
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    continue
                    
                soup = BeautifulSoup(resp.text, "html.parser")
                
                for link in soup.find_all("a", href=True):
                    href = link.get("href", "")
                    text = link.get_text(strip=True)
                    
                    if any(palabra in text.lower() for palabra in ["call", "proposal", "grant", "opportunity", "convocatoria"]):
                        resultados.append({
                            "titulo": text[:200],
                            "donante": fuente,
                            "fuente": "BID",
                            "url": href if href.startswith("http") else f"https://www.iadb.org{href}",
                            "descripcion": f"BID: {text}",
                            "monto": "",
                            "fecha_cierre": "",
                            "estado": "nueva"
                        })
                        
            except Exception as e:
                logger.warning(f"BID scrap error ({url}): {e}")
                
        return resultados

    def _scrapear_pnud(self) -> List[Dict]:
        """Scraper para PNUD (Programa de Naciones Unidas)"""
        resultados = []
        
        URLs_PNUD = [
            ("https://www.undp.org/work-with-us/funding-opportunities", "PNUD Oportunidades"),
            ("https://www.undp.org/colombia/proyectos", "PNUD Colombia"),
        ]
        
        for url, fuente in URLs_PNUD:
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    continue
                    
                soup = BeautifulSoup(resp.text, "html.parser")
                
                for link in soup.find_all("a", href=True):
                    href = link.get("href", "")
                    text = link.get_text(strip=True)
                    
                    if any(palabra in text.lower() for palabra in ["call", "proposal", "grant", "opportunity", "convocatoria"]):
                        resultados.append({
                            "titulo": text[:200],
                            "donante": fuente,
                            "fuente": "PNUD",
                            "url": href if href.startswith("http") else f"https://www.undp.org{href}",
                            "descripcion": f"PNUD: {text}",
                            "monto": "",
                            "fecha_cierre": "",
                            "estado": "nueva"
                        })
                        
            except Exception as e:
                logger.warning(f"PNUD scrap error ({url}): {e}")
                
        return resultados

    def _scrapear_usaid(self) -> List[Dict]:
        """Scraper para USAID"""
        resultados = []
        
        URLs_USAID = [
            ("https://www.usaid.gov/colombia/funding", "USAID Colombia"),
            ("https://www.usaid.gov/work-with-us/funding", "USAID Funding"),
        ]
        
        for url, fuente in URLs_USAID:
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    continue
                    
                soup = BeautifulSoup(resp.text, "html.parser")
                
                for link in soup.find_all("a", href=True):
                    href = link.get("href", "")
                    text = link.get_text(strip=True)
                    
                    if any(palabra in text.lower() for palabra in ["funding", "grant", "solicitation", "rfa", "rfp"]):
                        resultados.append({
                            "titulo": text[:200],
                            "donante": fuente,
                            "fuente": "USAID",
                            "url": href if href.startswith("http") else f"https://www.usaid.gov{href}",
                            "descripcion": f"USAID: {text}",
                            "monto": "",
                            "fecha_cierre": "",
                            "estado": "nueva"
                        })
                        
            except Exception as e:
                logger.warning(f"USAID scrap error ({url}): {e}")
                
        return resultados

    def _scrapear_caf(self) -> List[Dict]:
        """Scraper para CAF (Banco de Desarrollo de América Latina)"""
        resultados = []
        
        URLs_CAF = [
            ("https://www.caf.com/es/convocatorias/", "CAF Convocatorias"),
            ("https://www.caf.com/en/projects/", "CAF Proyectos"),
        ]
        
        for url, fuente in URLs_CAF:
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code != 200:
                    continue
                    
                soup = BeautifulSoup(resp.text, "html.parser")
                
                for link in soup.find_all("a", href=True):
                    href = link.get("href", "")
                    text = link.get_text(strip=True)
                    
                    if len(text) > 10:
                        resultados.append({
                            "titulo": text[:200],
                            "donante": fuente,
                            "fuente": "CAF",
                            "url": href if href.startswith("http") else f"https://www.caf.com{href}",
                            "descripcion": f"CAF: {text}",
                            "monto": "",
                            "fecha_cierre": "",
                            "estado": "nueva"
                        })
                        
            except Exception as e:
                logger.warning(f"CAF scrap error ({url}): {e}")
                
        return resultados

    async def ejecutar_barrido(self) -> dict:
        """Ejecuta el ciclo completo de scraping."""
        logger.info("=" * 60)
        logger.info("SCRAPER CORE - INICIANDO BARRIDO")
        logger.info("=" * 60)
        
        self.nuevas_convocatorias = []
        
        scrapers = [
            ("GIZ", self._scrapear_giz),
            ("BID", self._scrapear_iadb),
            ("PNUD", self._scrapear_pnud),
            ("USAID", self._scrapear_usaid),
            ("CAF", self._scrapear_caf),
        ]
        
        total_extraidos = 0
        total_insertados = 0
        
        for nombre, scraper_func in scrapers:
            logger.info(f"Scraping {nombre}...")
            try:
                resultados = scraper_func()
                total_extraidos += len(resultados)
                
                for item in resultados:
                    row_id = self._insertar_convocatoria(item)
                    if row_id:
                        total_insertados += 1
                        
            except Exception as e:
                logger.error(f"Error en scraper {nombre}: {e}")
                
        logger.info("=" * 60)
        logger.info(f"BARRIDO COMPLETADO: {total_extraidos} extraidos, {total_insertados} nuevos")
        logger.info("=" * 60)
        
        return {
            "extraidos": total_extraidos,
            "insertados": total_insertados,
            "nuevas": self.nuevas_convocatorias
        }

    async def broadcast_nuevas(self, ws_manager=None):
        """Envía las nuevas convocatorias por WebSocket."""
        if not ws_manager or not self.nuevas_convocatorias:
            return
            
        for conv in self.nuevas_convocatorias:
            await ws_manager.broadcast({
                "event": "NEW_FUND_DETECTED",
                "data": conv
            })
            logger.info(f"Broadcast enviado: {conv['titulo'][:40]}...")


def run_scraper():
    """Ejecución directa del script."""
    scraper = ScraperCore()
    resultado = asyncio.run(scraper.ejecutar_barrido())
    print(f"\nRESULTADO: {resultado['insertados']} nuevas convocatorias insertadas")


if __name__ == "__main__":
    run_scraper()