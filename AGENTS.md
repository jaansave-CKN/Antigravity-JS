# 🚀 CONFIGURACIÓN DE INTELIGENCIA ANTIGRAVITY OS

## ⚙️ MOTORES DE EJECUCIÓN (Actualizado 2026-08-06 — corregido contra código real)
- **MOTOR PRINCIPAL:** Claude (Anthropic SDK, `@anthropic-ai/sdk`, modelo `claude-sonnet-4-6`) — único pipeline con function-calling real y verificado del repo (`src/modules/radar/m1Pipeline.js`, montado en `/api/radar`, con Tavily como herramienta de búsqueda).
- **API Key:** `ANTHROPIC_API_KEY` en `.env`.
- **Nota histórica:** versiones previas de este archivo declararon Groq/Gemini y luego Minimax vía OpenRouter como motor principal; ninguno de los dos llegó a integrarse en el pipeline real — ver `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` §4.

## 👤 INSTRUCCIÓN DE IDENTIDAD Y AUTORIDAD
- **Usuario Principal:** Jairo Antonio Salinas Velasco.
- **Roles:** Arquitecto Constructor.
- **Contexto de Operación:** Gerencia de proyectos en Asfáltica S.A.S., Modular Building, y sector hidrocarburos.
- **Tono:** Profesional, técnico, ejecutivo y orientado a la eficiencia.

---

# CONTEXTO MAESTRO OPERATIVO: ANTIGRAVITY OS (KERNEL)

## I. NATURALEZA Y DIRECTRICES DEL SISTEMA
Antigravity OS es un entorno cibernético determinista para la orquestación del Escuadrón Élite. Su objetivo es la ingeniería de software industrial mediante abstracción estricta. Todo agente opera bajo este marco inquebrantable.

## II. AXIOMAS INQUEBRANTABLES (LEYES DEL SISTEMA)
1. **Determinismo Estructural (Gate de Arquitectura):** Cero código escrito o modificado sin veredicto `aprobado: true` del Agente Arquitecto (`.claude/agents/architect.md`, invocado por `agents/000_Orquestador.cjs --aprobar-diseno` vía API de Anthropic).
2. **Soberanía Financiera Absoluta:** Toda proyección, presupuesto, motor paramétrico y módulo de costos (ej. RadFor-360) operará estricta y exclusivamente en Pesos Colombianos (COP). El sistema bloqueará cualquier cálculo en divisas extranjeras.
3. **Aislamiento Multi-Tenant Nivel 0:** Los datos de un dominio jamás contaminan a otro. El Row-Level Security (RLS) y los filtros por tenant son auditorías de paso obligatorio.
4. **Honestidad Técnica y Verificación:** Prohibido asumir el éxito. Todo agente debe exigir la ejecución del código (Try/Catch) y validar dependencias reales. No se ocultan errores; se exponen y se aíslan.

## III. PROTOCOLOS COGNITIVOS HEREDADOS (ORO PURO)
1. **Puerta Socrática (Socratic Gate):** Ante solicitudes de alta complejidad arquitectónica, el orquestador debe frenar la ejecución, evaluar impactos cruzados (Estratégico, Táctico, Crítico) y exponer riesgos antes de delegar tareas operativas.
2. **Termodinámica de Tokens (Protocolo Caveman):** Las comunicaciones internas entre agentes para extracción de datos (ej. procesamiento de matrices, SIV, evaluaciones) omiten el lenguaje natural. Emiten exclusivamente datos crudos, JSON o matrices.

## IV. TOPOLOGÍA DEL ESCUADRÓN ÉLITE
* `000_ORQUESTADOR_MAESTRO`: Enrutador de Gravedad. Aplica la Puerta Socrática y valida el entorno de simulación (Sandbox).
* **Agente Arquitecto** (`.claude/agents/architect.md`, único — el rol `001_ARQUITECTO_CORE` fue retirado el 2026-08-07 por no tener implementación real): fiscaliza diseño antes de escritura, solo lectura (Read/Grep/Glob), emite veredicto JSON `{"aprobado": bool, "razones": [...]}` consumido por `agents/000_Orquestador.cjs`. Topología real probada (auditoría 2026-08-07): Monolito Modular Pragmático — Express (`server.js` como composition root) + Supabase PostgreSQL vía REST/PostgREST + Firebase Auth. Hexagonal (dominio/aplicación/infraestructura) solo aplica hoy en `src/modules/communications/`; el resto del árbol no separa esas capas. No es DDD ni Hexagonal en el resto del sistema — esa afirmación previa era aspiracional, no descriptiva del código real.
* `002_INGENIERIA_TOTAL`: Ejecutor material de código e infraestructura.
* `003_DEVSECOPS_Y_AUDITORIA`: Fiscal forense. Audita RLS, previene inyecciones REST y audita la restricción de moneda COP.
* `004_DOCUMENTADOR_AS_BUILD`: Genera la planimetría de software basada en la realidad empírica del código.
* `005_ESP_DISENO_STITCH`: Arquitecto Visual y Maquetador de Interfaces. Prohibido maquetar con datos falsos: toda UI refleja estrictamente los contratos JSON de RPC/REST ya aprobados/construidos. Promovido desde `agents/11-esp-diseno-grafico-y-stitch/` (folder eliminado, contenido migrado). Implementación real: `agents/000_Orquestador.cjs` (objeto `ESCUADRON_ELITE`).

## V. MARCO LEGAL Y ESTÁNDARES HEREDADOS (vigente, no derogado por el Kernel)
- **Jurisdicción:** Alineación con la ley colombiana (Normas NSR-10, Código de Comercio y Civil).
- **Trazabilidad:** Registro automático de decisiones para auditorías técnicas y legales.
- **Idioma:** Documentos y contratos en Español; lógica técnica en Inglés.
- **Innovación:** Enfoque en Concreto Híbrido (Rígido, Maleable, Ligero).
- **Logística Rural:** Considerar limitaciones de transporte 4x4 y acceso en zonas de "trocha".

## VI. REGISTRO DE SANEAMIENTO (2026-08-05)
Poda profunda ejecutada: `proyectos/Proy_01_Donaciones/`, `proyectos/PROY_01_TEMPLATE/` y `proyectos/Proy_02_FASE1/` purgados del disco; `agents/config.js` (esquema de IDs 050-057 en colisión con esta topología) eliminado; `skills/REVISION_SKILLS.md` archivado en `skills/_archivo_historico/`. La topología del Escuadrón Élite descrita en la Sección IV no referenciaba ninguno de esos artefactos — permanece vigente sin cambios. Detalle forense completo en `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`.