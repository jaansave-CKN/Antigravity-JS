# RadFor-360 — Decisiones de Arquitectura (ADR)

Complementa `00_documento_maestro_arquitectura.md`. Registro de decisiones estructurales con su motivo — para que una decisión no se revierta por accidente sin conocer por qué se tomó.

---

### ADR-01 — Claude/Anthropic como único motor de IA de producción
**Decisión:** todo el function-calling real (Radar, Chat, Ficha Técnica) corre sobre Claude, no sobre Groq/Gemini/OpenRouter.
**Por qué:** versiones previas de `AGENTS.md` declararon Groq y luego Gemini/Minimax vía OpenRouter como motor principal — ninguno llegó a integrarse en el pipeline real. Groq/Gemini quedaron en `.env` únicamente para la extensión IDE `.kilo` local, sin código que los invoque desde la app. OpenRouter queda como fallback construido pero sin consumidor en UI — decisión consciente de no invertir en una UI para un fallback sin tráfico que lo justifique.
**Revertir si:** Anthropic sube de precio o cambia límites de forma que el fallback deje de ser opcional.

### ADR-02 — Supabase vía REST/PostgREST, no conexión `pg` directa
**Decisión:** `DATABASE_URL` se deja vacío a propósito; toda escritura/lectura de Formulador pasa por `supabaseClient.js` (fetch a `/rest/v1/*` y `/rest/v1/rpc/*`).
**Por qué:** evita mantener un pool de conexiones persistente desde un proceso Node en un plan gratuito de Render con reinicios frecuentes; PostgREST ya resuelve el problema de conexión. `pgClient.js` (código muerto que sí abría un pool directo) fue eliminado el 2026-08-06 tras confirmar cero imports.
**Trade-off aceptado:** cada RPC es su propia transacción — `set_tenant_context()` no persiste entre llamadas REST sueltas, así que cada función que necesita contexto de tenant debe fijarlo ella misma al inicio (patrón replicado en las 5 funciones RPC existentes).

### ADR-03 — Aislamiento multi-tenant por filtro explícito, no solo RLS-por-rol
**Decisión:** cada RPC de Formulador incluye `WHERE tenant_id = p_tenant_id` explícito en el SQL, además de la política RLS.
**Por qué:** el `Authorization: Bearer` que llega a Supabase es siempre un ID token de Firebase, nunca un JWT de Supabase Auth — PostgREST solo reconocería el rol `authenticated` (activando RLS-por-rol) si el proyecto tuviera Firebase configurado como Third-Party Auth en el dashboard, algo que hoy no está configurado (confirmado: intento real devuelve `401 PGRST301`). El sistema se degrada automáticamente a `SERVICE_KEY` (bypasea RLS), por lo que el filtro explícito en cada RPC es la defensa real, no la de respaldo.
**Verificado:** prueba cruzada de 2 tenants reales (2026-08-06) — tenant B intentando leer un proyecto de tenant A recibe `404`, confirmando que el aislamiento funciona en la práctica, no solo en el código.
**Revertir si:** se configura Third-Party Auth Firebase↔Supabase — en ese momento RLS-por-rol se activaría como segunda capa real, sin tocar el código existente.

### ADR-04 — JWT propio como capa complementaria a Firebase, no un reemplazo
**Decisión:** `session-manager.js` emite un JWT propio (`JWT_SECRET`, HS256, 24h) además del ID token de Firebase.
**Por qué:** el gate universal de autorización siempre exige Firebase; el JWT propio existe para (a) revocación de sesión sin depender de Firebase Admin, (b) cuota diaria (`checkQuota`) y anti-flood (`activeQueries`) atados a un `sessionId` propio. Ningún endpoint de negocio lo exige por sí solo — Firebase es la única puerta real.

### ADR-05 — Cache/sesiones en Upstash Redis con fallback a memoria, nunca al revés
**Decisión:** `cache.js` intenta Redis primero, cae a `Map` en memoria si las credenciales no están configuradas — el código nunca asume que Redis está disponible.
**Por qué:** el tier gratuito de Render recicla el proceso; sin Redis, sesiones y cache de IA morían en cada reinicio. Con Redis activo (confirmado hoy: `cacheInfo().backend === 'Upstash Redis'`), sesiones sobreviven a reinicios sin tocar ningún call-site — el fallback fue diseñado desde el inicio para ser intercambiable.

### ADR-06 — El WebSocket "Live" no dispara IA por conexión de cliente
**Decisión (2026-08-06, Oleada 2):** un único cron de baja frecuencia (`RADAR_CRON_HOURS`, default 6h) alimenta a **todos** los clientes conectados; el pipeline no se ejecuta si no hay clientes conectados.
**Por qué:** cada corrida de `m1Pipeline.js` cuesta una llamada real a Claude+Tavily. Un pipeline por-cliente-conectado escalaría el costo linealmente con usuarios simultáneos sin ningún beneficio — un cron compartido sirve a N usuarios al mismo costo que a 1.
**Anterior a esto:** el WS emitía actualizaciones simuladas cada 30s sobre el seed estático, marcadas `_simulado:true` — simulación declarada en el propio código, nunca oculta al usuario final vía logs/health check.

### ADR-07 — `orchestrator-engine.js` corre server-side, no en el navegador
**Decisión (2026-08-06, Oleada 1):** el motor de agentes (AGT-052/053/054/056) se invoca desde `POST /api/formulador/ficha-tecnica`, no desde un `<script type="module">` en el navegador.
**Por qué:** la versión anterior importaba el motor directamente desde `public/app.js` con una ruta relativa a `src/` — funcionaba en `npm run dev` (Vite resuelve rutas fuera de `root`) pero daba 404 real en producción (`dist/` servido por Express no expone `/src/*`). Moverlo al backend elimina esa clase de bug por diseño, y además resuelve el problema de autenticación de `callAI()` hacia `/api/chat` (que exige Firebase Bearer) reenviando el JWT del request original en vez de tener que replicar el SDK de Firebase en una página HTML estática.

### ADR-08 — Sin librería de esquemas hasta el 2026-08-06; `zod` desde entonces
**Decisión:** validación de entrada centralizada en `src/shared/infrastructure/validation.js`, aplicada como middleware Express (`validateBody(schema)`).
**Por qué:** el patrón anterior (checks manuales de 1-2 campos por endpoint) era inconsistente y dejaba pasar bodies malformados hasta el primer `undefined.property` en producción (500 en vez de 400). `zod` se eligió por estar ya presente como dependencia transitiva (sin peso nuevo real) y no requerir compilación de esquemas.

### ADR-09 — Rate limiting en dos capas, ambas en memoria, ninguna de infraestructura
**Decisión:** `checkQuota` (50/día por `uid`, endpoints de IA) + `checkBurst` (20/10s por `uid`/IP, todo `/api/*`) — ninguno usa Redis ni un WAF externo.
**Por qué:** el tráfico real actual no justifica el costo recurrente de un WAF/Cloudflare; ambos límites siguen el mismo patrón barato ya usado por `activeQueries` (Map en memoria, documentado como intercambiable a Redis sin tocar los call-sites si el volumen lo justifica más adelante).

### ADR-10 — Backends paralelos sin camino a producción: eliminados, no mantenidos "por si acaso"
**Decisión (2026-08-06, Oleada 6):** `backend_fastapi.py` y `server-sim.js` se eliminaron del repo, no se dejaron como referencia.
**Por qué:** ninguno estaba referenciado por `render.yaml`; mantenerlos vivos en el árbol es exactamente la clase de ambigüedad que causó que el servicio de Render sirviera el código equivocado (mix-up con Proy_03_RadarFondos, incidente resuelto el mismo día). Código sin camino a producción y sin consumidor se elimina, no se documenta como "legacy" indefinidamente.
