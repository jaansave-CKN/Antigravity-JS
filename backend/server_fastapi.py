"""
FASTAPI SERVER - RADAR FONDOS 360
=================================
Endpoints: REST API + WebSocket /ws/live_radar
Ejecutar: python backend/server_fastapi.py
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# RUTAS ABSOLUTAS
THIS_FILE = Path(__file__).resolve()
PROJECT_ROOT = THIS_FILE.parent.parent
BACKEND_DIR = THIS_FILE.parent
DATA_DIR = PROJECT_ROOT / "data"
LOGS_DIR = PROJECT_ROOT / "logs"
DB_PATH = DATA_DIR / "radar.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(PROJECT_ROOT / "backend" / "core"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler(LOGS_DIR / "server.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("radar_fondos_360")

from database import get_convocatorias, guardar_convocatoria, init_db, get_estadisticas, DB_PATH_STR
import sqlite3
from auth_routes import router as auth_router
from opportunities_routes import router as opportunities_router
from payment_routes import router as payment_router


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WS Client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WS Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Broadcast error: {e}")
                self.disconnect(connection)

manager = ConnectionManager()


class RadarBackgroundWorker:
    """Motor de rastreo 24/7 integrado en FastAPI con scraper real."""
    
    def __init__(self):
        self.is_running = False
        self.interval_seconds = 600  # 10 minutos (protege IP de bloqueos)
        self.scraper = None
    
    def _get_scraper(self):
        if self.scraper is None:
            sys.path.insert(0, str(PROJECT_ROOT / "agents"))
            sys.path.insert(0, str(PROJECT_ROOT))
            from scraper_core import ScraperCore
            self.scraper = ScraperCore(str(DB_PATH))
        return self.scraper
    
    async def run(self):
        logger.info(f"Background Worker started (interval: {self.interval_seconds}s)")
        self.is_running = True
        
        while self.is_running:
            try:
                logger.info("[Engine] Iniciando barrido de portales internacionales...")
                
                scraper = self._get_scraper()
                resultado = await scraper.ejecutar_barrido()
                
                if resultado["nuevas"]:
                    logger.info(f"[Engine] Éxito! {len(resultado['nuevas'])} nuevas convocatorias detectadas")
                    
                    await manager.broadcast({
                        "event": "NEW_FUND_DETECTED",
                        "count": len(resultado["nuevas"]),
                        "data": resultado["nuevas"]
                    })
                else:
                    logger.info("[Engine] Sin nuevas convocatorias en este ciclo")
                    
            except Exception as e:
                logger.error(f"[Worker Error]: {e}")
            
            await asyncio.sleep(self.interval_seconds)
    
    def stop(self):
        self.is_running = False

worker = RadarBackgroundWorker()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("FastAPI Server starting...")
    init_db()
    init_normative_tables()
    asyncio.create_task(worker.run())
    yield
    worker.stop()
    logger.info("FastAPI Server stopping...")


app = FastAPI(title="SIA Radar API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConvocatoriaCreate(BaseModel):
    titulo: str
    sector: str = ""
    tipo_financiamiento: str = ""
    formato_formulacion: str = ""
    monto: float = 0.0
    url: str = ""
    fecha_cierre: str = ""
    entidad_id: str = ""


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "SIA Radar", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/convocatorias")
async def list_convocatorias(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    estado: str = Query(None),
    solo_favoritos: bool = Query(False)
):
    filtros = {"estado": estado, "solo_favoritos": solo_favoritos} if estado or solo_favoritos else None
    return get_convocatorias(filtros=filtros, page=page, limit=limit)


@app.post("/api/convocatorias")
async def create_convocatoria(convocatoria: ConvocatoriaCreate):
    data = convocatoria.model_dump()
    row_id = guardar_convocatoria(data)
    
    await manager.broadcast({
        "event": "NEW_FUND_DETECTED",
        "data": {**data, "id": row_id}
    })
    
    return {"id": row_id, "status": "created"}


@app.get("/api/estadisticas")
async def get_stats():
    return get_estadisticas()


app.include_router(auth_router)
app.include_router(opportunities_router)
app.include_router(payment_router)

# --- Serve static frontend ---
STATIC_DIR = PROJECT_ROOT / "dist"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static_assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        from fastapi.responses import FileResponse
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "Not Found"}, status_code=404)


@app.websocket("/ws/live_radar")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await websocket.send_json({"type": "connected", "message": "Radar Fondos 360 API"})
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("tipo") == "ping":
                    await websocket.send_json({"tipo": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    PORT = int(os.getenv("PORT", 8000))
    logger.info(f"Starting on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)