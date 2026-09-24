# Handoff Lote 6: acciones manuales para el Architect

**Proyecto:** RadarFondos 360 · **Repo:** `jaansave-CKN/Antigravity-JS` (público) · **Servicio Render:** `radar360-app` (`srv-d89pvbb7uimc739q7vtg`) · **Fecha:** 2026-09-24

Estas 5 acciones no las puede ejecutar el agente, porque requieren tus cuentas: AWS, Wompi, Google Cloud, Render y la administración de GitHub. Cada una indica qué hacer y cómo verificar que quedó bien.

> Ningún valor secreto aparece en este archivo, que es público. Reemplaza los `<MARCADORES>` con tus datos.

---

## 1. Desbloquear el respaldo S3 (AWS/IAM)

**Estado actual:**
- El workflow `.github/workflows/backup-s3.yml` sale en **ROJO cada 6 horas** porque faltan las credenciales. Es intencional (Lote 5): hoy no se respalda nada.
- El cron interno de Render se eliminó en el Lote 6. GitHub Actions es el único responsable del respaldo.

**Pasos:**

1. Crea un bucket privado y actívale el versionado. En la consola S3: *Create bucket* → región `us-east-1` → deja activado *Block all public access*.
   ```bash
   aws s3api create-bucket --bucket <NOMBRE_DEL_BUCKET> --region us-east-1
   aws s3api put-public-access-block --bucket <NOMBRE_DEL_BUCKET> \
     --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   aws s3api put-bucket-versioning --bucket <NOMBRE_DEL_BUCKET> --versioning-configuration Status=Enabled
   ```
2. Configura la retención de 30 días (lifecycle) para los respaldos:
   ```bash
   aws s3api put-bucket-lifecycle-configuration --bucket <NOMBRE_DEL_BUCKET> --lifecycle-configuration \
     '{"Rules":[{"ID":"retencion-30d","Status":"Enabled","Filter":{"Prefix":"backups/"},"Expiration":{"Days":30},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'
   ```
3. Crea un usuario IAM exclusivo con la política del repo. En `docs/infra/iam-politica-backup-s3.json`, reemplaza `NOMBRE_DEL_BUCKET`. La política solo permite `PutObject` bajo `backups/`, exige cifrado AES256 y exige HTTPS.
   ```bash
   aws iam create-user --user-name radarfondos-backup
   aws iam put-user-policy --user-name radarfondos-backup --policy-name backup-s3 \
     --policy-document file://docs/infra/iam-politica-backup-s3.json
   aws iam create-access-key --user-name radarfondos-backup   # guarda AccessKeyId y SecretAccessKey
   ```
4. Carga los 4 secretos en GitHub:
   ```bash
   gh secret set AWS_ACCESS_KEY_ID     --repo jaansave-CKN/Antigravity-JS   # pega el AccessKeyId
   gh secret set AWS_SECRET_ACCESS_KEY --repo jaansave-CKN/Antigravity-JS   # pega el SecretAccessKey
   gh secret set AWS_S3_BUCKET         --repo jaansave-CKN/Antigravity-JS --body "<NOMBRE_DEL_BUCKET>"
   gh secret set AWS_REGION            --repo jaansave-CKN/Antigravity-JS --body "us-east-1"
   ```
5. **Verifica:**
   ```bash
   gh workflow run backup-s3.yml --repo jaansave-CKN/Antigravity-JS
   gh run watch --repo jaansave-CKN/Antigravity-JS "$(gh run list --repo jaansave-CKN/Antigravity-JS --workflow backup-s3.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   aws s3 ls s3://<NOMBRE_DEL_BUCKET>/backups/postgres/
   ```
   **Resultado esperado:** el job "Backup S3 (real)" en **verde**. El log debe mostrar `✓ Backup subido y verificado: s3://…/radar_<fecha>.sql.gz` con `filas_usuarios` mayor que 0, y el archivo `.sql.gz` debe aparecer en el bucket. El script ya verifica que el ETag sea igual al MD5.

**Restauración de prueba (recomendada una vez):**
- Descarga el `.sql.gz`, crea el rol `rf360_rls_scoped` y las extensiones `vector` y `unaccent` en `public`, y luego aplica el `.sql`. Es el mismo orden que usa `playwright.yml`.
- Los archivos de Storage (anexos y biblioteca) **no** están en este respaldo.

---

## 2. Llaves de Wompi y Gemini

### 2a. Wompi: activar los cobros
**Estado actual:** no existe ninguna llave de Wompi, y el checkout responde 503 "sistema de pagos no disponible". Los precios en COP ya están definidos: Radar 149.000, Formulador 399.000 y Suite 499.000.

1. Abre la cuenta de comercio en <https://comercios.wompi.co>. Requiere el RUT y los datos bancarios de la empresa.
2. En *Desarrolladores → Llaves*, copia las 4 llaves de **producción**:
   - `WOMPI_PUBLIC_KEY` (`pub_prod_…`)
   - `WOMPI_PRIVATE_KEY` (`prv_prod_…`)
   - `WOMPI_EVENTS_SECRET` (secreto de eventos)
   - `WOMPI_INTEGRITY_SECRET` (secreto de integridad)
3. En *Desarrolladores → Eventos*, configura la URL del webhook: `https://<TU_DOMINIO>/api/wompi/webhook`. Mientras no tengas dominio, usa `https://radar360-app.onrender.com/api/wompi/webhook`.
4. Carga las variables en Render. Hazlo desde el Dashboard (servicio `radar360-app` → *Environment*) o por API:
   ```bash
   export RENDER_API_KEY=<tu llave rnd_…>   # NO la pegues en archivos del repo
   for par in "PAYMENT_PROVIDER=wompi" "WOMPI_PUBLIC_KEY=<pub_prod_…>" "WOMPI_PRIVATE_KEY=<prv_prod_…>" \
              "WOMPI_EVENTS_SECRET=<…>" "WOMPI_INTEGRITY_SECRET=<…>"; do
     k="${par%%=*}"; v="${par#*=}"
     curl -s -X PUT "https://api.render.com/v1/services/srv-d89pvbb7uimc739q7vtg/env-vars/$k" \
       -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" -d "{\"value\":\"$v\"}"
   done
   curl -s -X POST "https://api.render.com/v1/services/srv-d89pvbb7uimc739q7vtg/deploys" -H "Authorization: Bearer $RENDER_API_KEY" -d '{}'
   ```
5. **Verifica:** haz una compra con la tarjeta de prueba de Wompi, primero con llaves `pub_test_` para el ambiente sandbox, que se infiere del prefijo. El plan del usuario debe activarse después del webhook.

### 2b. Gemini: revocar la llave filtrada y dejar una llave de producción
1. **Revoca la llave filtrada en el historial público:** `AIzaSyDyOwoq8r…` (commits `86ce14d` y `ce00d74`, archivo `src/services/gemini.ts`). Está en <https://console.cloud.google.com/apis/credentials>, en el proyecto donde se creó → *Delete key*. Aunque ya no esté en el código actual, el historial es público.
2. **Cuota insuficiente para producción:** las 2 llaves actuales (`GOOGLE_API_KEY` y `GEMINI_API_KEY_2`, prefijo `AQ.`) son del **plan gratuito, con 20 solicitudes por día** para `gemini-3.6-flash` (métrica `generate_content_free_tier_requests`, verificada en vivo). Con eso, Viabilidad, MIROFISH y los demás agentes caen al respaldo en cuanto se agota la cuota.
   - Activa la facturación en <https://aistudio.google.com> → *Billing* y crea una llave nueva de pago.
   - Cárgala en Render (`GOOGLE_API_KEY`) y en tu `.env` local, y revoca las llaves gratuitas anteriores.
   - La cuota diaria gratuita se renueva a las 00:00 del Pacífico (07:00 UTC). El "retry in 34s" que devuelve Google es engañoso.
3. **Verifica:** en Viabilidad → *Evaluar viabilidad con IA*, la etiqueta debe decir `✓ gemini-3.6-flash`, no "MODO RESPALDO". Si cae al respaldo, el log de Render ahora dice el motivo exacto: `[ViabilidadAgent] Gemini no disponible → MODO RESPALDO` con `motivo`.

---

## 3. Restringir la llave pública de Firebase
**Llave:** `AIzaSyBdaIbBKl…`, que aparece en el historial del repo (`public/fase1-entrada.html`, `agents/Agente001.js`). Las llaves web de Firebase son públicas por diseño, pero sin restricción cualquiera puede usar tu cuota.

1. Ve a <https://console.cloud.google.com/apis/credentials>, en el proyecto de Firebase, y abre esa llave.
2. En *Application restrictions* elige **HTTP referrers (web sites)** y agrega:
   - `https://radar360-app.onrender.com/*`
   - `https://<TU_DOMINIO>/*`
   - `http://localhost:5173/*` (solo si desarrollas con Firebase en local)
3. En *API restrictions* elige **Restrict key** y marca solo las APIs de Firebase que uses (por ejemplo *Identity Toolkit API* y *Firebase Installations API*).
4. **Verifica:** una petición con esa llave desde un origen no listado debe responder `403 API_KEY_HTTP_REFERRER_BLOCKED`.

---

## 4. Plan de Render y dominio propio
**Estado real, verificado por la API de Render:** `radar360-app` está en plan **free**. Se duerme tras unos minutos sin tráfico y el primer visitante espera cerca de un minuto. No hay dominio propio (`custom-domains: []`).

> Aviso: `render.yaml` del repo dice `plan: starter` y `name: radarfondos-360`, pero el servicio real es `radar360-app` en plan free. Ese archivo **no gobierna** el servicio actual, que está configurado en el Dashboard y por la API. No confíes en él como fuente de verdad.

1. **Plan:** Dashboard → `radar360-app` → *Settings* → *Instance Type* → **Starter** o superior. No lo cambies por `render.yaml`.
2. **Dominio:** Dashboard → `radar360-app` → *Settings* → *Custom Domains* → *Add* `app.<tu-dominio>`. En tu DNS, crea un **CNAME** `app` → `radar360-app.onrender.com`. Render emite el certificado TLS automáticamente.
3. Actualiza las variables en Render y **redespliega**, porque `VITE_API_URL` se incrusta en el build:
   - `FRONTEND_URL=https://app.<tu-dominio>`
   - `VITE_API_URL=https://app.<tu-dominio>`

   Luego ejecuta:
   ```bash
   curl -s -X POST "https://api.render.com/v1/services/srv-d89pvbb7uimc739q7vtg/deploys" -H "Authorization: Bearer $RENDER_API_KEY" -d '{}'
   gh secret set SMOKE_TEST_URL --repo jaansave-CKN/Antigravity-JS --body "https://app.<tu-dominio>"
   ```
4. Actualiza la URL del webhook de Wompi (punto 2a.3) y los *referrers* de Firebase (punto 3) al dominio nuevo.
5. **Verifica:** `curl -s https://app.<tu-dominio>/api/health` debe devolver `"status":"ok"`, y el login debe funcionar en el dominio nuevo. La cookie httpOnly depende del origen, así que prueba en ese origen exacto.

---

## 5. Protección estricta de la rama `main`
**Estado actual:** `main` está sin protección (la API responde "Branch not protected") en un repo público.

**Checks verificados en el último commit de `main`:**
- En los PR corren **`test`** (Playwright E2E) y **`react-doctor`**.
- `CI — TypeScript + Build`, `CD — Deploy a Render` y `Smoke Test — post-deploy` solo corren al hacer push a `main`. **No los exijas en los PR**, o todo PR quedaría bloqueado.

```bash
gh api -X PUT repos/jaansave-CKN/Antigravity-JS/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["test", "react-doctor"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0, "dismiss_stale_reviews": true },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```
- **`enforce_admins: true`:** a partir de aquí, ni siquiera tu cuenta puede hacer push directo a `main`. Todo entra por PR con los checks en verde, usando `gh pr merge <n> --rebase` o `--squash` para mantener el historial lineal. El despliegue de `radar.yml` sigue funcionando, porque se dispara con el push que genera la fusión.
- **Aprobaciones:** con un solo desarrollador, `required_approving_review_count: 0` exige el PR sin necesitar la aprobación de otra persona. Súbelo a 1 cuando haya un segundo revisor.
- **Verifica:**
  ```bash
  gh api repos/jaansave-CKN/Antigravity-JS/branches/main/protection --jq '.required_status_checks.contexts, .enforce_admins.enabled'
  ```
  Debe devolver `["test","react-doctor"]` y `true`. Además, `git push origin main` directo debe ser rechazado con `protected branch hook declined`.
