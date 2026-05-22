import os
import hashlib
import time
from typing import Optional, Dict
from datetime import datetime, timedelta

class AuthManager:
    def __init__(self):
        self.sessions: Dict[str, dict] = {}
        self.max_sessions = 100
        self.session_duration = 24
    
    def create_session(self, username: str) -> Optional[str]:
        if len(self.sessions) >= self.max_sessions:
            self._cleanup_expired_sessions()
            if len(self.sessions) >= self.max_sessions:
                return None
        
        token = hashlib.sha256(f"{username}{time.time()}{os.urandom(32)}".encode()).hexdigest()
        
        self.sessions[token] = {
            "username": username,
            "created_at": time.time(),
            "expires_at": time.time() + (self.session_duration * 3600),
            "last_activity": time.time()
        }
        
        return token
    
    def validate_session(self, token: str) -> bool:
        if token not in self.sessions:
            return False
        
        session = self.sessions[token]
        
        if time.time() > session["expires_at"]:
            del self.sessions[token]
            return False
        
        session["last_activity"] = time.time()
        return True
    
    def revoke_session(self, token: str):
        if token in self.sessions:
            del self.sessions[token]
    
    def _cleanup_expired_sessions(self):
        now = time.time()
        expired = [t for t, s in self.sessions.items() if now > s["expires_at"]]
        for t in expired:
            del self.sessions[t]
    
    def get_session_info(self, token: str) -> Optional[Dict]:
        return self.sessions.get(token)
    
    def cleanup_all(self):
        self.sessions.clear()

auth_manager = AuthManager()