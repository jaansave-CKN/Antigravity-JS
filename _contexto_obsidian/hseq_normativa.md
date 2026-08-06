---
tipo: hseq_normativa
actualizado: 2026-08-03
---

# HSEQ y normativa — RadFor-360

Vuelve a [[00_INDEX]]. Relacionado: [[requisitos]] (qué exige el negocio), [[registros_arquitectura]] (cómo se implementó), [[pendientes]] (brechas abiertas).

> Nota de alcance: "HSEQ" aquí no es Salud-Seguridad-Ambiente industrial — es el cumplimiento normativo y de contratación pública que el Formulador debe respetar para que un proyecto sea radicable. Ajustar este encabezado si el uso real del término difiere.

## Compliance / estado legal del predio

- Tabla `compliance_data`, columna `estado_legal` + CHECK constraint (migración asociada al commit `4364f1b`).
- **Soft-Lock**: `estado_legal` condicionado (trámite en curso) **no bloquea** el avance por el Formulador.
- **Hard-Lock**: solo se activa en el paso de **certificación final** — no se puede certificar/radicar con estado legal sin resolver.
- Módulo relacionado: `AuditorForenseService.js` (backend/services) — auditoría forense de proyectos.

## Marco normativo

- `marcoNormativo.routes.js` — endpoints de marco normativo aplicable al proyecto.
- `motorDialectico.routes.js` — motor dialéctico, ligado a la coherencia lógica (ver [[requisitos]] módulo 3), relevante aquí porque valida que el proyecto sea consistente con la normativa antes de radicar.

## Multitenancy como control de seguridad/cumplimiento

- RLS activo en Postgres aísla datos entre tenants a nivel de base de datos (no solo aplicación) — ver [[registros_arquitectura]].
- Migraciones de auditoría y hardening: `029_admin_audit_log.sql` (log de auditoría admin), `028_account_lockout.sql` (bloqueo de cuenta), `030_mfa_totp.sql` (segundo factor).
- `027_rate_limit_counters.sql` — contención de abuso, relevante para disponibilidad del servicio.

## Gestión de secretos (higiene de seguridad, no normativa legal, pero crítico)

- Regla vigente: ningún secreto real hardcodeado en código — verificado limpio en el árbol actual a 2026-08-03 (Supabase, Stripe, Google API keys).
- Incidente resuelto: fuga histórica de una key de Gemini y una de Firebase (ver [[registros_arquitectura]]) — revocadas; purga de historial de git en curso, ver [[pendientes]].
- Todos los `.env*` reales están cubiertos por `.gitignore`; solo `.env.example` se versiona.

## Exportación y trazabilidad documental

- Todo documento generado en los formatos MGA/BID/OXI (ver [[requisitos]]) debe declarar su origen ("generado según estructura X") — requisito de transparencia frente al organismo cooperante, no un formulario oficial 1:1.
- Ficha Técnica lleva sello/hash SHA-256 y número de versión — trazabilidad de qué versión del proyecto se certificó/radicó.

## Brechas abiertas de cumplimiento

Ver [[pendientes]] — en particular: decisión de negocio pendiente entre Stripe y pasarelas locales (Wompi/PayU vía PSE) para pagos en Colombia, y el estado de la purga de secretos en el historial de git.
