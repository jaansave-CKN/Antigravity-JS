import os
import re
from typing import Optional

class SecurityValidator:
    @staticmethod
    def validate_api_keys() -> bool:
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        groq_key = os.getenv("GROQ_API_KEY", "")
        
        if not gemini_key or gemini_key == "tu_clave_aqui":
            print("[ERROR] GEMINI_API_KEY no configurada o invalida")
            return False
            
        if not groq_key or groq_key == "tu_clave_aqui":
            print("[ERROR] GROQ_API_KEY no configurada o invalida")
            return False
        
        if not SecurityValidator._is_valid_gemini_key(gemini_key):
            print("[ERROR] Formato de GEMINI_API_KEY invalido")
            return False
            
        if not SecurityValidator._is_valid_groq_key(groq_key):
            print("[ERROR] Formato de GROQ_API_KEY invalido")
            return False
        
        print("[OK] API Keys validadas correctamente")
        return True
    
    @staticmethod
    def _is_valid_gemini_key(key: str) -> bool:
        return bool(re.match(r'^AIza[0-9A-Za-z_-]{35}$', key))
    
    @staticmethod
    def _is_valid_groq_key(key: str) -> bool:
        return bool(re.match(r'^gsk_[0-9a-zA-Z_-]{20,}$', key))
    
    @staticmethod
    def sanitize_input(text: str, max_length: int = 10000) -> str:
        if not isinstance(text, str):
            return ""
        return text[:max_length].strip()
    
    @staticmethod
    def log_security_event(event: str, details: str = ""):
        print(f"[SEGURIDAD] {event}: {details}")

def check_security():
    return SecurityValidator.validate_api_keys()

def sanitize(text: str) -> str:
    return SecurityValidator.sanitize_input(text)