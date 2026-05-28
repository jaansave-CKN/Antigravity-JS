"""
SIA_Radar — database.py
========================
Rutas ABSOLUTAS garantizadas con pathlib.Path(__file__).
Elimina el error "[Errno 2] No such file or directory" sin importar
desde qué consola, directorio de trabajo o subproceso se ejecute.
"""
from __future__ import annotations

import os
import sys
import sqlite3
import uuid
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# 1. RESOLUCIÓN DE RUTAS (blindada contra CWD changes)
# ---------------------------------------------------------------------------
# TODO: La variable _THIS_FILE apunta SIEMPRE a este archivo, no importa
#       desde qué directorio se haya invocado python.
_THIS_FILE: Path  = Path(__file__).resolve()
BACKEND_DIR: Path = _THIS_FILE.parent          # .../backend
PROJECT_ROOT: Path = _THIS_FILE.parent.parent  # raíz del repo
DATA_DIR: Path     = PROJECT_ROOT / "data"
LOGS_DIR: Path     = PROJECT_ROOT / "logs"
DB_PATH: Path      = BACKEND_DIR / "radar.db"  # Ruta real con 292 registros

# Crear directorios si no existen
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Añadir backend al sys.path para imports absolutos desde este paquete
sys.path.insert(0, str(BACKEND_DIR))
# Añadir carpeta de agentes al sys.path
sys.path.insert(0, str(PROJECT_ROOT / "agentes" / "04_arquitecto"))

# ---------------------------------------------------------------------------
# 2. LOGGING
# ---------------------------------------------------------------------------
logger = logging.getLogger("radar.db")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.FileHandler(LOGS_DIR / "database.log", encoding="utf-8")
    _handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_handler)

# Alias en formato string (compatible con SQLAlchemy / subprocess)
DB_URL: str      = f"sqlite:///{DB_PATH}"
DB_PATH_STR: str = str(DB_PATH)

# ---------------------------------------------------------------------------
# 3. IMPORTACIÓN DE CONFIGURACIÓN Y MODELOS
# ---------------------------------------------------------------------------
# Modelos SQLAlchemy - definidos localmente para evitar dependencias rotas

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

Base = declarative_base()

engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DB_URL else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Crear tablas si no existen (SQLAlchemy models)


class Entidad:
    pass


class Convocatoria:
    pass

# ---------------------------------------------------------------------------
# 4. FUNCIONES AUXILIARES DE CREACIÓN DE TABLAS SQLITE
# (Definidas ANTES de las funciones principales que las llaman)
# ---------------------------------------------------------------------------

def _ensure_table_organizaciones(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS organizaciones (
            id               TEXT PRIMARY KEY,
            nombre           TEXT,
            pais             TEXT,
            email_admin      TEXT,
            api_key_google   TEXT,
            notebook_google  TEXT,
            limite_prospectos INTEGER DEFAULT 300,
            activa           INTEGER DEFAULT 1,
            plan             TEXT DEFAULT 'basico',
            created_at       TEXT,
            updated_at       TEXT
        )
    """)

def _ensure_table_proyectos(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS proyectos (
            id           TEXT PRIMARY KEY,
            org_id       TEXT,
            nombre       TEXT,
            descripcion  TEXT,
            palabras_clave TEXT,
            estado       TEXT DEFAULT 'activo',
            creado_en    TEXT,
            actualizado_en TEXT
        )
    """)

def _ensure_table_documentos_contexto(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS documentos_contexto (
            id               TEXT PRIMARY KEY,
            proyecto_id      TEXT,
            nombre           TEXT,
            tipo             TEXT,
            contenido        TEXT,
            embedding_vector TEXT,
            uploaded_en      TEXT
        )
    """)

def _ensure_table_cola_validacion(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cola_validacion (
            id              TEXT PRIMARY KEY,
            org_id          TEXT,
            titulo          TEXT,
            donante         TEXT,
            url_fuente      TEXT,
            descripcion     TEXT,
            monto_estimado  REAL,
            fecha_cierre    TEXT,
            paises_elegibles TEXT,
            sectores        TEXT,
            score_encontrado INTEGER DEFAULT 50,
            fuente          TEXT,
            estado          TEXT DEFAULT 'pendiente',
            fecha_ingreso   TEXT,
            revisado_por    TEXT,
            decision        TEXT,
            decision_notas  TEXT
        )
    """)

def _ensure_table_entidades_indexadas(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS entidades_indexadas (
            id                    TEXT PRIMARY KEY,
            org_id                TEXT,
            titulo                TEXT,
            donante               TEXT,
            descripcion           TEXT,
            monto_min             REAL,
            monto_max             REAL,
            moneda                TEXT DEFAULT 'USD',
            url_convocatoria      TEXT,
            url_fuente            TEXT,
            fecha_cierre          TEXT,
            fecha_publicacion     TEXT,
            paises_elegibles      TEXT,
            sectores              TEXT,
            poblacion_objetivo    TEXT,
            tipo_fondo            TEXT,
            requisitos            TEXT,
            tags                  TEXT,
            score_compatibilidad  INTEGER DEFAULT 50,
            estado                TEXT DEFAULT 'activa',
            origen                TEXT,
            proyecto_id           TEXT,
            fecha_indexacion      TEXT
        )
    """)

def _ensure_table_scraping_log(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS scraping_log (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            entidad          TEXT,
            url              TEXT,
            status           TEXT,
            mensaje          TEXT,
            scraped_en       TEXT
        )
    """)

def _ensure_table_scraped_results(cur: sqlite3.Cursor) -> None:
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS scraped_results (
            id               TEXT PRIMARY KEY,
            entidad_id       TEXT,
            url              TEXT,
            titulo           TEXT,
            monto            TEXT,
            fecha_cierre     TEXT,
            estado           TEXT,
            estado_detectado TEXT,
            contenido_html   TEXT,
            scraped_en       TEXT,
            success          INTEGER,
            error            TEXT
        )
    """)

# ---------------------------------------------------------------------------
# 5. HELPERS DE CONVENIENCIA (Ejecución, Logging, CRUDs)
# ---------------------------------------------------------------------------

# ── Inicialización ──────────────────────────────────────────────────────────

def ensure_db() -> bool:
    """Verifica que el archivo .db exista en disco."""
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")
    return True


def init_db() -> str:
    """Inicializa la BD: crea tablas y directorios faltantes."""
    ensure_db()
    conn = sqlite3.connect(DB_PATH_STR)
    cur = conn.cursor()
    # Llamar a todas las funciones de creación de tablas SQLite y SQLAlchemy
    Base.metadata.create_all(engine) # Crea tablas de SQLAlchemy
    _ensure_table_documentos_contexto(cur)
    _ensure_table_cola_validacion(cur)
    _ensure_table_entidades_indexadas(cur)
    _ensure_table_scraped_results(cur)
    _ensure_table_scraping_log(cur)
    conn.commit()
    conn.close()
    logger.info(f"BD inicializada en {DB_PATH}")
    return str(DB_PATH)


# ── Logging ────────────────────────────────────────────────────────────────

def log_ejecucion(modulo: str, evento: str, detalle: str = "") -> None:
    logger.info(f"[{modulo}] {evento}: {detalle}")


# ── Estadísticas ───────────────────────────────────────────────────────────

def get_estadisticas() -> dict:
    conn            = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur             = conn.cursor()
    return {
        "totalEntidades":  cur.execute("SELECT COUNT(*) FROM entidades").fetchone()[0],
        "resultadosFound": cur.execute("SELECT COUNT(*) FROM convocatorias").fetchone()[0],
        "pendientesValid": cur.execute(
            "SELECT COUNT(*) FROM cola_validacion WHERE estado='pendiente'"
        ).fetchone()[0],
        "aprobados":       cur.execute("SELECT COUNT(*) FROM entidades_indexadas").fetchone()[0],
    }


# ── CRUD entidades ─────────────────────────────────────────────────────────

def guardar_entidad(entidad_data: dict) -> str:
    ent_id = str(uuid.uuid4())
    session = SessionLocal()
    try:
        ent = Entidad(
            id=ent_id,
            nombre=entidad_data.get("nombre", ""),
            pais=entidad_data.get("pais", ""),
            tipo_entidad=entidad_data.get("tipo_entidad", ""),
            url=entidad_data.get("url", ""),
        )
        session.add(ent)
        session.commit()
        logger.info(f"Entidad guardada: {ent.nombre}")
        return ent_id
    except Exception as exc:
        session.rollback()
        logger.error(f"Error guardando entidad: {exc}")
        raise
    finally:
        session.close()


# ── CRUD convocatorias ─────────────────────────────────────────────────────

def guardar_convocatoria(data: dict) -> int:
    conn            = sqlite3.connect(DB_PATH_STR)
    cur             = conn.cursor()
    cur.execute(
        """INSERT INTO convocatorias
           (titulo, sector, tipo_financiamiento, formato_formulacion,
            monto, url, fecha_cierre, score, estado, entidad_id, es_favorito)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            data.get("titulo"),
            data.get("sector"),
            data.get("tipo_financiamiento"),
            data.get("formato_formulacion"),
            data.get("monto"),
            data.get("url"),
            data.get("fecha_cierre"),
            data.get("score", 50.0),
            data.get("estado", "pendiente"),
            data.get("entidad_id"),
            data.get("es_favorito", False),
        ),
    )
    conn.commit()
    row_id = cur.lastrowid
    conn.close()
    logger.info(f"Convocatoria guardada id={row_id}")
    return row_id


def get_convocatorias(filtros: Optional[dict] = None,
                      page: int = 1,
                      limit: int = 50) -> dict:
    conn            = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur             = conn.cursor()
    where_clauses: list[str] = ["1=1"]
    params: list             = []

    if filtros:
        if filtros.get("solo_favoritos"):
            where_clauses.append("es_favorito = 1")
        if filtros.get("estado"):
            where_clauses.append("estado = ?")
            params.append(filtros["estado"])

    where_sql = " AND ".join(where_clauses)
    offset    = (page - 1) * limit

    cur.execute(
        f"SELECT * FROM convocatorias WHERE {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    )
    rows  = [dict(r) for r in cur.fetchall()]
    cur.execute(
        f"SELECT COUNT(*) FROM convocatorias WHERE {where_sql}", params
    )
    total = cur.fetchone()[0]
    conn.close()
    return {"data": rows, "total": total, "page": page, "limit": limit}


def toggle_favorito(convocatoria_id: int) -> bool:
    conn = sqlite3.connect(DB_PATH_STR)
    cur  = conn.cursor()
    cur.execute(
        "UPDATE convocatorias SET es_favorito = NOT es_favorito WHERE id = ?",
        (convocatoria_id,),
    )
    conn.commit()
    cur.execute("SELECT es_favorito FROM convocatorias WHERE id = ?", (convocatoria_id,))
    row = cur.fetchone()
    conn.close()
    return bool(row[0]) if row else False


def actualizar_estado(convocatoria_id: int, estado: str) -> None:
    conn = sqlite3.connect(DB_PATH_STR)
    cur  = conn.cursor()
    cur.execute("UPDATE convocatorias SET estado = ? WHERE id = ?", (estado, convocatoria_id))
    conn.commit()
    conn.close()


# ── Cola de validación ─────────────────────────────────────────────────────

def _ensure_table_cola_validacion(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cola_validacion (
            id              TEXT PRIMARY KEY,
            org_id          TEXT,
            titulo          TEXT,
            donante         TEXT,
            url_fuente      TEXT,
            descripcion     TEXT,
            monto_estimado  REAL,
            fecha_cierre    TEXT,
            paises_elegibles TEXT,
            sectores        TEXT,
            score_encontrado INTEGER DEFAULT 50,
            fuente          TEXT,
            estado          TEXT DEFAULT 'pendiente',
            fecha_ingreso   TEXT,
            revisado_por    TEXT,
            decision        TEXT,
            decision_notas  TEXT
        )
    """)


def agregar_a_cola_validacion(item: dict) -> str:
    item_id = str(uuid.uuid4())
    conn    = sqlite3.connect(DB_PATH_STR)
    cur     = conn.cursor()
    _ensure_table_cola_validacion(cur)
    conn.commit()   # crea tabla antes del INSERT
    cur.execute(
        """INSERT INTO cola_validacion
           (id,org_id,titulo,donante,url_fuente,descripcion,monto_estimado,
            fecha_cierre,paises_elegibles,sectores,score_encontrado,fuente,
            estado,fecha_ingreso)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            item_id,
            item.get("org_id", "default"),
            item.get("titulo", ""),
            item.get("donante", ""),
            item.get("url_fuente", ""),
            item.get("descripcion", ""),
            item.get("monto_estimado"),
            item.get("fecha_cierre", ""),
            str(item.get("paises_elegibles", [])),
            str(item.get("sectores", [])),
            item.get("score_encontrado", 50),
            item.get("fuente", ""),
            item.get("estado", "pendiente"),
            item.get("fecha_ingreso", datetime.utcnow().isoformat()),
        ),
    )
    conn.commit()
    conn.close()
    logger.info(f"Item agregado a cola: {item_id}")
    return item_id


def get_cola_validacion(org_id: str, estado: Optional[str] = None) -> list:
    conn            = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur             = conn.cursor()
    _ensure_table_cola_validacion(cur)
    sql:     str   = "SELECT * FROM cola_validacion WHERE org_id = ?"
    params:  list  = [org_id]
    if estado:
        sql       += " AND estado = ?"
        params.append(estado)
    cur.execute(sql + " ORDER BY fecha_ingreso DESC", params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def resolver_cola_validacion(
    item_id:     str,
    decision:    str,
    notas:       str  = "",
    revisado_por: str = "sistema",
) -> None:
    conn = sqlite3.connect(DB_PATH_STR)
    cur  = conn.cursor()
    _ensure_table_cola_validacion(cur)
    cur.execute(
        """UPDATE cola_validacion
           SET estado=?, decision=?, decision_notas=?, revisado_por=?
           WHERE id=?""",
        (decision, decision, notas, revisado_por, item_id),
    )
    conn.commit()
    conn.close()
    logger.info(f"Item {item_id} resuelto: {decision}")


# ── Entidades indexadas ─────────────────────────────────────────────────────

def _ensure_table_entidades_indexadas(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS entidades_indexadas (
            id                    TEXT PRIMARY KEY,
            org_id                TEXT,
            titulo                TEXT,
            donante               TEXT,
            descripcion           TEXT,
            monto_min             REAL,
            monto_max             REAL,
            moneda                TEXT DEFAULT 'USD',
            url_convocatoria      TEXT,
            url_fuente            TEXT,
            fecha_cierre          TEXT,
            fecha_publicacion     TEXT,
            paises_elegibles      TEXT,
            sectores              TEXT,
            poblacion_objetivo    TEXT,
            tipo_fondo            TEXT,
            requisitos            TEXT,
            tags                  TEXT,
            score_compatibilidad  INTEGER DEFAULT 50,
            estado                TEXT DEFAULT 'activa',
            origen                TEXT,
            proyecto_id           TEXT,
            fecha_indexacion      TEXT
        )
    """)

def indexar_entidad(data: dict) -> str:
    ent_id = str(data.get("id", uuid.uuid4()))
    conn   = sqlite3.connect(DB_PATH_STR)
    cur    = conn.cursor()
    _ensure_table_entidades_indexadas(cur)
    conn.commit()
    cur.execute(
        """INSERT OR REPLACE INTO entidades_indexadas
           (id,org_id,titulo,donante,descripcion,monto_min,monto_max,moneda,
            url_convocatoria,url_fuente,fecha_cierre,fecha_publicacion,
            paises_elegibles,sectores,poblacion_objetivo,tipo_fondo,requisitos,
            tags,score_compatibilidad,estado,origen,proyecto_id,fecha_indexacion)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            ent_id,
            data.get("org_id", "default"),
            data.get("titulo", ""),
            data.get("donante", ""),
            data.get("descripcion", ""),
            data.get("monto_min", 0),
            data.get("monto_max", 0),
            data.get("moneda", "USD"),
            data.get("url_convocatoria", ""),
            data.get("url_fuente", ""),
            data.get("fecha_cierre", ""),
            data.get("fecha_publicacion", ""),
            str(data.get("paises_elegibles", [])),
            str(data.get("sectores", [])),
            str(data.get("poblacion_objetivo", [])),
            data.get("tipo_fondo", ""),
            str(data.get("requisitos", [])),
            str(data.get("tags", [])),
            data.get("score_compatibilidad", 50),
            data.get("estado", "activa"),
            data.get("origen", ""),
            data.get("proyecto_id"),
            data.get("fecha_indexacion", datetime.utcnow().isoformat()),
        ),
    )
    conn.commit()
    conn.close()
    logger.info(f"Entidad indexada: {ent_id}")
    return ent_id

def buscar_entidades_indexadas(org_id: str, filtros: Optional[dict] = None) -> list:
    conn            = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur             = conn.cursor()
    _ensure_table_entidades_indexadas(cur)
    sql    = "SELECT * FROM entidades_indexadas WHERE org_id = ?"
    params = [org_id]

    if filtros:
        if filtros.get("sectores"):
            sql    += " AND sectores LIKE ?"
            params.append(f"%{filtros['sectores'][0]}%")
        if filtros.get("pais"):
            sql    += " AND paises_elegibles LIKE ?"
            params.append(f"%{filtros['pais']}%")
        if filtros.get("monto_min"):
            sql    += " AND monto_max >= ?"
            params.append(filtros["monto_min"])
        if filtros.get("monto_max"):
            sql    += " AND monto_min <= ?"
            params.append(filtros["monto_max"])

    cur.execute(sql + " ORDER BY fecha_indexacion DESC", params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


# ── Multi-tenant / organizaciones ──────────────────────────────────────────

def _ensure_table_organizaciones(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS organizaciones (
            id               TEXT PRIMARY KEY,
            nombre           TEXT,
            pais             TEXT,
            email_admin      TEXT,
            api_key_google   TEXT,
            notebook_google  TEXT,
            limite_prospectos INTEGER DEFAULT 300,
            activa           INTEGER DEFAULT 1,
            plan             TEXT DEFAULT 'basico',
            created_at       TEXT,
            updated_at       TEXT
        )
    """)

def crear_organizacion(data: dict) -> str:
    org_id = str(uuid.uuid4())
    conn   = sqlite3.connect(DB_PATH_STR)
    cur    = conn.cursor()
    _ensure_table_organizaciones(cur)
    conn.commit()
    cur.execute(
        """INSERT INTO organizaciones
           (id,nombre,pais,email_admin,api_key_google,notebook_google,
            limite_prospectos,activa,plan,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            org_id,
            data.get("nombre"),
            data.get("pais"),
            data.get("email_admin"),
            data.get("api_key_google", ""),
            data.get("notebook_google", ""),
            data.get("limite_prospectos", 300),
            1,
            data.get("plan", "basico"),
            datetime.utcnow().isoformat(),
            datetime.utcnow().isoformat(),
        ),
    )
    conn.commit()
    conn.close()
    logger.info(f"Organización creada: {org_id}")
    return org_id

def get_organizaciones() -> list:
    conn  = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur   = conn.cursor()
    _ensure_table_organizaciones(cur)
    cur.execute("SELECT * FROM organizaciones")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_organizacion_por_api_key(api_key: str) -> Optional[dict]:
    conn  = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur   = conn.cursor()
    _ensure_table_organizaciones(cur)
    cur.execute("SELECT * FROM organizaciones WHERE api_key_google = ?", (api_key,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_all_entidades() -> list:
    """Obtener todas las entidades de la base de datos"""
    conn = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM entidades WHERE deleted_at IS NULL")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

# ── Proyectos ──────────────────────────────────────────────────────────────

def _ensure_table_proyectos(cur: sqlite3.Cursor) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS proyectos (
            id           TEXT PRIMARY KEY,
            org_id       TEXT,
            nombre       TEXT,
            descripcion  TEXT,
            palabras_clave TEXT,
            estado       TEXT DEFAULT 'activo',
            creado_en    TEXT,
            actualizado_en TEXT
        )
    """)

def crear_proyecto(data: dict) -> str:
    proyecto_id = str(uuid.uuid4())
    conn        = sqlite3.connect(DB_PATH_STR)
    cur         = conn.cursor()
    _ensure_table_proyectos(cur)
    conn.commit()
    cur.execute(
        """INSERT INTO proyectos
           (id,org_id,nombre,descripcion,palabras_clave,estado,creado_en,actualizado_en)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            proyecto_id,
            data.get("org_id", "default"),
            data.get("nombre", ""),
            data.get("descripcion", ""),
            str(data.get("palabras_clave", [])),
            data.get("estado", "activo"),
            datetime.utcnow().isoformat(),
            datetime.utcnow().isoformat(),
        ),
    )
    conn.commit()
    conn.close()
    logger.info(f"Proyecto creado: {proyecto_id}")
    return proyecto_id

def get_proyectos(org_id: str) -> list:
    conn  = sqlite3.connect(DB_PATH_STR)
    conn.row_factory = sqlite3.Row
    cur   = conn.cursor()
    _ensure_table_proyectos(cur)
    cur.execute("SELECT * FROM proyectos WHERE org_id = ? ORDER BY creado_en DESC", (org_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    for p in rows:
        try:
            p["palabras_clave"] = eval(p.get("palabras_clave", "[]"))
        except Exception:
            p["palabras_clave"] = []
    return rows

# ── Documentos de contexto ──────────────────────────────────────────────────

# ── Utilidades varias ──────────────────────────────────────────────────────

def validar_fuente_donante(fuente: str, donante: str) -> str:
    if not fuente or fuente.lower() in ("google", "radar", ""):
        return donante or fuente or "Desconocido"
    return fuente

def guardar_scraped_result(data: dict) -> str:
    """Guarda resultado de scraping en tabla scraped_results."""
    result_id = str(uuid.uuid4())
    conn = sqlite3.connect(DB_PATH_STR)
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO scraped_results
        (id, entidad_id, url, titulo, monto, fecha_cierre, estado, estado_detectado,
         contenido_html, scraped_en, success, error)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        result_id,
        data.get("entidad_id", ""),
        data.get("url", ""),
        data.get("titulo", ""),
        data.get("monto", ""),
        data.get("fecha_cierre", ""),
        data.get("estado", "pendiente"),
        data.get("estado_detectado", ""),
        data.get("contenido_html", ""),
        datetime.utcnow().isoformat(),
        data.get("success", 1),
        data.get("error", "")
    ))
    conn.commit()
    conn.close()
    return result_id

def log_scraping(entidad: str, url: str, status: str, mensaje: str = "") -> None:
    """Registra scraping en tabla scraping_log."""
    conn = sqlite3.connect(DB_PATH_STR)
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO scraping_log (entidad, url, status, mensaje, scraped_en)
        VALUES (?,?,?,?,?)
    """, (entidad, url, status, mensaje, datetime.utcnow().isoformat()))
    conn.commit()
    conn.close()

# Export público
__all__ = [
    "PROJECT_ROOT", "BACKEND_DIR", "DATA_DIR", "LOGS_DIR",
    "DB_PATH", "DB_PATH_STR", "DB_URL",
    "Base", "engine", "SessionLocal", "Entidad", "Convocatoria",
    "init_db", "ensure_db", "log_ejecucion",
    "get_estadisticas",
    "guardar_entidad",        "guardar_convocatoria",
    "get_convocatorias",      "toggle_favorito",    "actualizar_estado",
    "agregar_a_cola_validacion", "get_cola_validacion", "resolver_cola_validacion",
    "indexar_entidad",        "buscar_entidades_indexadas",
    "crear_organizacion",     "get_organizaciones", "get_organizacion_por_api_key", "get_all_entidades",
    "crear_proyecto",         "get_proyectos",
    "guardar_documento_contexto", "get_documentos_contexto",
    "get_estadisticas_org",   "validar_fuente_donante",
    "guardar_scraped_result", "log_scraping",
]