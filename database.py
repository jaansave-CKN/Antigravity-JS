import sqlite3
import json
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "radar.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS entidades (
            id TEXT PRIMARY KEY,
            nombre TEXT,
            sigla TEXT,
            tipo TEXT,
            pais TEXT,
            bandera TEXT,
            sectores TEXT,
            sitio_web TEXT,
            url_convocatorias TEXT,
            contacto TEXT,
            email_contacto TEXT,
            convocatorias_activas INTEGER DEFAULT 0,
            monto_total REAL DEFAULT 0,
            moneda TEXT DEFAULT 'USD',
            frecuencia TEXT DEFAULT 'variable',
            ultima_convocatoria TEXT,
            notas TEXT,
            creado_en TEXT,
            actualizado_en TEXT,
            last_scraped TEXT,
            scrape_status TEXT DEFAULT 'pendiente',
            scrape_result TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS scraped_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entidad_id TEXT,
            url TEXT,
            titulo TEXT,
            monto TEXT,
            fecha_cierre TEXT,
            estado TEXT,
            estado_detectado TEXT,
            contenido_html TEXT,
            scraped_en TEXT,
            success INTEGER DEFAULT 0,
            error TEXT,
            FOREIGN KEY (entidad_id) REFERENCES entidades(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS scraping_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entidad_id TEXT,
            url TEXT,
            status TEXT,
            duracion_ms INTEGER,
            resultado TEXT,
            registrado_en TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS convocatorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            externo_id TEXT UNIQUE,
            titulo TEXT NOT NULL,
            donante TEXT,
            fuente TEXT,
            descripcion TEXT,
            monto_min REAL,
            monto_max REAL,
            moneda TEXT DEFAULT 'USD',
            paises_elegibles TEXT,
            sectores TEXT,
            url_convocatoria TEXT,
            url_fuente TEXT,
            fecha_limite TEXT,
            fecha_publicacion TEXT,
            requisitos TEXT,
            resumen_tecnico TEXT,
            es_elegible BOOLEAN DEFAULT 0,
            score_probabilidad INTEGER DEFAULT 0,
            estado TEXT DEFAULT 'nueva',
            favorito BOOLEAN DEFAULT 0,
            categoria_gestion TEXT,
            compatibilidad_perfil REAL DEFAULT 0,
            scraped_en TEXT,
            created_at TEXT,
            actualizado_en TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS alertas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            convocatoria_id INTEGER,
            tipo TEXT,
            mensaje TEXT,
            prioridad TEXT DEFAULT 'media',
            leida BOOLEAN DEFAULT 0,
            creada_en TEXT,
            FOREIGN KEY (convocatoria_id) REFERENCES convocatorias(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS historial_ejecucion (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT,
            origen TEXT,
            mensaje TEXT,
            detalles TEXT,
            ejecutada_en TEXT
        )
    """)

    c.execute("CREATE INDEX IF NOT EXISTS idx_entidades_sigla ON entidades(sigla)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_scraped_entidad ON scraped_results(entidad_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_conv_estado ON convocatorias(estado)")

    conn.commit()
    conn.close()

def guardar_entidad(data: dict) -> str:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    ahora = datetime.now().isoformat()
    valores = (
        data.get("id"),
        data.get("nombre"),
        data.get("sigla"),
        data.get("tipo"),
        data.get("pais"),
        data.get("bandera"),
        json.dumps(data.get("sectores", [])),
        data.get("sitio_web"),
        data.get("url_convocatorias"),
        data.get("contacto"),
        data.get("email_contacto"),
        data.get("convocatorias_activas", 0),
        data.get("monto_total", 0),
        data.get("moneda", "USD"),
        data.get("frecuencia", "variable"),
        data.get("ultima_convocatoria"),
        data.get("notas"),
        data.get("creado_en", ahora),
        ahora,
        data.get("last_scraped"),
        data.get("scrape_status", "pendiente"),
        data.get("scrape_result")
    )
    c.execute("""
        INSERT OR REPLACE INTO entidades (
            id, nombre, sigla, tipo, pais, bandera, sectores, sitio_web,
            url_convocatorias, contacto, email_contacto, convocatorias_activas,
            monto_total, moneda, frecuencia, ultima_convocatoria, notas,
            creado_en, actualizado_en, last_scraped, scrape_status, scrape_result
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, valores)
    conn.commit()
    conn.close()
    return data.get("id")

def get_entidades() -> list:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM entidades ORDER BY nombre")
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def guardar_scraped_result(data: dict) -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    ahora = datetime.now().isoformat()
    c.execute("""
        INSERT INTO scraped_results (
            entidad_id, url, titulo, monto, fecha_cierre, estado,
            estado_detectado, contenido_html, scraped_en, success, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("entidad_id"), data.get("url"), data.get("titulo"),
        data.get("monto"), data.get("fecha_cierre"), data.get("estado"),
        data.get("estado_detectado"), data.get("contenido_html", "")[:5000],
        ahora, 1 if data.get("success") else 0, data.get("error", "")
    ))
    id_result = c.lastrowid
    c.execute("UPDATE entidades SET last_scraped = ?, scrape_status = ?, scrape_result = ? WHERE id = ?",
              (ahora, data.get("success", False) and "ok" or "error",
               data.get("error", "OK"), data.get("entidad_id")))
    conn.commit()
    conn.close()
    return id_result

def log_scraping(entidad_id: str, url: str, status: str, duracion_ms: int, resultado: str = ""):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO scraping_log (entidad_id, url, status, duracion_ms, resultado, registrado_en)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (entidad_id, url, status, duracion_ms, resultado, datetime.now().isoformat()))
    conn.commit()
    conn.close()

def validar_fuente_donante(fuente: str, donante: str) -> str:
    """Valida y corrige la fuente según el donante"""
    if not fuente or not donante:
        return fuente

    donante_lower = donante.lower()
    fuente_lower = fuente.lower()

    entidades_colombianas = ['minciencias', 'sena', 'innpulsa', 'colciencias', 'icetex', 'bancolombia', 'bogota', 'medellin', 'cali']
    entidades_internacionales = ['bid', 'banco interamericano', 'pnud', 'undp', 'usaid', 'giz', 'jica', 'caf', 'ue', 'unión europea', 'european union', 'aecid', 'unesco', 'cooperacion']

    es_colombiana = any(e in donante_lower for e in entidades_colombianas)
    es_internacional = any(e in donante_lower for e in entidades_internacionales)

    if es_colombiana:
        for e in entidades_colombianas:
            if e in donante_lower:
                return e.title().replace('minciencias', 'MinCiencias').replace('innpulsa', 'iNNpulsa').replace('sena', 'SENA')

    if es_internacional:
        for e in entidades_internacionales:
            if e in donante_lower:
                if 'bid' in e or 'banco interamericano' in e: return 'BID'
                if 'pnud' in e or 'undp' in e: return 'PNUD'
                if 'usaid' in e: return 'USAID'
                if 'giz' in e: return 'GIZ'
                if 'jica' in e: return 'JICA'
                if 'caf' in e: return 'CAF'
                if 'ue' in e or 'unión europea' in e or 'european union' in e: return 'Unión Europea'
                if 'aecid' in e: return 'AECID'
                if 'unesco' in e: return 'UNESCO'

    return fuente

def guardar_convocatoria(data: dict) -> int:
    # Validar y corregir fuente según donante
    fuente_validada = validar_fuente_donante(data.get('fuente', ''), data.get('donante', ''))
    data['fuente'] = fuente_validada

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    ahora = datetime.now().isoformat()
    c.execute("""
        INSERT OR REPLACE INTO convocatorias (
            externo_id, titulo, donante, fuente, descripcion,
            monto_min, monto_max, moneda, paises_elegibles, sectores,
            url_fuente, fecha_limite, fecha_publicacion,
            requisitos, es_elegible, score_probabilidad, estado,
            compatibilidad_perfil, creado_en, actualizado_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("externo_id"), data.get("titulo"), data.get("donante"),
        data.get("fuente"), data.get("descripcion"),
        data.get("monto_min"), data.get("monto_max"),
        data.get("moneda", "USD"),
        json.dumps(data.get("paises_elegibles", [])),
        json.dumps(data.get("sectores", [])),
        data.get("url_fuente"),
        data.get("fecha_limite"), data.get("fecha_publicacion"),
        json.dumps(data.get("requisitos", [])),
        1 if data.get("es_elegible") else 0,
        data.get("score_probabilidad", 0),
        data.get("estado", "nueva"),
        data.get("compatibilidad_perfil", 0),
        ahora, ahora
    ))
    conv_id = c.lastrowid
    conn.commit()
    conn.close()
    return conv_id

def get_convocatorias(filtros: dict = None) -> list:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    query = "SELECT * FROM convocatorias WHERE 1=1"
    params = []
    if filtros:
        if filtros.get("solo_favoritos"):
            query += " AND favorito = 1"
        if filtros.get("estado"):
            query += " AND estado = ?"
            params.append(filtros["estado"])
    query += " ORDER BY probabilidadExito DESC"
    c.execute(query, params)
    rows = c.fetchall()
    conn.close()
    result = []
    for row in rows:
        item = dict(row)
        item["paises_elegibles"] = json.loads(item.get("paisesElegibles", "[]") or "[]")
        item["sectores"] = json.loads(item.get("sectores", "[]") or "[]")
        item["requisitos"] = json.loads(item.get("requisitosClave", "[]") or "[]")
        result.append(item)
    return result

def get_estadisticas() -> dict:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM convocatorias WHERE es_elegible = 1")
    total_elegibles = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM entidades")
    total_entidades = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM entidades WHERE scrape_status = 'ok'")
    entidades_ok = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM entidades WHERE last_scraped IS NOT NULL")
    entidades_scraped = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM scraped_results WHERE success = 1")
    results_found = c.fetchone()[0]
    c.execute("SELECT MAX(scraped_en) FROM scraped_results")
    last_any = c.fetchone()[0]
    conn.close()
    return {
        "totalConvocatorias": total_elegibles,
        "totalEntidades": total_entidades,
        "entidadesScraped": entidades_scraped,
        "entidadesOk": entidades_ok,
        "resultadosFound": results_found,
        "ultimoScraping": last_any
    }

def log_ejecucion(tipo: str, origen: str, mensaje: str, detalles: dict = None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO historial_ejecucion (tipo, origen, mensaje, detalles, ejecutada_en)
        VALUES (?, ?, ?, ?, ?)
    """, (tipo, origen, mensaje, json.dumps(detalles or {}), datetime.now().isoformat()))
    conn.commit()
    conn.close()

def toggle_favorito(convocatoria_id: int) -> bool:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT favorito FROM convocatorias WHERE id = ?", (convocatoria_id,))
    row = c.fetchone()
    if row:
        nuevo = not row[0]
        c.execute("UPDATE convocatorias SET favorito = ? WHERE id = ?", (1 if nuevo else 0, convocatoria_id))
        conn.commit()
        conn.close()
        return nuevo
    conn.close()
    return False

def actualizar_estado(convocatoria_id: int, nuevo_estado: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE convocatorias SET estado = ?, actualizado_en = ? WHERE id = ?", 
              (nuevo_estado, datetime.now().isoformat(), convocatoria_id))
    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("DB radar.db inicializada con esquema extendido")