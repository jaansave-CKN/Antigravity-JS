from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json
import asyncio
from datetime import datetime
import random

app = FastAPI(title="Radar Fondos 360")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

convocatorias_db = [
    {"id": 1, "titulo": "Fondo de Competitividad Regional 2026", "entidad": "Ministerio de Comercio", "monto": "$15.000.000.000", "sector": "Productividad"},
    {"id": 2, "titulo": "Programa de Infraestructura Vial Rural", "entidad": "Invías", "monto": "$45.000.000.000", "sector": "Infraestructura"},
    {"id": 3, "titulo": "Convocatoria de Investigación Agroindustrial", "entidad": "Colciencias", "monto": "$8.500.000.000", "sector": "Ciencia"},
    {"id": 4, "titulo": "Fondo de Energías Renovables", "entidad": "UPME", "monto": "$22.000.000.000", "sector": "Energía"},
    {"id": 5, "titulo": "Programa de Saneamiento Ambiental", "entidad": "Ministerio Ambiente", "monto": "$31.000.000.000", "sector": "Medio Ambiente"},
    {"id": 6, "titulo": "Convocatoria Digitalización Pymes", "entidad": "MinTIC", "monto": "$12.000.000.000", "sector": "Tecnología"},
]

sectors = ["Productividad", "Infraestructura", "Ciencia", "Energía", "Medio Ambiente", "Tecnología", "Salud", "Educación"]
entities = ["Ministerio de Comercio", "Invías", "Colciencias", "UPME", "Ministerio Ambiente", "MinTIC", "MIPRES", "MEN"]

@app.get("/convocatorias")
async def get_convocatorias():
    return convocatorias_db

@app.get("/")
async def root():
    return {"status": "Radar Fondos 360 - Online", "timestamp": datetime.now().isoformat()}

active_websockets = set()

@app.websocket("/ws/live_radar")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    
    try:
        await websocket.send_json({
            "event": "CONNECTED",
            "data": {"status": "Live & Online", "clients": len(active_websockets)}
        })
        
        while True:
            data = await websocket.receive_text()
            
    except WebSocketDisconnect:
        pass
    finally:
        active_websockets.discard(websocket)

async def broadcast_new_fund():
    new_fund = {
        "id": len(convocatorias_db) + 1,
        "titulo": f"Fondo Emergente {random.choice(['Social', 'Económico', 'Industrial'])} {datetime.now().year}",
        "entidad": random.choice(entities),
        "monto": f"${random.randint(5, 50)}.{random.randint(0, 9)}00.000.000",
        "sector": random.choice(sectors)
    }
    convocatorias_db.insert(0, new_fund)
    
    message = {"event": "NEW_FUND_DETECTED", "data": new_fund}
    
    for ws in list(active_websockets):
        try:
            await ws.send_json(message)
        except:
            active_websockets.discard(ws)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(simulate_new_funds())

async def simulate_new_funds():
    await asyncio.sleep(30)
    await broadcast_new_fund()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)