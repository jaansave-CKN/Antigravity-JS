# 🚨 SYSTEM OVERRIDE: CONTEXTO SRE — RADAR FONDOS 360

> **Leer antes de cualquier modificación.** Este archivo define la arquitectura vigente,
> el historial de fallos críticos y las restricciones absolutas del proyecto.
> Cualquier cambio que contradiga esto generará una regresión de código.

---

## 1. ARQUITECTURA E INMUTABILIDADES DEL SISTEMA

> Corregido 2026-08-08 (Operación Blindaje Final, hallazgo 3 de la radiografía
> 360): este archivo describía persistencia SQLite (`sql.js`) que ya no existe
> en el código. Verificado contra `backend/db.js` y `backend/config/
> database.config.js` — la sección de persistencia se corrige abajo; el resto
> de la arquitectura (Express monolito, routing, Render) se re-verificó y
> sigue siendo cierta.

- **Modelo:** Monolito Express (`server.js`) desplegado en Render bajo `env: node`
  con `startCommand: node server.js`
- **Frontend:** Servido estáticamente desde `dist/` (React compilado vía `npm run build`)
- **Enrutamiento:** Rutas API (`/api/*`) primero; comodín SPA `app.get('/{*path}')` al FINAL
  del archivo (verificado en `server.js`, línea ~4800). PROHIBIDO mover su orden.
  Express 5 requiere `'/{*path}'` no `'*'`.
- **Persistencia:** PostgreSQL exclusivo (Supabase), sin fallback SQLite — el fallback
  fue eliminado a propósito (ver comentario en `backend/db.js`) para evitar esquemas
  desincronizados y contaminación de contexto RLS multi-tenant. `backend/config/
  database.config.js` implementa 2 capas: Capa 1 = `pg.Pool` directo (Session Pooler);
  Capa 2 = fallback automático a Supabase REST API si la Capa 1 falla.
- **Nomenclatura:** Rol de usuario es estrictamente **'Usuario'** (no 'Cliente' ni 'Inversor')
- **Respuestas HTTP:** Todas deben ser `res.status().json()` con `{ success, message }`

## 2. HISTORIAL DE ERRORES CRÍTICOS — PROHIBIDO REVERTIR

| Error | Causa Raíz | Solución (Commit) |
|---|---|---|
| API devuelve HTML en vez de JSON | `app.get('*')` interceptaba rutas API por estar declarado antes | `1dd5bfd` — API routes first, catch-all last |
| `Unexpected end of JSON input` (Error 200) | Frontend llamaba `.json()` ciegamente | `response.text()` → try `JSON.parse` → check `response.ok` |
| Render no deploya cambios | `env:` es inmutable tras crear servicio | Mantener `env: node`, no cambiar a docker/python |
| Python backend no funciona en Render | Render Node env no tiene Python | Reescribir backend a Node.js/Express (`b37249b`) |

> Nota: la fila histórica "BD no existe en Render (SQLite)" se retiró — ya no aplica
> desde la migración a PostgreSQL/Supabase. Ver `docs/` para el historial completo
> de migraciones (`backend/migrations/001..035`).

## 3. DIRECTIVAS DE TRABAJO

- ✅ Cualquier nuevo endpoint debe usar `tryCatch` wrapper
- ✅ Toda consulta DB debe usar placeholders parametrizados (`getRow`/`getRows`/`runSql`
  de `backend/config/database.config.js`, que aceptan `?` o `$N` y nunca interpolación de string)
- ✅ La conexión es un pool compartido y persistente (`pg.Pool`), NO se abre/cierra por handler
- ❌ NO reintroducir Docker, cambiar `env:` de Render, ni migrar a Firebase en prod
- ❌ NO usar `'Cliente'`/`'Inversor'` — solo `'Usuario'`
- ❌ NO llamar `.json()` directamente en frontend — usar `response.text()` primero
- ❌ NO asumir que `dist/` existe siempre — verificar con `fs.existsSync`
- ❌ NO usar `ON CONFLICT` en queries que puedan correr contra la Capa 2 (REST) —
  se ignora en silencio ahí; usar patrón SELECT → decide UPDATE/INSERT

## 4. DEBUG / DIAGNÓSTICO

Si hay problemas de registro/login en Render:
1. Revisar `GET /api/db-status` y `GET /api/health` para confirmar si la Capa 1
   (pg Pool) o la Capa 2 (Supabase REST) está activa
2. Revisar logs de Render para errores de conexión a `DATABASE_URL` / `SUPABASE_URL`
3. Usar middleware de debug en `/api/auth/register` para inspeccionar `req.body`
4. Probar conectividad con `GET /api/health`
