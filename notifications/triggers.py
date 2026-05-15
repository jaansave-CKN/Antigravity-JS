"""
ALERT TRIGGERS - Sistema de deteccion inteligente de alertas
Detecta automaticamente cuando generar notificaciones al 000
"""

import re
import sqlite3
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from dataclasses import dataclass
from enum import Enum

DB_PATH = 'radar.db'

class TriggerCondition(Enum):
    HIGH_VALUE = "high_value"
    EXPIRING_SOON = "expiring_soon"
    SCRAPING_FAILURE = "scraping_failure"
    PATTERN_MATCH = "pattern_match"
    USER_ACTION_REQUIRED = "user_action_required"
    SYSTEM_THRESHOLD = "system_threshold"

@dataclass
class TriggerRule:
    name: str
    condition: TriggerCondition
    priority: str
    threshold: float
    enabled: bool = True

TRIGGER_RULES = {
    'high_value_convocatoria': TriggerRule(
        name='Convocatoria de Alto Valor',
        condition=TriggerCondition.HIGH_VALUE,
        priority='high',
        threshold=500000,
        enabled=True
    ),
    'critical_sector': TriggerRule(
        name='Sector Estrategico',
        condition=TriggerCondition.PATTERN_MATCH,
        priority='high',
        threshold=0,
        enabled=True
    ),
    'vencimiento_7_dias': TriggerRule(
        name='Vencimiento en 7 dias',
        condition=TriggerCondition.EXPIRING_SOON,
        priority='medium',
        threshold=7,
        enabled=True
    ),
    'vencimiento_3_dias': TriggerRule(
        name='Vencimiento en 3 dias',
        condition=TriggerCondition.EXPIRING_SOON,
        priority='critical',
        threshold=3,
        enabled=True
    ),
    'scraping_error': TriggerRule(
        name='Error de Scraping Critico',
        condition=TriggerCondition.SCRAPING_FAILURE,
        priority='high',
        threshold=0,
        enabled=True
    ),
    'sin_revisar_48h': TriggerRule(
        name='Sin revisar por 48h',
        condition=TriggerCondition.USER_ACTION_REQUIRED,
        priority='medium',
        threshold=48,
        enabled=True
    ),
}

SECTORES_ESTRATEGICOS = [
    'primera_infancia', 'vivienda', 'salud', 'educacion',
    'agua', 'saneamiento', 'desarrollo_rural', 'paz',
    'genero', 'desastre_natural', 'infraestructura'
]

CRITICAL_PATTERNS = [
    r'\b500K?\b', r'\b1M\b', r'\bmillon\b', r'\bmillion\b',
    r'\bUSD\s*(\d{3,})\b', r'\beur\s*(\d{3,})\b',
    r'\bemergencia\b', r'\bhumanitarian\b', r'\burgente\b'
]

def get_alert_priority(priority_str: str):
    from .manager import AlertPriority
    return AlertPriority(priority_str)

class AlertTrigger:
    """Motor de triggers - Detecta condiciones y genera alertas automaticamente"""

    def __init__(self):
        self.db_path = DB_PATH

    async def check_all_triggers(self):
        """Ejecuta todos los triggers activos"""
        print("[TRIGGERS] Ejecutando verificacion completa...")

        await self._check_high_value_convocatorias()
        await self._check_expiring_convocatorias()
        await self._check_strategic_sectors()
        await self._check_unreviewed_convocatorias()
        await self._check_scraping_failures()
        await self._check_system_health()

        print("[TRIGGERS] Verificacion completada")

    async def _check_high_value_convocatorias(self):
        """Detecta convocatorias de alto valor"""
        rule = TRIGGER_RULES['high_value_convocatoria']
        if not rule.enabled:
            return

        from .manager import notification_manager, AlertType, AlertPriority

        conn = get_db_connection()
        c = conn.cursor()

        try:
            c.execute("""SELECT id, titulo, montoMax, donante, fuente, sectores, urlConvocatoria
                FROM convocatorias
                WHERE verificada = 1 AND aprobado = 1
                AND montoMax >= ?""",
                (rule.threshold,)
            )

            for row in c.fetchall():
                conv_id, titulo, monto, donante, fuente, sectores, url = row

                await notification_manager.create_alert(
                    AlertType.HIGH_IMPACT_CONVOCATORIA,
                    AlertPriority.HIGH,
                    f"CONVOCATORIA DE ALTO VALOR: ${monto:,.0f}",
                    f"Se detecto una oportunidad de {monto:,.0f} USD\n\n"
                    f"Titulo: {titulo}\n"
                    f"Donante: {donante}\n"
                    f"Fuente: {fuente}\n"
                    f"Sectores: {sectores}",
                    {
                        'convocatoria_id': conv_id,
                        'monto': monto,
                        'url': url,
                        'trigger': 'high_value'
                    }
                )
        except Exception as e:
            print(f"[TRIGGERS] Error en high_value: {e}")

        conn.close()

    async def _check_expiring_convocatorias(self):
        """Detecta convocatorias por vencer"""
        from .manager import notification_manager, AlertType, AlertPriority

        for rule_name, days in [('vencimiento_3_dias', 3), ('vencimiento_7_dias', 7)]:
            rule = TRIGGER_RULES[rule_name]
            if not rule.enabled:
                continue

            conn = get_db_connection()
            c = conn.cursor()

            target_date = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')

            try:
                c.execute("""SELECT id, titulo, fechaCierre, donante, urlConvocatoria
                    FROM convocatorias
                    WHERE verificada = 1 AND aprobado = 1
                    AND fechaCierre IS NOT NULL AND fechaCierre != ''
                    AND fechaCierre <= ?
                    AND revisada = 0""",
                    (target_date,)
                )

                priority = AlertPriority.CRITICAL if days == 3 else AlertPriority.MEDIUM

                for row in c.fetchall():
                    conv_id, titulo, fecha_cierre, donante, url = row

                    await notification_manager.create_alert(
                        AlertType.CONVOCATORIA_VENCIENDO,
                        priority,
                        f"Convocatoria vence en {days} dias: {titulo[:50]}",
                        f"Fecha de cierre: {fecha_cierre}\n"
                        f"Donante: {donante}\n"
                        f"Urgencia: {'CRITICA' if days == 3 else 'MEDIA'}",
                        {
                            'convocatoria_id': conv_id,
                            'fecha_cierre': fecha_cierre,
                            'dias_restantes': days,
                            'url': url
                        }
                    )
            except Exception as e:
                print(f"[TRIGGERS] Error en expiring: {e}")

            conn.close()

    async def _check_strategic_sectors(self):
        """Detecta sectores estrategicos"""
        rule = TRIGGER_RULES['critical_sector']
        if not rule.enabled:
            return

        from .manager import notification_manager, AlertType, AlertPriority

        conn = get_db_connection()
        c = conn.cursor()

        try:
            for sector in SECTORES_ESTRATEGICOS:
                c.execute("""SELECT id, titulo, donante, sectores, urlConvocatoria
                    FROM convocatorias
                    WHERE verificada = 0 AND revisada = 0
                    AND sectores LIKE ?""",
                    (f'%{sector}%',)
                )

                for row in c.fetchall():
                    conv_id, titulo, donante, sectores, url = row

                    await notification_manager.create_alert(
                        AlertType.HIGH_IMPACT_CONVOCATORIA,
                        AlertPriority.HIGH,
                        f"Sector Estrategico Detectado: {sector}",
                        f"Convocatoria en sector prioritario:\n\n"
                        f"Titulo: {titulo}\n"
                        f"Donante: {donante}\n"
                        f"Sectores: {sectores}",
                        {
                            'convocatoria_id': conv_id,
                            'sector': sector,
                            'url': url
                        }
                    )
        except Exception as e:
            print(f"[TRIGGERS] Error en strategic: {e}")

        conn.close()

    async def _check_unreviewed_convocatorias(self):
        """Detecta convocatorias sin revisar por mucho tiempo"""
        rule = TRIGGER_RULES['sin_revisar_48h']
        if not rule.enabled:
            return

        from .manager import notification_manager, AlertType, AlertPriority

        conn = get_db_connection()
        c = conn.cursor()

        try:
            threshold = int(rule.threshold)
            c.execute(f"""SELECT COUNT(*) FROM convocatorias
                WHERE verificada = 0 AND revisada = 0
                AND datetime(ultima_actualizacion) < datetime('now', '-{threshold} hours')""")

            pending_count = c.fetchone()[0]

            if pending_count > 0:
                await notification_manager.create_alert(
                    AlertType.USER_APPROVAL_REQUIRED,
                    AlertPriority.MEDIUM,
                    f"Convocatorias pendientes de revision ({pending_count})",
                    f"Hay {pending_count} convocatorias esperando revision del equipo.\n\n"
                    f"Ultima hace mas de {threshold} horas.\n"
                    f"Requiere accion humana para aprobar/rechazar.",
                    {
                        'count': pending_count,
                        'threshold_hours': threshold
                    }
                )
        except Exception as e:
            print(f"[TRIGGERS] Error en unreviewed: {e}")

        conn.close()

    async def _check_scraping_failures(self):
        """Detecta errores de scraping en fuentes criticas"""
        rule = TRIGGER_RULES['scraping_error']
        if not rule.enabled:
            return

        from .manager import notification_manager, AlertType, AlertPriority

        conn = get_db_connection()
        c = conn.cursor()

        critical_sources = ['USAID', 'GIZ', 'JICA', 'Banco Mundial', 'BID']

        try:
            for source in critical_sources:
                c.execute("""SELECT COUNT(*), MAX(fecha)
                    FROM radar_log
                    WHERE fuente LIKE ? AND estado = 'error' AND datetime(fecha) > datetime('now', '-6 hours')""",
                    (f'%{source}%',)
                )

                result = c.fetchone()
                count = result[0] if result else 0
                last_error = result[1] if result and result[1] else 'N/A'

                if count >= 2:
                    await notification_manager.create_alert(
                        AlertType.SCRAPING_ERROR,
                        AlertPriority.HIGH,
                        f"Errores de Scraping en {source}",
                        f"Se detectaron {count} errores en las ultimas 6 horas.\n"
                        f"Ultimo error: {last_error}\n\n"
                        f"Verificar:\n"
                        f"- Estado del sitio\n"
                        f"- Rate limiting\n"
                        f"- Cambios en la estructura",
                        {
                            'source': source,
                            'error_count': count,
                            'last_error_time': last_error
                        }
                    )
        except Exception as e:
            print(f"[TRIGGERS] Error en scraping_failures: {e}")

        conn.close()

    async def _check_system_health(self):
        """Verifica salud general del sistema"""
        from .manager import notification_manager, AlertType, AlertPriority

        conn = get_db_connection()
        c = conn.cursor()

        try:
            c.execute("""SELECT COUNT(*) FROM radar_cache
                WHERE datetime(fecha_cache) > datetime('now', '-24 hours')""")
            cache_24h = c.fetchone()[0] or 0

            c.execute("""SELECT COUNT(*), SUM(CASE WHEN estado = 'success' THEN 1 ELSE 0 END)
                FROM radar_log
                WHERE datetime(fecha) > datetime('now', '-24 hours')""")
            result = c.fetchone()
            total_runs = result[0] if result else 0
            successful_runs = result[1] if result and result[1] else 0

            success_rate = (successful_runs / total_runs * 100) if total_runs > 0 else 0

            if success_rate < 60 and total_runs > 0:
                await notification_manager.create_alert(
                    AlertType.SLA_COMPROMISED,
                    AlertPriority.HIGH,
                    "Bajo Rendimiento del Radar",
                    f"Tasa de exito en ultimas 24h: {success_rate:.1f}%\n"
                    f"Ejecuciones: {total_runs}\n"
                    f"Exitosas: {successful_runs}\n\n"
                    f"Revisar logs de scraping.",
                    {
                        'success_rate': success_rate,
                        'total_runs': total_runs,
                        'successful_runs': successful_runs
                    }
                )

            if cache_24h < 5:
                await notification_manager.create_alert(
                    AlertType.SLA_COMPROMISED,
                    AlertPriority.MEDIUM,
                    "Bajo Activity de Scraping",
                    f"Solo {cache_24h} URLs en cache (ultimas 24h).\n"
                    f"Posible problema de scheduling o fuentes caidas.",
                    {
                        'cache_count': cache_24h
                    }
                )
        except Exception as e:
            print(f"[TRIGGERS] Error en system_health: {e}")

        conn.close()

    def register_custom_trigger(self, name: str, condition: TriggerCondition,
                               priority: str, threshold: float,
                               callback: Callable):
        """Registra un trigger custom"""
        TRIGGER_RULES[name] = TriggerRule(name, condition, priority, threshold)
        setattr(self, f"_trigger_{name}", callback)

    async def run_custom_triggers(self):
        """Ejecuta triggers custom"""
        for name, rule in TRIGGER_RULES.items():
            if rule.enabled and hasattr(self, f"_trigger_{name}"):
                callback = getattr(self, f"_trigger_{name}")
                await callback()


alert_trigger = AlertTrigger()

async def run_all_triggers():
    """Funcion helper para ejecutar todos los triggers"""
    await alert_trigger.check_all_triggers()