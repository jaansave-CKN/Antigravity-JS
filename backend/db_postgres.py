# ============================================================================
# POSTGRESQL CONFIGURATION - RADAR FONDOS 360
# ============================================================================
# Migración de SQLite a PostgreSQL para producción/SaaS.

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
import os
from pathlib import Path
import sys

# RUTAS
THIS_FILE = Path(__file__).resolve()
PROJECT_ROOT = THIS_FILE.parent.parent

# .env para producción
from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

# ============================================================================
# CADENA DE CONEXIÓN POSTGRESQL
# ============================================================================

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_USER = os.getenv("POSTGRES_USER", "radar_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "radar_password")
POSTGRES_DB = os.getenv("POSTGRES_DB", "radar_fondos")

DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ============================================================================
# MODELOS SQLALCHEMY (PARA POSTGRESQL)
# ============================================================================

from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

class Entidad(Base):
    __tablename__ = "entidades"

    id = Column(String, primary_key=True)
    nombre = Column(String(255))
    pais = Column(String(100))
    tipo_entidad = Column(String(100))
    url = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

class Convocatoria(Base):
    __tablename__ = "convocatorias"

    id = Column(Integer, primary_key=True, autoincrement=True)
    titulo = Column(String(500))
    sector = Column(String(100))
    tipo_financiamiento = Column(String(100))
    formato_formulacion = Column(String(50))
    monto = Column(Float)
    url = Column(Text)
    fecha_cierre = Column(String(20))
    score = Column(Float, default=50.0)
    estado = Column(String(50), default="pendiente")
    entidad_id = Column(String(100))
    es_favorito = Column(Boolean, default=False)
    creado_en = Column(DateTime, server_default=func.now())

class ColaValidacion(Base):
    __tablename__ = "cola_validacion"

    id = Column(String, primary_key=True)
    org_id = Column(String(100))
    titulo = Column(String(500))
    donante = Column(String(255))
    url_fuente = Column(Text)
    descripcion = Column(Text)
    monto_estimado = Column(Float)
    fecha_cierre = Column(String(20))
    paises_elegibles = Column(Text)
    sectores = Column(Text)
    score_encontrado = Column(Integer, default=50)
    fuente = Column(String(100))
    estado = Column(String(50), default="pendiente")
    fecha_ingreso = Column(DateTime, server_default=func.now())

class EntidadIndexada(Base):
    __tablename__ = "entidades_indexadas"

    id = Column(String, primary_key=True)
    org_id = Column(String(100))
    titulo = Column(String(500))
    donante = Column(String(255))
    descripcion = Column(Text)
    monto_min = Column(Float)
    monto_max = Column(Float)
    moneda = Column(String(10), default="USD")
    url_convocatoria = Column(Text)
    url_fuente = Column(Text)
    fecha_cierre = Column(String(20))
    fecha_publicacion = Column(String(20))
    paises_elegibles = Column(Text)
    sectores = Column(Text)
    poblacion_objetivo = Column(Text)
    tipo_fondo = Column(String(100))
    requisitos = Column(Text)
    tags = Column(Text)
    score_compatibilidad = Column(Integer, default=50)
    estado = Column(String(50), default="activa")
    origen = Column(String(100))
    proyecto_id = Column(String(100))
    fecha_indexacion = Column(DateTime, server_default=func.now())

# ============================================================================
# FUNCIONES DE CONEXIÓN
# ============================================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_postgres():
    Base.metadata.create_all(bind=engine)
    print(f"✅ PostgreSQL connected: {POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}")

if __name__ == "__main__":
    init_postgres()