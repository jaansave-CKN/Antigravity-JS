# RadFor-360 — Plan de Construcción por Oleadas (Fase 4, Grupo Elite)

**Deriva de:** `docs/analisis_gaps_v1.md` (Fase 3). **Regla dura:** no se empieza una oleada sin haber validado la anterior — cada oleada cierra con `node --check` (backend) y `npm run build` (frontend) reales, no solo lectura, siguiendo el mismo estándar de verificación que `docs/RADFOR360_IMPLEMENTACION_2026-08-06.md`.

**MVP de este plan de remediación — qué incluye y qué NO, a propósito:**
- Incluye: cerrar todos los vacíos `RESUELTO` de la Fase 3 (Grupo A + B3 + C1), y lo que resulte autorizado de las 4 preguntas abiertas.
- NO incluye a propósito: rate limiting de infraestructura (WAF/Cloudflare), Langfuse/Helicone, módulo de "organización/equipos" multi-tenant — los tres ya fueron descartados hoy bajo el criterio de economía-primero que el propio usuario validó en la sesión de la mañana, y nada en esta conversación lo revierte.

---

## Oleada 0 — Higiene y seguridad (cero decisiones de producto pendientes)

Orden interno por dependencia: A1 primero (destraba Comunicaciones y evita construir sobre una credencial que podría estar revocada), luego A2/A3/A4 en paralelo (no se tocan entre sí).

1. **A1** — Auditar y consolidar secretos divergentes `.env` vs `claves_privadas.txt`; sincronizar `BREVO_API_KEY`.
2. **A2** — `scripts/generar_reporte.cjs`: dejar de fabricar `"READY 24/7"` uniforme; validar presencia real de `IDENTITY.md` + skill no vacío.
3. **A3** — Introducir `zod`; validar body de los endpoints `POST`/`DELETE` más débiles primero (`/api/communications/email`).
4. **A4** — Middleware de rate limiting por ráfaga (in-memory, mismo patrón que `checkQuota`).

**Validación de cierre de oleada:** `node --check` sobre cada archivo tocado; `npm run build`; smoke-test manual de `/api/health` y de un POST inválido contra un endpoint con `zod` (debe responder 400, no 500).

---

## Oleada 1 — Motor de Ficha Técnica (conectar lo ya construido)

`src/orchestrator-engine.js` (AGT-052/053/054/056) existe, es real, y no tiene consumidor — es el ítem de mayor retorno por esfuerzo de todo el plan porque no requiere diseño nuevo, solo wiring:

1. Endpoint backend `POST /api/formulador/ficha-tecnica` que invoque `Orchestrator000.validarDiseno()` → `run()` sobre los datos ya guardados de Fase 1 (Supabase).
2. Pantalla `Ficha Técnica` (hoy `FrozenPage`) reemplazada por una vista real que dispara ese endpoint y renderiza `borrador`/`evaluation` — reutilizando el mismo sistema visual oscuro/dorado del resto del Sidebar, sin rediseñar.

**Nota:** esta oleada arranca ya bajo el criterio "B2 — Ficha Técnica primero" propuesto en la Fase 3; se ejecuta independientemente de cómo se responda la Pregunta 1 sobre el resto de pantallas, porque es autocontenida y de alto valor.

---

## Oleada 2 — Feed "Live" real de Radar (B3)

1. Reemplazar el `setInterval` simulado de `server.js` por un cron de baja frecuencia (6-12h, configurable) que invoque `m1Pipeline.js` una sola vez para todo el sistema y difunda el resultado a todos los WS conectados — reutiliza el cache dual de 24h ya existente.
2. Quitar la marca `_simulado:true` del payload una vez el dato sea real; mantener el badge "LIVE" del Sidebar sin cambios visuales.

---

## Oleadas 3+ — autorizadas 2026-08-06 (Preguntas 1-4 respondidas)

### Oleada 3 — Módulo B: Módulo 10 → Anexos → Logística → Dialéctica
Formulador primero (Pregunta 1). Cada pantalla requiere, antes de codificar, el mismo nivel de detalle de campos MGA que ya tuvo Fase 1 (`public/src/modules/formulador/schema.js`) — se define schema por schema, una pantalla a la vez, no las 4 de un salto. Módulo A (Panel/Directorio/Favoritos/Calendario) queda pospuesto, sin fecha, fuera de esta ronda.

### Oleada 4 — Panel `/admin` mínimo viable + FinOps agregado
Autorizado con alcance mínimo (Pregunta 2): nueva sección en `Sidebar.jsx` visible solo si `user.role==='admin'` (reutiliza el mismo sistema visual, sin rediseñar), con dos vistas — `audit_logs` (lectura vía Firestore, mismo perímetro ya definido en `firestore.rules`) y `GET /api/admin/finops` (agregación de tokens por día/usuario desde la colección `audit_logs`, protegido por el middleware `requireAdmin` de C1). Sin gestión de usuarios/tenants.

### Oleada 5 — Monetización y telemetría de producto: pospuestas
Pregunta 3 respondida "posponer ambas" — no hay trabajo de esta oleada en la ronda actual. Se retoma cuando exista base de usuarios que lo justifique; no se fabrica alcance especulativo mientras tanto.

### Oleada 6 — Limpieza de legacy sin destino
Pregunta 4 respondida "eliminar backends paralelos, dejar agents/ como está": eliminar `backend_fastapi.py`, `server-sim.js`, y los scripts `fastapi`/`server`/`sim`/`start:full`/`start:sim` de `package.json`. `agents/` no se toca como runtime — sigue siendo protocolo de disciplina (este mismo skill), no proceso productivo.

---

## Regla de cierre de todo el plan

Al terminar cada oleada, `docs/ESTADO.md` (creado en el momento de la autorización, Fase 5) se actualiza marcando `[x]` solo lo que tiene ruta de backend funcionando **y** pantalla conectada a datos reales — no basta con que el código exista. Antes de anunciar cualquier oleada como "lista", se repite la Fase 6 (Verificación de Cierre) sobre esa oleada específica, releyendo el código, no la aspiración.
