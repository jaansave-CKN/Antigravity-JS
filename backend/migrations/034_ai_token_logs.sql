-- 034_ai_token_logs.sql — FinOps: registro de consumo de tokens/IA por request.
-- user_id es TEXT (no UUID) para calzar con usuarios.id, que en este esquema
-- real es TEXT PRIMARY KEY (ver server.js, CREATE TABLE usuarios) — no UUID
-- nativo de Postgres, aunque los valores tengan forma de UUID.
-- Sin FK real a usuarios(id): el patrón ya establecido en admin_audit_log
-- (029_admin_audit_log.sql) evita FK aquí a propósito para no bloquear el
-- insert si el usuario se purga después (Habeas Data) — el log de consumo
-- histórico debe sobrevivir a la purga de la cuenta.

CREATE TABLE IF NOT EXISTS ai_token_logs (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  agent_name          TEXT NOT NULL,
  tokens_input        INTEGER NOT NULL DEFAULT 0,
  tokens_output       INTEGER NOT NULL DEFAULT 0,
  cost_cop_estimated  NUMERIC(12,4) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_token_logs_user_id    ON ai_token_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_created_at ON ai_token_logs(created_at);
