"""
RadarFondos Authentication API Routes
====================================
Endpoints REST para autenticación con roles
"""

import logging
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from typing import Optional
import sqlite3
from pathlib import Path
from auth_system import AuthService, get_current_user, require_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])
auth = AuthService()
DB_PATH = Path(__file__).parent / "radar.db"
logger = logging.getLogger("radar_fondos_360")


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    nombre: str
    role: str = "user"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UpdateUserRequest(BaseModel):
    nombre: Optional[str] = None
    email: Optional[EmailStr] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ApproveUserRequest(BaseModel):
    userId: str
    action: str


@router.post("/register")
async def register(data: RegisterRequest):
    try:
        logger.info("Registrando usuario: %s", data.email)
        result = auth.register(email=data.email, password=data.password, nombre=data.nombre, role=data.role)
        return result
    except Exception as error:
        logger.error("Error en servidor: %s", error)
        return JSONResponse(status_code=500, content={"success": False, "message": str(error) or "Error interno del servidor"})


@router.post("/login")
async def login(data: LoginRequest):
    try:
        logger.info("Inicio de sesión: %s", data.email)
        result = auth.login(data.email, data.password)
        return result
    except Exception as error:
        logger.error("Error en servidor: %s", error)
        return JSONResponse(status_code=500, content={"success": False, "message": str(error) or "Error interno del servidor"})


@router.post("/logout")
async def logout(token: str = Depends(get_current_user)):
    success = auth.logout(token)
    if not success:
        raise HTTPException(status_code=400, detail="Error al cerrar sesión")
    return {"message": "Sesión cerrada exitosamente"}


@router.get("/me")
async def me(current_user = Depends(get_current_user)):
    user = auth.get_user(current_user["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


@router.put("/me")
async def update_me(data: UpdateUserRequest, current_user = Depends(get_current_user)):
    success = auth.update_user(current_user["sub"], data.dict(exclude_unset=True))
    if not success:
        raise HTTPException(status_code=400, detail="Error al actualizar usuario")
    return {"message": "Usuario actualizado"}


@router.post("/change-password")
async def change_password(data: ChangePasswordRequest, current_user = Depends(get_current_user)):
    try:
        success = auth.change_password(current_user["sub"], data.old_password, data.new_password)
        if not success:
            raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
        return {"message": "Contraseña actualizada"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/users")
async def list_users(role: Optional[str] = None, current_user = Depends(require_admin)):
    return auth.list_users(role_filter=role)


@router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, role: str, current_user = Depends(require_admin)):
    try:
        auth.update_role(user_id, role, current_user["sub"])
        return {"message": f"Rol actualizado a {role}"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/verify")
async def verify_token(current_user = Depends(get_current_user)):
    user = auth.get_user(current_user["sub"])
    if not user:
        return JSONResponse(status_code=404, content={"success": False, "message": "Usuario no encontrado"})
    return {"valid": True, "user": user}


@router.post("/admin/approve-user")
async def approve_user(data: ApproveUserRequest, current_user = Depends(require_admin)):
    if data.action not in ("approve", "vip_free", "reject"):
        raise HTTPException(status_code=400, detail="Acción inválida")
    
    status_map = {"approve": "approved", "vip_free": "vip_free", "reject": "rejected"}
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("UPDATE usuarios SET status = ?, is_approved = ? WHERE id = ?",
               (status_map.get(data.action, data.action), 1 if data.action == "approve" else 0, data.userId))
    conn.commit()
    conn.close()
    
    return {"message": f"Usuario {data.userId} actualizado a {data.action}"}