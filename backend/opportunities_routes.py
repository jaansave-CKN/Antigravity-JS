from fastapi import APIRouter, Query
from normative_engine import NormativeEngine

router = APIRouter(prefix="/api/opportunities", tags=["opportunities"])
engine = NormativeEngine()

@router.get("")
async def get_opportunities(
    south: float = Query(...),
    north: float = Query(...),
    west: float = Query(...),
    east: float = Query(...),
    min_score: int = Query(50)
):
    bounds = {
        "south": south,
        "north": north,
        "west": west,
        "east": east
    }
    opportunidades = engine.buscar_opportunidades_filtradas(bounds, min_score)
    return opportunidades

@router.get("/evaluate/{matricula}")
async def evaluate_property(matricula: str, lat: float, lng: float):
    from normative_engine import Predio
    predio = Predio(
        id="temp",
        lat=lat,
        lng=lng,
        direccion="Pendiente",
        area_m2=0,
        valor_catastral=0,
        propietario="Pendiente",
        matricula=matricula
    )
    return engine.evaluar_oportunidad(predio)