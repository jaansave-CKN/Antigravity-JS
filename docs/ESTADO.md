# Estado de construcción — RadFor-360 (Plan de Remediación Grupo Elite)

ARQUITECTURA_CERRADA: SI — 2026-08-06

**Origen:** `docs/RADIOGRAFIA_FORENSE_360_2026-08-06.md` → `docs/analisis_gaps_v1.md` (Fase 3) → `docs/01_propuesta_integral.md` (Fase 4) → 4 preguntas de autorización respondidas por el usuario el 2026-08-06.

**Restricción vigente en todas las oleadas:** mantener intacto el diseño gráfico e identidad visual actual de RadFor-360 (paleta oscura, dorado de marca, Hanken Grotesk, `Sidebar.jsx`/`Layout.jsx`, `lucide-react`).

Un checkbox se marca `[x]` solo cuando el ítem tiene, como mínimo, código funcionando y verificado (`node --check`/`npm run build` reales, no solo lectura) — no basta con que el archivo exista.

## Oleada 0 — Higiene y seguridad
- [x] A1a — `BREVO_API_KEY` sincronizada en `.env` (verificado, era el bloqueo real de Comunicaciones)
- [x] A1b — `GITHUB_TOKEN` corregido: el valor anterior (`glpat-...`) era un token de GitLab puesto por error en la variable de GitHub — daba 401 real contra `api.github.com`, confirmado en vivo. Reemplazado por el token correcto (`github_pat_...`, 200 OK verificado). `/api/github/status` estaba roto en producción pese a estar clasificado 🟢 en la radiografía — el código era real, la credencial no.
- [ ] A1c — Revocar `SUPABASE_SERVICE_KEY` huérfana (`...cDWtdZ7d`, en `claves_privadas.txt`, sigue activa 200 OK pero sin consumidor en código) — **bloqueado por el clasificador de modo automático** al intentar vía Supabase Management API; requiere que el usuario la revoque manualmente desde el dashboard ([link directo](https://supabase.com/dashboard/project/ozivmsvxbdtjkzleqbcy/settings/api-keys)), o ajuste el permiso de Bash para ese tipo de llamada.
- [x] A2 — `scripts/generar_reporte.cjs` corregido: ya no fabrica `"READY 24/7"` uniforme, valida `IDENTITY.md` + skill `.cjs` no vacío por carpeta. Ejecutado en vivo: de 15 agentes, 8 "definidos" y 7 solo con `IDENTITY.md` sin skill — `public/estado_antigravity.json` refrescado con el dato real.
- [x] A3 — `zod` agregado como dependencia directa; `src/shared/infrastructure/validation.js` (middleware + schemas). Aplicado en `POST /api/communications/email`, `POST /api/session/login`, `POST /api/session/verify`, `POST /api/execute`. Verificado en vivo: bodies inválidos devuelven 400 con detalle de campo, no 500.
- [x] A4 — Rate limit por ráfaga (`checkBurst`/`burstLimiter`, `session-manager.js`), 20 req/10s por uid o IP, montado en todo `/api/*`. Verificado en vivo: 25 requests seguidas a `/api/health` → primeras 20 en `200`, siguientes 5 en `429`.

**Validación de cierre de Oleada 0:** `node --check` OK en los 5 archivos tocados; servidor local levantado y probado con requests HTTP reales (`/api/health`, `/api/session/login`, `/api/session/verify`, `/api/execute`, ráfaga de 25 requests); `npm run build` (vite) completo — 1534 módulos, `exit 0`, sin errores.
- [ ] A2 — `scripts/generar_reporte.cjs` deja de fabricar `"READY 24/7"` uniforme
- [ ] A3 — `zod` + validación en endpoints más débiles
- [ ] A4 — Middleware de rate limiting por ráfaga

## Oleada 1 — Motor de Ficha Técnica
- [x] Endpoint `POST /api/formulador/ficha-tecnica` (invoca `Orchestrator000` server-side) — `FormuladorPgController.js`/`FormuladorRouter.js`, validado con `zod`.
- [x] **3 bugs reales descubiertos y corregidos durante esta oleada** (no estaban en el alcance original, salieron al investigar "conectar el motor"):
  1. `orchestrator-engine.js` se importaba desde `public/app.js` con una ruta (`../src/orchestrator-engine.js`) que solo resuelve en `npm run dev` — 404 real en producción (`dist/` servido por Express no expone `/src/*`). Corregido moviendo la ejecución al backend; `app.js` ya no importa nada de `src/`.
  2. `fase1-entrada.html` nunca llamaba a `POST /api/formulador/fase1` — dos listeners duplicados en el mismo botón, ninguno persistía. Consolidado en un único flujo en `app.js`; agregado campo "Nombre del Proyecto" (requerido por el schema y ausente del formulario); agregada recolección real de Módulos 7-9 (antes solo se leían visualmente, nunca se armaba el payload).
  3. `callAI()` nunca envió `Authorization` a `/api/chat` (ni en navegador ni server) — el gate universal lo rechazaba siempre con 401 y el sistema caía en el texto de plantilla sin que nadie lo notara. Agregado `setServerAuthToken()`, conectado con el JWT del usuario que llega a `/api/formulador/ficha-tecnica`.
  4. `fase1-entrada.html` no tenía ningún SDK de auth — agregado Firebase (compat, CDN) reutilizando la sesión ya iniciada en `/inicio`, con banner visible si no hay sesión.
- [ ] Pantalla `Ficha Técnica` real en el SPA React (reemplaza `FrozenPage` en `/ficha`) — **no incluida en esta ronda**: el flujo real hoy vive en `fase1-entrada.html` (fuera del SPA), que ya renderiza el resultado (`renderDashboard`) en la misma página. Evaluar en Oleada 3 si conviene además una vista en el SPA o si `fase1-entrada.html` sigue siendo la única superficie de Formulador.

**Validación de cierre:** `node --check` OK en los 5 archivos tocados; `Orchestrator000` ejecutado directamente en Node (sin HTTP) con una ficha de prueba completa — `validarDiseno` 100%, `run()` con presupuesto/riesgo/evaluación reales; servidor local levantado, `POST /api/formulador/ficha-tecnica` sin token → `401` (gate aplica), `/api/health` → `200`; `npm run build` — 1534 módulos, `exit 0`.

## Oleada 2 — Feed "Live" real de Radar
- [x] Cron de baja frecuencia único (`RADAR_CRON_HOURS`, default 6h) — reemplaza el `setInterval` simulado de 30s. Comparte una sola corrida de `m1Pipeline.js` entre todos los WS conectados; se omite por completo (costo $0) si no hay clientes conectados; reutiliza el cache dual de 24h ya existente.
- [x] Payload ya no se marca `_simulado:true` — mapea `oportunidades` reales de Claude+Tavily al shape de `radarData`, con `id` estable (slug de entidad+título) para actualizar en vez de duplicar entre corridas.

**Validación de cierre:** `node --check` OK; servidor local levantado — arranque limpio, cron programado (no disparado, cero costo real durante la prueba), `/api/health` `200`, `/api/convocatorias` sirve el seed intacto.

## Oleada 3 — Módulo B: pantallas restantes (orden autorizado)
- [x] **Módulo 10 — Indicadores y Seguimiento.** Primera pantalla real del SPA React para Formulador (las anteriores viven en `fase1-entrada.html`, fuera del SPA). Incluye pieza no prevista: no existía forma de listar los proyectos guardados de un tenant (`GET /api/formulador/fase1/:id` exige ya conocer el UUID) — se agregó `listar_proyectos` (RPC) + `GET /api/formulador/proyectos` como selector de proyecto, reutilizable por Anexos/Logística/Dialéctica.
  - Backend: migración `006_modulo10_y_listado.sql` (tabla `formulador_indicadores` + RLS + RPCs `listar_proyectos`/`guardar_modulo10`/`obtener_modulo10`) — desplegada y verificada en Supabase real (`pg_proc` confirma las 3 funciones).
  - Endpoints: `GET /api/formulador/proyectos`, `GET|POST /api/formulador/:id/modulo10` — validados con `zod`.
  - Frontend: `public/src/pages/Modulo10Page.jsx` (nueva) — selector de proyecto + tabla de indicadores (agregar/quitar filas) + guardar. Ruta `/modulo10` desde `FrozenPage` a página real; Sidebar ya no la marca "frozen".
  - **Contenido de campos (indicador/tipo/unidad/línea base/meta/fuente de verificación/responsable/frecuencia) es interpretación del arquitecto, aprobada explícitamente por el usuario 2026-08-06 — no viene de un spec preexistente.**
- [ ] Anexos — repositorio documental del proyecto (siguiente en la cola)
- [ ] Logística — transporte/acceso de insumos del Módulo 5
- [ ] Dialéctica — socialización comunitaria
- [ ] (Módulo A — Radar: Panel/Directorio/Favoritos/Calendario — **pospuesto, sin fecha**, fuera de esta ronda)

**Validación de cierre (Módulo 10):** migración desplegada y verificada en Supabase real; `node --check` OK en los 3 archivos backend tocados; `npm run build` — 1535 módulos, `exit 0`; servidor local — `GET /api/formulador/proyectos` y `GET /api/formulador/:id/modulo10` sin token → `401` (gate aplica).

## Oleada 4 — Panel `/admin` mínimo viable
- [ ] Middleware `requireAdmin` (C1)
- [ ] Vista `audit_logs` en `/admin`
- [ ] `GET /api/admin/finops` + vista agregada de tokens

## Oleada 5 — Monetización y telemetría
- **Pospuestas por decisión explícita del usuario (2026-08-06).** Sin ítems en esta ronda.

## Oleada 6 — Limpieza de legacy
- [x] Eliminados `backend_fastapi.py`, `server-sim.js` (`git rm`)
- [x] Eliminados scripts `fastapi`/`server`/`sim`/`start:full`/`start:sim` de `package.json`; `package.json` validado como JSON correcto tras el cambio
- **`agents/` no se toca como runtime** — decisión explícita, sigue siendo protocolo de disciplina.

---

**Actualizar este archivo en cada sesión de trabajo posterior** — es la fuente de verdad de qué está realmente hecho, no `AGENTS.md` ni la memoria de la sesión.
