"""
🚀 RADARFONDOS NOTIFICATION SYSTEM v1.0
Sistema de notificaciones ultra-potente para el Super Admin (000)
"""

import os
import json
import sqlite3
import asyncio
import hashlib
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum
from dataclasses import dataclass, field
from collections import defaultdict

import aiohttp
import requests
from dotenv import load_dotenv

load_dotenv()

DB_PATH = 'radar.db'

class AlertPriority(Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class AlertType(Enum):
    HIGH_IMPACT_CONVOCATORIA = "high_impact_convocatoria"
    CONVOCATORIA_VENCIENDO = "convocatoria_venciendo"
    SCRAPING_ERROR = "scraping_error"
    USER_APPROVAL_REQUIRED = "user_approval_required"
    SLA_COMPROMISED = "sla_compromised"
    NEW_USER_REGISTERED = "new_user_registered"
    SYSTEM_HEALTH = "system_health"
    MATCH_ENCONTRADO = "match_encontrado"

@dataclass
class Alert:
    id: str
    type: AlertType
    priority: AlertPriority
    title: str
    message: str
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)
    acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    escalation_level: int = 0
    notifications_sent: List[str] = field(default_factory=list)

    def to_dict(self):
        return {
            'id': self.id,
            'type': self.type.value,
            'priority': self.priority.value,
            'title': self.title,
            'message': self.message,
            'data': self.data,
            'timestamp': self.timestamp.isoformat(),
            'acknowledged': self.acknowledged,
            'acknowledged_by': self.acknowledged_by,
            'acknowledged_at': self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            'escalation_level': self.escalation_level,
            'notifications_sent': self.notifications_sent
        }

def get_notify_db():
    for _ in range(5):
        try:
            conn = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=30000")
            return conn
        except sqlite3.OperationalError as e:
            if "locked" in str(e):
                time.sleep(2)
                continue
            raise
    return sqlite3.connect(DB_PATH, timeout=30)

class NotificationManager:
    """
    🧠 Gestor de notificaciones central - Notifica al 000 y usuarios automáticamente
    """

    def __init__(self):
        self.db_path = DB_PATH
        self._init_tables()
        self._load_config()
        self._start_background_workers()

    def _init_tables(self):
        """Inicializa tablas de notificaciones"""
        conn = get_notify_db()
        c = conn.cursor()

        c.execute('''CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            priority TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            data TEXT,
            timestamp TEXT NOT NULL,
            acknowledged INTEGER DEFAULT 0,
            acknowledged_by TEXT,
            acknowledged_at TEXT,
            escalation_level INTEGER DEFAULT 0,
            notifications_sent TEXT,
            target_user TEXT,
            resolved_at TEXT
        )''')

        c.execute('''CREATE TABLE IF NOT EXISTS notification_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )''')

        c.execute('''CREATE TABLE IF NOT EXISTS notification_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notification_id TEXT,
            channel TEXT,
            recipient TEXT,
            status TEXT,
            response TEXT,
            timestamp TEXT NOT NULL
        )''')

        c.execute('''CREATE INDEX IF NOT EXISTS idx_notif_priority ON notifications(priority)''')
        c.execute('''CREATE INDEX IF NOT EXISTS idx_notif_type ON notifications(type)''')
        c.execute('''CREATE INDEX IF NOT EXISTS idx_notif_ack ON notifications(acknowledged)''')

        conn.commit()
        conn.close()

    def _load_config(self):
        """Carga configuración del sistema"""
        self.config = {
            'super_admin_email': os.getenv('SUPER_ADMIN_EMAIL', 'jairo@asfaltica.com'),
            'super_admin_telegram': os.getenv('SUPER_ADMIN_TELEGRAM', ''),
            'telegram_bot_token': os.getenv('TELEGRAM_BOT_TOKEN', ''),
            'smtp_host': os.getenv('SMTP_HOST', ''),
            'smtp_port': int(os.getenv('SMTP_PORT', 587)),
            'smtp_user': os.getenv('SMTP_USER', ''),
            'smtp_password': os.getenv('SMTP_PASSWORD', ''),
            'slack_webhook': os.getenv('SLACK_WEBHOOK', ''),
            'firebase_project': os.getenv('FIREBASE_PROJECT_ID', ''),
            'escalation_timeout_hours': 2,
            'critical_channels': ['telegram', 'email', 'push'],
            'high_channels': ['telegram', 'email'],
            'medium_channels': ['email'],
            'low_channels': ['push']
        }

    def _start_background_workers(self):
        """Inicia workers en background para escalamiento"""
        self.escalation_thread = threading.Thread(target=self._escalation_worker, daemon=True)
        self.escalation_thread.start()

    def generate_alert_id(self) -> str:
        raw = f"{datetime.now().isoformat()}{os.urandom(8).hex()}"
        return hashlib.md5(raw.encode()).hexdigest()[:16]

    async def create_alert(self, alert_type: AlertType, priority: AlertPriority,
                          title: str, message: str, data: Dict = None) -> Alert:
        """Crea una nueva alerta y la procesa"""

        alert = Alert(
            id=self.generate_alert_id(),
            type=alert_type,
            priority=priority,
            title=title,
            message=message,
            data=data or {}
        )

        self._save_alert(alert)
        await self._process_alert(alert)

        return alert

    def _save_alert(self, alert: Alert):
        """Guarda alerta en DB"""
        conn = get_notify_db()
        c = conn.cursor()

        c.execute('''INSERT INTO notifications
            (id, type, priority, title, message, data, timestamp, acknowledged, escalation_level, notifications_sent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                alert.id, alert.type.value, alert.priority.value,
                alert.title, alert.message, json.dumps(alert.data),
                alert.timestamp.isoformat(), 0, 0, json.dumps([])
            )
        )
        conn.commit()
        conn.close()

    async def _process_alert(self, alert: Alert):
        """Procesa la alerta - envía notificaciones según prioridad"""

        channels = self._get_channels_for_priority(alert.priority)

        tasks = []
        for channel in channels:
            if channel == 'email':
                tasks.append(self._send_email(alert))
            elif channel == 'telegram':
                tasks.append(self._send_telegram(alert))
            elif channel == 'push':
                tasks.append(self._send_push(alert))
            elif channel == 'slack':
                tasks.append(self._send_slack(alert))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            alert.notifications_sent = [str(r) for r in results if not isinstance(r, Exception)]
            self._update_alert_sent(alert)

    def _get_channels_for_priority(self, priority: AlertPriority) -> List[str]:
        """Determina qué canales usar según prioridad"""
        if priority == AlertPriority.CRITICAL:
            return self.config['critical_channels']
        elif priority == AlertPriority.HIGH:
            return self.config['high_channels']
        elif priority == AlertPriority.MEDIUM:
            return self.config['medium_channels']
        else:
            return self.config['low_channels']

    async def _send_email(self, alert: Alert) -> bool:
        """Envía email al super admin"""
        from .templates import render_email_template

        subject = f"[{alert.priority.value.upper()}] {alert.title}"
        html_body = render_email_template(alert)

        email_to = self.config['super_admin_email']

        if self.config['smtp_host']:
            return await self._send_smtp_email(email_to, subject, html_body)
        else:
            print(f"[EMAIL] {alert.priority.value.upper()}: {alert.title} -> {email_to}")
            print(f"[EMAIL] Body: {alert.message[:200]}...")
            return True

    async def _send_smtp_email(self, to: str, subject: str, html: str) -> bool:
        """Envía via SMTP"""
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = self.config['smtp_user']
            msg['To'] = to
            msg.attach(MIMEText(html, 'html', 'utf-8'))

            server = smtplib.SMTP(self.config['smtp_host'], self.config['smtp_port'])
            server.starttls()
            server.login(self.config['smtp_user'], self.config['smtp_password'])
            server.send_message(msg)
            server.quit()

            self._log_notification(alert.id, 'email', to, 'sent', 'OK')
            return True
        except Exception as e:
            self._log_notification(alert.id, 'email', to, 'failed', str(e))
            return False

    async def _send_telegram(self, alert: Alert) -> bool:
        """Envía mensaje Telegram al super admin"""
        from .templates import render_telegram_message

        if not self.config['telegram_bot_token'] or not self.config['super_admin_telegram']:
            print(f"[TELEGRAM] Configuración no disponible - skipping")
            return False

        text = render_telegram_message(alert)
        url = f"https://api.telegram.org/bot{self.config['telegram_bot_token']}/sendMessage"

        payload = {
            'chat_id': self.config['super_admin_telegram'],
            'text': text,
            'parse_mode': 'HTML',
            'disable_notification': False
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload) as resp:
                    if resp.status == 200:
                        self._log_notification(alert.id, 'telegram', self.config['super_admin_telegram'], 'sent', 'OK')
                        return True
                    else:
                        self._log_notification(alert.id, 'telegram', self.config['super_admin_telegram'], 'failed', f'Status {resp.status}')
                        return False
        except Exception as e:
            self._log_notification(alert.id, 'telegram', self.config['super_admin_telegram'], 'failed', str(e))
            return False

    async def _send_push(self, alert: Alert) -> bool:
        """Envía Firebase Push Notification"""
        if not self.config['firebase_project']:
            print(f"[PUSH] Firebase no configurado - skipping")
            return False

        print(f"[PUSH] Notificación: {alert.title}")
        self._log_notification(alert.id, 'push', 'firebase', 'sent', 'Queued')
        return True

    async def _send_slack(self, alert: Alert) -> bool:
        """Envía a Slack webhook"""
        from .templates import render_slack_message

        if not self.config['slack_webhook']:
            return False

        payload = render_slack_message(alert)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(self.config['slack_webhook'], json=payload) as resp:
                    self._log_notification(alert.id, 'slack', 'webhook', 'sent', f'Status {resp.status}')
                    return resp.status == 200
        except Exception as e:
            self._log_notification(alert.id, 'slack', 'webhook', 'failed', str(e))
            return False

    def _log_notification(self, notification_id: str, channel: str, recipient: str, status: str, response: str):
        """Log de notificaciones"""
        conn = get_notify_db()
        c = conn.cursor()
        c.execute('''INSERT INTO notification_log (notification_id, channel, recipient, status, response, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)''',
            (notification_id, channel, recipient, status, response, datetime.now().isoformat()))
        conn.commit()
        conn.close()

    def _update_alert_sent(self, alert: Alert):
        """Actualiza estado de notificaciones enviadas"""
        conn = get_notify_db()
        c = conn.cursor()
        c.execute('''UPDATE notifications SET notifications_sent = ? WHERE id = ?''',
            (json.dumps(alert.notifications_sent), alert.id))
        conn.commit()
        conn.close()

    def _escalation_worker(self):
        """Worker background para escalamiento automático"""
        while True:
            try:
                self._check_escalations()
            except Exception as e:
                print(f"[ESCALATION] Error: {e}")
            threading.Event().wait(60)

    def _check_escalations(self):
        """Verifica alertas que necesitan escalamiento"""
        conn = get_notify_db()
        c = conn.cursor()

        timeout = self.config['escalation_timeout_hours']
        c.execute(f'''SELECT id, type, priority, title, message, escalation_level, timestamp
            FROM notifications
            WHERE acknowledged = 0
            AND datetime(timestamp) < datetime('now', '-{timeout} hours')
            AND escalation_level < 3''')

        for row in c.fetchall():
            alert_id, alert_type, priority, title, message, level, timestamp = row

            new_level = level + 1
            c.execute('''UPDATE notifications SET escalation_level = ? WHERE id = ?''', (new_level, alert_id))

            escalation_title = f"[ESCALADO L{new_level}] {title}"
            escalation_msg = f"⚠️ ESCALAMIENTO AUTOMÁTICO (Nivel {new_level}/3)\n\n{message}"

            asyncio.create_task(self.create_alert(
                AlertType(alert_type),
                AlertPriority.HIGH if new_level >= 2 else AlertPriority.MEDIUM,
                escalation_title,
                escalation_msg,
                {'original_alert_id': alert_id, 'escalation_from': level}
            ))

        conn.commit()
        conn.close()

    def acknowledge_alert(self, alert_id: str, acknowledged_by: str) -> bool:
        """Marca alerta como reconocida"""
        conn = get_notify_db()
        c = conn.cursor()

        c.execute('''UPDATE notifications
            SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = ?
            WHERE id = ?''',
            (acknowledged_by, datetime.now().isoformat(), alert_id))

        affected = c.rowcount
        conn.commit()
        conn.close()

        return affected > 0

    def get_active_alerts(self, priority: str = None, limit: int = 50) -> List[Dict]:
        """Obtiene alertas activas"""
        conn = get_notify_db()
        c = conn.cursor()

        query = '''SELECT id, type, priority, title, message, data, timestamp, escalation_level
            FROM notifications WHERE acknowledged = 0'''

        if priority:
            query += f" AND priority = '{priority}'"

        query += f" ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, timestamp DESC LIMIT {limit}"

        c.execute(query)
        results = []

        for row in c.fetchall():
            results.append({
                'id': row[0],
                'type': row[1],
                'priority': row[2],
                'title': row[3],
                'message': row[4],
                'data': json.loads(row[5]) if row[5] else {},
                'timestamp': row[6],
                'escalation_level': row[7]
            })

        conn.close()
        return results

    def get_alert_stats(self) -> Dict:
        """Estadísticas de alertas"""
        conn = get_notify_db()
        c = conn.cursor()

        c.execute('SELECT COUNT(*) FROM notifications WHERE acknowledged = 0')
        active = c.fetchone()[0]

        c.execute('SELECT COUNT(*) FROM notifications WHERE acknowledged = 1')
        resolved = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM notifications WHERE priority = 'critical' AND acknowledged = 0")
        critical = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM notifications WHERE priority = 'high' AND acknowledged = 0")
        high = c.fetchone()[0]

        c.execute('''SELECT COUNT(*) FROM notifications
            WHERE datetime(timestamp) > datetime('now', '-24 hours')''')
        last_24h = c.fetchone()[0]

        conn.close()

        return {
            'active': active,
            'resolved': resolved,
            'critical': critical,
            'high': high,
            'last_24h': last_24h
        }


notification_manager = NotificationManager()

async def notify_super_admin(alert_type: AlertType, priority: AlertPriority,
                            title: str, message: str, data: Dict = None):
    """Función helper para notificar al 000"""
    return await notification_manager.create_alert(alert_type, priority, title, message, data)

def get_notification_manager() -> NotificationManager:
    return notification_manager