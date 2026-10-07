# Plan de hardening operacional para RadFor-360

Estado inicial: plan de trabajo. El 99,99% de disponibilidad y cero brechas entre tenants no están certificados.

## Objetivos y gates

| Gate | Objetivo | Evidencia obligatoria | Responsable externo |
|---|---|---|---|
| G0 - SLO | Definir alcance, SLI, 99,99%, RTO, RPO y presupuesto de error | Documento aprobado, dashboards y alertas | Dueño de producto / SRE |
| G1 - Tenant | Cero accesos tenant sin contexto RLS | Inventario completo; pruebas A/B de lectura y escritura en PostgreSQL real; revisión de grants, policies y roles | DBA / Seguridad |
| G2 - Estado compartido | Revocación inmediata y límites coherentes entre instancias | Pruebas concurrentes con dos procesos y fallos de store | Backend / Plataforma |
| G3 - Jobs | Ejecución durable, idempotente, coordinada y observable | Reinicio/reintento no duplica efectos; DLQ y recuperación probadas | Backend / Plataforma |
| G4 - Alta disponibilidad | Recuperar tráfico y dependencias dentro del SLO | Prueba de carga, caída de instancia y failover medidos | SRE / Proveedor |
| G5 - Recuperación de datos | Cumplir RPO/RTO, incluyendo Storage | Restauración aislada repetible, integridad verificada y tiempos registrados | DBA / Dueño de datos |
| G6 - Integridad funcional | Resultados financieros reproducibles y fuentes oficiales trazables | Casos límite, datasets con procedencia, revisión independiente | Producto / Finanzas / Legal |

## Orden de ejecución

1. Mantener fail-closed de `withTenant`; migrar accesos de tenant fuera del pool principal por lotes pequeños, sin cambiar `DATABASE_URL` de golpe. Cada lote necesita prueba adversarial A/B antes del siguiente.
2. Compartir y probar estado de seguridad entre procesos: revocación de sesiones y rate limits atómicos. Elegir backend compartido según SLA y capacidad del proveedor.
3. Separar tareas durables del proceso HTTP. Elegir y aprobar plataforma de jobs antes de implementar: Inngest administrado, worker dedicado u otra opción. No inferir que una dependencia instalada ya está operativa.
4. Diseñar liveness/readiness, réplicas, despliegue gradual, rollback y telemetría para los SLI acordados.
5. Respaldar base y objetos; proteger retención; restaurar en entorno aislado; documentar runbook y responsables.
6. Endurecer procedencia de fuentes MGA/SGR y completar modelo de incertidumbre financiera con supuestos aprobados.
7. Ejecutar prueba integral de carga/caos y ventana de observación. Declarar SLO alcanzado solo con medición externa y gates aprobados.

## Cambios locales incluidos

- `withTenant` conserva fail-closed en producción y permite un sondeo acotado de recuperación antes de rechazar.
- Logout por token consulta su hash persistido además del cache local; un fallo al verificar no autentica.
- Rate limit persistente usa un único UPSERT PostgreSQL y falla cerrado si no hay PostgreSQL directo; no depende del traductor REST.

## Bloqueos que requieren acceso o decisión externos

- Acceso al proyecto Supabase para inventariar y probar políticas reales y revisar grants/roles.
- Decisión de proveedor y presupuesto para workers/cola, HA y almacenamiento WORM.
- Credenciales y entorno aislado para restauración de PostgreSQL y Storage.
- Definición del negocio para RTO/RPO, fuentes oficiales aceptadas, inflación/sobrecosto y límites COP.
- Pruebas con dos procesos/instancias desplegados; una prueba unitaria con mocks no acredita HA.

## Checklist de operador: Supabase, Render y GitHub Actions

No hay migración remota ejecutada por este cambio. Los dos contadores se crean de forma idempotente por la aplicación y ya existe `backend/migrations/027_rate_limit_counters.sql`; precrearlos en Supabase evita DDL durante requests.

### 1. Supabase: preflight y tablas globales

Antes de alterar tablas, confirma en una conexión equivalente al `DATABASE_URL` que el rol principal tiene `rolbypassrls=true`. Si no, detente: la app usa ese pool para estas tablas globales y el RLS sin políticas las bloquearía.

```sql
SELECT current_user, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname = current_user;

SELECT rolname, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname = 'rf360_rls_scoped';
```

Si la primera consulta confirma el rol principal esperado y la segunda confirma `rf360_rls_scoped` con `rolbypassrls=false` y `rolsuper=false`, ejecuta en Supabase SQL Editor:

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.revoked_tokens (
	token_hash TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	revoked_at TIMESTAMPTZ DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at
	ON public.revoked_tokens (expires_at);

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
	id TEXT PRIMARY KEY,
	count INTEGER NOT NULL DEFAULT 1,
	reset_at TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_reset
	ON public.rate_limit_counters (reset_at);

ALTER TABLE public.revoked_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.revoked_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rate_limit_counters FROM PUBLIC, anon, authenticated;

COMMIT;
```

Estas son tablas globales del backend: no se crean políticas tenant para ellas. El rol de aplicación principal debe ser el único acceso backend que las use; el pool scoped no necesita grants sobre ellas. Verifica después:

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
			 has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select,
			 has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
	AND c.relname IN ('revoked_tokens', 'rate_limit_counters');
```

Resultado requerido: ambas tablas tienen RLS activo y `anon_can_select=false`, `authenticated_can_select=false`. Revisa que `DATABASE_URL` y `DATABASE_URL_TENANT_SCOPED` apunten a los roles esperados; no pegues URLs ni secretos en tickets/logs. Antes de migrar tablas/rutas de tenant, concilia el inventario actual con `docs/ROADMAP_MIGRACION_TENANT_2026.md`; separa excepciones globales/admin de acceso tenant real.

### 2. Render: variables y preflight

Este cambio no introduce variables nuevas ni usa Upstash. El store compartido usa PostgreSQL directo; por ello el limitador global hace una escritura atómica por request API. No escales réplicas hasta medir latencia, throughput y comportamiento durante caída de PostgreSQL en staging.

Confirma en el servicio Render existente: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_URL_TENANT_SCOPED`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SMOKE_TEST_TOKEN` y `VITE_API_URL`. Genera un valor aleatorio nuevo fuera del repo y guarda **el mismo** `SMOKE_TEST_TOKEN` en Render y en GitHub Actions Secrets. Verifica que `DATABASE_URL` conecte por el pool esperado y que el rol scoped no tenga `BYPASSRLS` ni `SUPERUSER`. No cambies `DATABASE_URL` al rol scoped en bloque.

### 3. GitHub Actions y despliegue

El repo tiene `autoDeploy: false`: el camino aprobado es CI → Render deploy → smoke test mediante `.github/workflows/radar.yml`. GitHub Actions requiere `RENDER_API_KEY`, `RENDER_SERVICE_ID`, `SMOKE_TEST_URL`, `SMOKE_TEST_TOKEN`, `DATABASE_URL`, `VITE_API_URL` y los secretos de build que marque el workflow. El smoke devuelve fallo si no puede persistir `production_ready`; no se comparte `JWT_SECRET` con el endpoint.

Solo después de aprobar el preflight y el ensayo de staging:

```powershell
git push origin main
gh run list --workflow radar.yml --branch main --limit 1
gh run watch <RUN_ID> --exit-status
```

El run debe terminar verde en CI, deploy de Render y smoke test; verifica en Render que el commit live sea el commit de `main`. No dispares un deploy manual que evite el workflow. Comprueba `GET /api/health` y `GET /api/db-status`; readiness requerido: HTTP 200, `productionGatePassed=true`, `rlsScopedReady=true` y `pgReady=true`.

### 4. Backup y DR

Para el workflow `.github/workflows/backup-s3.yml`, configura como GitHub Actions secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION` y `DATABASE_URL`. Corre primero el job manualmente y verifica el resumen; el workflow valida el dump y la carga, pero **no restaura ni respalda objetos de Supabase Storage**. No declares RPO/RTO cumplidos hasta ensayar restauración aislada de base y archivos, medir tiempos y comprobar integridad.