# Informe de Auditoría — Protocolo "Casa Organizada"
**Fecha:** 2026-06-06 · **Estado:** Solo análisis — nada ha sido borrado ni movido (excepto la limpieza de Stitch ya autorizada por separado: 53 PNG + 1 ZIP)

> Todo lo listado abajo está pendiente de tu aprobación. Verifiqué cada hallazgo con grep/trazado de imports antes de incluirlo — donde una primera pasada dio un falso positivo, lo corregí (ver notas ⚠️).

---

## 1. ARCHIVOS A ELIMINAR

### 1.1 Frontend — código huérfano verificado (`client/src/`)

**Clúster "Dashboard viejo" — cadena completa sin uso, reemplazada por `RadarDashboard`:**
| Archivo | Evidencia |
|---|---|
| `components/Dashboard.tsx` | Wrapper de re-export (`export { default } from '../Dashboard'`) con imports muertos (DashboardLayout, MapContainer, OpportunitiesTable, iconos lucide) que nadie importa |
| `components/DashboardLayout.tsx` | Único importador era el wrapper huérfano de arriba |
| `components/MapContainer.tsx` | Ídem — único consumidor es el wrapper huérfano |
| `components/OpportunitiesTable.tsx` | Ídem |
| `components/Header.tsx` | Solo lo importa `DashboardLayout` (huérfano) |
| `components/Navbar.tsx` | 0 referencias (distinto de `TopNavBar`, que sí está vivo vía `main.tsx`) |
| `contexts/AuthContext.tsx` | Solo lo consumen `Header.tsx` y las páginas admin huérfanas de abajo — `AuthContextNew` es el activo (usado en `main.tsx`) |

> ⚠️ **Alerta:** `DashboardLayout.tsx`, `MapContainer.tsx`, `Navbar.tsx` y `OpportunitiesTable.tsx` aparecen como **modificados (`M`)** en `git status` — alguien ha estado editando código que la app nunca renderiza. Vale la pena confirmar si hay intención de revivir este Dashboard antes de borrar (si no, son ediciones perdidas).

**Páginas admin/auth nunca ruteadas (no aparecen en `main.tsx`):**
- `pages/AdminPanel.tsx`
- `pages/AdminRecoveryPanel.tsx`
- `pages/AdminUsersPage.tsx`
- `pages/HomePage.tsx`
- `pages/VerifyEmailPage.tsx`

**Componentes sueltos sin importadores:**
- `components/BusquedaEnTiempoReal.tsx` + `components/BusquedaEnTiempoReal.css`
- `components/PestañaInteligencia.tsx`
- `components/PestañaInteligenciaChat.tsx`

**Clúster "PestañaPrueba" — prototipo aislado, nunca ruteado desde `main.tsx`:**
- `components/RadarWorkspace.tsx`
- `features/radar-fondos/presentation/PestañaPrueba.tsx`
- `features/radar-fondos/presentation/components/PestañaPrueba.tsx`

**Servicios sin uso:**
- `services/scraper.ts`
- `services/websocket.ts`
- `services/gemini.ts` (superseded por `services/geminiScanner.ts`, que sí está activo)
- `services/storage/loadTest.ts`
- `services/watcher/codeWatcher.ts`

**Datos / estilos sin uso:**
- `data/realData.ts` (el activo es `data/realEntidades.ts` vía `useEntidades`)
- `auth.css`

### 1.2 Backend — código huérfano verificado

**Configs sin ningún `require`:**
- `backend/config/production.config.js`
- `backend/config/supabase.config.js`
- `backend/config/resend.config.js`
- `backend/config/stripe.config.js`
- `backend/config/database.config.js`

**Middlewares/servicios reemplazados por implementaciones inline o alternativas activas:**
| Archivo | Reemplazado por |
|---|---|
| `backend/middlewares/auth.middleware.js` | `authenticateToken()` inline en `server.js:106` |
| `backend/middlewares/supabaseAuth.js` | — (Supabase no está activo) |
| `backend/middlewares/tokenBlacklist.js` | Solo lo usa `stripe.webhook.js` (huérfano) |
| `backend/middlewares/radarCache.js` | 0 referencias |
| `backend/services/emailService.js` | `BrevoEmailAdapter.js` (activo, usado en `server.js:739`) |
| `backend/services/pdfGenerator.js` | `backend/pipeline/reportePDF.js` (activo) |
| `backend/routes/stripe.webhook.js` | Nunca se registra en `server.js` (`registerStripeWebhook` no aparece) |
| `backend/websocket_client.js` | 0 referencias — no hay WebSocket en `server.js` |

> Nota: `backend/services/logService.js` está importado por `matchScore.js` pero su función `logCriticalError()` nunca se invoca — código parcialmente muerto, mantenlo si planeas usar logging crítico pronto.

### 1.3 Clutter del directorio raíz (no rastreado por git, riesgo cero)

- **78 capturas de pantalla `*.png`** (≈26 MB) — artefactos de sesiones de QA con navegador automatizado: `app_*.png`, `inicio_*.png`, `radar_*.png`, `panel_*.png`, `flujo_*.png`, `fase1_*.png`, `demo_*.png`, `check_*.png`, `canales_page.png`, `all_frames.png`, `apis_after_wait.png`, `current_inicio_check.png`, `footer_zoom.png`, `root_online*.png`, etc.
- `file_list.txt` — volcado de salida sin uso aparente

---

## 2. DEPENDENCIAS A DESINSTALAR (`package.json` raíz)

| Dependencia | Evidencia |
|---|---|
| `sql.js` | 0 referencias en código fuente; `data/radar.db` ya está borrado en el working tree (migración a PostgreSQL completada) |
| `react-leaflet` | 0 referencias en ningún archivo |
| `stripe` | Solo aparece en la cadena huérfana `stripe.config.js` → `stripe.webhook.js`; nunca se registra en `server.js` |
| `resend` | Solo aparece en la cadena huérfana `resend.config.js` → `emailService.js`; el adaptador activo es Brevo |

> ⚠️ **Caso ambiguo — `leaflet`:** su CSS se importa globalmente en `main.tsx:28` (`import 'leaflet/dist/leaflet.css'`), pero el único uso de la API JS de Leaflet está dentro de `MapContainer.tsx` (huérfano, sección 1.1). Si confirmas el borrado del clúster "Dashboard viejo", `leaflet` y su import de CSS también quedan libres para remover — pero te lo señalo aparte porque el mapa podría ser una funcionalidad que planeas retomar.

---

## 3. ARCHIVOS A MOVER

| Origen | Destino propuesto | Motivo |
|---|---|---|
| `agente_000.py`, `bridge_migration.py`, `database.py`, `list_tables.py`, `migrate_scraped.py`, `migrate_to_postgres.py`, `reparador.py` | `archive/python_legacy/` | Ya existe esta carpeta con un backend Python legado completo (incluye su propio `database.py`); estos scripts de migración cumplieron su función (la migración a Postgres está completa según `backend/migrations/*.sql`) y encajan ahí, no sueltos en la raíz |
| `AGENTS.md`, `AUTOMATION.md`, `BITACORA.md`, `DEPLOY_INSTRUCTIONS.md` | `docs/` (carpeta nueva — no existe aún) | Consolidar documentación dispersa; `CLAUDE.md` se queda en la raíz (convención de la herramienta) |
| `check_db.js`, `check_users.js`, `test-insert.js`, `reset_admin.js`, `seed-admin.js`, `seed-convocatorias.js`, `seed-produccion.js` | `scripts/db-init/` (subcarpeta nueva dentro de `scripts/`, que ya existe) | Scripts de inicialización/depuración de BD, no forman parte del pipeline activo (no están en `package.json` → `scripts`) pero pueden ser útiles como referencia |
| `backend/scripts/s3backup.js`, `backend/scripts/authE2ETest.js` | Quedan donde están — no son huérfanos (son utilidades), pero no están conectados al pipeline `npm run test:*` como `smokeTest.js`/`securityValidation.js` sí lo están. Confírmame si quieres mantenerlos activos o archivarlos. | — |

**Carpeta vacía detectada:** `_scripts/` — candidata a eliminar si no tiene un propósito planeado.

---

## 4. LANZADORES REDUNDANTES — 5 versiones del mismo propósito

El canónico es **`000-orquestador.js`** (el más nuevo, conectado vía `npm run start:all`, con health-checks, auto-restart y túnel Cloudflare). Candidatos a retirar por estar superados:

- `INICIAR_RADAR.bat`, `iniciar_todo.bat`, `INICIAR_TODO_v2.bat`, `INICIAR_TODO_v2.ps1` — versiones antiguas del lanzador "todo en uno"
- `orchestrator.js` — versión anterior de `000-orquestador.js` (más simple, sin túnel); aún está conectado vía `npm run orchestrate`, así que **antes de borrarlo hay que decidir si retiras también ese script de `package.json`**
- `start_all_services.ps1`, `start_radar_production.ps1`, `watchdog.ps1` (raíz) — ya existen equivalentes en `scripts/` (`start_all.ps1`, `start_radar_24h.ps1`, `auto-monitor.ps1`)

> ⚠️ **`cloudflared.exe` — NO es duplicado seguro de borrar.** Hay dos copias (raíz y `tools/`) y **ambas están en uso por scripts distintos**: `000-orquestador.js` (el canónico) busca el binario en la **raíz** (`path.join(__dirname, 'cloudflared.exe')`, línea 177), mientras que `run-tunnel.ps1` y `start-tunnel.js` apuntan a `tools/cloudflared.exe`. Si decides consolidar en una sola copia, hay que actualizar las rutas en el script que se quede obsoleto — no es un borrado trivial.

`run-tunnel.ps1`, `start-tunnel.js` también quedan en esta categoría de "redundantes con `scripts/`" si decides que `000-orquestador.js` es el único camino de arranque.

---

## 5. SCRIPTS ABANDONADOS / ONE-OFF (rastreados en git, fuera del pipeline activo)

- `check_db.js`, `check_users.js`, `test-insert.js` — utilidades de inspección manual de BD
- `reset_admin.js`, `seed-admin.js`, `seed-convocatorias.js`, `seed-produccion.js` — carga de datos pre-lanzamiento (con valores hardcodeados como `'Radar2026!'`)
- `apply_dark_mode.cjs` (no rastreado) — script de reemplazo masivo de clases Tailwind, diseñado para una sola corrida
- `test-gemini.mjs` (no rastreado) — smoke test puntual de la API Gemini

(Ver sección 3 para destino propuesto de los que vale la pena conservar como referencia.)

---

## RESUMEN EJECUTABLE

| Acción | Cantidad | Riesgo |
|---|---|---|
| Borrar capturas `.png` sueltas + `file_list.txt` | 79 archivos, ~26 MB | 🟢 Cero (no rastreados, ya verificado patrón con limpieza Stitch) |
| Borrar código huérfano frontend | ~25 archivos | 🟡 Medio — 4 de ellos tienen ediciones recientes sin commitear |
| Borrar código huérfano backend | ~13 archivos | 🟢 Bajo — todos con 0 referencias verificadas |
| Desinstalar dependencias (`sql.js`, `react-leaflet`, `stripe`, `resend`) | 4 paquetes | 🟢 Bajo |
| Mover scripts Python → `archive/python_legacy/` | 7 archivos | 🟢 Bajo |
| Mover docs → `docs/` | 4 archivos | 🟢 Bajo |
| Consolidar lanzadores redundantes | ~10 archivos | 🟡 Medio — requiere decidir cuál es el único camino de arranque y actualizar rutas de `cloudflared.exe` |

**Pendiente de tu validación:** dime qué bloques apruebas (puedes aprobar por sección, ej. "procede con 1.3 y 2, deja el resto para revisión") y ejecuto solo eso — nada se toca hasta tu confirmación explícita.
