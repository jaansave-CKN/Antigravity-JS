# ADR-0003 — Proveedores de IA en producción: solo API de pago con términos comerciales

- **Estado:** Aceptado (2026-10-04)
- **Decisor:** Jairo Antonio Salinas Velasco (directiva de cierre de la Acción 1, Opción A)
- **Alcance:** runtime de RadFor-360 en producción (`server.js`, `src/modules/radar/m1Pipeline.js`, `src/orchestrator-engine.js`), `render.yaml`, `agents/gate-proveedor.cjs`.

## 1. Contexto

1. El 2026-10-04 el gate de arquitectura se desbloqueó con una cadena de modelos del catálogo gratuito de NVIDIA NIM (ADR-0002 §2.1). La directiva siguiente propuso migrar también el M1 y el AGT-052 a esa cadena para operar a costo cero.
2. La documentación oficial de NVIDIA lo impide para producción (docs.api.nvidia.com/nim/docs/product, consultada el 2026-10-04): *"You will be enrolled in the NVIDIA Developer program to access NIM for development and testing, but to take it to production you will need an NVIDIA AI Enterprise License."* RadFor-360 es un SaaS con monetización prevista.
3. La cuenta de Anthropic reporta saldo agotado (`credit balance is too low`, registrado el 2026-09-25 y el 2026-10-04): en producción el M1 responde 500 (con registro en la DLQ) y el AGT-052 cae a su plantilla.

## 2. Decisión (Opción A)

- **Producción usa solo proveedores de pago con términos comerciales.** Hoy: Anthropic `claude-sonnet-4-6` (fijado en `render.yaml` como `PRIMARY_AI_MODEL`) para el M1 y el AGT-052, y Tavily para búsqueda. Cualquier otro proveedor (OpenAI, DeepSeek API) entra solo con un nuevo veredicto de `002`.
- **NIM gratuito queda restringido a desarrollo y pruebas** (el gate de arquitectura). La regla está forzada en código: `resolverConfig()` en `agents/gate-proveedor.cjs` rechaza NIM con `NODE_ENV=production` (código `nim_prohibido_en_produccion`, bloqueo duro), también como eslabón de `GATE_FALLBACK_CHAIN`. Prueba: `tests/gate/gate-proveedor.test.cjs` («ADR-0003…»).
- `NVIDIA_API_KEY` no se declara en `render.yaml`.
- Revisión de la decisión: solo si se obtiene licencia NVIDIA AI Enterprise (existe evaluación gratuita de 90 días) o cambian los términos publicados.

## 3. Costo medido (simulación determinística sobre el código vigente, TRM 3.273,49)

| Concepto | COP |
|---|---|
| Ciclo completo (M1: 3 llamadas a Claude + 2 búsquedas Tavily; AGT-052: 1 llamada) | 291,92 |
| 1.000 ciclos al mes | 291.920 |
| Radar Cron (máximo 1 corrida pagada al día por la caché de 24 h) | ≈ 8.887 al mes |

## 4. Checklist de salida a producción (READY FOR PRODUCTION)

El estado RFP se certifica solo cuando **todos** los puntos tienen evidencia física. Al 2026-10-04 el código está listo (241+ pruebas en verde, commits en `origin/master`); los puntos 1 a 5 dependen de acciones fuera del repositorio.

| # | Requisito | Responsable | Evidencia esperada |
|---|---|---|---|
| 1 | Recargar el saldo de la cuenta de Anthropic | Dueño (facturación) | `/api/health` → `services.claude: "✅ operativo (ping real)"` |
| 2 | Crear o vincular el servicio de Render desde `render.yaml` (Blueprint) con rama `master` | Dueño (panel de Render) | Servicio `radar-formulador-360` desplegando el commit de `origin/master` |
| 3 | Cargar los valores de las variables `sync: false` de `render.yaml` | Dueño (panel de Render) | Despliegue sin errores de arranque |
| 4 | `/api/health` en verde | Verificación | `HTTP 200` y `"status": "healthy"` (este servidor no emite `"status": "ok"`) |
| 5 | DLQ operativa en Upstash | Verificación | `LLEN dlq:cuarentena` responde; registros con `huella_sha256` y PII enmascarada |

Comandos de verificación (con la URL real del servicio):

```bash
curl -s -w "\nHTTP %{http_code}\n" https://<URL>/api/health
curl -s "$UPSTASH_REDIS_REST_URL/llen/dlq:cuarentena"      -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
curl -s "$UPSTASH_REDIS_REST_URL/lrange/dlq:cuarentena/0/9" -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

## 5. Consecuencias

- Producción tiene costo variable en COP (tabla §3) y depende del saldo de Anthropic; el health check lo detecta (`🔴 saldo de cuenta agotado`, HTTP 503).
- Mientras el saldo no se recargue, un despliegue nuevo puede fallar el health check de Render y dejar corriendo la versión anterior.
- El gate de desarrollo conserva su costo cero sobre NIM (ADR-0002).
