---
tipo: registro_arquitectura
actualizado: 2026-08-03
---

# Registro de decisiones de arquitectura — RadFor-360

Vuelve a [[00_INDEX]]. Relacionado: [[requisitos]] (qué exige cada decisión), [[pendientes]] (deuda técnica derivada).

Formato: fecha aproximada — decisión — por qué. Orden cronológico, más reciente arriba.

## 2026-08-03 — `esbuild` como devDependency explícita

Vite 8 (motor Rolldown) trae `esbuild` como peerDependency **opcional**. El entorno local lo resolvía por algún residuo no identificado; el runner limpio de GitHub Actions no, y rompía `npm run build` con `Cannot find package 'esbuild'`. Fix: declarar `esbuild@^0.28.0` explícito. Patrón repetido — ver también `@types/react`, `pdfjs-dist`, `react-textarea-autosize` más abajo.

## 2026-08-03 — Purga de historial de git (llaves API filtradas)

GitScan (bot externo) reportó una key de Gemini hardcodeada como fallback en `src/services/gemini.ts` (commits `86ce14d`/`ce00d74`, mayo 2026) y una key real de Firebase en `client/src/firebase.ts` (ya eliminado del árbol actual el 2026-08-01). Ambas revocadas en Google Cloud Console. El árbol actual está limpio; el historial de git **seguía exponiéndolas** al momento de escribir esto — ver [[pendientes]] para el estado de la purga (`git filter-repo` + force-push).

## 2026-08-01/03 — Consolidación de ramas: `respaldo-2026-07-22` → `main`

Merge fast-forward (sin conflictos) de la rama de trabajo hacia `main`, activando el workflow V9.0 (Render) en el remoto. Ramas `quixotic-outrigger`, `dirt-eclipse`, `railway/fix-deploy-*` confirmadas como ancestros ya contenidos en `main` (0 commits únicos) — candidatas a limpieza, no a preservación.

## 2026-08-02 — Limpieza de código muerto Node.js dentro de `client/src`

`codeWatcher.ts`, `scraper.ts`, `storage/loadTest.ts` usaban `fs`/`path`/`chokidar` (imposible en browser) y no tenían ningún importador real — confirmado por grep exhaustivo antes de borrar. `orchestrator.ts` (usado por `codeWatcher.ts`) sí seguía vivo vía `useAIOrchestrator.ts` — se preservó.

## 2026-08-02 — Dependencias runtime no declaradas (`@types/react`, `pdfjs-dist`, `react-textarea-autosize`)

Mismo patrón que `esbuild`: usadas en código real, ausentes de `package.json`/lockfile, toleradas en local por razón no resuelta, rompían CI. Técnica desarrollada para auditar esto sistemáticamente: extraer todos los `import ... from`/`import(...)` de `client/src`, normalizar a nombre de paquete top-level, diffear contra `dependencies`+`devDependencies` de `package.json`.

## ~2026-07 — Soft-Lock predial (estado_legal condicionado)

`compliance_data.estado_legal` no bloquea el flujo del Formulador cuando está en estado condicionado — el Hard-Lock solo aplica en el paso de certificación final. Decisión de producto: no frenar la formulación por trámites legales en curso, pero sí impedir radicar sin resolverlos.

## Radar: dos maquetaciones en paralelo, una es la oficial

`RadarCalcoPage.tsx`/`LayoutPadre.tsx` es el diseño **aprobado y en producción**. `PestañaRadar.tsx` (familia Stitch) existe en el código pero **no está ruteado** — queda huérfano a propósito hasta que se decida promoverlo (ver plan de fases pendiente en [[pendientes]]).

## Multitenancy vía RLS, no vía filtros en aplicación

Row Level Security activo en Postgres desde la migración `002_multitenant_saas.sql`, reforzado en `005_rls_saas_hardening.sql`, `010_rls_complete_audit.sql`, `012_enforce_fks_and_rls.sql`, `026_rls_policies_tenant_isolation.sql`. La aislación de tenant es responsabilidad de la base de datos, no del código de rutas — ver [[hseq_normativa]] para el ángulo de cumplimiento.

## Diseño: Stitch MCP como fuente de verdad inmutable

`.stitch_snapshot.json` en `client/` es el "Plano de Obra". Tolerancia cero a desviación CSS (±1px o cambio de token = fallo crítico). Cualquier componente visual nuevo requiere el cuadro comparativo antes de entregarse — regla de CLAUDE.md, no negociable.
