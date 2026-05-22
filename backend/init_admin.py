"""
Initialize default admin user for RadarFondos
============================================
Ejecutar una vez: python backend/init_admin.py
"""

from backend.auth_system import AuthService

auth = AuthService()

def crear_admin_default():
    try:
        result = auth.register(
            email="admin@radarfondos.com",
            password="Admin123!",
            nombre="Administrador Principal",
            role="admin"
        )
        print(f"[OK] Admin creado: {result['user']['email']}")
        print(f"[OK] Token: {result['token'][:50]}...")
    except ValueError as e:
        print(f"[INFO] Admin ya existe o error: {e}")

if __name__ == "__main__":
    crear_admin_default()