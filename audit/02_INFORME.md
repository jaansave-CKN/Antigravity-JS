# Auditoría de seguridad — RadarFondos 360 — resumen público

**Fecha:** 2026-09-23. **Versión pública redactada.** El detalle técnico completo (evidencia archivo:línea de los hallazgos abiertos, datos de infraestructura y red) se conserva fuera del repositorio porque este repositorio es público. Los hallazgos abiertos se listan solo por ID, categoría y severidad.

## Método

Lectura del código fuente, extracción de las 216 rutas HTTP, pruebas de concepto ejecutadas, peticiones HTTP reales contra un entorno local, consultas de solo lectura al catálogo de la base de datos, `tsc --noEmit`, `node --check`, `vite build` y `npm audit`.

## Hallazgos

| ID | Severidad | Estado |
|---|---|---|
| AUTH-001 — bypass de autenticación de desarrollo + servidor de desarrollo expuesto a la red | S0 | ✅ Corregido (4e1b9a9) |
| AUTH-002 — tokens de un solo uso aceptados como sesión (bypass de MFA) | S1 | ✅ Corregido (4e1b9a9) |
| BIZ-001 — catálogo del plan Radar accesible sin plan | S1 | ✅ Corregido (4e1b9a9, dfa987c) |
| OPS-001 — destino de despliegue no sirve este código | S1 | 🟡 Parcial: código versionado; falta re-apuntar el servicio en el hosting |
| LLM-001, AUTH-003, DEP-001 | S2 | Abiertos |
| PAY-001, AUTHZ-001, AUTH-004, LOG-001, FINOPS-001, SMOKE-001 | S3 | Abiertos |
| CSRF-001, DEAD-001 | S4 | Abiertos |
| PRIV-001 | S4 | Por diseño |

## Controles verificados sin hallazgos

- Aislamiento multi-tenant: RLS activo en todas las tablas del esquema `public`, todas las políticas escopadas por tenant, sin permisos a roles públicos de PostgREST.
- Sin inyección SQL en las construcciones SQL dinámicas revisadas.
- Sin datos simulados en rutas de producción del frontend.
- Compilación limpia (`tsc`, `node --check`, `vite build`).

## Correcciones aplicadas (resumen)

- **AUTH-001:** eliminado el bypass `demo-mode-token` y `/api/dev/make-admin`; backend y Vite escuchan solo en `127.0.0.1` fuera de producción; el frontend en desarrollo ya no simula una sesión admin.
- **AUTH-002:** `authenticateToken` rechaza cualquier token con claim `purpose`.
- **BIZ-001:** `optionalAuth` + `resolverNivelRadar` en las 5 rutas públicas del catálogo; sin plan Radar se sirve una muestra fija de 3 filas sin URL, descripción ni montos; caché separada por nivel y `Cache-Control: private`.
