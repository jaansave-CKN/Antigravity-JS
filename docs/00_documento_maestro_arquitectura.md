# RadFor-360 — Documento Maestro de Arquitectura

**Producto:** RadFor-360 (repo raíz `brevo-total-integration`, servicio Render `radar-formulador-360`/`radar360-app`). **Propietario:** ASFÁLTICA S.A.S. — Jairo Antonio Salinas Velasco. **Fecha:** 2026-08-06. **Origen:** este documento no existía — el proyecto entró al protocolo Grupo Elite en modo auditoría (Fase 6, sobre un sistema ya construido), que salta la Fase 2 de arranque. Se produce ahora, retroactivamente, con el estado real verificado hoy (radiografía forense + Oleadas 0-3 de remediación), no con la especificación original.

**Cómo se relaciona con el resto de `docs/`:** este es el documento de referencia estructural (qué es el sistema). `analisis_gaps_v1.md`/`01_propuesta_integral.md`/`ESTADO.md` son el plan de remediación en curso (qué se está arreglando). `RADIOGRAFIA_FORENSE_360_2026-08-06.md` es la auditoría forense original que originó todo lo anterior — mantiene su fecha, este documento la reemplaza como referencia viva.

---

## 1. Visión y propósito

RadFor-360 es una plataforma para la identificación (**Radar**) y formulación (**Formulador**) de proyectos de inversión pública en Colombia, dirigida a entidades territoriales, ONG, comunidades organizadas y el sector privado que buscan financiación de fondos como SGR, SGP, DNP, cooperación internacional (BID, Banco Mundial, USAID) y Obras por Impuestos (OxI). El Radar rastrea convocatorias vigentes; el Formulador estructura la ficha técnica del proyecto bajo metodología MGA/DNP, con auditoría automática de viabilidad, riesgos y presupuesto en Pesos Colombianos.

**Problema real que resuelve:** la formulación de proyectos de inversión pública en Colombia es manual, lenta y propensa a errores de cumplimiento normativo (contrapartidas mínimas por fondo, requisitos OxI, indicadores SMART). RadFor-360 automatiza la búsqueda de oportunidades y la generación de un borrador técnico-legal-financiero validado.

**Usuarios:** hoy, mono-usuario real (una cuenta administradora activa, autenticación por lista blanca de Google Sign-In). El modelo de datos ya soporta múltiples tenants (cada usuario de Firebase = un tenant propio, aislado por RLS), pero no existe todavía el concepto de "organización con miembros".

---

## 2. Patrón arquitectónico y capas

**Monolito modular** con capas Clean/Hexagonal parciales — completas en `src/modules/communications/` (`domain/application/infrastructure/`), ausentes en `formulador/` y `radar/` (el controlador habla directo con el adaptador de Supabase, sin entidades de dominio intermedias). `server.js` es el único punto de composición (routers montados directamente, sin contenedor de inyección de dependencias).

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND                                                     │
│  ├─ SPA React (public/src/) — Radar, Módulo 10, Login         │
│  └─ Páginas HTML estáticas (public/*.html) — Fase 1 Formulador│
├─────────────────────────────────────────────────────────────┤
│  BACKEND — server.js (Express, ESM)                           │
│  ├─ Gate universal Firebase Auth (whitelist: health/          │
│  │   convocatorias/session)                                   │
│  ├─ Rate limit por ráfaga (global /api/*) + cuota diaria       │
│  │   (endpoints de IA)                                        │
│  ├─ Routers: communications · github · formulador · radar     │
│  │   (m1Pipeline) · session · openrouter (fallback)            │
│  └─ WebSocket /ws/live_radar (cron de baja frecuencia →        │
│      m1Pipeline, compartido entre todos los clientes)          │
├─────────────────────────────────────────────────────────────┤
│  MOTOR DE ORQUESTACIÓN — src/orchestrator-engine.js            │
│  Orchestrator000: AGT-052 (legal) · AGT-053 (financiero) ·     │
│  AGT-054 (riesgos) · AGT-056 (evaluador) — corre server-side,   │
│  gate de arquitectura interno (hash de integridad ficha)       │
├─────────────────────────────────────────────────────────────┤
│  DATOS                                                         │
│  ├─ Supabase/PostgreSQL (REST/PostgREST) — dominio Formulador,│
│  │   RLS + filtro tenant_id explícito en cada RPC              │
│  ├─ Firestore — audit_logs, estado_antigravity (inventario)    │
│  └─ Upstash Redis (REST) — sesiones JWT + cache IA 24h          │
├─────────────────────────────────────────────────────────────┤
│  IA EXTERNA — Claude/Anthropic (motor principal) · Tavily      │
│  (búsqueda) · OpenRouter (fallback, sin consumidor activo)     │
└─────────────────────────────────────────────────────────────┘
```

**Acoplamiento:** alto en `server.js` (wiring directo), bajo entre módulos de negocio entre sí (Formulador, Radar y Comunicaciones no se conocen entre sí). **SPOF:** un solo proceso Node en Render `plan: free` sin réplicas; WebSocket single-process sin pub/sub entre instancias; una sola cuenta Anthropic para todo el sistema de IA.

---

## 3. Tabla de módulos de operación

| # | Módulo | Estado | Backend | Frontend |
|---|---|---|---|---|
| 1 | Autenticación (Google Sign-In + JWT propio) | 🟢 Operativo | `FirebaseAuthMiddleware.js`, `session-manager.js` | `InicioPage.jsx`, `AuthContext.jsx` |
| 2 | Radar — datos + WS | 🟢 Operativo | `server.js` (`/api/convocatorias`, WS) | `RadarApp.jsx` |
| 3 | Radar — búsqueda IA on-demand | 🟢 Operativo | `m1Pipeline.js` (Claude+Tavily) | Barra de búsqueda en `RadarApp.jsx` |
| 4 | Radar — feed "Live" | 🟢 Operativo | Cron de baja frecuencia (`RADAR_CRON_HOURS`) → `m1Pipeline.js`, compartido | Badge "LIVE" en Sidebar |
| 5 | Radar — Panel/Directorio/Favoritos/Calendario | 🔴 Ausente (stub visual) | — | `FrozenPage.jsx` |
| 6 | Formulador — Fase 1 (Módulos 1-9) | 🟢 Operativo | `FormuladorRouter.js` → `insertar_fase1` (RLS multi-tenant) | `fase1-entrada.html` + `app.js` (fuera del SPA) |
| 7 | Formulador — Ficha Técnica (motor IA) | 🟢 Operativo | `POST /api/formulador/ficha-tecnica` → `Orchestrator000` server-side | Renderizado inline en `fase1-entrada.html` |
| 8 | Formulador — Módulo 10 (Indicadores y Seguimiento) | 🟢 Operativo | `guardar_modulo10`/`obtener_modulo10`/`listar_proyectos` (RPC) | `Modulo10Page.jsx` (SPA React) |
| 9 | Formulador — Anexos (repositorio documental) | 🔴 Pendiente (Oleada 3) | — | `FrozenPage.jsx` |
| 10 | Formulador — Logística (transporte de insumos) | 🔴 Pendiente (Oleada 3) | — | `FrozenPage.jsx` |
| 11 | Formulador — Dialéctica (socialización comunitaria) | 🔴 Pendiente (Oleada 3) | — | `FrozenPage.jsx` |
| 12 | Comunicaciones (email transaccional) | 🟡 Standby | `CommunicationRouter.js` (Brevo) | Sin UI dedicada |
| 13 | Conector GitHub | 🟢 Operativo | `GitHubRouter.js` | Sin UI dedicada |
| 14 | Panel `/admin` (audit_logs + FinOps) | 🔴 Pendiente (Oleada 4, autorizada, no iniciada) | — | — |
| 15 | Monetización | 🔴 Ausente por decisión explícita (pospuesta) | — | — |

---

## 4. Esquema de datos (resumen — ver `00b_modelo_de_datos.md` para el detalle completo)

**Supabase/PostgreSQL** (`ozivmsvxbdtjkzleqbcy`, compartido con el proyecto hermano Proy_03_RadarFondos — namespacing por prefijo `formulador_*`): `formulador_proyectos`, `formulador_objetivos`, `formulador_oe`, `formulador_cronograma`, `formulador_presupuesto`, `formulador_validaciones_financieras`, `formulador_indicadores`. Todas con RLS habilitado + política `tenant_id = current_tenant_id()`, más filtro explícito `WHERE tenant_id = p_tenant_id` en cada función RPC `SECURITY INVOKER` (defensa en profundidad — el aislamiento real hoy lo da el filtro explícito, no RLS-por-rol, porque Firebase no está configurado como Third-Party Auth en el dashboard de Supabase).

**Firestore:** `audit_logs` (eventos de negocio: login, chat IA, errores), `system_reports` (inventario de `agents/`, generado por `scripts/generar_reporte.cjs`).

**Cache/Sesiones (Upstash Redis):** `session:<uuid>` (JWT propio, TTL 24h), `radar:<md5>` (resultados de `m1Pipeline.js`, TTL 24h).

---

## 5. Roles y control de acceso (RBAC)

- **Autenticación:** Google Sign-In (Firebase Auth) — lista blanca implícita por correo autorizado en `firestore.rules`.
- **Rol `admin`:** custom claim de Firebase, propagado al JWT propio. Hoy solo lo lee `revokeSession` (revocar sesión ajena). El middleware `requireAdmin` (Oleada 0) existe listo para usarse en el panel `/admin` (módulo 14, pendiente).
- **Multi-tenant:** cada `uid` de Firebase deriva un UUID de tenant determinista (SHA-256 truncado). No hay concepto de "organización" — un tenant es siempre un usuario individual.
- **Perímetro Firestore:** `audit_logs` legible solo por el correo del dueño; deny-by-default para todo lo demás.

---

## 6. Dependencias externas

| Servicio | Uso | Estado |
|---|---|---|
| Anthropic (Claude, `claude-sonnet-4-6`) | Motor de IA principal — chat, Radar, Formulador | 🟢 Activo |
| Tavily | Búsqueda en tiempo real (tool-use de Claude) | 🟢 Activo |
| Supabase | Base de datos (PostgreSQL vía REST), Auth fallback no usado | 🟢 Activo |
| Firebase (Auth + Firestore) | Identidad + logs de auditoría | 🟢 Activo |
| Upstash Redis | Sesiones + cache de IA | 🟢 Activo |
| OpenRouter | Fallback de IA | 🟡 Configurado, sin consumidor en UI |
| GitHub API | Estado del repositorio | 🟢 Activo |
| Brevo | Email transaccional | 🟡 Configurado, sin UI que lo dispare |
| Render | Despliegue (proceso único, plan free) | 🟢 Activo |
| Stripe / pasarelas de pago | Monetización | 🔴 No integrado, pospuesto por decisión explícita |

**Marco legal/normativo:** metodología MGA/DNP, Ley 715/2001 (educación), Ley 1438/2011 (salud), Ley 1537/2012 (vivienda), Ley 1819/2016 Art. 238 (Obras por Impuestos), reglas de cofinanciación mínima por fondo (SGR 0%, DNP 20%, Kusanone/JICA 30%, Cooperación 10%) — todas codificadas en `orchestrator-engine.js` y las migraciones SQL, no como texto libre.

---

*RadFor-360 · Documento Maestro de Arquitectura · Producido 2026-08-06 bajo protocolo Grupo Elite (Fase 2, retroactiva) · Ver `00b_modelo_de_datos.md`, `00c_especificacion_api.md`, `00d_decisiones_arquitectura.md` para el detalle por área.*
