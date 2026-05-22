"""
Payment Webhooks - LemonSqueezy Integration
==========================================
Endpoint: POST /api/payments/webhook
"""

from fastapi import APIRouter, Request, HTTPException
import sqlite3
from pathlib import Path

router = APIRouter(prefix="/api/payments", tags=["payments"])
DB_PATH = Path(__file__).parent / "radar.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@router.post("/webhook")
async def lemon_squeezy_webhook(request: Request):
    event = await request.json()
    
    if event.get("meta", {}).get("event_name") == "subscription_created":
        user_id = event.get("data", {}).get("attributes", {}).get("custom", {}).get("user_id")
        
        if user_id:
            conn = get_db()
            cur = conn.cursor()
            try:
                cur.execute(
                    "UPDATE usuarios SET subscription_type = 'subscriber', is_approved = 1 WHERE id = ?",
                    (user_id,)
                )
                conn.commit()
                print(f"Usuario {user_id} activado - suscriptor pago")
            except Exception as e:
                conn.rollback()
                raise HTTPException(status_code=500, detail=str(e))
            finally:
                conn.close()
    
    return {"status": "received"}

__all__ = ["router"]