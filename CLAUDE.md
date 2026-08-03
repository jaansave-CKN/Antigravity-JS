# CLAUDE.md — RadarFondos 360

## CALCO — Stitch MCP (PRIORIDAD MÁXIMA)

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

- Frontend: React + TypeScript + Vite (puerto 5173 en dev)
- Backend: Node.js/Express (puerto `process.env.PORT || 3000`)
- DB: PostgreSQL + pgvector (columnas vector(768), índices HNSW)
- Despliegue: **un solo servicio en Render** (`render.yaml`, `startCommand: node server.js`) — `server.js` sirve la API y también el build estático del frontend (`express.static(distPath)`). Corregido 2026-08-03: no son dos despliegues separados (Railway + Render); `.env.railway` es un archivo huérfano sin referencias en el código, verificado por grep.
- Design system: Stitch MCP — Dark mode, token base #001c2e

## Protocolo de Auditoría Verificada (obligatorio para cualquier agente que toque este repo, Claude incluido)

Motivo: una auditoría externa (PDF, 2026-08-03) afirmó varios "hallazgos críticos" de infraestructura (contradicción Render/Railway, PM2 causando bucles de reinicio en producción, choque de rutas `/api/radar`, `@types/react` mal clasificado) que resultaron **falsos al verificarlos** contra `render.yaml`, `package.json` y el código real — bastaba con abrir un archivo o correr un `grep`. La causa: se generó prosa técnica plausible razonando sobre texto/notas, sin ejecutar ninguna verificación contra el repo real.

Regla, sin excepciones:

- **Ninguna afirmación de auditoría, review o reporte de estado se acepta sin evidencia citada** — el comando ejecutado, el archivo+línea leído, o la respuesta real de una API. "Debería fallar" no es un hallazgo; "falló, aquí está el output" sí.
- **Todo reporte generado por otro agente/herramienta se re-verifica** contra el repo real (grep, lectura de archivo, comando en vivo) antes de actuar sobre él — nunca se ejecuta una corrección basada solo en lo que otro agente afirmó.
- Un hallazgo sin evidencia adjunta se descarta explícitamente, no se documenta como válido ni se actúa sobre él.
- Aplica igual a hallazgos de seguridad, de arquitectura, de rendimiento y de estado de CI/CD.

### Antes de confiar en cualquier auditoría (propia o de terceros)

Motivo adicional (2026-08-03): al ir a "solucionar" los pendientes de este mismo archivo, 7 de los "hallazgos grandes" (Formulador sin persistencia, motor de coherencia como cáscara vacía, Viabilidad IA desconectada, Exportación sin construir, endpoint huérfano, RadarGridRealTime roto) resultaron **falsos al leer el código real** — heredados de un plan/PDF viejo, nunca reverificados, ni siquiera por Claude en este mismo proyecto.

- **Verificar primero que la herramienta/agente que audita tiene acceso real de ejecución** (shell, lectura de archivos) al repo — no solo texto/notas que se le pegaron. Sin eso, no es un auditor, es un generador de prosa con forma de auditoría, y ningún ajuste de prompt lo arregla.
- **Un subagente o herramienta externa puede proponer un hallazgo; solo tras re-verificarlo contra el repo real se puede marcar como confirmado** — nunca se hereda un hallazgo de una auditoría anterior (propia o ajena) sin releer el archivo/código que supuestamente lo prueba.
- Documentación acumulada (este archivo, `pendientes.md`, planes previos) es hipótesis a re-verificar periódicamente, no hecho asentado — sobre todo en sesiones largas.
- Para auditorías nuevas dentro de Claude Code, preferir `/code-review` o `/security-review` (evidencia estructurada integrada) sobre herramientas externas de acceso/configuración desconocidos.

## Señal de cierre

Al completar cualquier orden, terminar siempre con: **Mision Cumplida**
