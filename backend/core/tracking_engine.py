"""
Motor de Rastreo en Tiempo Real - Radar 360
============================================
Orquestador APScheduler + WebSockets para seguimiento 24/7
"""

import asyncio
import json
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path
import sys
import os

# APScheduler para scheduling robusto
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

# Para notificaciones en tiempo real
try:
    import websockets
    from websockets.server import serve
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False

# Importar configuración
BACKEND_PATH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_PATH))


class TrackingEngine:
    """Motor de rastreo 24/7 con agenda configurable."""
    
    def __init__(self, interval_hours: int = 6):
        self.scheduler = AsyncIOScheduler()
        self.interval_hours = interval_hours
        self.active_clients: List = []
        self.fuentes = self._cargar_fuentes()
        self.ultimo_ciclo: Optional[datetime] = None
        self.estadisticas_ciclo: Dict = {}
        
    def _cargar_fuentes(self) -> List[Dict]:
        """Carga las fuentes de monitoreo desde configuración."""
        return [
            {"id": "giz", "nombre": "GIZ", "url": "https://www.giz.de/en/worldwide/colombia.html", "parser": "giz"},
            {"id": "eu", "nombre": "EU Horizon", "url": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls", "parser": "eu"},
            {"id": "usaid", "nombre": "USAID", "url": "https://www.usaid.gov/colombia/funding", "parser": "usaid"},
            {"id": "bid", "nombre": "BID", "url": "https://www.iadb.org/en/opportunities", "parser": "bid"},
            {"id": "pnud", "nombre": "PNUD", "url": "https://www.undp.org/work-with-us/funding-opportunities", "parser": "pnud"},
        ]
    
    async def ejecutar_barrido(self) -> Dict:
        """Ejecuta un ciclo de búsqueda en todas las fuentes."""
        inicio = datetime.now()
        resultados = {"fuentes_procesadas": 0, "convocatorias_nuevas": 0, "errores": []}
        
        for fuente in self.fuentes:
            try:
                nuevas = await self._scrapear_fuente(fuente)
                resultados["fuentes_procesadas"] += 1
                resultados["convocatorias_nuevas"] += len(nuevas)
                # Notificar por WebSocket
                await self._notificar_resultados(nuevas)
            except Exception as e:
                resultados["errores"].append(f"{fuente['nombre']}: {str(e)}")
        
        self.ultimo_ciclo = inicio
        duracion = (datetime.now() - inicio).total_seconds()
        self.estadisticas_ciclo = resultados
        
        return {
            "timestamp": inicio.isoformat(),
            "duracion_segundos": duracion,
            **resultados
        }
    
    async def _scrapear_fuente(self, fuente: Dict) -> List[Dict]:
        """Scrapea una fuente específica."""
        import aiohttp
        from bs4 import BeautifulSoup
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(fuente["url"], timeout=30) as response:
                    html = await response.text()
                    soup = BeautifulSoup(html, "html.parser")
                    
                    # Parsear según el tipo de fuente
                    if fuente["parser"] == "giz":
                        return self._parsear_giz(soup)
                    # Agregar más parsers según necesidad
                    
            return []
        except Exception as e:
            raise e
    
    def _parsear_giz(self, soup) -> List[Dict]:
        """Parser específico para GIZ."""
        convocatorias = []
        # Lógica de parsing específica
        for item in soup.find_all("div", class_="teaser")[:10]:
            convocatorias.append({
                "titulo": item.get_text(strip=True)[:200],
                "url": item.find("a")["href"] if item.find("a") else "",
                "fuente": "GIZ",
                "fecha_scraping": datetime.now().isoformat()
            })
        return convocatorias
    
    async def _notificar_resultados(self, convocatorias: List[Dict]):
        """Envía notificaciones por WebSocket a clientes conectados."""
        if not WEBSOCKETS_AVAILABLE or not self.active_clients:
            return
            
        mensaje = json.dumps({
            "tipo": "nuevas_convocatorias",
            "data": convocatorias
        })
        
        for client in self.active_clients[:]:
            try:
                await client.send(mensaje)
            except:
                self.active_clients.remove(client)
    
    def iniciar(self):
        """Inicia el scheduler."""
        trigger = IntervalTrigger(hours=self.interval_hours)
        self.scheduler.add_job(
            self.ejecutar_barrido,
            trigger,
            id="barrido_24h",
            max_instances=1
        )
        self.scheduler.start()
        
    def detener(self):
        """Detiene el scheduler."""
        self.scheduler.shutdown()


# Singleton del motor
_engine_instance: Optional[TrackingEngine] = None

def get_engine(interval_hours: int = 6) -> TrackingEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = TrackingEngine(interval_hours)
    return _engine_instance


if __name__ == "__main__":
    engine = get_engine(1)  # Cada hora para pruebas
    engine.iniciar()
    print("Motor de rastreo iniciado. Ctrl+C para detener.")
    try:
        asyncio.get_event_loop().run_forever()
    except KeyboardInterrupt:
        engine.detener()