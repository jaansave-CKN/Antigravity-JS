# Despliegue de RadarFondos 360 en Render — parámetros del Dashboard

**Fecha:** 2026-09-23. Para quien tenga acceso al Dashboard de Render; desde el repo no se puede leer ni cambiar la configuración de un servicio.

## Estructura real del repositorio (verificada en GitHub)

El repo `jaansave-CKN/Antigravity-JS` aloja **dos aplicaciones distintas en dos ramas**:

| Rama | Aplicación | `render.yaml` |
|---|---|---|
| `main` | **RadarFondos 360** (esta), con `server.js` en la raíz | servicio `radarfondos-360` |
| `master` | App padre "Antigravity OS" | servicio `radar-formulador-360` |

La ruta `proyectos/Proy_03_RadarFondos` **no existe** en ninguna rama remota. No se debe configurar como Root Directory: el build fallaría.

## Síntoma actual

- `https://radar360-app.onrender.com/api/health` responde con el health de la app padre ("claude", "tavily", "Upstash Redis", HTTP 503).
- El job *Smoke Test — post-deploy* de `.github/workflows/radar.yml` falla en todos los push a `main` desde el 2026-09-06. El paso de deploy solo dispara un redeploy del servicio `RENDER_SERVICE_ID`; ese servicio construye la rama que tenga configurada en Render, no necesariamente `main`.

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
| Disco persistente | montado en `/app/backend`, 1 GB (según `render.yaml`) |
| Env `NODE_ENV` | `production` — **obligatorio**: sin él el servidor escucha solo en `127.0.0.1` y Render no lo alcanza |
| Env `VITE_API_URL` | la URL pública del propio servicio (ej. `https://<servicio>.onrender.com`, sin `/` final) — **obligatoria en build**: sin ella el frontend compilado no arranca (`client/src/utils/envValidator.ts`) |
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
