from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime

# ============================================================
# MODELOS MULTI-TENANT - RADAR 360
# ============================================================

class Organizacion(BaseModel):
    id: str
    nombre: str
    pais: Optional[str] = None
    email_admin: Optional[str] = None
    api_key_google: Optional[str] = None
    notebook_google: Optional[str] = None
    limite_prospectos: int = 300
    activa: bool = True
    plan: str = "basico"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class UsuarioOrg(BaseModel):
    id: str
    org_id: str
    email: str
    rol: Literal["admin", "editor", "viewer"] = "editor"
    nombre: Optional[str] = None
    ultimo_login: Optional[str] = None
    active_session: Optional[str] = None

class Proyecto(BaseModel):
    id: str
    org_id: str
    nombre: str
    descripcion: Optional[str] = None
    palabras_clave: List[str] = []
    estado: Literal["activo", "pausado", "completado"] = "activo"
    creado_en: Optional[str] = None
    actualizado_en: Optional[str] = None

class DocumentoContexto(BaseModel):
    id: str
    proyecto_id: str
    nombre: str
    tipo: Literal["pdf", "doc", "txt", "url"] = "txt"
    contenido: Optional[str] = None
    embedding_vector: Optional[str] = None
    uploaded_en: Optional[str] = None

# ============================================================
# MODELOS COLA DE VALIDACIÓN (AGENTE VALIDADOR)
# ============================================================

class ItemColaValidacion(BaseModel):
    id: str
    org_id: str
    titulo: str
    donante: Optional[str] = None
    url_fuente: Optional[str] = None
    descripcion: Optional[str] = None
    monto_estimado: Optional[float] = None
    fecha_cierre: Optional[str] = None
    paises_elegibles: List[str] = []
    sectores: List[str] = []
    score_encontrado: int = 50
    fuente: Optional[str] = None
    estado: Literal["pendiente", "aprobado", "descartado"] = "pendiente"
    fecha_ingreso: Optional[str] = None
    revisado_por: Optional[str] = None
    decision: Optional[str] = None
    decision_notas: Optional[str] = None

class DecisionValidacion(BaseModel):
    item_id: str
    decision: Literal["aprobado", "descartado"]
    notas: Optional[str] = ""
    revisado_por: str = "usuario"

# ============================================================
# MODELOS ENTIDADES INDEXADAS (AGENTE ARQUITECTO DE DATOS)
# ============================================================

class EntidadIndexada(BaseModel):
    id: str
    org_id: str
    titulo: str
    donante: Optional[str] = None
    descripcion: Optional[str] = None
    monto_min: float = 0
    monto_max: float = 0
    moneda: str = "USD"
    url_convocatoria: Optional[str] = None
    url_fuente: Optional[str] = None
    fecha_cierre: Optional[str] = None
    fecha_publicacion: Optional[str] = None
    paises_elegibles: List[str] = []
    sectores: List[str] = []
    poblacion_objetivo: List[str] = []
    tipo_fondo: Optional[str] = None
    requisitos: List[str] = []
    tags: List[str] = []
    score_compatibilidad: int = 50
    estado: Literal["activa", "cerrada", "archivada"] = "activa"
    origen: Optional[str] = None
    proyecto_id: Optional[str] = None
    fecha_indexacion: Optional[str] = None

# ============================================================
# MODELOS FILTROS RADARGRID
# ============================================================

class FiltrosRadarGrid(BaseModel):
    pais: Optional[str] = None
    global_mode: bool = False
    tipo_fondo: Optional[str] = None
    sectores: List[str] = []
    poblacion_objetivo: List[str] = []
    monto_min: Optional[float] = None
    monto_max: Optional[float] = None

# ============================================================
# MODELOS MOTOR B - BÚSQUEDA SEMÁNTICA
# ============================================================

class BusquedaSemanticaRequest(BaseModel):
    proyecto_id: str
    query: str
    limite: int = 50

class ResultadoBusquedaSemantica(BaseModel):
    entidad: EntidadIndexada
    score_similitud: float
    coincidencias: List[str]

# ============================================================
# MODELOS GRANT OPPORTUNITY (LEGACY)
# ============================================================

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

# ============================================================
# MODELOS ESTADÍSTICAS
# ============================================================

class EstadisticasOrganizacion(BaseModel):
    entidadesIndexadas: int
    pendienteValidacion: int
    proyectosActivos: int
    documentosContexto: int