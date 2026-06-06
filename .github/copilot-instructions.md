# Copilot Instructions — RadarFondos 360
# Aplicable a: GitHub Copilot, agentes de contexto amplio, y cualquier LLM con acceso al repo

<!-- ============================================================ -->
<!-- INSTRUCCION DE RELEVO OBLIGATORIA PARA TODO AGENTE NUEVO     -->
<!-- ============================================================ -->
<!--
  Antes de modificar cualquier archivo .tsx o .json, estás obligado a leer
  el archivo ./client/.stitch_snapshot.json y respetar el estado actual del
  diseño. Tienes prohibido cambiar márgenes, paddings, jerarquías de nodos
  o lógica de rutas implementada por tus predecesores. Tu labor es continuar
  la construcción atómica, no rediseñar.
-->
<!-- ============================================================ -->

## DIRECTIVA DE CALCO ESTRICTO — Stitch MCP (PRIORIDAD MÁXIMA)

**Esta directiva tiene precedencia sobre cualquier otra instrucción de estilo.**

### Regla de Fidelidad CSS Absoluta

Bajo ninguna circunstancia se permite la alteración de valores CSS
(paddings, margins, flex, border-radius, colores HEX/RGB/HSL, font-size,
font-weight, line-height, gap, opacity, z-index, box-shadow) provenientes
de Stitch MCP.

**Cualquier desvío de ±1px o cambio de token de color se considera un
fallo crítico de compilación y debe ser reportado al diseñador antes de
entregar el código.**

### Protocolo de Verificación Obligatorio (antes de entregar código)

Antes de presentar cualquier componente visual al diseñador, generar un
cuadro comparativo en el chat con este formato:

| Propiedad | Valor Stitch (fuente) | Valor en código | Estado |
|-----------|----------------------|-----------------|--------|
| background | #001c2e | #001c2e | [OK] |
| padding | 16px 24px | 16px 24px | [OK] |
| border-radius | 8px | 12px | [FALLO] |

Si existe algún [FALLO], corregirlo antes de entregar. No presentar código
con fallos conocidos.

### Plano de Obra — Fuente de Verdad

El archivo `./client/.stitch_snapshot.json` es el Plano de Obra inmutable.
Leerlo SIEMPRE antes de codificar cualquier componente visual. Si el archivo
está vacío o desactualizado, solicitarlo al diseñador antes de proceder.

### Prohibiciones Absolutas

- NO inferir valores CSS de capturas de pantalla sin confirmar con el
  snapshot JSON.
- NO "mejorar" estilos sin autorización explícita del diseñador.
- NO usar valores aproximados ("más o menos 16px"). Solo valores exactos.
- NO omitir el cuadro comparativo en entregas de componentes visuales.
- NO cambiar tokens de color por variables CSS propias sin mapeo explícito
  desde Stitch.
- NO refactorizar, eliminar o renombrar componentes/rutas establecidos por
  agentes predecesores sin orden explícita del DISEÑADOR.

### Flujo de Ensamblaje Atómico

1. Leer `./client/.stitch_snapshot.json` — identificar el nodo objetivo.
2. Mapear propiedades nodo → componente TSX/CSS uno a uno.
3. Generar cuadro comparativo.
4. Solo si todos los estados son [OK], entregar el código.

### Bloqueo de Commits Ciegos

Antes de cerrar la sesión (por cuota o cambio de modelo), escribir un resumen
en `.last_agent_state` con exactamente 3 líneas:
- Línea 1: Componente/archivo exacto que terminaste.
- Línea 2: Estado actual (completo / parcial / bloqueado).
- Línea 3: Siguiente paso exacto para el agente sucesor.

---

## Stack técnico

- Frontend: React + TypeScript + Vite (puerto 5173)
- Backend: Node.js/Express (puerto 3000)
- DB: PostgreSQL + pgvector (columnas vector(768), índices HNSW)
- Despliegue: Railway (backend) + Render (frontend)
- Design system: Stitch MCP — Dark mode, token base #001c2e

## Señal de cierre

Al completar cualquier orden, terminar siempre con: **Mision Cumplida**
