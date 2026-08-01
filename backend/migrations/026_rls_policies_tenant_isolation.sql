-- 026_rls_policies_tenant_isolation.sql
-- P0 de la auditoria de seguridad (2026-08-01): 37/38 tablas tenian RLS
-- "enabled" pero CERO politicas reales (verificado con pg_policies). En la
-- practica es irrelevante hoy porque el backend siempre se conecta con
-- service_role (bypasea RLS por diseno) -- pero es defensa en profundidad
-- real si esa key llega a filtrarse otra vez (ya paso una vez, ver
-- 025_usuarios_email_verified.sql y la rotacion de SUPABASE_SERVICE_KEY
-- de esta misma sesion), y deja la base lista para el dia que se use RLS
-- de verdad (ej. clave anon/publishable desde el cliente).
--
-- Usa la misma variable de sesion que ya usa el codigo real de la app
-- (server.js: setTenantContext -> withTenant() -> SET LOCAL app.org_id) --
-- no se inventa un mecanismo nuevo. Si app.org_id no esta seteado (ej. una
-- conexion anon directa a la API REST de Supabase, fuera del backend), la
-- comparacion contra NULL nunca es true y la politica bloquea por defecto.

ALTER TABLE postulaciones_entidad ENABLE ROW LEVEL SECURITY;

-- org_id directo
CREATE POLICY tenant_isolation ON postulaciones_entidad FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_apu_lineas FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_budgets FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_change_theory FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_chat_history FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_escenarios_estres FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_hallazgos FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_indicators FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_ods_mapping FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_sroi_metrics FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON proyectos FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON match_scores FOR ALL USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON usuarios FOR ALL USING (id = current_setting('app.org_id', true)) WITH CHECK (id = current_setting('app.org_id', true));

-- tenant_id directo (mismo concepto que org_id en este esquema)
CREATE POLICY tenant_isolation ON project_anexos FOR ALL USING (tenant_id = current_setting('app.org_id', true)) WITH CHECK (tenant_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON project_version_hashes FOR ALL USING (tenant_id = current_setting('app.org_id', true)) WITH CHECK (tenant_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON projects FOR ALL USING (tenant_id = current_setting('app.org_id', true)) WITH CHECK (tenant_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON stripe_events FOR ALL USING (tenant_id = current_setting('app.org_id', true)) WITH CHECK (tenant_id = current_setting('app.org_id', true));

-- user_id directo (1 usuario = 1 organizacion en este modelo)
CREATE POLICY tenant_isolation ON compliance_data FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON config_logistica FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON marco_normativo FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON motor_dialectico FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON user_credentials FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON user_favorites FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON user_subscriptions FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));
CREATE POLICY tenant_isolation ON versiones_proyecto FOR ALL USING (user_id = current_setting('app.org_id', true)) WITH CHECK (user_id = current_setting('app.org_id', true));

-- Solo proyecto_id (sin org_id/tenant_id/user_id propio): heredan el org_id via join a proyectos
CREATE POLICY tenant_isolation ON logistica_tramos FOR ALL USING (EXISTS (SELECT 1 FROM proyectos p WHERE p.id = logistica_tramos.proyecto_id AND p.org_id = current_setting('app.org_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM proyectos p WHERE p.id = logistica_tramos.proyecto_id AND p.org_id = current_setting('app.org_id', true)));
CREATE POLICY tenant_isolation ON objetivos_arbol FOR ALL USING (EXISTS (SELECT 1 FROM proyectos p WHERE p.id = objetivos_arbol.proyecto_id AND p.org_id = current_setting('app.org_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM proyectos p WHERE p.id = objetivos_arbol.proyecto_id AND p.org_id = current_setting('app.org_id', true)));

-- Tablas globales/de sistema deliberadamente SIN politica de tenant (quedan
-- bloqueadas por defecto para cualquier rol que no sea service_role, que es
-- el comportamiento correcto: no son datos por-tenant):
-- agentes_registro, app_settings, catalogo_rendimientos, convocatorias,
-- crawl_log, directorio_entidades, organizations, predios, revoked_tokens,
-- system_config, system_logs.
