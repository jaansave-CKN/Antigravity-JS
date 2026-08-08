# INFORME DE RECONCILIACIÓN Y CIERRE — Operación Exterminio Final
**Fecha:** 2026-08-07 (continuación misma jornada operativa)
**Alcance:** cierre de las 4 fases ordenadas sobre la Radiografía Forense 360° del mismo día, reconciliadas con una segunda sesión que operó en paralelo sobre los mismos archivos, más hallazgos nuevos descubiertos al verificar todo en vivo.

---

## 0. Qué pasó realmente — reconciliación de dos sesiones concurrentes

Mientras yo ejecutaba la Operación Exterminio, **otra sesión trabajó en paralelo sobre el mismo working tree**, sin commitear. Al retomar, el disco ya tenía sus cambios mezclados con los míos. Por instrucción de sistema no se revierte trabajo intencional de otra sesión — se reconcilia. Así quedó dividido el trabajo:

**Lo que ejecuté yo (turno anterior):**
- Purga de `EGIOC5/` y `OPENCODE-MODEL/` (vacías, confirmado).
- Rechazo justificado de borrar `SUPABASE_SERVICE_KEY` de `.env` (es la credencial activa que sostiene todo Supabase REST, no la huérfana real).
- Guardrail RLS duro en `supabaseClient.js:rpc()` + eliminación del fallback a tenant compartido (`DEFAULT_TENANT`) en `FormuladorPgController.js`.
- `npm uninstall pg` (dependencia muerta).
- Purga de `MiniMaxChat.jsx` y las rutas backend `/api/minimax/status|chat`.
- Corrección de `AGENTS.md:33` (retiro de la afirmación "Hexagonal, DDD").

**Lo que hizo la sesión paralela (verificado en disco, no revertido):**
- Corrigió un bug real de higiene: `.gitignore` tenía `/.agents/` (con "s") pero la carpeta real es `.agent/` (sin "s") — **nunca se ignoró**, `.agent/` estuvo trackeada en git todo este tiempo. Corregido a `.agent/` + `git rm -r --cached .agent/` (119 archivos, siguen en disco, ya no en el índice de git).
- **Reemplazó el gate de arquitectura falso por uno real.** El mecanismo anterior (`agents/000_Orquestador.cjs`, modo `--aprobar-diseno`) escribía `diseno_aprobado.json` con `aprobado:true` **incondicionalmente**, autofirmado por un rol (`001_ARQUITECTO_CORE`) que nunca tuvo implementación — el "gate de arquitectura" que `AGENTS.md` Axioma II.1 lleva meses citando como ley del sistema era, en la práctica, un sello de goma. Se reemplazó por `pedirVeredictoArquitecto()`: lee `.claude/agents/architect.md` (agente real, ya existente, con herramientas Read/Grep/Glob y salida JSON obligatoria) como system prompt, le pasa `git diff HEAD`, y solo firma si Claude devuelve `aprobado:true` genuinamente.
- Decidió reconectar `MiniMaxChat.jsx` a `/api/openrouter/chat` con el modelo real `minimax/minimax-m2.5` (en vez de eliminarlo, la otra opción válida que yo había ejecutado) — **verifiqué independientemente contra la lista pública de modelos de OpenRouter que el slug es correcto y existe** (ver §2).
- Quitó `STRIPE_SECRET_KEY=` de `.env` (placeholder vacío, sin SDK, sin uso — limpieza válida).
- Corrigió `docs/00_documento_maestro_arquitectura.md:94` (RBAC pendiente, texto ya preciso).

**Lo que hice yo al reconciliar (esta sesión):**
- Verifiqué `npm run build` (1535 módulos, exit 0) y arranque real del servidor con el estado combinado — `/api/health` → `healthy`.
- **Encontré y corregí un bug funcional real** en el `MiniMaxChat.jsx` reconectado: `checkStatus()` llamaba a `/api/openrouter/status` sin token; esa ruta vive bajo el gate universal de auth (`server.js`) y devuelve 401 sin él — el badge de estado mostraría "Offline" siempre, aunque el motor funcionara. Corregido adjuntando el token de Firebase igual que ya hacía `sendMessage()`.
- **Encontré y corregí que el gate real nunca se había ejecutado con éxito ni una vez**: `agents/000_Orquestador.cjs` nunca cargaba `.env` (a diferencia de `server.js`), así que `pedirVeredictoArquitecto()` fallaba siempre con "ANTHROPIC_API_KEY no configurada" pese a existir la clave. Agregado `require('dotenv').config(...)`.
- Ejecuté el gate real (`--aprobar-diseno`) para intentar cerrar el ciclo con una firma genuina — **y ahí apareció el hallazgo crítico de la sección 1**.

---

## 1. HALLAZGO CRÍTICO NUEVO — el motor de IA principal está sin saldo

Al ejecutar `node agents/000_Orquestador.cjs --aprobar-diseno`, la llamada real a la API de Anthropic devolvió:

```
400 { "type": "invalid_request_error",
      "message": "Your credit balance is too low to access the Anthropic API.
                   Please go to Plans & Billing to upgrade or purchase credits." }
```

**Esto no es un problema del gate — es un problema de toda la aplicación.** El mismo `ANTHROPIC_API_KEY` alimenta:
- `/api/chat` y el pipeline de Radar (`m1Pipeline.js`, tool-use con Tavily)
- `AGT-052` del `Orchestrator000` (justificación legal de la Ficha Técnica)
- El cron de "Feed Live" (`refreshRadarLive()`, `server.js`) — cada corrida sin clientes activos se salta, pero cuando sí hay clientes conectados, la llamada real a Claude **fallará silenciosamente** (el `catch` de `refreshRadarLive` solo hace `console.error`, no alerta a nadie)
- El propio gate de arquitectura que la operación de hoy acababa de arreglar

**Y aquí está el hallazgo secundario, igual de importante:** `GET /api/health` reporta `claude: '✅ configurado'` — pero ese chequeo **solo verifica que la variable de entorno exista** (`!!process.env.ANTHROPIC_API_KEY`), nunca hace una llamada real. Un health check que dice "healthy" mientras el motor principal está completamente inutilizable por falta de saldo es exactamente el tipo de "ficción arquitectónica" que esta operación se propuso erradicar — y sobrevivió a las 4 fases porque nadie llamó a la API real hasta este paso final del gate.

**Acción requerida — solo la puede tomar el humano:** recargar saldo en https://console.anthropic.com/settings/billing. No es una acción que este agente pueda o deba ejecutar.

**Consecuencia inmediata en este informe:** `agents/diseno_aprobado.json` queda con la firma vieja y ya inválida (hash de `src/` cambió hoy, así que el mecanismo de auto-invalidación ya la rechaza igual). No hay firma real posible hasta resolver el saldo.

---

## 2. Verificación independiente — modelo MiniMax en OpenRouter

Consulté en vivo `https://openrouter.ai/api/v1/models` (API pública, sin autenticación) para no dar por buena la corrección de la otra sesión sin comprobarla:

```
minimax/minimax-m2.5   ← el slug usado en MiniMaxChat.jsx, CONFIRMADO real
minimax/minimax-m2.7
minimax/minimax-m3     ← más reciente que el que quedó configurado
minimax/minimax-01
```

El slug configurado es correcto y existe. Nota para la sección 3: hay un modelo más nuevo (`minimax-m3`) disponible si se quiere actualizar en el futuro — no es un defecto, es una oportunidad de mejora menor.

---

## 3. TABLA COMPLETA DE FALENCIAS, ERRORES Y PENDIENTES (post-reconciliación)

| # | Hallazgo | Severidad | Estado | Acción |
|---|---|---|---|---|
| 1 | Anthropic API sin saldo — motor principal de IA inoperante en runtime real | 🔴 CRÍTICO | Confirmado en vivo hoy | Recargar saldo (acción humana, billing) |
| 2 | `GET /api/health` reporta "configurado" sin probar la API real — falso positivo de salud | 🟠 ALTO | Nuevo hallazgo, sin corregir | Cambiar el check a una llamada real de bajo costo (o cachear el resultado del último fallo real) |
| 3 | `refreshRadarLive()` falla silenciosamente ante error de Claude — solo `console.error`, sin alerta | 🟠 ALTO | Preexistente, agravado por #1 | Enlazar con el FinOps/alerting pendiente (Oleada 4/5) |
| 4 | `SUPABASE_SERVICE_KEY` huérfana (`...cDWtdZ7d`, en `claves_privadas.txt`) sigue activa, sin revocar | 🟠 ALTO | Sin cambios — requiere acción manual | Revocar en https://supabase.com/dashboard/project/ozivmsvxbdtjkzleqbcy/settings/api-keys |
| 5 | `agents/diseno_aprobado.json` sin firma real vigente | 🟡 MEDIO | Bloqueado por #1 | Re-ejecutar `--aprobar-diseno` una vez resuelto el saldo |
| 6 | `.agent/` (119 archivos) sigue físicamente en disco, solo se le quitó el tracking de git | 🟡 MEDIO | Decisión pendiente | Definir si se borra del disco o se mantiene como herramienta local no versionada (es válido dejarlo, solo hay que decidirlo explícitamente) |
| 7 | Panel `/admin` y middleware `requireAdmin` | 🔴 AUSENTE | Sin cambios (Oleada 4 nunca iniciada) | Pendiente, ya cuantificado en la radiografía del 07-08 |
| 8 | Telemetría de terceros (Sentry/PostHog) y monetización (Stripe/pasarelas) | 🔴 AUSENTE | Sin cambios — pospuesto por decisión explícita previa del usuario | Sigue en espera de base de usuarios que lo justifique |
| 9 | 6 pantallas `FrozenPage` (Panel, Directorio, Favoritos, Calendario, Anexos, Logística, Dialéctica) | 🔴 AUSENTE | Sin cambios | Ver capítulo 4 para priorización sugerida |
| 10 | `INNGEST_EVENT_KEY=` vacío se dejó en `.env` mientras `STRIPE_SECRET_KEY=` sí se quitó | 🟢 BAJO | Inconsistencia menor de higiene | Alinear criterio: o se quitan todos los placeholders sin consumidor, o se documenta por qué se conservan |
| 11 | Crash nativo (`Assertion failed ... uv_async_t`) al hacer `process.exit(1)` en `agents/000_Orquestador.cjs` en Windows/Node | 🟢 BAJO | Nuevo hallazgo, cosmético | Mismo patrón que ya se documentó y evitó en `scripts/db-check.js` (usar `process.exitCode` en vez de `process.exit()`) — aplicar igual aquí |
| 12 | 7 de 22 carpetas de `agents/` siguen sin ningún skill implementado (`005_Radar1_minero`, `006_Radar2_Estratega`, `015_intelligence-core`, `03-analista-secop`, `07-ing-concreto_GFRC`, `08-estratega-neuromarketing`, `14-analista-comportamiento`) | 🟠 ALTO | Sin cambios | Ver capítulo 4 |
| 13 | Dos "orquestadores" con nombre casi idéntico y propósito totalmente distinto (`src/orchestrator-engine.js` de negocio vs. `agents/000_Orquestador.cjs` de gate/dev-ops) — confusión real, causó que mi auditoría original del 07-08 no leyera el segundo | 🟠 ALTO | Nuevo hallazgo | Ver capítulo 4 |
| 14 | Gate de arquitectura real solo se dispara manualmente (`--aprobar-diseno`), no está enganchado a ningún hook de commit | 🟡 MEDIO | Nuevo hallazgo, mejora de proceso | Ver capítulo 4 |

**Verificación de integridad ejecutada hoy (evidencia, no solo afirmación):**
- `node --check` OK en los 4 archivos de código tocados en esta reconciliación (`MiniMaxChat.jsx` vía build, `agents/000_Orquestador.cjs`, `supabaseClient.js`, `FormuladorPgController.js`).
- `npm run build` → 1535 módulos, `exit 0`, dos corridas consecutivas tras cada cambio.
- Servidor local levantado y probado en vivo: `/api/health` → `200 healthy`; `/api/minimax/status` → confirmado inexistente (ruta purgada); `/api/openrouter/status` → confirmado que exige auth (401 sin token, gate correcto).
- Llamada real (no simulada) a la API de Anthropic vía el gate de arquitectura — reveló el hallazgo #1 en vivo, no por inspección de código.

---

## 4. CAPÍTULO DEL ARQUITECTO — Optimización de RadFor-360 en Agentes y Skills

Esto es una recomendación, no una ejecución — cambia superficie de decisión de producto/proceso, no son bugs a corregir en modo transacción atómica.

### 4.1 Resolver la ambigüedad de nombres antes de construir nada más

`src/orchestrator-engine.js` (motor de negocio de la Ficha Técnica, corre por request) y `agents/000_Orquestador.cjs` (herramienta de desarrollo/gate de arquitectura, corre manualmente) comparten el nombre "Orquestador" y el prefijo "000". Esto no es cosmético: **fue la causa directa de que mi radiografía forense de esta misma mañana no auditara el segundo archivo** — asumí, al ver el nombre, que ya lo había cubierto al leer el primero. Si a un auditor completo con acceso a todo el disco le pasó, le va a pasar a cualquier agente o desarrollador nuevo que se sume. Recomiendo renombrar `agents/000_Orquestador.cjs` a algo que declare su función real — por ejemplo `tools/architecture-gate.cjs` o `agents/000_ORQUESTADOR/gate.cjs` — y reservar "Orquestador" únicamente para el motor de negocio si ese es el nombre que el producto necesita conservar.

### 4.2 El gate de arquitectura real es el activo más valioso construido hoy — está infrautilizado

`.claude/agents/architect.md` + `pedirVeredictoArquitecto()` es, con diferencia, la pieza más sólida de todo el sistema de agentes: es de solo lectura, tiene mandato específico, exige veredicto estructurado, y — como demostró el hallazgo #1 — **falla honestamente cuando algo está mal**, en vez de aparentar éxito. Hoy solo se dispara si alguien recuerda ejecutar `--aprobar-diseno` a mano. Eso es exactamente el mismo patrón de "convención documental sin mecanismo" que este gate fue creado para reemplazar (así lo dice su propio prompt, línea 23 de `architect.md`). Recomiendo engancharlo a un hook de pre-commit real (`.husky/pre-commit`, patrón que `Proy_03_RadarFondos` ya usa y que se podría traer aquí) — así "cero código sin diseño aprobado" deja de ser una promesa y pasa a ser un bloqueo mecánico, igual que ya pasó con el propio gate de arquitectura.

### 4.3 Las 7 carpetas de `agents/` sin skill son la próxima fuente de "ficción" si no se decide algo

`005_Radar1_minero`, `006_Radar2_Estratega`, `015_intelligence-core`, `03-analista-secop`, `07-ing-concreto_GFRC`, `08-estratega-neuromarketing` y `14-analista-comportamiento` tienen `IDENTITY.md` pero cero skills `.cjs` no vacíos — el propio inventario que `scripts/generar_reporte.cjs` genera cada 10 minutos ya las marca `definido: false`, así que no es un hallazgo oculto, es un hallazgo *visible y sin resolver*. La disciplina que ya se aplicó hoy con `MiniMaxChat.jsx` (una interfaz no puede mentir sobre lo que hay detrás) aplica igual aquí: una carpeta de agente con solo un `IDENTITY.md` es una promesa sin cumplir. Dos caminos honestos, no un tercero de dejarlo como está:
- **Implementar** al menos un skill real y ejecutable por carpeta (el criterio mínimo que ya usa `generar_reporte.cjs` — `IDENTITY.md` + `.cjs` no vacío — es un buen punto de partida, pero debería subir de "no vacío" a "pasa `node --check`" como mínimo verificable).
- **Archivar** las que no se van a construir en el horizonte visible, moviéndolas a `skills/_archivo_historico/` o un equivalente en `agents/`, siguiendo el patrón que el propio proyecto ya usó para `agents/11-esp-diseno-grafico-y-stitch/` y `proyectos/Proy_01_Donaciones/` (Registro de Saneamiento, `AGENTS.md` §VI).

### 4.4 El criterio de "definido" en `generar_reporte.cjs` es débil — subirlo de "no vacío" a "verificado"

Hoy un skill cuenta como válido si el archivo `.cjs` tiene tamaño > 0 bytes. Eso no prueba que el código funcione — solo que alguien escribió algo. Dado que esta misma sesión encontró dos bugs reales (`MiniMaxChat.checkStatus` sin token, `000_Orquestador.cjs` sin `dotenv`) que habrían pasado el criterio actual sin problema, recomiendo subir la barra: agregar un `node --check` (sintaxis) como mínimo automático dentro de `inspeccionarAgente()`, y — donde aplique — un smoke test mínimo por skill. Es barato, no requiere infraestructura nueva, y usa exactamente el mismo patrón de verificación que ya se usó manualmente hoy para cerrar esta operación.

### 4.5 FinOps deja de ser "posponible" después del hallazgo #1

La Oleada 5 (`docs/analisis_gaps_v1.md`) pospuso FinOps por decisión explícita del usuario, bajo el argumento de que no había volumen de tráfico que lo justificara. Ese argumento seguía siendo válido para "dashboard de costos por usuario" — pero **no cubre "saber cuándo el motor principal se quedó sin saldo"**, que es un problema operativo distinto y mucho más barato de resolver: no requiere Langfuse ni Helicone, solo que `AuditLogger` (que ya captura `CLAUDE_CHAT_ERROR`) dispare algo visible — aunque sea un `console.error` destacado o un correo vía el propio `BrevoEmailAdapter.js` ya construido — cuando la tasa de error de la API de Claude cruce un umbral en una ventana corta. Es una versión mínima, de una tarde, del mismo D1 que ya está documentado como decisión resuelta técnicamente, solo pendiente de construcción.

### 4.6 No construir un runtime multiagente nuevo — reforzar el patrón que ya funciona

`AGENTS.md` describe una "Topología del Escuadrón Élite" de 5 roles coordinando subordinados. La tentación después de una operación como la de hoy es construir eso de verdad, como proceso vivo. No lo recomiendo todavía: el patrón que **ya demostró funcionar dos veces hoy** — un módulo Node con una función por responsabilidad, un gate explícito antes de ejecutar, y una firma de integridad que se autoinvalida si el estado cambia (`Orchestrator000.run()` y ahora `pedirVeredictoArquitecto()`) — es barato, verificable, y no necesita un orquestador de procesos de larga duración para seguir siendo útil. La inversión de ingeniería en un runtime multiagente real (colas, IDs de proceso, recuperación de fallos) solo se justifica cuando haya casos de uso que el patrón síncrono actual no pueda cubrir — y hoy no los hay identificados.

---

**Mision Cumplida**
