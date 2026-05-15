import os
import re
import json
import hashlib
import time
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

class AdvancedSecurityManager:
    def __init__(self):
        self.log_dir = Path("logs")
        self.log_dir.mkdir(exist_ok=True)
        self._setup_logging()
        self.request_history: Dict[str, list] = {}
        self.rate_limit = 100
        self.rate_window = 60
    
    def _setup_logging(self):
        self.logger = logging.getLogger("AntigravitySecurity")
        self.logger.setLevel(logging.INFO)
        
        handler = logging.FileHandler(self.log_dir / f"security_{datetime.now().strftime('%Y%m%d')}.log")
        handler.setLevel(logging.INFO)
        formatter = logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)
        
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)
        self.logger.addHandler(console_handler)
    
    def log_event(self, event_type: str, details: str, level: str = "INFO"):
        msg = f"[{event_type}] {details}"
        if level == "ERROR":
            self.logger.error(msg)
        elif level == "WARNING":
            self.logger.warning(msg)
        else:
            self.logger.info(msg)
    
    def check_rate_limit(self, client_id: str = "default") -> bool:
        now = time.time()
        
        if client_id not in self.request_history:
            self.request_history[client_id] = []
        
        self.request_history[client_id] = [
            ts for ts in self.request_history[client_id]
            if now - ts < self.rate_window
        ]
        
        if len(self.request_history[client_id]) >= self.rate_limit:
            self.log_event("RATE_LIMIT", f"Cliente {client_id} excedio limite", "WARNING")
            return False
        
        self.request_history[client_id].append(now)
        return True
    
    def validate_input(self, text: str, field_name: str = "input") -> Optional[str]:
        if not isinstance(text, str):
            self.log_event("VALIDATION", f"{field_name}: tipo invalido", "WARNING")
            return None
        
        text = text.strip()
        
        if len(text) > 50000:
            self.log_event("VALIDATION", f"{field_name}: longitud excedida", "WARNING")
            return None
        
        dangerous_patterns = [
            r'<script[^>]*>.*?</script>',
            r'javascript:',
            r'on\w+\s*=',
            r'eval\s*\(',
            r'exec\s*\(',
        ]
        
        for pattern in dangerous_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                self.log_event("SECURITY", f"Patron peligroso detectado en {field_name}", "WARNING")
                return None
        
        return text
    
    def hash_sensitive_data(self, data: str) -> str:
        return hashlib.sha256(data.encode()).hexdigest()[:16]
    
    def generate_session_token(self) -> str:
        return hashlib.sha256(f"{time.time()}{os.urandom(32)}".encode()).hexdigest()
    
    def check_suspicious_activity(self, activity: Dict[str, Any]) -> bool:
        suspicious_indicators = 0
        
        if activity.get("failed_auth", 0) > 3:
            suspicious_indicators += 2
        
        if activity.get("rapid_requests", 0) > 20:
            suspicious_indicators += 1
        
        if activity.get("unusual_pattern"):
            suspicious_indicators += 2
        
        if suspicious_indicators >= 3:
            self.log_event("SUSPICIOUS", f"Actividad sospechosa detectada: {activity}", "WARNING")
            return True
        
        return False
    
    def security_health_check(self) -> Dict[str, Any]:
        return {
            "status": "healthy",
            "rate_limiting": "active",
            "input_validation": "active",
            "audit_logging": "active",
            "timestamp": datetime.now().isoformat()
        }

security_manager = AdvancedSecurityManager()