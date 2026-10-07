# Estado de hardening

ARQUITECTURA_CERRADA: NO — estrategia local por fases; requiere decisiones de operación y proveedor.

## Estado verificado

- [x] Pool tenant scoped falla cerrado en producción; recovery probe tiene prueba unitaria.
- [x] Logout solo se confirma tras persistir el hash por PostgreSQL directo; fallo de escritura devuelve 503.
- [x] Sesiones y links de un solo uso consultan la blacklist persistida entre instancias.
- [x] Limiters globales y críticos usan UPSERT PostgreSQL atómico; requieren PG directo.
- [x] Suite unitaria: 319/319 aprobadas en la última corrida local.
- [ ] Prueba de concurrencia de rate limit en PostgreSQL real.
- [ ] Prueba adversarial A/B contra Supabase productivo o réplica de esquema confiable.
- [ ] Migrar todos los accesos de tenant que aún usan el pool principal `BYPASSRLS`.
- [ ] Aprobar SLI/SLO 99,99%, RTO/RPO y presupuesto de error.
- [ ] Coordinar workers/cron entre instancias e implementar cola durable/idempotencia.
- [ ] Backups de Storage, restauración aislada y runbook de DR verificado.
- [ ] Procedencia oficial de fuentes y escenarios financieros de inflación/sobrecosto.
- [ ] Prueba de carga/caos y ventana de observación con resultados aprobados.
- [ ] Medir impacto del write PostgreSQL por request del limitador global antes de habilitar más réplicas.

No declarar 99,99% ni cero brechas cross-tenant antes de cerrar y evidenciar todos los gates aplicables en `HARDENING_9999_PLAN.md`.