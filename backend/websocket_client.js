// ============================================================================
// RADAR FONDOS 360 - FRONTEND WEBSOCKET CLIENT
// ============================================================================
// Conexión WebSocket para actualización en tiempo real sin recarga de página.
// Insertar en el script principal de la aplicación frontend.

// Configuración
const WS_URL = "ws://localhost:8000/ws/convocatorias";
const API_BASE = "http://localhost:8000/api";

class RadarWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
    }

    connect() {
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = (event) => {
            console.log("✅ WebSocket connected to Radar Fondos 360");
            this.reconnectAttempts = 0;
            this.updateConnectionStatus(true);
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (e) {
                console.error("WS Parse error:", e);
            }
        };

        this.ws.onclose = (event) => {
            console.log("⚠️ WebSocket disconnected");
            this.updateConnectionStatus(false);
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error("WS Error:", error);
        };
    }

    handleMessage(message) {
        console.log("📡 WS Message:", message.type);

        if (message.type === "new_convocatoria") {
            this.appendNewConvocatoria(message.data);
        } else if (message.type === "connected") {
            console.log("Server:", message.message);
        }
    }

    appendNewConvocatoria(data) {
        const tableBody = document.querySelector("#convocatorias-table tbody");
        if (!tableBody) return;

        const row = document.createElement("tr");
        row.className = "new-row fade-in";
        row.innerHTML = `
            <td>${data.id}</td>
            <td>${data.titulo}</td>
            <td>${data.sector}</td>
            <td>$${data.monto?.toLocaleString() || "0"}</td>
            <td>${data.fecha_cierre || "N/A"}</td>
            <td><span class="badge badge-new">NUEVA</span></td>
            <td><a href="${data.url}" target="_blank">Ver</a></td>
        `;

        tableBody.insertBefore(row, tableBody.firstChild);

        setTimeout(() => row.classList.remove("new-row"), 3000);

        this.showNotification(`🎯 Nueva oportunidad: ${data.titulo}`);
    }

    showNotification(text) {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Radar Fondos 360", { body: text });
        }
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById("ws-status");
        if (indicator) {
            indicator.textContent = connected ? "🟢 Conectado" : "🔴 Desconectado";
            indicator.className = connected ? "status-connected" : "status-disconnected";
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), this.reconnectDelay);
        }
    }

    sendPing() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "ping" }));
        }
    }
}

// Inicializar
const radarWS = new RadarWebSocket();
radarWS.connect();

// Ping cada 30 segundos para mantener conexión activa
setInterval(() => radarWS.sendPing(), 30000);

// Solicitar permiso de notificaciones
if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
}

// Exportar para uso global
window.radarWS = radarWS;