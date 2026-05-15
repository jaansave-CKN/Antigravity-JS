"""
🚀 ESCALATION MANAGER - Sistema de escalamiento automático
Escala alertas según urgencia y tiempo de respuesta
"""

import sqlite3
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum

DB_PATH = 'radar.db'

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn

class EscalationLevel(Enum):
    L1 = 1  # Equipo operativo
    L2 = 2  # Supervisor
    L3 = 3  # Director/Super Admin (000)

@dataclass
class EscalationRule:
    priority: str
    hours_to_escalate: int
    escalation_to: EscalationLevel
    notify_channels: List[str]
    auto_resolve_hours: int

ESCALATION_MATRIX = {
    'critical': EscalationRule(
        priority='critical',
        hours_to_escalate=1,
        escalation_to=EscalationLevel.L3,
        notify_channels=['telegram', 'email', 'push', 'call'],
        auto_resolve_hours=24
    ),
    'high': EscalationRule(
        priority='high',
        hours_to_escalate=4,
        escalation_to=EscalationLevel.L2,
        notify_channels=['telegram', 'email'],
        auto_resolve_hours=48
    ),
    'medium': EscalationRule(
        priority='medium',
        hours_to_escalate=12,
        escalation_to=EscalationLevel.L1,
        notify_channels=['email'],
        auto_resolve_hours=72
    ),
    'low': EscalationRule(
        priority='low',
        hours_to_escalate=24,
        escalation_to=EscalationLevel.L1,
        notify_channels=['push'],
        auto_resolve_hours=168
    )
}

ESCALATION_CONTACTS = {
    'L1': ['equipo@radarfondos.com'],
    'L2': ['supervisor@radarfondos.com'],
    'L3': ['jairo@asfaltica.com']
}

class EscalationManager:
    """
    🚀 Gestor de escalamiento automático
    - Monitorea alertas pendientes
    - Escala según matriz de escalamiento
    - Notifica a los contactos correctos
    - Auto-resuelve alertas antiguas
    """

    def __init__(self):
        self.db_path = DB_PATH
        self.running = False
        self._start_escalation_loop()

    def _start_escalation_loop(self):
        """Inicia el loop de escalamiento en background"""
        self.escalation_thread = threading.Thread(target=self._escalation_loop, daemon=True)
        self.escalation_thread.start()

    def _escalation_loop(self):
        """Loop principal de escalamiento"""
        while True:
            try:
                self._check_escalations()
                self._auto_resolve_old_alerts()
            except Exception as e:
                if "locked" in str(e).lower():
                    print(f"[ESCALATION LOOP] Database locked, waiting...")
                    time.sleep(10)
                else:
                    print(f"[ESCALATION LOOP] Error: {e}")

            threading.Event().wait(60)

    def _check_escalations(self):
        """Verifica alertas que necesitan escalamiento"""
        try:
            conn = get_db_connection()
            c = conn.cursor()

            c.execute('''SELECT id, priority, title, message, timestamp, escalation_level
                FROM notifications
                WHERE acknowledged = 0
                AND datetime(timestamp) > datetime('now', '-24 hours')''')

            alerts = c.fetchall()

            for alert_id, priority, title, message, timestamp, current_level in alerts:
                if priority not in ESCALATION_MATRIX:
                    continue

                rule = ESCALATION_MATRIX[priority]
                alert_time = datetime.fromisoformat(timestamp)
                hours_elapsed = (datetime.now() - alert_time).total_seconds() / 3600

                if hours_elapsed >= rule.hours_to_escalate and current_level < rule.escalation_to.value:
                    self._escalate_alert(
                        alert_id, priority, title, message,
                        current_level + 1, rule.escalation_to,
                        rule.notify_channels
                    )

                    c.execute('''UPDATE notifications SET escalation_level = ? WHERE id = ?''',
                        (current_level + 1, alert_id))

            conn.commit()
            conn.close()
        except Exception as e:
            if "locked" in str(e).lower():
                print("[ESCALATION] DB locked in check_escalations, skipping...")
            else:
                print(f"[ESCALATION] Error in check_escalations: {e}")

    def _escalate_alert(self, alert_id: str, priority: str, title: str, message: str,
                       new_level: int, escalation_to: EscalationLevel, channels: List[str]):
        """Ejecuta el escalamiento de una alerta"""

        level_name = f"L{new_level}"
        contacts = ESCALATION_CONTACTS.get(level_name, [])

        print(f"[ESCALATION] Escalando alerta {alert_id} a {level_name}")

        from .manager import notification_manager, AlertType, AlertPriority

        asyncio_loop = None
        try:
            import asyncio
            asyncio_loop = asyncio.new_event_loop()
            asyncio_loop.run_until_complete(
                notification_manager.create_alert(
                    AlertType.SLA_COMPROMISED,
                    AlertPriority.HIGH if new_level >= 2 else AlertPriority.MEDIUM,
                    f"[ESCALAMIENTO AUTO] {title}",
                    f"Se ha escalado automáticamente a {level_name}.\n\n"
                    f"Prioridad: {priority}\n"
                    f"Nivel de escalamiento: {new_level}/3\n"
                    f"Contactos: {', '.join(contacts)}\n\n"
                    f"Mensaje original: {message[:200]}...",
                    {'escalated_from': alert_id, 'escalation_level': new_level}
                )
            )
        except Exception as e:
            print(f"[ESCALATION] Error en notificación: {e}")
        finally:
            if asyncio_loop:
                asyncio_loop.close()

    def _auto_resolve_old_alerts(self):
        """Auto-resuelve alertas antiguas que ya pasaron su tiempo"""
        try:
            conn = get_db_connection()
            c = conn.cursor()

            for priority, rule in ESCALATION_MATRIX.items():
                auto_resolve = datetime.now() - timedelta(hours=rule.auto_resolve_hours)

                c.execute('''UPDATE notifications
                    SET acknowledged = 1, acknowledged_by = 'AUTO_RESOLVE', acknowledged_at = ?
                    WHERE priority = ? AND acknowledged = 0 AND datetime(timestamp) < ?''',
                    (datetime.now().isoformat(), priority, auto_resolve.isoformat())
                )

                if c.rowcount > 0:
                    print(f"[AUTO_RESOLVE] Resueltas {c.rowcount} alertas {priority}")

            conn.commit()
            conn.close()
        except Exception as e:
            if "locked" in str(e).lower():
                print("[ESCALATION] DB locked in auto_resolve, skipping...")
            else:
                print(f"[ESCALATION] Error in auto_resolve: {e}")

    def manual_escalate(self, alert_id: str, to_level: int, reason: str) -> bool:
        """Escala manualmente una alerta"""
        try:
            conn = get_db_connection()
            c = conn.cursor()

            c.execute('''UPDATE notifications SET escalation_level = ? WHERE id = ?''',
                (to_level, alert_id))

            affected = c.rowcount
            conn.commit()
            conn.close()

            return affected > 0
        except Exception as e:
            print(f"[ESCALATION] Error in manual_escalate: {e}")
            return False

    def get_escalation_status(self) -> Dict:
        """Obtiene estado actual del escalamiento"""
        conn = get_db_connection()
        c = conn.cursor()

        status = {}

        for level in ['L1', 'L2', 'L3']:
            c.execute('''SELECT COUNT(*) FROM notifications
                WHERE acknowledged = 0 AND escalation_level = ?''',
                (int(level[1]),)
            )
            status[level] = c.fetchone()[0]

        c.execute('''SELECT priority, COUNT(*) FROM notifications
            WHERE acknowledged = 0 GROUP BY priority''')
        by_priority = dict(c.fetchall())

        conn.close()

        return {
            'by_level': status,
            'by_priority': by_priority,
            'total_active': sum(status.values())
        }


escalation_manager = EscalationManager()

def get_escalation_manager() -> EscalationManager:
    return escalation_manager