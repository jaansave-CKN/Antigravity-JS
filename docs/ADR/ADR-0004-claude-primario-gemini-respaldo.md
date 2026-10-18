# ADR-0004 — Proveedores de IA: Claude primario, Gemini de respaldo, descubrimiento dinámico de modelos

- **Estado:** Propuesto (2026-10-08). Al aprobarse **reemplaza** ADR-0002 §2.1 (cadena NIM del gate) y ADR-0003 §6 (NIM en producción). Las demás partes de esos ADR (contrato de errores, breakers, contención de tiempos, FinOps, filtro de secretos) siguen vigentes y se aplican a los dos proveedores nuevos.
- **Decisor:** Jairo Antonio Salinas Velasco ("Reconfiguración de Arquitectura de Modelos — Claude Core + Gemini Dynamic Fallback", 2026-10-08).
- **Alcance:**
  - código: `agents/gate-proveedor.cjs`, `src/shared/infrastructure/LlmGateway.js`, `agents/architecture-gate.cjs` (002, subgates, PMU, sonda), `scripts/auditor_008_advisory_gate.cjs`, `server.js` (health y arranque), `src/modules/radar/m1Pipeline.js` (solo textos);
  - configuración: `render.yaml`, `.env.example`, `.github/workflows/gate.yml`;
  - pruebas asociadas.

## 1. Contexto (hechos verificados el 2026-10-08)

1. **Orden del dueño:**
   - Claude es la primera opción obligatoria para razonamiento, arquitectura, auditoría y código.
   - Gemini es el único respaldo.
   - Los modelos nuevos de ambas familias se reconocen solos por prefijo (`claude-*`, `gemini-*`).
   - Se suprimen los proveedores externos (NVIDIA NIM, Groq, OpenRouter, DeepSeek y similares).
   - La ausencia de keys no debe producir advertencias, fallos de CI ni bloqueos del pipeline.
2. **La cuenta de Anthropic no tiene saldo.** `--sondear-proveedores` con `GATE_PROVIDER=anthropic` devolvió `http_400_sin_saldo`. El dueño recargará antes del cierre: es la condición de salida del §5.
3. **No existe ninguna integración con Gemini en el código.** Es una integración nueva, no una reconfiguración.
4. **El servidor (Render) y la CI (GitHub Actions) no tienen acceso al selector de modelos de un IDE.** Claude y Gemini se consumen con sus API y sus keys. El "descubrimiento dinámico" se implementa con los endpoints de listado de modelos de cada proveedor.
5. **El escuadrón (`.claude/agents/*.md`) ya declara `model: inherit`.** Corre sobre el modelo Claude de la sesión de Claude Code, así que no requiere cambios.
6. **Estado actual del código:**
   - NIM aparece en 15 archivos;
   - `GROQ_API_KEY` y `OPENROUTER_API_KEY` solo existen en `.env.example`, sin consumidor;
   - el SDK `@anthropic-ai/sdk` solo se usa en `agents/gate-proveedor.cjs` y en `agents/architecture-gate.cjs` (en este último, únicamente para un `instanceof` de clasificación de errores).

## 2. Decisión

### 2.1 Proveedores admitidos
- **Solo dos proveedores:** `anthropic` (familia Claude) y `gemini` (Google Gemini API).
- **Se retira NIM** del código, la configuración, `render.yaml`, `.env.example` y la CI. También se retiran de `.env.example` las keys sin consumidor (`GROQ_API_KEY`, `OPENROUTER_API_KEY`).
- **URL base fija, sin override por entorno:**
  - `https://api.anthropic.com/v1`;
  - `https://generativelanguage.googleapis.com/v1beta`.

  Sin variable que las redirija, no hay vector para enviar keys o diffs a un host falso. Sustituye a los chequeos de `ANTHROPIC_BASE_URL` y `GATE_NIM_BASE_URL`.
- **Keys:**
  - `ANTHROPIC_API_KEY`;
  - `GEMINI_API_KEY`, o `GOOGLE_API_KEY` si la primera no está definida (convención del SDK oficial de Google).

  Formato: ASCII imprimible sin espacios. Una key malformada sigue siendo error de configuración.
- **Transporte:** `fetch` nativo con streaming SSE para ambos (Messages API de Anthropic y `streamGenerateContent?alt=sse` de Gemini). Se mantienen los mismos tres relojes (primer byte, inactividad y total), la misma clasificación `ErrorProveedor` (`auth`, `cuota`, `politica`, `caida`, `solicitud`, `config`), breakers por modelo y reintentos. Se retira el uso del SDK de Anthropic en la capa de proveedor; un solo patrón HTTP queda inyectable con `fetchImpl` para las pruebas.

### 2.2 Orden por tarea (Claude siempre primero; Gemini nunca primario si hay key de Claude)
| Tarea | Usos | Cadena |
|---|---|---|
| `razonamiento` | gate 002, subgates, 008 en CI, síntesis del M1 | Claude Opus más reciente → Claude Sonnet más reciente → Gemini Pro más reciente → Gemini Flash más reciente |
| `rapido` | plan del M1, AGT-052 (`/api/chat`), ping de salud | Claude Sonnet más reciente → Claude Haiku más reciente → Gemini Flash más reciente → Gemini Flash-Lite más reciente |

- Una familia sin key se omite de la cadena **sin advertencia**.
- Máximo 2 modelos por familia en la cadena, así la latencia de la conmutación queda acotada.
- Se conservan las reglas de conmutación de ADR-0002:
  - entre eslabones, una falla del modelo (caída, cuota, modelo retirado, respuesta vacía) pasa al siguiente;
  - `auth` y `config` saltan **a la otra familia** (key distinta), no abortan toda la cadena.

  Este último punto cambia ADR-0002: allí una sola key cubría todos los eslabones.

### 2.3 Descubrimiento dinámico de modelos
- **Listado de Claude:** `GET /v1/models` (`x-api-key`, `anthropic-version: 2023-06-01`, paginado con `has_more`/`after_id`). Se aceptan los ids con prefijo `claude-`.
- **Listado de Gemini:** `GET /v1beta/models` (`x-goog-api-key`, paginado con `nextPageToken`). Se aceptan los ids con prefijo `gemini-` que declaren `generateContent`. Se excluyen las variantes que no son de texto (`embedding`, `tts`, `image`, `live`, `audio`, `aqa`) y los alias sin versión (`*-latest`).
- **Clasificación y orden:**
  - **Gama:** la de Claude (`opus`, `sonnet`, `haiku`) y la de Gemini (`pro`, `flash`, `flash-lite`) se leen del id.
  - **Orden en Claude:** por `created_at` del API, el más nuevo primero. Si falta, por la versión del id.
  - **Orden en Gemini:** por versión numérica descendente. Con la misma versión, la estable va antes que `preview`/`exp`.
  - **Gamas nuevas:** un modelo de una gama que no está en la tabla (una familia nueva bajo `claude-*` o `gemini-*`) entra automáticamente después de las gamas conocidas de su proveedor, por recencia. Así ninguna versión nueva requiere tocar código.
- **Caché:** archivo JSON con TTL de 24 h (`LLM_DESCUBRIMIENTO_TTL_H`, rango 1-168).
  - En el gate vive en `agents/pmu/modelos_descubiertos.json`, ignorado por git.
  - En la aplicación vive en `logs/llm/modelos_descubiertos.json`.

  Si el listado falla (red, 5xx), se usa la caché aunque esté vencida. Sin caché, la familia queda fuera de esa llamada con la misma clasificación de error, y la cadena pasa a la otra familia. No hay lista de nombres de modelo quemada en el código.
- **Fijación opcional:** `LLM_MODELOS_CLAUDE` y `LLM_MODELOS_GEMINI` (ids separados por coma, en orden) reemplazan el descubrimiento de esa familia, para reproducibilidad o para retirar un modelo problemático. Cada id debe empezar por el prefijo de su familia; si no, es error de configuración.
- **Trazabilidad:** cada veredicto del gate y cada respuesta de la aplicación ya registran `proveedor` y `modelo`. El PMU muestra la última lista descubierta.

### 2.4 Ausencia de keys
- **Aplicación:** sin ninguna de las dos keys, la IA queda "no configurada". `/api/health` lo reporta como degradado y el arranque lo informa sin advertencia de proveedor externo. No hay referencias a NIM.
- **Gate 002 y subgates:** necesitan al menos una de las dos keys. Sin ninguna, bloqueo duro de tipo `config`, igual que hoy: es el mandato del gate (Axioma II.1). El soft-fail sigue prohibido por orden del dueño; la ruta de opt-in del código no cambia. *(enmendado: ver §6)*
- **008 en CI:** sin keys, el paso se omite con exit 0, como hoy.

### 2.5 CI (`.github/workflows/gate.yml`, mandato de 006)
- El paso del 008 recibe `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}` y `GEMINI_API_KEY: ${{ secrets.GOOGLE_API_KEY }}`.
- El secreto `GOOGLE_API_KEY` ya existe en el repositorio. No hay forma de verificar desde aquí que sea una key de Gemini; si no lo es, el paso lo informa como `auth` y sigue.
- La advertencia del IDE sobre `secrets.ANTHROPIC_API_KEY` desaparece solo cuando el dueño crea ese secreto. No se suprime quitando la referencia.

### 2.6 FinOps
- Tarifas de referencia en USD por millón de tokens (entrada/salida), por gama, convertidas a COP con la TRM:

  | Gama | Entrada | Salida |
  |---|---|---|
  | Opus | 5 | 25 |
  | Sonnet | 3 | 15 |
  | Haiku | 1 | 5 |
  | Gemini Pro | 2 | 12 |
  | Gemini Flash | 0,5 | 3 |
  | Gemini Flash-Lite | 0,1 | 0,4 |

- `LLM_TARIFAS_USD` (JSON `{"<gama o id>": {"entrada": n, "salida": n}}`) las reemplaza sin tocar código.
- Los dos proveedores reportan uso real en streaming (`message_start`/`message_delta` y `usageMetadata`). La estimación por caracteres queda solo como respaldo.

## 3. Riesgos y consecuencias

1. **Costo:** todo el tráfico pasa a ser de pago (no hay más eslabón gratuito). El costo por ciclo se reporta en COP.
2. **Privacidad (Ley 1581):** en el nivel gratuito de la Gemini API, Google puede usar el contenido para mejorar sus productos. Los diffs del gate y las consultas del M1 pueden contener datos personales. **Requisito del dueño:** la key de Gemini debe pertenecer a un proyecto con facturación activa. El código no puede verificarlo.
3. **Disponibilidad del gate:** mientras Anthropic no tenga saldo, el gate dependerá solo de Gemini. Si las dos familias fallan, ningún commit pasa (soft-fail prohibido). *(enmendado: ver §6)*
4. **Determinismo:** el descubrimiento actualiza el modelo sin intervención. Cada veredicto registra el modelo; `LLM_MODELOS_*` fija la versión cuando se necesite reproducibilidad.
5. **Pruebas:** unas 60 pruebas del proveedor están escritas sobre NIM y se reescriben con mocks de los dos protocolos. Ninguna prueba toca la red.

## 4. Plan de entrega (commits atómicos, cada uno con el gate)

1. Este ADR.
2. Capa de proveedor:
   - `gate-proveedor.cjs`: dos transportes SSE, descubrimiento y caché, perfiles;
   - `LlmGateway.js`;
   - `architecture-gate.cjs`: cadena por tarea, PMU, sonda y retiro del `instanceof` del SDK;
   - 008;
   - `server.js` y `m1Pipeline.js` (textos de health y arranque);
   - pruebas.
3. Configuración (`render.yaml`, `.env.example`), con el `gate.yml` a cargo de 006.
4. Documentación as-built (007): enmiendas en ADR-0002 y ADR-0003 y en `AGENTS.md` §MOTORES.

## 5. Criterios de cierre (evidencia física)

| # | Criterio | Evidencia |
|---|---|---|
| 1 | Suite completa en verde | `npm run test:gate`, exit 0 |
| 2 | Build de producción | `npm run build`, exit 0 |
| 3 | Descubrimiento real | `node agents/architecture-gate.cjs --sondear-proveedores` lista modelos `claude-*` y `gemini-*` descubiertos y los marca vivos |
| 4 | Claude primario real (requiere el saldo recargado) | La sonda muestra el primer eslabón Claude vivo; un `--aprobar-diseno` real registra `modelo: claude-…` |
| 5 | CI | Corrida verde en `master` |

## 6. Enmienda 2026-10-12 — soft-fail y re-evaluación

Redactada por `007` (paso 4 del §4). §2.4 y §3.3 dicen "soft-fail prohibido por orden del dueño". `AGENTS.md:23` (Axioma II.1) describe un soft-fail con opt-in vigente desde 2026-09-25. Esta sección reconcilia los dos textos con el comportamiento del código al 2026-10-12. Las referencias de línea son de `agents/architecture-gate.cjs` tal como entra en el commit que agrega esta sección, salvo que se indique otro archivo.

### 6.1 Regla vigente

1. **Prohibido por defecto.** Sin opt-in, `resolverPermisoSoftFail()` devuelve `permitido: false` (`:830-841`). Un fallo de disponibilidad del proveedor termina entonces en rechazo con exit 1 (`:2605-2619`).
2. **Qué puede ser soft-fail.** Solo las categorías `cuota` y `caida` (`esElegibleSoftFail`, `agents/gate-proveedor.cjs:81-83`, usada por `clasificarFalloApi`, `:803-811`). `auth`, `politica`, `solicitud` y `config` siempre bloquean.
   - Una familia cuya key fue rechazada **por autenticación** en la última validación de `--pmu-status`, con la misma huella de key que hay hoy en el entorno, queda fuera de la cadena (`familiasRechazadas`, `agents/gate-proveedor.cjs:966-977`, consumida en `:237`). Así un fallo elegible del primario no termina reportado como el error de auth del respaldo.
   - Si todas las familias con key quedan fuera, el error es `todas_las_keys_rechazadas` (categoría `auth`, bloqueo duro, `agents/gate-proveedor.cjs:1113-1115`).
   - Saldo o cuota **no** excluyen a la familia: siguen siendo la condición elegible a soft-fail (`agents/gate-proveedor.cjs:966-971`, comentario de diseño).
3. **Única excepción admitida por el dueño: autorización nominal por commit.** Se pide con `--permitir-soft-fail --autorizado-por "<nombre>"` en el `--aprobar-diseno`/`--aprobar-subgate` de ese commit.
   - Queda registrada como `origen: "soft_fail_api"` con `soft_fail: {codigo, detalle, autorizado_por, habilitado_via}` y sin diferimientos (`construirRegistroSoftFail`, `:2422-2439`). `validarOrigenVeredicto` la acepta solo con esos campos completos (`:850-860`).
   - En 002 lleva además el `amarre` del diff staged (`:2595-2597`), así que no cubre ningún otro cambio.
   - La autorización vale para un commit. No es una habilitación general.
4. **Re-evaluación obligatoria.** Todo commit firmado como `soft_fail_api` queda pendiente de `node agents/architecture-gate.cjs --reevaluar-commit <sha>` cuando vuelva un proveedor.
   - Ese modo (`:2283-2329`) evalúa con el modelo real el diff `<sha>~1..<sha>`. Nunca hace soft-fail ni modifica `agents/diseno_aprobado.json`.
   - Registra un evento `tipo: "reevaluacion_commit"` en `agents/pmu/telemetria.jsonl` (`:2304-2312`) y sale con exit 0 solo si 002 aprueba. El campo `resultado` puede ser:
     - `aprobado`;
     - `rechazado`, solo si el modelo emitió un veredicto válido (`v.modelo` presente);
     - `api_no_disponible` (proveedor caído o sin saldo);
     - `sin_evaluacion`: auth, configuración, git o JSON ilegible, que no son un veredicto del modelo (`:2306-2310`).
   - La consola también los distingue: "RECHAZADO por 002" frente a "sin evaluación…" (`:2319-2321`). Este cambio salió de un rechazo de 002 en sesión, el 2026-10-18.
   - `--verificar-commit` (`:2236-2281`) muestra, para todo origen distinto de `api_directa`, uno de tres estados (`:2273-2278`):
     - 🟢 la última evaluación real es `aprobado`;
     - 🔴 la última evaluación real es `rechazado`;
     - 🟡 pendiente, con el comando exacto, si no hay ninguna evaluación real.

     El dato sale de `reevaluacionDe()` (`:1396-1403`), que usa una **lista blanca**: solo `aprobado` y `rechazado` cuentan. `api_no_disponible` y `sin_evaluacion` no aprueban, no rechazan y no tapan una evaluación real anterior.
   - Este modo va incluido en el commit que agrega esta sección. Pruebas: `scripts/architecture-gate.test.cjs:1170-1217`. El test de `reevaluacionDe` (`:1170-1188`) cubre `sin_evaluacion` y un resultado desconocido.
5. **Detección de saldo.** El listado de modelos de Anthropic responde 200 aunque la cuenta no tenga saldo. Por eso `--pmu-status` hace una llamada real mínima: `max_tokens: 1`, el modelo más barato de la tarea `rapido`, 1 intento (`validarKeys({sondaSaldo})`, `agents/gate-proveedor.cjs:926-950`, invocada en `:2363`). Cada corrida de `--pmu-status` consume tokens reales.

**Discrepancia del canal `.env`: cerrada el 2026-10-12.** El cierre va incluido en el commit que agrega esta sección. Las entradas antiguas de `agents/pmu/telemetria.jsonl` que mencionan `GATE_SOFT_FAIL=true … en .env` son históricas (el archivo es append-only) y no describen la regla vigente.

- **Código:** `resolverPermisoSoftFail()` exige `--permitir-soft-fail` y `--autorizado-por "nombre"` en la misma invocación (`agents/architecture-gate.cjs:827-841`, comentario "Canal .env retirado 2026-10-12" en `:827`). Si el nombre falta o es otro flag, no hay permiso (`:836-839`).
  - `GATE_SOFT_FAIL=true` en `.env` ya no habilita nada; solo se informa como residuo (`:833-834`).
  - El responsable ya no se toma del `.env`.
- **Variables retiradas:** `GATE_SOFT_FAIL` y `GATE_SOFT_FAIL_AUTORIZADO_POR` entraron a `VARIABLES_RETIRADAS` (`:1882-1883`).
- **Plantilla:** `.env.example:76-78` ya no las declara; solo deja una nota con el comando por commit.
- **PMU:** expone `politica_api.modo: 'soft_fail_solo_por_commit'` y `residuo_env_ignorado` (`:1794-1797`).
- **Texto del axioma:** `AGENTS.md:23` corregido ("el canal `.env` … fue retirado del código el 2026-10-12 y ya no habilita nada").
- **Prueba:** `scripts/architecture-gate.test.cjs:1046-1057`, test «resolverPermisoSoftFail: solo flag + --autorizado-por en la invocación; el .env completo ya NO habilita (canal retirado)».

### 6.2 Precedente: commit `fe13a2f`

- **Commit:** `fe13a2f3fb523a74dc2f197235418690433c2bdb`, padre `2b8b499` (`.git/logs/HEAD:104`), rama `feat/gate-nim-circuit-breaker`. `origin/master` está en `f0cf35f` (`.git/refs/remotes/origin/master`), así que **no está en `master`**. Que la rama esté publicada en `origin` lo declaró el ejecutor: en `.git/refs/remotes/origin/` no hay ref de seguimiento de esa rama para comprobarlo.
- **Firma:** `agents/diseno_aprobado.json`, tal como estaba el 2026-10-12 antes de la firma del commit que agrega esta sección (que lo reemplaza), contenía:
  - `origen: "soft_fail_api"` y `soft_fail.codigo: "circuito_abierto"`, con detalle "último error http_400_sin_saldo";
  - `autorizado_por: "Jairo Antonio Salinas Velasco"` y `habilitado_via: "flag"`;
  - `amarre.base_sha: 2b8b499…` (el padre de `fe13a2f`), `archivos: 286`.

  La cadena registrada en el detalle solo tiene `anthropic:claude-opus-5-5` y `anthropic:claude-sonnet-5-5`. Gemini quedó fuera por auth: la telemetría `agents/pmu/telemetria.jsonl:1600` muestra `gemini … listado_http_400_auth`. No se verificó que este archivo sea idéntico al blob commiteado en `fe13a2f` (`007` no tiene Bash); el `base_sha` sí coincide.
- **Autorización:** la dio el dueño el 2026-10-12, **solo para ese commit**. Levantó para ese caso la prohibición de §2.4. No se extiende a ningún commit posterior.
- **Revisión previa:** el ejecutor declara que 002 dio `aprobado: true`, 005 `aislado_y_seguro` y 006 `infraestructura_segura: true` dentro de la sesión. No hay registro `api_directa` de esas revisiones en disco. La telemetría registra los subgates 005 y 006 como `soft_fail` (`agents/pmu/telemetria.jsonl:1569`, `:1571`, `:1580`, `:1589`).
- **Re-evaluación:** se intentó el 2026-10-13T00:28:05Z (UTC), con resultado `api_no_disponible` por `http_400_sin_saldo` (`agents/pmu/telemetria.jsonl:1604-1605`). Sigue **🟡 pendiente**.

### 6.3 Estado de los criterios de cierre (§5) al 2026-10-12

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | `npm run test:gate` | ✅ 302/302, exit 0 | Declarado por el ejecutor; `007` no lo re-ejecutó (no tiene Bash) |
| 2 | `npm run build` | ✅ exit 0 | Declarado por el ejecutor, 2026-10-12; no re-ejecutado por `007` |
| 3 | Descubrimiento real | 🟡 pendiente | Anthropic sin saldo, Gemini con key inválida (`agents/pmu/telemetria.jsonl:1600`) |
| 4 | Claude primario real | 🟡 pendiente | Requiere saldo de Anthropic. Ningún `--aprobar-diseno` registra `api_directa` con `modelo: claude-…` en esta ronda |
| 5 | CI verde en `master` | 🟡 pendiente | `fe13a2f` no está en `origin/master` (`f0cf35f`) |

El campo **Estado** del encabezado de este ADR sigue en "Propuesto". No hay en disco un veredicto `api_directa` de 002 sobre él. Esta enmienda no lo cambia.
