from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class GrantOpportunity(BaseModel):
    id: str
    titulo: str
    donante: str
    monto_maximo_usd: float
    fecha_cierre: datetime
    paises_elegibles: List[str]
    sectores_aplicables: List[str]
    probabilidad_exito: int = Field(ge=0, le=100)
    resumen_tecnico: str
    requisitos_legales: List[str]
    url_fuente: str