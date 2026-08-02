-- 029_admin_audit_log.sql
-- Blindaje: rastro forense de acciones admin (aprobar/rechazar/purgar
-- usuarios). Antes no habia forma de responder "quien aprobo esta cuenta
-- y cuando" con certeza.

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        TEXT NOT NULL,
    admin_email     TEXT,
    accion          TEXT NOT NULL,   -- 'aprobar' | 'rechazar' | 'purgar'
    objetivo_id     TEXT,
    objetivo_email  TEXT,
    detalle         TEXT,
    ip              TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin   ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
