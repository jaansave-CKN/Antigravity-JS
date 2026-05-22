"""
MIDDLEWARE DE SEGURIDAD - RADAR 360
====================================
Middleware para sanitización de entradas y validación de datos.
"""

import re
import html
import json
import logging
from functools import wraps
from flask import request, jsonify
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

class InputSanitizer:
    """
    Clase para sanitizar y validar entradas de usuario.
    Protege contra inyección de código, XSS y manipulaciones.
    """
    
    # Patrones dangerous
    SQL_INJECTION_PATTERNS = [
        r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)",
        r"(--|#|\/\*|\*\/)",
        r"(\bOR\b.*=.*)",
        r"(\bAND\b.*=.*)",
        r"(';|\")",
        r"(union\s+select)",
        r"(0x[0-9a-fA-F]+)",
    ]
    
    XSS_PATTERNS = [
        r"<script",
        r"javascript:",
        r"onerror\s*=",
        r"onclick\s*=",
        r"onload\s*=",
        r"eval\(",
        r"expression\(",
    ]
    
    COMMAND_INJECTION_PATTERNS = [
        r"[;&|`$]",
        r"\$\(",
        r"&&",
        r"\|\|",
        r">\s*/dev/",
        r"<\s*/dev/",
    ]
    
    @classmethod
    def sanitize_string(cls, value: str, max_length: int = 5000) -> str:
        """Sanitiza un string eliminando caracteres dangerous."""
        if not value or not isinstance(value, str):
            return ""
        
        # 1. HTML entities
        sanitized = html.escape(value)
        
        # 2. Eliminar null bytes
        sanitized = sanitized.replace('\x00', '')
        
        # 3. Normalizar whitespace
        sanitized = re.sub(r'\s+', ' ', sanitized)
        
        # 4. Truncar si es muy largo
        if len(sanitized) > max_length:
            sanitized = sanitized[:max_length]
        
        return sanitized.strip()
    
    @classmethod
    def validate_sql_injection(cls, value: str) -> bool:
        """Detecta posibles inyecciones SQL."""
        if not value:
            return True
        
        value_lower = value.lower()
        for pattern in cls.SQL_INJECTION_PATTERNS:
            if re.search(pattern, value_lower, re.IGNORECASE):
                logger.warning(f"Posible SQL injection detectada: {pattern}")
                return False
        return True
    
    @classmethod
    def validate_xss(cls, value: str) -> bool:
        """Detecta posibles ataques XSS."""
        if not value:
            return True
        
        value_lower = value.lower()
        for pattern in cls.XSS_PATTERNS:
            if re.search(pattern, value_lower):
                logger.warning(f"Posible XSS detectada: {pattern}")
                return False
        return True
    
    @classmethod
    def validate_url(cls, value: str) -> bool:
        """Valida que una URL sea segura."""
        if not value:
            return True
        
        # Solo permitir http/https
        if not value.startswith(('http://', 'https://')):
            return False
        
        # Bloquear URLs con datos sensibles en query
        dangerous_params = ['token', 'key', 'secret', 'password', 'auth']
        try:
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(value)
            params = parse_qs(parsed.query)
            for param in dangerous_params:
                if param in params:
                    logger.warning(f"URL con parámetro sensitive: {param}")
                    return False
        except:
            return False
        
        return True
    
    @classmethod
    def validate_email(cls, value: str) -> bool:
        """Valida formato de email."""
        if not value:
            return True
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return bool(re.match(pattern, value))
    
    @classmethod
    def sanitize_dict(cls, data: Dict) -> Dict:
        """Sanitiza un diccionario completo."""
        if not isinstance(data, dict):
            return {}
        
        result = {}
        for key, value in data.items():
            if isinstance(value, str):
                result[key] = cls.sanitize_string(value)
            elif isinstance(value, dict):
                result[key] = cls.sanitize_dict(value)
            elif isinstance(value, list):
                result[key] = [cls.sanitize_string(v) if isinstance(v, str) else v for v in value]
            else:
                result[key] = value
        
        return result


def validate_request(schema: Dict[str, Any]) -> callable:
    """
    Decorador para validar requests contra un esquema.
    
    Args:
        schema: Diccionario con campos y sus reglas de validación
               Ej: {"email": "email", "nombre": "string", "edad": "int"}
    
    Returns:
        Decorador que valida el request
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            from flask import request
            
            data = request.get_json() or {}
            
            # Validar cada campo del esquema
            for field, field_type in schema.items():
                value = data.get(field)
                
                # Campo requerido
                if field_type.get("required", False) and not value:
                    return jsonify({
                        "success": False,
                        "error": f"Campo requerido: {field}"
                    }), 400
                
                if value is None:
                    continue
                
                # Validar tipo
                if field_type.get("type") == "email":
                    if not InputSanitizer.validate_email(value):
                        return jsonify({
                            "success": False,
                            "error": f"Email inválido: {field}"
                        }), 400
                
                elif field_type.get("type") == "url":
                    if not InputSanitizer.validate_url(value):
                        return jsonify({
                            "success": False,
                            "error": f"URL inválida: {field}"
                        }), 400
                
                elif field_type.get("type") == "string":
                    if not isinstance(value, str):
                        return jsonify({
                            "success": False,
                            "error": f"Debe ser string: {field}"
                        }), 400
                    
                    # Validar SQL injection
                    if not InputSanitizer.validate_sql_injection(value):
                        return jsonify({
                            "success": False,
                            "error": "Entrada inválida detectada"
                        }), 400
                    
                    # Validar XSS
                    if not InputSanitizer.validate_xss(value):
                        return jsonify({
                            "success": False,
                            "error": "Contenido no permitido"
                        }), 400
                    
                    # Validar longitud
                    min_len = field_type.get("min_length", 0)
                    max_len = field_type.get("max_length", 5000)
                    if len(value) < min_len or len(value) > max_len:
                        return jsonify({
                            "success": False,
                            "error": f"Longitud inválida para {field}"
                        }), 400
                
                elif field_type.get("type") == "int":
                    try:
                        int_val = int(value)
                        min_val = field_type.get("min")
                        max_val = field_type.get("max")
                        if min_val is not None and int_val < min_val:
                            return jsonify({
                                "success": False,
                                "error": f"Valor mínimo para {field}: {min_val}"
                            }), 400
                        if max_val is not None and int_val > max_val:
                            return jsonify({
                                "success": False,
                                "error": f"Valor máximo para {field}: {max_val}"
                            }), 400
                    except (ValueError, TypeError):
                        return jsonify({
                            "success": False,
                            "error": f"Debe ser entero: {field}"
                        }), 400
                
                elif field_type.get("type") == "list":
                    if not isinstance(value, list):
                        return jsonify({
                            "success": False,
                            "error": f"Debe ser lista: {field}"
                        }), 400
            
            # Sanitizar datos
            sanitized = InputSanitizer.sanitize_dict(data)
            request._sanitized_data = sanitized
            
            return f(*args, **kwargs)
        return wrapper
    return decorator


def sanitize_search_query(query: str) -> str:
    """
    Sanitiza específicamente queries de búsqueda.
    Permite caracteres especiales para búsquedas pero limpia dangerous inputs.
    """
    if not query:
        return ""
    
    # Eliminar caracteres de control
    query = ''.join(char for char in query if ord(char) >= 32 or char in '\n\t')
    
    # Limitar longitud
    if len(query) > 500:
        query = query[:500]
    
    # No permitir ciertos patterns
    dangerous = ['<script', 'javascript:', 'eval(', 'document.', 'window.']
    for pattern in dangerous:
        query = query.replace(pattern, '')
    
    return query.strip()


def sanitize_response(data: Any) -> Any:
    """
    Sanitiza la respuesta para evitar fugas de información.
    """
    if isinstance(data, dict):
        result = {}
        for key, value in data.items():
            # No exponer claves en respuestas
            if key.lower() in ['password', 'secret', 'token', 'api_key', 'key']:
                result[key] = "***"
            elif isinstance(value, str):
                result[key] = html.escape(value)
            elif isinstance(value, dict):
                result[key] = sanitize_response(value)
            else:
                result[key] = value
        return result
    return data