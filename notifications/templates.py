"""
📧 TEMPLATES - Plantillas profesionales para notificaciones
"""

from datetime import datetime
from .manager import Alert, AlertPriority

def render_email_template(alert: Alert) -> str:
    """Renderiza template HTML para email"""

    priority_colors = {
        'critical': '#dc2626',
        'high': '#ea580c',
        'medium': '#ca8a04',
        'low': '#16a34a'
    }

    priority_icons = {
        'critical': '🔴',
        'high': '🟠',
        'medium': '🟡',
        'low': '🟢'
    }

    color = priority_colors.get(alert.priority.value, '#6b7280')
    icon = priority_icons.get(alert.priority.value, '📌')

    return f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Segoe UI', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
                                🛰️ RADARFONDOS
                            </h1>
                            <p style="color: #bfdbfe; margin: 10px 0 0 0; font-size: 14px;">
                                Sistema de Alertas Automáticas
                            </p>
                        </td>
                    </tr>
                    <!-- Priority Badge -->
                    <tr>
                        <td style="padding: 20px 30px 10px 30px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <span style="background-color: {color}; color: #ffffff; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                                            {icon} {alert.priority.value.upper()} PRIORITY
                                        </span>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Title -->
                    <tr>
                        <td style="padding: 20px 30px 10px 30px;">
                            <h2 style="color: #1f2937; margin: 0; font-size: 22px; font-weight: 600;">
                                {alert.title}
                            </h2>
                        </td>
                    </tr>
                    <!-- Message -->
                    <tr>
                        <td style="padding: 10px 30px 20px 30px;">
                            <p style="color: #4b5563; margin: 0; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">{alert.message}</p>
                        </td>
                    </tr>
                    <!-- Data Section -->
                    {"".join([
                        f'<tr><td style="padding: 10px 30px;"><div style="background-color: #f9fafb; border-left: 4px solid {color}; padding: 15px; border-radius: 4px;"><strong>{k}:</strong> {v}</div></td></tr>'
                        for k, v in alert.data.items() if v
                    ]) if alert.data else ''}
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #9ca3af; margin: 0; font-size: 12px;">
                                🎯 <strong>RadarFondos</strong> • Alerta generada automáticamente • {alert.timestamp.strftime('%Y-%m-%d %H:%M:%S')}
                            </p>
                            <p style="margin-top: 10px;">
                                <a href="#" style="color: #2563eb; text-decoration: none; font-size: 13px;">Ver en Dashboard</a>
                                •
                                <a href="#" style="color: #2563eb; text-decoration: none; font-size: 13px;">Marcar como resuelta</a>
                            </p>
                        </td>
                    </tr>
                </table>
                <!-- Footer Links -->
                <table width="600" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
                    <tr>
                        <td align="center">
                            <p style="color: #9ca3af; font-size: 11px;">
                                © 2026 RadarFondos • <a href="#" style="color: #6b7280;">Configuración</a> • <a href="#" style="color: #6b7280;">Ayuda</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    """

def render_telegram_message(alert: Alert) -> str:
    """Renderiza mensaje para Telegram"""

    priority_icons = {
        'critical': '🔴',
        'high': '🟠',
        'medium': '🟡',
        'low': '🟢'
    }

    icon = priority_icons.get(alert.priority.value, '📌')

    data_text = ""
    if alert.data:
        key_icons = {
            'convocatoria_id': '🆔',
            'monto': '💰',
            'url': '🔗',
            'donante': '🏛️',
            'sectores': '🎯',
            'fecha_cierre': '📅',
            'source': '🌐',
            'error_count': '⚠️'
        }

        for k, v in alert.data.items():
            icon_k = key_icons.get(k, '•')
            data_text += f"{icon_k} {k}: {v}\n"

    return f"""
{icon} <b>RADARFONDOS ALERT</b> {icon}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>{alert.title}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{alert.message}

{data_text}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕐 {alert.timestamp.strftime('%Y-%m-%d %H:%M')}
🆔 ID: <code>{alert.id}</code>
    """

def render_slack_message(alert: Alert) -> Dict:
    """Renderiza payload para Slack"""

    priority_colors = {
        'critical': '#dc2626',
        'high': '#ea580c',
        'medium': '#ca8a04',
        'low': '#16a34a'
    }

    color = priority_colors.get(alert.priority.value, '#6b7280')

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"🛰️ RadarFondos Alert: {alert.title}",
                "emoji": True
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": alert.message
            }
        }
    ]

    if alert.data:
        fields = []
        for k, v in list(alert.data.items())[:10]:
            fields.append({"type": "mrkdwn", "text": f"*{k}:*\n{v}")

        blocks.append({
            "type": "section",
            "fields": fields
        })

    blocks.extend([
        {"type": "divider"},
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"🕐 {alert.timestamp.strftime('%Y-%m-%d %H:%M:%S')} | 🆔 `{alert.id}` | *Priority: {alert.priority.value.upper()}*"
                }
            ]
        }
    ])

    return {
        "blocks": blocks,
        "attachments": [{
            "color": color,
            "blocks": blocks
        }]
    }

def render_push_notification(alert: Alert) -> Dict:
    """Renderiza payload para Firebase Push"""

    return {
        "notification": {
            "title": f"[{alert.priority.value.upper()}] RadarFondos",
            "body": alert.title
        },
        "data": {
            "alert_id": alert.id,
            "type": alert.type.value,
            "priority": alert.priority.value,
            "click_action": "OPEN_ALERT"
        },
        "priority": "high" if alert.priority.value in ['critical', 'high'] else "normal"
    }