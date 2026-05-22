"""
Servidor API Local - RADAR FONDOS
Etapa 1: Entorno de prueba para desarrollo frontend
Framework: Flask
Puerto de respaldo: 5001
Standards: logging estructurado, CORS estricto, tipado, código containerizable
"""

import logging
from datetime import datetime, timezone
from flask import Flask, jsonify, request
from flask_cors import CORS

# ── Logging estructurado ────────────────────────────────────────────────
logger = logging.getLogger("radar-fondos")
logger.setLevel(logging.INFO)

_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter(
    fmt="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
))
logger.addHandler(_handler)

# ── Aplicación Flask ────────────────────────────────────────────────────

app = Flask(__name__)

# CORS restringido al frontend local
CORS(app, origins=["http://localhost:5173"], methods=["GET"])


@app.after_request
def _add_security_headers(response):
    """Refuerza headers de seguridad en cada respuesta."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-store, no-cache, max-age=0"
    return response


@app.route("/api/convocatorias", methods=["GET"])
def get_convocatorias_prueba():
    """
    Endpoint de prueba con 3 convocatorias ficticias del sector Educación.
    Campos MGA: Título, Entidad Otorgante, Presupuesto, Fecha Cierre, Sector, Enlace
    """
    logger.info(
        "GET /api/convocatorias | cliente=%s | sector=Educacion | total_items=3",
        request.remote_addr
    )

    convocatorias_ficticias = [
        {
            "Titulo": "Fondo de Innovacion Educativa para Zonas Rurales",
            "Entidad Otorgante": "Ministerio de Educacion Nacional",
            "Presupuesto": "$250.000.000 COP",
            "Fecha Cierre": "2026-12-31",
            "Sector": "Educacion",
            "Enlace": "https://www.mineducacion.gov.co/convocatorias/innovacion-educativa-2026"
        },
        {
            "Titulo": "Becas Internacionales para Formacion de Docentes en Tecnologia",
            "Entidad Otorgante": "ICETEX",
            "Presupuesto": "$80.000.000 COP",
            "Fecha Cierre": "2026-11-30",
            "Sector": "Educacion",
            "Enlace": "https://www.icetex.gov.co/becas/docentes-tecnologia"
        },
        {
            "Titulo": "Convocatoria para Mejoramiento de Infraestructura Escolar Basica",
            "Entidad Otorgante": "SENA - Servicio Nacional de Aprendizaje",
            "Presupuesto": "$500.000.000 COP",
            "Fecha Cierre": "2026-10-15",
            "Sector": "Educacion",
            "Enlace": "https://www.sena.edu.co/convocatorias/infraestructura-escuela-2026"
        }
    ]

    return jsonify({
        "sector": "Educacion",
        "total": len(convocatorias_ficticias),
        "convocatorias": convocatorias_ficticias
    })


@app.route("/api/health", methods=["GET"])
def health():
    logger.info("GET /api/health | estado=ok")
    return jsonify({
        "status": "ok",
        "puerto": 5001,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })


@app.errorhandler(Exception)
def handle_exception(err):
    """Captura excepciones sin exponer traceback al cliente."""
    logger.error("excepcion_no_controlada | ruta=%s | error=%s",
                 request.path, str(err), exc_info=True)
    return jsonify({"error": "Error interno del servidor", "detail": str(err)}), 500


if __name__ == "__main__":
    PUERTO = 5001
    logger.info("=" * 55)
    logger.info("  RADAR FONDOS - Servidor API Local (Etapa 1)")
    logger.info("=" * 55)
    logger.info("  Puerto             : %s", PUERTO)
    logger.info("  Endpoint TEST      : GET http://localhost:%s/api/convocatorias", PUERTO)
    logger.info("  CORS permitido     : http://localhost:5173")
    logger.info("  CERRAR con         : CTRL+C")
    logger.info("=" * 55)
    app.run(host="0.0.0.0", port=PUERTO, debug=False)
