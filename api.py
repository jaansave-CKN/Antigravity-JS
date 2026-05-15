from flask import Flask, jsonify, request
from flask_cors import CORS
from database import (
    init_db, get_convocatorias, toggle_favorito,
    actualizar_estado, get_estadisticas, guardar_convocatoria,
    validar_fuente_donante
)
import scheduler
from security_advanced import security_manager
import os
import threading
import asyncio

try:
    from notifications import notification_manager, run_all_triggers, alert_trigger
    from notifications.escalation import escalation_manager
    NOTIFICATIONS_AVAILABLE = True
except ImportError as e:
    NOTIFICATIONS_AVAILABLE = False
    notification_manager = None
    alert_trigger = None
    escalation_manager = None
    print(f"[API] Notifications module not available: {e}")

app = Flask(__name__)
CORS(app)

@app.route("/api/convocatorias", methods=["GET"])
def api_get_convocatorias():
    filtros = {}
    if request.args.get("favoritos") == "true":
        filtros["solo_favoritos"] = True
    if request.args.get("estado"):
        filtros["estado"] = request.args.get("estado")

    convocatorias = get_convocatorias(filtros)
    for c in convocatorias:
        fuente = c.get('fuente', '')
        donante = c.get('donante', '')
        if fuente and (fuente.lower() in ['google', 'radar', ''] or (donante and fuente != donante)):
            c['fuente'] = validar_fuente_donante(fuente, donante)
    return jsonify(convocatorias)

@app.route("/api/convocatorias/<int:convocatoria_id>/favorito", methods=["POST"])
def api_toggle_favorito(convocatoria_id):
    nuevo_estado = toggle_favorito(convocatoria_id)
    return jsonify({"success": True, "favorito": nuevo_estado})

@app.route("/api/convocatorias/<int:convocatoria_id>/estado", methods=["PUT"])
def api_actualizar_estado(convocatoria_id):
    data = request.json
    nuevo_estado = data.get("estado", "abierta")
    actualizar_estado(convocatoria_id, nuevo_estado)
    return jsonify({"success": True, "estado": nuevo_estado})

@app.route("/api/convocatorias", methods=["POST"])
def api_crear_convocatoria():
    data = request.json
    convocatoria_id = guardar_convocatoria(data)
    return jsonify({"success": True, "id": convocatoria_id})

@app.route("/api/estadisticas", methods=["GET"])
def api_estadisticas():
    stats = get_estadisticas()
    return jsonify(stats)

@app.route("/api/scheduler/now", methods=["POST"])
def api_run_scheduler():
    try:
        scheduler.ejecutar_scraping_24h()
        return jsonify({"success": True, "message": "Scheduler ejecutado"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({
        "status": "running",
        "database": "connected",
        "security": security_manager.security_health_check()["status"]
    })

@app.route("/api/notifications/alerts", methods=["GET"])
def api_get_alerts():
    if not NOTIFICATIONS_AVAILABLE:
        return jsonify({"error": "Notifications module not available"}), 503
    priority = request.args.get("priority")
    limit = int(request.args.get("limit", 50))
    alerts = notification_manager.get_active_alerts(priority, limit)
    return jsonify(alerts)

@app.route("/api/notifications/stats", methods=["GET"])
def api_notifications_stats():
    if not NOTIFICATIONS_AVAILABLE:
        return jsonify({"error": "Notifications module not available"}), 503
    stats = notification_manager.get_alert_stats()
    return jsonify(stats)

@app.route("/api/notifications/<alert_id>/acknowledge", methods=["POST"])
def api_acknowledge_alert(alert_id):
    if not NOTIFICATIONS_AVAILABLE:
        return jsonify({"error": "Notifications module not available"}), 503
    data = request.json or {}
    acknowledged_by = data.get("acknowledged_by", "admin")
    success = notification_manager.acknowledge_alert(alert_id, acknowledged_by)
    return jsonify({"success": success})

@app.route("/api/notifications/triggers/run", methods=["POST"])
def api_run_triggers():
    if not NOTIFICATIONS_AVAILABLE:
        return jsonify({"error": "Notifications module not available"}), 503
    try:
        asyncio.run(alert_trigger.check_all_triggers())
        return jsonify({"success": True, "message": "Triggers executed"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/notifications/escalation/status", methods=["GET"])
def api_escalation_status():
    if not NOTIFICATIONS_AVAILABLE:
        return jsonify({"error": "Notifications module not available"}), 503
    status = escalation_manager.get_escalation_status()
    return jsonify(status)

@app.route("/api/notifications/escalate", methods=["POST"])
def api_manual_escalate():
    if not NOTIFICATIONS_AVAILABLE:
        return jsonify({"error": "Notifications module not available"}), 503
    data = request.json
    alert_id = data.get("alert_id")
    to_level = data.get("level", 2)
    reason = data.get("reason", "")
    success = escalation_manager.manual_escalate(alert_id, to_level, reason)
    return jsonify({"success": success})

@app.route("/api/notifications/test", methods=["POST"])
def api_test_notification():
    if not NOTIFICATIONS_AVAILABLE:
        return jsonify({"error": "Notifications module not available"}), 503
    try:
        from notifications.manager import AlertType, AlertPriority

        data = request.json or {}
        alert_type = data.get("type", "system_health")
        priority = data.get("priority", "high")
        title = data.get("title", "Test Alert")
        message = data.get("message", "Esta es una alerta de prueba del sistema RadarFondos")

        async def create_test():
            return await notification_manager.create_alert(
                AlertType(alert_type),
                AlertPriority(priority),
                title,
                message,
                {"test": True, "source": "api_test"}
            )

        alert = asyncio.run(create_test())
        return jsonify({"success": True, "alert_id": alert.id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

radar_activo = False
radar_thread = None

@app.route("/api/radar/status", methods=["GET"])
def radar_status():
    return jsonify({"activo": radar_activo})

@app.route("/api/radar/start", methods=["POST"])
def radar_start():
    global radar_activo, radar_thread
    if not radar_activo:
        try:
            import main
            radar_thread = threading.Thread(target=main.iniciar_radar, daemon=True)
            radar_thread.start()
            radar_activo = True
            return jsonify({"success": True, "message": "Radar iniciado"})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    return jsonify({"success": True, "message": "Radar ya estaba activo"})

@app.route("/api/radar/stop", methods=["POST"])
def radar_stop():
    global radar_activo
    radar_activo = False
    return jsonify({"success": True, "message": "Radar detenido"})

@app.route("/api/radar/trigger", methods=["POST"])
def radar_trigger():
    try:
        from main import job_radar_24_7
        job_radar_24_7()
        return jsonify({"success": True, "message": "Ciclo ejecutado"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

def start_server():
    init_db()
    port = int(os.getenv("PORT", 5000))
    print(f"[API] Servidor iniciado en puerto {port}")
    app.run(host="0.0.0.0", port=port, debug=False)

if __name__ == "__main__":
    start_server()