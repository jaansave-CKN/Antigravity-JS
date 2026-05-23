# 🚨 SYSTEM OVERRIDE: CONTEXTO SRE — RADAR FONDOS 360

> **Leer antes de cualquier modificación.** Este archivo define la arquitectura vigente,
> el historial de fallos críticos y las restricciones absolutas del proyecto.
> Cualquier cambio que contradiga esto generará una regresión de código.

---

## 1. ARQUITECTURA E INMUTABILIDADES DEL SISTEMA

- **Modelo:** Monolito Express (`server.js`) desplegado en Render bajo `env: node`
  con `startCommand: node server.js`
- **Frontend:** Servido estáticamente desde `dist/` (React compilado vía `npm run build`)
- **Enrutamiento:** Rutas API (`/api/*`) primero; comodín SPA `app.get('/{*path}')` al FINAL
  del archivo (Commit `1dd5bfd`). PROHIBIDO mover su orden. Express 5 requiere `'/{*path}'` no `'*'`.
- **Persistencia:** SQLite local en `backend/radar.db` via `sql.js` (WASM, sin compilación nativa)
- **Nomenclatura:** Rol de usuario es estrictamente **'Usuario'** (no 'Cliente' ni 'Inversor')
- **Respuestas HTTP:** Todas deben ser `res.status().json()` con `{ success, message }`

## 2. HISTORIAL DE ERRORES CRÍTICOS — PROHIBIDO REVERTIR

| Error | Causa Raíz | Solución (Commit) |
|---|---|---|
| API devuelve HTML en vez de JSON | `app.get('*')` interceptaba rutas API por estar declarado antes | `1dd5bfd` — API routes first, catch-all last |
| `Unexpected end of JSON input` (Error 200) | Frontend llamaba `.json()` ciegamente | `response.text()` → try `JSON.parse` → check `response.ok` |
| Render no deploya cambios | `env:` es inmutable tras crear servicio | Mantener `env: node`, no cambiar a docker/python |
| Python backend no funciona en Render | Render Node env no tiene Python | Reescribir backend a Node.js/Express (`b37249b`) |
| BD no existe en Render | SQLite necesita archivo en filesystem | `initDb()` con `CREATE TABLE IF NOT EXISTS` al arrancar |

## 3. DIRECTIVAS DE TRABAJO

- ✅ Cualquier nuevo endpoint debe usar `tryCatch` wrapper
- ✅ Toda consulta DB debe usar sentencias preparadas (`db.prepare().run/get/all`)
- ✅ La DB se abre/cierra en cada handler (patrón `getDb()` + `finally { db.close() }`)
- ❌ NO reintroducir Docker, cambiar `env:` de Render, ni migrar a Firebase en prod
- ❌ NO usar `'Cliente'`/`'Inversor'` — solo `'Usuario'`
- ❌ NO llamar `.json()` directamente en frontend — usar `response.text()` primero
- ❌ NO asumir que `dist/` existe siempre — verificar con `fs.existsSync`

## 4. DEBUG / DIAGNÓSTICO

Si hay problemas de registro/login en Render:
1. Revisar logs de Render para errores de SQLite (permisos de escritura)
2. Verificar que `initDb()` se ejecuta al arrancar (debe mostrar "DB initialized at ...")
3. Usar middleware de debug en `/api/auth/register` para inspeccionar `req.body`
4. Probar conectividad con `GET /api/health`
