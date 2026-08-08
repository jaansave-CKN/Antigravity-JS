# ARQUITECTURA RADFOR-360 — Auditoría Forense de Sistema (proyecto independiente)

**Fecha:** 2026-08-08
**Auditor:** Chief Software Auditor / DevSecOps Lead / System Architect
**Alcance:** `proyectos/Proy_03_RadarFondos/` — repo git propio, **excluido** del alcance de `Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` (ese documento lo declara explícitamente fuera: *"`proyectos/` queda fuera (repos git independientes, `.gitignore:19-24`)"*). Este documento cubre lo que aquél no cubre.
**Regla de evidencia:** cero suposiciones — cada hallazgo cita archivo real o comando ejecutado.

---

## 0. Nota de alcance — por qué este documento existe aparte

El prompt original que originó esta auditoría pedía inventariar un "ecosistema multiagente" (secciones 1-2 y 13: agentes, skills, Agente Arquitecto). Verificado en disco: **RadFor-360 no tiene ninguno de esos tres.**

- `agents/` en este proyecto contiene un único archivo: [`agents/scraper_core.py`](../agents/scraper_core.py) — un scraper de entidades del Directorio, no un framework de agentes.
- No existe `.agent/`, `skills/`, ni `ag_skills_registry.json` en este repo.
- No hay un "Agente Arquitecto" ni gate de arquitectura propio — la raíz de Antigravity JS sí tiene uno real y operativo (`.claude/agents/architect.md`, invocado por `agents/architecture-gate.cjs`, con veredicto firmado hoy 2026-08-08 07:55 en `agents/diseno_aprobado.json`), pero es exclusivo de esa raíz; no hay evidencia de que gobierne cambios en este repo.

Por eso las secciones 1, 2 y 13 del prompt original se marcan **N/A — ver documento raíz** y el peso de esta auditoría se pone en las secciones 4-12 (arquitectura real, MVP, seguridad, FinOps, telemetría, monetización), más una sección nueva (§8) sobre el único punto donde este proyecto y la raíz sí se tocan de verdad: la base de datos Supabase compartida.

---

## 1-2. Inventario de agentes / auditoría de skills — **N/A en este repo**

Ver `Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` §1-2 para el inventario real de los 4 sistemas de agentes de la raíz. Ninguno de ellos opera sobre este código.

---

## 3. Mapa de integraciones y flujos (real)

```
Frontend (React+TS+Vite, :5173 dev)
   │  fetch /api/* con Authorization: Bearer <JWT>
   ▼
Backend (Express, server.js, monolito, :8000 dev / process.env.PORT prod)
   ├─ Auth propia (jsonwebtoken, HS256) — NO Firebase, NO Supabase Auth
   ├─ Capa 1: pg.Pool directo a Postgres (Supabase) — primaria
   ├─ Capa 2: Supabase REST (fallback si Capa 1 falla) — backend/config/database.config.js
   │     restricciones reales: sin JOIN, sin agregación SQL, alias de tabla
   │     hardcodeados — todo código nuevo debe respetarlas (ver CLAUDE.md)
   ├─ Gemini (generativelanguage.googleapis.com) — geminiCircuitBreaker.js,
   │     gatea por cuota (15 RPM / 1500 RPD), degrada a heurística determinística
   ├─ Wompi/Stripe (pasarela abstraída, backend/payments/) — checkout hosteado,
   │     webhook independiente por pasarela
   └─ Brevo (email) — activo; Resend documentado pero MÓDULO INACTIVO en vivo
        hoy (confirmado en log: "[emailService] MÓDULO INACTIVO — Resend no
        configurado. Faltan credenciales en .env: RESEND_API_KEY")
```

**SPOF real:** Postgres/Supabase es punto único — Capa 2 es fallback de *transporte* (REST en vez de conexión directa), no de *proveedor*; si Supabase cae entero, no hay plan B. `GOOGLE_API_KEY` es SPOF del Co-Piloto y del árbol de objetivos IA, pero degrada con gracia (Modo Respaldo) en vez de caer — confirmado en vivo hoy: circuito abierto por cuota agotada (`[GeminiCB] Cuota agotada → circuito OPEN`, log real 2026-08-08).

**Estado (memoria en proceso, no distribuido):** `geminiCircuitBreaker.js` guarda su estado (RPM/RPD, circuito) en una instancia de clase en memoria del proceso Node — se resetea en cada `pm2 restart`. Con un solo proceso (`pm2` fork mode, no cluster) esto es consistente hoy, pero es una limitación real si algún día se escala a más de un worker.

---

## 4. Topografía de arquitectura

| Capa | Tecnología real | Evidencia |
|---|---|---|
| Frontend | React + TypeScript + Vite | `client/package.json`, puerto 5173 dev |
| Backend | Node.js + Express 5, monolito (`server.js`, ~4750+ líneas) | `server.js` |
| DB | PostgreSQL vía Supabase, pgvector (vector(768), índices HNSW) | `backend/config/database.config.js`, migraciones `013`/pgvector |
| IA | Gemini 2.0 Flash (`generativelanguage.googleapis.com`) | `geminiCircuitBreaker.js:19` |
| Auth | JWT propio (jsonwebtoken, HS256) — no Firebase/Supabase Auth | `server.js` (`authenticateToken`, `JWT_SECRET`) |
| Despliegue | Un solo servicio Render (`render.yaml`), `server.js` sirve API + build estático del frontend | `render.yaml`, confirmado 2026-08-03 en CLAUDE.md |

**Patrón:** Monolito Modular Pragmático — mismo patrón que la auditoría raíz confirmó para Antigravity JS entero (consistente entre ambos repos hermanos). No es Hexagonal ni DDD estricto: `backend/routes/*.js` mezcla HTTP + lógica de negocio + acceso a datos en el mismo archivo en la mayoría de rutas (excepción parcial: `backend/services/*.js` sí separa lógica de dominio — `CopilotoService.js`, `ValorExponencialService.js`, `EstresadoFinancieroService.js` no tocan `req`/`res` directamente).

**Acoplamiento entre capas:** medio-alto en `server.js` (rutas inline conocen SQL directo); bajo en el subsistema de pagos (`backend/payments/PaymentProvider.js` es una interfaz real que `stripeProvider.js`/`wompiProvider.js` implementan — cambiar de pasarela es cambiar `PAYMENT_PROVIDER` en `.env`, cero cambios en consumidores, verificado leyendo `backend/payments/index.js`).

---

## 5. Inventario real del MVP (real vs. mock vs. stub)

### PILAR A — Radar (`client/src/components/AppLeftNav.tsx:23`, `TopNavBar.tsx:231`)
| Ruta | Estado |
|---|---|
| `/radar`, `/panel`, `/directorio` | 🟢 Reales — datos de BD real (`convocatorias`, scraping vía `agents/scraper_core.py` + `EntityScraper.js`) |
| `/favoritos`, `/calendario` | 🟢 Reales, gateadas por `access_radar` (`requireAccess`) |

### PILAR B — Formulador (`AppLeftNav.tsx:24`, `TopNavBar.tsx:232`)
| Ruta | Estado |
|---|---|
| `/entrada`, `/checklist`, `/ficha`, `/anexos`, `/logistica`, `/dialectica`, `/viabilidad` | 🟢 Reales, gateadas por `access_formulador` |
| Co-Piloto (panel derecho, cualquier módulo B) | 🟢 Real — `CopilotoService.chatConCopiloto()`, Gemini + fallback determinístico, ampliado hoy a asesor integral (antes solo enmarcado como auditoría financiera) |

### Código huérfano detectado (hallazgo nuevo de esta sesión)
- [`client/src/components/AIChat.tsx`](../client/src/components/AIChat.tsx) — componente de chat de convocatorias/becas (Radar), llama a `/api/ia/chat`, `/api/ia/busqueda-semantica`, `/api/ia/buscar`. **No está importado en ningún lugar de la app** (verificado por grep sobre `client/src`). El endpoint `/api/ia/chat` en `server.js` sigue siendo un stub muerto (`{response:"IA no disponible en este plan."}`) — pero como nada lo consume en producción, no es una brecha funcional, es deuda de código muerto.

### Admin (`/admin`)
🟢 Real — 4 tabs (Usuarios/FinOps/Telemetría/Wompi), protegido por `AdminGuard.tsx` (redirect estricto en PROD, banner+paso en DEV) + cada endpoint `/api/admin/*` revalida rol admin server-side independientemente del guard de frontend.

---

## 6. RBAC y perímetro de seguridad

- Rol único campo `usuarios.tipousuario` (`'admin'` minúscula), reflejado en JWT como claim `role`, nunca `access_radar`/`access_formulador`/plan (esos se verifican en vivo contra BD en cada request vía `requireAccess(module)` — decisión correcta: un cambio de permiso por admin aplica en la siguiente llamada, sin esperar a que el usuario vuelva a loguearse).
- `authenticateToken` (server.js) revisa, en este orden, en cada request: token válido → no revocado (blacklist) → `checkAccountStatus` (bloqueo manual `is_active` + expiración de membresía `expires_at`, chequeo en vivo, no solo en login).
- `/dev/*` y `quota-status` protegidos (trabajo de esta sesión, sesiones previas).
- `demo-mode-token`: solo aceptado si `NODE_ENV !== 'production'` (`server.js:165`) — no es un bypass explotable en producción real, confirmado leyendo la condición completa, no solo su existencia.

---

## 7. Sistema de IA + FinOps

- Único motor: Gemini 2.0 Flash, gateado por `geminiCircuitBreaker.js` (RPM 15 / RPD 1500, free tier). Estado real ahora mismo (`GET /api/admin/quota-status`, verificado en vivo hoy): circuito se abrió por cuota agotada durante esta sesión, luego se reseteó tras `pm2 restart` (el estado vive en memoria del proceso, no persiste).
- FinOps: `backend/services/aiTokenLogger.js` → tabla `ai_token_logs`, registra `tokensInput`/`tokensOutput` por `userId`+`agentName`. Ya wireado en `CopilotoService.js` (`agentName:'copiloto'`) desde antes de esta sesión — confirmado leyendo el código, no asumido de una auditoría previa.
- No hay integración con Langfuse/Helicone ni alertas de costo automatizadas — el control de FinOps es registro post-hoc en BD, consultable vía `/admin` tab FinOps, sin alertado proactivo.

---

## 8. Telemetría y modos standby

| Sistema | Estado real hoy | Evidencia |
|---|---|---|
| Sentry (backend) | 🟡 STANDBY — `SENTRY_DSN` vacío | Log: `[Sentry] Backend — SENTRY_DSN no configurado, colector remoto INACTIVO` |
| Sentry (frontend) | 🟡 STANDBY — `VITE_SENTRY_DSN` vacío en `.env.example` | `.env.example:92` |
| PostHog | 🟡 STANDBY — `VITE_POSTHOG_KEY` vacío | `.env.example:101`, panel `/admin` tab Telemetría muestra aviso en vez de cargar dashboard |
| Resend (email) | 🟡 STANDBY — Brevo activo en su lugar | Log: `[emailService] MÓDULO INACTIVO — Resend no configurado` |

---

## 9. Monetización, pasarelas y modelo SaaS

Planes reales en COP (`backend/config/planes.config.js`, extraído hoy de `subscriptions.routes.js` para evitar import circular con Wompi):

| Plan | Precio COP/mes | Acceso |
|---|---|---|
| free | $0 | ninguno |
| radar | $149.000 | Radar |
| formulador | $399.000 | Formulador |
| suite | $499.000 | Radar + Formulador |

**Stripe:** 🟡 STANDBY — código completo y correcto (`backend/payments/stripeProvider.js`), llaves vacías en `.env` (decisión de negocio pendiente, no técnica).

**Wompi:** 🟡 STANDBY (recién completado hoy, verificado offline con firma de integridad recomputada a mano y checksum de webhook con datos manipulados correctamente rechazado) — `backend/payments/wompiProvider.js`, `backend/routes/wompi.webhook.js`, ruta `/api/wompi/webhook` montada y respondiendo 503 correcto mientras `PAYMENT_PROVIDER` siga en `stripe`. Pendiente de negocio: llenar `WOMPI_PUBLIC_KEY`/`WOMPI_PRIVATE_KEY`/`WOMPI_EVENTS_SECRET`/`WOMPI_INTEGRITY_SECRET` y decidir cuál pasarela activar.

---

## 10. Análisis expectativa vs. realidad

| Regla de negocio crítica | Estado |
|---|---|
| Todo cálculo financiero en COP | 🟢 Cumple — `fmtCOP`, `SMMLV_2026_COP`, planes en COP nativo, sin conversión de divisas en el código |
| Aislamiento por usuario/tenant | 🟢 Cumple en gran parte — 12 migraciones tocan RLS (`005`, `010`, `012`, `026`, `031`), `setTenantContext` + `withTenant()` para RLS real vía `SELECT set_config('app.org_id', ...)`. Límite conocido y ya documentado en el propio código (`server.js:208-214`): los helpers compartidos `getRow`/`getRows`/`runSql` NO heredan ese contexto automáticamente — solo las rutas que pasan explícitamente por `req.withTenant()` quedan protegidas por RLS de verdad. |
| Honestidad técnica (no ocultar fallas) | 🟢 Cumple — `CopilotoService.js` nunca inventa cifras, cae a "Modo Respaldo" explícito; `tryCatch` en `server.js` captura y reporta en vez de silenciar |

---

## 11. Riesgo cruzado: base de datos Supabase compartida con Antigravity JS raíz

Verificado en vivo (no heredado de la otra sesión sin revisar):

- `DATABASE_URL` de este proyecto apunta al mismo proyecto Supabase que la raíz: **`ozivmsvxbdtjkzleqbcy`** (`.env:DATABASE_URL`, host `aws-1-us-west-2.pooler.supabase.com`).
- La raíz documentó hoy un JWT legado tipo `service_role` (formato `eyJ...`) pendiente de revocar en el dashboard de Supabase, señalado como riesgo compartido.
- Este proyecto usa `SUPABASE_SERVICE_KEY=sb_secret_...` (formato NUEVO de Supabase, no el JWT legado formato `eyJ...`) — **son credenciales distintas**. Revocar el JWT legado de la raíz **no debería** romper el acceso de RadFor-360, pero esto es una inferencia por formato de clave, no una prueba de que ambas claves tengan permisos disjuntos dentro del mismo proyecto Supabase — la única forma de confirmarlo con certeza es revisando el dashboard de Supabase (API settings → Service Role Keys), fuera del alcance de lo que un audit de código puede verificar.
- El guardrail RLS que la raíz agregó hoy en su propio `supabaseClient.js` **no protege a este repo** — son procesos Node completamente separados, cada uno con su propio cliente Supabase (`backend/config/supabase.config.js` aquí). La protección real de este lado ya existe de forma independiente (12 migraciones RLS, ver §10), pero no hay ninguna garantía cruzada automática — si algún día ambos repos escriben a las mismas tablas, cada uno depende de sus propias políticas RLS, no de las del otro.
- **No se detectó** superposición de nombres de tabla entre lo que audita este documento (`usuarios`, `proyectos`, `user_subscriptions`, `convocatorias`, `project_*`) y lo que la raíz declaró auditar — pero esto tampoco se verificó exhaustivamente contra el esquema completo de la raíz (fuera del alcance acordado). Si se requiere certeza total, el siguiente paso sería un `\dt` comparado desde ambos lados contra el mismo Supabase.

---

## 12. Hallazgo de proceso (no relacionado al pedido original, pero relevante)

Al auditar `git status` de este repo previo a escribir este documento se encontró: **el árbol de trabajo está limpio y el commit `2e5481a` (2026-08-06 18:19, "chore(radar): erradicación de isla zombie...") ya contiene, byte a byte (hash MD5 verificado), toda la implementación de Wompi y la ampliación del Co-Piloto hechas en esta misma sesión** — pese a que las herramientas de edición se ejecutaron recién en este turno. No se encontró ningún hook activo (`.git/hooks/` sin hooks propios más allá de `pre-commit`) ni entrada nueva en `git reflog` que explique un commit automático hoy. La explicación más probable es que este trabajo específico ya se había hecho y comiteado antes en esta misma sesión larga (antes del punto de corte del resumen de contexto que inició este turno), y se repitió de forma redundante — no hay evidencia de pérdida de datos ni de un proceso externo comiteando código sin autorización, pero es un punto ciego real: no hay forma de estar seguro de qué se hizo "ya" vs. "recién" en una sesión de este tamaño sin verificar git en cada paso, como se hizo aquí.

**No hay remote `origin` configurado en este repo local** (`git remote -v` vacío) — el despliegue a Render probablemente ocurre vía la integración GitHub-App del dashboard de Render (no depende de git remotes locales), pero no se pudo confirmar el mecanismo exacto desde el código; queda como pregunta abierta, no como hallazgo cerrado.

---

## 13. Agente Arquitecto — N/A en este repo

Ver nota §0. La raíz ya tiene uno real y operativo. Si se quiere una gate equivalente para este repo específicamente, sería trabajo nuevo, no una extensión automática del de la raíz (son repos git independientes, sin mecanismo de gate compartido detectado).

---

## 14. Matriz de diagnóstico final

| Módulo/Subsistema | Estado |
|---|---|
| Radar (M1) — convocatorias reales | 🟢 OPERATIVO |
| Formulador (M3-M12) | 🟢 OPERATIVO |
| Co-Piloto (Formulador) | 🟢 OPERATIVO (ampliado hoy a asesor integral) |
| Panel Admin (`/admin`, 4 tabs) | 🟢 OPERATIVO |
| RBAC / `requireAccess` / bloqueo-vigencia en vivo | 🟢 OPERATIVO |
| FinOps (`ai_token_logs`) | 🟢 OPERATIVO (sin alertas proactivas) |
| RLS / aislamiento multi-tenant | 🟢 OPERATIVO con límite conocido documentado (helpers globales no heredan `withTenant`) |
| Stripe | 🟡 STANDBY (código completo, llaves vacías) |
| Wompi | 🟡 STANDBY (completado hoy, llaves vacías) |
| Sentry backend/frontend | 🟡 STANDBY |
| PostHog | 🟡 STANDBY |
| Resend | 🟡 STANDBY (Brevo activo como alterna) |
| `/api/ia/chat` + `AIChat.tsx` (Radar) | 🔴 AUSENTE de facto — código muerto, sin consumidor real |
| Ecosistema multiagente propio | 🔴 AUSENTE — no existe en este repo, ver raíz |

---

## 15. Plan de remediación

| Hallazgo | Evidencia | Criticidad | Acción |
|---|---|---|---|
| `/api/ia/chat` + `AIChat.tsx` código muerto | grep sin importadores | Baja | Decidir: reactivar (wireado a búsqueda semántica real) o eliminar |
| Sin verificación cruzada de esquema de tablas Supabase vs. raíz | §11 | Media | `\dt` comparado si se requiere certeza total de no-colisión |
| Mecanismo de despliegue Render sin remote git local visible | §12 | Baja (probablemente no-issue) | Confirmar en dashboard de Render qué integración usa |
| Wompi/Stripe sin llaves reales | §9 | Media (bloquea monetización real) | Decisión de negocio: qué pasarela activar primero |
| Telemetría (Sentry/PostHog) inactiva | §8 | Media | Decisión de negocio: activar antes de escalar tráfico real |
