# Despliegue de RadarFondos 360 en Render — parámetros del Dashboard

**Fecha:** 2026-09-23. Para quien tenga acceso al Dashboard de Render; desde el repo no se puede leer ni cambiar la configuración de un servicio.

## Estructura real del repositorio (verificada en GitHub)

El repo `jaansave-CKN/Antigravity-JS` aloja **dos aplicaciones distintas en dos ramas**:

| Rama | Aplicación | `render.yaml` |
|---|---|---|
| `main` | **RadarFondos 360** (esta), con `server.js` en la raíz | servicio `radarfondos-360` |
| `master` | App padre "Antigravity OS" | servicio `radar-formulador-360` |

La ruta `proyectos/Proy_03_RadarFondos` **no existe** en ninguna rama remota. No se debe configurar como Root Directory: el build fallaría.

## Causa real del fallo (auditada 2026-09-23) y estado

El servicio es `radar360-app` (`srv-d89pvbb7uimc739q7vtg`, plan free, Oregon); `RENDER_SERVICE_ID` apunta a él. Estaba configurado con:

1. **Branch `radfor360-production`**: un snapshot del 2026-08-16 de la app padre (`master`), sin historia común con `main`. Cada deploy disparado por el CI (HTTP 2xx) reconstruía el commit `fc979e1`. Producción nunca recibió `main`, y `/api/health` de la app padre respondía 503.
2. **`DATABASE_URL` con el host directo `db.<ref>.supabase.co`**, que solo tiene registro IPv6 e inalcanzable desde Render. Este código habría caído a la capa REST.
3. **Faltaban `VITE_API_URL`** (el frontend no arranca sin ella), `DATABASE_URL_TENANT_SCOPED`, `SUPABASE_STORAGE_KEY` y `ADMIN_NOTIFY_EMAIL`.
4. **`autoDeploy: yes`**, que saltaba el gate del CI.
5. **El CI no esperaba al deploy**: el smoke test corría contra la versión anterior mientras Render construía. Corregido en `radar.yml`: ahora espera a que ESE deploy quede `live` y exige que su commit sea el del push.

**Corregido el 2026-09-23 vía API de Render:** branch `main`, sin Root Directory, autoDeploy `no`, health `/api/health`, build `npm install && npm run build`, `DATABASE_URL` y `DATABASE_URL_TENANT_SCOPED` al pooler IPv4 `aws-1-us-west-2.pooler.supabase.com:6543`, y las variables faltantes definidas. Respaldo de la configuración anterior fuera del repo.

## Parámetros a fijar en el servicio de RadarFondos 360

| Campo del Dashboard | Valor |
|---|---|
| Repository | `jaansave-CKN/Antigravity-JS` |
| **Branch** | **`main`** |
| **Root Directory** | **(vacío)** |
| Runtime | Node |
| Build Command | `npm install && npm run build` |
| Start Command | `node server.js` |
| Health Check Path | `/api/health` |
| Auto-Deploy | Off (el deploy lo dispara el CI después de `tsc` y build) |
| Disco persistente | no disponible en plan free (el `render.yaml` dice `starter` + disco; el servicio real es free y usa solo `DATABASE_URL`) |
| Env `NODE_ENV` | `production` — **obligatorio**: sin él el servidor escucha solo en `127.0.0.1` y Render no lo alcanza |
| Env `VITE_API_URL` | la URL pública del propio servicio (ej. `https://<servicio>.onrender.com`, sin `/` final) — **obligatoria en build**: sin ella el frontend compilado no arranca (`client/src/utils/envValidator.ts`) |
| `DATABASE_URL` | pooler IPv4 de Supabase (`…pooler.supabase.com:6543`), **no** `db.<ref>.supabase.co` (solo IPv6) |
| Resto de variables de entorno | las claves listadas en `render.yaml` con `sync: false`: `JWT_SECRET`, `DATABASE_URL`, `DATABASE_URL_TENANT_SCOPED`, `ENCRYPTION_KEY`, `FRONTEND_URL`, Brevo, Google, Supabase, pagos, Sentry |

## Secretos de GitHub Actions que deben coincidir

| Secreto | Debe apuntar a |
|---|---|
| `RENDER_SERVICE_ID` | el ID (`srv-…`) del servicio configurado arriba, **no** el de la app padre |
| `RENDER_API_KEY` | una API key con acceso a ese servicio |
| `SMOKE_TEST_URL` | la URL pública de ese servicio (sin `/` final) |

## Cómo confirmar que quedó bien

`GET <SMOKE_TEST_URL>/api/health` debe responder HTTP 200 con `"version":"8.0"`, que es la firma de esta app. Después de eso, un push a `main` (o *Run workflow* en *Radar Fondos 360 — CI/CD Pipeline*) debe dejar en verde los jobs CI, CD y Smoke Test.

## Opción alternativa

Si el servicio `radar360-app` debe seguir sirviendo la app padre, crear un servicio nuevo desde este `render.yaml` (Blueprint, rama `main`) y actualizar los 3 secretos anteriores con sus datos.
