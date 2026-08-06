# RadFor-360 — Auditoría de Vacíos (Fase 3, Grupo Elite)

**Origen:** deriva 1:1 de la matriz de diagnóstico de `docs/RADIOGRAFIA_FORENSE_360_2026-08-06.md` §7 (36 filas). Este documento toma únicamente las filas 🟠 INCOMPLETO y 🔴 AUSENTE que representan una brecha real a cerrar (excluye las eliminaciones deliberadas como Trello/MongoDB, que ya están resueltas por decisión previa del usuario).

**Método:** 001_ARQUITECTO_CORE analiza cada vacío y propone resolución. Por protocolo (`docs/ESTADO.md` aún no existe → arquitectura no cerrada), **ningún vacío se cierra por omisión** — cada uno termina en `RESUELTO` (decisión técnica sin ambigüedad de producto, tomada aquí) o `DECISIÓN DEL USUARIO REQUERIDA` (impacta alcance, costo recurrente, o identidad de producto — no se fabrica).

**Restricción no negociable para todo este plan:** mantener intacto el diseño gráfico e identidad visual actual de RadFor-360 — paleta oscura (`#0b1326`/`#131b2e`/`#c9a227` dorado de marca), tipografía Hanken Grotesk, estructura `Sidebar.jsx`/`Layout.jsx`, iconografía `lucide-react`. Todo lo nuevo reutiliza ese sistema, no lo reemplaza.

---

## Grupo A — Higiene y seguridad (sin ambigüedad de producto)

### A1. Divergencia de secretos entre `.env` y `claves_privadas.txt`
**Análisis:** `GITHUB_TOKEN` y la clave secreta de Supabase difieren entre ambos archivos — rotación pasada sin sincronizar. Riesgo: usar la copia equivocada, o dejar una credencial huérfana viva sin saber si sigue activa.
**Decisión:** `RESUELTO` — consolidar en `.env` como única fuente activa; antes de tocar código, generar un inventario de qué credencial de cada par sigue siendo válida (probándola contra su API, no asumiendo) y revocar la huérfana. Sincronizar `BREVO_API_KEY` (existe completa en `claves_privadas.txt`, vacía en `.env`) para destrabar Comunicaciones (Grupo D).

### A2. `public/estado_antigravity.json` desactualizado y cosmético
**Análisis:** `scripts/generar_reporte.cjs` lista carpetas de `agents/` sin validar nada — reporta agentes eliminados como `"READY 24/7"`.
**Decisión:** `RESUELTO` — el generador deja de fabricar un status uniforme; reporta presencia real de `IDENTITY.md` + al menos un archivo `.cjs` no vacío por carpeta como criterio mínimo verificable, y el campo se renombra de `status` a algo que no implique salud operativa (ej. `"definido"` en vez de `"READY 24/7"`). Se ejecuta una vez al aplicar el fix para refrescar el archivo.

### A3. Validación de esquema (zod/joi) ausente
**Análisis:** patrón de checks manuales inconsistente en todo el árbol; el endpoint más débil es `POST /api/communications/email`.
**Decisión:** `RESUELTO` — introducir `zod` (ligero, ESM-friendly, cero configuración) y validar el body de cada endpoint `POST`/`DELETE` bajo `/api/*`, empezando por los que hoy solo comprueban 1-2 campos a mano.

### A4. Rate limiting a nivel de aplicación, no solo cuota diaria
**Análisis:** `checkQuota()` ya cubre abuso por volumen/día; falta un límite de ráfaga corto (ej. 429 si el mismo `uid`/IP dispara >N requests en pocos segundos), barato de agregar sin infraestructura nueva.
**Decisión:** `RESUELTO` — middleware in-memory tipo *token bucket* por `uid` (o IP si es anónimo) sobre el mismo patrón ya usado en `session-manager.js`, sin dependencias nuevas. Rate limiting de infraestructura (WAF/Cloudflare) queda fuera de alcance — costo recurrente, ya descartado por el usuario en la auditoría de la mañana bajo criterio de economía.

### A5. Backends paralelos sin destino (`backend_fastapi.py`, `server-sim.js`)
**Análisis:** ninguno tiene camino a producción; `backend_fastapi.py` además tiene CORS abierto. Mantenerlos sin etiqueta clara es la clase de ambigüedad que ya causó el mix-up de repos de esta mañana.
**Decisión:** `RESUELTO` (Pregunta 4, 2026-08-06: "Eliminar los backends paralelos, dejar agents/ como está") — eliminar `backend_fastapi.py` y `server-sim.js`, y las entradas de `package.json` que los invocan (`fastapi`, `server`, `sim`, `start:full`, `start:sim`).

---

## Grupo B — Pantallas "Frozen" (Módulo A y B)

### B1. Módulo A — Panel, Directorio, Favoritos, Calendario
**Análisis:** hoy son `FrozenPage.jsx` genérico. Cada una requiere: (a) definir qué dato real muestra — `Panel` es candidato natural a métricas agregadas de `radarData`/Formulador; `Directorio` a un listado navegable de convocatorias históricas; `Favoritos` requiere una entidad nueva (marcar/guardar convocatoria por usuario — no existe hoy en ningún esquema); `Calendario` depende de `Favoritos` (vencimientos de lo guardado). No son 4 pantallas del mismo tamaño: `Panel`/`Directorio` son vistas sobre datos que ya existen; `Favoritos`/`Calendario` requieren modelo de datos nuevo (tabla `favoritos` con `tenant_id`+`uid`, RLS igual que Formulador).
**Decisión:** `RESUELTO` (Pregunta 1, 2026-08-06: "Formulador primero") — Módulo A (Panel/Directorio/Favoritos/Calendario) queda pospuesto a una oleada posterior; no se construye en esta ronda.

### B2. Módulo B — Módulo 10, Anexos, Logística, Dialéctica, Ficha Técnica
**Análisis:** son la continuación natural del Formulador (que hoy solo cubre Fase 1 / módulos 7-9, real y verificado). `Ficha Técnica` es previsiblemente el documento de salida consolidado (candidato a reusar `orchestrator-engine.js`, que ya genera componentes administrativo/operativo/riesgos vía `AGT-052/053/054/056` pero **hoy no está conectado a ningún endpoint ni pantalla** — es motor real sin consumidor, hallazgo nuevo no listado explícitamente en la radiografía por estar en `src/orchestrator-engine.js` corriendo solo en el navegador sin wiring). `Anexos`/`Logística`/`Dialéctica`/`Módulo 10` no tienen aún definición de qué campos MGA cubren — requiere el mismo nivel de detalle que tuvo Fase 1 (`schema.js`) antes de poder migrarlos.
**Decisión:** `RESUELTO` (Pregunta 1, 2026-08-06: "Formulador primero") — orden de construcción dentro de Módulo B: **Ficha Técnica** (Oleada 1, conecta `orchestrator-engine.js` ya construido) → **Módulo 10** → **Anexos** → **Logística** → **Dialéctica**, en ese orden porque Ficha Técnica no depende de los otros cuatro y ya tiene motor real; los cuatro restantes se detallan en Oleada 3 (§`01_propuesta_integral.md`) uno por uno, con su propio schema MGA, antes de construirlos — no se fabrica su alcance aquí.

### B3. Feed "Live" del WebSocket de Radar — sigue simulado
**Análisis:** ya está honestamente marcado `_simulado:true` en el código; el propio informe de la mañana recomendó conectar a `m1Pipeline.js` vía cron de baja frecuencia (6-12h) en vez de por-cliente, para no disparar costo de Claude/Tavily por cada conexión.
**Decisión:** `RESUELTO` — implementar exactamente esa recomendación (cron único de baja frecuencia, ya aprobada en criterio de economía previo), reemplazando el `setInterval` que hoy solo aleatoriza el seed.

---

## Grupo C — RBAC y panel de administración

### C1. RBAC por rol incompleto
**Análisis:** el campo `role==='admin'` ya existe (JWT propio + custom claim de Firebase) pero solo lo lee `revokeSession`.
**Decisión:** `RESUELTO` — crear un middleware `requireAdmin` reutilizable (mismo patrón que `verifyFirebaseAuth`) que lea `req.user`/rol de sesión, listo para usarse en cualquier endpoint admin nuevo. No se aplica a endpoints existentes de negocio (Radar/Formulador) porque ninguno lo necesita hoy — evita RBAC especulativo.

### C2. Panel `/admin`
**Análisis:** hoy no hay ninguna superficie donde el rol `admin` recién asignado tenga efecto visible. Alcance mínimo viable: una pantalla en el mismo Sidebar (sección nueva, visible solo si `user.role==='admin'`) que lea `audit_logs` (ya expuesto por `firestore.rules` al dueño) y `estado_antigravity.json` corregido (A2). Alcance mayor: gestión de usuarios/tenants — no existe ese concepto de "organización" en el esquema hoy (confirmado en la radiografía §5, "SaaS de alto nivel").
**Decisión:** `RESUELTO` (Pregunta 2, 2026-08-06: "Mínimo viable") — panel `/admin` con dos vistas: `audit_logs` (lectura, reutiliza `firestore.rules` ya vigente) y FinOps agregado (ver D1). Sin gestión de usuarios/tenants — no existe el concepto de "organización" hoy y no se fabrica en esta ronda.

---

## Grupo D — FinOps y telemetría

### D1. FinOps — dashboard/alertas de costo
**Análisis:** `AuditLogger` ya guarda tokens por evento (Firestore `audit_logs`) — falta solo agregación, no captura. Construir un endpoint `GET /api/admin/finops` que sume `data.tokens` por día/usuario desde Firestore es barato (reutiliza dato ya guardado) y se muestra en el mismo panel `/admin` de C2 — no requiere Langfuse/Helicone (costo recurrente de terceros, evitable).
**Decisión:** `RESUELTO` — se construye junto con C2 (panel `/admin` mínimo viable ya autorizado).

### D2. Telemetría de errores/producto (Sentry/PostHog/GA)
**Análisis:** herramienta de terceros con costo recurrente (aunque tenga tier gratuito, implica una cuenta nueva y superficie de configuración). No hay evidencia de que el volumen de tráfico actual lo justifique (mismo argumento que descartó WAF/Cloudflare en la auditoría de la mañana).
**Decisión:** `RESUELTO` (Pregunta 3, 2026-08-06: "Posponer ambas") — no se implementa en esta ronda.

---

## Grupo E — Monetización

### E1. Pasarela de pago y modelo de suscripción
**Análisis:** no existe ninguna pieza construida — SDK, esquema de datos (`users`/`subscriptions`/`plans`), ni webhook. Es la decisión de mayor impacto de todo este plan: define si "tenant" sigue siendo 1:1 con usuario individual (como hoy en Formulador) o si hace falta introducir "organización" antes de cobrar por asiento/equipo. Construir esto sin la decisión de negocio de qué se cobra (¿por proyecto formulado? ¿suscripción mensual? ¿por búsqueda de Radar?) sería fabricar producto, no arquitectura.
**Decisión:** `RESUELTO` (Pregunta 3, 2026-08-06: "Posponer ambas") — no se implementa en esta ronda; queda documentado para retomar cuando haya base de usuarios que lo justifique.

---

## Grupo F — `agents/` como andamiaje vs. runtime

### F1. La carpeta `agents/` no es un runtime; el dashboard la presenta como si lo fuera
**Análisis:** ya resuelto en parte por A2 (el dashboard deja de mentir). Queda la pregunta de fondo: ¿el usuario quiere que "el grupo élite" siga siendo, como hoy, un protocolo de disciplina que Claude ejecuta directamente (este mismo skill) — o quiere invertir en que `agents/000_Orquestador.cjs`/`bridge-server.cjs` corran como proceso real que dirige sub-agentes de forma autónoma? Son dos arquitecturas distintas con costo de ingeniería muy distinto.
**Decisión:** `RESUELTO` (Pregunta 4, 2026-08-06: "dejar agents/ como está") — sigue siendo protocolo de disciplina (este skill), no runtime. No se construye `bridge-server.cjs`/`000_Orquestador.cjs` como proceso productivo.

---

## Estado final — Fase 5 alcanzada

**Los 4 grupos de decisión quedaron resueltos el 2026-08-06.** Ningún vacío de este documento permanece en estado "pendiente silencioso" — cada uno tiene una decisión escrita, tomada por el arquitecto (higiene/seguridad, sin ambigüedad de producto) o autorizada explícitamente por el usuario (alcance/prioridad/inversión). Arquitectura cerrada — ver `docs/ESTADO.md`.

---

## Resumen — vacíos resueltos vs. pendientes de decisión

| Grupo | Ítems resueltos por el arquitecto | Ítems que requieren decisión del usuario |
|---|---|---|
| A — Higiene/seguridad | A1, A2, A3, A4 | A5 (destino backends paralelos → Pregunta 4) |
| B — Pantallas Frozen | B3 (feed live → cron) | B1, B2 (orden/alcance → Pregunta 1) |
| C — RBAC/Admin | C1 (middleware) | C2 (construir panel → Pregunta 2) |
| D — FinOps/Telemetría | D1 (condicionado a C2) | D2 (Sentry/PostHog → Pregunta 3) |
| E — Monetización | — | E1 (pasarela/modelo → Pregunta 3) |
| F — `agents/` runtime | — | F1 (invertir en runtime real → Pregunta 4) |

Ningún ítem queda en estado "pendiente silencioso" — los 4 grupos de decisión se consolidan en las 4 preguntas que el arquitecto eleva al usuario en el mensaje de chat que acompaña este documento.
