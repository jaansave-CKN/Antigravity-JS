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
- **Gate 002 y subgates:** necesitan al menos una de las dos keys. Sin ninguna, bloqueo duro de tipo `config`, igual que hoy: es el mandato del gate (Axioma II.1). El soft-fail sigue prohibido por orden del dueño; la ruta de opt-in del código no cambia.
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
3. **Disponibilidad del gate:** mientras Anthropic no tenga saldo, el gate dependerá solo de Gemini. Si las dos familias fallan, ningún commit pasa (soft-fail prohibido).
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
