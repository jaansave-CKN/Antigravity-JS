"""
WebSocket Manager - Exposición en Tiempo Real de Convocatorias
================================================================
Servidor WebSocket integrado con FastAPI para actualizaciones live
"""

import json
from datetime import datetime
from typing import Dict, Set
from pathlib import Path
import sys

# Para FastAPI + WebSockets
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    from starlette.endpoints import WebSocketEndpoint
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False

BACKEND_PATH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_PATH))

from core.tracking_engine import get_engine


class ConnectionManager:
    """Gestor de conexiones WebSocket."""
    
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        if client_id not in self.active_connections:
            self.active_connections[client_id] = set()
        self.active_connections[client_id].add(websocket)
    
    def disconnect(self, websocket: WebSocket, client_id: str):
        self.active_connections.get(client_id, set()).discard(websocket)
    
    async def broadcast(self, message: dict, client_id: str = "all"):
        data = json.dumps(message)
        targets = list(self.active_connections.get(client_id, set()))
        for ws in targets:
            try:
                await ws.send_text(data)
            except:
                self.disconnect(ws, client_id)
    
    async def send_personal(self, message: dict, websocket: WebSocket):
        await websocket.send_text(json.dumps(message))


manager = ConnectionManager()


async def websocket_endpoint(websocket: WebSocket):
    """Endpoint WebSocket para clientes."""
    await websocket.accept()
    client_id = websocket.query_params.get("client_id", "anon")
    
    try:
        while True:
            data = await websocket.receive_text()
            mensaje = json.loads(data)
            
            if mensaje.get("tipo") == "ping":
                await websocket.send_text(json.dumps({"tipo": "pong"}))
            elif mensaje.get("tipo") == "suscribirse":
                await websocket.send_text(json.dumps({
                    "tipo": "suscripcion_ok",
                    "canal": mensaje.get("canal", "default")
                }))
    except WebSocketDisconnect:
        manager.disconnect(websocket, client_id)


def create_fastapi_app() -> "FastAPI":
    """Crea la aplicación FastAPI con WebSocket integrado."""
    app = FastAPI(
        title="Radar Fondos 360 - API en Tiempo Real",
        version="1.0.0"
    )
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    @app.websocket("/ws")
    async def ws_connect(websocket: WebSocket):
        await websocket_endpoint(websocket)
    
    @app.get("/api/live/stats")
    async def get_live_stats():
        """Endpoint para estadísticas en vivo."""
        engine = get_engine()
        return {
            "status": "running" if engine.scheduler.running else "stopped",
            "ultimo_ciclo": engine.ultimo_ciclo.isoformat() if engine.ultimo_ciclo else None,
            "estadisticas": engine.estadisticas_ciclo
        }
    
    @app.post("/api/live/trigger")
    async def trigger_manual():
        """Dispara un ciclo manual."""
        engine = get_engine()
        result = await engine.ejecutar_barrido()
        return result
    
    return app


if __name__ == "__main__":
    import uvicorn
    app = create_fastapi_app()
    uvicorn.run(app, host="0.0.0.0", port=8000)