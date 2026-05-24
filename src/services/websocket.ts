/**
 * src/services/websocket.ts
 * =========================
 * Cliente WebSocket para actualizaciones EN TIEMPO REAL de convocatorias.
 *
 * Uso:
 *   const ws = new RadarWebSocket({
 *       onNuevaConvocatoria: (data) => setConvs(prev => [data, ...prev]),
 *       onSnapshotInicial:   (stats)  => console.log('Conectado', stats),
 *       onError:             (err)   => console.error(err),
 *   });
 *   ws.connect();   // abre el socket
 *   ws.disconnect(); // lo cierra (ej: cleanup en useEffect)
 *
  * El endpoint del backend se configura con la variable VITE_API_URL del entorno.
  * Por defecto (local): ws://localhost:8000/ws/convocatorias
  */

export interface RadarWSConfig {
  /** URL del WebSocket (sin query params) */
  url?:            string;
  /** Intervalo de ping automático en ms (0 para desactivar) */
  pingIntervalMs?: number;
  /** Tiempo máximo de espera al reconectar antes de abortar intentos (ms) */
  maxReconnectDelayMs?: number;
  /** Callback al recibir una convocatoria nueva */
  onNuevaConvocatoria?:   (data: any) => void;
  /** Callback al recibir el snapshot de conexión inicial */
  onSnapshotInicial?:     (stats: any) => void;
  /** Callback cuando el socket se conecta exitosamente */
  onConnected?:           () => void;
  /** Callback cuando el socket se desconecta */
  onDisconnected?:        () => void;
  /** Callback ante errores */
  onError?:               (err: Event) => void;
}

const DEFAULT_API = (import.meta.env.VITE_API_URL || '').replace(/^http/, 'ws') || 'ws://localhost:8000';
const DEFAULT_URL = `${DEFAULT_API}/ws/convocatorias`;

/** Decide si usamos ws:// o wss:// según la ubicación de la página */
function buildUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  const isHttps = window.location.protocol === "https:";
  return isHttps ? `wss://${url}` : `ws://${url}`;
}

/** Reemplaza el host/puerto si el WebSocket está en origen distinto al frontend */
function resolveUrl(override?: string, appOrigin?: string): string {
  if (override) return buildUrl(override);
  // Usar DEFAULT_URL que ya incluye protocolo correcto desde VITE_API_URL
  return buildUrl(DEFAULT_URL);
}

/**
 * RadarWebSocket
 * ─────────────
 * Gestor de conexión con backoff exponencial, re-conexión automática,
 * ping/pong keep-alive y disposición limpia (limpia timers al disconnect).
 */
export class RadarWebSocket {
  private ws:             WebSocket | null  = null;
  private pingTimer:      ReturnType<typeof setInterval> | null = null;
  private reconTimer:     ReturnType<typeof setTimeout> | null = null;
  private _reconnectDelay = 2_000;      // ms (backoff base)
  private config:         Required<Omit<RadarWSConfig, "url">> & { url?: string };

  constructor(cfg: RadarWSConfig = {}) {
    this.config = {
      url:                 cfg.url                 ?? DEFAULT_URL,
      pingIntervalMs:      cfg.pingIntervalMs      ?? 25_000,
      maxReconnectDelayMs: cfg.maxReconnectDelayMs ?? 30_000,
      onNuevaConvocatoria: cfg.onNuevaConvocatoria ?? (() => {}),
      onSnapshotInicial:   cfg.onSnapshotInicial   ?? (() => {}),
      onConnected:         cfg.onConnected         ?? (() => {}),
      onDisconnected:      cfg.onDisconnected      ?? (() => {}),
      onError:             cfg.onError             ?? (() => {}),
    };
  }

  /** Abre la conexión (idempotente) */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const url = resolveUrl(this.config.url);
    this.ws   = new WebSocket(url);

    this.ws.onopen    = () => this._onOpen();
    this.ws.onmessage = (ev) => this._onMessage(ev);
    this.ws.onclose   = ()  => this._onClose();
    this.ws.onerror   = (ev) => this.config.onError(ev);
  }

  /** Cierra la conexión y detiene todo timer hijo */
  disconnect(): void {
    this._clearTimers();
    if (this.ws) {
      this.ws.close(1000, "client-disconnect");
      this.ws = null;
    }
  }

  /** Envía un JSON directamente por el socket */
  send(msg: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Estado actual de la conexión */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  // ── Handlers privados ──────────────────────────────────────────────────────

  private _onOpen(): void {
    this._reconnectDelay = 2_000;           // reset backoff
    this.config.onConnected();
    this._startPing();
  }

  private _onMessage(ev: MessageEvent): void {
    try {
      const msg = JSON.parse(ev.data);
      switch (msg.tipo) {
        case "nueva_convocatoria":
          this.config.onNuevaConvocatoria(msg.data);
          break;
        case "snapshot_inicial":
          this.config.onSnapshotInicial(msg.data);
          break;
        case "pong":
          // ping-pong confirmado — no acción
          break;
        case "error":
          console.warn("[RadarWS] error del servidor:", msg.mensaje);
          break;
        default:
          console.debug("[RadarWS] mensaje sin procesar:", msg);
      }
    } catch {
      console.warn("[RadarWS] mensaje no-JSON:", ev.data);
    }
  }

  private _onClose(): void {
    this._clearTimers();
    this.config.onDisconnected();

    if (this._reconnectDelay <= this.config.maxReconnectDelayMs) {
      this.reconTimer = setTimeout(() => {
        console.info("[RadarWS] reconectando…");
        this._reconnectDelay = Math.min(
          this._reconnectDelay * 2,
          this.config.maxReconnectDelayMs,
        );
        this.connect();
      }, this._reconnectDelay);
    }
  }

  private _startPing(): void {
    this._clearTimers();
    this.pingTimer = setInterval(() => {
      if (this.isConnected) this.send({ action: "ping" });
    }, this.config.pingIntervalMs);
  }

  private _clearTimers(): void {
    if (this.pingTimer)  { clearInterval(this.pingTimer);  this.pingTimer  = null; }
    if (this.reconTimer) { clearTimeout(this.reconTimer); this.reconTimer = null; }
  }
}

// ── Factory conveniente ─────────────────────────────────────────────────────
export function createRadarWS(cfg?: RadarWSConfig): RadarWebSocket {
  return new RadarWebSocket(cfg);
}
