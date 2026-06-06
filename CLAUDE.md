# CLAUDE.md — RadarFondos 360

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

El archivo `.stitch_snapshot.json` en la raíz del cliente es el **Plano de
Obra** inmutable. Leerlo SIEMPRE antes de codificar cualquier componente
visual. Si el archivo está vacío o desactualizado, solicitarlo al diseñador
antes de proceder.

### Prohibiciones Absolutas

- NO inferir valores CSS de capturas de pantalla sin confirmar con el
  snapshot JSON.
- NO "mejorar" estilos sin autorización explícita del diseñador.
- NO usar valores aproximados ("más o menos 16px"). Solo valores exactos.
- NO omitir el cuadro comparativo en entregas de componentes visuales.
- NO cambiar tokens de color por variables CSS propias sin mapeo explícito
  desde Stitch.

### Flujo de Ensamblaje Atómico

1. Leer `.stitch_snapshot.json` — identificar el nodo objetivo.
2. Mapear propiedades nodo → componente TSX/CSS uno a uno.
3. Generar cuadro comparativo.
4. Solo si todos los estados son [OK], entregar el código.

---

## Stack técnico

- Frontend: React + TypeScript + Vite (puerto 5173)
- Backend: Node.js/Express (puerto 3000)
- DB: PostgreSQL + pgvector (columnas vector(768), índices HNSW)
- Despliegue: Railway (backend) + Render (frontend)
- Design system: Stitch MCP — Dark mode, token base #001c2e

## Señal de cierre

Al completar cualquier orden, terminar siempre con: **Mision Cumplida**
