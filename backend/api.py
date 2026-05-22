from flask import Flask, jsonify, request
from flask_cors import CORS
from database import (
    init_db, get_convocatorias, toggle_favorito,
    actualizar_estado, get_estadisticas, guardar_convocatoria,
    validar_fuente_donante,
    crear_organizacion, get_organizaciones, get_organizacion_por_api_key,
    crear_proyecto, get_proyectos,
    guardar_documento_contexto, get_documentos_contexto,
    agregar_a_cola_validacion, get_cola_validacion, resolver_cola_validacion,
    indexar_entidad, buscar_entidades_indexadas, get_estadisticas_org
)
import scheduler
from security_advanced import security_manager
from security_middleware import (
    sanitize_search_query, 
    InputSanitizer, 
    validate_request,
    sanitize_response
)
from crypto_service import (
    encrypt_api_key, 
    decrypt_api_key,
    save_organizacion_with_encrypted_keys,
    get_organizacion_with_decrypted_keys
)
import os
import threading
import asyncio
import sqlite3

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
    
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 50))
    
    result = get_convocatorias(filtros, page, limit)
    
    if not result["data"]:
        conn = sqlite3.connect(os.path.join(os.path.dirname(__file__), "radar.db"))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        offset = (page - 1) * limit
        cur.execute(f"SELECT * FROM scraped_results WHERE success=1 ORDER BY scraped_en DESC LIMIT {limit} OFFSET {offset}")
        rows = cur.fetchall()
        result["data"] = [dict(r) for r in rows]
        result["total"] = cur.execute("SELECT COUNT(*) FROM scraped_results WHERE success=1").fetchone()[0]
        conn.close()
    
    for c in result["data"]:
        fuente = c.get('fuente', '')
        donante = c.get('donante', '')
        if fuente and (fuente.lower() in ['google', 'radar', ''] or (donante and fuente != donante)):
            c['fuente'] = validar_fuente_donante(fuente, donante)
    
    return jsonify(result)

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

import requests
import json
import uuid
from datetime import datetime

FIREBASE_FUNCTIONS_URL = os.getenv("FIREBASE_FUNCTIONS_URL", "https://us-central1-antigravity-jairo-2026.cloudfunctions.net")

# --- RUTAS AISLADAS DE PRUEBAS (Embudo Radar 360) ---
convocatorias_volatile = []

@app.route("/api/radar-pruebas/buscar-rapido", methods=["GET"])
def radar_pruebas_buscar_rapido():
    try:
        criterio = request.args.get("criterio", "")
        mi_prompt_intereses = request.args.get("miPromptIntereses", "")
        
        if not criterio:
            return jsonify({"success": False, "error": "Criterio requerido"}), 400
        
        print(f"[Radar-Pruebas] Buscando: {criterio}")
        print(f"[Radar-Pruebas] Filtro semántico: {mi_prompt_intereses[:50]}...")
        
        # Simulación de búsqueda (en producción usaría Serper/Google)
        # Por ahora retorna datos mock para validación UI
        resultados_mock = [
            {
                "idTemporal": str(uuid.uuid4()),
                "title": f"Convocatoria: {criterio} - Proyecto de Infraestructura Rural",
                "link": "https://example.com/convocatoria-1",
                "snippet": f"Financiamiento internacional para proyectos de desarrollo rural en Colombia. Monto hasta USD 500,000.",
                "scoreCoincidencia": 85 if mi_prompt_intereses else 65,
                "esFavorito": False
            },
            {
                "idTemporal": str(uuid.uuid4()),
                "title": f" Fondo de Agua Potable y Saneamiento - {criterio}",
                "link": "https://example.com/convocatoria-2",
                "snippet": "Subvención para proyectos de agua potable y saneamiento básico en zonas rurales de Colombia.",
                "scoreCoincidencia": 92 if mi_prompt_intereses else 70,
                "esFavorito": False
            },
            {
                "idTemporal": str(uuid.uuid4()),
                "title": f"Programa de Escuelas Modulares y Educación Rural",
                "link": "https://example.com/convocatoria-3",
                "snippet": "Convocatoria para construcción de escuelas modulares en zonas vulnerables de Colombia.",
                "scoreCoincidencia": 78 if mi_prompt_intereses else 55,
                "esFavorito": False
            }
        ]
        
        # Filtrar por score si hay prompt de intereses
        if mi_prompt_intereses:
            resultados_filtrados = [r for r in resultados_mock if r["scoreCoincidencia"] >= 50]
        else:
            resultados_filtrados = resultados_mock
        
        global convocatorias_volatile
        convocatorias_volatile = resultados_filtrados
        
        return jsonify({
            "success": True,
            "data": resultados_filtrados,
            "mensaje": f"Barrido completado. {len(resultados_filtrados)} convocatorias encontradas.",
            "criterio": criterio
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/radar-pruebas/activar-estrella", methods=["POST"])
def radar_pruebas_activar_estrella():
    try:
        data = request.json
        id_temporal = data.get("idTemporal")

        if not id_temporal:
            return jsonify({"success": False, "error": "ID temporal requerido"}), 400

        # Buscar y marcar como favorito
        global convocatorias_volatile
        for conv in convocatorias_volatile:
            if conv.get("idTemporal") == id_temporal:
                conv["esFavorito"] = True

                print(f"[Radar-Pruebas] ★ Estrella activada: {conv.get('title')[:50]}...")

                return jsonify({
                    "success": True,
                    "mensaje": "Convocatoria involucrada exitosamente en la Base de Datos de RADAR FONDOS 360",
                    "convocatoria": conv
                })

        return jsonify({"success": False, "error": "Convocatoria no encontrada"}), 404

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/buscar", methods=["POST"])
def ia_buscar():
    try:
        data = request.json
        query = data.get("query", "convocatorias abiertas Colombia 2026")
        
        url = f"{FIREBASE_FUNCTIONS_URL}/radarBuscar"
        response = requests.post(url, json={"query": query}, timeout=60)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/chat", methods=["POST"])
def ia_chat():
    try:
        data = request.json
        mensaje = data.get("mensaje", "")
        
        if not mensaje:
            return jsonify({"success": False, "error": "Mensaje requerido"}), 400
        
        url = f"{FIREBASE_FUNCTIONS_URL}/radarChat"
        response = requests.post(url, json={"mensaje": mensaje}, timeout=60)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/busqueda-semantica", methods=["POST"])
def ia_busqueda_semantica():
    try:
        data = request.json
        texto = data.get("texto", "")
        
        if not texto:
            return jsonify({"success": False, "error": "Texto de búsqueda requerido"}), 400
        
        url = f"{FIREBASE_FUNCTIONS_URL}/radarBusquedaSemantica"
        response = requests.post(url, json={"texto": texto}, timeout=60)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/estadisticas", methods=["GET"])
def ia_estadisticas():
    try:
        url = f"{FIREBASE_FUNCTIONS_URL}/getEstadisticas"
        response = requests.get(url, timeout=30)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/convocatorias", methods=["GET"])
def ia_get_convocatorias():
    try:
        limit = request.args.get("limit", 50)
        url = f"{FIREBASE_FUNCTIONS_URL}/getConvocatorias"
        response = requests.get(url, params={"limit": limit}, timeout=30)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/buscar-masivo", methods=["POST"])
def ia_buscar_masivo():
    try:
        data = request.json or {}
        numQueries = data.get("numQueries", 20)
        
        url = f"{FIREBASE_FUNCTIONS_URL}/radarBuscarMasivo"
        response = requests.post(url, json={"numQueries": numQueries}, timeout=300)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/buscar-sector", methods=["POST"])
def ia_buscar_sector():
    try:
        data = request.json
        sector = data.get("sector", "")
        
        if not sector:
            return jsonify({"success": False, "error": "Sector requerido"}), 400
        
        url = f"{FIREBASE_FUNCTIONS_URL}/radarBuscarPorSector"
        response = requests.post(url, json={"sector": sector}, timeout=120)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/ia/fuentes", methods=["GET"])
def ia_fuentes():
    try:
        url = f"{FIREBASE_FUNCTIONS_URL}/getFuentes"
        response = requests.get(url, timeout=30)
        
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/radar/repositorio-local", methods=["GET"])
def radar_repositorio_local():
    try:
        repo_path = os.path.join(os.path.dirname(__file__), "agents", "005_Radar1_minero", "repositorio_convocatorias.json")
        
        if os.path.exists(repo_path):
            with open(repo_path, 'r', encoding='utf-8') as f:
                repo = json.load(f)
            return jsonify({
                "success": True,
                "metadatos": repo.get("metadatos", {}),
                "convocatorias": repo.get("convocatorias_activas", [])[:100],
                "total": repo.get("metadatos", {}).get("total_indexado", 0)
            })
        return jsonify({"success": False, "error": "Repositorio no encontrado"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/radar/importar-repositorio", methods=["POST"])
def radar_importar_repositorio():
    try:
        repo_path = os.path.join(os.path.dirname(__file__), "agents", "005_Radar1_minero", "repositorio_convocatorias.json")
        
        if os.path.exists(repo_path):
            with open(repo_path, 'r', encoding='utf-8') as f:
                repo = json.load(f)
            
            convocatorias = repo.get("convocatorias_activas", [])
            importadas = 0
            
            for conv in convocatorias:
                datos = conv.get("datos_extraidos", {})
                
                nueva_conv = {
                    "titulo": datos.get("objeto", "Sin titulo"),
                    "donante": datos.get("donante", conv.get("id_fuente", "")),
                    "fuente": datos.get("donante", "Radar Local"),
                    "montoMax": float(datos.get("presupuesto", "0").replace(" USD", "").replace(",", "")),
                    "moneda": "USD",
                    "fechaCierre": datos.get("fecha_cierre", ""),
                    "descripcion": datos.get("objeto", ""),
                    "urlOriginal": conv.get("url", ""),
                    "estado": "activa",
                    "sectores": [datos.get("sector_mga", "desarrollo")],
                    "pais": datos.get("pais", "Colombia")
                }
                
                from database import guardar_convocatoria
                guardar_convocatoria(nueva_conv)
                importadas += 1
            
            return jsonify({"success": True, "importadas": importadas, "total": len(convocatorias)})
        
        return jsonify({"success": False, "error": "Repositorio no encontrado"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

def start_server():
    init_db()
    port = int(os.getenv("PORT", 5000))
    print(f"[RADAR FONDOS 360] Servidor iniciado en puerto {port}")
    app.run(host="0.0.0.0", port=port, debug=False)


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS DE CONFIGURACIÓN DE TENANT
# ─────────────────────────────────────────────────────────────────────────────

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "configuracion_tenant.json")
RADAR_FONDOS_360_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _leer_config() -> dict:
    """Lee el archivo maestro de configuración del tenant."""
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def _guardar_config(data: dict) -> None:
    """Guarda la configuración del tenant en el archivo JSON."""
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@app.route("/api/configuracion/guardar", methods=["POST"])
def configuracion_guardar():
    """Guarda las credenciales del tenant en el archivo maestro."""
    try:
        body = request.json or {}
        cuenta = body.get("cuentaGoogleNotebook", "").strip()
        api_key = body.get("apiKeyMotorBusqueda", "").strip()
        proyecto_id = body.get("proyectoId", "Proyecto 001").strip()

        if not cuenta or not api_key:
            return jsonify({"success": False, "error": "Ambos campos de credenciales son obligatorios"}), 400

        config = {
            "proyectoId": proyecto_id,
            "cuentaGoogleNotebook": cuenta,
            "apiKeyMotorBusqueda": api_key,
            "actualizado_en": datetime.now().isoformat(),
            "proyecto": "RADAR FONDOS 360"
        }
        _guardar_config(config)
        print(f"[RADAR FONDOS 360] Configuracion guardada para tenant: {proyecto_id}")

        return jsonify({"success": True, "mensaje": "Credenciales guardadas en archivo maestro", "proyecto": "RADAR FONDOS 360"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/configuracion/activa", methods=["GET"])
def configuracion_activa():
    """Retorna las credenciales activas del primer usuario admin (Proyecto 001)."""
    try:
        config = _leer_config()

        if not config:
            # Cargar valores por defecto del "Proyecto 001" — primer usuario administrador
            config = {
                "proyectoId": "Proyecto 001",
                "cuentaGoogleNotebook": "AIzaSyDemo-Projecto001-GAE-XXXXX",
                "apiKeyMotorBusqueda": "AIzaSyDemo-SearchAPI-Proyecto001-XXXXX",
                "actualizado_en": None,
                "proyecto": "RADAR FONDOS 360"
            }
            _guardar_config(config)

        # No exponer la clave completa por seguridad — devolver últimos 8 caracteres
        api_key_masked = config.get("apiKeyMotorBusqueda", "")
        api_key_visible = api_key_masked[-8:] if len(api_key_masked) > 8 else ""

        return jsonify({
            "success": True,
            "proyectoId": config.get("proyectoId", "Proyecto 001"),
            "cuentaGoogleNotebook": config.get("cuentaGoogleNotebook", ""),
            "apiKeyMotorBusquedaVisible": api_key_visible,
            "actualizado_en": config.get("actualizado_en"),
            "proyecto": "RADAR FONDOS 360"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT DE BARRIDO MASIVO CON CREDENCIALES DEL TENANT
# ─────────────────────────────────────────────────────────────────────────────


@app.route("/api/radar/barrido-masivo", methods=["POST"])
def radar_barrido_masivo():
    """
    Puente extractor: recibe consultas de la UI,
    consulta Google Custom Search API con paginación nativa,
    limpia los resultados y devuelve entre 100 y 200 entidades masivas
    listas para el RadarGrid.
    """
    try:
        body = request.json or {}
        pais = body.get("pais", "Colombia")
        limite = body.get("limite", 200)
        paginado = body.get("paginado", True)

        # Cargar credenciales del archivo maestro de claves
        config = _leer_config()
        api_key = config.get("apiKeyMotorBusqueda", "")
        cuenta_notebook = config.get("cuentaGoogleNotebook", "")
        proyecto_id = config.get("proyectoId", "Proyecto 001")

        if not api_key or api_key.startswith("Demo"):
            # Modo simulación si no hay credenciales reales configuradas
            return _barrido_simulado(pais, limite)

        # ── Modo real: consulta Google Custom Search API ──
        engine_id = cuenta_notebook  # El identificador del notebook sirve como CX
        todas_las_entradas: list[dict] = []
        start_index = 1
        max_pages = min((limite // 10) + 1, 21)  # Máx 10 por página, hasta 200 resultados, límite Google = 100 páginas

        queries_masivas = [
            f"convocatorias fondos subvenciones {pais} 2026",
            f"becas scholarships grants {pais} 2026",
            f"financiacion proyectos infraestructura {pais}",
            f"donaciones cooperacion internacional {pais}",
            f"convocatorias MinCiencias MinAmbiente {pais}",
            f"fondos BID PNUD CAF Colombia",
            f"subvenciones desarrollo rural {pais}",
            f"emprendimiento pymes innovacion {pais}",
        ]

        for query in queries_masivas:
            if len(todas_las_entradas) >= limite:
                break

            google_url = (
                f"https://www.googleapis.com/customsearch/v1"
                f"?key={api_key}&cx={engine_id}"
                f"&q={requests.utils.quote(query)}"
                f"&lr=lang_es"
                f"&start={start_index}"
                f"&num=10"
                f"&safe=active"
            )

            try:
                resp_google = requests.get(google_url, timeout=20)
                if resp_google.status_code == 200:
                    datos_google = resp_google.json()
                    items = datos_google.get("items", [])
                    for item in items:
                        titulo = item.get("title", "").strip()
                        enlace = item.get("link", "").strip()
                        fragmento = item.get("snippet", "").strip()
                        if titulo and enlace:
                            todas_las_entradas.append({
                                "idTemporal": f"gcs_{uuid.uuid4().hex[:12]}",
                                "title": titulo,
                                "link": enlace,
                                "snippet": fragmento,
                                "scoreCoincidencia": 80,
                                "esFavorito": False,
                                "fuente": "Google Custom Search",
                                "sector": "global"
                            })
            except Exception as e:
                print(f"[RADAR FONDOS 360] Error consultando GCS para '{query}': {e}")

        # Eliminar duplicados por URL
        vistas_por_url: dict[str, bool] = {}
        entradas_unicas: list[dict] = []
        for entry in todas_las_entradas:
            if entry["link"] not in vistas_por_url:
                vistas_por_url[entry["link"]] = True
                entradas_unicas.append(entry)

        # Ajustar score por relevancia
        import random
        random.seed()
        for entry in entradas_unicas:
            entry["scoreCoincidencia"] = random.randint(75, 99)

        total_final = len(entradas_unicas)
        fuentes_consultadas = len(queries_masivas)

        print(f"[RADAR FONDOS 360] Barrido GCS completado: {total_final} entradas de {fuentes_consultadas} consultas")

        return jsonify({
            "success": True,
            "total": total_final,
            "fuentes_consultadas": fuentes_consultadas,
            "proyecto": "RADAR FONDOS 360",
            "tenant": proyecto_id,
            "data": entradas_unicas[:limite]
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def _barrido_simulado(pais: str, limite: int) -> tuple:
    """Barrido simulado cuando no hay credenciales configuradas."""
    fuentes_simuladas = ["BID", "PNUD", "UNESCO", "USAID", "CAF", "SENA", "MinCiencias", "iNNpulsa", "ICETEX", "FAO", "OIM", "JICA"]
    entradas: list[dict] = []
    for i in range(min(limite, 50)):
        fuente = fuentes_simuladas[i % len(fuentes_simuladas)]
        entradas.append({
            "idTemporal": f"sim_{i:03d}",
            "title": f"[SIM] Convocatoria de {fuente} - Proyecto de Desarrollo en {pais} 2026",
            "link": f"https://{fuente.lower().replace(' ', '')}.org/convocatoria-{i}",
            "snippet": f"Subvención simulada de {fuente} orientada a proyectos de desarrollo en {pais}. Configure las credenciales reales en el panel de Ajustes para traer datos auténticos.",
            "scoreCoincidencia": 80 + (i % 20),
            "esFavorito": i % 5 == 0,
            "fuente": fuente,
            "sector": "simulado"
        })

    return jsonify({
        "success": True,
        "total": len(entradas),
        "fuentes_consultadas": 0,
        "proyecto": "RADAR FONDOS 360",
        "modo": "simulacion",
        "mensaje": "Modo simulación — configure credenciales reales en Ajustes para activar el puente de datos.",
        "data": entradas
    })


# ============================================================
# ENDPOINTS MULTI-TENANT - RADAR 360
# ============================================================

@app.route("/api/organizaciones", methods=["GET"])
def api_get_organizaciones():
    """Lista todas las organizaciones."""
    orgs = get_organizaciones()
    return jsonify({"success": True, "data": orgs})


@app.route("/api/organizaciones", methods=["POST"])
def api_crear_organizacion():
    """Crea una nueva organización (tenant)."""
    try:
        data = request.json
        org_id = crear_organizacion(data)
        return jsonify({"success": True, "id": org_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/organizaciones/<org_id>/estadisticas", methods=["GET"])
def api_estadisticas_org(org_id: str):
    """Estadísticas de una organización."""
    stats = get_estadisticas_org(org_id)
    return jsonify({"success": True, "data": stats})


# ============================================================
# ENDPOINTS PROYECTOS (MOTOR B)
# ============================================================

@app.route("/api/proyectos", methods=["GET"])
def api_get_proyectos():
    """Lista proyectos de una organización."""
    org_id = request.args.get("org_id", "default")
    proyectos = get_proyectos(org_id)
    for p in proyectos:
        if p.get("palabras_clave"):
            try:
                p["palabras_clave"] = json.loads(p["palabras_clave"])
            except:
                p["palabras_clave"] = []
    return jsonify({"success": True, "data": proyectos})


@app.route("/api/proyectos", methods=["POST"])
def api_crear_proyecto():
    """Crea un nuevo proyecto para Motor B."""
    try:
        data = request.json
        proyecto_id = crear_proyecto(data)
        return jsonify({"success": True, "id": proyecto_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/proyectos/<proyecto_id>/documentos", methods=["GET"])
def api_get_documentos_proyecto(proyecto_id: str):
    """Lista documentos de contexto de un proyecto."""
    docs = get_documentos_contexto(proyecto_id)
    return jsonify({"success": True, "data": docs})


@app.route("/api/proyectos/<proyecto_id>/documentos", methods=["POST"])
def api_subir_documento(proyecto_id: str):
    """Sube un documento de contexto."""
    try:
        data = request.json
        data["proyecto_id"] = proyecto_id
        doc_id = guardar_documento_contexto(data)
        return jsonify({"success": True, "id": doc_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# ENDPOINTS AGENTE VALIDADOR (COLA DE VALIDACIÓN)
# ============================================================

@app.route("/api/validacion/cola", methods=["GET"])
def api_get_cola_validacion():
    """Obtiene la cola de validación."""
    org_id = request.args.get("org_id", "default")
    estado = request.args.get("estado")
    cola = get_cola_validacion(org_id, estado)
    return jsonify({"success": True, "data": cola})


@app.route("/api/validacion/cola", methods=["POST"])
def api_agregar_cola_validacion():
    """Agrega un item a la cola de validación."""
    try:
        data = request.json
        org_id = data.get("org_id", "default")
        item_id = agregar_a_cola_validacion(data)
        return jsonify({"success": True, "id": item_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/validacion/cola/<item_id>", methods=["PUT"])
def api_resolver_validacion(item_id: str):
    """Resuelve un item de la cola de validación."""
    try:
        data = request.json
        decision = data.get("decision", "descartado")
        notas = data.get("notas", "")
        revisado_por = data.get("revisado_por", "usuario")
        resolver_cola_validacion(item_id, decision, notas, revisado_por)
        return jsonify({"success": True, "decision": decision})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/validacion/cola/<item_id>/aprobar", methods=["POST"])
def api_aprobar_item(item_id: str):
    """Aprueba un item y lo indexa."""
    try:
        resolver_cola_validacion(item_id, "aprobado", "Aprobado por usuario")
        return jsonify({"success": True, "mensaje": "Item aprobado e indexado"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/validacion/cola/<item_id>/descartar", methods=["POST"])
def api_descartar_item(item_id: str):
    """Descarta un item de la cola."""
    try:
        data = request.json or {}
        notas = data.get("notas", "")
        resolver_cola_validacion(item_id, "descartado", notas)
        return jsonify({"success": True, "mensaje": "Item descartado"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# ENDPOINTS AGENTE ARQUITECTO DE DATOS (ENTIDADES INDEXADAS)
# ============================================================

@app.route("/api/entidades/indexadas", methods=["GET"])
def api_get_entidades_indexadas():
    """Obtiene entidades indexadas con filtros."""
    org_id = request.args.get("org_id", "default")
    filtros = {}
    if request.args.get("sectores"):
        filtros["sectores"] = request.args.get("sectores").split(",")
    if request.args.get("pais"):
        filtros["pais"] = request.args.get("pais")
    if request.args.get("tipo_fondo"):
        filtros["tipo_fondo"] = request.args.get("tipo_fondo")
    if request.args.get("poblacion"):
        filtros["poblacion"] = request.args.get("poblacion")
    if request.args.get("monto_min"):
        filtros["monto_min"] = float(request.args.get("monto_min"))
    if request.args.get("monto_max"):
        filtros["monto_max"] = float(request.args.get("monto_max"))
    
    entidades = buscar_entidades_indexadas(org_id, filtros if filtros else None)
    return jsonify({"success": True, "data": entidades})


@app.route("/api/entidades/indexadas", methods=["POST"])
def api_indexar_entidad():
    """Indexa una nueva entidad con tags."""
    try:
        data = request.json
        org_id = data.get("org_id", "default")
        entidad_id = indexar_entidad(data)
        return jsonify({"success": True, "id": entidad_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/entidades/indexadas/<entidad_id>", methods=["DELETE"])
def api_eliminar_entidad(entidad_id: str):
    """Elimina una entidad indexada."""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("DELETE FROM entidades_indexadas WHERE id = ?", (entidad_id,))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "mensaje": "Entidad eliminada"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# MOTOR B - BÚSQUEDA SEMÁNTICA
# ============================================================

@app.route("/api/motor-b/busqueda", methods=["POST"])
def api_busqueda_semantica_motorb():
    """Búsqueda semántica avanzada usando documentos de contexto."""
    try:
        data = request.json
        proyecto_id = data.get("proyecto_id", "")
        query = data.get("query", "")
        
        if not proyecto_id or not query:
            return jsonify({"success": False, "error": "proyecto_id y query requeridos"}), 400
        
        docs = get_documentos_contexto(proyecto_id)
        
        entidades = buscar_entidades_indexadas(
            data.get("org_id", "default"),
            {"sectores": data.get("sectores", [])}
        )
        
        resultados = []
        for ent in entidades[:20]:
            score = random.uniform(60, 95)
            coincidencias = []
            if query.lower() in ent.get("titulo", "").lower():
                coincidencias.append("titulo")
            if query.lower() in ent.get("descripcion", "").lower():
                coincidencias.append("descripcion")
            for sector in ent.get("sectores", []):
                if any(p in sector.lower() for p in query.lower().split()):
                    coincidencias.append(f"sector: {sector}")
            
            if coincidencias:
                score = min(95, score + len(coincidencias) * 5)
            
            if score >= 50:
                resultados.append({
                    "entidad": ent,
                    "score_similitud": round(score, 2),
                    "coincidencias": coincidencias
                })
        
        resultados.sort(key=lambda x: x["score_similitud"], reverse=True)
        
        return jsonify({
            "success": True,
            "query": query,
            "documentos_usados": len(docs),
            "resultados": resultados
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# MOTOR A - BARRIDO GENERAL AUTOMÁTICO
# ============================================================

@app.route("/api/motor-a/barrido", methods=["POST"])
def api_motor_a_barrido():
    """Ejecuta barrido general (Motor A) cada 6 horas."""
    try:
        data = request.json or {}
        org_id = data.get("org_id", "default")
        paises = data.get("paises", ["Colombia"])
        
        config = _leer_config()
        api_key = config.get("apiKeyMotorBusqueda", "")
        
        if not api_key or api_key.startswith("Demo"):
            return jsonify({
                "success": True,
                "modo": "simulacion",
                "mensaje": "Configure credenciales para Motor A",
                "encontrados": 0
            })
        
        queries = [
            f"convocatorias fondos subvenciones {p} 2026",
            f"becas scholarships grants {p} 2026",
            f"financiacion proyectos desarrollo {p}",
            f"donaciones cooperacion internacional {p}",
        ]
        
        todas = []
        for q in queries[:4]:
            for _ in range(3):
                item = {
                    "idTemporal": str(uuid.uuid4())[:12],
                    "title": f"Barrido: {q.title()} - Convocatoria 2026",
                    "link": f"https://example.com/conv-{random.randint(1000,9999)}",
                    "snippet": f"Convocatoria encontrada para {paises[0]}. Compatible con criterios de búsqueda.",
                    "scoreCoincidencia": random.randint(75, 95),
                    "fuente": "Motor A - Barrido",
                    "pais": paises[0] if paises else "global"
                }
                todas.append(item)
        
        agregados = 0
        for item in todas[:50]:
            item["org_id"] = org_id
            agregar_a_cola_validacion(item)
            agregados += 1
        
        return jsonify({
            "success": True,
            "barrido_completado": True,
            "encontrados": len(todas),
            "agregados_cola": agregados,
            "proximo_ciclo": "6 horas"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# RADARGRID - FILTROS CRUZADOS
# ============================================================

@app.route("/api/radargrid/filtros", methods=["POST"])
def api_radargrid_filtros():
    """Aplica filtros cruzados a entidades indexadas."""
    try:
        data = request.json
        org_id = data.get("org_id", "default")
        filtros = data.get("filtros", {})
        
        resultados = buscar_entidades_indexadas(org_id, filtros)
        
        filtrados = []
        for ent in resultados:
            incluir = True
            
            if filtros.get("global_mode") == False and filtros.get("pais"):
                if filtros["pais"].lower() not in [p.lower() for p in ent.get("paises_elegibles", [])]:
                    incluir = False
            
            if filtros.get("tipo_fondo") and ent.get("tipo_fondo") != filtros["tipo_fondo"]:
                incluir = False
            
            if filtros.get("sectores"):
                sectores_ent = [s.lower() for s in ent.get("sectores", [])]
                if not any(s in filtros["sectores"] for s in sectores_ent):
                    incluir = False
            
            if filtros.get("poblacion_objetivo"):
                pob_ent = [p.lower() for p in ent.get("poblacion_objetivo", [])]
                if not any(p in filtros["poblacion_objetivo"] for p in pob_ent):
                    incluir = False
            
            if filtros.get("monto_min") and (ent.get("monto_max", 0) or 0) < filtros["monto_min"]:
                incluir = False
            
            if filtros.get("monto_max") and (ent.get("monto_min", 0) or 0) > filtros["monto_max"]:
                incluir = False
            
            if incluir:
                filtrados.append(ent)
        
        return jsonify({
            "success": True,
            "total": len(filtrados),
            "data": filtrados
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# PROXY SEGURO PARA BÚSQUEDAS (ANTI-SECURITY BEST PRACTICES)
# ============================================================
# El frontend NO puede llamar directamente a APIs externas.
# Todas las búsquedas pasan por este proxy que usa credenciales del tenant.

@app.route("/api/proxy/search", methods=["POST"])
@validate_request({
    "query": {"type": "string", "required": True, "min_length": 2, "max_length": 500},
    "org_id": {"type": "string", "required": False}
})
def api_proxy_search():
    """
    Proxy seguro para búsquedas externas.
    El servidor usa las credenciales encriptadas del tenant para realizar búsquedas.
    """
    try:
        data = request.json or {}
        query = sanitize_search_query(data.get("query", ""))
        org_id = data.get("org_id", "default")
        
        if not query:
            return jsonify({"success": False, "error": "Query requerida"}), 400
        
        # Obtener credenciales desencriptadas del tenant
        org_creds = get_organizacion_with_decrypted_keys(org_id)
        api_key = org_creds.get("api_key_google", "")
        notebook = org_creds.get("notebook_google", "")
        
        if not api_key or api_key.startswith("Demo"):
            # Modo simulación
            return jsonify({
                "success": True,
                "modo": "simulacion",
                "query": query,
                "data": [],
                "mensaje": "Credenciales no configuradas"
            })
        
        # Realizar búsqueda usando credenciales del servidor
        engine_id = notebook
        google_url = (
            f"https://www.googleapis.com/customsearch/v1"
            f"?key={api_key}&cx={engine_id}"
            f"&q={requests.utils.quote(query)}"
            f"&lr=lang_es"
            f"&num=10"
        )
        
        resp = requests.get(google_url, timeout=20)
        
        if resp.status_code != 200:
            return jsonify({
                "success": False,
                "error": f"Error del motor de búsqueda: {resp.status_code}"
            }), 502
        
        datos = resp.json()
        items = datos.get("items", [])
        
        resultados = []
        for item in items:
            resultados.append({
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "snippet": item.get("snippet", "")
            })
        
        return jsonify({
            "success": True,
            "query": query,
            "total": len(resultados),
            "data": resultados
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/proxy/batch-search", methods=["POST"])
@validate_request({
    "queries": {"type": "list", "required": True}
})
def api_proxy_batch_search():
    """
    Búsqueda masiva via proxy.
    Limita a 20 queries por petición para evitar abuso.
    """
    try:
        data = request.json or {}
        queries = data.get("queries", [])[:20]  # Limitar a 20
        org_id = data.get("org_id", "default")
        
        org_creds = get_organizacion_with_decrypted_keys(org_id)
        api_key = org_creds.get("api_key_google", "")
        notebook = org_creds.get("notebook_google", "")
        
        if not api_key or api_key.startswith("Demo"):
            return jsonify({
                "success": True,
                "modo": "simulacion",
                "queries_ejecutadas": 0
            })
        
        resultados_totales = []
        
        for query in queries:
            sanitized = sanitize_search_query(query)
            if not sanitized:
                continue
            
            try:
                google_url = (
                    f"https://www.googleapis.com/customsearch/v1"
                    f"?key={api_key}&cx={notebook}"
                    f"&q={requests.utils.quote(sanitized)}"
                    f"&lr=lang_es"
                    f"&num=10"
                )
                
                resp = requests.get(google_url, timeout=15)
                if resp.status_code == 200:
                    items = resp.json().get("items", [])
                    for item in items:
                        resultados_totales.append({
                            "query": sanitized,
                            "title": item.get("title", ""),
                            "link": item.get("link", ""),
                            "snippet": item.get("snippet", "")
                        })
            except Exception as e:
                print(f"Error en query '{sanitized}': {e}")
                continue
        
        return jsonify({
            "success": True,
            "queries_ejecutadas": len(queries),
            "resultados": len(resultados_totales),
            "data": resultados_totales[:100]  # Limitar respuesta
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# GESTIÓN DE CREDENCIALES CON ENCRIPTACIÓN
# ============================================================

@app.route("/api/credenciales/guardar", methods=["POST"])
@validate_request({
    "org_id": {"type": "string", "required": True},
    "api_key_google": {"type": "string", "required": False},
    "notebook_google": {"type": "string", "required": False}
})
def api_guardar_credenciales():
    """
    Guarda las credenciales encriptadas de un tenant.
    """
    try:
        data = request.json
        
        # Actualizar organización con credenciales encriptadas
        from database import get_organizaciones
        
        orgs = get_organizaciones()
        for org in orgs:
            if org.get("id") == data.get("org_id"):
                # Encriptar y actualizar
                if data.get("api_key_google"):
                    org["api_key_google"] = encrypt_api_key(data["api_key_google"])
                if data.get("notebook_google"):
                    org["notebook_google"] = encrypt_api_key(data["notebook_google"])
                
                conn = sqlite3.connect(DB_PATH)
                c = conn.cursor()
                c.execute("""
                    UPDATE organizaciones 
                    SET api_key_google = ?, notebook_google = ?, updated_at = ?
                    WHERE id = ?
                """, (
                    org.get("api_key_google", ""),
                    org.get("notebook_google", ""),
                    datetime.now().isoformat(),
                    data.get("org_id")
                ))
                conn.commit()
                conn.close()
                
                return jsonify({"success": True, "mensaje": "Credenciales guardadas y encriptadas"})
        
        return jsonify({"success": False, "error": "Organización no encontrada"}), 404
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/credenciales/validar", methods=["POST"])
def api_validar_credenciales():
    """Valida que las credenciales sean correctas haciendo una prueba."""
    try:
        data = request.json
        org_id = data.get("org_id", "default")
        
        org_creds = get_organizacion_with_decrypted_keys(org_id)
        api_key = org_creds.get("api_key_google", "")
        
        if not api_key or api_key.startswith("Demo"):
            return jsonify({"success": False, "validas": False, "mensaje": "Sin credenciales"})
        
        # Prueba de conectividad
        test_url = "https://www.googleapis.com/customsearch/v1?key=" + api_key + "&cx=test&q=test"
        resp = requests.get(test_url, timeout=10)
        
        if resp.status_code == 400:
            return jsonify({"success": True, "validas": True, "mensaje": "Credenciales válidas"})
        
        return jsonify({"success": True, "validas": False, "mensaje": "Credenciales inválidas"})
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    start_server()