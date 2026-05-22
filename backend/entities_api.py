from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from database import init_db, get_entidades, get_convocatorias, get_estadisticas, guardar_entidad, guardar_scraped_result
from scraper_entidades import scrape_all_entidades, scrape_entidad
from realEntidades_scraper import ENTIDADES_RADAR
import threading
import time

app = Flask(__name__, static_folder="../dist", static_url_path="/")
CORS(app)

PORT = int(os.getenv("PORT", 5000))

@app.route("/api/entidades")
def api_entidades():
    entidades = get_entidades()
    if not entidades:
        entidades = []
    return jsonify(entidades)

@app.route("/api/entidades/<entidad_id>")
def api_entidad(entidad_id):
    entidades = get_entidades()
    ent = next((e for e in entidades if e["id"] == entidad_id), None)
    if not ent:
        return jsonify({"error": "No encontrada"}), 404
    return jsonify(ent)

@app.route("/api/entidades/<entidad_id>/scrape", methods=["POST"])
def api_scrape_entidad(entidad_id):
    entidades = get_entidades()
    ent = next((e for e in entidades if e["id"] == entidad_id), None)
    if not ent:
        return jsonify({"error": "No encontrada"}), 404
    result = scrape_entidad(ent)
    return jsonify(result)

@app.route("/api/entidades/scrape", methods=["POST"])
def api_scrape_all():
    result = scrape_all_entidades()
    return jsonify(result)

@app.route("/api/entidades/scrape-async", methods=["POST"])
def api_scrape_async():
    def run():
        scrape_all_entidades()
    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "started", "message": "Scraping iniciado en segundo plano"})

@app.route("/api/scraped-results")
def api_scraped_results():
    from database import DB_PATH
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM scraped_results ORDER BY scraped_en DESC LIMIT 100")
    rows = c.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/scraping-log")
def api_scraping_log():
    from database import DB_PATH
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM scraping_log ORDER BY registrado_en DESC LIMIT 50")
    rows = c.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/estadisticas")
def api_estadisticas():
    return jsonify(get_estadisticas())

@app.route("/api/convocatorias")
def api_convocatorias():
    filtros = {}
    if request.args.get("favoritos") == "1":
        filtros["solo_favoritos"] = True
    return jsonify(get_convocatorias(filtros))

@app.route("/api/sync", methods=["POST"])
def api_sync():
    guardar_entidades_static()
    return jsonify({"status": "ok", "entidades": len(ENTIDADES_RADAR)})

def guardar_entidades_static():
    for ent in ENTIDADES_RADAR:
        guardar_entidad(ent)

@app.route("/api/health")
def api_health():
    return jsonify({"status": "ok", "time": time.strftime("%Y-%m-%d %H:%M:%S")})

@app.route("/")
def serve_index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def serve_static(path):
    file_path = os.path.join(app.static_folder, path)
    if os.path.exists(file_path):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")

def start_api():
    init_db()
    guardar_entidades_static()
    print(f"[API] Servidor iniciado en http://localhost:{PORT}")
    print(f"[API] Endpoints disponibles:")
    print(f"  GET  /api/entidades              - Lista de entidades")
    print(f"  GET  /api/entidades/<id>        - Detalle entidad")
    print(f"  POST /api/entidades/<id>/scrape - Scrapear entidad especifica")
    print(f"  POST /api/entidades/scrape      - Scrapear TODAS las entidades (bloqueante)")
    print(f"  POST /api/entidades/scrape-async - Scrapear TODAS (async)")
    print(f"  GET  /api/scraped-results       - Resultados de scraping")
    print(f"  GET  /api/scraping-log          - Log de scraping")
    print(f"  GET  /api/estadisticas          - Estadisticas")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)

if __name__ == "__main__":
    start_api()