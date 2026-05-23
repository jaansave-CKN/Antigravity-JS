"""
RadarFondos Authentication System
=================================
Sistema completo de autenticación con roles: Administrador e Inversor/Cliente
"""

import os
import hashlib
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from pathlib import Path
import jwt

JWT_SECRET = os.getenv("JWT_SECRET", "radarfondos_jwt_secret_key_change_in_production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

DB_PATH = Path(__file__).parent / "radar.db"


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return f"{salt}:{hashed.hex()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, hashed = stored_hash.split(':')
        check = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
        return secrets.compare_digest(check.hex(), hashed)
    except:
        return False


def init_auth_tables():
    conn = _get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            nombre TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            subscription_type TEXT DEFAULT 'subscriber',
            is_approved INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            last_login TEXT,
            is_active INTEGER DEFAULT 1,
            email_verificado INTEGER DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tokens_revocados (
            id TEXT PRIMARY KEY,
            token TEXT NOT NULL,
            usuario_id TEXT NOT NULL,
            revocado_en TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


class AuthService:
    def __init__(self):
        init_auth_tables()

    def register(self, email: str, password: str, nombre: str, role: str = "user") -> Dict[str, Any]:
        if len(password) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        
        if role not in ("admin", "user"):
            raise ValueError("Rol inválido. Debe ser 'admin' o 'user'")

        conn = _get_db()
        cur = conn.cursor()
        
        try:
            cur.execute("SELECT id FROM usuarios WHERE email = ?", (email,))
            if cur.fetchone():
                raise ValueError("El email ya está registrado")
            
            user_id = str(uuid.uuid4())
            password_hash = _hash_password(password)
            
            cur.execute("""
                INSERT INTO usuarios (id, email, password_hash, nombre, role, created_at, is_active)
                VALUES (?, ?, ?, ?, ?, ?, 1)
            """, (user_id, email, password_hash, nombre, role, datetime.utcnow().isoformat()))
            
            conn.commit()
            
            token = self._generate_token(user_id, email, role)
            
            return {
                "success": True,
                "user": {"id": user_id, "email": email, "nombre": nombre, "role": role},
                "token": token
            }
        finally:
            conn.close()

    def login(self, email: str, password: str) -> Dict[str, Any]:
        conn = _get_db()
        cur = conn.cursor()
        
        try:
            cur.execute("SELECT * FROM usuarios WHERE email = ?", (email,))
            row = cur.fetchone()
            
            if not row:
                raise ValueError("Credenciales inválidas")
            
            user = dict(row)
            
            if not user["is_active"]:
                raise ValueError("Usuario deshabilitado")
            
            if not _verify_password(password, user["password_hash"]):
                raise ValueError("Credenciales inválidas")
            
            cur.execute("UPDATE usuarios SET last_login = ? WHERE id = ?", 
                       (datetime.utcnow().isoformat(), user["id"]))
            conn.commit()
            
            token = self._generate_token(user["id"], user["email"], user["role"])
            
            return {
                "success": True,
                "user": {"id": user["id"], "email": user["email"], "nombre": user["nombre"], "role": user["role"]},
                "token": token
            }
        finally:
            conn.close()

    def _generate_token(self, user_id: str, email: str, role: str) -> str:
        payload = {
            "sub": user_id, "email": email, "role": role,
            "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
            "iat": datetime.utcnow()
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        try:
            return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except:
            return None

    def logout(self, token: str) -> bool:
        conn = _get_db()
        cur = conn.cursor()
        try:
            payload = self.verify_token(token)
            if not payload:
                return False
            cur.execute("INSERT INTO tokens_revocados (id, token, usuario_id, revocado_en) VALUES (?, ?, ?, ?)",
                       (str(uuid.uuid4()), token, payload["sub"], datetime.utcnow().isoformat()))
            conn.commit()
            return True
        finally:
            conn.close()

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        conn = _get_db()
        cur = conn.cursor()
        try:
            cur.execute("SELECT id, email, nombre, role, created_at, last_login, is_active, subscription_type, is_approved FROM usuarios WHERE id = ?", (user_id,))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def list_users(self, role_filter: Optional[str] = None) -> list:
        conn = _get_db()
        cur = conn.cursor()
        try:
            if role_filter:
                cur.execute("SELECT id, email, nombre, role, created_at, is_active, subscription_type FROM usuarios WHERE role = ?", (role_filter,))
            else:
                cur.execute("SELECT id, email, nombre, role, created_at, is_active, subscription_type FROM usuarios")
            return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def update_role(self, user_id: str, new_role: str, admin_id: str) -> bool:
        if new_role not in ("admin", "user"):
            raise ValueError("Rol inválido")
        conn = _get_db()
        cur = conn.cursor()
        try:
            cur.execute("UPDATE usuarios SET role = ? WHERE id = ?", (new_role, user_id))
            conn.commit()
            return True
        finally:
            conn.close()

    def check_access(self, user_id: str) -> tuple[bool, str]:
        conn = _get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM usuarios WHERE id = ?", (user_id,))
        row = cur.fetchone()
        conn.close()
        
        if not row:
            return False, "usuario_no_encontrado"
        
        user = dict(row)
        
        if user.get("subscription_type") == "vip_free":
            return True, "acceso_vip"
        
        if not user.get("is_approved", False):
            return False, "no_aprobado"
        
        if user.get("subscription_type") == "subscriber":
            return True, "suscriptor_activo"
        
        try:
            created = datetime.fromisoformat(user.get("created_at", ""))
            if (datetime.utcnow() - created).days <= 7:
                return True, "periodo_prueba"
        except:
            pass
        
        return False, "bloqueado"


from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()
auth_service = AuthService()


def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)) -> Dict[str, Any]:
    token = credentials.credentials
    payload = auth_service.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    return payload


def require_role(required_role: str):
    def role_checker(current_user: Dict = Depends(get_current_user)) -> Dict[str, Any]:
        if current_user.get("role") != required_role and current_user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="No tiene permisos suficientes")
        return current_user
    return role_checker


def require_admin(current_user: Dict = Depends(get_current_user)) -> Dict[str, Any]:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acceso denegado: se requiere rol de administrador")
    return current_user


def require_subscription(current_user: Dict = Depends(get_current_user)) -> Dict[str, Any]:
    user = auth_service.get_user(current_user["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    
    has_access, reason = auth_service.check_access(current_user["sub"])
    if not has_access:
        if reason == "usuario_no_encontrado":
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        if reason == "no_aprobado":
            raise HTTPException(status_code=403, detail="Pendiente de aprobación por el Administrador")
        raise HTTPException(status_code=402, detail="Suscripción requerida")
    
    return current_user


__all__ = [
    "AuthService", "get_current_user", "require_role", 
    "require_admin", "require_subscription", "init_auth_tables"
]