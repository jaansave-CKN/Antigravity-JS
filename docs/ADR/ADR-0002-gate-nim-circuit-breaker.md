# ADR-0002 — Gate de arquitectura sobre NVIDIA NIM + Circuit Breaker + acuse de vigencia

- **Estado:** Propuesto (2026-09-26) — pendiente de veredicto `002` vía `node agents/architecture-gate.cjs --aprobar-diseno`
- **Decisores:** Jairo Antonio Salinas Velasco (D1-D4 de la directiva quirúrgica del 2026-09-26)
- **Alcance:** `agents/architecture-gate.cjs`, `agents/gate-proveedor.cjs` (nuevo), `agents/pmu/circuit_breaker.json` (nuevo, generado por código), frontmatter de `.claude/agents/*.md` (campo `doc_revisado`), `tests/gate/**`.

## 1. Contexto

1. El gate (`002` y subgates `003/004/005/006/009/010`) llama hoy a la API de Anthropic. La cuenta no tiene saldo: `agents/diseno_aprobado.json` está en `origen: soft_fail_api` (`http_400_sin_saldo`, 2026-09-25) — ningún cambio se evalúa de verdad.
2. `verificarVigenciaAgentes()` compara solo fechas de commit (`git log -1 --format=%ct`) del documento maestro contra cada `.claude/agents/*.md`. Un commit al documento marca a los 10 agentes; un commit vacío de contenido en el `.md` apaga la alerta sin revisión. Mide fechas, no revisión.
3. El PMU no tiene visibilidad del estado del proveedor de IA ni del mapa de mando del `001`.

## 2. Decisión

### 2.1 Proveedor
- **Principal:** NVIDIA NIM, API OpenAI-compatible, `fetch` nativo de Node (sin dependencia nueva).
  - Base URL en allowlist exacta: `https://integrate.api.nvidia.com/v1`. `GATE_NIM_BASE_URL` distinta → error de configuración, bloqueo duro.
  - Modelo por env `GATE_MODEL`, default ~~`deepseek-ai/deepseek-v4.1-flash`~~ → **`moonshotai/kimi-k3`** desde 2026-10-04: elegido por sonda real (`node agents/architecture-gate.cjs --sondear-proveedores`), kimi-k3 respondió en 2,1 s mientras deepseek-v4.1-flash no emitía primer byte en 15 s.
  - Key: `NVIDIA_API_KEY` en `.env`. Ausente → bloqueo duro (error de configuración, nunca soft-fail).
- **Secundario:** ~~**No hay cascada automática** NIM→Anthropic~~ — **enmendado 2026-10-04 por orden del dueño** (directiva de resolución del dictamen RadFor-360, tras caídas de NIM sin primer byte en 300 s que bloquearon el gate, con Anthropic sin saldo y el soft-fail prohibido): **cadena de conmutación entre modelos del catálogo NIM** de build.nvidia.com (misma `NVIDIA_API_KEY`, sin costo). Orden por defecto (`CADENA_NIM_DEFAULT`, sonda del 2026-10-04): `nvidia/nemotron-3-ultra-550b-a55b` (2,4 s) → `nvidia/nemotron-3-super-120b-a12b` (0,8 s) → `z-ai/glm-5.3` (11,4 s) → `deepseek-ai/deepseek-v4.1-flash` (al final, para cuando se recupere). `mistralai/mistral-large-2-instruct` se descartó: 404, retirado aunque siga en `/v1/models`. Cada eslabón salvo el último corre con contención (primer byte `GATE_FAILOVER_PRIMER_BYTE_MS`, 15 s por defecto, 1 intento) y tiene su propio breaker (`agents/pmu/circuit_breaker.<proveedor>__<modelo>.json`): uno abierto se salta al instante. `auth` y `config` abortan la cadena; cualquier otra falla del modelo (caída, cuota, contexto excedido, respuesta vacía, modelo retirado) pasa al siguiente. `GATE_FALLBACK_CHAIN` reemplaza el orden (`none` = sin conmutación). **Anthropic, de pago, solo entra si se lista explícitamente** (`anthropic[:modelo]`, ≈ COP 850 por evaluación de 002). El soft-fail sigue prohibido por la misma orden.
- Una sola función `llamarModelo({system, user, max_tokens})` en `agents/gate-proveedor.cjs`, usada por `002` y por todos los subgates.

### 2.2 Reintentos y timeout
- ~~Timeout duro 30 s por intento~~ — **enmendado 2026-09-26** tras fallo en vivo (`timeout_30s` en `--aprobar-diseno`): 30 s totales con `stream:false` era aritméticamente incompatible con `max_tokens` 4096 (002) / 8192 (subgates) sobre ~60 000 caracteres de diff (exige >136 tokens/s sostenidos más prefill).
- Streaming SSE (`stream:true`) con tres relojes por intento (`AbortController`), el primero que vence decide el código:
  - **Primer byte 300 s** (cola + prefill; escala con el tamaño del prompt — 120 s no alcanzó con ~185 000 caracteres) → `timeout_sin_respuesta`.
  - **Inactividad 30 s** entre fragmentos (servidor colgado; fragmentos de razonamiento y `: keep-alive` cuentan como vida) → `timeout_inactividad`.
  - **Total 600 s** por intento, configurable con `GATE_TIMEOUT_TOTAL_MS` (entero 30 000-900 000; inválido = bloqueo duro `config`) → `timeout_total`. Calibrado con la primera llamada real (21 642 prompt + 4 039 completion tokens en 224 s ≈ 18 tokens/s): `max_tokens` 8192 ≈ 455 s + prefill.
- Presupuesto del diff de 002: 60 000 → **130 000 caracteres** (`LIMITE_DIFF_002`, ≈ 40 000 tokens; medido: 60 000 = 21 642 tokens respondió, 185 000 no emitió primer byte); `max_tokens` de 002: 4096 → **8192** (el primer veredicto real usó 4039/4096). Prioridad: `.claude/agents/` → `docs/ADR/` → `agents/{architecture-gate,gate-proveedor}.cjs` → `src/` → `server.js` → `public/` → `AGENTS.md` → `docs/` → `tests|scripts/` → resto. Archivos eliminados y binarios se resumen por ruta.
  - Stream cerrado sin `finish_reason` ni `[DONE]` → `stream_incompleto` (`caida`); nunca se parsea un veredicto parcial. Error a mitad de stream → clasificación estructurada (`stream_<código>`).
  - Si el servidor ignora `stream:true` y responde JSON, se procesa por el camino clásico.
- Hasta 2 reintentos con backoff exponencial (1 s, 2 s) + jitter 0-500 ms, **solo** en 429, 5xx, `timeout_inactividad`, `stream_incompleto` y error de conexión. Nunca en 400/401/402/403/404 ni en `timeout_total` ni en `timeout_sin_respuesta` (el mismo prompt volvería a vencer el plazo; medido: 3 intentos sin primer byte = 366 s perdidos).
- Breaker con key rotada: si la apertura crítica (auth) pertenece a otra huella de key, la falla no crítica de la key nueva reemplaza esa evidencia y activa el cooldown normal (antes: 403 fantasma en el PMU y sonda sin cooldown en cada llamada).

### 2.3 Clasificación de fallas

| Categoría | Casos | Efecto en el gate | Circuit breaker |
|---|---|---|---|
| `cuota` | 402, 429, 400 con `insufficient_quota` / `quota exceeded` / `credit balance` | soft-fail si está autorizado (Axioma II.1) | suma fallo |
| `caida` | 5xx, timeout > 30 s (incluida la lectura del cuerpo), error de red con código real | soft-fail si está autorizado | suma fallo |
| `auth` | 401, 403 | **bloqueo duro + ALERTA CRÍTICA DE PROVEEDOR EXTERNO** | abre de inmediato |
| `politica` | 404, 400 de modelo retirado/no encontrado | **bloqueo duro + ALERTA CRÍTICA** | abre de inmediato |
| `solicitud` | otro 400 (incl. `context_length`), respuesta vacía/truncada, excepción no de red | bloqueo duro | no cuenta |
| `config` | key ausente o malformada, base URL no oficial (NIM o Anthropic) | bloqueo duro | no llama a la red |

Decisión D2: 401/403 nunca abren el gate — si lo hicieran, una key inválida sería un bypass.

### 2.4 Circuit breaker
Estado persistido en `agents/pmu/circuit_breaker.json` (generado por código, nunca a mano):
`{estado: cerrado|abierto|semiabierto, fallos_consecutivos, umbral: 3, abierto_desde, cooldown_s: 900, ultimo_error: {codigo, http, categoria, timestamp}, ultimo_exito}`.
- `cerrado` → llama. 3 fallos consecutivos de `cuota`/`caida` → `abierto`. `auth`/`politica` → `abierto` en el primer fallo.
- `abierto` → **no toca la red** (cero gasto). Devuelve un error con la categoría del último fallo: si fue `cuota`/`caida` es elegible para soft-fail; si fue `auth`/`politica` sigue siendo bloqueo duro.
- Tras `cooldown_s` → `semiabierto`: 1 llamada de prueba. Éxito → `cerrado`; fallo → `abierto` otra vez.
- El PMU (`estado_operativo.json`) expone `proveedor_ia` y `alertas_criticas_proveedor` (tipo `ALERTA CRÍTICA DE PROVEEDOR EXTERNO`) derivadas del breaker.

### 2.5 Protección de datos enviados al tercero
El endpoint gratuito de NIM es un servicio de terceros; su política de retención de prompts no está verificada en este repo (pendiente humano). Antes de enviar cualquier diff:
- se eliminan del diff las secciones de archivos `.env*` (salvo `.env.example`), `*.pem`, `*.key`;
- se redactan valores que matcheen `PATRONES_SECRETOS` del gate más `nvapi-…`, `sk-ant-…`, `sk-…`, `ghp_…`.
- La key nunca se imprime ni se escribe en telemetría: todo texto de error pasa por un redactor.

### 2.6 Vigencia por acuse explícito
Reemplaza la comparación de fechas:
- Cada `.claude/agents/*.md` declara en su frontmatter `doc_revisado: <sha>` — el commit del documento maestro que el agente (o `007` en su nombre) revisó.
- Alertas: `sin_acuse` (campo ausente), `acuse_invalido` (sha que no es un commit que tocó el documento), `agente_desactualizado` (commits posteriores al sha cuyas líneas agregadas mencionan el ID del agente, p. ej. `005`, `005_INGENIERO_BACKEND`, `005-ingeniero-backend`).
- Commits posteriores que no mencionan al agente no lo marcan: no es un falso positivo que obligue a tocar archivos sin motivo.

### 2.7 Mando del 001
El PMU publica `mapa_delegacion_001`: por agente, propósito (`description`), skills, gate y permisos, y si la matriz de ruteo de `.claude/agents/001-orquestador-maestro.md` lo enruta (`→ \`00X_…\``). Alerta `agente_sin_mando` si un agente no aparece. El `001` **no** recupera `Write`/`Edit`/`Bash` (decisión 2026-08-12, no revocada).

### 2.8 Endurecimiento tras auditoría 008 (2026-09-26, Protocolo Titán, 47/100 NO APTO → remediado)
| # | Hallazgo 008 | Corrección |
|---|---|---|
| 1 | `GATE_PROVIDER=anthropic` + `ANTHROPIC_BASE_URL` falso forjaba `api_directa` y exfiltraba la key (el SDK lee la env por su cuenta) | `resolverConfig`: base URL no oficial → `config` (bloqueo duro); `baseURL` oficial explícito al SDK |
| 2 | Key malformada → `TypeError` en fetch → clasificada `caida` → soft-fail | Validación de formato de key (`config`); solo códigos de red reales (`ECONN*`, `ENOTFOUND`, `UND_ERR_*`…) o el timeout propio son `caida` — cualquier otra excepción es `solicitud` |
| 3 | Carrera: un 503 concurrente pisaba la apertura por 403 → `circuito_abierto` soft-fail | Campo `categoria_apertura`; una apertura crítica no se degrada mientras siga abierta; escritura atómica tmp+rename |
| 4 | `filtrarSecretosDiff` dejaba pasar 16/17 formatos | Asignaciones `*KEY/*SECRET/*TOKEN/*PASSWORD/*CREDENTIAL/*AUTH` en .env/YAML/JSON/código, prefijos de proveedor (`sk-or-v1-`, `sk_live_`, `AIza`, `tvly-`, `gsk_`, `hf_`, `glpat-`, `xox*-`…), `user:pass@` en URIs, cualquier `PRIVATE KEY`, archivos de credenciales/llaves; rutas entre comillas; cabecera no parseable → sección omitida; `git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/` |
| 6 | El timeout no cubría la lectura del cuerpo | `res.text()` dentro del mismo `AbortController` |
| 7 | 400 "exceeded/limit" (p. ej. `context_length_exceeded`) → cuota → soft-fail | Solo `insufficient_quota` / `quota exceeded` / `credit balance` son cuota; `context_length`/`max_tokens` → `solicitud` |
| 11 | `content:null` no manejado | `respuesta_vacia` / `respuesta_truncada`, bloqueo duro |
| 12 | `mencionaAgente` marcaba hashes hex y nombres de migración | Alfanuméricos y `_`/`-` excluidos alrededor del prefijo |
| 14/15 | Etiqueta "Anthropic" bajo NIM; `huella_key` en PMU versionado | Etiquetas neutrales; `breakerPublico()` sin huella; `circuit_breaker.json` en `.gitignore` |

**No remediado en este ADR (requiere decisión de `002`/usuario):** (5) `soft_fail_api` no expira ni se corrobora contra telemetría — diseño del 2026-09-25; (8) el soft-fail es provocable cortando la red y `GATE_SOFT_FAIL=true` es persistente en `.env` — decisión del usuario; (9) sin lock entre procesos (solo escritura atómica); (10) la suite histórica escribe archivos de gobierno reales.

## 3. Consecuencias
- (+) El gate vuelve a evaluar de verdad sin costo, con degradación controlada y visible.
- (+) El PMU distingue "revisado" de "commit reciente".
- (−) Dependencia de un endpoint gratuito sin SLA; mitigada por el breaker y el soft-fail autorizado.
- (−) El diff (código fuente, sin secretos) sale a un tercero. Requiere revisión humana de la política de datos de NVIDIA.
- (−) La calidad de juicio de `deepseek-v4.1-flash` frente al contrato JSON/Zod de cada agente no está probada; los esquemas Zod siguen siendo fail-closed.

## 4. Verificación
Tests `node:test` en `tests/gate/` (clasificación HTTP, transiciones del breaker, 401 que no abre el gate, timeout simulado, filtrado de secretos, key ausente de logs) + prueba negativa real con key inválida en el entorno del proceso.
