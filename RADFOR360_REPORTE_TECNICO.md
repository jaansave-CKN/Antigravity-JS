# RADFOR-360 — Reporte Técnico Exhaustivo de Codebase
**Fecha:** 2026-07-21 · **Alcance:** `backend/`, `client/src/`, `server.js`, migraciones SQL · **Método:** inspección directa de código fuente, sin resúmenes conceptuales.

> **Hallazgo transversal más importante:** el modelo de datos "conceptual" descrito en la directiva (`Portfolio`, `Problema`, `TeoriaDelCambio`, `Indicadores`, `Anexos`, `Score`) **no coincide con los nombres reales de tablas** en el esquema SQL. El sistema real usa `projects/proyectos`, `project_budgets`, `match_scores`, `objetivos_arbol`, etc. Se documenta la correspondencia exacta abajo, y se declara explícitamente qué NO existe.

---

## 1. Esquema de Base de Datos y Multi-Tenancy

Sin Prisma/TypeORM/Mongoose — es SQL puro (`pg` driver) en `backend/migrations/001…010_*.sql`, con un bootstrap SQLite paralelo en `server.js` (dev). **Ambos esquemas están desincronizados entre sí** (ver estados, abajo).

### 1.1 Tablas reales vs. entidades solicitadas

| Entidad solicitada | Tabla real | Existe |
|---|---|---|
| Portfolio | — | **NO EXISTE.** Solo existe `organizations` (tenant/billing, 1:N con projects vía `tenant_id`), no una agrupación de 20–500 proyectos. Sin `portfolio_id` FK, sin CHECK de rango. |
| Projects | `projects` (canónica, ex-`proyectos`) + vista compat `proyectos` + tabla duplicada `proyectos_formulados` | Sí, pero triplicada/inconsistente |
| Problema | — | **NO EXISTE** como tabla. Solo columna suelta `proyectos.problem_statement TEXT` (`server.js:604`) y un `tipo='CENTRAL'` dentro de `objetivos_arbol`. |
| TeoriaDelCambio | — | **NO EXISTE**, ninguna variante de nombre, en ningún archivo. |
| Indicadores | — | **NO EXISTE** como tabla/columna estructurada. |
| Presupuesto | `project_budgets` (APU detallado) + `proyectos.presupuesto JSONB` (blob libre) | Sí, duplicado en dos formas distintas |
| Anexos | — | **NO EXISTE.** "Anexos" solo aparece como comentario de código (`server.js:2477`, whitelist de tipos de subida). |
| Score | `match_scores` (0–1 en Postgres, 0–100 en el bootstrap SQLite — **inconsistente**) + `projects.audit_score` | Sí, con definición de rango contradictoria |

### 1.2 DDL verbatim

**`project_budgets`** (`001_postgres_schema.sql:85-118`, renombrada a inglés en `003_schema_english_canonical.sql:126-139`):
```sql
CREATE TABLE IF NOT EXISTS project_budgets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id       UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL,
  fase              TEXT NOT NULL CHECK (fase IN ('NEGRA','GRIS','BLANCA')),
  capitulo          TEXT NOT NULL,
  item              TEXT NOT NULL,
  cantidad          NUMERIC(14,4) NOT NULL DEFAULT 0,
  rendimiento_real  NUMERIC(10,4) NOT NULL,
  rendimiento_ref   NUMERIC(10,4) NOT NULL,
  desviacion_pct    NUMERIC(8,4) GENERATED ALWAYS AS (
    CASE WHEN rendimiento_ref > 0
         THEN ROUND(((rendimiento_real - rendimiento_ref) / rendimiento_ref) * 100, 4)
         ELSE 0 END) STORED,
  alerta_rendimiento BOOLEAN GENERATED ALWAYS AS (
    ABS((rendimiento_real - rendimiento_ref) / NULLIF(rendimiento_ref, 0)) > 0.30) STORED,
  costo_directo     NUMERIC(14,2) NOT NULL DEFAULT 0,
  aiu               NUMERIC(5,4) NOT NULL DEFAULT 0.28,
  valor_total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

**`match_scores`** ("Score", `001_postgres_schema.sql:154-174`):
```sql
CREATE TABLE IF NOT EXISTS match_scores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id      UUID NOT NULL,      -- ⚠ SIN FK REFERENCES
  convocatoria_id  UUID NOT NULL,      -- ⚠ SIN FK REFERENCES
  org_id           UUID NOT NULL,
  score            NUMERIC(6,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  cosine_sim       NUMERIC(6,4),
  p_norm           NUMERIC(6,4),
  c_risk           NUMERIC(6,4),
  breakdown        JSONB NOT NULL DEFAULT '{}',
  pipeline_version TEXT NOT NULL DEFAULT 'v2-vector',
  UNIQUE (proyecto_id, convocatoria_id)
);
```
Bootstrap SQLite (`server.js:333-342`) usa **otra escala**: `score REAL CHECK(score BETWEEN 0 AND 100)`. Postgres = 0–1, SQLite dev = 0–100 → bug latente de rango si ambos entornos conviven.

**`projects`** (`001_postgres_schema.sql:46-62`, renombrada en `003`):
```sql
CREATE TABLE IF NOT EXISTS proyectos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES usuarios(id),
  org_id        UUID NOT NULL,
  nombre        TEXT NOT NULL DEFAULT 'Sin nombre',
  estado        TEXT NOT NULL DEFAULT 'Borrador'
                CHECK (estado IN ('Borrador','En_Validacion','Finalizado','BLOQUEADO')),
  ficha_tecnica JSONB NOT NULL DEFAULT '{}',
  presupuesto   JSONB NOT NULL DEFAULT '{}',
  embedding     vector(768)
);
```

### 1.3 Estados de proyecto — **3 definiciones en conflicto**

| Fuente | Valores |
|---|---|
| `001_postgres_schema.sql:52` | `Borrador, En_Validacion, Finalizado, BLOQUEADO` |
| `007_security_hardening.sql:158-170` (constraint adicional, no reemplaza a la anterior) | + `in_review, formulado, needs_human_review, processing, draft` (9 valores acumulados, mezcla PascalCase-ES y snake_case-EN) |
| `server.js:631-632` (bootstrap dev) | `draft, formulado, needs_human_review, archived` (tercer set, `archived` no existe en los otros dos) |

### 1.4 Multi-tenancy — Row-Level Security real, con caveat crítico

Patrón: columna `tenant_id UUID` + `CREATE POLICY` sobre `current_setting('app.tenant_id')`.

```sql
-- 002_multitenant_saas.sql:63-66
CREATE POLICY proyectos_tenant_isolation ON proyectos
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());
```
```sql
-- 010_rls_complete_audit.sql:94-103 (FORCE, no solo ENABLE)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant_rls ON projects
  FOR ALL USING (tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid());
```
Tablas sensibles usan default-deny por `REVOKE` en vez de policy permisiva:
```sql
-- 010:287-298
REVOKE ALL ON stripe_events FROM PUBLIC, anon, authenticated;
```
**Caveat documentado en el propio código (005/009/010):** si el backend se conecta como rol `service_role`/superusuario, **RLS no protege nada** — depende de que el backend llame `set_tenant_context()` con el tenant verificado del JWT en cada request.

### 1.5 FKs reales entre las entidades pedidas

No hay FK entre Problema↔TeoriaDelCambio↔Indicadores↔Presupuesto↔Anexos↔Score porque **4 de esas 6 "entidades" no existen como tablas**. Grafo FK real:
```
usuarios ← proyectos ← project_budgets   (FK declarada, ON DELETE CASCADE)
usuarios ← user_favorites, user_subscriptions
match_scores.proyecto_id / convocatoria_id   → SIN FK (solo UNIQUE compuesto)
project_version_hashes.project_id            → SIN FK
```

---

## 2. Mapeo de UI/UX y Eventos de Interfaz

De los 8 botones pedidos, **solo 2 existen literalmente en la UI** ("Nuevo"/"Exportar"), y **ninguno** está en el estado `[100% Conectado a DB]` salvo el flujo de datos subyacente del export PDF del Directorio.

| Botón solicitado | ¿Existe? | Ubicación | Clasificación |
|---|---|---|---|
| **Nuevo** | Sí (`AnexosView.tsx:199-202`, `addNewAnexo`) | Solo escribe a `localStorage`, ningún `fetch` | `[Simulado / Mock data]` |
| **Abrir** | **No existe** ningún botón con ese label | — | Not found |
| **Cerrar** | Sí, pero solo como `aria-label` de un ✕ de modal (`LoginPage.tsx:33-41`) | Cierra modal local, sin I/O | `[Sin Evento / Desconectado]` |
| **Duplicar** | **No existe** como botón — solo texto de advertencia "no se puede duplicar" (`DirectoryPage.tsx:754,849`) | — | Not found |
| **Copiar Cantidades** | **No existe en ningún archivo del repo** | — | Not found |
| **Consolidar** | **No existe como UI** — solo un comentario de código (`EntityScraper.js:243`) | — | Not found |
| **Independizar** | **Cero ocurrencias en todo el repo** | — | Not found |
| **Exportar** | Sí, 4 variantes distintas (ver abajo) | — | Mixto |

### 2.1 Variantes de "Exportar" encontradas

```tsx
// LogisticaPage.tsx:279-282 / handler 108-122 — Blob download, datos locales
const exportarReporte = () => {
  const payload = {
    kpis: { tramos_activos: tramos.length, alertas_orden_publico: 3, eficiencia_media: '94%' }, // ⚠ hardcoded
    tramos: tramos.map(...), observaciones,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  ...
};
```
→ `[Simulado / Mock data]` — parte del payload (`alertas_orden_publico: 3`, `eficiencia_media: '94%'`) es literal hardcodeado, no calculado.

```tsx
// DirectoryPage.tsx:926-936, handler usa fetchDirectory() → GET /api/entidades (real)
<button onClick={handleDownloadPDF} disabled={pdfGenerating || filtradas.length === 0}>
```
→ `[100% Conectado a DB]` — el PDF se genera client-side con jsPDF pero sobre datos reales del backend (`server.js:1450`, `GET /api/entidades` → Supabase REST `directorio_entidades`).

```tsx
// DashboardFormuladorPage.tsx:360-364 / 647-655 — item de sidebar "Exportar Reporte"
{QUICK_ACCESS.map((item, i) => (
  <div key={i} style={{ cursor:'pointer', ... }}>{item.icon}{item.label}</div>
))}
```
→ `[Sin Evento / Desconectado]` — es un `<div>`, **no tiene `onClick`**, decorativo puro.

### 2.2 "Torre de Control" y filtro ONU/BID/MGA/OXI — **no existen**

- Ningún componente, string o comentario "Torre de Control" en `client/src` (grep repo-wide: 0 matches).
- El acrónimo **"OXI" no existe en ningún archivo**.
- Lo más cercano es un radio-button estático en `EntradaPage.tsx:44-47`:
```tsx
const FORMATO_FINANCIADOR = [
  { label: 'ONU / BID / UE', icon: 'public' },
  { label: 'MGA Web',        icon: 'account_balance_wallet' },
  { label: 'Formato propio', icon: 'description' },
];
```
— selección única de formulario, no un filtro de grilla, sin backend detrás.
- `RadarDashboard.tsx` tiene un array `DONORS` **hardcodeado** (UNESCO, JICA, IKEA Foundation) con taxonomía `BILATERAL/MULTILATERAL/PRIVADO/GOBIERNO` (no ONU/BID/MGA/OXI), accesible solo vía ruta de desarrollo `/dev/dashboard`, no en navegación de producción.
- Existe un `PanelControl.tsx` **solo en worktrees de git no fusionados** (`.kilo/worktrees/...`), confirmado ausente en `main` (`git show main:...` → `fatal: path does not exist`). Si se referencia en planeación futura, marcarlo como WIP no desplegado.

---

## 3. Motor de Ingesta de Anexos Externos

**Un solo endpoint de ingesta en todo el sistema:** `POST /api/importar` (`server.js:2524-2543`), respaldado por `backend/pipeline/FileImporter.js`. No existe carpeta de rutas dedicada a anexos (`backend/routes/` no tiene ningún controlador de import).

```js
// backend/pipeline/FileImporter.js:75-103
export async function parseCSVBuffer(buffer) {
  const parse = await importCsvParse();
  const text = buffer.toString('utf-8').replace(/^﻿/, '');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
    .map(sanitizeRow);
}
export function parseXLSXBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(sanitizeRow);
}
export async function parseFileBuffer(buffer, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'csv') return parseCSVBuffer(buffer);
  if (['xlsx', 'xls'].includes(ext)) return parseXLSXBuffer(buffer);
  try { return await parseCSVBuffer(buffer); }        // ⚠ fallback ciego para cualquier otro formato
  catch { return parseXLSXBuffer(buffer); }
}
```
```js
// server.js:2524-2543
app.post('/api/importar', authenticateToken, upload.single('file'), tryCatch(async (req, res) => {
  const error = validateUploadedFile(req.file);
  if (error) return res.status(422).json({ success: false, message: error });
  const { tipo = 'convocatorias' } = req.body;
  const rows = await parseFileBuffer(req.file.buffer, req.file.originalname);
  const imported = tipo === 'directorio' ? await importToDirectorio(rows) : await importToConvocatorias(rows);
  res.json({ success: true, message: `${imported} registros importados`, count: imported });
}));
```
Destinos de inserción: `directorio_entidades` (`FileImporter.js:126-146`) y `convocatorias` (`FileImporter.js:179-197`), ambos vía `INSERT` parametrizado real.

### 3.1 Matriz de soporte por formato

| Formato | Soporte real | Evidencia |
|---|---|---|
| **CSV** | ✅ Real | `parseCSVBuffer` con `csv-parse/sync` |
| **Excel (.xlsx/.xls)** | ✅ Real | `parseXLSXBuffer` con paquete `xlsx` |
| **JSON** | ❌ **Sin parser** | Está en la whitelist de subida (`server.js:2484`) pero `parseFileBuffer` no tiene rama `ext==='json'` — cae al fallback CSV→XLSX, que fallará o producirá basura. Cero `JSON.parse` en `FileImporter.js`. |
| **XML** | ❌ **Cero código** | Ni siquiera está en `ALLOWED_UPLOAD_TYPES` → rechazado con 422 antes de llegar al parser. Sin `xml2js`/`fast-xml-parser` en el repo. |
| **Presto** | ❌ **Cero menciones** en todo el repo | — |
| **MS Project (.mpp)** | ❌ **Cero menciones**, no está en dependencias ni en whitelist | — |
| **PDF** (bonus, no pedido pero relevante) | ⚠ Aceptado por whitelist (20MB) pero sin parser — cae al mismo fallback roto | `pdfkit`/`jspdf` solo se usan para *generar* PDFs, no para leerlos |

Contraste notable: el propio código usa respuestas `501 NOT_IMPLEMENTED` explícitas cuando algo no está construido (ver §6) — patrón **ausente** para XML/Presto/MS Project, que simplemente no tienen ninguna ruta de código en absoluto, en vez de un stub honesto.

---

## 4. Motor de Coherencia y Scoring

### 4.1 Reglas de bloqueo — reales, pero conectan otras entidades a las pedidas

**Bloqueo real 1 — Presupuesto vs. Ficha Técnica (aritmético puro):**
```js
// backend/validators/crossCheckValidator.js:23-48
export function runCrossCheck(fichaTecnica, presupuesto, proyectoId) {
  const metaDeclarada = round2(Number(fichaTecnica?.metaFisicaTotal) || 0);
  const totalFases = round2(sumFase(presupuesto?.fasesNegra) + sumFase(presupuesto?.fasesGris) + sumFase(presupuesto?.fasesBlanca));
  const discrepancy = round2(totalFases - metaDeclarada);
  if (Math.abs(discrepancy) > 0) return { valid: false, code: 'CROSSCHECK_FAILED', discrepancy };
  return { valid: true, code: null, discrepancy: 0 };
}
```
Conectado en `backend/routes/radicacion.routes.js:64-86`: si falla, `proyectos.estado = 'BLOQUEADO'` y no puede llegar a `'Finalizado'`.

**Bloqueo real 2 — Diagnóstico↔KPIs↔Meta (solapamiento léxico, no semántico real):**
`client/src/agents/Radford360_Agent.ts:109-257` (`auditarContexto`) compara A_diagnostico/B_kpis/C_meta por superposición de palabras y emite `nivel:'bloqueo'`. El campo `D_alineacion` ("Alineación Estratégica **y Teoría del Cambio**") **solo se valida por longitud mínima (40 caracteres)** — nunca se cruza semánticamente con A/B/C. Es decir: "TeoriaDelCambio" es una etiqueta de campo de formulario, no una entidad validada en la lógica de bloqueo.

### 4.2 Scoring 25% Técnica / 25% Económica / 20% Social / 15% Ambiental / 15% Riesgos — **NO EXISTE**

Búsqueda exhaustiva en backend y frontend: **no hay ninguna función que calcule este score ponderado específico.** Lo único con el patrón de pesos 25/20/25/15/15 es **texto estático hardcodeado** en el dashboard:

```ts
// client/src/pages/DashboardFormuladorPage.tsx:60-111
const SECTIONS: ImpactSection[] = [
  { id: 'ambiental', title: 'IMPACTO AMBIENTAL',  weight: 25, score: 78 },  // ⚠ literal
  { id: 'social',     title: 'IMPACTO SOCIAL',     weight: 20, score: 74 },  // ⚠ literal
  { id: 'economico',  title: 'IMPACTO ECONÓMICO',  weight: 25, score: 76 },  // ⚠ literal
  { id: 'normativo',  title: 'IMPACTO NORMATIVO',  weight: 15, score: 81 },  // ⚠ literal
  { id: 'operativo',  title: 'IMPACTO OPERATIVO',  weight: 15, score: 73 },  // ⚠ literal
];
```
Nótese que ni las categorías (`Ambiental/Social/Económico/Normativo/Operativo`, no `Técnica/Riesgos`) ni el peso de Ambiental (25% aquí vs. 15% solicitado) coinciden con la especificación. **No hay ningún `reduce`/multiplicación que combine `weight × score` en un total — el dashboard presenta datos 100% estáticos como si fueran un cálculo en vivo.**

Otras funciones de "score" reales que existen, pero que **no son** el motor pedido:

| Función | Fórmula real | Nota |
|---|---|---|
| `backend/pipeline/matchScore.js:21-22` | `S = 0.50·cosine + 0.30·P_norm − 0.20·C_risk` | Matching proyecto↔convocatoria, no coherencia de proyecto |
| `client/src/agents/NN_Viability_Agent.ts` | pesos 0.22/0.18/0.24/0.20/0.16 sobre `interlocutor/tono/enfoque/humanizacion/adicional` | Archivo **auto-etiquetado `"Estado: PLACEHOLDER"`** (línea 7) |
| `backend/jobs/auditarFormulacion.js:413-432` (`_heuristicAudit`) | checklist booleano `nombre+=20, arbol_objetivos+=25, presupuesto+=25, marco_normativo+=15, cronograma+=15` (=100) | Fallback no-IA; parecido en estructura, no en campos |
| `ai_service/nodes.py:657-660` | "SIV" con OPEX_RATIO 30% / FINANCING_COVERAGE 40% / SROI 30% | El peso vive **dentro de un prompt de texto enviado a Gemini** — el LLM hace la aritmética, no hay función determinista en código |

**Dato adicional de deuda técnica:** el "probability score" que alimenta `matchScore.js` (`P_norm`) se inserta como **constante hardcodeada** al momento del scraping: `DataIngestor.js:248` inserta literal `75`; `EntityScraper.js:888` inserta literal `80`. El insumo del match-score no proviene de ningún modelo — es un número fijo.

---

## 5. Integración de Agentes IA (Gemini/Vertex AI)

### 5.1 Múltiples rutas de llamada, arquitectónicamente inconsistentes

**Ruta A — proxy backend seguro (la documentada/correcta):**
```js
// server.js:2877-2916
app.post('/api/ai/generate', authenticateToken, aiLimiter, tryCatch(async (req, res) => {
  const GEMINI_KEY = process.env.GOOGLE_API_KEY;
  if (!GEMINI_KEY) return res.status(503).json({ success:false, code:'AI_NO_DISPONIBLE' });
  const { messages, temperature = 0.7, max_tokens = 8192 } = req.body;
  const GEMINI_MODEL = 'gemini-2.0-flash';
  const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GEMINI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GEMINI_MODEL, messages, temperature, max_tokens }),
  });
  const data = await upstream.json();
  res.json({ success: true, result: data?.choices?.[0]?.message?.content ?? '', model: GEMINI_MODEL });
}));
```
`client/src/services/ai/geminiService.ts:3-4` documenta correctamente: *"Google Gemini vive exclusivamente en el backend... El cliente nunca la ve."* — **cierto para este archivo**.

**Ruta B — llamada directa desde el navegador (contradice la afirmación anterior):**
```ts
// client/src/services/geminiScanner.ts:103-132
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify({
  contents: [{ parts: [{ text: fullPrompt }] }],
  tools: [{ googleSearch: {} }],
  generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
})});
```
```ts
// geminiScanner.ts:142-144 — la key sale del navegador, no del backend
const creds = JSON.parse(localStorage.getItem('rf360_credentials_v1') || '{}');
const apiKey = (creds.googleGeminiToken || '').replace(/^Bearer\s+/i, '').trim();
```
**Hallazgo de seguridad (BYOK sin cifrar):** el usuario ingresa su propia API key de Gemini en `PanelPage.tsx:608-653`, se guarda **sin cifrar en `localStorage`** y se envía **como query-string** (`?key=...`) directo a Google desde el cliente. Es un diseño "bring-your-own-key" para la función "Barrido Masivo", no una fuga de la key del servidor — pero expone la key del usuario a XSS/devtools y a logs de proxies/históricos de navegador. Ambas rutas (A y B) están **simultáneamente activas en producción**, sin flag que desactive una u otra.

> **[RESUELTO — 2026-09-04]** Este hallazgo fue rediseñado y cerrado el 2026-08-24 (commit `173a07e`, ~33 días después de este reporte), re-verificado hoy por el agente `006-devsecops-infraestructura` y, de forma independiente, por este agente (`007-documentador-as-build`) leyendo el código real. El archivo que originó el hallazgo (`geminiScanner.ts`) ya no vive en `client/src` — fue movido a `archive/frontend_legacy/client/src/services/geminiScanner.ts`. La llave hoy vive solo en memoria de React (`useState`) en `client/src/pages/CredentialsPage.tsx:74-220` (`GeminiByokPanel`) y `client/src/components/ByokRequiredModal.tsx:55-105`, se envía por `http.post('/api/credenciales/gemini', ...)` y nunca se persiste en `localStorage`. Un grep completo de `localStorage` en `client/src` (188 coincidencias) no encontró ninguna API key de IA; el único remanente del nombre de clave `rf360_credentials_v1` (`client/src/pages/PanelPage.tsx:48,323-334`) ya no contiene `googleGeminiToken`, solo un booleano de feature flag (`isGeminiEnabled`) sin valor sensible. Del lado servidor, `backend/services/byokService.js` nunca devuelve la llave en claro (solo `maskKey()`), cifrada con AES-256-GCM real en `backend/pipeline/CryptoHelper.js:3,9-19` (IV único por operación vía `crypto.randomBytes(16)`, `authTag` verificado), con RLS activo (`backend/migrations/045_byok_gemini_por_usuario.sql:35-38`, policy `tenant_isolation`). Detalle completo y tabla de verificación punto por punto en `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`, §9. No se requiere ninguna acción adicional sobre este hallazgo.

Por contraste, el pipeline formulador sí cifra correctamente: `backend/services/credentialVault.js` (AES-256-GCM), usado por `formularProyectoInversion.js:100-114`.

**`.env` local:** contiene `GOOGLE_API_KEY=...` con valor real, correctamente excluido de git (`.gitignore` cubre `*.env*`, solo `.env.example` está trackeado) — no es un secreto commiteado, pero está en texto plano en disco.

### 5.2 Prompt/JSON exacto enviado a la API al evaluar un proyecto

```js
// backend/jobs/auditarFormulacion.js:178-203 — auditoría de calidad M9
const prompt = `Eres un auditor experto en formulación de proyectos de inversión pública colombiana (metodología MGA/BPIN).
Evalúa la calidad de la siguiente formulación de proyecto. Responde SOLO con JSON válido.
CRITERIOS DE EVALUACIÓN (puntaje 0-100 por criterio):
1. coherencia_objetivos: ¿El árbol de objetivos es coherente y jerarquizado?
2. suficiencia_presupuesto: ¿El presupuesto tiene suficiente detalle APU?
3. pertinencia_normativa: ¿El marco normativo aplica al sector y municipio?
4. viabilidad_tecnica: ¿Los indicadores y metas son medibles y alcanzables?
FORMATO DE RESPUESTA REQUERIDO:
{
  "scores": { "coherencia_objetivos": <0-100>, "suficiencia_presupuesto": <0-100>, "pertinencia_normativa": <0-100>, "viabilidad_tecnica": <0-100> },
  "score_total": <promedio ponderado 0-100>,
  "observaciones": [...], "correcciones_sugeridas": [...],
  "aprobado": <true si score_total >= ${QUALITY_THRESHOLD}>
}
FORMULACIÓN A AUDITAR:
${JSON.stringify(payloadEs?.proyecto || payloadEs, null, 2).slice(0, 8000)}`;
```
Modelo usado: `gemini-1.5-flash`, `temperature: 0.1`, `responseMimeType: 'application/json'`. **No existe ningún prompt de evaluación de "anexo"** — ninguna ruta ni servicio conecta Gemini con la tabla/concepto de Anexos.

### 5.3 `geminiCircuitBreaker.js` — real, pero subutilizado

```js
// backend/services/geminiCircuitBreaker.js
const RPM_LIMIT = 15; const RPD_LIMIT = 1500; const HALF_OPEN_PROBE_MS = 5*60_000;
class GeminiCircuitBreaker {
  canCall() {
    if (this.state === 'OPEN') return false;
    if (this.state === 'HALF_OPEN') { /* 1 sondeo cada 5 min */ }
    if (this.dailyCount >= RPD_LIMIT) { this.state = 'OPEN'; return false; }
    if (this._currentRPM() >= RPM_LIMIT) return false;
    return true;
  }
}
```
**Solo lo consume `sectorClassifier.js`.** `arbolObjetivosAgent.js`, `auditarFormulacion.js`, `formularProyectoInversion.js` y el proxy `/api/ai/generate` **no comparten protección de cuota** — cada uno puede agotar el límite de Gemini independientemente del breaker.

### 5.4 `sectorClassifier.js` — clasificación con fallback determinista

```js
export async function classifySectors(titulo, descripcion, donante = '') {
  const genAI = getGenAI();
  if (genAI && geminiCB.canCall()) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(PROMPT_TEMPLATE(titulo, descripcion, donante));
      const parsed = JSON.parse(result.response.text().trim().match(/\[[\s\S]*\]/)[0]);
      const valid = parsed.filter(s => SECTOR_NAMES.includes(String(s).trim())).slice(0, 3);
      if (valid.length > 0) { geminiCB.recordSuccess(); return valid; }
    } catch (err) { if (/429|quota/.test(err.message)) geminiCB.recordQuotaError(); }
  }
  return classifyByKeywords(titulo, descripcion, donante);  // regex ES/EN/FR/DE/PT, nunca falla
}
```

---

## 6. Matriz de Deuda Técnica y Código Incompleto

### 6.1 Placeholders / componentes sin lógica real

| Archivo | Naturaleza |
|---|---|
| `client/src/pages/ModuloProximamente.tsx` | Placeholder explícito ("Placeholder para módulos IA 7.0 en desarrollo") reutilizado para varios módulos aún no construidos |
| `client/src/components/directorio/index.tsx` | Componente completo con datos 100% hardcodeados (SENA, BID, FAO, PNUD), modal "Agregar Nuevo" muestra literalmente "Formulario en desarrollo…" — **y además está huérfano**: no está importado/ruteado en `main.tsx`, es código muerto |
| `client/src/agents/NN_Viability_Agent.ts` | Auto-etiquetado `"Estado: PLACEHOLDER"` en el propio archivo (línea 7) |
| `client/src/components/RadarDashboard.tsx` | Array `DONORS` hardcodeado, solo alcanzable vía ruta dev `/dev/dashboard` |
| `client/src/pages/DashboardFormuladorPage.tsx` (`SECTIONS`) | Presentado visualmente como panel de scoring en vivo; es 100% literal estático (ver §4.2) |
| `client/src/components/AnexosView.tsx` | CRUD de "Anexos" que persiste únicamente en `localStorage`, nunca toca el backend |
| `client/src/services/storage/fileReader.ts`, `client/src/components/FileUploader.tsx` | Contienen lógica de lectura de archivo en el cliente, pero no están conectados al endpoint real `/api/importar` (que vive en `FileImporter.js`) — dos implementaciones paralelas y potencialmente redundantes |

### 6.2 Rutas API declaradas pero sin implementación de backend (respuestas 501 explícitas en `server.js`)

```
POST /api/radar/start                     → 501 "Scheduler de radar no implementado"
POST /api/radar/stop                      → 501 "Scheduler de radar no implementado"
POST /api/radar/barrido                   → 501 (usar /api/radar/barrido-masivo)
GET  /api/radar/buscar                    → 501 "No implementado"
GET  /api/buscar                          → 501 "No implementado"
GET  /api/fuentes                         → 501 "No implementado"
GET  /api/scraped-results                 → 501 "No implementado"
POST /api/entidades/scrape-async          → 501 "No implementado"
POST /api/entidades/indexadas             → 501 "Indexación manual no implementada"
GET  /api/cola-validacion                 → 501 "Cola de validación no implementada"
POST /api/cola-validacion/:id/aprobar     → 501
POST /api/cola-validacion/:id/descartar   → 501
GET  /api/admin/deleted                   → 501 "Papelera administrativa no implementada"
POST /api/admin/restore/:tipo/:id         → 501 "Restauración administrativa no implementada"
POST /api/ia/buscar                       → 501 (usar /api/ia/busqueda-semantica)
POST /api/ai/convocatoria-analyze         → 501 "Análisis de convocatoria no implementado"
POST /api/triggers/run-with-context       → 501 "Triggers contextuales no implementados"
POST /api/configuracion/guardar           → 501 "Configuración persistente no implementada"
```
18 endpoints declarados y montados, todos devolviendo `501 NOT_IMPLEMENTED` deliberadamente — a diferencia de XML/Presto/MS Project (§3), estos SÍ tienen un contrato de API honesto aunque la lógica no exista.

Adicional, no cubierto arriba: no existe ninguna ruta bajo `backend/routes/` para anexos, ingestión de "Portfolio", ni scoring 25/25/20/15/15 — porque las entidades subyacentes no existen (§1, §4).

### 6.3 Variables de entorno / configuración faltante para producción

Comparando `.env.example` (declaradas) vs. `.env` local (configuradas):

| Estado | Variable |
|---|---|
| **Declarada en `.env.example` pero AUSENTE en `.env` local** | `AI_ALLOWED_ORIGINS`, `AI_SERVICE_URL`, `VITE_SENTRY_DSN` |
| **Presente en `.env` local pero NO documentada en `.env.example`** (config "fantasma", riesgo de despliegue incompleto en otro entorno) | `MCP_API_KEY`, `NODE_ENV`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_KEY` |

`GOOGLE_API_KEY` está presente en ambos entornos pero es **el único secreto de IA compartido por todos los servicios** (`arbolObjetivosAgent`, `auditarFormulacion`, `sectorClassifier`, proxy `/api/ai/generate`) — no hay rotación ni separación de key por servicio, y el circuit breaker (§5.3) solo protege uno de los cuatro consumidores.

### 6.4 Inconsistencias estructurales que son deuda técnica en sí mismas (no solo código faltante)

1. **Tres definiciones distintas y simultáneas del CHECK constraint de `projects.status`** (§1.3) — código que inserta `'archived'` fallará contra el constraint de la migración 007, y viceversa.
2. **Tabla `proyectos` (vista compat) + `projects` (canónica) + `proyectos_formulados` (duplicado paralelo)** — tres representaciones de "un proyecto" coexistiendo, con RLS aplicado de forma no uniforme entre ellas.
3. **Rango de `score` inconsistente** entre bootstrap SQLite (0–100) y Postgres (0–1) — mismo nombre de columna, semántica distinta.
4. **`match_scores` sin FK reales** a `proyectos`/`convocatorias` — integridad referencial solo a nivel de aplicación, no de base de datos.
5. **Dos rutas de llamada a Gemini con distinto modelo de seguridad de API key** activas al mismo tiempo (proxy backend vs. BYOK client-side sin cifrar) — no es solo deuda, es una superficie de riesgo de seguridad real para la key del usuario.
6. **Doble implementación de lectura de archivos en frontend** (`fileReader.ts`, `FileUploader.tsx`) sin conexión al parser real del backend (`FileImporter.js`), sugiriendo trabajo duplicado/abandonado.

---

## Resumen ejecutivo (para el diseñador/PM)

- **Base de datos:** funcional para Proyectos↔Presupuesto↔Score-de-matching con RLS real, pero **el vocabulario de negocio pedido (Portfolio, Problema, TeoriaDelCambio, Indicadores, Anexos) no tiene tablas dedicadas** — o vive disperso en columnas JSONB sin estructura, o simplemente no existe.
- **UI:** de los botones pedidos, la mayoría **no existen en el código actual** bajo esos nombres exactos; los que sí existen (Nuevo, Exportar) están mayormente en modo simulado/local, con una única excepción realmente conectada a datos reales (exportar PDF del Directorio).
- **Ingesta:** motor real y funcional solo para CSV/Excel; JSON se acepta pero no se parsea correctamente; XML/Presto/MS Project no tienen ningún soporte.
- **Scoring:** el score ponderado 25/25/20/15/15 solicitado **no existe como cálculo** — es una maqueta visual estática. Sí existen otros tres motores de score reales, con fórmulas y pesos distintos a los especificados.
- **IA:** integración de Gemini real y multi-punto, con manejo de cuota/circuit-breaker parcial. ~~Una ruta cliente-directa (BYOK) que exponía la key del usuario en localStorage sin cifrar~~ — **[RESUELTO 2026-09-04]** rediseñado desde el 2026-08-24 (commit `173a07e`): la llave ya no toca `localStorage`, vive solo en memoria de React y se persiste cifrada (AES-256-GCM) en el backend con RLS. Ver nota completa en §5.1 y `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` §9.
- **Deuda técnica:** 18 endpoints con 501 explícito (honesto), más varios componentes huérfanos/hardcodeados sin ese aviso explícito (menos honesto, mayor riesgo de confundir "maqueta" con "función real" en una demo).

**Mision Cumplida**
