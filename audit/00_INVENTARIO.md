# Inventario técnico — RadarFondos 360 — versión pública

**Fecha:** 2026-09-23. Versión redactada. Se omiten a propósito las variables de entorno, la configuración de red y de base de datos y el estado de los módulos inactivos, porque este repositorio es público.

| Elemento | Valor |
|---|---|
| Backend | Node.js + Express 5, `server.js` + 24 módulos en `backend/routes/` |
| Frontend | React 19 + TypeScript 5.8 + Vite 8 |
| Base de datos | PostgreSQL (Supabase) + pgvector, RLS multi-tenant (`withTenant()` / rol escopado) |
| IA | Google Gemini |
| Rutas HTTP | 216. La mayoría exige sesión; las públicas son autenticación, webhooks firmados, health, catálogo del Radar (ahora con muestra por nivel) y el verificador de sellos |
| Compilación | `tsc --noEmit`, `node --check` y `vite build` sin errores (2026-09-23) |
| Deuda declarada | 0 marcadores TODO/FIXME/HACK reales; 47 usos de `any` en `client/src` |
